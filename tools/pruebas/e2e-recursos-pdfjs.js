/* Comprueba que los recursos que pdf.js pide desde el WORKER (tipografías
   estándar, wasm de JBIG2/JPEG2000, cmaps CJK) se resuelven contra la URL de
   la página y no contra la del worker.

   Es un fallo silencioso: sin esta comprobación, todo parece ir bien hasta
   que alguien sube un escaneado en blanco y negro y le sale en blanco.

   Uso: NODE_PATH=/opt/node22/lib/node_modules node tools/pruebas/e2e-recursos-pdfjs.js */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const BASE = process.env.BASE || "http://127.0.0.1:8137";
let fallos = 0;
const ok = (c, m) => { console.log((c ? "  PASS  " : "  FAIL  ") + m); if (!c) fallos++; };

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const respuestas = [];
  ctx.on("response", r => {
    if (/\/(standard_fonts|wasm|cmaps|iccs)\//.test(r.url())) respuestas.push({ url: r.url(), status: r.status() });
  });

  await p.goto(BASE + "/index.html");

  // Las URL que la web declara tienen que ser absolutas y sin prefijo repetido
  const urls = await p.evaluate(() => {
    const u = (rel) => new URL(rel, document.baseURI).href;
    return {
      fuentes: u("lib/vendor/pdfjs/standard_fonts/"),
      wasm: u("lib/vendor/pdfjs/wasm/")
    };
  });
  ok(/^https?:\/\//.test(urls.fuentes) && !/pdfjs\/lib\//.test(urls.fuentes),
     "las URL de recursos son absolutas: " + urls.fuentes);

  // y que sea main.js quien las declara así, no solo esta prueba
  const fuente = await (await ctx.request.get(BASE + "/main.js")).text();
  ok(/new URL\(rel, document\.baseURI\)/.test(fuente) &&
     !/wasmUrl:\s*"lib\//.test(fuente),
     "main.js declara los recursos como URL absoluta, no relativa al worker");

  // useSystemFonts:false fuerza a pdf.js a pedir de verdad la tipografía
  const r = await p.evaluate(async (b64) => {
    await import("./lib/vendor/pdfjs/compat.mjs");
    const lib = await import("./lib/vendor/pdfjs/pdf.min.mjs");
    lib.GlobalWorkerOptions.workerSrc = "lib/vendor/pdfjs/worker-boot.mjs";
    const abs = (rel) => new URL(rel, document.baseURI).href;
    const doc = await lib.getDocument({
      data: Uint8Array.from(atob(b64), c => c.charCodeAt(0)),
      standardFontDataUrl: abs("lib/vendor/pdfjs/standard_fonts/"),
      wasmUrl: abs("lib/vendor/pdfjs/wasm/"),
      cMapUrl: abs("lib/vendor/pdfjs/cmaps/"),
      cMapPacked: true,
      useSystemFonts: false
    }).promise;
    const pg = await doc.getPage(1);
    const c = document.createElement("canvas");
    const vp = pg.getViewport({ scale: 1 });
    c.width = vp.width; c.height = vp.height;
    await pg.render({ canvas: c, canvasContext: c.getContext("2d"), viewport: vp }).promise;
    return doc.numPages;
  }, fs.readFileSync(path.join(__dirname, "doc-a.pdf")).toString("base64"));
  await p.waitForTimeout(900);

  ok(r === 3, "el documento se renderiza sin tipografías del sistema");
  ok(respuestas.length > 0, "el worker pidió algún recurso vendorizado (" + respuestas.length + ")");
  const malas = respuestas.filter(x => x.status !== 200);
  ok(malas.length === 0, "todos respondieron 200" +
     (malas.length ? ": " + malas.map(x => x.status + " " + x.url).join(", ") : ""));
  respuestas.forEach(x => console.log("         " + x.status + " " + x.url.replace(BASE + "/", "")));

  await b.close();
  console.log(fallos ? "\n" + fallos + " FALLOS" : "\nTODO OK");
  process.exitCode = fallos ? 1 : 0;
})();
