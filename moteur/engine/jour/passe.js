// ── LA PASSE AVANT, EN DEMI-JOURNÉES ───────────────────────────────────────────────────────────
//
// PORT FIDÈLE de `essais-v2/essai-2/lib/evaluateur-jour.mjs`. L'algorithme n'est PAS retouché : il
// a été vérifié champ par champ contre l'essai 1 sur 40 000 séquences, et l'épreuve différentielle
// de ce module le revérifie contre l'original. Ce qu'il sait faire, et rien d'autre :
//   · rouler         — km / kmParJour, arrondi à la demi-journée SUPÉRIEURE ;
//   · manutentionner — dureeH × (1 + margeDuree), arrondi à la demi-journée SUPÉRIEURE ;
//   · attendre       — si la fenêtre d'un arrêt n'est pas ouverte (« tempo », jamais pénalisé) ;
//   · rentrer        — Q17 : le camion n'est JAMAIS hors de son dépôt un samedi ou un dimanche.
//
// ⚠️ L'HEURISTIQUE Q17 EST GLOUTONNE, ET C'EST UNE LIMITE ASSUMÉE (héritée telle quelle) : elle
// décide arrêt par arrêt, sans revenir en arrière. Elle peut déclarer infaisable une séquence qu'un
// départ anticipé sauverait. Elle ne remonte JAMAIS un faisable en trop ; elle peut en manquer.
//
// ── LES SIX SEULS AJOUTS AU PORT, TOUS NEUTRES PAR DÉFAUT ──────────────────────────────────────
//   ① `ctx.km` — la distance est injectable (banc, tests, OSRM un jour). Défaut : haversine du
//      moteur, mémoïsé.
//   ② la TRACE — chaque état porte `segments` (route / arrêt / dépôt) et `ops` (le couple
//      demi-journée de début / de fin par arrêt). Écriture seule : rien ne les relit dans la passe.
//   ③ C5 `deuxOpsParJour` — neutre en "toujours".
//   ④ C6 `weekendCharge` — neutre en `true`.
//   ⑤ `arrondi` — neutre en "demi_journee". Voir ci-dessous.
//   ⑥ `approcheMemeJour` — neutre en "veille" (défaut de `contexte()`). Voir `approcheDuJourTient`.
// L'épreuve différentielle du module prouve cette neutralité : réglages par défaut, sortie
// identique à l'original sur des milliers de séquences.
//
// ── ⑧ LES BORNES FINES D'UN ARRÊT (Louis, 2026-09-28 : le bloc du transbordement) ─────────────
// Trois champs FACULTATIFS d'un arrêt, que seul un bloc transbordé porte (`transbo.js`,
// `extrasArretBloc`) — absents, la passe est celle d'avant, au bit près :
//   · `tMin`      — l'arrêt ne COMMENCE pas avant cet instant de l'axe (le bloc au dépôt suit la fin
//                   de la collecte par la navette : « l'après-midi du jour VL », pas « ce jour-là ») ;
//   · `tFinMax`   — l'arrêt est FINI au plus tard à cet instant (le bloc précède la livraison par la
//                   navette : « la veille au soir », et une livraison en temps continu déborde sur
//                   le lendemain matin — exactement ce qu'il ne faut pas). Le temps ne reculant
//                   jamais dans la passe, un arrêt qui finirait trop tard est un échec
//                   `fenetre_depassee` immédiat (`detail.finMax`) : attendre ne le sauverait pas ;
//   · `sansMarge` — sa durée n'est pas majorée de `margeDuree` : c'est un créneau (une
//                   demi-journée), pas une manutention estimée.
// La fenêtre en JOURS (`fenetre`) reste la contrainte ordinaire ; les bornes fines la précisent
// à l'intérieur d'un jour. Q17 : inchangée — l'arrêt reste soumis à la limite de son bloc de jours.
//
// ── ⑨ LA ROUTE FORCÉE (Louis, 2026-09-29 soir : « Forcer la route », avec un motif) ────────────
// Un champ FACULTATIF d'un arrêt, `routeForcee: true`, que seul `tournee.js` pose — et seulement
// quand l'exception du planificateur est encore valide (mêmes dates, même arrêt précédent). Absent,
// la passe est celle d'avant, au bit près. Présent, il ne joue QUE si l'arrêt, compté normalement,
// commencerait après son jour (le rendez-vous serait manqué) : la route est alors comptée dans le
// temps disponible — le camion arrive au début du jour imposé, ou tout de suite s'il n'est libre
// qu'au cours de ce jour-là — et la règle de début du mode continu (un chargement ne se coupe pas)
// ne repousse pas l'arrêt au lendemain : le planificateur a dit que ça passe. Les km ne changent
// pas. 🔴 Rien d'autre n'est relâché : le temps ne recule pas (un camion libre seulement le
// lendemain reste en retard), la capacité, l'ordre et Q17 — le retour avant le week-end ou le férié
// se contrôle exactement comme ailleurs, sur le temps compressé ; s'il ne tient pas, la passe fait
// ce qu'elle fait toujours (coupure au dépôt), et le rendez-vous est manqué comme sans forçage.
// Trace : le segment ROUTE et l'arrêt portent `forcee` / `routeForcee` et les demi-journées gagnées.
//
// ── ⑩ LA COUPURE CHARGÉE LOIN DU DÉPÔT (Louis, 2026-10-01 : « la règle des 150 km ») ────────────
// « Si la fin d'un dossier ne passe pas sur la fin de semaine et que la dernière livraison est à
// moins de 150 km du dépôt, la livraison passe au lundi suivant : le camion rentre au dépôt avant
// vendredi soir, puis le lundi part faire sa livraison. » Au-delà : REFUS dans tous les cas (ni
// proposé, ni posable à la main — il faut livrer avant le week-end ou transborder).
// Avant ce jour, la passe faisait rentrer le camion CHARGÉ quelle que soit la distance : un camion
// de Guer revenant de Marseille rentrait au dépôt le vendredi et repartait le lundi livrer Paris
// (439 km), puis revenait — un aller-retour que personne ne ferait.
// `ctx.coupureChargeeMaxKm` (absent ou `null` : aucune limite, la passe d'avant au bit près) : une
// coupure au dépôt CAMION CHARGÉ (week-end ou férié) n'est admise que si le dépôt est « sur le
// chemin » — l'une de ces trois conditions, avec le même seuil :
//   · l'arrêt qui SUIT la coupure est à ce nombre de km du dépôt au plus (le cas de Louis : la
//     dernière livraison près du dépôt, livrée le lundi) ;
//   · passer par le dépôt ne rallonge la route que de ce nombre de km au plus (ARBITRÉ par Louis le
//     01/10 après mesure : « dépôt sur la route = admis » — la boucle retour BLAVIER + SIMON revient de
//     Toulon, passe le week-end à Guer et livre Quimper le lundi, à 187 km du dépôt mais pour 90 km de
//     détour ; à la lettre, la règle la refusait) ;
//   · l'arrêt qui PRÉCÈDE la coupure est à ce nombre de km du dépôt au plus (lecture de
//     l'implémentation, 🟠 à confirmer : « charger le vendredi près du dépôt, partir le lundi », en
//     production depuis le 22/07 — Nantes → Toulon pour un camion de Guer : 121 km du dépôt, 250 km de
//     détour).
// Sinon : échec `q17_coupure_chargee_loin` — rentrer chargé pour repartir livrer à l'opposé (revenir
// de Marseille à Guer pour livrer Paris : 750 km de détour). Mesuré le 01/10 sur les 76 tournées
// réelles : aucune refusée. Une coupure À VIDE n'est pas concernée (les km évités la jugent).
//
// ── ⑦ LES JOURS FÉRIÉS (Louis, 2026-09-27) — PAS UN RÉGLAGE ────────────────────────────────────
// « Comme un week-end, pour l'affichage ET pour le moteur » : aucune opération ce jour-là, et le
// camion est au dépôt. Le férié reste une case de l'axe (`calendrier.js`), mais une case FERMÉE :
// la « semaine » de Q17 devient le BLOC de jours ouverts consécutifs (`finDeBloc`,
// `debutBlocSuivant`, `debutDeBloc`). Tout ce qui s'écrivait « avant le lundi suivant » s'écrit
// « avant la fin du bloc » ; tout ce qui repartait « le lundi » repart « au début du bloc suivant ».
// Le camion rentre donc au dépôt la veille du férié — chargé s'il le faut, exactement comme un
// vendredi (C6) — et repart le lendemain. Comme Q17, ce n'est PAS un réglage : aucune option ne
// l'éteint. Sur une semaine sans férié, chaque borne est identique à celle d'origine, au bit près :
// l'épreuve différentielle le vérifie sur toutes les séquences qui ne touchent aucun férié (le
// prototype, lui, ne les connaît pas).
//
// ── ⑤ L'ARRONDI, ET LA TROISIÈME MARGE CACHÉE ──────────────────────────────────────────────────
// Le prototype arrondit CHAQUE segment à la demi-journée SUPÉRIEURE. Sur les longues distances
// c'est anodin ; sur les petits sauts c'est énorme : Quimper → Vannes (138 km, 1 h 58) puis un
// chargement de 24 m³ (2 h 24) puis le retour à Guer (72 km, 1 h 02) font 5 h 24 de travail réel —
// ça tient dans une demi-journée — et sont facturés TROIS demi-journées, soit 16 h 30. Le vendredi
// déborde, Q17 renvoie tout au lundi, et une mutualisation évidente disparaît. C'est une troisième
// marge, en plus de `kmParJour` et de `margeDuree`, et elle n'a jamais été arbitrée.
//
// `arrondi: "fin"` supprime cet arrondi : le temps s'accumule en CONTINU sur le même axe, la date
// d'une opération est le jour où elle COMMENCE, et la règle de début est celle du moteur horaire
// (`CLAUDE.md`, « Chargement même jour ») — qui ne porte que sur les CHARGEMENTS (voir
// `debutSelonArrondi`). Q17, la coupure dépôt, la capacité et les fenêtres sont INCHANGÉES : mêmes
// comparaisons, en flottants, à EPS près.
//
// ✅ Le banc du 2026-09-21 a tranché : `REGLAGES_DEFAUT.arrondi` vaut désormais "fin" (15 refus sur
// 76 tournées réelles en demi-journées, contre 1 en continu).
// ⚠️ MAIS `contexte()` garde ici son défaut littéral "demi_journee" : c'est la primitive du PORT,
// et l'épreuve différentielle l'appelle en direct. Les deux défauts sont VOULUS et différents —
// `reglages.js` porte le défaut PRODUIT, `passe.js` le comportement du prototype. Un test le fixe.

