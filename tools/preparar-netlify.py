#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
preparar-netlify.py — deja la web lista para publicar en Netlify.

    python3 tools/preparar-netlify.py
    python3 tools/preparar-netlify.py --dominio https://midominio.com
    python3 tools/preparar-netlify.py --sin-zip

Que hace, en orden:
  1. Si le pasas --dominio, lo guarda en data/landings.json (de ahi salen las
     etiquetas canonical, las Open Graph y el sitemap: tienen que coincidir
     con el dominio real o el SEO se resiente).
  2. Regenera las 16 landings, las 3 paginas legales, la 404, el sitemap y el
     robots.txt.
  3. Copia a dist/ SOLO lo que se sirve. Fuera quedan tools/, templates/,
     data/, el README y el .htaccess (que es de Apache y en Netlify no hace
     nada).
  4. Escribe dist/_headers y dist/_redirects, que es como se configuran las
     cabeceras en Netlify.
  5. Comprime dist/ en pdf-sin-registro-netlify.zip, con los archivos en la
     RAIZ del zip (Netlify Drop necesita encontrar index.html arriba del todo).

La carpeta que se arrastra a Netlify es dist/.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
ZIP = os.path.join(ROOT, "pdf-sin-registro-netlify.zip")
DATA = os.path.join(ROOT, "data", "landings.json")

# Lo unico que se publica. Todo lo demas es material de desarrollo.
ARCHIVOS_SUELTOS = ["styles.css", "main.js", "sitemap.xml", "robots.txt", "ads.txt"]
CARPETAS = ["lib", "assets"]

HEADERS = """# Cabeceras HTTP para Netlify. Sustituyen al .htaccess de Apache, que
# Netlify ignora por completo. Se aplican de arriba abajo y para una misma
# cabecera gana la regla mas concreta.

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: camera=(), microphone=(), geolocation=()

# El HTML se revalida siempre: al publicar una version nueva, se ve al momento.
/*.html
  Cache-Control: public, max-age=0, must-revalidate
/
  Cache-Control: public, max-age=0, must-revalidate

# El codigo del sitio lleva ?v= en la URL, asi que se puede cachear un dia.
/styles.css
  Cache-Control: public, max-age=86400, must-revalidate
/main.js
  Cache-Control: public, max-age=86400, must-revalidate

# Las librerias estan fijadas a una version concreta: nunca cambian.
/lib/*
  Cache-Control: public, max-age=31536000, immutable

/assets/*
  Cache-Control: public, max-age=2592000

# ---------------------------------------------------------------------------
# PUBLICIDAD: por que estas cabeceras no rompen AdSense
# ---------------------------------------------------------------------------
# Los anuncios se cargan en iframes de otro dominio. Lo que los rompe no es
# lo que hay aqui, sino lo que NO debe anadirse nunca:
#
#   - Cross-Origin-Embedder-Policy / Cross-Origin-Opener-Policy (COOP/COEP).
#     Aislan la pagina y matan los iframes de terceros. No estan, y no deben
#     estar. Es tambien la razon de usar el motor de un solo hilo.
#
#   - Content-Security-Policy. Aqui no hay ninguna, y esta bien asi: una CSP
#     que no liste googlesyndication.com, doubleclick.net y googletagservices.com
#     deja los anuncios en blanco sin dar ningun error visible.
#
#   - Cross-Origin-Resource-Policy: same-origin. Bloquea recursos de terceros.
#
# Lo que si hay, y por que es inofensivo:
#
#   - X-Frame-Options: SAMEORIGIN controla quien puede meter TU pagina dentro
#     de un iframe suyo. No tiene nada que ver con los iframes que tu pagina
#     incrusta, asi que no afecta a los anuncios. Te protege del clickjacking.
#
#   - Permissions-Policy solo bloquea camara, microfono y ubicacion, que ni la
#     herramienta ni los anuncios usan. Las funciones de Privacy Sandbox que si
#     usa AdSense (browsing-topics, attribution-reporting) NO estan en la lista,
#     asi que conservan su valor por defecto, que es permisivo. Si algun dia
#     anades funciones a esta linea, no toques esas dos.
# ---------------------------------------------------------------------------
"""

REDIRECTS = """# Redirecciones de Netlify.
#
# La web no necesita ninguna: son 20 paginas estaticas y los enlaces internos
# apuntan al archivo .html real. Este archivo existe para dejarlo dicho y para
# que tengas donde escribirlas cuando cambies alguna URL.
#
# Ejemplo, si algun dia renombras una landing (301 = permanente, avisa a Google
# de que la buena es la nueva y le pasa el posicionamiento):
#
#   /nombre-viejo.html   /nombre-nuevo.html   301
"""


