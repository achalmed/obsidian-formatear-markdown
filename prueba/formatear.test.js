// prueba/formatear.test.js — el núcleo del formateador, sin Obsidian: `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatear, verificar, revisar } from "../src/formatear.js";

const f = async (texto, op) => {
    const r = await formatear(texto, op);
    assert.equal(r.error, null, r.error);
    return r.texto;
};

test("corrige el énfasis con espacios dentro", async () => {
    assert.equal(await f("Una ** negrita ** y * cursiva *.\n"), "Una **negrita** y *cursiva*.\n");
});

test("unifica los marcadores de lista en una sola lista", async () => {
    assert.equal(await f("* uno\n+ dos\n- tres\n"), "- uno\n- dos\n- tres\n");
});

test("quita líneas en blanco de más y espacios al final", async () => {
    assert.equal(await f("Uno.   \n\n\n\nDos.\t\n"), "Uno.\n\nDos.\n");
});

test("alinea las tablas", async () => {
    assert.equal(await f("|a|bb|\n|-|-|\n|ccc|d|\n"), "| a   | bb  |\n| --- | --- |\n| ccc | d   |\n");
});

test("compacta las tablas que no caben en el ancho de línea", async () => {
    const larga = "x".repeat(60);
    assert.equal(
        await f(`|a|b|\n|:-|-:|\n|${larga}|${larga}|\n`),
        `| a | b |\n| :--- | ---: |\n| ${larga} | ${larga} |\n`,
    );
    assert.equal(await f("|a|bb|\n|-|-|\n", { tablas: "compactas" }), "| a | bb |\n| --- | --- |\n");
    assert.equal(await f("|a|bb|\n|-|-|\n|ccc|d|\n", { tablas: "alinear", anchoDeLinea: 5 }), "| a   | bb  |\n| --- | --- |\n| ccc | d   |\n");
});

test("separa títulos, listas y código con una línea en blanco", async () => {
    assert.equal(
        await f("# Título\nTexto\n- a\n```js\nx\n```\nFin\n"),
        "# Título\n\nTexto\n\n- a\n\n```js\nx\n```\n\nFin\n",
    );
});

test("termina el archivo con un salto de línea", async () => {
    assert.equal(await f("Texto"), "Texto\n");
});

test("respeta la sintaxis de Obsidian", async () => {
    const nota = [
        "[[Nota|alias]] ![[img.png|300]] [[Otra#Sección]] #etiqueta/anidada",
        "==resaltado== %%comentario%% $x_1^2$ nota[^1]",
        "",
        "> [!warning] Cuidado",
        "> dentro del callout",
        "",
        "- [ ] pendiente",
        "- [x] hecha",
        "- [/] a medias",
        "",
        "campo:: valor",
        "",
        "$$",
        "\\int_0^1 x\\,dx",
        "$$",
        "",
        "[^1]: Nota al pie.",
        "",
    ].join("\n");
    assert.equal(await f(nota), nota);
});

test("no convierte #etiqueta al inicio de línea en título", async () => {
    assert.equal(await f("#etiqueta y texto\n"), "#etiqueta y texto\n");
});

test("no toca el frontmatter ni el interior de los bloques de código", async () => {
    const t = "---\ntipo:   nota\nlista: [a,b]\n---\n\n```python\nx  =  1\n\n\n\ny=2\n```\n";
    assert.equal(await f(t), t);
    assert.equal(await f("```\ny=2   \n```\n"), "```\ny=2\n```\n", "solo se van los espacios finales");
});

test("conserva los saltos de línea de Windows", async () => {
    assert.equal(await f("* a\r\n+ b\r\n"), "- a\r\n- b\r\n");
});

test("une las líneas de cada párrafo si se pide", async () => {
    assert.equal(await f("una\nsola\nidea\n", { ajusteDeLineas: "never" }), "una sola idea\n");
});

