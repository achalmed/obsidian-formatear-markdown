/**
 * formatear.js — el núcleo del formateador: texto Markdown de entrada, texto formateado de salida, sin Obsidian.
 *
 * Tres pasos, como un formateador de editor (Prettier en VS Code o Positron), más una red de seguridad:
 *   1. corregir   markdownlint aplica sus arreglos (marcadores de lista, espacios en el énfasis, líneas en blanco…);
 *                 va primero porque Prettier no repara `** negrita **` y separa en listas distintas `*`, `+` y `-`
 *   2. formatear  Prettier (parser markdown) deja la forma canónica: tablas alineadas, sangrías, líneas en blanco
 *   3. estilo     markdownlint otra vez, solo para el carácter del énfasis (Prettier escribe `_cursiva_`)
 *   4. verificar  comparar antes y después lo que el formato nunca debe tocar (palabras, enlaces, etiquetas, código,
 *                 frontmatter, sintaxis de Obsidian); si algo cambió, se devuelve el original y el motivo
 */
import * as prettier from "prettier/standalone";
import * as pluginMarkdown from "prettier/plugins/markdown";
import * as pluginYaml from "prettier/plugins/yaml";
import { lint } from "markdownlint/sync";
import { applyFixes } from "markdownlint";

/** Reglas de markdownlint que se corrigen solas, con lo que hacen; `activa` es el valor por defecto. */
export const REGLAS = {
    MD004: { activa: true, que: "un solo marcador de lista (-)" },
    MD005: { activa: true, que: "sangría uniforme entre elementos de la misma lista" },
    MD007: { activa: true, que: "sangría de las sublistas" },
    MD009: { activa: true, que: "espacios al final de la línea (deja el salto de línea de dos espacios)" },
    MD010: { activa: false, que: "tabulaciones a espacios (también dentro del código)" },
    MD012: { activa: true, que: "varias líneas en blanco seguidas" },
    MD018: { activa: false, que: "«#Título» a «# Título» (¡convierte en título una #etiqueta al inicio de línea!)" },
    MD019: { activa: true, que: "varios espacios después de # en un título" },
    MD022: { activa: true, que: "línea en blanco alrededor de los títulos" },
    MD023: { activa: true, que: "títulos con espacios delante" },
    MD026: { activa: false, que: "puntuación al final de los títulos" },
    MD027: { activa: true, que: "varios espacios después de > en una cita" },
    MD030: { activa: true, que: "un espacio después del marcador de lista" },
    MD031: { activa: true, que: "línea en blanco alrededor de los bloques de código" },
    MD032: { activa: true, que: "línea en blanco alrededor de las listas" },
    MD034: { activa: false, que: "URL sueltas a <URL>" },
    MD037: { activa: true, que: "espacios dentro del énfasis (`** negrita **`)" },
    MD038: { activa: true, que: "espacios dentro del código en línea" },
    MD039: { activa: true, que: "espacios dentro del texto de un enlace" },
    MD047: { activa: true, que: "un salto de línea al final del archivo" },
    MD049: { activa: true, que: "un solo carácter para la cursiva" },
    MD050: { activa: true, que: "un solo carácter para la negrita" },
    MD058: { activa: true, que: "línea en blanco alrededor de las tablas" },
};

export const PREDETERMINADO = {
    reglas: Object.fromEntries(Object.entries(REGLAS).map(([k, v]) => [k, v.activa])),
    prettier: true,
    ajusteDeLineas: "preserve",   // preserve · never (une las líneas de cada párrafo) · always (corta en anchoDeLinea)
    anchoDeLinea: 100,
    enfasis: "asterisk",          // asterisk (*cursiva*) · underscore (_cursiva_)
    sangriaConTabulador: false,
    anchoDeTabulador: 4,
    frontmatter: false,           // formatear también el YAML del frontmatter
    tablas: "auto",               // auto (alinear si cabe en anchoDeLinea; si no, compactas) · alinear · compactas
};

/** Plantillas que no se formatean: Templater (<% %>) y Nunjucks ({% %}, {{ variable }}, como Zotero Integration).
 * {{ variable }} y no cualquier «{{»: las fórmulas de LaTeX también lo usan ({{- 80.000}). */