import { gc as gcMoteur, hav } from "../../data/gps.js";
import {
  isoDeJour, jourDe, jourFinDe, finDeSemaine, finDeBloc, debutBlocSuivant, debutDeBloc, blocComplet,
  estFerme, fermesEntre, EPS, JOURS_SEMAINE,
} from "./calendrier.js";

const CACHE_GC = new Map();

// `gc` du moteur balaie ~6 000 clés dès que le code postal n'est pas exactement au référentiel.
// Le cache ne change AUCUNE valeur : même fonction, même résultat, appelée une fois par CP.
export function gc(cp) {
  const k = String(cp);
  let v = CACHE_GC.get(k);
  if (v === undefined) { v = gcMoteur(cp); CACHE_GC.set(k, v); }
  return v;
}

const CACHE_KM = new Map();

// Distance par défaut : haversine du moteur, mémoïsée par couple de codes postaux.
export function kmEntre(a, b) {
  const A = String(a), B = String(b);
  if (A === B) return 0;
  const k = A < B ? A + " " + B : B + " " + A;
  let v = CACHE_KM.get(k);
  if (v === undefined) { v = hav(gc(A), gc(B)); CACHE_KM.set(k, v); }
  return v;
}

// Les quatre abaques du prototype. `comptes.large` / `comptes.juste` de `reglages.js` en reprennent
// deux ; les deux autres restent disponibles pour le banc.
export const ABAQUES = {
  "serré": { kmParJour: 770, margeDuree: 0 },
  "normal": { kmParJour: 650, margeDuree: 0.15 },
  "large": { kmParJour: 550, margeDuree: 0.30 },
  "très large": { kmParJour: 450, margeDuree: 0.50 },
};

