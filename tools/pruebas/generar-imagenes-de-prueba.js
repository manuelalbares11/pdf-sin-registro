/* Genera imágenes de prueba (JPG y PNG) con el propio Chromium.
   Uso: NODE_PATH=... node tools/pruebas/generar-imagenes-de-prueba.js <carpeta> */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const dir = process.argv[2] || __dirname;
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const p = await b.newPage();
  const salidas = await p.evaluate(async () => {
    function dibuja(w, h, fondo, texto) {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const x = c.getContext("2d");
      x.fillStyle = fondo; x.fillRect(0, 0, w, h);
      x.fillStyle = "#ffffff";
      x.font = "bold " + Math.round(h / 9) + "px sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(texto, w / 2, h / 2);
      x.strokeStyle = "#ffffff"; x.lineWidth = Math.max(2, h / 60);
      x.strokeRect(w * 0.06, h * 0.06, w * 0.88, h * 0.88);
      return c;
    }
    const jpg = dibuja(1200, 800, "#1d4ed8", "FOTO A").toDataURL("image/jpeg", 0.9);
    const png = dibuja(600, 900, "#b91c1c", "FOTO B").toDataURL("image/png");
    return { jpg, png };
  });
  for (const [nombre, url] of [["foto-a.jpg", salidas.jpg], ["foto-b.png", salidas.png]]) {
    const datos = Buffer.from(url.split(",")[1], "base64");
    fs.writeFileSync(path.join(dir, nombre), datos);
    console.log(nombre, datos.length, "bytes");
  }
  await b.close();
})();
