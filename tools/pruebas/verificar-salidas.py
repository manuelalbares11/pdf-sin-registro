#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Comprueba los ZIP y PDF que ha producido la prueba de extremo a extremo.
No basta con que el navegador diga "descargado": hay que abrir el artefacto.

    python3 tools/pruebas/verificar-salidas.py tools/pruebas/out
"""
import os, sys, zipfile

d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "out")
fallos = 0

def check(cond, msg):
    global fallos
    print(("  PASS  " if cond else "  FAIL  ") + msg)
    if not cond:
        fallos += 1

esperado = {
    "dividido-paginas.zip": (3, ".pdf", ["trozo-1.pdf", "trozo-2.pdf", "trozo-3.pdf"]),
    "dividido-rangos.zip":  (2, ".pdf", ["bloque-1-2.pdf", "bloque-4-5.pdf"]),
    "paginas-jpg.zip":      (3, ".jpg", ["pagina-1.jpg", "pagina-2.jpg", "pagina-3.jpg"]),
}

for nombre, (n, ext, nombres) in esperado.items():
    ruta = os.path.join(d, nombre)
    if not os.path.exists(ruta):
        check(False, nombre + ": no existe")
        continue
    try:
        with zipfile.ZipFile(ruta) as z:
            roto = z.testzip()
            listado = z.namelist()
            tam = [z.getinfo(x).file_size for x in listado]
            contenidos_ok = True
            for x in listado:
                cab = z.read(x)[:5]
                if ext == ".pdf" and not cab.startswith(b"%PDF-"):
                    contenidos_ok = False
                if ext == ".jpg" and cab[:2] != b"\xff\xd8":
                    contenidos_ok = False
            check(roto is None and len(listado) == n and sorted(listado) == sorted(nombres)
                  and all(t > 200 for t in tam) and contenidos_ok,
                  "%s: %d entradas %s, contenido válido, nombres %s"
                  % (nombre, len(listado), ext, listado))
    except zipfile.BadZipFile:
        check(False, nombre + ": no es un ZIP válido")

print("\nTODO OK" if not fallos else "\n%d FALLOS" % fallos)
sys.exit(1 if fallos else 0)
