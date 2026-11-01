/**
 * main.js — Formatear Markdown, complemento de Obsidian (https://github.com/achalmed/obsidian-formatear-markdown).
 *
 * Lo que da:
 *   Formatear el documento        Mayús+Alt+F, como en VS Code y Positron; también en el menú del editor
 *   Formatear al guardar          al pulsar Ctrl+S (la orden «Guardar archivo»); el autoguardado no formatea
 *   Revisar el documento          los problemas que ve markdownlint, también los que no se corrigen solos
 *   Formatear carpeta / el vault  primero simula y dice qué archivos cambiarían; después aplica
 * El núcleo está en formatear.js; si su verificación ve algo alterado, el archivo no se toca.
 */
import { Plugin, PluginSettingTab, Setting, Notice, Modal, MarkdownView, TFile, TFolder, normalizePath } from "obsidian";
import { formatear, revisar, esPlantilla, REGLAS, PREDETERMINADO } from "./formatear.js";

const AJUSTES = {
    ...PREDETERMINADO,
    alGuardar: true,
    sangriaDeObsidian: true,          // tabulador y ancho como «Usar tabulaciones» de Obsidian
    omitirPlantillas: true,           // no tocar plantillas: Templater (<% %>) y Nunjucks ({% %}, {{ variable }})
    carpetasIgnoradas: [],
    extensiones: ["md"],
};

