import { LOT_STATUS } from '../data/referentiels.js';

// Helpers — la source de vérité canonique est `lot.status`
export function getLotStatus(lot) {
  // Toujours retourner un statut valide, même pour un lot legacy
  if (!lot) return LOT_STATUS.PLACED_UNLOCKED;
  if (lot.status === LOT_STATUS.PLACED_LOCKED
    || lot.status === LOT_STATUS.PLACED_UNLOCKED
    || lot.status === LOT_STATUS.PENDING_AGENCY
    || lot.status === LOT_STATUS.CALLBACK) return lot.status;
  // Legacy migration : déduire depuis ancien modèle (status "qualified"/"callback" + _locked + _pendingBoucle)
  if (lot.status === "callback") return LOT_STATUS.CALLBACK;
  if (lot._pendingBoucle) return LOT_STATUS.PENDING_AGENCY;
  if (lot._locked === true) return LOT_STATUS.PLACED_LOCKED;
  return LOT_STATUS.PLACED_UNLOCKED;
}

export function isLotLocked(lot) {
  return getLotStatus(lot) === LOT_STATUS.PLACED_LOCKED;
}
export function isLotPlaced(lot) {
  const s = getLotStatus(lot);
  return s === LOT_STATUS.PLACED_LOCKED || s === LOT_STATUS.PLACED_UNLOCKED;
}
export function isLotPending(lot) { return getLotStatus(lot) === LOT_STATUS.PENDING_AGENCY; }
export function isLotCallback(lot) { return getLotStatus(lot) === LOT_STATUS.CALLBACK; }

// « Je le vends, une autre agence le roule. » Sépare `myLots` de `crossLots`.
//
// Le critère est l'agence opératrice SEULE, jamais le type de boucle. Le test portait
// `_boucleType === "retour"` en dur, ce qui était exact tant que seul un retour pouvait
// franchir la frontière d'agence. Depuis la mutualisation régionale (2026-07-29), un lot
// mutualisé peut être posé sur le camion d'une agence voisine : il est tout aussi croisé,
// et devait donc basculer du même côté de la partition.
// Une mutualisation INTERNE ne porte pas `_operatingAgency` et reste dans « mes lots ».
export function opereParUneAutreAgence(lot) {
  return !!lot?._operatingAgency && lot._operatingAgency !== lot.soc;
}

// Détermine le statut de placement à appliquer.
// Règle v5 :
//  - forceLocked (boucle validée) → PLACED_LOCKED
//  - dateLivImposee (client impose la date exacte, pas de flex) → PLACED_LOCKED
//  - sinon → PLACED_UNLOCKED (la flex livraison est globale, règle admin ; la confirmation
//    client se fait via la todo lot_callback à J-15)
export function computePlacementStatus({ dateLivImposee } = {}, { forceLocked = false } = {}) {
  if (forceLocked) return LOT_STATUS.PLACED_LOCKED;
  if (dateLivImposee) return LOT_STATUS.PLACED_LOCKED;
  return LOT_STATUS.PLACED_UNLOCKED;
}

// « Celui qui a la boucle » = l'agence dont le CAMION porte la tournée (arbitrage 2026-09-07,
// « casser une boucle », plan-dev-ux-v5.md § 4 G1.5). C'est sa flotte qui se réorganise quand on
// défait la tournée : c'est elle qui décide — miroir de `opereParUneAutreAgence` ci-dessus.
// ⚠️ On lit l'agence du VÉHICULE, pas `chosen.partnerAgence` ou un champ du lot : même raison qu'à
// l'écriture de `_operatingAgency` dans `handleSuggestionPlace` (`OneFleet.jsx`) — c'est le camion
// qui définit l'opérateur, jamais l'agence qui a initié la proposition.
//
// `perimetreAgences` suit la convention de `agencesVisibles` (`utils/userHelpers.js`, arbitrage
// 2026-08-31) : `null` = aucune restriction (vue nationale), un tableau = le périmètre exact.
// Un véhicule inconnu (tournée mal formée, donnée legacy) ne bloque pas à tort : rien à protéger.
export function peutDefaireLaTournee(lot, vehicleDeLaTournee, perimetreAgences) {
  if (perimetreAgences === null || perimetreAgences === undefined) return true;
  if (!vehicleDeLaTournee) return true;
  return perimetreAgences.includes(vehicleDeLaTournee.ag);
}

// Synchronise `_locked` avec le statut pour compat. À appeler avant de setState un lot.
export function syncLotLockedFlag(lot) {
  const s = getLotStatus(lot);
  return { ...lot, status: s, _locked: s === LOT_STATUS.PLACED_LOCKED };
}
