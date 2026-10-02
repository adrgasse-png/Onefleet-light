// ═══════════════════════════════════════════════════════════════════════════════════════════════
// LA RECHERCHE DE BOUCLE v2 (T3, sprint « moteur d'abord », 2026-09-23) — SANS ÉCRAN, SANS ÉCRITURE
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// `rechercherBoucle(lot, planning, perimetre, reglages)` rend les tournées où ce lot s'insère, et
// pour chaque candidate écartée, POURQUOI. Elle remplace, derrière l'interrupteur
// `reglages.rechercheV2.active` (défaut `false`), `findBoucleCandidates` de `boucleEngine.js` —
// qu'elle ne touche pas.
//
// ── CE QU'ELLE ÉNUMÈRE ─────────────────────────────────────────────────────────────────────────
// L'énumération est CELLE DU BANC (`enumeration.js`, le même fichier) : parcours en profondeur des
// ordres d'arrêts, premier lot chargé = agence du camion, meilleure séquence = plus de km évités.
// Les candidates sont les réunions du lot avec :
//   · une tournée existante qui garde tous ses lots (un lot seul, une paire → greffe du 3ᵉ lot) ;
//   · deux lots seuls, si le lot forme déjà une tournée avec l'un d'eux (construction par NIVEAUX
//     du banc : un trio n'est essayé que si une de ses paires tient — même limite, écrite).
// Jamais plus de `tailleMax` lots (3, 🟠 H-18). Chaque (réunion, agence de camion) est une
// candidate ; chacune est ensuite JUGÉE par `evaluerTournee`, dates imposées : ce que la recherche
// montre est exactement ce que la pose donnera (« proposé = posé »).
//
// ── CE QUI BOUGE ───────────────────────────────────────────────────────────────────────────────
// Le lot saisi, dans sa flex ; tout lot en BROUILLON non épinglé vendu par MES agences, dans sa flex
// vendue (§ 2.2 : l'ordre de saisie ne compte plus) ; la livraison dans ses bornes actuelles (D11).
// Confirmé et épinglé ne bougent pas. Le lot d'une autre agence ne bouge pas (sur son camion comme
// sur le mien : un lot sous-traité reste où il est dans la recherche). La retouche d'un lot déjà
// posé est RENDUE dans la proposition (`retouches`), jamais appliquée (P4).
// 🔴 LA RECHERCHE NE DÉFAIT RIEN (§ 2.5) : une tournée existante entre entière dans la proposition
// ou n'y entre pas. Aucune proposition ne retire un lot d'une tournée (ni un lot sous-traité).
//
// ── CE QU'ELLE REFUSE ──────────────────────────────────────────────────────────────────────────
// Géographie (`zones.js`, G1), détour G2 et rendement G5 greffe par greffe (en REFUS, « la recherche,
// elle, refuse toujours »), km évités < `rechercheV2.kmEvitesMin` (50, A-12), code postal inconnu,
// Q17, capacité, camion déjà pris, date confirmée, et « on n'en prend jamais » : une proposition qui
// mettrait sur mon camion le lot d'une autre agence qui ne roule pas déjà chez moi n'existe pas.
// Q17 et « on donne ses lots » ne sont PAS des réglages.
//
// ── CE QU'ELLE REND ────────────────────────────────────────────────────────────────────────────
// `{ active, propositions, ecartees, seul }` — propositions triées par km évités décroissants.
// Une proposition sur le camion d'une autre région porte `demande` (non nul) : c'est une demande à
// cette agence, comme aujourd'hui pour un retour. D8 : un lot sans proposition acceptée reste posé
// seul — ce n'est pas l'affaire de la recherche, qui ne pose rien.

import { creerMoteur } from "./enumeration.js";
import {
  lirePlanning, tourneesDuPlanning, lotPourModule, fenetresDuLot, etatOperation, dureeOp,
} from "./adaptateur.js";
import {
  evaluerTournee, controlerGeste, fusionnerReglages, isoDeJour, jourOuvre,
  jourOuvreOuSuivant, jourOuvreOuPrecedent, estFerme, ecartOuvre, decalerOuvres, blocTransbo, extrasArretBloc,
} from "../jour/index.js";
import { isVehicleCompatible } from "../boucleEngine.js";
import { agLookup } from "../chainBuilder.js";
import { cpConnu } from "../../data/gps.js";
import { maillonsEnVol } from "../../utils/boucleLiens.js";

