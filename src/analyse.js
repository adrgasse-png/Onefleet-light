/* Cœur d'analyse des retours à vide.
   - Lecture des plannings (blocs camion × jour), trajets, retours à vide : propre à cet outil.
   - Jugement d'un retour (« le camion A, qui rentre à vide, prend le chantier B ») : délégué au
     moteur v2 de OneFleet (`moteur/engine/jour`, `evaluerTournee` et `evaluerPlanning`), copié à
     l'identique dans `moteur/`. Aucune règle de calendrier, de détour, de rendement, de week-end
     ou de capacité n'est réécrite ici : on décrit la tournée, le moteur rend le verdict.
   Fonctionne dans le navigateur (bundle IIFE `Boucles`) et sous Node (tests). */
import {
  evaluerTournee, evaluerPlanning, kmEntre, kmLotSeul, estJourFerme, nomFerie, jourOuvre,
} from "../moteur/engine/jour/index.js";
import { GPS, cpConnu } from "../moteur/data/gps.js";
import { etpAbaque } from "../moteur/data/referentiels.js";

const up = s => String(s ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const isoD = d => { const x = new Date(d.getTime() + 12 * 3600e3); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); };
const dayDiff = (a, b) => Math.round((new Date(b + "T12:00") - new Date(a + "T12:00")) / 864e5);
const addD = (s, n) => { const d = new Date(s + "T12:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const wd = s => new Date(s + "T12:00").getDay();
// Jours fermés : ceux du moteur (week-ends et 11 fériés nationaux).
const isOff = s => estJourFerme(s);
const nextWork = s => { let d = addD(s, 1); while (isOff(d)) d = addD(d, 1); return d; };
const prevWork = s => { let d = addD(s, -1); while (isOff(d)) d = addD(d, -1); return d; };
const workShift = (s, n) => { let d = s; for (let k = 0; k < Math.abs(n); k++) d = n > 0 ? nextWork(d) : prevWork(d); return d; };
function havVol(a, b) { const R = 6371, t = Math.PI / 180, dl = (b[0] - a[0]) * t, dn = (b[1] - a[1]) * t, x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }

/* ===== Codes postaux : le moteur raisonne en CP, les plannings en départements ===== */
const GPS_KEYS = Object.keys(GPS).filter(k => !k.startsWith("97"));
const CP_PROCHE = new Map();
/* CP du référentiel du moteur le plus proche d'un point (dépôt d'agence, centre de département) */
function cpProche(lat, lon) {
  const k = lat.toFixed(3) + "," + lon.toFixed(3);
  if (CP_PROCHE.has(k)) return CP_PROCHE.get(k);
  let best = null, bd = 1e9;
  for (const cp of GPS_KEYS) { const d = havVol([lat, lon], GPS[cp]); if (d < bd) { bd = d; best = cp; } }
  CP_PROCHE.set(k, best);
  return best;
}
/* CP d'une cellule de planning : le CP saisi s'il est connu du moteur, sinon le CP le plus proche du centre du département */
function cpDe(raw, dept, centroids) {
  if (raw != null && raw !== "") {
    const s = typeof raw === "number" ? String(raw).padStart(5, "0") : String(raw).trim();
    if (/^\d{5}$/.test(s) && cpConnu(s) && GPS[s]) return s;
  }
  if (typeof dept === "string" && centroids[dept]) return cpProche(centroids[dept][0], centroids[dept][1]);
  return null;
}

/* département à partir d'une cellule : 2 chiffres, code postal 5 chiffres (zéro initial perdu par Excel), 2A/2B, dépôt */
function deptOf(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    if (!Number.isInteger(v)) return null;
    if (v >= 1000 && v <= 99999) { const s = String(v).padStart(5, "0"); if (s.startsWith("20")) return +s.slice(2, 3) <= 1 ? "2A" : "2B"; if (s.startsWith("97")) return { dom: true }; return s.slice(0, 2); }
    if (v >= 1 && v <= 95 && v !== 20) return String(v).padStart(2, "0");
    return null;
  }
  const s = up(v);
  if (/^(DEPOT|DEPÔT|GM|GARDE ?MEUBLE|SELF|AGENCE)$/.test(s)) return "BASE";
  if (/^2A$|^2B$/.test(s)) return s;
  if (/^\d{5}$/.test(s)) return deptOf(+s);
  if (/^\d{1,2}$/.test(s)) return deptOf(+s);
  if (/^I[- ]/.test(s)) return { intl: true };
  return null;
}
/* volume d'un chantier : un nombre, ou un texte « 30 », « 30 m3 », « 30,5 m³ » (saisi en texte dans Excel) */
function volumeDe(v) {
  if (typeof v === "number") return v > 0 && v < 500 ? v : null;
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,3}(?:[.,]\d+)?)\s*(?:m3|m³|m)?$/i);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}
/* effectif : « 2 », « 2 ETP », « 3 pers » */
function effectifDe(v) {
  if (typeof v === "number") return v > 0 && v < 20 ? v : null;
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2})\s*(?:etp|pers\.?|dem\.?)?$/i);
  return m ? +m[1] : null;
}
/* capacité en m³ lue dans l'en-tête camion : « EY 441 WT 50H+50 » = 50 + 50 (remorque) ; « … 20 » = 20 m³ */
function capacityOf(h) {
  if (!h) return null;
  const r = up(h).replace(/[A-Z]{2}[ -]?\d{3}[ -]?[A-Z]{2}/, "").replace(/\b\d{3,4} ?[A-Z]{2,3} ?\d{2}\b/, "");
  const n = (r.match(/\d{1,3}/g) || []).map(Number).filter(x => x >= 3 && x <= 120);
  return n.length ? n.reduce((a, b) => a + b, 0) : null;
}