export const HEURES_JOUR = 11;

// ── LE CONTEXTE ────────────────────────────────────────────────────────────────────────────────
// Ce qui ne change pas d'un arrêt à l'autre : le dépôt, la capacité, l'abaque, la distance, et les
// deux réglages C5 / C6.
export function contexte({ depotCp, capacite, abaques, km, heuresJour, deuxOpsParJour, weekendCharge,
  arrondi, resteMinPourCommencerH, approcheMemeJour, coupureChargeeMaxKm }) {
  const A = abaques || ABAQUES.normal;
  const hJour = heuresJour || HEURES_JOUR;
  const hDemi = hJour / 2;
  const mesure = km || kmEntre;
  const continu = arrondi === "fin";
  return {
    depotCp: String(depotCp), capacite, A,
    heuresJour: hJour,
    deuxOpsParJour: deuxOpsParJour === undefined ? "toujours" : deuxOpsParJour,
    weekendCharge: weekendCharge === undefined ? true : weekendCharge,
    // Ajout ⑩ : neutre (aucune limite) quand il n'est pas demandé.
    coupureChargeeMaxKm: typeof coupureChargeeMaxKm === "number" ? coupureChargeeMaxKm : null,
    arrondi: continu ? "fin" : "demi_journee", continu,
    // Ajout ⑥ : neutre ("veille", le prototype) quand il n'est pas demandé.
    approcheMemeJour: approcheMemeJour === "journee" || approcheMemeJour === "matinee" ? approcheMemeJour : "veille",
    // Reste de journée ouvrée minimal pour ENGAGER une livraison, en demi-journées.
    resteMin: (resteMinPourCommencerH === undefined ? 1 : resteMinPourCommencerH) / hDemi,
    km: mesure,
    route: (a, b) => {
      const d = mesure(a, b);
      if (d === 0) return { km: 0, demi: 0 };
      const brut = (d / A.kmParJour) * 2;
      return { km: d, demi: continu ? brut : Math.ceil(brut) };
    },
    // `sansMarge` (ajout ⑧) : un créneau fixe (le bloc du transbordement) n'est pas majoré.
    demiArret: (h, sansMarge = false) => {
      const brut = ((h || 0) * (1 + (sansMarge ? 0 : A.margeDuree))) / hDemi;
      // ⚠️ Le plancher d'une demi-journée par arrêt DISPARAÎT en mode continu : un chargement de
      // 2 h coûte 2 h, pas 5 h 30. C'est le sens même du mode.
      return continu ? brut : Math.max(1, Math.ceil(brut));
    },
  };
}

