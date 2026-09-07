#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generar-landings.py — SEO programatico para PDF sin Registro.

Lee un conjunto de datos (data/landings.json) y una plantilla
(templates/landing.template.html) y genera una pagina HTML completa y
autonoma por cada intencion de busqueda, mas el sitemap y el robots.txt.

    python3 tools/generar-landings.py            # genera todo
    python3 tools/generar-landings.py --check    # solo valida los datos

Anadir una landing nueva = anadir un objeto al array "paginas". No hay que
tocar HTML: la herramienta, el diseno, los huecos de anuncio y el marcado
de datos estructurados se replican solos en cada pagina generada.

Campos obligatorios por pagina:
    slug, nav, corto, modo, title, h1, sub, meta, resumen,
    introA, introB, faq[{q,a}]
Campos opcionales:
    casos[{icono,titulo,texto}]  -> si falta, usa los casos globales
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "landings.json")
TPL = os.path.join(ROOT, "templates", "landing.template.html")
DATA_LEGAL = os.path.join(ROOT, "data", "legales.json")
TPL_LEGAL = os.path.join(ROOT, "templates", "legal.template.html")

MODOS = ("organizar", "unir", "dividir", "comprimir", "firmar",
         "imagen-a-pdf", "pdf-a-imagen")
OBLIGATORIOS = ("slug", "nav", "corto", "modo", "title", "h1", "sub",
                "meta", "resumen", "introA", "introB", "faq")

# Iconos en linea (sin fuentes de iconos, sin CDN externos)
ICONOS = {
    "contrato": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 17c1.5-3 3-3 4.5 0 1 2 2 1.5 2.5.5"/></svg>',
    "factura": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3v18l2.5-1.6L10 21l2-1.6L14 21l2.5-1.6L19 21V3H5Z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h3"/></svg>',
    "dni": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5 16c.9-1.6 2-2.4 3.5-2.4S11.1 14.4 12 16"/><path d="M15 10h4"/><path d="M15 14h4"/></svg>',
}
ICONO_POR_DEFECTO = ICONOS["contrato"]