/* ===== Réglages =====
   Les seuils de l'écran sont des RÉGLAGES du moteur, passés en second argument d'`evaluerTournee`
   (jamais en modifiant `moteur/engine/jour/reglages.js`). Les autres (minEmpty, minLoaded, vlMax,
   minEco, gapMax) sont des filtres de lecture du planning et d'affichage, propres à cet outil. */
const DEFAULTS = { minEmpty: 200, minLoaded: 150, detMax: 500, rend: 300, gapMax: 3, we150: 150, prestDef: "STANDING", vlMax: 20, minEco: 50, sameDayVol: 0, flexB: 0 };

/* ===== Abaques OneFleet (version transmise le 02/10/2026, plus récente que celles du moteur extrait) =====
   Manutention : m³ traités par une personne en une journée de 9 h, au CHARGEMENT ; à la livraison,
   la cadence du chargement + 20 %. Optimum reprend la cadence de Standing +.
   Conduite : 9 h de conduite par jour (4 h 30 · pause 45 min · 4 h 30), départ vers 7 h 30, 70 km/h,
   soit 630 km par jour. */
const ABAQUES = {
  journeeH: 9, kmParJour: 630, vitesse: 70, departH: 7.5, bonusLivraison: 0.2,
  cadenceChg: { ACCESS: 24, "ACCESS+": 22, STANDING: 20, "STANDING+": 16, OPTIMUM: 16 },
};
const PRESTATIONS = { ACCESS: "Access", "ACCESS+": "Access +", STANDING: "Standing", "STANDING+": "Standing +", OPTIMUM: "Optimum" };
/* prestation lue dans le planning (« Standing + », « STD+ », « ACC », « OPT »…) ; null si illisible */
function prestationDe(v) {
  const t = up(v).replace(/\s+/g, "");
  if (!t) return null;
  const plus = /\+|PLUS$/.test(t);
  if (/^OPT/.test(t)) return "OPTIMUM";
  if (/^(STANDING|STAND|STD|ST)/.test(t)) return plus ? "STANDING+" : "STANDING";
  if (/^(ACCESS|ACCES|ACC|AC)/.test(t)) return plus ? "ACCESS+" : "ACCESS";
  return null;
}
function reglagesMoteur(P) {
  return {
    detourMaxKm: P.detMax,
    rendementMinKmJ: P.rend,
    coupureChargeeMaxKm: P.we150,
    // La recherche de boucle refuse toujours un garde-fou dépassé (contrat § 5, niveaux.gardes).
    niveaux: { gardes: "refus" },
    // Abaques de conduite : une journée de travail de 9 h, 630 km au compte juste (9 h × 70 km/h).
    // Le compte large garde le défaut du moteur (600 km/j, manutention + 15 %), « à confirmer ».
    heuresJour: ABAQUES.journeeH,
    comptes: { large: { kmParJour: 600, margeDuree: 0.15 }, juste: { kmParJour: ABAQUES.kmParJour, margeDuree: 0 } },
    // `deuxOpsParJour` reste au défaut du moteur ("toujours", C5 « à caler ») : sa valeur "jamais"
    // compte aussi le débordement d'une livraison sur le lendemain matin, ce qui n'est pas la règle
    // de terrain « pas de rechargement le jour de la livraison A » — appliquée en filtre plus bas.
  };
}
/* durées de manutention [CHG, LIV] en heures, selon les abaques : volume ÷ (cadence × équipe), sur une
   journée de 9 h. Équipe lue dans le planning, sinon celle du moteur (2, 3 au-delà de 50 m³). Plancher 2 h
   (celui du moteur), arrondi au quart d'heure. Volume inconnu : une demi-journée (4 h 30). */
