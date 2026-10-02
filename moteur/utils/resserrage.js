import { diffWorkdays } from './dates.js';
import { isLotLocked } from './statusHelpers.js';
import { dateChgSouhaitee } from './datesBoucle.js';

// ── LE LOT EST-IL RESSERRABLE ? (arbitrage Louis 2026-07-31) ────────────────────────────────────
//
// Sert au signal « camion chargé en attente hors dépôt avant départ ». Ce message dit « dates à
// resserrer » — c'est une CONSIGNE, et une consigne qu'on ne peut pas suivre est pire que pas de
// message du tout : elle use l'attention du planificateur sur une situation subie. On ne l'affiche
// donc que là où quelqu'un peut réellement agir.
//
// Resserrer, ici, veut dire une chose précise : DÉCALER LE CHARGEMENT PLUS TARD, pour qu'il colle
// au départ de la route au lieu de laisser le camion chargé à l'arrêt. Ce n'est possible que si :
//   ① le lot n'est pas verrouillé — un chargement vendu est intouchable (Q15) ;
//   ② une flexibilité a été négociée avec le client (`_flexC` > 0) ;
//   ③ cette flexibilité n'est pas DÉJÀ CONSOMMÉE vers le tard.
//
// ③ est le point qu'on oublie facilement. La fenêtre de flex est ancrée sur la date SOUHAITÉE par
// le client (`dateCSouhaitee`), pas sur la date planifiée courante — sinon elle se recentrerait à
// chaque acceptation de boucle et la souplesse promise dériverait sans fin (cf. `datesBoucle.js`).
// Un lot déjà poussé au bout de sa fenêtre a donc `_flexC > 0` mais plus un jour de marge réelle.
export function margeChgVersTard(lot) {
  if (!lot || isLotLocked(lot)) return 0;
  const flexC = Number(lot._flexC ?? 0);
  if (!(flexC > 0)) return 0;
  const souhaitee = dateChgSouhaitee(lot);
  if (!souhaitee || !lot.dateC) return 0;
  // `diffWorkdays` ne compte que vers l'avant : un chargement planifié AVANT la date souhaitée rend
  // 0, donc toute la fenêtre reste disponible côté tard. C'est bien le comportement voulu.
  const dejaConsomme = diffWorkdays(souhaitee, lot.dateC);
  return Math.max(0, flexC - dejaConsomme);
}

export function lotResserrable(lot) {
  return margeChgVersTard(lot) > 0;
}
