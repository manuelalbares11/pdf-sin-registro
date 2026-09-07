const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const T = __dirname, OUT = path.join(T, "out");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://127.0.0.1:8137";
let fail = 0;
const ok = (c, m) => { console.log((c ? "  PASS  " : "  FAIL  ") + m); if (!c) fail++; };

async function sondaPdf(page, file) {
  return page.evaluate(async (b64) => {
    await import("./lib/vendor/pdfjs/compat.mjs");
    const lib = await import("./lib/vendor/pdfjs/pdf.min.mjs");
    lib.GlobalWorkerOptions.workerSrc = "lib/vendor/pdfjs/worker-boot.mjs";
    const doc = await lib.getDocument({ data: Uint8Array.from(atob(b64), c => c.charCodeAt(0)) }).promise;
    const pg = await doc.getPage(1);
    const v = pg.getViewport({ scale: 1 });
    const ops = await pg.getOperatorList();
    return { n: doc.numPages, w: Math.round(v.width), h: Math.round(v.height),
             imgs: ops.fnArray.filter(f => f === lib.OPS.paintImageXObject).length };
  }, fs.readFileSync(file).toString("base64"));
}

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1320, height: 950 } });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });

  const bajar = async (accion) => {
    const d = page.waitForEvent("download", { timeout: 120000 });
    await accion();
    return await d;
  };
  const reset = async () => {
    await page.click(".only-done [data-reset], .only-work [data-reset]:visible");
    await page.waitForSelector('#toolCard[data-state="idle"]');
  };

  // ============ 1. DIVIDIR: cada página un archivo ============
  await page.goto(BASE + "/dividir-pdf-en-paginas-separadas-gratis.html", { waitUntil: "load" });
  ok(await page.evaluate(() => document.querySelector('[data-mode="dividir"]').getAttribute("aria-pressed")) === "true",
     "dividir: la landing preselecciona su modo");
  await page.setInputFiles("#fileInput", [path.join(T, "doc-a.pdf")]);
  await page.waitForSelector('#toolCard[data-state="ready"]', { timeout: 20000 });
  ok(await page.locator("#splitOpts").isVisible(), "dividir: se ven las opciones de separación");
  await page.fill("#optName", "trozo");
  let dl = await bajar(() => page.click("#exportBtn"));
  const zipA = path.join(OUT, "dividido-paginas.zip");
  await dl.saveAs(zipA);
  await page.waitForSelector('#toolCard[data-state="done"]', { timeout: 60000 });
  ok(fs.readFileSync(zipA).slice(0, 2).toString() === "PK", "dividir: descarga un ZIP (" + fs.statSync(zipA).size + " bytes)");
  ok(/3 archivos/.test(await page.locator("#resSizes").innerText()), "dividir: el resultado anuncia 3 archivos");

  // ============ 2. DIVIDIR por rangos ============
  await reset();
  await page.setInputFiles("#fileInput", [path.join(T, "doc-a.pdf"), path.join(T, "doc-b.pdf")]);
  await page.waitForSelector('#toolCard[data-state="ready"]', { timeout: 20000 });
  await page.selectOption("#optSplitMode", "rangos");
  ok(!(await page.locator("#rangeBox").isHidden()), "rangos: aparece el campo al elegir el modo");
  await page.fill("#optRanges", "1-2, 4-");
  await page.fill("#optName", "bloque");
  dl = await bajar(() => page.click("#exportBtn"));
  const zipB = path.join(OUT, "dividido-rangos.zip");
  await dl.saveAs(zipB);
  await page.waitForSelector('#toolCard[data-state="done"]', { timeout: 60000 });
  ok(/2 archivos/.test(await page.locator("#resSizes").innerText()), "rangos: 1-2 y 4- producen 2 archivos");

  // rango que da un solo archivo -> PDF directo, sin ZIP
  await page.click(".only-done [data-reset]");
  await page.setInputFiles("#fileInput", [path.join(T, "doc-a.pdf")]);
  await page.waitForSelector('#toolCard[data-state="ready"]', { timeout: 20000 });
  await page.selectOption("#optSplitMode", "rangos");
  await page.fill("#optRanges", "2-3");
  dl = await bajar(() => page.click("#exportBtn"));
  const solo = path.join(OUT, "dividido-uno.pdf");
  await dl.saveAs(solo);
  await page.waitForSelector('#toolCard[data-state="done"]', { timeout: 60000 });
  let s = await sondaPdf(page, solo);
  ok(fs.readFileSync(solo).slice(0, 5).toString() === "%PDF-" && s.n === 2,
     "rangos: un solo rango descarga un PDF directo con 2 páginas (n=" + s.n + ")");

  // ============ 3. IMAGEN -> PDF ============
  await page.goto(BASE + "/convertir-jpg-a-pdf-sin-registro.html", { waitUntil: "load" });
  ok(await page.evaluate(() => document.querySelector('[data-mode="imagen-a-pdf"]').getAttribute("aria-pressed")) === "true",
     "jpg a pdf: la landing preselecciona su modo");
  ok(/imágenes/i.test(await page.locator("#dzTitle").innerText()), "jpg a pdf: la zona de soltar pide imágenes");
  await page.setInputFiles("#fileInput", [path.join(T, "foto-a.jpg"), path.join(T, "foto-b.png")]);
  await page.waitForSelector('#toolCard[data-state="ready"]', { timeout: 20000 });
  ok((await page.locator(".page-card").count()) === 2, "jpg a pdf: dos imágenes, dos páginas");
  await page.waitForFunction(() => document.querySelectorAll("#pageGrid canvas").length >= 2, null, { timeout: 15000 });
  ok(true, "jpg a pdf: miniaturas pintadas desde la imagen");
  ok(await page.locator("#imgOpts").isVisible(), "jpg a pdf: opción de tamaño de página visible");
  await page.screenshot({ path: path.join(OUT, "05-jpg-a-pdf.png") });
  await page.fill("#optName", "fotos");
  dl = await bajar(() => page.click("#exportBtn"));
  const imgPdf = path.join(OUT, "fotos.pdf");
  await dl.saveAs(imgPdf);
  await page.waitForSelector('#toolCard[data-state="done"]', { timeout: 60000 });
  s = await sondaPdf(page, imgPdf);
  ok(s.n === 2 && s.imgs >= 1, "jpg a pdf: PDF de 2 páginas con la imagen incrustada (imgs=" + s.imgs + ")");
  ok(s.w === 842 && s.h === 595, "jpg a pdf: la foto apaisada cae en un A4 horizontal (" + s.w + "x" + s.h + ")");

  // tamaño real de la imagen
  await page.click(".only-done [data-reset]");
  await page.setInputFiles("#fileInput", [path.join(T, "foto-a.jpg")]);
  await page.waitForSelector('#toolCard[data-state="ready"]', { timeout: 20000 });
  await page.selectOption("#optImgFit", "original");
  dl = await bajar(() => page.click("#exportBtn"));
  const imgPdf2 = path.join(OUT, "foto-original.pdf");
  await dl.saveAs(imgPdf2);
  await page.waitForSelector('#toolCard[data-state="done"]', { timeout: 60000 });
  s = await sondaPdf(page, imgPdf2);
  ok(s.w === 900 && s.h === 600, "jpg a pdf: «tamaño real» da una página de 1200x800 px a 96 ppp (" + s.w + "x" + s.h + ")");

  // ============ 4. PDF -> IMAGEN ============
  await page.goto(BASE + "/pasar-pdf-a-jpg-alta-resolucion.html", { waitUntil: "load" });
  ok(await page.evaluate(() => document.querySelector('[data-mode="pdf-a-imagen"]').getAttribute("aria-pressed")) === "true",
     "pdf a jpg: la landing preselecciona su modo");
  await page.setInputFiles("#fileInput", [path.join(T, "doc-a.pdf")]);
  await page.waitForSelector('#toolCard[data-state="ready"]', { timeout: 20000 });
  ok(await page.locator("#rasterOpts").isVisible(), "pdf a jpg: opciones de resolución y formato visibles");
  ok(!(await page.locator("#compressBox").isVisible()), "pdf a jpg: la compresión de PDF se oculta (no aplica)");
  await page.selectOption("#optImgDpi", "150");
  await page.fill("#optName", "pagina");
  dl = await bajar(() => page.click("#exportBtn"));
  const zipC = path.join(OUT, "paginas-jpg.zip");
  await dl.saveAs(zipC);
  await page.waitForSelector('#toolCard[data-state="done"]', { timeout: 90000 });
  ok(fs.readFileSync(zipC).slice(0, 2).toString() === "PK", "pdf a jpg: descarga un ZIP");
  ok(/3 archivos/.test(await page.locator("#resSizes").innerText()), "pdf a jpg: 3 páginas, 3 imágenes");

  // una sola página -> imagen suelta, en PNG
  await page.click(".only-done [data-reset]");
  await page.setInputFiles("#fileInput", [path.join(T, "doc-c.pdf")]);
  await page.waitForSelector('#toolCard[data-state="ready"]', { timeout: 20000 });
  await page.selectOption("#optImgFormat", "png");
  dl = await bajar(() => page.click("#exportBtn"));
  const unaPng = path.join(OUT, "pagina-1.png");
  await dl.saveAs(unaPng);
  await page.waitForSelector('#toolCard[data-state="done"]', { timeout: 60000 });
  const cab = fs.readFileSync(unaPng).slice(1, 4).toString();
  ok(cab === "PNG", "pdf a png: una sola página descarga un PNG suelto (" + fs.statSync(unaPng).size + " bytes)");

  // ============ 5. móvil: los 7 modos no empujan la herramienta ============
  const mob = await b.newPage();
  await mob.setViewportSize({ width: 375, height: 812 });
  await mob.goto(BASE + "/convertir-jpg-a-pdf-sin-registro.html", { waitUntil: "load" });
  const bb = await mob.locator("#dropzone").boundingBox();
  const modos = await mob.locator(".modes").boundingBox();
  ok(bb.y + bb.height < 812 && modos.height < 60,
     "móvil: 7 modos en una sola fila deslizable, herramienta visible (dropzone hasta " + Math.round(bb.y + bb.height) + ")");
  await mob.screenshot({ path: path.join(OUT, "06-movil-modos.png") });

  console.log("\nErrores de consola/página:", errs.length);
  errs.slice(0, 8).forEach(e => console.log("   ! " + e));
  await b.close();
  console.log(fail === 0 ? "\nTODO OK" : "\n" + fail + " FALLOS");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("EXCEPCION:", e); process.exit(2); });
