#!/usr/bin/env node
// herramientas/simular.mjs — formatea en memoria los .md de unas carpetas y dice qué pasaría; nunca escribe.
//
// Uso: node herramientas/simular.mjs <carpeta>... [--diferencias N] [--omitir-plantillas]
//   --diferencias N    imprime las N primeras líneas cambiadas de cada archivo bloqueado (para revisarlo)
//   --omitir-plantillas no cuenta las plantillas (Templater, Nunjucks), como hace el complemento por defecto
// Salida: 0 si ningún archivo queda bloqueado por la verificación; 1 si alguno.
import fs from "node:fs";
import path from "node:path";
import { formatear, esPlantilla } from "../src/formatear.js";

const args = process.argv.slice(2);
const n = args.includes("--diferencias") ? Number(args[args.indexOf("--diferencias") + 1]) : 0;
const omitirPlantillas = args.includes("--omitir-plantillas");
const carpetas = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--diferencias");
if (!carpetas.length) {
    console.error("uso: simular.mjs <carpeta>... [--diferencias N] [--omitir-plantillas]");
    process.exit(1);
}

const archivos = [];
const recorrer = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) recorrer(p);
        else if (e.name.endsWith(".md")) archivos.push(p);
    }
};
carpetas.forEach(recorrer);

const t0 = Date.now();
const res = { cambian: 0, iguales: 0, plantillas: 0, correcciones: 0, bloqueados: new Map() };
for (const archivo of archivos) {
    const texto = fs.readFileSync(archivo, "utf8");
    if (omitirPlantillas && esPlantilla(texto)) {
        res.plantillas++;
        continue;
    }
    const r = await formatear(texto);
    if (r.error) {
        if (!res.bloqueados.has(r.error)) res.bloqueados.set(r.error, []);
        res.bloqueados.get(r.error).push(archivo);
    } else if (r.cambio) {
        res.cambian++;
        res.correcciones += r.corregidos;
    } else res.iguales++;
}

const bloqueados = [...res.bloqueados.values()].reduce((s, l) => s + l.length, 0);
console.log(`${archivos.length} archivos en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`  cambiarían ${res.cambian} (${res.correcciones} correcciones de markdownlint) · ya en orden ${res.iguales}` +
    ` · plantillas omitidas ${res.plantillas} · bloqueados por la verificación ${bloqueados}`);
for (const [motivo, lista] of res.bloqueados) {
    console.log(`\n  ${lista.length} × ${motivo}`);
    for (const a of lista.slice(0, n ? 50 : 5)) console.log(`     ${a}`);
}
process.exit(bloqueados ? 1 : 0);