test("usa _ para la cursiva si se pide", async () => {
    assert.equal(await f("Una *cursiva*.\n", { enfasis: "underscore" }), "Una _cursiva_.\n");
});

test("la verificación detecta palabras, enlaces, etiquetas y código alterados", () => {
    assert.deepEqual(verificar("hola mundo\n", "hola\n"), ["las palabras y su orden"]);
    assert.ok(verificar("[[a]]\n", "[a]\n").includes("los [[enlaces]] e ![[incrustaciones]]"));
    assert.ok(verificar("#a b\n", "# a b\n").includes("las #etiquetas"));
    assert.ok(verificar("```\nx  =  1\n```\n", "```\nx = 1\n```\n").includes("los bloques de código"));
    assert.ok(verificar("---\na:  1\n---\n", "---\na: 1\n---\n").includes("el frontmatter"));
    assert.ok(verificar("- [ ] a\n", "- [/] a\n").includes("las casillas de tarea"));
    assert.ok(verificar("```\nx  \n```\n", "```\nx\n```\n").length === 0, "los espacios finales en el código se consienten");
    assert.ok(verificar("Respuesta:\n4. uno\n5. dos\n", "Respuesta: 4. uno 5. dos\n").includes("los saltos de línea dentro de los párrafos"));
});

test("no une las líneas de un párrafo que empiezan con número", async () => {
    // Prettier las uniría para que no parezcan lista; en Obsidian el salto se ve, así que el archivo no se toca.
    const r = await formatear("**Respuesta**:\n4. is flying\n5. isn't coming\n");
    assert.ok(r.error && r.error.includes("saltos de línea"), r.error);
    assert.equal(r.texto, "**Respuesta**:\n4. is flying\n5. isn't coming\n");
});

test("si la verificación falla, devuelve el original", async () => {
    // Con MD018 activa, «#Título» pasa a título: la etiqueta desaparece y se acepta porque la regla lo pide;
    // sin MD018, el mismo texto queda igual.
    const r = await formatear("#Título\n", { reglas: { MD018: true } });
    assert.equal(r.texto, "# Título\n");
});

test("revisar lista también lo que no se corrige solo", () => {
    const problemas = revisar("## Sin título principal\n\nTexto con <b>html</b>.\n");
    assert.ok(problemas.some((p) => p.regla === "MD033" && !p.arreglable));
});

test("un $ que no es fórmula no desordena el énfasis", async () => {
    const t = "| *US$ 45*, *$ 45* | *USD* |\n| --- | --- |\n";
    assert.equal(await f(t), "| *US$ 45*, *$ 45* | *USD* |\n| ---------------- | ----- |\n");
    // `*US$* / *$*` es ambiguo también en Obsidian ($* / *$ cumple sus reglas de fórmula): no se toca.
    const ambiguo = "*USD* / *US$* / *$*\n";
    assert.equal((await formatear(ambiguo)).texto, ambiguo);
    assert.equal(await f("Cuesta *US$ 45*, o *$ 45*; y $x_1$ es fórmula.\n"), "Cuesta *US$ 45*, o *$ 45*; y $x_1$ es fórmula.\n");
});

test("la verificación detecta el énfasis descuadrado", () => {
    assert.ok(verificar("*US$ 45*, *$ 45*\n", "*US$ 45_, _$ 45*\n").some((x) => x.startsWith("la cursiva")));
    assert.deepEqual(verificar("*a* y __b__\n", "_a_ y **b**\n"), [], "cambiar el carácter del énfasis no altera lo que se ve");
});

test("formatear dos veces da lo mismo que una", async () => {
    const t = "1.  Pregunta: What is your name?\n    Respuesta: Jhon.\n2.  Otra\n";
    const una = await f(t, { sangriaConTabulador: true, anchoDeTabulador: 4 });
    assert.equal(await f(una, { sangriaConTabulador: true, anchoDeTabulador: 4 }), una);
});