function durees(lot, P) {
  const prest = prestationDe(lot.prest) || P.prestDef || "STANDING";
  if (lot.vol == null) return [ABAQUES.journeeH / 2, ABAQUES.journeeH / 2, prest];
  const equipe = lot.etp > 0 ? lot.etp : etpAbaque(lot.vol);
  const cad = ABAQUES.cadenceChg[prest] || ABAQUES.cadenceChg.STANDING;
  const h = c => Math.max(2, Math.ceil(lot.vol / (c * equipe) * ABAQUES.journeeH * 4) / 4);
  return [h(cad), h(cad * (1 + ABAQUES.bonusLivraison)), prest];
}

/* ===== Description d'une tournée pour le moteur ===== */
function opLibre(souhaite, d0, d1, dur) { return { dureeH: dur, souhaite, flex: [d0, d1], date: null, confirme: false }; }
function opImposee(date, dur) { return { dureeH: dur, souhaite: date, flex: [date, date], date, confirme: false }; }
/* l'ANCRE : le dernier chantier du trajet qui rentre à vide, aux dates du planning */
function lotAnc(anc, truck, P) {
  const la = anc.lots[anc.lots.length - 1];
  const [dC, dL] = durees(la, P);
  const liv = anc.end > la.d ? opImposee(anc.end, dL) : opLibre(la.d, la.d, workShift(la.d, 3), dL);
  return { id: "ANC", nom: la.client || "Ancre", agence: truck.base.key, depotCp: truck.base.cp, cpC: la.cpC, cpL: la.cpL, volume: la.vol ?? 0, chg: opImposee(la.d, dC), liv };
}
/* l'ACCROCHÉ : chargement à sa date (flex 0) ou libre dans ± flex jours ouvrés ; livraison libre ensuite */
function lotAcc(acc, P, flex) {
  const [dC, dL] = durees(acc, P);
  const chg = flex > 0 ? opLibre(acc.d, workShift(acc.d, -flex), workShift(acc.d, flex), dC) : opImposee(acc.d, dC);
  const souhL = acc.d2 && acc.d2 > acc.d ? acc.d2 : acc.d;
  const liv = opLibre(souhL, chg.flex[0], workShift(acc.d, flex + 6), dL);
  return { id: "ACC", nom: acc.client || "Accroché", agence: acc.agence || "ACC", depotCp: acc.depotCp, cpC: acc.cpC, cpL: acc.cpL, volume: acc.vol ?? 0, chg, liv };
}
const ORDRE_SEUL = [{ lot: "ANC", type: "CHG" }, { lot: "ANC", type: "LIV" }];
const ORDRE_RETOUR = [...ORDRE_SEUL, { lot: "ACC", type: "CHG" }, { lot: "ACC", type: "LIV" }];
function camionDe(truck) { return { id: "pl", agence: truck.base.key, depotCp: truck.base.cp, capacite: truck.cap ?? null }; }

/* Le prochain chantier du camion de l'ancre après son trajet : sert au contrôle « camion déjà pris » (evaluerPlanning) */
function tourneeSuivante(nextLot, truck, P) {
  if (!nextLot) return null;
  const [dC, dL] = durees(nextLot, P);
  const liv = nextLot.d2 > nextLot.d ? opImposee(nextLot.d2, dL) : opLibre(nextLot.d, nextLot.d, workShift(nextLot.d, 3), dL);
  return { id: "suivante", camion: camionDe(truck), lots: [{ id: "N", nom: nextLot.client, agence: truck.base.key, depotCp: truck.base.cp, cpC: nextLot.cpC, cpL: nextLot.cpL, volume: nextLot.vol ?? 0, chg: opImposee(nextLot.d, dC), liv }], ordre: [{ lot: "N", type: "CHG" }, { lot: "N", type: "LIV" }] };
}