export function etatInitial(ctx, premierArret) {
  return {
    // ⑦ Le début du BLOC du premier arrêt (sans férié : le lundi de sa semaine, comme l'original).
    t: debutDeBloc(premierArret.fenetre[0]),
    pos: ctx.depotCp, auDepot: true, tSortie: null,
    km: 0, aBord: 0, volMax: 0, tempoDemi: 0, coupures: 0, demiProductifs: 0,
    jourDepart: null, jours: [], sorties: [],
    // Trace (ajout ② : écriture seule).
    segments: [], ops: [], dernierJourOp: null, dernierVolOp: 0,
  };
}

const copier = (e) => ({
  t: e.t, pos: e.pos, auDepot: e.auDepot, tSortie: e.tSortie,
  km: e.km, aBord: e.aBord, volMax: e.volMax, tempoDemi: e.tempoDemi,
  coupures: e.coupures, demiProductifs: e.demiProductifs,
  jourDepart: e.jourDepart, jours: e.jours.slice(), sorties: e.sorties.slice(),
  segments: e.segments.slice(), ops: e.ops.slice(),
  dernierJourOp: e.dernierJourOp, dernierVolOp: e.dernierVolOp,
});

const ECHEC = (motif, detail = null) => ({ ok: false, motif, detail });

// ── AJOUT ③ — C5, DEUX OPÉRATIONS LE MÊME JOUR ─────────────────────────────────────────────────
// Rend la demi-journée de début corrigée. En "toujours" (défaut) elle ne touche à rien : la passe
// d'origine autorise déjà deux arrêts dans la même journée, une par demi-journée.
function debutSelonC5(ctx, e, a, tDeb) {
  const regle = ctx.deuxOpsParJour;
  if (regle === "toujours" || e.dernierJourOp === null) return tDeb;
  if (jourDe(tDeb) !== e.dernierJourOp) return tDeb;
  const vol = a.volume || 0;
  if (regle && typeof regle === "object" && typeof regle.volumeMax === "number") {
    // Deux opérations le même jour restent permises tant que les DEUX sont petites.
    if (vol <= regle.volumeMax && e.dernierVolOp <= regle.volumeMax) return tDeb;
  }
  return 2 * (e.dernierJourOp + 1);
}

// ── AJOUT ⑤ — LA RÈGLE DE DÉBUT DU MODE CONTINU ────────────────────────────────────────────────
//
// 🔑 UN CHARGEMENT NE SE COUPE PAS, UNE LIVRAISON SI. La règle « Chargement même jour » de
// `CLAUDE.md` porte sur les CHARGEMENTS, et sur eux seuls — on ne commence pas à vider une maison
// à 17 h pour la finir le lendemain, les meubles restent chez le client. À la livraison, c'est
// l'inverse : le camion est là, chargé, et l'équipe décharge ce qu'elle peut. Le planning réel le
// fait 14 fois sur 204 manutentions (15 h → 18 h puis 7 h → 8 h le lendemain), et c'était la
// PREMIÈRE cause de désaccord du module avec la production — 10 des 18 signaux négatifs du banc
// du 2026-09-21. La règle avait été appliquée aux deux à tort.
//
//   · CHARGEMENT — s'il tient en une journée mais pas dans ce qu'il reste de celle-ci, il attend
//     le lendemain matin. S'il dure plus d'une journée, il démarre à l'arrivée dès qu'il reste au
//     moins une demi-journée (il sera coupé de toute façon).
//   · LIVRAISON — elle démarre à l'arrivée dès qu'il reste `resteMinPourCommencerH` de journée
//     ouvrée, et déborde sur le lendemain matin. Sa DATE reste le jour où elle commence.
//
// Sans objet en mode "demi_journee" : tout y est déjà calé sur les demi-journées.
function debutSelonArrondi(ctx, tDeb, S, type) {
  if (!ctx.continu) return tDeb;
  const finDuJour = 2 * (jourDe(tDeb) + 1);
  const restant = finDuJour - tDeb;
  if (type === "LIV") return restant < ctx.resteMin - EPS ? finDuJour : tDeb;
  if (S <= 2 + EPS) return S > restant + EPS ? finDuJour : tDeb;
  return restant < 1 - EPS ? finDuJour : tDeb;
}

