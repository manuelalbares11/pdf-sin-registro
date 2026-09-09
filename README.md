# PDF sin Registro

Herramienta web para **unir, comprimir, reorganizar, girar, firmar y anotar PDF**
con una regla de diseño innegociable: **los archivos nunca salen del navegador**.

No hay servidor que procese documentos, no hay registro, no hay marca de agua y
no hay muro de pago al final. La descarga es directa y a calidad original.

---

## Cómo funciona por dentro

Todo el procesamiento ocurre en el cliente:

| Pieza | Para qué | Licencia |
|---|---|---|
| `pdf-lib` 1.17.1 (UMD) | montar el PDF final: copiar páginas, girar, incrustar texto y firmas | MIT |
| `pdf.js` 6.1.200 (ESM + worker) | leer el PDF, pintar miniaturas y rasterizar al comprimir o convertir a imagen | Apache-2.0 |
| `JSZip` 3.10.1 (UMD) | empaquetar varios archivos de salida (dividir, PDF a imagen) | MIT |

Ambas están **vendorizadas** en `lib/vendor/` y se sirven desde el propio
dominio: la web no depende de ningún CDN en tiempo de ejecución, y no hace
ninguna petición de red con el contenido de tus documentos.

- El esqueleto es HTML + CSS + JavaScript clásico (`<script defer>` + IIFE).
  Sin build, sin npm, sin framework: se publica copiando la carpeta.
- `pdf.js` es ESM y se carga con `import()` dinámico desde un script clásico
  (el "puente ESM"), sólo cuando el usuario suelta el primer archivo.
- `lib/vendor/pdfjs/compat.mjs` añade `Map.prototype.getOrInsert(Computed)`,
  que pdf.js 6.1.200 da por hecho y que muchos navegadores todavía no tienen.
  Se instala también dentro del worker vía `worker-boot.mjs`.
- `lib/vendor/pdfjs/{wasm,standard_fonts,cmaps,iccs}` son recursos que pdf.js
  pide **solo si el documento concreto los necesita**: descomprimir JBIG2
  (el formato de casi todo escaneado en blanco y negro) y JPEG2000, las
  tipografías estándar no incrustadas y los mapas de caracteres CJK. Sin
  ellos, un escaneado normal se rasteriza en blanco — justo el caso principal
  de la herramienta. No pesan en la carga inicial: nunca se piden de entrada.

### Una sola tubería para siete modos

Todo pasa por el mismo sitio: la rejilla de páginas se **monta** en un PDF con
`pdf-lib` y después se **post-procesa** según el modo.

```
páginas (de PDF o de imagen) → montar → ┬─ tal cual        → PDF
                                        ├─ rasterizar      → PDF comprimido
                                        ├─ cortar          → varios PDF → ZIP
                                        └─ pintar páginas  → JPG/PNG    → ZIP
```

Una imagen suelta es una página más: se le asigna tamaño de página (A4 con
margen, o el tamaño real a 96 ppp) y se incrusta sin recomprimir si es JPG o
PNG. Por eso se pueden mezclar fotos y PDF en el mismo documento, y por eso
girar, reordenar, firmar o dividir funcionan igual con unas y otros. Convertir
imágenes a PDF ni siquiera descarga `pdf.js`.

### La compresión, sin marketing

`pdf-lib` no recomprime flujos internos. La compresión real que funciona es
rasterizar: cada página se pinta con pdf.js a los ppp elegidos y se vuelve a
incrustar como JPEG. Eso hunde el peso de los escaneados y **destruye el texto
seleccionable**. Por eso la herramienta muestrea la capa de texto del documento
y avisa antes de exportar en lugar de rasterizar en silencio.

---

## SEO programático

Las páginas del sitio **no se escriben a mano**: se generan a partir de datos.

```
data/landings.json            ← el conjunto de datos (una entrada = una landing)
templates/landing.template.html  ← la plantilla única (herramienta + SEO + anuncios)
tools/generar-landings.py     ← el generador
```

```bash
python3 tools/generar-landings.py --check   # valida los datos
python3 tools/generar-landings.py           # genera las páginas + sitemap + robots
```