export default class FormatearMarkdown extends Plugin {
    async onload() {
        const guardados = (await this.loadData()) || {};
        this.ajustes = { ...AJUSTES, ...guardados, reglas: { ...AJUSTES.reglas, ...(guardados.reglas || {}) } };
        this.addSettingTab(new PestanaFormatear(this.app, this));

        this.addCommand({
            id: "formatear-documento",
            name: "Formatear el documento",
            hotkeys: [{ modifiers: ["Shift", "Alt"], key: "F" }],
            editorCallback: (editor, vista) => this.formatearEditor(editor, vista.file, true),
        });
        this.addCommand({
            id: "revisar-documento",
            name: "Revisar el documento (problemas de Markdown)",
            editorCallback: (editor, vista) => new ModalRevision(this, editor, vista.file).open(),
        });
        this.addCommand({
            id: "formatear-vault",
            name: "Formatear todos los archivos del vault…",
            callback: () => this.formatearVarios(this.app.vault.getRoot()),
        });
        this.addCommand({
            id: "formatear-carpeta-actual",
            name: "Formatear la carpeta del documento…",
            checkCallback: (comprobando) => {
                const archivo = this.app.workspace.getActiveFile();
                if (!archivo || !archivo.parent) return false;
                if (!comprobando) this.formatearVarios(archivo.parent);
                return true;
            },
        });

        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu, editor, vista) => {
                if (!vista.file || !this.esFormateable(vista.file)) return;
                menu.addItem((i) =>
                    i.setTitle("Formatear el documento").setIcon("wand-2").setSection("action")
                        .onClick(() => this.formatearEditor(editor, vista.file, true)),
                );
            }),
        );
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, archivo) => {
                if (archivo instanceof TFolder)
                    menu.addItem((i) => i.setTitle("Formatear Markdown de la carpeta…").setIcon("wand-2")
                        .onClick(() => this.formatearVarios(archivo)));
                else if (archivo instanceof TFile && this.esFormateable(archivo))
                    menu.addItem((i) => i.setTitle("Formatear Markdown").setIcon("wand-2")
                        .onClick(() => this.formatearArchivos([archivo], true)));
            }),
        );

        this.engancharGuardado();
    }

    onunload() {
        if (this.guardarOriginal) this.guardarOriginal.cmd.checkCallback = this.guardarOriginal.checkCallback;
    }

    /** Envuelve la orden «Guardar archivo» (Ctrl+S): formatea y después guarda. */
    engancharGuardado() {
        const cmd = this.app.commands && this.app.commands.commands && this.app.commands.commands["editor:save-file"];
        if (!cmd || typeof cmd.checkCallback !== "function") return;
        const checkCallback = cmd.checkCallback;
        this.guardarOriginal = { cmd, checkCallback };
        cmd.checkCallback = (comprobando) => {
            if (comprobando || !this.ajustes.alGuardar) return checkCallback(comprobando);
            const vista = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!vista || !vista.file || vista.getMode() !== "source" || !this.esFormateable(vista.file))
                return checkCallback(comprobando);
            this.formatearEditor(vista.editor, vista.file, false).finally(() => checkCallback(false));
            return true;
        };
    }

    opciones() {
        const a = this.ajustes;
        const op = { ...a };
        if (a.sangriaDeObsidian) {
            op.sangriaConTabulador = this.app.vault.getConfig("useTab") !== false;
            op.anchoDeTabulador = this.app.vault.getConfig("tabSize") || 4;
        }
        return op;
    }

    esFormateable(archivo) {
        if (!(archivo instanceof TFile) || !this.ajustes.extensiones.includes(archivo.extension)) return false;
        return !this.ajustes.carpetasIgnoradas.some((c) => {
            const carpeta = normalizePath(c).replace(/\/$/, "");
            return carpeta && (archivo.path === carpeta || archivo.path.startsWith(carpeta + "/"));
        });
    }

    /** Formatea lo que hay en el editor, cambiando solo el tramo que difiere para no mover el cursor. */
    async formatearEditor(editor, archivo, avisar) {
        const antes = editor.getValue();
        if (this.ajustes.omitirPlantillas && esPlantilla(antes)) {
            if (avisar) new Notice("Formatear Markdown: es una plantilla (Templater o Nunjucks) y está omitida (Ajustes).");
            return;
        }
        const r = await formatear(antes, this.opciones());
        if (r.error) return new Notice(`Formatear Markdown: ${archivo ? archivo.name : "el documento"} no se tocó: ${r.error}.`, 8000);
        if (!r.cambio) return avisar && new Notice("Formatear Markdown: ya estaba en orden.");
        if (editor.getValue() !== antes) return;   // el usuario escribió mientras se formateaba
        let i = 0;
        while (i < antes.length && antes[i] === r.texto[i]) i++;
        let a = antes.length, b = r.texto.length;
        while (a > i && b > i && antes[a - 1] === r.texto[b - 1]) a--, b--;
        editor.replaceRange(r.texto.slice(i, b), editor.offsetToPos(i), editor.offsetToPos(a));
        if (avisar) new Notice(`Formatear Markdown: listo (${r.corregidos} correcciones de markdownlint).`);
    }

    /** Formatea archivos en disco; sin `aplicar`, solo dice cuáles cambiarían. */
    async formatearArchivos(archivos, aplicar, alAvanzar) {
        const res = { cambian: [], iguales: 0, omitidos: [], errores: [] };
        let n = 0;
        for (const archivo of archivos) {
            if (alAvanzar) alAvanzar(++n, archivos.length);
            const antes = await this.app.vault.cachedRead(archivo);
            if (this.ajustes.omitirPlantillas && esPlantilla(antes)) {
                res.omitidos.push(archivo);
                continue;
            }
            const r = await formatear(antes, this.opciones());
            if (r.error) res.errores.push({ archivo, error: r.error });
            else if (!r.cambio) res.iguales++;
            else {
                res.cambian.push({ archivo, corregidos: r.corregidos });
                if (aplicar) await this.app.vault.process(archivo, (actual) => (actual === antes ? r.texto : actual));
            }
        }
        if (aplicar && archivos.length === 1)
            new Notice(res.errores.length ? `Formatear Markdown: no se tocó: ${res.errores[0].error}.`
                : res.cambian.length ? "Formatear Markdown: listo." : "Formatear Markdown: ya estaba en orden.");
        return res;
    }

    formatearVarios(carpeta) {
        const archivos = [];
        const recorrer = (f) => {
            if (f instanceof TFolder) f.children.forEach(recorrer);
            else if (this.esFormateable(f)) archivos.push(f);
        };
        recorrer(carpeta);
        new ModalVarios(this, carpeta, archivos).open();
    }
}

/** Simula el formato de varios archivos, enseña el resultado y aplica si se confirma. */
class ModalVarios extends Modal {
    constructor(plugin, carpeta, archivos) {
        super(plugin.app);
        this.plugin = plugin;
        this.carpeta = carpeta;
        this.archivos = archivos;
    }