// ── AJOUT ⑥ — L'APPROCHE LE MATIN MÊME (décision de Louis, 2026-09-24) ──────────────────────────
//
// La passe d'origine cale le départ du dépôt pour ARRIVER au premier arrêt pile au début de sa
// journée : l'approche, même de 10 km, tombe donc sur la VEILLE et y ouvre une sortie. Sur le
// planning réel, c'est ce qui faisait refuser au repos trois paires de tournées que le Gantt sépare
// (GA-832-RW #5 : 10 km mis la veille — RAPPORT-D9 § 5) : le camion rentré la veille au soir
// semblait déjà reparti.
//
// Ne concerne que l'approche d'un CHARGEMENT (le camion part vide du dépôt).
// "journee" — le camion part le matin même (7 h) dès que l'arrêt COMMENCE encore ce jour-là
//   (règle de début inchangée : un chargement qui ne tient plus dans le reste de la journée ne se
//   coupe pas, on garde alors l'approche la veille) et que le retour avant le week-end tient. C'est
//   ce que fait le Gantt : GL-896-CK #2 roule de 7 h à 14 h (380 km) et charge l'après-midi.
// "matinee" — même chose, mais seulement si l'approche tient dans une demi-journée.
// "veille"  — le prototype (défaut de `contexte()`, pour l'épreuve différentielle).
//
// 🔴 Q17 intacte : le départ ne fait que RECULER dans la même journée ouvrée (jamais vers un
// vendredi pour un lundi), et le contrôle du retour avant le week-end est refait ici avant d'y
// consentir ; `pas` le refait de toute façon ensuite.
function approcheDuJourTient(ctx, e, a, R) {
  if (ctx.approcheMemeJour === "veille") return false;
  // Seulement l'approche d'un CHARGEMENT (la décision porte sur « dépôt → premier chargement »).
  // Un camion qui repart CHARGÉ du dépôt vers une livraison (après une coupure) garde la veille :
  // la partir le matin même ne fait que déplacer le jour creux et rentrer le camion plus tard
  // (GQ-156-KL #4 : retour le mercredi au lieu du mardi).
  if (a.type !== "CHG") return false;
  if (ctx.approcheMemeJour === "matinee" && R.demi > 1 + EPS) return false;
  // ⑦ On ne part pas un jour férié : l'arrêt attend le bloc suivant, par le chemin ordinaire.
  if (estFerme(a.fenetre[0])) return false;
  const t0 = 2 * a.fenetre[0];
  if (e.t > t0 + EPS) return false;
  const tArr = t0 + R.demi;
  const S = ctx.demiArret(a.dureeH, a.sansMarge);
  // ⑧ Un début au plus tôt (bloc transbordé) retarde l'arrêt dans sa journée, comme une arrivée.
  const tDeb = debutSelonArrondi(ctx, debutSelonC5(ctx, e, a, Math.max(tArr, a.tMin ?? tArr)), S, a.type);
  if (jourDe(tDeb) !== a.fenetre[0]) return false;
  const Rret = ctx.route(a.cp, ctx.depotCp);
  return tDeb + S + Rret.demi <= finDeBloc(a.fenetre[0]) + EPS;
}

// ── AJOUT ⑩ — LA COUPURE CHARGÉE LOIN DU DÉPÔT (Louis, 2026-10-01) ──────────────────────────────
// Le camion, CHARGÉ, va passer un week-end ou un férié au dépôt avant l'arrêt `a`. Rend `null` si
// c'est admis (pas de limite, camion vide, ou dépôt « sur le chemin » : l'arrêt d'après près du dépôt,
// le détour par le dépôt sous le seuil, ou l'arrêt d'avant près du dépôt — cf. l'en-tête), sinon le
// détail du refus. L'arrêt d'avant est lu dans la trace (`segments`), parce que le camion peut déjà
// être rentré (`e.pos` = le dépôt).
function coupureChargeeTropLoin(ctx, e, a) {
  const max = ctx.coupureChargeeMaxKm;
  if (max === null || !(e.aBord > 1e-9)) return null;
  const kmApres = ctx.km(a.cp, ctx.depotCp);
  if (kmApres <= max + EPS) return null;                       // la dernière livraison près du dépôt (Louis)
  let avant = null;
  for (let k = e.segments.length - 1; k >= 0 && !avant; k--) {
    const s = e.segments[k];
    if (s.genre === "CHG" || s.genre === "LIV") avant = s;
  }
  const kmAvant = avant ? ctx.km(avant.cp, ctx.depotCp) : null;
  const detour = avant ? kmAvant + kmApres - ctx.km(avant.cp, a.cp) : null;
  // Le dépôt est sur la route (détour, arbitré le 01/10), ou l'arrêt d'avant est près du dépôt (🟠).
  if (avant && (detour <= max + EPS || kmAvant <= max + EPS)) return null;
  return {
    kmApres: Math.round(kmApres), kmAvant: kmAvant === null ? null : Math.round(kmAvant),
    detour: detour === null ? null : Math.round(detour), max, aBord: e.aBord,
  };
}

