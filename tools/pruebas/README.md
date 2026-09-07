# Pruebas de la herramienta (solo desarrollo)

No forman parte de la web publicada. Sirven para comprobar que la herramienta
sigue funcionando de verdad (no solo que "carga") antes de publicar.

```bash
# 1. servidor local — imprescindible: con file:// no funcionan los motores
python3 -m http.server 8137 --bind 127.0.0.1

# 2. PDF de prueba
python3 tools/pruebas/generar-pdf-de-prueba.py tools/pruebas

# 3. recorrido completo en un navegador real (Chromium + Playwright)
NODE_PATH=/opt/node22/lib/node_modules node tools/pruebas/e2e.js
```

`e2e.js` recorre el camino real: carga tres PDF, comprueba las miniaturas,
reordena, gira, elimina, añade texto y firma, exporta, y después **vuelve a
abrir el PDF exportado** para comprobar el número de páginas, que el texto
está incrustado con acentos, que la firma es una imagen real dentro del
archivo y que el giro quedó guardado. También revisa la compresión, el móvil
de 375×812 y que la página funcione sin JavaScript.

`e2e-nuevas-funciones.js` cubre las funciones de salida múltiple: dividir (por
página y por rangos), imágenes a PDF (tamaño A4 y tamaño real) y PDF a
imágenes (JPG y PNG). Necesita las imágenes de prueba:

```bash
NODE_PATH=/opt/node22/lib/node_modules node tools/pruebas/generar-imagenes-de-prueba.js tools/pruebas
NODE_PATH=/opt/node22/lib/node_modules node tools/pruebas/e2e-nuevas-funciones.js
python3 tools/pruebas/verificar-salidas.py tools/pruebas/out
```

`verificar-salidas.py` abre de verdad los ZIP generados: comprueba que no
están corruptos, cuántas entradas tienen, cómo se llaman y que cada una
empieza por la cabecera de su formato. Que el navegador diga «descargado» no
prueba nada.

`e2e-demo.js` prueba el empaquetado de una sola página (`tools/construir-demo.py`):
que el CSS y el JS embebidos siguen funcionando, que no quedan enlaces a
páginas que ahí no existen, y que la entrega de varios archivos se hace de uno
en uno en lugar de en un ZIP. Necesita una variante servida en local del
archivo empaquetado, con las rutas de las librerías apuntando a `lib/vendor/`.

`render-pdf.js <archivo.pdf> <pagina> <salida.png>` rasteriza una página del
PDF resultante para inspeccionarla a ojo.