    async onOpen() {
        const { contentEl } = this;
        const nombre = this.carpeta.isRoot() ? "todo el vault" : this.carpeta.path;
        this.setTitle(`Formatear Markdown: ${nombre}`);
        const estado = contentEl.createEl("p", { text: `Simulando ${this.archivos.length} archivos…` });
        const res = await this.plugin.formatearArchivos(this.archivos, false, (n, total) => {
            if (n % 25 === 0 || n === total) estado.setText(`Simulando… ${n} de ${total}`);
        });
        estado.setText(
            `${res.cambian.length} archivos cambiarían · ${res.iguales} ya están en orden · ` +
                `${res.omitidos.length} plantillas, omitidas · ${res.errores.length} no se pueden formatear sin riesgo.`,
        );
        const lista = (titulo, filas) => {
            if (!filas.length) return;
            const det = contentEl.createEl("details");
            det.createEl("summary", { text: `${titulo} (${filas.length})` });
            const ul = det.createEl("ul", { cls: "formatear-markdown-lista" });
            for (const f of filas.slice(0, 500)) ul.createEl("li", { text: f });
            if (filas.length > 500) ul.createEl("li", { text: `… y ${filas.length - 500} más` });
        };
        lista("Cambiarían", res.cambian.map((c) => `${c.archivo.path} (${c.corregidos} correcciones)`));
        lista("No se tocarán", res.errores.map((e) => `${e.archivo.path}: ${e.error}`));
        if (!res.cambian.length) return;
        new Setting(contentEl)
            .setDesc("Antes de aplicar a muchos archivos, conviene tener una copia o el vault en git.")
            .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()))
            .addButton((b) =>
                b.setButtonText(`Formatear ${res.cambian.length} archivos`).setCta().onClick(async () => {
                    b.setDisabled(true);
                    const hechos = await this.plugin.formatearArchivos(res.cambian.map((c) => c.archivo), true, (n, total) => {
                        if (n % 25 === 0 || n === total) estado.setText(`Formateando… ${n} de ${total}`);
                    });
                    new Notice(`Formatear Markdown: ${hechos.cambian.length} archivos formateados.`);
                    this.close();
                }),
            );
    }

    onClose() {
        this.contentEl.empty();
    }
}

/** Lista los problemas de markdownlint del documento y ofrece formatearlo. */
class ModalRevision extends Modal {
    constructor(plugin, editor, archivo) {
        super(plugin.app);
        this.plugin = plugin;
        this.editor = editor;
        this.archivo = archivo;
    }

    onOpen() {
        const { contentEl } = this;
        const problemas = revisar(this.editor.getValue());
        this.setTitle(`Revisión de ${this.archivo ? this.archivo.name : "el documento"}`);
        if (!problemas.length) return contentEl.createEl("p", { text: "Sin problemas." });
        const arreglables = problemas.filter((p) => p.arreglable).length;
        contentEl.createEl("p", { text: `${problemas.length} problemas; ${arreglables} se corrigen al formatear (si su regla está activa).` });
        const ul = contentEl.createEl("ul", { cls: "formatear-markdown-lista" });
        for (const p of problemas) {
            const li = ul.createEl("li");
            const enlace = li.createEl("a", { text: `línea ${p.linea}` });
            enlace.onclick = () => {
                this.editor.setCursor({ line: p.linea - 1, ch: 0 });
                this.editor.scrollIntoView({ from: { line: p.linea - 1, ch: 0 }, to: { line: p.linea - 1, ch: 0 } }, true);
                this.close();
            };
            li.appendText(` · ${p.regla} ${p.descripcion}${p.detalle ? " — " + p.detalle : ""}${p.arreglable ? " ✓" : ""}`);
        }
        new Setting(contentEl).addButton((b) =>
            b.setButtonText("Formatear el documento").setCta().onClick(async () => {
                await this.plugin.formatearEditor(this.editor, this.archivo, true);
                this.close();
            }),
        );
    }

    onClose() {
        this.contentEl.empty();
    }
}