// ── LES RÉGLAGES DE LA RECHERCHE ───────────────────────────────────────────────────────────────
// Portés par `reglages.rechercheV2` (le reste des réglages est celui du module `engine/jour`).
export const RECHERCHE_V2_DEFAUT = {
  // L'interrupteur. Tant qu'il vaut `false`, la recherche ne calcule rien et l'application garde
  // `findBoucleCandidates`. Statut : bascule d'un coup (D5), derrière un interrupteur admin.
  active: false,
  // Km évités minimum d'une proposition. Statut : A-12 (50 km gardés comme filtre de recherche).
  kmEvitesMin: 50,
  // Attente maximale entre deux lots d'une tournée, en jours ouvrés. Statut : hypothèse d'analyste
  // (essai 2, banc) ; l'outil d'aujourd'hui raisonne en heures (`ecartMaxH`), revient avec T5.
  liaisonMax: 3,
  // Lots par tournée. Statut : 🟠 H-18 (le 4ᵉ lot est l'étape 3).
  tailleMax: 3,
  // Choisir un camion réel de l'agence, libre sur la période. `false` : l'agence seule (le banc
  // tient alors la flotte lui-même, par comptage — c'est ainsi qu'il rejoue le fil de l'eau).
  choisirCamion: true,
  // La livraison libre peut-elle s'avancer avant la date souhaitée (jusqu'au début de la flex de
  // chargement) ? `false` (défaut) : bornes actuelles, décision D11 — cette avance est l'hypothèse
  // du banc, elle n'entre pas en production. `true` ne sert qu'à MESURER ce qu'elle coûte (banc).
  livraisonAvancee: false,
  // Les jours de départ essayés pour le premier chargement d'une tournée. "toujours" (défaut) :
  // chaque jour de sa fenêtre — indispensable dès que la livraison ne s'avance plus (D11) ou qu'un
  // partenaire a une date fixe : partir au plus tôt ferait attendre le camion chargé plus que
  // `liaisonMax`, et la boucle disparaîtrait (BLAVIER + DUREL : BLAVIER doit glisser de 3 jours).
  // "si_date_fixe" : au plus tôt, sauf si une date fixe est en jeu — c'est l'énumération du banc
  // sur un vivier tout libre, gardée pour que le banc rejoue son fil de l'eau à l'identique.
  balayerDepart: "toujours",
};

export function reglagesRecherche(partiels) {
  const p = partiels || {};
  return { module: fusionnerReglages(p), rv: { ...RECHERCHE_V2_DEFAUT, ...(p.rechercheV2 || {}) } };
}

export const rechercheV2Active = (reglages) => reglagesRecherche(reglages).rv.active === true;

// ── LES MOTIFS D'ÉCART (« Pourquoi pas cette boucle ? ») ─────────────────────────────────────────
// Les huit motifs de la synthèse — territoire, détour, rendement, capacité, camion pris, dates,
// Q17, demande déjà en attente — plus ceux que la v2 ajoute.
export const MOTIFS = {
  TERRITOIRE: "la géographie ne tient pas (zones de chalandise)",
  DETOUR: "le détour dépasse ce qu'une greffe admet",
  RENDEMENT: "le gain ne paie pas les jours de camion en plus",
  CAPACITE: "le camion n'a pas la place",
  CAMION_DEJA_PRIS: "aucun camion de l'agence n'est libre sur la période",
  FLEX_INTENABLE: "les dates ne se rejoignent pas dans les fenêtres vendues",
  Q17: "le camion ne rentrerait pas au dépôt pour le week-end",
  DEMANDE_EN_ATTENTE: "une proposition attend déjà une réponse sur cette tournée",
  CP_INCONNU: "un code postal n'est pas reconnu",
  KM_EVITES_MIN: "la boucle évite trop peu de kilomètres",
  TAILLE_MAX: "la tournée a déjà le nombre de lots maximum",
  LOT_AUTRE_AGENCE: "on ne prend pas le lot d'une autre agence",
  DATE_CONFIRMEE: "il faudrait bouger une date confirmée",
  DATE_NON_OUVREE: "une date posée tombe un jour non ouvré",
  SOUS_TRAITE_HORS_FENETRE: "un lot sous-traité sortirait de sa fenêtre",
  ORDRE_INVALIDE: "la tournée est incohérente",
  KM_EVITES_NEGATIFS: "la boucle coûte plus que les lots faits seuls",
  DATES_INCOMPATIBLES: "les dates imposées ne tiennent pas",
  // 01/10 (passe sur les contrôles) : quatre refus du module n'avaient pas de phrase — « Analyse »
  // affichait leur CODE. Et le repli n'est plus le code brut.
  COUPURE_CHARGEE_LOIN: "la dernière étape ne passe pas avant le week-end, trop loin du dépôt pour y rentrer chargé",
  TRANSBO_ORDRE: "le camion passerait au dépôt du mauvais côté de la navette",
  TRANSBO_QUAI: "la marchandise attendrait trop longtemps au dépôt",
  HORS_FLEX: "une date sortirait de la fenêtre vendue",
};

const phrase = (motif) => MOTIFS[motif] || "le calcul ne retient pas cette tournée";

export function motifsPourquoiPas(ecartees) {
  return (ecartees || []).map(e => ({
    lots: e.lots, agence: e.agence, motif: e.motif,
    phrase: `Avec ${e.avec.join(" + ") || "aucun lot"}${e.agence ? ` (camion ${e.agence.trim()})` : ""} : ${phrase(e.motif)}.`,
  }));
}

// Le stade atteint par l'énumération → le motif. Le stade dit JUSQU'OÙ la candidate est allée ; au
// stade « calendrier », les motifs de la passe disent pourquoi elle s'est arrêtée, et on retient le
// plus parlant (même ordre que `signalEchec` du module : capacité, puis règle d'or, puis dates).
function motifDeCause(cause, motifs) {
  if (cause === "G1") return "TERRITOIRE";
  if (cause === "G2") return "DETOUR";
  if (cause === "G5") return "RENDEMENT";
  if (cause === "km" || cause === "gain") return "KM_EVITES_MIN";
  if (cause === "attente") return "FLEX_INTENABLE";
  const m = motifs || {};
  if (m.capacite) return "CAPACITE";
  if (Object.keys(m).some(k => k.startsWith("q17") || k === "boucle_q17")) return "Q17";
  return "FLEX_INTENABLE";
}

