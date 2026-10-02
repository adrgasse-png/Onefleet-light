// ── L'API PUBLIQUE DU CALCUL À LA JOURNÉE ──────────────────────────────────────────────────────
// Un seul point d'entrée pour la maquette, le banc et les tests. Tout ce qui n'est pas ré-exporté
// ici est un détail d'implémentation : ne pas l'importer fichier par fichier depuis l'extérieur.

export {
  jourOuvre, isoDeJour, decalerJours, jourOuvreOuSuivant, jourOuvreOuPrecedent, estWeekEnd,
  // Les jours fériés, cases fermées de l'axe (27/09).
  estFerme, estJourFerme, ecartOuvre, decalerOuvres, fermesEntre,
} from "./calendrier.js";
export { estFerie, nomFerie, feriesDeLAnnee } from "./feries.js";

export { REGLAGES_DEFAUT, fusionnerReglages, reglesMoteur } from "./reglages.js";

export {
  contexte, etatInitial, pas, cloturer, evaluerSequence, attenteCourante,
  ABAQUES, kmEntre, kmLotSeul, kmSequence,
} from "./passe.js";

export { evaluerTournee, proposerDecalage } from "./tournee.js";
// Le transbordement coché par le planificateur : une seule règle, lue par tous (27/09) — le bloc du
// camion après la collecte VL, avant la livraison VL, une demi-journée (28/09).
export {
  fenetreTransbo, transborderLot, lieuxDuLot, attenteQuaiJours,
  blocTransbo, bornesDuBloc, extrasArretBloc, dureeBlocH,
} from "./transbo.js";
export { structureTournee, g1Tournee, g2g5Tournee, pairePossible } from "./gardes.js";
export { evaluerPlanning } from "./planning.js";
export { controlerGeste } from "./geste.js";