/* Codes du moteur → libellés courts de l'écran (filtres et compteurs) */
const MOTIF = {
  Q17: "week-end", COUPURE_CHARGEE_LOIN: "150 km", CAPACITE: "volume", DATES_INCOMPATIBLES: "date", DATE_NON_OUVREE: "jour fermé",
  FLEX_INTENABLE: "date", KM_EVITES_NEGATIFS: "gain", SANS_GAIN: "gain", DETOUR: "détour", RENDEMENT: "rendement",
  CAMION_DEJA_PRIS: "camion pris", CP_INCONNU: "CP inconnu", ORDRE_INVALIDE: "ordre", HORS_FLEX: "date", TERRITOIRE: "territoire",
};
const BLOQUANT = s => s.niveau === "refus" || s.niveau === "rouge" || (s.niveau === "orange" && s.code !== "SERRE");

/* L'ancre et sa base de comparaison (le camion de l'ancre seul, qui rentre à vide), mémoïsés par trajet.
   Les dates de l'ancre sont celles du planning, un fait. Si le moteur ne les tient pas (manutention
   plus lente que prévu, chargement noté tard), on relâche d'abord le chargement de l'ancre (trois jours
   ouvrés en arrière), puis sa livraison (deux jours ouvrés en avant) : ce qui compte pour un retour,
   c'est où et quand le camion se libère. `ajuste` le dit à l'écran. */
function resoudreAnc(anc, truck, P, cache) {
  const k = anc.key ?? anc;
  if (cache && cache.has(k)) return cache.get(k);
  const reg = reglagesMoteur(P), cam = camionDe(truck);
  const essai = lot => ({ lot, r: evaluerTournee({ camion: cam, lots: [lot], ordre: ORDRE_SEUL }, reg) });
  const tient = x => x.r.verdict !== "refus" && !x.r.signaux.some(s => s.code === "DATES_INCOMPATIBLES");
  const l0 = lotAnc(anc, truck, P);
  let x = essai(l0), ajuste = null;
  if (!tient(x)) {
    const l1 = { ...l0, chg: { ...l0.chg, date: null, flex: [workShift(l0.chg.souhaite, -3), l0.chg.souhaite] } };
    const x1 = essai(l1);
    if (tient(x1)) { x = x1; ajuste = "chargement"; }
    else {
      const d = l0.liv.souhaite;
      const l2 = { ...l1, liv: { ...l0.liv, date: null, flex: [d, workShift(d, 2)] } };
      const x2 = essai(l2);
      if (tient(x2)) { x = x2; ajuste = "livraison"; }
    }
  }
  const out = { lot: x.lot, base: x.r, ajuste };
  if (cache) cache.set(k, out);
  return out;
}

