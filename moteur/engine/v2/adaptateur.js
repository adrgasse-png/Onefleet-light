// ═══════════════════════════════════════════════════════════════════════════════════════════════
// L'ADAPTATEUR PLANNING ↔ MODULE (T2, sprint « moteur d'abord », 2026-09-23) — LECTURE SEULE
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Le module `engine/jour` ne connaît que des TOURNÉES (un camion, des lots, un ordre d'arrêts, une
// date imposée ou libre par opération). L'application, elle, garde un BLOB : des lots, leurs liens
// de boucle (`_boucleLiens`, `_boucleWith`…), et pour chaque camion les blocs posés du Gantt
// (`placements`). Ce fichier fait la traduction, et rien d'autre : il ne juge rien, il n'écrit rien,
// il ne corrige rien.
//
// Trois fonctions publiques (`SQUELETTES/signatures-moteur.js`) :
//   · `tourneesDuPlanning(planning)`          — les tournées, déduites des liens des lots ;
//   · `entreeDeTournee(tournee, contexte, r)` — une tournée → une entrée de `evaluerTournee` ;
//   · `planningPourModule(planning, contexte)` — le planning → `{ tournees, touchee }` pour
//                                                `evaluerPlanning` (option « touchée » de T0).
//
// ── LA RÈGLE DES DATES (🟠 H-3, règle centrale § 2) ─────────────────────────────────────────────
// AU REPOS, TOUTE DATE POSÉE EST IMPOSÉE — confirmée, épinglée ET brouillon. Relire le planning ne
// fait donc jamais glisser une date : le module ne fait que contrôler. Seule la tournée TOUCHÉE par
// un geste (`contexte.touchee`) voit ses opérations en brouillon NON épinglées passer libres, avec
// `prefere` = leur date actuelle (le module les laisse où elles sont si la route le permet) et pour
// bornes :
//   · chargement — la flex VENDUE (`dateCVendueMin/Max` de T1 s'ils existent, sinon `_flexC` autour
//     de la date souhaitée, sinon `dateC..dateCmax`) ;
//   · livraison  — les bornes ACTUELLES (décision D11) : `dateLVendueMin/Max` s'ils existent, sinon
//     de `dateLmin` (à défaut la date souhaitée) jusqu'à `dateLmax` (à défaut la date souhaitée
//     + `flexLivraisonJours`, la règle du moteur d'aujourd'hui). Pas d'« avancée sans limite ».
//
// ── LES ÉTATS (T1) ─────────────────────────────────────────────────────────────────────────────
// Lus sur `etatDateC` / `etatDateL` quand le blob les porte (en-tête `X-OneFleet-Etats: 1`). Sinon,
// même règle que la migration 0012 de T1 (`etat_initial_depuis_verrou`, décision D3) :
// `_locked` ou `status = placed_locked` ⇒ les DEUX opérations confirmées ; `dateLivImposee` ⇒
// livraison épinglée ; tout le reste en brouillon.
//
// ── DEUX FENÊTRES, ET POURQUOI ─────────────────────────────────────────────────────────────────
// Le champ `flex` d'une opération sert au module à trois choses : la fenêtre d'une date LIBRE, le
// signal `HORS_FLEX` d'une date imposée, et le calcul du lot « fait seul » (km évités). Au repos,
// l'adaptateur y met la fenêtre COMMERCIALE, exactement celle que le banc lit
// (`scripts/banc/lib/planning-reel.mjs`, `lotDuBlob`) — c'est ce qui rend l'écart au banc nul. Une
// livraison LIBRE d'une tournée touchée reçoit, elle, les bornes D11 ci-dessus : elles sont plus
// étroites (pas d'avance sur la date souhaitée). 🟠 Le module n'a qu'un champ pour deux notions ;
// voir RAPPORT-T2-T3.md.
//
// ── LE TRANSBORDEMENT COCHÉ (retours du 27/09) ─────────────────────────────────────────────────
// Les cases `transboC` / `transboL` du lot (saisie de l'outil, `OneFleet.jsx` ; maquette,
// `versOutil.js` ; lues aussi par `chainBuilder.js` en production, pour l'affichage seulement)
// déplacent l'arrêt du CAMION au dépôt de l'agence vendeuse (`depotDeAgence(soc)`, celui qui sert
// déjà au « fait seul ») et lui donnent la fenêtre du quai. La règle n'est pas écrite ici :
// `transborderLot` (`engine/jour/transbo.js`), la même que la maquette et le banc. Elle prime sur
// les fenêtres ci-dessus pour l'opération transbordée, au repos comme libérée.
// Depuis le 28/09 (règle de Louis, contrat K2) : l'arrêt du camion est un BLOC d'une demi-journée,
// APRÈS la collecte par la navette au chargement, AVANT sa livraison chez le client. Le jour de la
// navette (la date VL, contrat K1 : `op.vl`) n'a PAS de champ en base : dans l'application, `vl` est
// absent, et le module lit la date souhaitée — rien n'est inventé côté base. La maquette, elle, le
// passe par `vlC` / `vlL` (`versOutil.js`), lus ci-dessous : une date VL déplacée d'un lot POSÉ est
// vue de la recherche v2 (complément de l'orchestrateur, 28/09).

import { agLookup } from "../chainBuilder.js";
import { RULES_DEFAULTS, normaliserSeuilsProx, manutHeures, parseDur } from "../../data/referentiels.js";
import { datesAround, addWorkdays } from "../../utils/dates.js";
import { tourneesDeBoucles } from "../../utils/boucleLiens.js";
import { evaluerPlanning, transborderLot } from "../jour/index.js";

export const ETATS = ["brouillon", "epingle", "confirme"];

// ── L'ÉTAT LU ──────────────────────────────────────────────────────────────────────────────────
// Mémoïsé par objet planning : relire deux fois le même planning rend le même état, sans recalcul.
const memoEtat = new WeakMap();

export function lirePlanning(planning) {
  if (planning && typeof planning === "object" && memoEtat.has(planning)) return memoEtat.get(planning);
  const p = planning || {};
  const rules = { ...RULES_DEFAULTS, ...normaliserSeuilsProx(p.rules || {}) };
  const agencesData = p.agencesData || [];
  const vehicles = p.vehicles || [];
  const lots = p.lots || [];
  const lotsById = new Map(lots.map(l => [l.id, l]));
  const vehById = new Map(vehicles.map(v => [v.id, v]));
  const ordreLot = new Map(lots.map((l, i) => [l.id, i]));
  const depotDeAgence = (ag) => (agLookup(ag, agencesData) || {}).cp || null;
  const etat = { rules, agencesData, vehicles, lots, lotsById, vehById, ordreLot, depotDeAgence,
    placements: p.placements || {} };
  if (planning && typeof planning === "object") memoEtat.set(planning, etat);
  return etat;
}

// ── LE DÉCOUPAGE DU GANTT (même règle que le banc, `decouperTournees`) ────────────────────────────
// Un bloc `vid` vers le dépôt TERMINE une course du camion, sauf la coupure du week-end
// (`_weekendDepot`) ; un retour étalé sur deux journées ne compte que pour un.
const versDepot = (b) => b.type === "vid" && String((b._to || {}).label || "").startsWith("Dép");

const triBlocs = (blocs) => [...blocs].sort((a, b) => {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.startH !== b.startH) return a.startH - b.startH;
  return (a.startAbs || 0) - (b.startAbs || 0);
});

