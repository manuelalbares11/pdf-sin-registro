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
| `pdf.js` 6.1.200 (ESM + worker) | leer el PDF, pintar miniaturas y rasterizar al comprimir | Apache-2.0 |

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

Intenciones cubiertas hoy: unir sin marca de agua, comprimir para enviar por
correo, juntar varios PDF, firmar, reordenar, eliminar páginas, girar páginas y
añadir texto.

---

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

## Publicar

Es un sitio estático: subir el contenido de la carpeta (incluido `.htaccess`)
a la raíz del hosting. Excluir `tools/`, `templates/` y `data/`, que son de
desarrollo. Al desplegar, subir el número de `version` en `data/landings.json`
y regenerar: ese valor alimenta el `?v=` de los assets y el `lastmod` del
sitemap.
