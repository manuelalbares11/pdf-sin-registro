const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const T = __dirname;
const OUT = path.join(T, "out");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://127.0.0.1:8137";
const errors = [];
let failures = 0;
function ok(cond, msg) { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failures++; }

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push("pageerror: " + e.message));

  await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
  ok(await page.locator("h1").isVisible(), "H1 visible");
  ok((await page.locator("#toolCard").getAttribute("data-state")) === "idle", "estado inicial idle");
  ok(await page.locator(".ad-slot--leaderboard").isVisible(), "hueco ANUNCIO leaderboard presente");
  ok(await page.locator(".ad-slot--incontent").isVisible(), "hueco ANUNCIO in-content presente");
  ok((await page.locator(".ad-slot").count()) === 2, "solo 2 huecos de anuncio, sin popups");

  // --- 1. cargar 3 PDF (6 paginas) ---
  await page.setInputFiles("#fileInput", [
    path.join(T, "doc-a.pdf"), path.join(T, "doc-b.pdf"), path.join(T, "doc-c.pdf")]);
  await page.waitForSelector('#toolCard[data-state="ready"]', { timeout: 20000 });
  const n = await page.locator(".page-card").count();
  ok(n === 6, "6 paginas cargadas de 3 archivos (obtenido " + n + ")");
  await page.waitForFunction(() => document.querySelectorAll("#pageGrid canvas").length >= 6, null, { timeout: 20000 });
  ok(true, "miniaturas renderizadas con pdf.js");
  await page.screenshot({ path: path.join(OUT, "01-cargado.png"), fullPage: false });

  // --- 2. reordenar / girar / eliminar ---
  const firstBefore = await page.locator(".page-card").first().getAttribute("data-uid");
  await page.locator('.page-card >> nth=0 >> button[data-act="right"]').click();
  const secondAfter = await page.locator(".page-card").nth(1).getAttribute("data-uid");
  ok(firstBefore === secondAfter, "mover pagina cambia el orden");
  await page.locator('.page-card >> nth=0 >> button[data-act="rot"]').click();
  await page.locator('.page-card >> nth=5 >> button[data-act="del"]').click();
  ok((await page.locator(".page-card").count()) === 5, "eliminar pagina deja 5");

  // --- 3. editor: texto + firma ---
  await page.locator('.page-card >> nth=0 >> button[data-act="edit"]').click();
  await page.waitForSelector("#editorDlg[open]");
  await page.waitForFunction(() => document.querySelectorAll("#edStage canvas").length > 0, null, { timeout: 15000 });
  await page.fill("#edText", "Aprobado el 7 de septiembre — Ñandú áéíóú");
  await page.click("#edAddText");
  ok((await page.locator("#edStage .ov--text").count()) === 1, "texto anadido al editor");
  // dibujar firma
  const pad = await page.locator("#sigPad").boundingBox();
  await page.mouse.move(pad.x + 40, pad.y + 110);
  await page.mouse.down();
  for (let i = 0; i < 26; i++) {
    await page.mouse.move(pad.x + 40 + i * 8, pad.y + 110 - Math.sin(i / 2.2) * 42);
  }
  await page.mouse.up();
  await page.click("#sigAdd");
  ok((await page.locator("#edStage .ov--sign").count()) === 1, "firma anadida al editor");
  await page.screenshot({ path: path.join(OUT, "02-editor.png") });
  await page.click("#edDone");
  await page.waitForSelector("#editorDlg[open]", { state: "detached" }).catch(() => {});
  ok((await page.locator(".page-card__flag").count()) === 1, "la pagina queda marcada como editada");

  // --- 4. exportar sin comprimir ---
  await page.fill("#optName", "prueba-unido");
  let dl = page.waitForEvent("download", { timeout: 60000 });
  await page.click("#exportBtn");
  let d = await dl;
  const f1 = path.join(OUT, "prueba-unido.pdf");
  await d.saveAs(f1);
  await page.waitForSelector('#toolCard[data-state="done"]', { timeout: 30000 });
  const size1 = fs.statSync(f1).size;
  ok(size1 > 500, "PDF unido descargado (" + size1 + " bytes)");
  ok(fs.readFileSync(f1).slice(0, 5).toString() === "%PDF-", "cabecera %PDF- valida");
  await page.screenshot({ path: path.join(OUT, "03-resultado.png") });

  // --- 4b. sonda del artefacto: abrir el PDF exportado y comprobar su contenido ---
  const probe = await page.evaluate(async (b64) => {
    await import("./lib/vendor/pdfjs/compat.mjs");
    const lib = await import("./lib/vendor/pdfjs/pdf.min.mjs");
    lib.GlobalWorkerOptions.workerSrc = "lib/vendor/pdfjs/worker-boot.mjs";
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const doc = await lib.getDocument({ data: bin }).promise;
    const pg = await doc.getPage(1);
    const tc = await pg.getTextContent();
    const ops = await pg.getOperatorList();
    return {
      n: doc.numPages,
      texto: tc.items.map(i => i.str).join(" "),
      rot: pg.rotate,
      imagenes: ops.fnArray.filter(f => f === lib.OPS.paintImageXObject).length
    };
  }, fs.readFileSync(f1).toString("base64"));
  ok(probe.n === 5, "el PDF exportado declara 5 paginas");
  ok(/Ñandú áéíóú/.test(probe.texto), "el texto anadido esta incrustado con acentos y ñ");
  ok(probe.imagenes >= 1, "la firma esta incrustada como imagen en la pagina");
  ok(probe.rot === 90, "el giro aplicado se guarda dentro del PDF");

  // --- 5. sonda del artefacto: reabrir el PDF exportado en la propia herramienta ---
  await page.click(".only-done [data-reset], .only-work [data-reset]:visible");
  await page.waitForSelector('#toolCard[data-state="idle"]');
  await page.setInputFiles("#fileInput", [f1]);
  await page.waitForSelector('#toolCard[data-state="ready"]', { timeout: 20000 });
  const n2 = await page.locator(".page-card").count();
  ok(n2 === 5, "el PDF exportado se reabre y tiene 5 paginas (obtenido " + n2 + ")");

  // --- 6. comprimir ---
  await page.click(".only-done [data-reset], .only-work [data-reset]:visible");
  await page.setInputFiles("#fileInput", [path.join(T, "doc-a.pdf")]);
  await page.waitForSelector('#toolCard[data-state="ready"]', { timeout: 20000 });
  await page.click('[data-mode="comprimir"]');
  ok(await page.locator("#optCompress").isChecked(), "modo comprimir activa la compresion");
  ok(await page.locator(".notice--warn").isVisible(), "avisa de que el PDF tiene texto seleccionable");
  await page.selectOption("#optDpi", "96");
  dl = page.waitForEvent("download", { timeout: 120000 });
  await page.click("#exportBtn");
  d = await dl;
  const f2 = path.join(OUT, "prueba-comprimido.pdf");
  await d.saveAs(f2);
  await page.waitForSelector('#toolCard[data-state="done"]', { timeout: 60000 });
  ok(fs.readFileSync(f2).slice(0, 5).toString() === "%PDF-", "PDF comprimido valido (" + fs.statSync(f2).size + " bytes)");
  await page.click(".only-done [data-reset], .only-work [data-reset]:visible");
  await page.setInputFiles("#fileInput", [f2]);
  await page.waitForSelector('#toolCard[data-state="ready"]', { timeout: 20000 });
  ok((await page.locator(".page-card").count()) === 3, "el PDF comprimido conserva 3 paginas");

  // --- 7. movil + landing ---
  const mob = await ctx.newPage();
  await mob.setViewportSize({ width: 375, height: 812 });
  await mob.goto(BASE + "/comprimir-pdf-para-enviar-por-correo-sin-registro.html", { waitUntil: "networkidle" });
  const box = await mob.locator("#dropzone").boundingBox();
  ok(box && box.y + box.height < 812, "la zona de soltar entra en pantalla de movil sin scroll");
  ok(await mob.locator("#optCompress").count() === 1, "landing carga la misma herramienta");
  const modo = await mob.evaluate(() => document.querySelector('[data-mode="comprimir"]').getAttribute("aria-pressed"));
  ok(modo === "true", "la landing preselecciona su modo desde los datos");
  await mob.screenshot({ path: path.join(OUT, "04-movil.png"), fullPage: false });
  const noHscroll = await mob.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(noHscroll, "sin scroll horizontal en movil");

  // --- 8. sin JS ---
  const ctx2 = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1000, height: 800 } });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + "/unir-pdf-gratis-sin-marca-de-agua.html");
  ok(await p2.locator("h1").isVisible(), "sin JS: el H1 sigue visible");
  ok(await p2.locator(".faq details").count() >= 4, "sin JS: las FAQ estan en el HTML");
  ok(await p2.locator("noscript").count() === 1, "sin JS: aviso de que hace falta JavaScript");

  console.log("\nErrores de consola: " + errors.length);
  errors.slice(0, 12).forEach(e => console.log("   ! " + e));
  await browser.close();
  console.log(failures === 0 ? "\nTODO OK" : "\n" + failures + " FALLOS");
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error("EXCEPCION:", e); process.exit(2); });