// ── LA RECHERCHE ───────────────────────────────────────────────────────────────────────────────
// `lot` : l'objet lot (forme du blob) ou son id. `planning` : le blob (`lots`, `placements`,
// `vehicles`, `agencesData`, `rules`) ; il peut porter `tournees` (la sortie de
// `tourneesDuPlanning`), sinon elles sont relues. `perimetre` : `{ mesAgences: [...] }` — vide, seul
// le lot saisi bouge. `reglages` : ceux du module, plus `rechercheV2`.
export function rechercherBoucle(lot, planning, perimetre = {}, reglagesPartiels = {}) {
  const { module: R, rv } = reglagesRecherche(reglagesPartiels);
  if (!rv.active) return { active: false, propositions: [], ecartees: [], seul: null };

  const etat = lirePlanning(planning);
  // 📛 PIÈGE (D10, `PREPARATION-D10-tables.md` § 1.2) : `planning.tournees` doit être la sortie de
  // `tourneesDuPlanning`, rien d'autre. Un domaine de blob qui s'appellerait `tournees` (autre forme,
  // p. ex. les tables `tours` de l'API) serait lu ici sans erreur et fausserait la recherche en
  // silence — d'où le nom `tourneesV2` réservé à l'option A (tournée écrite par le front).
  const tournees = planning?.tournees || tourneesDuPlanning(planning);
  const L = typeof lot === "string" ? etat.lotsById.get(lot) : lot;
  const mes = new Set(perimetre?.mesAgences || []);
  const ecartees = [];
  const ecarter = (e) => ecartees.push({ avec: [], tournees: [], agence: null, detail: null, ...e,
    message: phrase(e.motif) });

  if (!L) return { active: true, propositions: [], ecartees: [{ avec: [], tournees: [], agence: null, motif: "ORDRE_INVALIDE", detail: { lot }, message: "lot introuvable" }], seul: null };

  const depotDe = (l) => etat.depotDeAgence(l.soc) || l._cpDepot || null;
  const cpsInconnus = (l) => [l.cpC, l.cpL, depotDe(l)].filter(cp => !cpConnu(cp));

  // Le lot saisi : un code postal inconnu l'exclut des propositions automatiques (regles-metier.md,
  // « CP reconnu ») — il reste planifiable à la main.
  const inconnus = cpsInconnus(L);
  if (inconnus.length) {
    ecarter({ motif: "CP_INCONNU", lots: [L.id], detail: { cps: inconnus } });
    return { active: true, propositions: [], ecartees, seul: null };
  }

  // ── Qui bouge ? ──────────────────────────────────────────────────────────────────────────────
  const base = tournees.find(t => t.lots.includes(L.id)) || null;
  const tourneeDe = new Map();
  for (const t of tournees) for (const id of t.lots) tourneeDe.set(id, t);
  // Un lot bouge s'il est le lot saisi, ou en brouillon et vendu par mes agences ; une opération
  // épinglée ou confirmée ne bouge jamais. Un lot d'une autre agence — sous-traité chez moi ou non —
  // reste où il est.
  const bouge = (l, type) => {
    if (etatOperation(l, type) !== "brouillon") return false;
    return l.id === L.id || mes.has(l.soc);
  };
  const lotDe = (id) => (id === L.id ? L : etat.lotsById.get(id));

  // ── Le transbordement coché (27/09) ─────────────────────────────────────────────────────────
  // L'arrêt du camion d'une opération transbordée est au DÉPÔT de l'agence vendeuse, dans la
  // fenêtre du quai — exactement ce que `lotPourModule` (donc le jugement et la pose) lui donne via
  // `transborderLot`. L'énumération doit chercher au même endroit, sinon elle classe une boucle
  // chez le client et le jugement la chiffre au dépôt (scénario 11 : 810 km annoncés, 742 posés).
  const transbordee = (l, type) => (type === "CHG" ? !!l.transboC : !!l.transboL);
  const cpArret = (l, type) => (transbordee(l, type)
    ? (etat.depotDeAgence(l.soc) || (type === "CHG" ? l.cpC : l.cpL))
    : (type === "CHG" ? l.cpC : l.cpL));
  // Le lot tel que le camion le voit — adresses du camion — pour les garde-fous de l'énumération
  // (G1 territoire, G2/G5 et le « fait seul » géométrique lisent `cpC` / `cpL`), comme le jugement
  // les lit sur l'entrée du module. Même objet sans transbordement.
  const vueCamion = (l) => (transbordee(l, "CHG") || transbordee(l, "LIV")
    ? { ...l, cpC: cpArret(l, "CHG"), cpL: cpArret(l, "LIV") } : l);

  // ── Les fenêtres de l'énumération (en jours ouvrés du module) ─────────────────────────────────
  const table = new Map();
  const sansTable = new Map();       // lot → motif qui l'empêche d'entrer dans une candidate
  const aDateFixe = new Set();       // lots dont une opération est clouée à sa date posée
  const arretsDu = (l) => {
    if (table.has(l.id) || sansTable.has(l.id)) return table.get(l.id) || null;
    const f = fenetresDuLot(l, etat.rules);
    const t = tourneeDe.get(l.id);
    const pose = { CHG: t ? t.dates[`${l.id}|CHG`] : null, LIV: t ? t.dates[`${l.id}|LIV`] : null };
    const volume = Number(l.vol) || 0;
    const fen = {};
    // Transbordée (28/09) : l'arrêt du camion est un BLOC d'une demi-journée au dépôt, après la
    // collecte par la navette (avant sa livraison) — `blocTransbo`, la règle même que la pose lit
    // à travers `lotPourModule` → `transborderLot` : même date VL (la date souhaitée, faute de
    // champ en base), même durée de collecte (`dureeOp`), mêmes réglages. Posé ou libre, l'arrêt
    // porte la durée du bloc et ses bornes fines (`extrasArretBloc`), sinon l'énumération datait
    // le bloc autrement que le jugement.
    const blocs = {};
    for (const type of ["CHG", "LIV"]) {
      blocs[type] = transbordee(l, type)
        ? blocTransbo({ vl: type === "CHG" ? f.souhaiteC : f.souhaiteL, dureeVLH: dureeOp(l, type, etat.rules), type }, R)
        : null;
      if (!bouge(l, type)) {
        // Confirmé, épinglé, ou lot d'une autre agence : sa date posée, et elle seule.
        const j = pose[type] ? jourOuvre(pose[type]) : null;
        // Un jour férié est un jour non ouvré, comme un samedi (27/09).
        if (j === null || estFerme(j)) { sansTable.set(l.id, pose[type] ? "DATE_NON_OUVREE" : "ORDRE_INVALIDE"); return null; }
        fen[type] = [j, j];
        aDateFixe.add(l.id);
        continue;
      }
      // Transbordée : la fenêtre du bloc (après la navette au chargement, avant elle à la livraison,
      // dans l'attente à quai) — même source que la pose.
      const bornes = blocs[type]
        ? blocs[type].fenetre
        : type === "CHG" ? f.chg : (rv.livraisonAvancee ? f.livCommerciale : f.livLibre);
      const a = bornes && bornes[0] ? jourOuvreOuSuivant(bornes[0]) : null;
      const b = bornes && bornes[1] ? jourOuvreOuPrecedent(bornes[1]) : null;
      if (a === null || b === null || b < a) { sansTable.set(l.id, "FLEX_INTENABLE"); return null; }
      fen[type] = [a, b];
    }
    const arret = (type) => ({
      lot: l.id, type, cp: cpArret(l, type), volume,
      dureeH: blocs[type] ? blocs[type].dureeH : dureeOp(l, type, etat.rules),
      fenetre: fen[type], ...extrasArretBloc(blocs[type]),
    });
    const arrets = { CHG: arret("CHG"), LIV: arret("LIV") };
    table.set(l.id, arrets);
    return arrets;
  };

  // ── Les candidates ───────────────────────────────────────────────────────────────────────────
  const baseLots = base ? base.lots : [L.id];
  const baseT = base ? [base] : [];
  const autres = tournees.filter(t => t !== base);
  // Le préfiltre de CALENDRIER : deux groupes de lots dont les fenêtres sont trop éloignées ne
  // peuvent pas partager une tournée — le camion attendrait plus que `liaisonMax` jours. La marge
  // couvre la route entre les deux groupes (retour dépôt du week-end compris, au pire deux trajets
  // à travers la France au compte serré) : le préfiltre n'écarte JAMAIS ce que l'énumération aurait
  // retenu, il lui épargne seulement le travail. Au banc, cette égalité est contrôlée.
  const MARGE_ROUTE_J = 4;
  const MARGE_BALAYAGE_J = 12;
  const intervalle = (lotsIds) => {
    let a = Infinity, b = -Infinity;
    for (const id of lotsIds) {
      const l = lotDe(id);
      const ar = l ? arretsDu(l) : null;
      if (!ar) return null;
      a = Math.min(a, ar.CHG.fenetre[0]);
      b = Math.max(b, ar.LIV.fenetre[1]);
    }
    return [a, b];
  };
  // L'écart se compte en jours OUVERTS (27/09) : un férié entre les deux groupes ne compte pas plus
  // qu'un week-end — l'attente de la passe ne le compte pas non plus. Sans férié : l'écart d'origine.
  const trop = (x, y) => {
    if (!x || !y) return null;
    const ecart = Math.max(0, ecartOuvre(x[1], y[0]), ecartOuvre(y[1], x[0]));
    return ecart > rv.liaisonMax + MARGE_ROUTE_J ? ecart : null;
  };
  const iBase = intervalle(baseLots);

  // Les propositions en vol (C2) : une proposition envoyée et pas encore répondue retient un siège
  // sur la tournée qu'elle vise (`maillonsEnVolVers`, même règle, lue une seule fois).
  const enVolTous = maillonsEnVol(etat.lots).filter(m => m.accrocheId !== L.id);
  const enVolVers = (ids) => {
    const dedans = new Set(ids);
    return enVolTous.filter(m => dedans.has(m.ancreId) && !dedans.has(m.accrocheId)).length;
  };

  const groupes = [];                 // { lots: [ids], absorbe: [tournées] }
  for (const t of autres) {
    const taille = baseLots.length + t.lots.length;
    if (taille > rv.tailleMax) {
      ecarter({ motif: "TAILLE_MAX", avec: t.lots, lots: [...baseLots, ...t.lots], tournees: [t.id] });
      continue;
    }
    const enVol = enVolVers(t.lots);
    if (taille + enVol > rv.tailleMax) {
      ecarter({ motif: "DEMANDE_EN_ATTENTE", avec: t.lots, lots: [...baseLots, ...t.lots], tournees: [t.id] });
      continue;
    }
    const ecart = trop(iBase, intervalle(t.lots));
    if (ecart !== null) {
      ecarter({ motif: "FLEX_INTENABLE", avec: t.lots, lots: [...baseLots, ...t.lots], tournees: [t.id],
        detail: { prefiltre: true, ecartJours: ecart } });
      continue;
    }
    groupes.push({ lots: [...baseLots, ...t.lots], absorbe: [...baseT, t] });
  }

  // Le moteur d'énumération : tous les lots concernés, DANS L'ORDRE DU PLANNING (c'est l'ordre du
  // vivier au banc ; il départage les égalités exactement comme lui).
  const concernes = new Set([L.id, ...baseLots, ...groupes.flatMap(g => g.lots)]);
  const rang = (id) => (etat.ordreLot.has(id) ? etat.ordreLot.get(id) : Number.MAX_SAFE_INTEGER);
  const ids = [...concernes].sort((a, b) => (rang(a) - rang(b)) || (a < b ? -1 : a > b ? 1 : 0));
  const lotsMoteur = [];
  for (const id of ids) {
    const l = lotDe(id);
    if (!l) continue;
    const cps = cpsInconnus(l);
    if (cps.length) { sansTable.set(id, "CP_INCONNU"); continue; }
    if (arretsDu(l)) lotsMoteur.push(vueCamion(l));
  }
  if (!table.has(L.id)) {
    ecarter({ motif: sansTable.get(L.id) || "FLEX_INTENABLE", lots: [L.id] });
    return { active: true, propositions: [], ecartees, seul: null };
  }

  const capParAgence = new Map();
  for (const v of etat.vehicles) {
    if (!isVehicleCompatible(v, 0)) continue;
    const c = parseFloat(v.cap) || 0;
    if (!capParAgence.has(v.ag) || capParAgence.get(v.ag) < c) capParAgence.set(v.ag, c);
  }
  const zones = R.zones && R.zones.length ? R.zones : (etat.rules.zonesRetour || []);
  const rulesGardes = {
    ...etat.rules,
    gardeDetourRetourKm: R.detourMaxKm, gardeDetourMutuKm: R.detourMaxKm,
    gardeRendementKmJ: R.rendementMinKmJ, vitessePL: R.vitessePL,
  };
  const M = creerMoteur({
    lots: lotsMoteur, table, depotDe, capParAgence, zones, agencesData: etat.agencesData,
    rules: rulesGardes, abaque: R.comptes.juste, liaisonMax: rv.liaisonMax, minKmEco: rv.kmEvitesMin,
    critere: "reel", arrondi: R.arrondi, resteMinPourCommencerH: R.resteMinPourCommencerH,
    ancreAgence: true,           // « on donne ses lots, on n'en prend jamais » : pas un réglage
  });

  // Le jugement du module : dates imposées, garde-fous en REFUS, territoire actif.
  const reglagesJugement = {
    ...(reglagesPartiels || {}),
    zones, agencesData: etat.agencesData,
    niveaux: { ...((reglagesPartiels || {}).niveaux || {}), gardes: "refus" },
  };
  delete reglagesJugement.rechercheV2;

  // Le motif d'une candidate que l'énumération n'a pas retenue. Son « stade » dit jusqu'où elle
  // est allée ; mais le territoire (G1) coupe une branche SANS la noter, et une paire dont TOUS les
  // enchaînements sont hors territoire ressortirait « dates ». On le dit donc explicitement : pour
  // une paire, si aucun lien — ni mutualisation, ni retour — n'est permis depuis le lot de l'agence
  // du camion, c'est le territoire.
  const pairePermise = ([i, j], d) => {
    const lien = (a, b) => M.mutuOkDe(a, b) || M.retourOkDe(d, a, b);
    const ouvre = (a) => M.lots[a].soc === M.agences[d];
    return (ouvre(i) && lien(i, j)) || (ouvre(j) && lien(j, i));
  };
  // Condition NÉCESSAIRE pour un groupe de plus de deux lots : un lot de l'agence du camion pour
  // ouvrir, et chaque autre lot relié à un membre par un lien que le territoire permet (il faut
  // bien le charger derrière quelqu'un). Plus faible que `pairePermise`, mais exacte : elle
  // n'écarte rien que l'énumération aurait retenu.
  const groupePermis = (membres, d) => {
    const lien = (a, b) => M.mutuOkDe(a, b) || M.retourOkDe(d, a, b);
    if (!membres.some(a => M.lots[a].soc === M.agences[d])) return false;
    return membres.every(m => M.lots[m].soc === M.agences[d] || membres.some(n => n !== m && lien(n, m)));
  };
  const motifEcart = (membres, d) => {
    const cause = M.cause();
    if (membres.length === 2 && (cause === "calendrier" || cause === "attente" || cause === "ancre")
      && !pairePermise(membres, d)) return "TERRITOIRE";
    return motifDeCause(cause, M.motifs());
  };

  const propositions = [];
  const vues = new Set();
  const pairesTenues = new Set();     // lots seuls X tels que {L, X} tient (niveau 2 → niveau 3)

  const essayer = (g) => {
    const cle = [...g.lots].sort().join("+");
    if (vues.has(cle)) return false;
    vues.add(cle);
    const avec = g.lots.filter(id => !baseLots.includes(id));
    const bloque = g.lots.find(id => !M.idx.has(id));
    if (bloque !== undefined) {
      ecarter({ motif: sansTable.get(bloque) || "FLEX_INTENABLE", avec, lots: g.lots, tournees: g.absorbe.map(t => t.id), detail: { lot: bloque } });
      return false;
    }
    const membres = g.lots.map(id => M.idx.get(id)).sort((a, b) => a - b);
    const fixe = g.lots.some(id => aDateFixe.has(id));
    const balayerDepart = fixe || rv.balayerDepart === "toujours";
    // Les jours de départ utiles. Le premier chargement ne commence pas après le dernier jour
    // possible d'AUCUNE opération du groupe (toutes le suivent) ; et il ne précède pas le premier
    // jour possible de la plus tardive de plus que l'attente permise augmentée de ce que les routes
    // et manutentions peuvent occuper (`MARGE_BALAYAGE_J`, large : trois lots, six manutentions,
    // la France en long et un retour dépôt de week-end). Hors de ces bornes, l'énumération élaguerait
    // de toute façon : les bornes ne changent aucun résultat, elles épargnent le travail.
    // (La borne basse recule en jours OUVERTS : un férié ne la resserre pas — 27/09.)
    let departMax = Infinity, departMin = -Infinity;
    for (const id of g.lots) {
      const ar = table.get(id);
      for (const t of ["CHG", "LIV"]) {
        departMax = Math.min(departMax, ar[t].fenetre[1]);
        departMin = Math.max(departMin, decalerOuvres(ar[t].fenetre[0], -(rv.liaisonMax + MARGE_BALAYAGE_J)));
      }
    }
    const optsSeq = balayerDepart ? { balayerDepart, departMax, departMin } : {};
    let tenue = false;
    const depots = M.depotsDe(membres);
    for (const d of depots) {
      const agence = M.agences[d];
      // « On n'en prend jamais », lu AVANT d'énumérer : le lot d'une autre agence, qui ne roule
      // pas sur un de mes camions, ne peut aller que sur un camion de sa propre agence (ou rester
      // sur celui qui le porte). Ailleurs, la candidate serait écartée par `controlerGeste` après
      // coup ; on s'épargne l'énumération. (Périmètre vide : on ne juge pas, comme le module.)
      const pris = mes.size ? g.lots.find(id => {
        const l = lotDe(id);
        if (!l || mes.has(l.soc)) return false;
        const t = tourneeDe.get(id);
        const agCamion = t ? (t.agence ?? etat.vehById.get(t.camion)?.ag ?? null) : null;
        if (agCamion && mes.has(agCamion)) return false;          // sous-traité chez moi
        return agence !== l.soc && agence !== agCamion;
      }) : undefined;
      if (pris !== undefined) {
        ecarter({ motif: "LOT_AUTRE_AGENCE", avec, lots: g.lots, agence, tournees: g.absorbe.map(x => x.id),
          detail: { lot: pris, avantEnumeration: true } });
        continue;
      }
      M.cpt.sousEnsembles++;
      // Une paire dont aucun enchaînement n'est permis par le territoire n'a pas besoin d'être
      // énumérée : l'énumération n'y trouverait rien (même prédicat, `motifEcart`).
      if ((membres.length === 2 && !pairePermise(membres, d)) || (membres.length > 2 && !groupePermis(membres, d))) {
        ecarter({ motif: "TERRITOIRE", avec, lots: g.lots, agence, tournees: g.absorbe.map(x => x.id),
          detail: { stade: "G1" } });
        continue;
      }
      const t = M.meilleureSequence(membres, d, optsSeq);
      if (!t) {
        ecarter({ motif: motifEcart(membres, d), avec, lots: g.lots, agence,
          tournees: g.absorbe.map(x => x.id), detail: { stade: M.cause(), passe: { ...M.motifs() } } });
        continue;
      }
      tenue = true;
      const p = juger({ g, t, agence, avec, rangAgence: depots.indexOf(d) });
      if (p.ecartee) ecarter(p.ecartee);
      else propositions.push(p.proposition);
    }
    return tenue;
  };

  const juger = ({ g, t, agence, avec, rangAgence }) => {
    const tId = g.absorbe.map(x => x.id);
    // Ce que l'énumération a trouvé — porté aussi par une candidate que le jugement écarte, pour
    // que le banc puisse rejouer l'énumération seule (et mesurer ce que le jugement retire).
    const enumeration = {
      kmEvites: t.kmEvitesReels, km: t.kmReel, forme: t.forme, jours: t.jours, seq: t.seq,
      jourDepart: t.jourDepart, jourRetour: t.jourRetour, joursMobilises: t.joursMobilises,
      rang: [g.lots.length, ...[...g.lots].map(id => M.idx.get(id)).sort((a, b) => a - b), rangAgence],
    };
    const ecartee = (e) => ({ ecartee: { ...e, avec, lots: g.lots, agence, tournees: tId, apresEnumeration: true, enumeration, absorbe: tId } });
    const ordre = t.seq.map(s => { const [type, lot] = s.split(":"); return { lot, type }; });
    const dates = {};
    ordre.forEach((o, k) => { dates[`${o.lot}|${o.type}`] = t.jours[k]; });
    const lotsOrdre = [...new Set(ordre.map(o => o.lot))];

    // Le camion.
    let camion = null;
    if (rv.choisirCamion) {
      const c = choisirCamion({ etat, tournees, absorbe: g.absorbe, agence,
        volume: t.volumeMax, depart: isoDeJour(t.jourDepart), retour: isoDeJour(t.jourRetour) });
      if (!c.camion) return ecartee({ motif: c.motif, detail: c.detail });
      camion = c.camion;
    }
    const veh = camion ? etat.vehById.get(camion) : null;

    // L'entrée « posée » : toutes dates imposées, états conservés.
    const entree = {
      camion: {
        id: camion, agence,
        depotCp: etat.depotDeAgence(agence) || null,
        capacite: veh && veh.cap ? Number(veh.cap) : (capParAgence.get(agence) || null),
      },
      lots: lotsOrdre.map(id => lotPourModule(lotDe(id), etat, {
        dates: { CHG: dates[`${id}|CHG`], LIV: dates[`${id}|LIV`] }, reglages: R,
      })),
      ordre,
    };
    // Le lot saisi n'a pas d'état en base : ses dates sont une proposition, en brouillon.
    const resultat = evaluerTournee(entree, reglagesJugement);
    const refus = resultat.signaux.find(s => s.niveau === "refus");
    if (refus) {
      return ecartee({ motif: refus.code,
        detail: { signaux: resultat.signaux.filter(s => s.niveau === "refus").map(s => ({ code: s.code, message: s.message })) } });
    }
    const kmEvites = resultat.chiffres.kmEvites;
    if (kmEvites < rv.kmEvitesMin) {
      return ecartee({ motif: "KM_EVITES_MIN", detail: { kmEvites } });
    }

    // Les droits : le module juge le geste « poser cette proposition ».
    // La tournée résultante garde l'identifiant de la tournée absorbée dont elle garde le camion :
    // un lot qui ne change ni de date, ni de camion, ni de tournée n'a pas « bougé ».
    const garde = g.absorbe.find(x => x.camion && x.camion === camion) || null;
    const avant = { tournees: g.absorbe.map(x => ({ id: x.id, ...entreeAuRepos(x, etat, R) })) };
    const apres = { tournees: [{ id: garde ? garde.id : "proposition", ...entree }] };
    const droits = controlerGeste({ avant, apres, mesAgences: [...mes] }, reglagesJugement);
    const bloquant = droits.signaux.find(s => s.niveau === "refus" && !s.demande);
    if (bloquant) {
      return ecartee({ motif: bloquant.code, detail: { message: bloquant.message } });
    }
    // « On n'en prend jamais » : le lot d'une autre agence, qui ne roulait pas chez moi, posé sur un
    // camion qui n'est pas le sien. Resté sur un camion de SON agence, il fait partie de la demande
    // adressée à cette agence (c'est sa tournée qu'on lui propose de compléter).
    const prendre = droits.signaux.find(s => s.code === "LOT_AUTRE_AGENCE" && !s.detail?.sousTraite
      && s.detail?.agenceCamion !== s.detail?.agence);
    if (prendre) {
      return ecartee({ motif: "LOT_AUTRE_AGENCE", detail: { lot: prendre.lot, message: prendre.message } });
    }
    const demandes = droits.signaux.filter(s => s.demande);
    const demande = demandes.length ? {
      agence: demandes[0].detail?.agenceCamion || demandes[0].detail?.agence || agence,
      motifs: [...new Set(demandes.map(s => s.code))],
      messages: demandes.map(s => s.message),
    } : null;

    // Les retouches des lots déjà posés : montrées, jamais appliquées (P4).
    const retouches = [];
    const changementsCamion = [];
    for (const x of g.absorbe) {
      for (const id of x.lots) {
        for (const type of ["CHG", "LIV"]) {
          const de = x.dates[`${id}|${type}`] ?? null;
          const vers = resultat.arrets.find(a => a.lot === id && a.type === type)?.date ?? null;
          if (de !== vers) retouches.push({ lot: id, type, de, vers });
        }
        if (camion && x.camion !== camion) changementsCamion.push({ lot: id, de: x.camion, vers: camion });
      }
    }

    return {
      proposition: {
        id: `${lotsOrdre.join("+")}@${agence.trim()}`,
        lots: lotsOrdre, agence, camion, demande,
        tournee: {
          camion, agence, lots: lotsOrdre, lotN1: lotsOrdre[0], ordre,
          dates: Object.fromEntries(resultat.arrets.map(a => [`${a.lot}|${a.type}`, a.date])),
        },
        arrets: resultat.arrets.map(a => ({ lot: a.lot, type: a.type, date: a.date })),
        verdict: resultat.verdict, signaux: resultat.signaux,
        kmEvites, chiffres: resultat.chiffres,
        retouches, changementsCamion, absorbe: tId,
        enumeration,
        entree, resultat,
      },
    };
  };

  // Niveau 2 (et greffe sur une paire).
  for (const g of groupes) {
    const tenue = essayer(g);
    if (tenue && g.lots.length === 2 && baseLots.length === 1) pairesTenues.add(g.absorbe[g.absorbe.length - 1]);
  }
  // Niveau 3 : deux lots seuls, dont l'un tient déjà avec le lot saisi.
  if (baseLots.length === 1 && rv.tailleMax >= 3) {
    const seuls = autres.filter(t => t.lots.length === 1);
    for (const tX of pairesTenues) {
      for (const tY of seuls) {
        if (tY === tX) continue;
        const enVol = enVolVers([...tX.lots, ...tY.lots]);
        const g = { lots: [L.id, tX.lots[0], tY.lots[0]], absorbe: [...baseT, tX, tY] };
        const ecart = trop(intervalle([L.id, tX.lots[0]]), intervalle(tY.lots));
        if (ecart !== null) {
          ecarter({ motif: "FLEX_INTENABLE", avec: [tX.lots[0], tY.lots[0]], lots: g.lots, tournees: [tX.id, tY.id],
            detail: { prefiltre: true, ecartJours: ecart } });
          continue;
        }
        if (3 + enVol > rv.tailleMax) {
          ecarter({ motif: "DEMANDE_EN_ATTENTE", avec: [tX.lots[0], tY.lots[0]], lots: g.lots, tournees: [tX.id, tY.id] });
          continue;
        }
        essayer(g);
      }
    }
  }

  propositions.sort((a, b) => (b.kmEvites - a.kmEvites) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const s = M.idx.has(L.id) ? M.lotSeul(M.idx.get(L.id)) : null;
  return {
    active: true, propositions, ecartees,
    seul: s ? { km: s.km, jours: s.jours, jourDepart: s.jourDepart, jourRetour: s.jourRetour, agence: s.soc } : null,
  };
}

// Une tournée existante, au repos (dates imposées) : ce que `controlerGeste` compare.
function entreeAuRepos(t, etat, reglages = null) {
  const veh = etat.vehById.get(t.camion) || null;
  const agence = t.agence ?? (veh ? veh.ag : null);
  const lots = t.lots.map(id => etat.lotsById.get(id)).filter(Boolean).map(l => lotPourModule(l, etat, {
    dates: { CHG: t.dates[`${l.id}|CHG`] ?? null, LIV: t.dates[`${l.id}|LIV`] ?? null }, reglages,
  }));
  return { camion: { id: t.camion ?? null, agence }, lots, ordre: t.ordre };
}

// ── LE CAMION ──────────────────────────────────────────────────────────────────────────────────
// Un porteur de l'agence, assez grand, libre sur toute la période (bornes incluses, à la journée,
// comme `planning.js`). Préférence : le camion d'une tournée absorbée (ses lots ne changent pas de
// camion), puis les autres par identifiant. Les tournées absorbées libèrent leur camion.
function choisirCamion({ etat, tournees, absorbe, agence, volume, depart, retour }) {
  const absorbees = new Set(absorbe.map(t => t.id));
  const deLAgence = etat.vehicles.filter(v => v.ag === agence && isVehicleCompatible(v, 0));
  const assez = deLAgence.filter(v => isVehicleCompatible(v, volume));
  if (!assez.length) {
    return { camion: null, motif: "CAPACITE", detail: { volume, plusGrand: Math.max(0, ...deLAgence.map(v => parseFloat(v.cap) || 0)) } };
  }
  const preferes = absorbe.map(t => t.camion).filter(Boolean);
  const rangV = (v) => { const i = preferes.indexOf(v.id); return i < 0 ? preferes.length : i; };
  const ordre = [...assez].sort((a, b) => (rangV(a) - rangV(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const v of ordre) {
    const occupe = tournees.some(t => t.camion === v.id && !absorbees.has(t.id)
      && t.debut && t.fin && t.debut <= retour && depart <= t.fin);
    if (!occupe) return { camion: v.id };
  }
  return { camion: null, motif: "CAMION_DEJA_PRIS", detail: { agence, depart, retour, camions: ordre.map(v => v.id) } };
}

// L'agence d'un camion et la région d'une agence, pour construire un périmètre.
export function perimetreDeRegion(planning, soc) {
  const etat = lirePlanning(planning);
  const region = String(agLookup(soc, etat.agencesData).region || "").trim().toLowerCase();
  const socs = new Set([...etat.lots.map(l => l.soc), ...etat.vehicles.map(v => v.ag), soc]);
  const mesAgences = [...socs].filter(s => s === soc
    || (!!region && String(agLookup(s, etat.agencesData).region || "").trim().toLowerCase() === region));
  return { mesAgences: mesAgences.sort(), region };
}