def sh(cmd):
    r = subprocess.run(cmd, cwd=ROOT)
    if r.returncode != 0:
        sys.exit(r.returncode)


def poner_dominio(dominio):
    dominio = dominio.strip().rstrip("/")
    if not dominio.startswith("http"):
        dominio = "https://" + dominio
    with open(DATA, encoding="utf-8") as fh:
        datos = json.load(fh)
    anterior = datos.get("dominio", "")
    datos["dominio"] = dominio
    with open(DATA, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(datos, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print("Dominio: %s  ->  %s" % (anterior, dominio))
    return dominio


def copiar():
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)

    n = 0
    for f in sorted(os.listdir(ROOT)):
        if f.endswith(".html"):
            shutil.copy2(os.path.join(ROOT, f), os.path.join(DIST, f))
            n += 1
    for f in ARCHIVOS_SUELTOS:
        origen = os.path.join(ROOT, f)
        if os.path.exists(origen):
            shutil.copy2(origen, os.path.join(DIST, f))
            n += 1
    for d in CARPETAS:
        origen = os.path.join(ROOT, d)
        if os.path.isdir(origen):
            shutil.copytree(origen, os.path.join(DIST, d))
            n += sum(len(fs) for _, _, fs in os.walk(origen))

    with open(os.path.join(DIST, "_headers"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEADERS)
    with open(os.path.join(DIST, "_redirects"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(REDIRECTS)
    return n + 2


def comprimir():
    if os.path.exists(ZIP):
        os.remove(ZIP)
    n = 0
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for carpeta, _, archivos in os.walk(DIST):
            for a in sorted(archivos):
                ruta = os.path.join(carpeta, a)
                # ruta RELATIVA a dist/: index.html queda en la raiz del zip
                z.write(ruta, os.path.relpath(ruta, DIST))
                n += 1
    return n


def revisar(dominio):
    """Comprobaciones que evitan publicar algo roto."""
    problemas = []
    if not os.path.exists(os.path.join(DIST, "index.html")):
        problemas.append("no hay index.html en la raiz de dist/")

    # el dominio de las canonical tiene que ser el real
    with open(os.path.join(DIST, "index.html"), encoding="utf-8") as fh:
        idx = fh.read()
    if dominio.rstrip("/") not in idx:
        problemas.append("index.html no apunta a %s en su canonical" % dominio)

    # enlaces internos que no existan
    faltan = set()
    for f in os.listdir(DIST):
        if not f.endswith(".html"):
            continue
        with open(os.path.join(DIST, f), encoding="utf-8") as fh:
            for destino in re.findall(r'href="([^":]+\.html)"', fh.read()):
                if not os.path.exists(os.path.join(DIST, destino)):
                    faltan.add(destino)
    if faltan:
        problemas.append("enlaces a paginas que no existen: " + ", ".join(sorted(faltan)))

    # datos del titular sin rellenar en las paginas legales
    pendientes = set()
    for f in ("aviso-legal.html", "privacidad.html", "cookies.html"):
        ruta = os.path.join(DIST, f)
        if os.path.exists(ruta):
            with open(ruta, encoding="utf-8") as fh:
                pendientes.update(re.findall(r"\[[A-ZÁÉÍÓÚÑ][^\]]{3,}\]", fh.read()))
    return problemas, sorted(pendientes)


def main():
    args = sys.argv[1:]
    if "--dominio" in args:
        dominio = poner_dominio(args[args.index("--dominio") + 1])
    else:
        with open(DATA, encoding="utf-8") as fh:
            dominio = json.load(fh)["dominio"].rstrip("/")

    print("\nGenerando paginas…")
    sh([sys.executable, os.path.join("tools", "generar-landings.py")])

    print("\nPreparando dist/…")
    n = copiar()
    print("  %d archivos copiados a dist/" % n)

    problemas, pendientes = revisar(dominio)

    if "--sin-zip" not in args:
        nz = comprimir()
        mb = os.path.getsize(ZIP) / 1048576.0
        print("  %s  (%d archivos, %.1f MB)" % (os.path.basename(ZIP), nz, mb))

    print("\n" + "=" * 62)
    if problemas:
        print("HAY QUE ARREGLAR ESTO ANTES DE PUBLICAR:")
        for x in problemas:
            print("  - " + x)
    else:
        print("dist/ listo. Arrastra ESA carpeta a Netlify.")
    print("Dominio configurado: " + dominio)
    if pendientes:
        print("\nDatos del titular sin rellenar en data/legales.json")
        print("(la web funciona, pero AdSense exige paginas legales completas):")
        for x in pendientes:
            print("  - " + x)
    print("=" * 62)
    return 1 if problemas else 0


if __name__ == "__main__":
    sys.exit(main())