// ── UN ARRÊT ───────────────────────────────────────────────────────────────────────────────────
// Corps de la boucle de l'original, sur un état recopié. Rend { ok: true, etat } ou
// { ok: false, motif, detail }. `i` ne sert qu'aux messages de détail.
export function pas(ctx, etat0, a, i = 0) {
  const e = copier(etat0);
  let garde = 0;
  // ⑦ Chaque bloc écourté par un férié peut coûter un tour de plus (rentrer avant le férié, sauter
  // un bloc trop court) : autant de tours accordés en plus, bornés. Toujours 0 sans férié — la
  // garde d'origine (12) est alors inchangée.
  let tourFeries = 0;
  for (;;) {
    if (++garde > 12 + tourFeries) return ECHEC("boucle_q17", { arret: i });

    const R = ctx.route(e.pos, a.cp);
    if (e.auDepot) {
      const jat = 2 * a.fenetre[0] - R.demi;
      if (jat > e.t) e.t = jat;
      // Ajout ⑥ : l'approche part le matin même quand l'arrêt tient encore dans sa journée.
      if (jourDe(e.t) < a.fenetre[0] && approcheDuJourTient(ctx, e, a, R)) e.t = 2 * a.fenetre[0];
    }
    let tArr = e.t + R.demi;
    const S = ctx.demiArret(a.dureeH, a.sansMarge);
    // ⑧ `tMin` : l'arrêt ne commence pas avant (absent : aucune contrainte de plus).
    let tDeb = debutSelonArrondi(ctx, debutSelonC5(ctx, e, a,
      Math.max(tArr, 2 * a.fenetre[0], a.tMin ?? Number.NEGATIVE_INFINITY)), S, a.type);
    // ⑨ La route forcée : seulement quand, comptée normalement, elle ferait manquer le jour de
    // l'arrêt. `Rc` est la route telle qu'on la COMPTE (le temps compressé, les mêmes km).
    let Rc = R;
    let forcage = null;
    if (a.routeForcee && jourDe(tDeb) > a.fenetre[1]) {
      const tArrF = Math.max(e.t, 2 * a.fenetre[0]);
      const tDebF = debutSelonC5(ctx, e, a, Math.max(tArrF, a.tMin ?? Number.NEGATIVE_INFINITY));
      if (jourDe(tDebF) <= a.fenetre[1]) {
        Rc = { km: R.km, demi: tArrF - e.t };
        forcage = { demiGagnees: R.demi - Rc.demi, km: R.km };
        tArr = tArrF;
        tDeb = tDebF;
      }
    }
    const tFin = tDeb + S;
    const Rret = ctx.route(a.cp, ctx.depotCp);

    if (jourDe(tDeb) > a.fenetre[1]) {
      return ECHEC("fenetre_depassee", { arret: i, lot: a.lot, type: a.type, jour: jourDe(tDeb), max: a.fenetre[1] });
    }
    // ⑧ `tFinMax` : fini trop tard. Rien de ce qui suit (retour au dépôt, bloc suivant) ne peut le
    // rattraper — le temps ne recule pas : échec tout de suite.
    if (a.tFinMax !== undefined && a.tFinMax !== null && tFin > a.tFinMax + EPS) {
      return ECHEC("fenetre_depassee", { arret: i, lot: a.lot, type: a.type, jour: jourDe(tDeb), max: a.fenetre[1], finMax: a.tFinMax });
    }

    const refSortie = e.auDepot ? e.t : e.tSortie;
    // ⑦ La sortie tient dans son BLOC : rentrée avant le premier férié qui suit son départ, sinon
    // avant le lundi (sans férié, `finDeBloc` = `finDeSemaine`, au bit près).
    const limite = finDeBloc(jourDe(refSortie));
    // ⑦ Un bloc écourté par un férié (ou un départ calé SUR un férié) : un tour de plus accordé.
    const courtParFerie = limite < finDeSemaine(jourDe(refSortie)) - EPS;

    // ⑦ … et aucune opération ne COMMENCE un jour férié. La limite de bloc l'exclut déjà dès que
    // l'opération ou le retour dure quoi que ce soit ; la garde couvre le cas dégénéré (arrêt au
    // dépôt, durée nulle) qui finirait pile au début du férié.
    if (tFin + Rret.demi <= limite + EPS && !estFerme(jourDe(tDeb))) {
      if (e.auDepot) { e.tSortie = e.t; if (e.jourDepart === null) e.jourDepart = jourDe(e.t); }
      e.auDepot = false;
      e.km += Rc.km;
      e.tempoDemi += Math.max(0, tDeb - tArr);
      e.demiProductifs += Rc.demi + S;
      if (Rc.demi > 0 || Rc.km > 0) {
        e.segments.push({
          genre: "ROUTE", de: e.pos, vers: a.cp, km: Rc.km, tDebut: e.t, tFin: tArr,
          ...(forcage ? { forcee: true, demiGagnees: forcage.demiGagnees } : {}),
        });
      }
      e.t = tFin;
      e.pos = a.cp;
      if (a.type === "CHG") {
        e.aBord += a.volume || 0;
        if (ctx.capacite != null && e.aBord > ctx.capacite + 1e-9) {
          return ECHEC("capacite", { arret: i, lot: a.lot, aBord: e.aBord, capacite: ctx.capacite });
        }
      } else {
        e.aBord -= a.volume || 0;
        if (e.aBord < -1e-9) return ECHEC("sequence_invalide", { arret: i, lot: a.lot });
      }
      if (e.aBord > e.volMax) e.volMax = e.aBord;
      e.jours.push(jourDe(tDeb));
      e.segments.push({ genre: a.type, lot: a.lot, cp: a.cp, tDebut: tDeb, tFin, aBord: e.aBord });
      e.ops.push({
        arret: i, lot: a.lot, type: a.type, tDebut: tDeb, tFin,
        ...(forcage ? { routeForcee: true, demiGagnees: forcage.demiGagnees, kmForces: forcage.km } : {}),
      });
      e.dernierJourOp = jourFinDe(tFin, ctx.continu);
      e.dernierVolOp = a.volume || 0;
      return { ok: true, etat: e };
    }

    if (courtParFerie && tourFeries < 8) tourFeries++;

    if (e.auDepot) {
      // ⑦ On attend le bloc SUIVANT (sans férié : le lundi suivant, comme l'original).
      const tL = debutBlocSuivant(jourDe(e.t));
      const tArrL = tL + R.demi;
      const tDebL = debutSelonArrondi(ctx, Math.max(tArrL, 2 * a.fenetre[0], a.tMin ?? Number.NEGATIVE_INFINITY), S, a.type);
      if (Math.abs(tDebL - tArrL) < EPS && tDebL + S + Rret.demi > finDeBloc(jourDe(tL)) + EPS) {
        // ⑦ La mission ne tient pas dans le bloc suivant. Si c'est une semaine ENTIÈRE, aucun bloc
        // ne suffira jamais : c'est le refus d'origine. S'il est écourté par un férié, un bloc plus
        // long viendra — on l'attend (sauf si la mission dépasse même une semaine entière).
        const besoin = tDebL - tL + S + Rret.demi;
        if (blocComplet(jourDe(tL)) || besoin > 2 * JOURS_SEMAINE + EPS || tourFeries >= 8) {
          return ECHEC("q17_semaine_insuffisante", {
            arret: i, lot: a.lot, type: a.type,
            demiAller: R.demi, demiArret: S, demiRetour: Rret.demi,
          });
        }
        if (tourFeries < 8) tourFeries++;
      }
      // Ajout ⑩ : un camion qui attend CHARGÉ au dépôt le bloc suivant (il y est rentré par le mode
      // diagnostic, ou un férié l'y retient) passe là aussi un week-end ou un férié chargé.
      // `apresFermeture` : la fenêtre de l'arrêt ne s'ouvre qu'APRÈS le week-end (il a été demandé pour
      // le lundi) — sinon c'est un arrêt de CETTE semaine qui n'y tient pas (lu par le diagnostic).
      const loinDepot = coupureChargeeTropLoin(ctx, e, a);
      if (loinDepot) {
        return ECHEC("q17_coupure_chargee_loin", { arret: i, lot: a.lot, type: a.type, ...loinDepot, apresFermeture: 2 * a.fenetre[0] >= limite - EPS });
      }
      e.t = tL;
      continue;
    }

    // ── AJOUT ④ — C6 : le camion peut-il rentrer CHARGÉ pour le week-end ? ────────────────────
    // Neutre par défaut (`weekendCharge: true`). À `false`, une coupure dépôt chargée devient un
    // refus Q17 : le camion ne peut pas rentrer, donc il ne peut pas partir.
    if (!ctx.weekendCharge && e.aBord > 1e-9) {
      return ECHEC("q17_weekend_charge", { arret: i, lot: a.lot, aBord: e.aBord });
    }
    // Ajout ⑩ : rentrer chargé pour le week-end, oui — mais pas pour repartir livrer au loin.
    const loin = coupureChargeeTropLoin(ctx, e, a);
    if (loin) {
      return ECHEC("q17_coupure_chargee_loin", { arret: i, lot: a.lot, type: a.type, ...loin, apresFermeture: 2 * a.fenetre[0] >= limite - EPS });
    }

    const Rd = ctx.route(e.pos, ctx.depotCp);
    if (e.t + Rd.demi > limite + EPS) return ECHEC("q17_retour_impossible", { arret: i, lot: a.lot });
    e.km += Rd.km;
    if (Rd.demi > 0 || Rd.km > 0) {
      e.segments.push({ genre: "ROUTE", de: e.pos, vers: ctx.depotCp, km: Rd.km, tDebut: e.t, tFin: e.t + Rd.demi });
    }
    e.t += Rd.demi;
    e.demiProductifs += Rd.demi;
    e.sorties.push([e.tSortie, e.t]);
    e.segments.push({ genre: "DEPOT", cp: ctx.depotCp, tDebut: e.t, aBord: e.aBord, coupure: true });
    e.pos = ctx.depotCp;
    e.auDepot = true;
    e.coupures++;
    // ⑦ Le camion repart au début du bloc suivant : le lendemain du férié, ou le lundi.
    e.t = debutBlocSuivant(Math.max(jourFinDe(e.t, ctx.continu), jourDe(e.tSortie)));
  }
}

