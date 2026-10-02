// ── LES GARDE-FOUS G1 / G2 / G5 SUR UNE TOURNÉE DE N LOTS ──────────────────────────────────────
//
// Port de `essais-v2/essai-2/lib/gardes.mjs`. Les fonctions de verdict du moteur
// (`checkRetourPiliers`, `checkMutuZones`, `memePerimetreMutu`, `manutAccroche`, les accesseurs de
// seuil) sont IMPORTÉES, jamais réécrites : une règle qui vit à deux endroits finit par diverger.
//
// 🔴 CE QUI SUIT RESTE UNE GÉNÉRALISATION D'ANALYSTE. Le métier a arbitré G1, G2 et G5 sur une
// GREFFE — un accroché posé sur une ancre — et la tournée plafonne à trois lots dans le moteur
// d'aujourd'hui. Personne n'a arbitré ce que « détour » veut dire sur une tournée de quatre lots.
//
// ── LE PRINCIPE : UNE TOURNÉE EST UNE SUITE DE GREFFES ─────────────────────────────────────────
// Le moteur ne connaît qu'un geste : greffer un lot sur ce qui existe déjà. Une tournée de N lots
// est donc N−1 greffes, chacune jugée par les seuils d'UNE greffe. C'est la lettre de l'arbitrage
// du 2026-09-02 : « pas de budget de détour de tournée — chaque greffe garde ses 500 km ».
//
// ── COMMENT ON LIT LA STRUCTURE DANS LA SÉQUENCE ───────────────────────────────────────────────
// On parcourt les arrêts en suivant ce qui est à bord :
//   · un chargement qui arrive camion déjà chargé → le lot rejoint le GROUPE : MUTUALISATION ;
//   · un chargement qui arrive camion vide → il ouvre un groupe : RETOUR sur le précédent.
// La TÊTE d'un groupe est son premier lot chargé : c'est elle qui porte l'identité du groupe pour
// le lien suivant (règle P8 du moteur). À N = 2 cette lecture redonne exactement les deux
// géométries du moteur — l'épreuve d'identité le vérifie.

import { checkRetourPiliers, checkMutuZones } from "../../utils/zones.js";
import { memePerimetreMutu } from "../chainBuilder.js";
import { manutAccroche } from "../mesuresBoucle.js";
import { gardeDetourRetour, gardeDetourMutu, gardeRendement } from "../../data/referentiels.js";
import { kmSequence, kmLotSeul, kmEntre, HEURES_JOUR } from "./passe.js";

// ── LA STRUCTURE D'UNE SÉQUENCE ────────────────────────────────────────────────────────────────
// `arrets` : [{ lot, type: "CHG"|"LIV" }]. Rend les groupes (têtes en premier), l'ordre
// d'accrétion, et pour chaque lot le type du lien qui l'a introduit.
export function structureTournee(arrets) {
  const groupes = [];
  const ordre = [];
  const lien = new Map();        // lotId → { type: "mutu"|"retour", surLot: tête visée }
  const groupeDe = new Map();    // lotId → index de groupe
  let aBord = 0;
  for (const a of arrets) {
    if (a.type === "CHG") {
      if (aBord === 0) {
        const tetePrec = groupes.length ? groupes[groupes.length - 1][0] : null;
        groupes.push([a.lot]);
        if (tetePrec !== null) lien.set(a.lot, { type: "retour", surLot: tetePrec });
      } else {
        const g = groupes[groupes.length - 1];
        lien.set(a.lot, { type: "mutu", surLot: g[0] });
        g.push(a.lot);
      }
      groupeDe.set(a.lot, groupes.length - 1);
      ordre.push(a.lot);
      aBord++;
    } else {
      aBord--;
    }
  }
  const forme = groupes.map(g => g.length).join("+");   // « 1+1 », « 2+1 », « 3+1 »…
  return { groupes, ordre, lien, groupeDe, forme };
}

// ── G1 — LE TERRITOIRE, LIEN PAR LIEN ──────────────────────────────────────────────────────────
// `lotsById` : Map id → { id, soc, cpC, cpL }. `depotCp` : le dépôt du CAMION (D6 : c'est lui le
// vrai pilier, pas le chargement de l'ancre). Zones vides ⇒ règle inactive, comme dans le moteur.
export function g1Tournee({ structure, lotsById, depotCp, zones, agencesData }) {
  for (const [id, l] of structure.lien) {
    const acc = lotsById.get(id);
    const anc = lotsById.get(l.surLot);
    if (!acc || !anc) continue;
    if (l.type === "mutu") {
      if (!memePerimetreMutu(anc.soc, acc.soc, agencesData)) {
        return { ok: false, cause: "perimetre_mutu", lien: `${anc.id}+${acc.id}`, anc: anc.id, acc: acc.id,
          raison: "les deux lots ne relèvent ni de la même agence ni d'une même région" };
      }
      const r = checkMutuZones({ chgAncre: anc.cpC, chgAccroche: acc.cpC }, zones);
      if (!r.ok) return { ok: false, cause: "G1_mutu", lien: `${anc.id}+${acc.id}`, anc: anc.id, acc: acc.id, raison: r.raison };
    } else {
      if (anc.soc === acc.soc) {
        return { ok: false, cause: "meme_agence_retour", lien: `${anc.id}>${acc.id}`, anc: anc.id, acc: acc.id,
          raison: "un retour relie deux agences différentes" };
      }
      const r = checkRetourPiliers({
        depot: depotCp, chgAncre: anc.cpC, livAncre: anc.cpL,
        chgAccroche: acc.cpC, livAccroche: acc.cpL,
      }, zones);
      if (!r.ok) return { ok: false, cause: "G1_retour", lien: `${anc.id}>${acc.id}`, anc: anc.id, acc: acc.id, raison: r.raison };
    }
  }
  return { ok: true };
}

