#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
construir-demo.py — empaqueta la pagina principal en UN solo archivo HTML.

Sirve para publicar una demo con enlace temporal (Artifacts de Claude, un
gist, un pen...) donde no se pueden subir los .js vendorizados. La web de
verdad, la que se sube al hosting, NO usa este archivo: alli las librerias
van en lib/vendor/ y no se toca ningun CDN en tiempo de ejecucion.

    python3 tools/construir-demo.py [salida.html]
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "demo-una-pagina.html")

PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.1.200/build/pdf.min.mjs"
PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.1.200/build/pdf.worker.min.mjs"
PDFLIB = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"
REPO = "https://github.com/manuelalbares11/pdf-sin-registro"


def leer(*partes):
    with open(os.path.join(ROOT, *partes), encoding="utf-8") as fh:
        return fh.read()


html = leer("index.html")
css = leer("styles.css")
manifest = leer("lib", "manifest.js")
main = leer("main.js")
shim = leer("lib", "vendor", "pdfjs", "compat.mjs")

# --- 1. el motor viene del CDN en lugar de lib/vendor ---
viejo = '''    return import("./lib/vendor/pdfjs/compat.mjs").then(function () {
      return import("./lib/vendor/pdfjs/pdf.min.mjs");
    }).then(function (mod) {
      // El worker es otro contexto JS: arranca por worker-boot.mjs, que
      // instala el mismo shim antes de cargar el worker vendorizado.
      mod.GlobalWorkerOptions.workerSrc = "lib/vendor/pdfjs/worker-boot.mjs";
      pdfjsLib = mod;
      return mod;
    });'''
nuevo = '''    // Demo de una sola pagina: el motor se pide al CDN. El shim de
    // compatibilidad ya esta instalado mas arriba, en este mismo hilo; el
    // worker es de otro origen, asi que pdf.js caera solo a su modo sin
    // worker (mas lento, mismo resultado).
    return import("%s").then(function (mod) {
      try { mod.GlobalWorkerOptions.workerSrc = "%s"; } catch (e) { }
      pdfjsLib = mod;
      return mod;
    });''' % (PDFJS, PDFJS_WORKER)
assert viejo in main, "no encontrado el bloque getPdfjs"
main = main.replace(viejo, nuevo)
main = main.replace('loadScript("lib/vendor/pdf-lib.min.js")', 'loadScript("%s")' % PDFLIB)
assert PDFLIB in main, "no encontrada la carga de pdf-lib"

# --- 1b. la descarga pasa por la capacidad del visor de Artifacts ---
# El visor no deja que una pagina se descargue un archivo por su cuenta:
# hay que ofrecerlo con claude.use("downloads"). En el sitio real, en un
# hosting normal, el enlace de siempre funciona, asi que se conserva como
# alternativa.
viejo_save = '''  function saveBlob(blob, name) {
    var a = document.createElement("a");'''
nuevo_save = '''  function saveBlob(blob, name) {
    if (window.claude && typeof window.claude.use === "function") {
      window.claude.use("downloads").then(function (dl) {
        if (!dl) return anchorSave(blob, name);
        return dl.save({ filename: name, data: blob })["catch"](function (err) {
          if (err && err.code === "declined") return;      // el visor dijo que no
          anchorSave(blob, name);
        });
      })["catch"](function () { anchorSave(blob, name); });
      return;
    }
    anchorSave(blob, name);
  }
  function anchorSave(blob, name) {
    var a = document.createElement("a");'''
assert viejo_save in main, "no encontrado saveBlob"
main = main.replace(viejo_save, nuevo_save, 1)

# sin descarga automatica: el visor solo admite un aviso a la vez, y el
# boton grande del resultado ya es la accion explicita del usuario.
viejo_auto = '''    setTimeout(function () { safe(function () { saveBlob(blob, name); }, "autoDownload"); }, 60);'''
assert viejo_auto in main, "no encontrada la descarga automatica"
main = main.replace(viejo_auto, "")

# --- 2. quedarse con el contenido del <body> ---
cuerpo = re.search(r"<body[^>]*>(.*)</body>", html, re.S).group(1)
cuerpo = re.sub(r'<script defer src="(lib/manifest\.js|main\.js)[^"]*"></script>\s*', "", cuerpo)

# --- 3. la demo es una sola pagina: sin enlaces a paginas que no existen ---
# la marca deja de ser enlace: en la demo no hay a donde ir
cuerpo = cuerpo.replace('<a class="brand" href="index.html">', '<span class="brand">')
cuerpo = re.sub(r'(<span class="brand">.*?)</a>', r'\1</span>', cuerpo, count=1, flags=re.S)
cuerpo = re.sub(
    r'<nav class="nav">.*?</nav>',
    '<nav class="nav"><a href="%s" target="_blank" rel="noopener">Código y sitio completo</a></nav>' % REPO,
    cuerpo, count=1, flags=re.S)
cuerpo = re.sub(
    r'<div class="tools-grid">.*?</div>\s*</section>',
    '<div class="tools-grid"><a class="tool-link" href="%s" target="_blank" rel="noopener">'
    '<b>El sitio completo</b><span>Esta demo es una sola página. El sitio real son nueve, '
    'generadas desde datos, cada una con esta misma herramienta dentro.</span></a></div>\n    </section>' % REPO,
    cuerpo, count=1, flags=re.S)
cuerpo = re.sub(r"<footer.*?</footer>", '''<footer class="site-footer">
  <div class="wrap">
    <span>&copy; <span data-year>2026</span> PDF sin Registro — demostración</span>
    <p class="creds">Las páginas se procesan con pdf-lib 1.17.1 (MIT) y pdf.js 6.1.200 (Apache-2.0)
    dentro de tu navegador. Ningún archivo se envía a un servidor.</p>
  </div>
</footer>''', cuerpo, count=1, flags=re.S)

salida = """<title>PDF sin Registro</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<style>
%s
</style>
%s
<script>
/* --- compatibilidad (mismo shim que lib/vendor/pdfjs/compat.mjs) --- */
%s
</script>
<script>
%s
</script>
<script>
%s
</script>
""" % (css, cuerpo.strip(), shim, manifest, main)

salida = salida.replace("\r\n", "\n").replace("\x00", "")
with open(SALIDA, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(salida)
print("Demo de una pagina: %s (%d KB)" % (SALIDA, len(salida) // 1024))