def leer(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def escribir(path, texto):
    # UTF-8, sin BOM, sin NUL, con saltos LF (invariante del stack)
    texto = texto.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(texto)


def esc_attr(s):
    return (str(s).replace("&", "&amp;").replace('"', "&quot;")
            .replace("<", "&lt;").replace(">", "&gt;"))


def sin_html(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", str(s))).strip()


def validar(datos):
    errores = []
    slugs = set()
    for i, p in enumerate(datos.get("paginas", [])):
        etiqueta = p.get("slug") or ("#%d" % i)
        for campo in OBLIGATORIOS:
            if not p.get(campo):
                errores.append("%s: falta '%s'" % (etiqueta, campo))
        if p.get("slug") in slugs:
            errores.append("%s: slug duplicado" % etiqueta)
        slugs.add(p.get("slug"))
        if p.get("modo") not in MODOS:
            errores.append("%s: modo '%s' no valido (%s)" % (etiqueta, p.get("modo"), "/".join(MODOS)))
        if len(p.get("meta", "")) > 160:
            errores.append("%s: meta description de %d caracteres (max 160)" % (etiqueta, len(p["meta"])))
        if len(p.get("faq", [])) < 4:
            errores.append("%s: menos de 4 preguntas frecuentes" % etiqueta)
    if "index" not in slugs:
        errores.append("falta la pagina 'index'")
    return errores


def url_de(slug, dominio):
    return dominio.rstrip("/") + ("/" if slug == "index" else "/" + slug + ".html")


def archivo_de(slug):
    return "index.html" if slug == "index" else slug + ".html"


def bloque_nav(paginas, actual, maximo=5):
    partes = []
    for p in paginas[:maximo]:
        cur = ' aria-current="page"' if p["slug"] == actual else ""
        partes.append('<a href="%s"%s>%s</a>' % (archivo_de(p["slug"]), cur, esc_attr(p["nav"])))
    return "\n      ".join(partes)


def bloque_relacionadas(paginas, actual, maximo=6):
    partes = []
    for p in paginas:
        if p["slug"] == actual:
            continue
        partes.append(
            '<a class="tool-link" href="%s"><b>%s</b><span>%s</span></a>'
            % (archivo_de(p["slug"]), esc_attr(p["corto"]), esc_attr(p["resumen"]))
        )
        if len(partes) >= maximo:
            break
    return "\n        ".join(partes)


def bloque_casos(casos):
    partes = []
    for c in casos:
        partes.append(
            '<article class="case">%s<h3>%s</h3><p>%s</p></article>'
            % (ICONOS.get(c.get("icono"), ICONO_POR_DEFECTO), esc_attr(c["titulo"]), c["texto"])
        )
    return "\n        ".join(partes)


def bloque_faq(faq):
    partes = []
    for f in faq:
        partes.append(
            "<details><summary>%s</summary><div><p>%s</p></div></details>"
            % (esc_attr(f["q"]), f["a"])
        )
    return "\n        ".join(partes)


def jsonld(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))



def generar_legales(marca, dominio, version):
    """Genera aviso-legal.html, privacidad.html y cookies.html sustituyendo
    los datos del titular. Solo hay que rellenar 'titular' en
    data/legales.json: el texto vive en ese mismo archivo."""
    datos = json.loads(leer(DATA_LEGAL))
    t = datos["titular"]

    registro = t.get("registro", "").strip()
    linea_registro = ("<li><strong>Datos registrales:</strong> %s</li>" % esc_attr(registro)) if registro else ""

    campos = {
        "{{BRAND}}": marca,
        "{{T_NOMBRE}}": t["nombre"],
        "{{T_NIF}}": t["nif"],
        "{{T_DIRECCION}}": t["direccion"],
        "{{T_EMAIL}}": t["email"],
        "{{T_DOMINIO}}": dominio,
        "{{T_REGISTRO_LINEA}}": linea_registro,
        "{{T_HOSTING}}": t["hosting"],
        "{{T_HOSTING_UBICACION}}": t["hostingUbicacion"],
        "{{T_PUBLICIDAD}}": t["publicidad"],
        "{{T_JURISDICCION}}": t["jurisdiccion"],
    }

    tpl = leer(TPL_LEGAL)
    pendientes = set()
    for p in datos["paginas"]:
        cuerpo = p["cuerpo"]
        meta = p["meta"]
        for k, v in campos.items():
            cuerpo = cuerpo.replace(k, v)
            meta = meta.replace(k, v)
        html = tpl
        for k, v in {
            "{{BRAND}}": esc_attr(marca),
            "{{VER}}": version,
            "{{TITLE}}": esc_attr(p["title"]),
            "{{H1}}": esc_attr(p["h1"]),
            "{{META}}": esc_attr(meta),
            "{{CANONICAL}}": dominio + "/" + p["slug"] + ".html",
            "{{FECHA}}": esc_attr(datos.get("fecha", "")),
            "{{CUERPO}}": cuerpo,
        }.items():
            html = html.replace(k, v)

        pendientes.update(re.findall(r"\[[A-ZÁÉÍÓÚÑ][^\]]{3,}\]", html))
        escribir(os.path.join(ROOT, p["slug"] + ".html"), html)
        print("  [ok] %-52s %d KB" % (p["slug"] + ".html", len(html) // 1024))

    if pendientes:
        print("\n  AVISO: quedan datos del titular sin rellenar en data/legales.json:")
        for x in sorted(pendientes):
            print("    - " + x)
    return len(datos["paginas"])


def generar():
    datos = json.loads(leer(DATA))
    errores = validar(datos)
    if errores:
        print("Datos invalidos:")
        for e in errores:
            print("  - " + e)
        return 1

    if "--check" in sys.argv:
        json.loads(leer(DATA_LEGAL))   # revienta pronto si el JSON legal esta roto
        print("OK: %d paginas validas." % len(datos["paginas"]))
        return 0

    tpl = leer(TPL)
    marca = datos["marca"]
    dominio = datos["dominio"].rstrip("/")
    version = str(datos.get("version", "1"))
    paginas = datos["paginas"]
    casos_globales = datos.get("casos", [])

    generadas = []
    for p in paginas:
        url = url_de(p["slug"], dominio)
        casos = p.get("casos") or casos_globales

        app_ld = {
            "@context": "https://schema.org",
            "@type": "WebApplication",
            "name": p["h1"],
            "url": url,
            "description": p["meta"],
            "applicationCategory": "UtilitiesApplication",
            "operatingSystem": "Cualquiera con navegador web",
            "browserRequirements": "Requiere JavaScript",
            "inLanguage": "es-ES",
            "isAccessibleForFree": True,
            "offers": {"@type": "Offer", "price": "0", "priceCurrency": "EUR"},
            "featureList": [c["corto"] for c in paginas],
            "publisher": {"@type": "Organization", "name": marca, "url": dominio + "/"},
        }
        faq_ld = {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {"@type": "Question", "name": sin_html(f["q"]),
                 "acceptedAnswer": {"@type": "Answer", "text": sin_html(f["a"])}}
                for f in p["faq"]
            ],
        }
        crumbs = [{"@type": "ListItem", "position": 1, "name": "Inicio", "item": dominio + "/"}]
        if p["slug"] != "index":
            crumbs.append({"@type": "ListItem", "position": 2, "name": p["nav"], "item": url})
        crumb_ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": crumbs}

        reemplazos = {
            "{{BRAND}}": esc_attr(marca),
            "{{DOMINIO}}": dominio,
            "{{VER}}": version,
            "{{TITLE}}": esc_attr(p["title"]),
            "{{META}}": esc_attr(p["meta"]),
            "{{CANONICAL}}": url,
            "{{H1}}": esc_attr(p["h1"]),
            "{{SUB}}": esc_attr(p["sub"]),
            "{{MODO}}": p["modo"],
            "{{INTRO_A}}": p["introA"],
            "{{INTRO_B}}": p["introB"],
            "{{NAV_HTML}}": bloque_nav(paginas, p["slug"]),
            "{{CASOS_HTML}}": bloque_casos(casos),
            "{{FAQ_HTML}}": bloque_faq(p["faq"]),
            "{{RELACIONADAS_HTML}}": bloque_relacionadas(paginas, p["slug"]),
            "{{JSONLD_APP}}": jsonld(app_ld),
            "{{JSONLD_FAQ}}": jsonld(faq_ld),
            "{{JSONLD_BREADCRUMB}}": jsonld(crumb_ld),
        }
        html = tpl
        for k, v in reemplazos.items():
            html = html.replace(k, v)

        sobrantes = re.findall(r"\{\{[A-Z_]+\}\}", html)
        if sobrantes:
            print("Aviso: marcadores sin sustituir en %s: %s" % (p["slug"], set(sobrantes)))

        destino = os.path.join(ROOT, archivo_de(p["slug"]))
        escribir(destino, html)
        generadas.append((archivo_de(p["slug"]), url))
        print("  [ok] %-52s %d KB" % (archivo_de(p["slug"]), len(html) // 1024))

    # sitemap
    hoy = version if re.match(r"^\d{8}$", version) else "20260101"
    fecha = "%s-%s-%s" % (hoy[0:4], hoy[4:6], hoy[6:8])
    filas = []
    for i, (_, url) in enumerate(generadas):
        filas.append(
            "  <url><loc>%s</loc><lastmod>%s</lastmod>"
            "<changefreq>weekly</changefreq><priority>%s</priority></url>"
            % (url, fecha, "1.0" if i == 0 else "0.8")
        )
    sitemap = ('<?xml version="1.0" encoding="UTF-8"?>\n'
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
               + "\n".join(filas) + "\n</urlset>\n")
    escribir(os.path.join(ROOT, "sitemap.xml"), sitemap)

    # paginas legales (noindex: fuera del sitemap a proposito)
    print("")
    n_legales = generar_legales(marca, dominio, version)

    robots = ("User-agent: *\nAllow: /\n\n"
              "Sitemap: %s/sitemap.xml\n" % dominio)
    escribir(os.path.join(ROOT, "robots.txt"), robots)

    print("\n%d landings + %d paginas legales + sitemap.xml + robots.txt generados."
          % (len(generadas), n_legales))
    return 0


if __name__ == "__main__":
    sys.exit(generar())