class PestanaFormatear extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        const p = this.plugin;
        const a = p.ajustes;
        const guardar = () => p.saveData(a);
        containerEl.empty();

        new Setting(containerEl).setName("Cuándo").setHeading();
        new Setting(containerEl)
            .setName("Formatear al guardar")
            .setDesc("Al pulsar Ctrl+S (orden «Guardar archivo»). El autoguardado de Obsidian no formatea.")
            .addToggle((t) => t.setValue(a.alGuardar).onChange(async (v) => ((a.alGuardar = v), await guardar())));
        new Setting(containerEl)
            .setName("Omitir plantillas")
            .setDesc("No toca los archivos con código de Templater (<% %>) o de Nunjucks ({% %}, {{ variable }}), como las plantillas de Zotero Integration.")
            .addToggle((t) => t.setValue(a.omitirPlantillas).onChange(async (v) => ((a.omitirPlantillas = v), await guardar())));
        new Setting(containerEl)
            .setName("Carpetas ignoradas")
            .setDesc("Una por línea, relativa al vault.")
            .addTextArea((t) =>
                t.setValue(a.carpetasIgnoradas.join("\n")).onChange(async (v) => {
                    a.carpetasIgnoradas = v.split("\n").map((x) => x.trim()).filter(Boolean);
                    await guardar();
                }),
            );

        new Setting(containerEl).setName("Formato (Prettier)").setHeading();
        new Setting(containerEl)
            .setName("Usar Prettier")
            .setDesc("Tablas alineadas, sangrías y líneas en blanco uniformes. Sin él, solo se aplican las correcciones.")
            .addToggle((t) => t.setValue(a.prettier).onChange(async (v) => ((a.prettier = v), await guardar())));
        new Setting(containerEl)
            .setName("Líneas de los párrafos")
            .setDesc("«Unir» quita los saltos de línea dentro de cada párrafo. Ojo: en Obsidian, sin «saltos de línea estrictos», cada salto se ve.")
            .addDropdown((d) =>
                d.addOptions({ preserve: "Dejarlas como están", never: "Unir cada párrafo en una línea", always: "Cortar en el ancho de línea" })
                    .setValue(a.ajusteDeLineas)
                    .onChange(async (v) => ((a.ajusteDeLineas = v), await guardar())),
            );
        new Setting(containerEl)
            .setName("Ancho de línea")
            .setDesc("Para cortar párrafos y para decidir qué tablas se alinean.")
            .addText((t) =>
                t.setValue(String(a.anchoDeLinea)).onChange(async (v) => {
                    const n = parseInt(v, 10);
                    if (n > 20) (a.anchoDeLinea = n), await guardar();
                }),
            );
        new Setting(containerEl)
            .setName("Tablas")
            .setDesc("Prettier alinea las columnas con espacios; con celdas largas, la tabla queda muy ancha.")
            .addDropdown((d) =>
                d.addOptions({ auto: "Alinear si caben en el ancho de línea", alinear: "Alinear siempre", compactas: "Compactas siempre" })
                    .setValue(a.tablas)
                    .onChange(async (v) => ((a.tablas = v), await guardar())),
            );
        new Setting(containerEl)
            .setName("Cursiva")
            .addDropdown((d) =>
                d.addOptions({ asterisk: "*cursiva*", underscore: "_cursiva_" })
                    .setValue(a.enfasis)
                    .onChange(async (v) => ((a.enfasis = v), await guardar())),
            );
        new Setting(containerEl)
            .setName("Sangría como Obsidian")
            .setDesc("Usa «Usar tabulaciones» y «Tamaño de tabulación» del editor de Obsidian para las sublistas.")
            .addToggle((t) => t.setValue(a.sangriaDeObsidian).onChange(async (v) => ((a.sangriaDeObsidian = v), await guardar())));
        new Setting(containerEl)
            .setName("Formatear el frontmatter")
            .setDesc("También el YAML entre ---. Apagado, el frontmatter no se toca.")
            .addToggle((t) => t.setValue(a.frontmatter).onChange(async (v) => ((a.frontmatter = v), await guardar())));

        new Setting(containerEl).setName("Correcciones (markdownlint)").setHeading();
        for (const [regla, info] of Object.entries(REGLAS))
            new Setting(containerEl)
                .setName(regla)
                .setDesc(info.que)
                .addToggle((t) => t.setValue(a.reglas[regla]).onChange(async (v) => ((a.reglas[regla] = v), await guardar())));
    }
}
