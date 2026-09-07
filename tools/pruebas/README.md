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

`render-pdf.js <archivo.pdf> <pagina> <salida.png>` rasteriza una página del
PDF resultante para inspeccionarla a ojo.
