// Essai de bout en bout dans Chromium (Playwright) : import du zip fictif, onglets, captures.
//   npm run build && node test/fabriquer-plannings.cjs && node test/navigateur.cjs [dossier-captures]
const { chromium } = require((() => { try { return require.resolve("playwright"); } catch { return require("child_process").execSync("npm root -g").toString().trim() + "/playwright"; } })());
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
  const errs = []; p.on("pageerror", e => errs.push(e.message)); p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto("file://" + require("path").resolve(__dirname, "../dist/retours-a-vide.html"));
  await p.selectOption("#mStart", "2026-10"); await p.selectOption("#mCount", "1");
  await p.setInputFiles("#file", require("path").resolve(__dirname, "fixtures/plannings-fictifs.zip"));
  await p.waitForFunction(() => /lus? en/.test(document.getElementById("msg").textContent), null, { timeout: 60000 });
  console.log("MSG:", await p.textContent("#msg"));
  console.log("KPI:", (await p.textContent("#kpi")).replace(/\s+/g, " "));
  console.log("PROPS:", await p.$$eval(".pl-s .pc", t => t.map(r => r.innerText.replace(/\s+/g, " "))));
  // sélection au clavier : ↓ passe à la proposition suivante, la fiche suit, la liste n'est pas redessinée
  const avant = await p.textContent("#pdet .f-head");
  await p.focus(".pl-s .pc.on"); await p.keyboard.press("ArrowDown");
  const apres = await p.textContent("#pdet .f-head");
  console.log("CLAVIER:", avant !== apres ? "la fiche change" : "ÉCHEC : la fiche ne change pas", "| focus:", await p.evaluate(() => document.activeElement.classList.contains("on")));
  await p.keyboard.press("ArrowUp");
  await p.screenshot({ path: (process.argv[2] || "test/captures") + "/opp.png", fullPage: true });
  await p.click('[data-tab="route"]');
  await p.fill("#rC", "13100"); await p.fill("#rL", "57"); await p.fill("#rDate", "2026-10-07"); await p.fill("#rFlex", "2"); await p.fill("#rVol", "20");
  await p.selectOption("#rAg", { label: "Dazin" });
  await p.click("#rGo");
  await p.waitForTimeout(500);
  console.log("ROUTE:", (await p.textContent("#pdet")).replace(/\s+/g, " ").slice(0, 600));
  await p.screenshot({ path: (process.argv[2] || "test/captures") + "/route.png", fullPage: true });
  await p.click('[data-tab="ctrl"]'); console.log("CTRL:", (await p.textContent("#pane")).replace(/\s+/g, " ").slice(0, 900));
  await p.setViewportSize({ width: 390, height: 900 }); await p.click('[data-tab="opp"]');
  const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); console.log("mobile scrollWidth", sw);
  await p.screenshot({ path: (process.argv[2] || "test/captures") + "/mobile.png", fullPage: false });
  await p.emulateMedia({ colorScheme: "dark" }); await p.setViewportSize({ width: 1360, height: 1000 });
  await p.screenshot({ path: (process.argv[2] || "test/captures") + "/dark.png", fullPage: false });
  console.log("ERRORS:", errs);
  await b.close();
})();