function coursesDuCamion(blocs) {
  const tri = triBlocs(blocs);
  const out = [];
  let courante = [];
  for (let i = 0; i < tri.length; i++) {
    const b = tri[i];
    courante.push(b);
    if (!versDepot(b)) continue;
    if (b._weekendDepot) continue;
    const suivant = tri[i + 1];
    if (suivant && versDepot(suivant) && suivant.lotId === b.lotId && !suivant._weekendDepot) continue;
    out.push({ blocs: courante, fermee: true });
    courante = [];
  }
  if (courante.length) out.push({ blocs: courante, fermee: false });
  return out;
}

// ── LES TOURNÉES DU PLANNING ───────────────────────────────────────────────────────────────────
// Une tournée = une composante connexe de la relation « lié à » (liens de boucle, `boucleLiens.js`)
// ∪ « enchaîné sur la même course du camion sans repasser par le dépôt » (le Gantt). La seconde
// relation n'ajoute rien aux boucles décidées : elle couvre la CHAÎNE posée sans lien (deux lots
// enchaînés par le moteur d'aujourd'hui, le camion ne rentrant pas entre les deux — un cas sur
// l'instantané du 21/09, `GQ-156-KL#1`). Un lot posé sans lien ni chaîne = une tournée d'un lot.
// Un lot absent des placements (bandeau) n'est dans aucune tournée.
//
// Rend des tournées `{ id, camion, agence, lots, lotN1, ordre, dates, debut, fin, fermee, liee }`,
// triées comme le banc (camion, puis ordre des courses), ids `${camion}#${n}` identiques au banc.
export function tourneesDuPlanning(planning) {
  const etat = lirePlanning(planning);
  const parent = new Map();
  const trouver = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    let y = x;
    while (parent.get(y) !== r) { const s = parent.get(y); parent.set(y, r); y = s; }
    return r;
  };
  const unir = (a, b) => {
    const ra = trouver(a), rb = trouver(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  // 1. Les courses de chaque camion, et les opérations posées dans l'ordre du Gantt.
  const courses = [];                     // { camion, index, blocs, fermee, lots: [ids] }
  const campDuLot = new Map();            // lot → camion (le premier qui porte une de ses opérations)
  const plIds = Object.keys(etat.placements).sort();
  for (const plId of plIds) {
    const blocs = etat.placements[plId] || [];
    if (!blocs.length) continue;
    coursesDuCamion(blocs).forEach((c, index) => {
      const ids = [];
      for (const b of c.blocs) {
        if (b.type !== "chg" && b.type !== "liv") continue;
        if (!etat.lotsById.has(b.lotId)) continue;
        if (!ids.includes(b.lotId)) ids.push(b.lotId);
        if (!campDuLot.has(b.lotId)) campDuLot.set(b.lotId, plId);
      }
      courses.push({ camion: plId, index, blocs: c.blocs, fermee: c.fermee, lots: ids });
      for (const id of ids) if (!parent.has(id)) parent.set(id, id);
      for (let k = 1; k < ids.length; k++) unir(ids[0], ids[k]);
    });
  }

  // 2. Les liens de boucle — seulement entre lots posés.
  const liee = new Set();
  for (const t of tourneesDeBoucles(etat.lots)) {
    const posees = t.membres.map(m => m.id).filter(id => parent.has(id));
    for (const id of posees) if (posees.length > 1) liee.add(id);
    for (let k = 1; k < posees.length; k++) unir(posees[0], posees[k]);
  }

  // 3. Une tournée par composante ET par camion (un lien entre deux camions ne fusionne pas deux
  //    camions : chacun garde sa tournée). Première course rencontrée = identifiant.
  const parCle = new Map();
  const out = [];
  for (const c of courses) {
    for (const id of c.lots) {
      if (campDuLot.get(id) !== c.camion) continue;
      const cle = `${trouver(id)}@${c.camion}`;
      let t = parCle.get(cle);
      if (!t) {
        t = { cle, camion: c.camion, index: c.index, courses: [], lots: [], fermee: true };
        parCle.set(cle, t);
        out.push(t);
      }
      if (!t.courses.includes(c)) { t.courses.push(c); t.fermee = t.fermee && c.fermee; }
      if (!t.lots.includes(id)) t.lots.push(id);
    }
  }

  return out.map((t) => {
    const blocs = t.courses.flatMap(c => c.blocs);
    const ordre = [];
    const dates = {};
    for (const b of blocs) {
      if (b.type !== "chg" && b.type !== "liv") continue;
      if (!t.lots.includes(b.lotId)) continue;
      const type = b.type === "chg" ? "CHG" : "LIV";
      const k = `${b.lotId}|${type}`;
      if (k in dates) continue;
      dates[k] = b.date;
      ordre.push({ lot: b.lotId, type });
    }
    const lots = [...new Set(ordre.map(o => o.lot))];
    const veh = etat.vehById.get(t.camion) || null;
    const premier = ordre.find(o => o.type === "CHG");
    return {
      id: `${t.camion}#${t.index + 1}`,
      camion: t.camion,
      agence: veh ? veh.ag : null,
      lots,
      lotN1: premier ? premier.lot : (lots[0] ?? null),
      ordre,
      dates,
      debut: blocs[0] ? blocs[0].date : null,
      fin: blocs[blocs.length - 1] ? blocs[blocs.length - 1].date : null,
      fermee: t.fermee,
      liee: lots.some(id => liee.has(id)),
    };
  }).filter(t => t.lots.length);
}

// ── L'ÉTAT D'UNE OPÉRATION ─────────────────────────────────────────────────────────────────────
// `type` : "CHG" | "LIV". Rend "brouillon" | "epingle" | "confirme".
export function etatOperation(lot, type) {
  const cle = type === "CHG" ? "etatDateC" : "etatDateL";
  if (lot && ETATS.includes(lot[cle])) return lot[cle];
  if (lot && (lot._locked || lot.status === "placed_locked")) return "confirme";
  if (type === "LIV" && lot && lot.dateLivImposee) return "epingle";
  return "brouillon";
}

// ── LES FENÊTRES D'UN LOT ──────────────────────────────────────────────────────────────────────
// `commerciale` : la fenêtre que lit le banc (`lotDuBlob`) — HORS_FLEX et lot « fait seul ».
// `libre`       : les bornes d'une opération LIBÉRÉE par un geste (chargement = flex vendue,
//                 livraison = bornes actuelles, décision D11).
// Mémoïsé par objet lot (un lot du blob ne change pas sans être remplacé) et par
// `flexLivraisonJours` : la recherche relit les fenêtres de chaque lot à chaque candidate.
const memoFenetres = new WeakMap();

export function fenetresDuLot(l, rules) {
  const flexL = rules?.flexLivraisonJours ?? 4;
  if (l && typeof l === "object") {
    const m = memoFenetres.get(l);
    if (m && m.flexL === flexL) return m.f;
    const f = calculerFenetres(l, flexL);
    memoFenetres.set(l, { flexL, f });
    return f;
  }
  return calculerFenetres(l, flexL);
}

function calculerFenetres(l, flexL) {
  const flexC = Math.max(0, parseInt(l._flexC ?? 0) || 0);
  const souhaiteC = l.dateCSouhaitee || l.dateC;
  const souhaiteL = l.dateLSouhaitee || l.dateL || l.dateC;

  let chg = null;
  if (l.dateCVendueMin && l.dateCVendueMax) chg = [l.dateCVendueMin, l.dateCVendueMax];
  else if (flexC > 0 && souhaiteC) {
    const fen = datesAround(souhaiteC, flexC);
    chg = fen.length ? [fen[0], fen[fen.length - 1]] : null;
  } else if (l.dateCmax && l.dateC && l.dateCmax > l.dateC) chg = [l.dateC, l.dateCmax];
  else if (souhaiteC) chg = [souhaiteC, souhaiteC];

  let livCommerciale;
  let livLibre;
  if (l.dateLVendueMin && l.dateLVendueMax) {
    livCommerciale = livLibre = [l.dateLVendueMin, l.dateLVendueMax];
  } else if (l.dateLivImposee || !souhaiteL) {
    livCommerciale = livLibre = souhaiteL ? [souhaiteL, souhaiteL] : null;
  } else {
    livCommerciale = [chg ? chg[0] : souhaiteL, addWorkdays(souhaiteL, flexL)];
    livLibre = [l.dateLmin || souhaiteL, l.dateLmax || addWorkdays(souhaiteL, flexL)];
  }
  return { souhaiteC, souhaiteL, chg, livCommerciale, livLibre };
}

// ── UN LOT DU BLOB → UN LOT DU MODULE ──────────────────────────────────────────────────────────
// `dates` : { CHG: iso|null, LIV: iso|null } — les dates posées. `libres` : Set de "CHG"/"LIV" à
// libérer (brouillon non épinglé d'une tournée touchée). `imposees` : dates forcées par le geste.
// La durée d'une manutention : saisie (`dureC`/`dureL`), sinon l'abaque du moteur. Même règle que
// le banc (`lotDuBlob`, `tableArrets`).
export function dureeOp(l, type, rules) {
  return type === "CHG"
    ? (parseDur(l.dureC) || manutHeures(l.vol, l.fteC, rules))
    : (parseDur(l.dureL) || manutHeures(l.vol, l.fteL, rules));
}

// `reglages` (facultatif) : ceux du module, pour la seule valeur qui concerne l'entrée — l'attente
// à quai du transbordement (`reglages.transbo`). Absents : le défaut.
export function lotPourModule(l, etat, { dates = null, libres = null, imposees = null, reglages = null } = {}) {
  const { rules, depotDeAgence } = etat;
  const f = fenetresDuLot(l, rules);
  const op = (type) => {
    const posee = dates ? (dates[type] ?? null) : null;
    const force = imposees && imposees[type] ? imposees[type] : null;
    const etatOp = etatOperation(l, type);
    const libre = !force && !!libres && libres.has(type) && etatOp === "brouillon";
    const flex = type === "CHG" ? f.chg : (libre ? f.livLibre : f.livCommerciale);
    const o = {
      dureeH: dureeOp(l, type, rules),
      souhaite: type === "CHG" ? f.souhaiteC : f.souhaiteL,
      flex,
      date: libre ? null : (force || posee),
      confirme: !libre && !force && !!posee && etatOp === "confirme",
      fte: type === "CHG" ? l.fteC : l.fteL,
    };
    if (libre && posee) o.prefere = posee;
    // La date VL d'une opération transbordée (contrat K1, 28/09) : `vlC` / `vlL` — écrits par la
    // maquette (`versOutil.js`) ; aucun champ en base côté application, donc absents → souhaitée.
    const vl = type === "CHG" ? l.vlC : l.vlL;
    if (vl) o.vl = vl;
    // La route forcée par le planificateur (29/09 soir, contrat K1 du chantier « un bloc bouge
    // seul ») : `routeForceeChg` / `routeForceeLiv` — écrits par la maquette (`versOutil.js`) ; aucun
    // champ en base côté application pour l'instant. Le module juge seul si l'exception vaut encore
    // (mêmes dates, même arrêt précédent) : une date libérée ici ne la porte pas.
    const rf = type === "CHG" ? l.routeForceeChg : l.routeForceeLiv;
    if (rf && !libre && rf.depuis && rf.date) {
      o.routeForcee = { depuis: rf.depuis, dateDepuis: rf.dateDepuis ?? null, date: rf.date };
    }
    return o;
  };
  const lot = {
    id: l.id, nom: l.cli || l.id, agence: l.soc,
    depotCp: depotDeAgence(l.soc),
    cpC: l.cpC, cpL: l.cpL, volume: Number(l.vol) || 0,
    chg: op("CHG"),
    liv: op("LIV"),
  };
  // Le transbordement coché : arrêt au dépôt de l'agence vendeuse (27/09), bloc d'une demi-journée
  // après la navette au chargement, avant elle à la livraison (28/09) — date VL = la souhaitée.
  return transborderLot(lot, { chg: !!l.transboC, liv: !!l.transboL }, reglages);
}

// La tournée est-elle touchée par le geste ? `contexte.touchee` : true | id | [ids] | Set.
function estTouchee(tournee, contexte) {
  const t = contexte?.touchee;
  if (t === true) return true;
  if (!t) return false;
  if (t instanceof Set) return t.has(tournee.id);
  return [].concat(t).includes(tournee.id);
}

// ── UNE TOURNÉE → UNE ENTRÉE DE `evaluerTournee` ───────────────────────────────────────────────
// `contexte` : { planning | etat, touchee?, geste? } — `geste` : { lot, type, date } impose une date
// (celle que le planificateur vient de donner) ; elle n'est jamais libérée.
// `reglages` n'est lu que pour transmettre ce qui concerne l'entrée (l'attente à quai du
// transbordement, 27/09) : la règle des dates n'est PAS un réglage.
export function entreeDeTournee(tournee, contexte = {}, reglages = {}) {
  const etat = contexte.etat || lirePlanning(contexte.planning);
  const touchee = estTouchee(tournee, contexte);
  const geste = contexte.geste || null;
  const veh = etat.vehById.get(tournee.camion) || null;
  const agence = tournee.agence ?? (veh ? veh.ag : null);

  const lots = [];
  for (const id of tournee.lots) {
    const l = etat.lotsById.get(id);
    if (!l) continue;
    const dC = tournee.dates[`${id}|CHG`] ?? null;
    const dL = tournee.dates[`${id}|LIV`] ?? null;
    if (!dC || !dL) continue;
    const imposees = geste && geste.lot === id ? { [geste.type]: geste.date } : null;
    lots.push(lotPourModule(l, etat, {
      dates: { CHG: dC, LIV: dL },
      libres: touchee ? new Set(["CHG", "LIV"]) : null,
      imposees, reglages,
    }));
  }
  const garde = new Set(lots.map(l => l.id));
  // « Forcer la capacité » (CAP, 23/09) : écrit sur CHAQUE lot de la tournée par `ecriture.js`
  // (`capaciteForcee`). La tournée est forcée si tous ses lots le portent — un lot ajouté depuis ne
  // l'est pas : le planificateur re-force. La clé n'apparaît que si elle vaut `true` (l'entrée d'une
  // tournée non forcée reste identique à celle du banc).
  const forcee = lots.length > 0 && [...garde].every(id => etat.lotsById.get(id)?.capaciteForcee === true);
  return {
    camion: {
      id: tournee.camion, agence,
      depotCp: agence ? etat.depotDeAgence(agence) : null,
      capacite: veh && veh.cap ? Number(veh.cap) : null,
    },
    lots,
    ordre: tournee.ordre.filter(o => garde.has(o.lot)),
    ...(forcee ? { forcerCapacite: true } : {}),
  };
}

// ── LE PLANNING → `{ tournees }` POUR `evaluerPlanning` ────────────────────────────────────────
// `contexte.touchee` (id | [ids]) est rendu tel quel, pour la troisième option de T0 :
// `evaluerPlanning({ tournees }, reglages, { touchee })`.
export function planningPourModule(planning, contexte = {}, reglages = {}) {
  const etat = lirePlanning(planning);
  const tournees = contexte.tournees || tourneesDuPlanning(planning);
  const liste = tournees.map(t => ({ id: t.id, ...entreeDeTournee(t, { ...contexte, etat }, reglages) }));
  const t = contexte.touchee;
  const touchee = t === true ? liste.map(x => x.id) : (t instanceof Set ? [...t] : (t ?? null));
  return { tournees: liste, touchee };
}

// Raccourci : le planning évalué par le module, avec l'option « touchée ».
export function evaluerPlanningV2(planning, contexte = {}, reglages = {}) {
  const { tournees, touchee } = planningPourModule(planning, contexte, reglages);
  return evaluerPlanning({ tournees }, reglages, touchee ? { touchee } : {});
}