// Attente NON PRODUCTIVE accumulée à ce point du parcours (en jours ouvrés). Croissante le long de
// la séquence — c'est cette propriété qui rend l'élagage d'une énumération exact.
export function attenteCourante(etat) {
  if (etat.jourDepart === null) return 0;
  // ⑦ Un férié passé au dépôt n'est pas de l'attente, pas plus qu'un week-end (qui, lui, n'est pas
  // sur l'axe). Chaque case fermée écoulée est retirée : la quantité reste croissante (elle stagne
  // pendant le férié), donc l'élagage de l'énumération reste exact. Sans férié : 0 retiré.
  return ((etat.t - 2 * etat.jourDepart) - etat.demiProductifs) / 2 - feriesEcoules(etat.jourDepart, etat.t);
}

// Cases fermées ENTIÈREMENT écoulées entre le jour de départ et l'instant `t` : un férié `k` occupe
// [2k, 2k + 2[ ; il est retiré une fois passé. (La passe ne rend jamais un état dont l'instant tombe
// À L'INTÉRIEUR d'un férié : une opération finit au plus tard au début du bloc fermé.)
function feriesEcoules(jourDepart, t) {
  const dernier = Math.floor(t / 2 + EPS) - 1;
  return dernier > jourDepart ? fermesEntre(jourDepart + 1, dernier) : 0;
}

