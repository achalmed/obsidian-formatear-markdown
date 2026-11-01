# Formatear Markdown

Complemento de Obsidian que **formatea y corrige** notas Markdown como lo hace un editor de código (VS Code, Positron)
con Prettier, más las correcciones de [markdownlint](https://github.com/DavidAnson/markdownlint), **sin romper la
sintaxis de Obsidian**: `[[enlaces|alias]]`, `![[incrustaciones]]`, `#etiquetas`, callouts, `==resaltado==`,
`%%comentarios%%`, `$fórmulas$`, campos de Dataview y plantillas.

## Qué hace

| corrige (markdownlint) | formatea (Prettier) |
|---|---|
| `** negrita **` y `* cursiva *` con espacios dentro | tablas con las columnas alineadas (o compactas si no caben) |
| marcadores de lista mezclados (`*`, `+`, `-`) | sangría uniforme de listas y sublistas |
| varias líneas en blanco seguidas, espacios al final | una línea en blanco entre bloques |
| títulos, listas, tablas y código sin línea en blanco alrededor | `1.  ` → `1. `, numeración de listas |
| `#  Título`, `>  cita`, `-   elemento` con espacios de más | un salto de línea al final del archivo |

Cada regla de markdownlint se activa o se apaga en los ajustes. `MD018` («#Título» → «# Título») viene apagada porque
convertiría en título una `#etiqueta` al inicio de línea.

## Cómo se usa

| | |
|---|---|
| **Formatear el documento** | `Mayús+Alt+F` (como en VS Code y Positron), o el menú del editor |
| **Formatear al guardar** | al pulsar `Ctrl+S`; el autoguardado de Obsidian no formatea (se apaga en los ajustes) |
| **Revisar el documento** | lista los problemas de markdownlint, también los que no se corrigen solos, y salta a la línea |
| **Formatear una carpeta o el vault** | clic derecho en una carpeta, o la orden «Formatear todos los archivos del vault…»: **primero simula** y dice qué archivos cambiarían y cuáles no se tocarán; aplica solo si se confirma |

## Red de seguridad

Después de formatear, el complemento compara el antes y el después. Si cambió algo que el formato nunca debe tocar,
**el archivo no se modifica** y se dice qué se habría roto:

- las palabras y su orden;
- los enlaces, incrustaciones, etiquetas, resaltados, comentarios, fórmulas, callouts, casillas de tarea, notas al pie
  y campos de Dataview;
- el contenido de los bloques de código (salvo los espacios al final de línea) y el frontmatter;
- los saltos de línea dentro de los párrafos, que en Obsidian se ven: Prettier une a veces dos líneas, por ejemplo
  «texto» seguido de «4. algo», para que no parezca una lista.

Las plantillas (Templater `<% %>`, Nunjucks `{% %}` y `{{ variable }}` como las de Zotero Integration) se omiten por
defecto.

Probado sobre 619 notas reales antes de publicar: 417 se formatean, 145 ya estaban en orden, 38 plantillas se omiten
y 19 (3 %) quedan sin tocar por la red de seguridad: texto pegado de PDF con fórmulas armadas a espacios, una fórmula
dentro de un elemento de lista vacío, líneas de párrafo que empiezan con un número.

## Ajustes

- Formatear al guardar · omitir plantillas · carpetas ignoradas.
- Prettier sí o no · líneas de los párrafos (dejarlas, unir cada párrafo, cortar en el ancho) · ancho de línea ·
  tablas (alinear si caben, alinear siempre, compactas) · cursiva `*` o `_` · sangría como el editor de Obsidian
  (tabulador y ancho) · formatear también el frontmatter.
- Cada regla de corrección de markdownlint.

## Instalar

Desde una versión publicada: copia `main.js`, `manifest.json` y `styles.css` de la
[última versión](https://github.com/achalmed/obsidian-formatear-markdown/releases/latest) a
`<vault>/.obsidian/plugins/formatear-markdown/`, o instálalo con
[BRAT](https://github.com/TfTHacker/obsidian42-brat) dando `achalmed/obsidian-formatear-markdown`. Después:
Ajustes → Complementos de la comunidad → activar «Formatear Markdown».

Desde este repo:

```bash
npm install
npm run build                              # main.js
./instalar.sh <ruta-del-vault>             # simula
./instalar.sh <ruta-del-vault> --aplicar   # copia a <vault>/.obsidian/plugins/formatear-markdown/
```

## Desarrollar y probar

```bash
npm test                                          # el núcleo (src/formatear.js), sin Obsidian
npm run dev                                       # recompila al guardar
node herramientas/simular.mjs <carpeta>... --omitir-plantillas   # formatea en memoria y dice qué pasaría; no escribe
```

`src/formatear.js` es el núcleo (texto de entrada, texto de salida); `src/main.js`, el complemento.

## Licencia

MIT. Incluye [Prettier](https://prettier.io) y [markdownlint](https://github.com/DavidAnson/markdownlint), ambos MIT.