const PLANTILLA = /<%|\{%-?\s|\{\{\s*[A-Za-z_][\w.]*(?:\s*\|[^{}\n]*)?\s*\}\}/;
export const esPlantilla = (texto) => PLANTILLA.test(texto);

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/**
 * Prettier alinea siempre las columnas de las tablas (solo las compacta al unir párrafos), y con celdas largas el
 * relleno de espacios las vuelve anchísimas. Esto deja «| a | b |» y «| --- | :-: |» en las tablas que lo pidan.
 */
function compactarTablas(texto, op) {
    if (op.tablas === "alinear") return texto;
    const lineas = texto.split("\n");
    let enCodigo = false;
    for (let i = 0; i < lineas.length; i++) {
        if (/^[ \t>]*(`{3,}|~{3,})/.test(lineas[i])) enCodigo = !enCodigo;
        if (enCodigo || !/^[ \t>]*\|/.test(lineas[i])) continue;
        let j = i;
        while (j < lineas.length && /^[ \t>]*\|/.test(lineas[j])) j++;
        const tabla = lineas.slice(i, j);
        if (op.tablas === "compactas" || Math.max(...tabla.map((l) => l.length)) > op.anchoDeLinea)
            for (let k = 0; k < tabla.length; k++) {
                const [, prefijo, fila] = /^([ \t>]*)(.*)$/.exec(tabla[k]);
                const delimitador = /^\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*$/.test(fila);
                lineas[i + k] =
                    prefijo +
                    (delimitador
                        ? fila.replace(/[ \t]*(:?)-+(:?)[ \t]*(?=\|)/g, " $1---$2 ")
                        : fila.replace(/[ \t]{2,}(?=\|)/g, " ").replace(/(?<!\\)\|[ \t]{2,}/g, "| "));
            }
        i = j - 1;
    }
    return lineas.join("\n");
}

// markdownlint corrige en una pasada sobre la estructura original: `* a` `+ b` son dos listas y MD032 las separaría
// mientras MD004 las une. Por eso primero va la estructura de las listas y después lo demás.
const REGLAS_DE_LISTA = ["MD004", "MD005", "MD007", "MD030"];

/** Configuración de markdownlint para una pasada ("listas", "resto" o "estilo"), con el estilo de Obsidian. */
function configLint(op, pasada) {
    const c = { default: false };
    if (pasada === "estilo") {
        c.MD049 = op.reglas.MD049 ? { style: op.enfasis } : false;
        c.MD050 = op.reglas.MD050 ? { style: "asterisk" } : false;
        return c;
    }
    for (const [regla, activa] of Object.entries(op.reglas))
        if (activa && REGLAS_DE_LISTA.includes(regla) === (pasada === "listas")) c[regla] = true;
    if (c.MD004) c.MD004 = { style: "dash" };
    if (c.MD007) c.MD007 = { indent: op.sangriaConTabulador ? op.anchoDeTabulador : 2 };
    if (c.MD009) c.MD009 = { br_spaces: 2 };
    if (c.MD049) c.MD049 = { style: op.enfasis };
    if (c.MD050) c.MD050 = { style: "asterisk" };
    return c;
}

/** Aplica los arreglos de markdownlint; devuelve el texto y cuántos problemas corrigió. */
function corregir(texto, config) {
    const r = lint({ strings: { t: texto }, config, handleRuleFailures: true }).t;
    const arreglables = r.filter((e) => e.fixInfo);
    return { texto: arreglables.length ? applyFixes(texto, r) : texto, corregidos: arreglables.length };
}

/** Los problemas que markdownlint ve con todas sus reglas (también las que no se corrigen solas). */
export function revisar(texto) {
    return lint({ strings: { t: texto }, config: { default: true, MD013: false, MD018: false, MD041: false } }).t.map(
        (e) => ({
            linea: e.lineNumber,
            regla: e.ruleNames[0],
            nombre: e.ruleNames[1],
            descripcion: e.ruleDescription,
            detalle: e.errorDetail || "",
            arreglable: Boolean(e.fixInfo),
        }),
    );
}

// ── red de seguridad ─────────────────────────────────────────────────────────────────────────────────────────────

const contar = (texto, rx) => (texto.match(rx) || []).length;
const frontmatterDe = (texto) => (texto.match(FRONTMATTER) || [""])[0].trimEnd();

/**
 * Los bloques de código con valla (``` o ~~~), leídos línea a línea: dentro de listas y citas Prettier cambia su
 * sangría, así que cada línea del contenido se compara sin la sangría y los `>` de la valla de apertura, y sin los
 * espacios del final (Prettier los quita también ahí: es lo único que se le consiente dentro del código).
 * Devuelve { bloques: [{ info, contenido }], fuera: el texto sin los bloques }.
 */
export function leerBloques(texto) {
    const lineas = texto.split("\n");
    const bloques = [];
    const fuera = [];
    for (let i = 0; i < lineas.length; i++) {
        const apertura = /^((?:[ \t]*>)*)([ \t]*)(`{3,}|~{3,})(.*)$/.exec(lineas[i]);
        if (!apertura || (apertura[3][0] === "`" && apertura[4].includes("`"))) {
            fuera.push(lineas[i]);
            continue;
        }
        const [, citas, sangria, valla, info] = apertura;
        const cierre = new RegExp(`^(?:[ \\t]*>)*[ \\t]*${valla[0] === "`" ? "`" : "~"}{${valla.length},}[ \\t]*$`);
        const contenido = [];
        let j = i + 1;
        for (; j < lineas.length && !cierre.test(lineas[j]); j++) {
            let l = lineas[j];
            for (let k = 0; k < (citas.match(/>/g) || []).length; k++) l = l.replace(/^[ \t]*> ?/, "");
            contenido.push(l.replace(new RegExp(`^[ \\t]{0,${sangria.length}}`), "").replace(/[ \t]+$/, ""));
        }
        bloques.push({ info: info.trim(), contenido: contenido.join("\n") });
        i = j;   // la línea de cierre (o el final, si el bloque no se cierra)
    }
    return { bloques, fuera: fuera.join("\n") };
}

const sinCodigo = (texto) => leerBloques(texto).fuera.replace(/`[^`\n]*`/g, "");
const bloquesDeCodigo = (texto) => leerBloques(texto).bloques.map((b) => b.info + "\n" + b.contenido);
// Los números de las listas ordenadas no cuentan: Markdown solo usa el primero, y Prettier los renumera.
// Tampoco los de una línea de texto que empieza como «4. algo», que Prettier escapa («4\\. algo») para que no sea lista.
const palabras = (texto) =>
    (texto.replace(/^([ \t>]*)\d{1,9}\\?[.)](?=[ \t]|$)/gm, "$1").match(/[\p{L}\p{N}]+/gu) || []).join(" ");
const enlaces = (texto) =>
    (sinCodigo(texto).match(/!?\[\[[^\]\n]+\]\]/g) || []).map((e) => e.replace(/\\\|/g, "|")).sort();

/**
 * La primera palabra de cada línea con texto, fuera del código. En Obsidian cada salto de línea dentro de un párrafo
 * se ve (sin «saltos de línea estrictos»), y Prettier une a veces dos líneas (p. ej. «texto\n4. algo», para que no
 * parezca lista): con `ajusteDeLineas: "preserve"`, toda línea debe seguir empezando una línea.
 */
const iniciosDeLinea = (texto) =>
    leerBloques(texto)
        .fuera.split("\n")
        .map((l) => l.replace(/^[ \t>]*(?:(?:[-*+]|\d{1,9}\\?[.)])(?=[ \t]|$)[ \t]*)?(?:\[.\][ \t]*)?/, ""))
        .map((l) => (l.match(/[\p{L}\p{N}]+/u) || [""])[0])
        .filter(Boolean)
        .join(" ");

/** Lo que el formato nunca debe cambiar; cada entrada es [qué, extractor]. */
const INVARIANTES = [
    ["las palabras y su orden", palabras],
    ["los [[enlaces]] e ![[incrustaciones]]", (t) => enlaces(t).join("\n")],
    ["las #etiquetas", (t) => (sinCodigo(t).match(/(?<=^|\s)#[\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*/gu) || []).sort().join(" ")],
    ["los ==resaltados==", (t) => contar(sinCodigo(t), /==/g)],
    ["los %%comentarios%%", (t) => contar(t, /%%/g)],
    ["las fórmulas $ y $$", (t) => contar(sinCodigo(t), /(?<!\\)\$/g)],
    ["las órdenes de Templater <% %>", (t) => contar(t, /<%/g) + "·" + contar(t, /%>/g)],
    ["los campos de Dataview ::", (t) => contar(sinCodigo(t), /::/g)],
    ["los callouts [!…]", (t) => contar(sinCodigo(t), /\[![\w-]+\]/g)],
    ["las casillas de tarea", (t) => (t.match(/^[ \t>]*(?:[-*+]|\d+[.)])[ \t]+\[(.)\]/gm) || []).map((c) => c.slice(-2, -1)).join("")],
    ["las notas al pie [^…]", (t) => contar(sinCodigo(t), /\[\^[^\]\n]+\]/g)],
    ["los bloques de código", (t) => bloquesDeCodigo(t).join("\n\u0000\n")],
];

/** Compara antes y después; devuelve la lista de lo que cambió (vacía si todo está bien). */
export function verificar(antes, despues, op = PREDETERMINADO) {
    const fallos = [];
    for (const [que, extraer] of INVARIANTES) {
        if (que === "las #etiquetas" && op.reglas && op.reglas.MD018) continue;   // MD018 convierte #Título en título
        if (String(extraer(antes)) !== String(extraer(despues))) fallos.push(que);
    }
    if ((op.ajusteDeLineas || "preserve") === "preserve" && iniciosDeLinea(antes) !== iniciosDeLinea(despues))
        fallos.push("los saltos de línea dentro de los párrafos");
    if (!op.frontmatter && frontmatterDe(antes) !== frontmatterDe(despues)) fallos.push("el frontmatter");
    return fallos;
}

// ── formatear ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Formatea un texto Markdown. Devuelve { texto, cambio, corregidos, error }: si la verificación encuentra algo
 * alterado, `texto` es el original y `error` dice qué se habría roto.
 */
export async function formatear(original, opciones = {}) {
    const op = { ...PREDETERMINADO, ...opciones, reglas: { ...PREDETERMINADO.reglas, ...(opciones.reglas || {}) } };
    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    let texto = original.replace(/\r\n/g, "\n");
    let corregidos = 0;
    try {
        for (const pasada of ["listas", "resto"]) {
            const paso = corregir(texto, configLint(op, pasada));
            texto = paso.texto;
            corregidos += paso.corregidos;
        }
        if (op.prettier) {
            // Sin el complemento de YAML, Prettier copia el frontmatter tal cual.
            texto = await prettier.format(texto, {
                parser: "markdown",
                plugins: op.frontmatter ? [pluginMarkdown, pluginYaml] : [pluginMarkdown],
                proseWrap: op.ajusteDeLineas,
                printWidth: op.anchoDeLinea,
                useTabs: op.sangriaConTabulador,
                tabWidth: op.anchoDeTabulador,
                embeddedLanguageFormatting: "off",
            });
            texto = compactarTablas(texto, op);
        }
        const paso3 = corregir(texto, configLint(op, "estilo"));
        texto = paso3.texto;
        corregidos += paso3.corregidos;
    } catch (e) {
        return { texto: original, cambio: false, corregidos: 0, error: "no se pudo formatear: " + (e.message || e).split("\n")[0] };
    }
    if (eol === "\r\n") texto = texto.replace(/\n/g, "\r\n");
    if (op.sinVerificar) return { texto, cambio: texto !== original, corregidos, error: null };   // solo para diagnosticar
    const fallos = verificar(original, texto, op);
    if (fallos.length) return { texto: original, cambio: false, corregidos: 0, error: "se habrían alterado " + fallos.join(", ") };
    return { texto, cambio: texto !== original, corregidos, error: null };
}
