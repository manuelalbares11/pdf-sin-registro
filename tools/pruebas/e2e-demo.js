const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
let f=0; const ok=(c,m)=>{console.log((c?"  PASS  ":"  FAIL  ")+m); if(!c)f++;};
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1320, height: 900 } });
  const p = await ctx.newPage();
  const errs=[]; p.on("pageerror", e=>errs.push(e.message));
  await p.goto("http://127.0.0.1:8137/demo-local.html", { waitUntil: "load" });
  ok(await p.locator("h1").isVisible(), "empaquetado: H1 visible");
  ok((await p.locator(".ad-slot").count())===2, "empaquetado: 2 huecos de anuncio");
  ok((await p.locator("a[href$='.html']").count())===0, "empaquetado: sin enlaces a paginas inexistentes");
  await p.setInputFiles("#fileInput", [path.join(__dirname,"doc-a.pdf"), path.join(__dirname,"doc-b.pdf")]);
  await p.waitForSelector('#toolCard[data-state="ready"]', {timeout:20000});
  await p.waitForFunction(()=>document.querySelectorAll("#pageGrid canvas").length>=5, null, {timeout:20000});
  ok(true, "empaquetado: carga PDF y pinta miniaturas");
  // En el empaquetado de demo no hay descarga automatica: la entrega es
  // siempre una accion explicita del usuario (el visor pide confirmacion).
  await p.click("#exportBtn");
  await p.waitForSelector('#toolCard[data-state="done"]', {timeout:90000});
  ok(true, "empaquetado: exporta y muestra el resultado");
  const dl = p.waitForEvent("download", {timeout:60000});
  await p.click("#resDownload");
  const d = await dl; const out = path.join(__dirname,"out","demo.pdf"); await d.saveAs(out);
  ok(fs.readFileSync(out).slice(0,5).toString()==="%PDF-", "empaquetado: el boton de descarga da un PDF valido");

  // dividir en la demo: sin ZIP, un boton por archivo
  await p.click(".only-done [data-reset]");
  await p.waitForSelector('#toolCard[data-state="idle"]');
  await p.setInputFiles("#fileInput", [path.join(__dirname,"doc-a.pdf")]);
  await p.waitForSelector('#toolCard[data-state="ready"]', {timeout:20000});
  await p.click('[data-mode="dividir"]');
  await p.click("#exportBtn");
  await p.waitForSelector('#toolCard[data-state="done"]', {timeout:90000});
  const nBotones = await p.locator("#resList .btn").count();
  ok(nBotones===3, "empaquetado: dividir ofrece 3 archivos sueltos, sin ZIP (botones="+nBotones+")");
  const dl2 = p.waitForEvent("download", {timeout:60000});
  await p.locator("#resList .btn").first().click();
  const d2 = await dl2; const out2 = path.join(__dirname,"out","demo-trozo.pdf"); await d2.saveAs(out2);
  ok(fs.readFileSync(out2).slice(0,5).toString()==="%PDF-", "empaquetado: cada trozo es un PDF valido");
  await p.screenshot({ path: path.join(__dirname,"out","demo-claro.png") });
  const dark = await b.newContext({ colorScheme: "dark", viewport:{width:1320,height:900} });
  const p2 = await dark.newPage(); await p2.goto("http://127.0.0.1:8137/demo-local.html");
  await p2.screenshot({ path: path.join(__dirname,"out","demo-oscuro.png") });
  console.log("errores:", errs.length, errs.slice(0,3));
  await b.close(); process.exit(f?1:0);
})();