/* évalue « le camion de l'ancre, qui rentre à vide, prend l'accroché en retour » — par le moteur */
function evaluerRetour({ anc, truck, acc, accSeul, nextLot, P, flex, cacheSeul }) {
  const reg = reglagesMoteur(P);
  const { lot: lAnc, base, ajuste } = resoudreAnc(anc, truck, P, cacheSeul);
  const lAcc = lotAcc(acc, P, flex);
  const entree = { camion: camionDe(truck), lots: [lAnc, lAcc], ordre: ORDRE_RETOUR };
  const r = evaluerTournee(entree, reg);
  const signaux = r.signaux.slice();
  // camion déjà pris : la tournée proposée et le chantier suivant du camion, jugés par evaluerPlanning
  const suiv = tourneeSuivante(nextLot, truck, P);
  if (suiv && r.verdict !== "refus") {
    const pl = evaluerPlanning({ tournees: [{ id: "retour", ...entree }, suiv] }, reg, { touchee: "retour" });
    pl.signaux.filter(s => s.code === "CAMION_DEJA_PRIS").forEach(s => signaux.push(s));
  }
  const g = (r.greffes || []).find(x => x.lot === "ACC") || {};
  const c = r.chiffres || {};
  // gain : km évités du moteur (lots faits seuls − tournée). Si le camion de l'accroché garde sa tournée
  // (l'accroché n'était pas seul sur son trajet), son trajet propre n'est pas économisé : on retire l'accroché
  // fait seul et on garde son trajet chargé.
  const kmAcc = kmEntre(lAcc.cpC, lAcc.cpL);
  const eco = Math.round(accSeul ? c.kmEvites : c.kmEvites - kmLotSeul(lAcc.depotCp, lAcc.cpC, lAcc.cpL) + kmAcc);
  const why = [];
  signaux.filter(BLOQUANT).forEach(s => { const m = MOTIF[s.code] || s.code; if (!why.includes(m)) why.push(m); });
  if (!why.length && eco < P.minEco) why.push("gain");
  const arr = r.arrets || [];
  const at = (lot, type) => (arr.find(a => a.lot === lot && a.type === type) || {}).date || null;
  const chgAcc = at("ACC", "CHG");
  if (!why.length && c.joursVides > P.gapMax) why.push("attente");
  // filtre de terrain (règle du POC) : pas de rechargement le jour où l'ancre est livrée, sauf petit volume
  // livré (0 = jamais). Jugé sur le jour où la livraison COMMENCE, celui du planning : si elle déborde
  // sur le lendemain matin, le moteur l'enchaîne avec le chargement et le calendrier le montre.
  if (!why.length && chgAcc && chgAcc === at("ANC", "LIV") && !(lAnc.volume <= P.sameDayVol && P.sameDayVol > 0)) why.push("même jour");
  return {
    ok: !why.length, why, eco, ajusteAnc: ajuste, verdict: r.verdict, serre: signaux.some(s => s.code === "SERRE"),
    signaux, r, base, entree,
    det: g.detourKm ?? null, rallJ: g.rallongeJ ?? null, g2: g.g2, g5: g.g5,
    rendMin: g.rallongeJ != null ? Math.round(P.rend * g.rallongeJ) : null,
    repo: kmEntre(lAnc.cpL, lAcc.cpC), loaded: kmAcc, after: kmEntre(lAcc.cpL, lAnc.depotCp), empty: kmEntre(lAnc.cpL, lAnc.depotCp),
    chgAcc, livAnc: at("ANC", "LIV"), livAcc: at("ACC", "LIV"), retour: c.retour, retourSeul: base.chiffres?.retour,
    coupure: c.coupuresDepot > 0, joursVides: c.joursVides, joursCamion: c.joursCamion, joursSeul: base.chiffres?.joursCamion,
    volOk: truck.cap == null || acc.vol == null ? null : acc.vol <= truck.cap,
    shift: chgAcc ? dayDiff(acc.d, chgAcc) : null,
  };
}

/* dates candidates (affichage) : la date prévue, puis ±1, ±2… jours ouvrés */
function flexDates(d0, flex) { const out = [d0]; let a = d0, b = d0; for (let k = 0; k < flex; k++) { a = prevWork(a); b = nextWork(b); out.push(b, a); } return out; }

/* recherche « j'ouvre une route » : mon chantier devient le retour d'un camion d'une autre agence */
function searchRoute(res, trucks, q, centroids, params) {
  const P = Object.assign({}, DEFAULTS, params || {});
  if (!centroids[q.c] || !centroids[q.l]) return { err: "départements inconnus" };
  const cpC = cpDe(q.cpC, q.c, centroids), cpL = cpDe(q.cpL, q.l, centroids);
  const depotMoi = q.depotCp || null;
  const acc = { c: q.c, l: q.l, cpC, cpL, d: q.date, d2: q.date, vol: q.vol || null, etp: null, client: "Votre chantier", agence: q.excludeKey || "moi", depotCp: depotMoi || cpC };
  const out = [], cacheSeul = new Map();
  res.trips.filter(t => t.isEmpty).forEach(T => {
    const tr = trucks[T.truck];
    if (!tr.base || !tr.base.cp) return;
    if (tr.cap != null && tr.cap <= P.vlMax) return;
    if (q.excludeKey && tr.base.key === q.excludeKey) return;
    if (kmEntre(T.lots[T.lots.length - 1].cpL, cpC) > P.detMax + 150) return;   // préfiltre large
    if (dayDiff(T.end, q.date) < -q.flex - 1 || dayDiff(T.end, q.date) > q.flex + P.gapMax + 6) return;
    const ev = evaluerRetour({ anc: T, truck: tr, acc, accSeul: !!depotMoi, nextLot: T.next, P, flex: q.flex, cacheSeul });
    const near = !ev.ok && ev.why.length === 1 && ev.eco > 0;
    if (ev.ok || near) out.push(Object.assign({ T, truck: tr, near, cap: tr.cap }, ev, { shift: ev.chgAcc ? dayDiff(q.date, ev.chgAcc) : null }));
  });
  out.sort((x, y) => (x.near - y.near) || (x.serre - y.serre) || y.eco - x.eco);
  return { list: out.filter(x => !x.near).concat(out.filter(x => x.near).slice(0, 5)), loaded: kmEntre(cpC, cpL), ownLegs: depotMoi ? kmEntre(depotMoi, cpC) + kmEntre(cpL, depotMoi) : 0 };
}

