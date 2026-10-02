// Tests de bout en bout du cœur d'analyse, sous Node : `node --test test/`
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Boucles } from "../src/analyse.js";

const BD = JSON.parse(fs.readFileSync(new URL("../src/carte.json", import.meta.url), "utf8"));
const CENT = {}; Object.entries(BD.dep).forEach(([k, v]) => CENT[k] = [v[0], v[1]]);
const base = (key, lat, lon, dept) => ({ key, dept, cp: Boucles.cpProche(lat, lon), pos: CENT[dept], label: key, how: "test" });
const BASES = { METZ: base("METZ", 49.12, 6.18, "57"), MRS: base("MRS", 43.41, 5.31, "13"), RENNES: base("RENNES", 48.11, -1.68, "35") };
const jour = (d, lot) => ({ d, lot, active: true, retour: false });
const lot = (c, l, client, vol = 15) => ({ c, l, cRaw: c, lRaw: l, prest: "", client, vol, etp: 2 });

function camions() {
  return [
    // Metz descend à Marseille (15 m³) : chargement lun. 12/10, livraison mar. 13/10, puis retour à vide
    { planning: "METZ", plate: "AA-111-AA", agency: "METZ", cap: 100, b: "METZ", days: [jour("2026-10-12", lot("57", "13", "DUPONT")), jour("2026-10-13", lot("57", "13", "DUPONT"))] },
    // Marseille vend un chantier Aix → Lyon (15 m³) le mer. 14/10, seul sur son camion
    { planning: "MRS", plate: "BB-222-BB", agency: "MRS", cap: 60, b: "MRS", days: [jour("2026-10-14", lot("13", "69", "MARTIN", 15)), jour("2026-10-15", lot("13", "69", "MARTIN", 15))] },
    // Rennes : un chantier sans rapport, chargé loin du lieu de livraison de Metz
    { planning: "RENNES", plate: "CC-333-CC", agency: "RENNES", cap: 60, b: "RENNES", days: [jour("2026-10-14", lot("35", "33", "DURAND"))] },
  ];
}
const run = (params = {}) => { const T = camions(); return Boucles.analyse(T, { centroids: CENT, baseOf: t => BASES[t.b], params }); };

test("un retour Metz ← Marseille est trouvé et jugé par le moteur", () => {
  const R = run();
  assert.equal(R.kpi.emptyTrips >= 1, true);
  const m = R.matches.find(x => x.keep);
  assert.ok(m, "au moins un retour possible");
  assert.equal(m.acc.client, "MARTIN");
  assert.ok(["ok", "info", "orange"].includes(m.verdict));
  assert.ok(m.eco > 0);
  assert.ok(Array.isArray(m.r.jours) && m.r.jours.length > 0, "le calendrier vient du moteur");
  assert.ok(m.r.sorties.every(([a, b]) => { for (let d = a; d <= b; d = Boucles.addD(d, 1)) if (Boucles.isOff(d)) return false; return true; }), "jamais dehors un jour fermé");
});

test("la capacité est jugée par le moteur", () => {
  const T = camions(); T[0].cap = 20; T[1].days.forEach(d => d.lot.vol = 40); T[0].days.forEach(d => d.lot.vol = 10);
  const R = Boucles.analyse(T, { centroids: CENT, baseOf: t => BASES[t.b], params: { vlMax: 10 } });
  assert.equal(R.matches.length, 0);
  assert.ok((R.kpi.excluded.volume || 0) >= 1);
});

test("un rendement minimum très haut écarte le retour (garde-fou G5 du moteur)", () => {
  const R = run({ rend: 5000 });
  assert.equal(R.matches.length, 0);
  assert.ok((R.kpi.excluded.rendement || 0) >= 1);
});

test("ouvrir une route : un chantier Aix → Lyon peut servir de retour au camion de Metz", () => {
  const R = run(); R.trucks = camions();
  const T = camions(); const res = Boucles.analyse(T, { centroids: CENT, baseOf: t => BASES[t.b], params: {} });
  const r = Boucles.searchRoute(res, T, { c: "13", l: "69", date: "2026-10-14", flex: 2, vol: 20, excludeKey: "MRS", depotCp: BASES.MRS.cp }, CENT, {});
  assert.ok(r.list.some(x => !x.near && x.truck.plate === "AA-111-AA"));
});