// ── G1, VERSION « PAIRE » — pour l'élagage en amont d'une énumération ──────────────────────────
// Deux lots ne peuvent voyager ensemble que si au moins un des deux liens possibles tient, dans un
// sens ou dans l'autre. Condition NÉCESSAIRE, jamais un verdict de tournée.
export function pairePossible({ a, b, depotCp, zones, agencesData }) {
  if (memePerimetreMutu(a.soc, b.soc, agencesData) && checkMutuZones({ chgAncre: a.cpC, chgAccroche: b.cpC }, zones).ok) return true;
  if (a.soc !== b.soc) {
    if (checkRetourPiliers({ depot: depotCp, chgAncre: a.cpC, livAncre: a.cpL, chgAccroche: b.cpC, livAccroche: b.cpL }, zones).ok) return true;
    if (checkRetourPiliers({ depot: depotCp, chgAncre: b.cpC, livAncre: b.cpL, chgAccroche: a.cpC, livAccroche: a.cpL }, zones).ok) return true;
  }
  return false;
}

// ── G2 ET G5, GREFFE PAR GREFFE ────────────────────────────────────────────────────────────────
// `détour(greffe k) = km(tournée réduite aux lots 1..k) − km(tournée réduite aux lots 1..k−1)`,
// les deux mesurées sur la MÊME séquence, dépôt aux deux bouts. À N = 2 cette formule vaut
// EXACTEMENT `mesuresRetour` / `mesuresMutu` du moteur — c'est l'épreuve d'identité.
//
// ⚠️ MESURE GÉOMÉTRIQUE, EN TOUTES CIRCONSTANCES, y compris quand la tournée est comptée en km
// réels. C'est voulu : les 500 km de G2 ont été calibrés sur cette mesure-là, et c'est la seule
// qui soit identique à celle du moteur. Le réglage `kmGardes` ne porte que sur les chiffres de
// tournée (`km`, `kmSeuls`, `kmEvites`).
//
// `depotLot(id)` rend le dépôt de l'agence du lot : ce que le lot aurait coûté SEUL se compte
// depuis chez lui, pas depuis le dépôt du camion qui le transporte.
export function g2g5Tournee({ arrets, structure, lotsById, depotCp, depotLot, rules = {}, km = kmEntre }) {
  const budget = { retour: gardeDetourRetour(rules), mutu: gardeDetourMutu(rules) };
  const rendMin = gardeRendement(rules);
  const vitesse = rules?.vitessePL || 70;

  const ordre = structure.ordre;
  const greffes = [];
  let kmPrec = null;
  let kmTotal = 0;
  for (let k = 0; k < ordre.length; k++) {
    const jusqua = new Set(ordre.slice(0, k + 1));
    const cps = arrets.filter(a => jusqua.has(a.lot)).map(a => a.cp);
    const kmK = kmSequence(depotCp, cps, km);
    if (k === 0) { kmPrec = kmK; kmTotal = kmK; continue; }
    const detour = kmK - kmPrec;
    kmPrec = kmK; kmTotal = kmK;
    const id = ordre[k];
    const lot = lotsById.get(id);
    const type = structure.lien.get(id).type;
    const seul = kmLotSeul(depotLot(id), lot.cpC, lot.cpL, km);
    const kmEco = seul - detour;
    // La RALLONGE : le détour roulé plus la manutention de l'accroché, ramenés en journées. Le
    // plancher de 2 h de la manutention domine la plupart des lots — une rallonge n'est jamais
    // nulle, même sur un accroché pile sur la route.
    const rallongeJ = (detour / vitesse + manutAccroche(lot, rules)) / HEURES_JOUR;
    const g = { lot: id, type, detour: Math.round(detour), kmEco: Math.round(kmEco), rallongeJ };
    if (detour > budget[type]) {
      return { ok: false, cause: "G2", greffe: g, greffes: [...greffes, g], kmTournee: Math.round(kmTotal) };
    }
    if (kmEco < rendMin * rallongeJ) {
      return { ok: false, cause: "G5", greffe: g, greffes: [...greffes, g], kmTournee: Math.round(kmTotal) };
    }
    greffes.push(g);
  }

  // Grandeurs de TOURNÉE — calculées pour le banc, JAMAIS appliquées comme barrière (ce serait le
  // budget de tournée que l'arbitrage du 2026-09-02 écarte).
  let plusLongSeul = 0;
  let sommeSeuls = 0;
  for (const id of ordre) {
    const l = lotsById.get(id);
    const s = kmLotSeul(depotLot(id), l.cpC, l.cpL, km);
    plusLongSeul = Math.max(plusLongSeul, s);
    sommeSeuls += s;
  }

  return {
    ok: true, greffes,
    kmTournee: Math.round(kmTotal),
    detourTournee: Math.round(kmTotal - plusLongSeul),
    kmEvites: Math.round(sommeSeuls - kmTotal),
  };
}