// ── LE RETOUR FINAL ────────────────────────────────────────────────────────────────────────────
export function cloturer(ctx, etat) {
  const Rfin = ctx.route(etat.pos, ctx.depotCp);
  const km = etat.km + Rfin.km;
  const demiProductifs = etat.demiProductifs + Rfin.demi;
  const tFin = etat.t + Rfin.demi;
  const sorties = etat.auDepot ? etat.sorties : [...etat.sorties, [etat.tSortie, tFin]];
  const jourRetour = Math.max(jourFinDe(tFin, ctx.continu), jourDe(etat.tSortie ?? 0));
  // ⑦ Les fériés traversés (camion au dépôt) ne sont ni des jours de camion ni de l'attente, pas
  // plus qu'un week-end. Sans férié : 0, la sortie d'origine.
  const feriesTraverses = etat.jourDepart !== null && jourRetour > etat.jourDepart
    ? fermesEntre(etat.jourDepart + 1, jourRetour) : 0;

  const segments = etat.segments.slice();
  if (!etat.auDepot) {
    if (Rfin.demi > 0 || Rfin.km > 0) {
      segments.push({ genre: "ROUTE", de: etat.pos, vers: ctx.depotCp, km: Rfin.km, tDebut: etat.t, tFin });
    }
    segments.push({ genre: "DEPOT", cp: ctx.depotCp, tDebut: tFin, aBord: etat.aBord, coupure: false });
  }

  return {
    faisable: true, motif: null, detail: null,
    jours: etat.jours, joursIso: etat.jours.map(isoDeJour),
    km: Math.round(km),
    jourDepart: etat.jourDepart, jourRetour,
    joursMobilises: jourRetour - etat.jourDepart + 1 - feriesTraverses,
    volumeMaxABord: Math.round(etat.volMax * 100) / 100,
    joursTempo: etat.tempoDemi / 2,
    joursAttente: ((tFin - 2 * etat.jourDepart) - demiProductifs) / 2 - feriesTraverses,
    coupures: etat.coupures, sorties,
    segments, ops: etat.ops, tFin,
  };
}

const echecComplet = (motif, detail = null) => ({
  faisable: false, motif, detail,
  jours: [], km: 0, jourDepart: null, jourRetour: null, volumeMaxABord: 0, joursTempo: 0,
  coupures: 0, sorties: [], segments: [], ops: [], tFin: null,
});

// ── LA PASSE COMPLÈTE ──────────────────────────────────────────────────────────────────────────
// Même signature et même sortie que `evaluerJour` du prototype : c'est l'objet de l'épreuve
// différentielle. `ctx` peut être fourni pour éviter de le reconstruire.
export function evaluerSequence({ depotCp, capacite, arrets, abaques, ctx: ctxFourni }) {
  if (!arrets || !arrets.length) return echecComplet("sequence_vide");
  const ctx = ctxFourni || contexte({ depotCp, capacite, abaques });
  let etat = etatInitial(ctx, arrets[0]);
  for (let i = 0; i < arrets.length; i++) {
    const r = pas(ctx, etat, arrets[i], i);
    if (!r.ok) return echecComplet(r.motif, r.detail);
    etat = r.etat;
  }
  return cloturer(ctx, etat);
}

// ── KM GÉOMÉTRIQUES ────────────────────────────────────────────────────────────────────────────
// L'ancienne comptabilité : elle ne facture AUCUN retour au dépôt du week-end. Conservée pour le
// banc et pour les garde-fous de greffe (la seule mesure que le métier ait arbitrée).
export function kmLotSeul(depotCp, cpC, cpL, km = kmEntre) {
  return km(depotCp, cpC) + km(cpC, cpL) + km(cpL, depotCp);
}

export function kmSequence(depotCp, cps, km = kmEntre) {
  let total = 0;
  let prev = depotCp;
  for (const cp of cps) { if (String(cp) !== String(prev)) total += km(prev, cp); prev = cp; }
  if (String(prev) !== String(depotCp)) total += km(prev, depotCp);
  return total;
}