/* lit un onglet de mois : renvoie les camions et leurs blocs jour */
function parseTrucksSheet(X, ws, planning) {
  const R = X.utils.decode_range(ws["!ref"]);
  void R;
  const g = (r, c) => { const x = ws[X.utils.encode_cell({ r, c })]; return x && x.t !== "e" ? x.v : undefined; };
  // lignes de séparation (MMM / MME / N) et colonnes de début de camion
  const sepCount = {}; const startCols = new Set();
  for (const k in ws) {
    if (k[0] === "!") continue;
    const x = ws[k];
    if (x.t === "s" && up(x.v) === "MMM") { const p = X.utils.decode_cell(k); if (up(g(p.r, p.c + 1)) === "MME") { sepCount[p.r] = (sepCount[p.r] || 0) + 1; startCols.add(p.c); } }
  }
  const seps = Object.keys(sepCount).map(Number).filter(r => sepCount[r] >= 2).sort((a, b) => a - b);
  if (!seps.length || !startCols.size) return null;
  const cols = [...startCols].sort((a, b) => a - b), firstTruck = cols[0];
  // date de chaque bloc : une date dans la zone résumé (avant la 1re colonne camion) entre deux séparateurs
  const blocks = []; let prev = seps[0] - (seps.length > 1 ? seps[1] - seps[0] : 13);
  for (const s of seps) {
    let d = null;
    for (let r = Math.max(0, prev + 1); r < s && !d; r++) for (let c = 0; c < firstTruck && !d; c++) { const v = g(r, c); if (v instanceof Date) d = isoD(v); }
    blocks.push({ r0: Math.max(0, prev + 1), r1: s - 1, d }); prev = s;
  }
  const hdrTop = Math.max(0, blocks[0].r0 - 1);
  const trucks = [];
  cols.forEach(c => {
    // en-tête : agence, chauffeur, immatriculation au-dessus du premier bloc
    const hdr = []; for (let r = 0; r <= Math.min(hdrTop, 8); r++) { const v = g(r, c); if (v != null && v !== "" && typeof v === "string") hdr.push(v.trim()); }
    const plate = hdr.find(h => /[A-Z]{2}[ -]?\d{3}[ -]?[A-Z]{2}|\d{3,4} ?[A-Z]{2,3} ?\d{2}/.test(up(h))) || "";
    const agency = hdr.find(h => h !== plate && !/^besoin$/i.test(h) && !/^\d+$/.test(h)) || "";
    const days = [];
    blocks.forEach(b => {
      if (!b.d) return;
      const lines = []; for (let r = b.r0; r <= b.r1; r++) lines.push([g(r, c), g(r, c + 1), g(r, c + 2)]);
      // le lot : première ligne où les deux premières cellules sont des départements, suivie du nom du client
      let lot = null; const text = [];
      for (let i = 0; i < lines.length; i++) {
        const [a, b2] = lines[i];
        if (!lot) {
          const dc = deptOf(a), dl = deptOf(b2); const cli = lines[i + 1] && lines[i + 1][0];
          if (dc && dl && typeof cli === "string" && cli.trim() && deptOf(cli) === null) {
            if (/^SUITE\b/.test(up(cli))) { text.push("suite"); i += 2; continue; } // jour de suite d'un chantier déjà lu
            const vol = lines[i + 2] ? volumeDe(lines[i + 2][0]) : null, etp = lines[i + 2] ? effectifDe(lines[i + 2][1]) : null;
            lot = { c: dc, l: dl, cRaw: a, lRaw: b2, prest: typeof lines[i][2] === "string" ? lines[i][2].trim() : "", client: cli.trim(), vol, etp }; i += 2; continue;
          }
        }
        lines[i].forEach(v => { if (typeof v === "string" && v.trim() && !/^(P|CC|R)$/.test(v.trim())) text.push(v.trim()); });
      }
      const t = up(text.join(" "));
      days.push({ d: b.d, lot, active: !!lot || /\b(ROUTE|LIV|RETOUR|CHG|CHGT|CHARG)/.test(t), retour: /\bRETOUR\b/.test(t) });
    });
    if (plate || days.some(x => x.lot)) trucks.push({ planning, col: c, plate, agency, cap: capacityOf(plate), days });
  });
  return { trucks, dates: blocks.map(b => b.d).filter(Boolean) };
}

