// Fabrique un zip de plannings FICTIFS (octobre 2026) au format lu par parseTrucksSheet :
// en-tête camion (agence, immatriculation) puis un bloc de 6 lignes par jour, séparé par « MMM | MME ».
//   node test/fabriquer-plannings.cjs  →  test/fixtures/plannings-fictifs.zip
const fs = require("fs"), path = require("path");
// vendor/ est servi tel quel au navigateur : on charge les deux scripts comme des scripts globaux
const vm = require("vm");
for (const f of ["xlsx.full.min.js", "jszip.min.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "vendor", f), "utf8"), { filename: f });
const { XLSX, JSZip } = globalThis;

const H = 6, TOP = 3, C0 = 3;  // hauteur d'un bloc, lignes d'en-tête, première colonne camion
function feuille(camions) {
  const aoa = [];
  const set = (r, c, v) => { while (aoa.length <= r) aoa.push([]); aoa[r][c] = v; };
  camions.forEach((t, k) => { const c = C0 + 3 * k; set(0, c, t.agence); set(1, c, t.plaque); set(2, c, "chauffeur"); });
  for (let d = 1; d <= 31; d++) {
    const r0 = TOP + (d - 1) * H, iso = `2026-10-${String(d).padStart(2, "0")}`;
    set(r0, 0, new Date(2026, 9, d));   // minuit local, comme une date lue dans Excel
    camions.forEach((t, k) => {
      const c = C0 + 3 * k, j = t.jours[iso];
      if (j) { set(r0, c, j.c); set(r0, c + 1, j.l); set(r0, c + 2, "STD"); set(r0 + 1, c, j.client); set(r0 + 2, c, j.vol); set(r0 + 2, c + 1, j.etp || 2); }
      set(r0 + H - 1, c, "MMM"); set(r0 + H - 1, c + 1, "MME");
    });
  }
  return XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
}
const lot = (c, l, client, vol, d1, d2) => ({ [d1]: { c, l, client, vol }, ...(d2 ? { [d2]: { c, l, client, vol } } : {}) });
const plannings = {
  "PLANNING METZ NANCY HEISS RENARD 2026.xlsx": [
    { agence: "HCDEM", plaque: "EY-441-WT 50H+50", jours: lot(57, 13008, "DUPONT", 15, "2026-10-05", "2026-10-06") },
    { agence: "SOLODEM", plaque: "GA-832-RW 60", jours: lot(54, 33000, "LEROY", 25, "2026-10-19", "2026-10-21") },
  ],
  "PLANNING AVIGNON MARSEILLE TOULON.xlsx": [
    { agence: "DAZIN", plaque: "GL-896-CK 60", jours: { ...lot(13100, 69003, "MARTIN", 15, "2026-10-07", "2026-10-08"), ...lot(13, 35, "BERNARD", 20, "2026-10-15", "2026-10-16") } },
    { agence: "DAVIN", plaque: "GQ-156-KL 20", jours: lot(84, 75, "PETIT VL", 10, "2026-10-12", "2026-10-13") },
  ],
  "Brest Guer Lorient.xlsx": [
    { agence: "GUER", plaque: "EZ-412-VY 50", jours: lot(56, 13, "BLAVIER", 30, "2026-10-12", "2026-10-14") },
    { agence: "LORIENT", plaque: "FA-100-AA 40", jours: lot(56, 31, "DUREL", 24, "2026-10-20", "2026-10-22") },
  ],
};
(async () => {
  const zip = new JSZip();
  for (const [nom, camions] of Object.entries(plannings)) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, feuille(camions), "OCTOBRE");
    zip.file("plannings/" + nom, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  }
  const out = path.join(__dirname, "fixtures", "plannings-fictifs.zip");
  fs.writeFileSync(out, await zip.generateAsync({ type: "nodebuffer" }));
  console.log(out);
})();