test("règle des 150 km : un retour qui finirait loin du dépôt un vendredi est refusé par le moteur", () => {
  const T = camions();
  // chantier B chargé jeu. 15/10, livré ven. 16/10 à Lyon, 470 km de Metz : pas de retour avant le week-end
  T[1].days = [jour("2026-10-15", lot("13", "69", "MARTIN", 30)), jour("2026-10-16", lot("13", "69", "MARTIN", 30))];
  T[0].days = [jour("2026-10-12", lot("57", "13", "DUPONT", 30)), jour("2026-10-14", lot("57", "13", "DUPONT", 30))];
  const R = Boucles.analyse(T, { centroids: CENT, baseOf: t => BASES[t.b], params: {} });
  assert.equal(R.matches.length, 0);
  assert.ok((R.kpi.excluded["150 km"] || 0) + (R.kpi.excluded["week-end"] || 0) >= 1);
});

test("camion déjà pris : le chantier suivant du camion A est jugé par evaluerPlanning", () => {
  const T = camions();
  const R = Boucles.analyse(T, { centroids: CENT, baseOf: t => BASES[t.b], params: {} });
  const anc = R.trips.find(t => t.lots[0].client === "DUPONT"), acc = R.lots.find(l => l.client === "MARTIN");
  const args = { anc, truck: T[0], acc: { ...acc, agence: "MRS", depotCp: BASES.MRS.cp }, accSeul: true, P: { ...Boucles.DEFAULTS }, flex: 0 };
  assert.ok(Boucles.evaluerRetour({ ...args, nextLot: null }).ok, "sans chantier suivant, le retour tient");
  // le camion de Metz doit charger à Metz le jeu. 15/10 : le retour le laisse à Lyon ce jour-là
  const suivant = { client: "SUIVANT", d: "2026-10-15", d2: "2026-10-15", cpC: BASES.METZ.cp, cpL: "69003", vol: 15, etp: 2 };
  const ev = Boucles.evaluerRetour({ ...args, nextLot: suivant });
  assert.equal(ev.ok, false);
  assert.deepEqual(ev.why, ["camion pris"]);
});

test("volume lu dans le planning : nombre, texte « 30 m3 », ou noté un autre jour du même chantier", () => {
  assert.equal(Boucles.volumeDe(30), 30);
  assert.equal(Boucles.volumeDe("30 m3"), 30);
  assert.equal(Boucles.volumeDe("12,5 m³"), 12.5);
  assert.equal(Boucles.volumeDe("DUPONT"), null);
  const T = camions();
  T[1].days[0].lot.vol = null;   // volume noté seulement le jour de la livraison
  const R = Boucles.analyse(T, { centroids: CENT, baseOf: t => BASES[t.b], params: {} });
  assert.equal(R.lots.find(l => l.client === "MARTIN").vol, 15);
});

test("abaques de manutention : cadence par prestation, livraison + 20 %, journée de 9 h", () => {
  const P = { ...Boucles.DEFAULTS };
  // 30 m³ en Standing à 2 : 30 / (20 × 2) × 9 h = 6 h 45 au chargement ; 30 / (24 × 2) × 9 = 5 h 37 → 5 h 45
  assert.deepEqual(Boucles.durees({ vol: 30, etp: 2, prest: "STD" }, P), [6.75, 5.75, "STANDING"]);
  // Optimum = cadence de Standing + (16 m³) ; 60 m³ sans équipe lue → 3 personnes
  assert.deepEqual(Boucles.durees({ vol: 60, prest: "Optimum" }, P).slice(0, 2), [11.25, 9.5]);
  // plancher de 2 h ; prestation illisible → celle des réglages
  assert.equal(Boucles.durees({ vol: 3, etp: 2, prest: "" }, { ...P, prestDef: "ACCESS" })[0], 2);
  assert.equal(Boucles.prestationDe("Standing +"), "STANDING+");
  assert.equal(Boucles.prestationDe("acc+"), "ACCESS+");
});
