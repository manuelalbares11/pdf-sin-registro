const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await p.goto("file://" + __dirname + "/og.html");
  await p.waitForTimeout(700);
  await p.screenshot({ path: process.argv[2] });
  await b.close();
})();