Cada entrada del JSON produce una página completa y autónoma con su `<title>`,
meta description, H1, texto propio, FAQ, `canonical`, Open Graph y tres bloques
de datos estructurados (`WebApplication`, `FAQPage`, `BreadcrumbList`), **con la
herramienta funcionando dentro** y con el modo correcto ya seleccionado
(`?modo=` / `data-modo`). Añadir una intención de búsqueda nueva —por ejemplo
`"comprimir pdf a 100 kb"`— es añadir un objeto al array `paginas`: no se toca
HTML.

El generador valida antes de escribir (slug único, modo válido, meta ≤ 160
caracteres, mínimo 4 preguntas) y avisa de marcadores sin sustituir.

Para conectar una base de datos real basta con que vuelque ese mismo JSON
(o que el script lea una tabla) y volver a ejecutarlo: la estructura, el
enlazado interno y el sitemap se rehacen solos.

Intenciones cubiertas hoy (16 páginas): editar, unir sin marca de agua, juntar
varios PDF, unir PDF pesados, dividir en páginas separadas, comprimir para
correo, comprimir sin perder calidad, firmar, añadir texto, JPG a PDF, PDF a
JPG, reordenar, extraer páginas, eliminar páginas y girar páginas.

---

## Páginas legales

También se generan desde datos, con el mismo comando:

```
data/legales.json              ← datos del titular + texto de las tres páginas
templates/legal.template.html  ← la carcasa compartida
```

Sólo hay que rellenar el bloque `titular` de `data/legales.json` (nombre o
razón social, NIF, domicilio, correo, alojamiento, red publicitaria y ciudad
de jurisdicción) y volver a ejecutar el generador: produce `aviso-legal.html`,
`privacidad.html` y `cookies.html`. Los huecos pendientes van entre corchetes
(`[NIF o CIF]`) y **el generador avisa por consola de los que queden sin
rellenar**. Las tres páginas son `noindex` y quedan fuera del sitemap a
propósito.

Los textos están redactados para esta web en concreto —LSSI art. 10, RGPD y
LOPDGDD, art. 22.2 LSSI para cookies— con el punto central de que los
documentos no se transmiten ni se tratan. No son asesoramiento jurídico:
conviene que los revise un profesional antes de publicar.

## Publicidad

Sólo hay **dos huecos**, marcados y vacíos:

1. Banner horizontal pequeño **justo debajo del panel de edición**.
2. Bloque nativo **en mitad del texto explicativo** inferior.

Ambos con `min-height` reservado (sin saltos de maquetación) y un comentario
`<!-- PEGA AQUÍ TU CÓDIGO DE ADSENSE -->`. **No hay pop-ups, ni intersticiales,
ni nada que tape la zona de descarga**, por decisión de diseño: ese tipo de
formato penaliza en Google y arruina la conversión de una herramienta.

La web no carga ningún script de terceros. Antes de activar AdSense hay que
pegar un CMP de cookies en el `<head>` (hay un TODO marcado en la plantilla) y
completar los datos del titular en `privacidad.html` y `aviso-legal.html`.

**`ads.txt`.** Google exige este archivo para comprobar que los anuncios de tu
dominio los vendes tú. Sin él acaba limitando los ingresos. Pon tu ID de editor
en `data/legales.json`:

```json
"adsense": { "publisherId": "pub-0000000000000000" }
```

y el generador escribe `ads.txt` en la raíz. Con el campo vacío no se genera
nada, a propósito: un `ads.txt` con un ID inventado es peor que no tenerlo,
porque le dice a Google que tu dominio autoriza a un tercero que no existe.

### Qué no añadir nunca a las cabeceras

`dist/_headers` lleva escrito el porqué, para que no se rompa por accidente
dentro de seis meses: nada de COOP/COEP, nada de `Content-Security-Policy` que
no liste los dominios de Google, nada de `Cross-Origin-Resource-Policy:
same-origin`. Cualquiera de las tres deja los anuncios en blanco **sin dar
ningún error visible**, que es la peor forma de romperse.