/* trajets, retours à vide, rapprochements */
function analyse(trucks, { centroids, baseOf, params, onProgress }) {
  const P = Object.assign({}, DEFAULTS, params || {});
  const cpOf = (raw, d) => cpDe(raw, d, centroids);
  const lots = [], trips = [];
  trucks.forEach((t, ti) => {
    const base = baseOf(t); t.base = base;
    const ds = t.days.slice().sort((a, b) => a.d < b.d ? -1 : 1);
    // dédoublonnage : un même lot répété sur plusieurs jours (chargement puis livraison) = un seul lot
    const seen = new Map();
    ds.forEach(x => {
      if (!x.lot) return;
      const L = x.lot, k = up(L.client) + "|" + (L.c.dom || L.c.intl ? "X" : L.c) + "|" + (L.l.dom || L.l.intl ? "X" : L.l);
      const p = seen.get(k);
      // même chantier sur plusieurs jours : un seul lot ; un volume ou un effectif notés seulement un autre jour sont repris
      if (p && dayDiff(p.d2, x.d) <= 2) { p.d2 = x.d; x.dup = p; if (p.vol == null && L.vol != null) p.vol = L.vol; if (p.etp == null && L.etp != null) p.etp = L.etp; return; }
      const c = L.c === "BASE" ? (base && base.dept) : L.c, l = L.l === "BASE" ? (base && base.dept) : L.l;
      const cpC = L.c === "BASE" ? base && base.cp : cpOf(L.cRaw, c), cpL = L.l === "BASE" ? base && base.cp : cpOf(L.lRaw, l);
      const o = { id: lots.length, truck: ti, planning: t.planning, agency: t.agency, plate: t.plate, d: x.d, d2: x.d, client: L.client, c, l, cpC, cpL, vol: L.vol, etp: L.etp, prest: L.prest, km: cpC && cpL ? kmEntre(cpC, cpL) : null };
      lots.push(o); seen.set(k, o); x.lotRef = o;
    });
    // trajets : suite de jours actifs (écart ≤ 2 jours) commençant par un lot longue distance
    let cur = null;
    ds.forEach(x => {
      const L = x.lotRef || (x.dup || null);
      if (cur && dayDiff(cur.end, x.d) > 2) { trips.push(cur); cur = null; }
      if (!x.active && !L) return;
      if (!cur) { if (L && L.km != null && L.km >= P.minLoaded) cur = { truck: ti, lots: [L], start: x.d, end: x.d }; return; }
      cur.end = x.d; if (L && !cur.lots.includes(L)) cur.lots.push(L);
      if (L && L.km != null && L.km < P.minLoaded && base && base.cp && L.cpC && kmEntre(L.cpC, base.cp) < P.minEmpty) { trips.push(cur); cur = null; }
    });
    if (cur) trips.push(cur);
  });
  // retour à vide de chaque trajet : distance de la dernière livraison au dépôt
  const lotsByTruck = new Map();
  lots.forEach(l => { if (!lotsByTruck.has(l.truck)) lotsByTruck.set(l.truck, []); lotsByTruck.get(l.truck).push(l); });
  trips.forEach((tr, i) => {
    const t = trucks[tr.truck], last = tr.lots[tr.lots.length - 1];
    tr.key = i; tr.lastL = last.l;
    const bcp = t.base && t.base.cp;
    tr.empty = bcp && last.cpL ? kmEntre(last.cpL, bcp) : null;
    tr.hasReturnLoad = tr.lots.length > 1 && tr.empty != null && tr.empty < P.minEmpty && bcp && last.cpC && kmEntre(last.cpC, bcp) >= P.minEmpty;
    tr.isEmpty = tr.empty != null && tr.empty >= P.minEmpty && !!last.cpC && !!last.cpL;
    tr.free = tr.lots.length === 1;
    // le chantier suivant du camion (contrôle « camion déjà pris »)
    tr.next = (lotsByTruck.get(tr.truck) || []).filter(l => l.d > tr.end && !tr.lots.includes(l)).sort((a, b) => a.d < b.d ? -1 : 1)[0] || null;
  });
  // rapprochements : un trajet qui rentre à vide (l'ancre) × un lot d'un autre camion (l'accroché) chargeant près de la dernière livraison de l'ancre
  const lotTrip = new Map(); trips.forEach(tr => tr.lots.forEach(l => lotTrip.set(l, tr)));
  const matches = [], excluded = {}; const exc = w => { excluded[w] = (excluded[w] || 0) + 1; };
  const cacheSeul = new Map();
  let evals = 0;
  const empties = trips.filter(tr => tr.isEmpty);
  empties.forEach((anc, ia) => {
    const tAnc = trucks[anc.truck];
    if (onProgress) onProgress(ia, empties.length);
    if (tAnc.cap != null && tAnc.cap <= P.vlMax) return; // les véhicules légers ne font pas de boucle
    const derAnc = anc.lots[anc.lots.length - 1];
    lots.forEach(acc => {
      if (acc.truck === anc.truck || acc.km == null || acc.km < P.minLoaded || !acc.cpC || !acc.cpL) return;
      const gap = dayDiff(anc.end, acc.d); if (gap < -P.flexB - 2 || gap > P.gapMax + P.flexB + 4) return;   // préfiltre large
      const tAcc = trucks[acc.truck]; if (!tAcc.base || !tAcc.base.cp) return;
      if (tAnc.base.key === tAcc.base.key) return; // retours uniquement : pas d'enchaînement au départ de la même agence
      // l'accroché doit être un départ de sa propre agence : un lot chargé loin de son dépôt est déjà le retour chargé d'un autre camion
      if (kmEntre(tAcc.base.cp, acc.cpC) > P.minEmpty) return;
      if (kmEntre(derAnc.cpL, acc.cpC) > P.detMax) return;
      const trAcc = lotTrip.get(acc), accSeul = !trAcc || trAcc.lots.length === 1;
      evals++;
      const ev = evaluerRetour({ anc, truck: tAnc, acc: { ...acc, agence: tAcc.base.key, depotCp: tAcc.base.cp }, accSeul, nextLot: anc.next, P, flex: P.flexB, cacheSeul });
      if (!ev.ok) { exc(ev.why[0]); return; }
      matches.push(Object.assign({ anc, acc, type: "inter-agences", accSeul, cap: tAnc.cap }, ev));
    });
  });
  // tri : ce qui tient au large d'abord, puis le gain
  matches.sort((a, b) => (a.serre - b.serre) || b.eco - a.eco);
  // total sans double compte : chaque ancre et chaque accroché utilisés une fois
  const usedAnc = new Set(), usedAcc = new Set(); let ecoTot = 0, kept = 0;
  matches.forEach(m => { if (usedAnc.has(m.anc) || usedAcc.has(m.acc)) return; usedAnc.add(m.anc); usedAcc.add(m.acc); m.keep = true; ecoTot += m.eco; kept++; });
  return {
    lots, trips, matches, P, evals,
    kpi: {
      lots: lots.length, longLots: lots.filter(l => l.km != null && l.km >= P.minLoaded).length, trips: trips.length,
      emptyTrips: trips.filter(t => t.isEmpty).length, emptyKm: trips.filter(t => t.isEmpty).reduce((s, t) => s + t.empty, 0),
      loopsDone: trips.filter(t => t.hasReturnLoad).length, matches: matches.length, kept, ecoTot,
      serres: matches.filter(m => m.keep && m.serre).length, excluded,
    },
  };
}

export const Boucles = {
  deptOf, parseTrucksSheet, analyse, up, dayDiff, capacityOf, addD, wd, isOff, nomFerie, jourOuvre, evaluerRetour, searchRoute, flexDates,
  DEFAULTS, ABAQUES, PRESTATIONS, prestationDe, durees, volumeDe, cpProche, cpDe, kmEntre, reglagesMoteur, MOTIF,
};
export default Boucles;