> Nota técnica: no se usan cabeceras COOP/COEP en `.htaccess` a propósito.
> Habilitarían `SharedArrayBuffer`, pero rompen los iframes de terceros —
> es decir, romperían AdSense.

---

## Estructura

```
index.html + 8 landings     ← generadas desde data/landings.json
styles.css                  ← hoja única
main.js                     ← motor de la herramienta (IIFE)
lib/manifest.js             ← datos de marca y límites
lib/vendor/                 ← pdf-lib, pdf.js y su worker (mismo origen)
data/landings.json          ← el conjunto de datos del SEO programático
templates/                  ← plantilla de página
tools/                      ← scripts de desarrollo (NO se publican)
assets/                     ← favicon e imagen Open Graph
privacidad.html · aviso-legal.html · cookies.html
sitemap.xml · robots.txt · .htaccess
```

## Desarrollo

```bash
python3 -m http.server 8137 --bind 127.0.0.1   # obligatorio: file:// no vale
```

Los motores usan `import()` dinámico y un worker, y ambos exigen `http://`.

Pruebas de extremo a extremo (Chromium real, camino feliz completo y sondas
sobre el PDF exportado) en `tools/pruebas/` — ver su README.

## Demo de una sola página

```bash
python3 tools/construir-demo.py demo.html
```

Empaqueta la página principal en un único HTML (CSS y JS embebidos, las
librerías desde CDN) para publicarla donde no se pueden subir archivos
sueltos. Es sólo para demos: **la web real no usa ese archivo** y no toca
ningún CDN en tiempo de ejecución.

## Publicar en Netlify

```bash
python3 tools/preparar-netlify.py --dominio https://tudominio.com
```

Un solo comando: guarda el dominio, regenera todas las páginas, deja en
`dist/` **solo lo que se sirve** y comprime esa carpeta en
`pdf-sin-registro-netlify.zip` con los archivos en la raíz del ZIP.

**La carpeta que se arrastra a Netlify es `dist/`.** Es la única que contiene
`index.html` en su raíz. Fuera quedan `tools/`, `templates/`, `data/`, el
README y el `.htaccess` (que es de Apache: Netlify lo ignora).

El script no solo copia, también revisa antes de dejarte publicar:

- que exista `index.html` en la raíz de `dist/`;
- que las etiquetas `canonical` apunten al dominio configurado, no a otro;
- que ningún enlace interno lleve a una página que no existe;
- qué datos del titular siguen sin rellenar en las páginas legales.

### El dominio importa

Las etiquetas `canonical`, las Open Graph y el `sitemap.xml` llevan el dominio
escrito dentro. Si compras el `.com` después de haber publicado, vuelve a
ejecutar el script con `--dominio` y sube otra vez: si no, le estarás diciendo
a Google que la versión buena de cada página está en otra dirección.

### Cabeceras

`.htaccess` no funciona en Netlify. Su equivalente son `dist/_headers` y
`dist/_redirects`, que el script escribe dentro de la carpeta publicada: HTML
siempre revalidado (al publicar una versión nueva se ve al momento), `lib/`
cacheado un año (son versiones fijas que nunca cambian) y las cabeceras de
seguridad. Sigue sin haber COOP/COEP, por lo mismo de siempre: romperían
AdSense.

En los ajustes de Netlify, deja **Pretty URLs desactivado** (Asset
optimization). Si se activa, Netlify redirige `/pagina.html` a `/pagina` y las
`canonical` dejarían de coincidir con la URL servida.

### Desde Git, si lo prefieres

`netlify.toml` en la raíz ya está listo: `command = python3
tools/preparar-netlify.py --sin-zip`, `publish = dist`. Conectas el
repositorio y cada push regenera y despliega. No hay dependencias que
instalar: el generador es Python de la biblioteca estándar.

## Publicar en un hosting Apache

Es un sitio estático: subir el contenido de la carpeta (incluido `.htaccess`)
a la raíz del hosting. Excluir `tools/`, `templates/` y `data/`, que son de
desarrollo. Al desplegar, subir el número de `version` en `data/landings.json`
y regenerar: ese valor alimenta el `?v=` de los assets y el `lastmod` del
sitemap.
