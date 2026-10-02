import { hav } from '../data/gps.js';
import { RULES_DEFAULTS, manutHeures } from '../data/referentiels.js';

// ── CE QUE L'ACCROCHÉ AJOUTE AU VOYAGE — DÉTOUR ET RALLONGE ──────────────────────────────────────
//
// Écriture UNIQUE de deux grandeurs qui n'en font qu'une (`docs/boucles/boucles-etat-a-date.md` § 1.5) :
// le **détour** les compte en kilomètres, la **rallonge** en heures puis en journées. Longtemps
// traitées comme deux règles distinctes, elles ne diffèrent que par l'unité — et par ce que la
// seconde ajoute : la MANUTENTION, qu'aucune règle géométrique ne peut voir.
//
//   détour   = d(E, chgACC) + d(chgACC, livACC) + d(livACC, S) − d(E, S)
//   rallonge = détour / vitessePL + manut(chg ACC) + manut(liv ACC)
//   journées = rallonge / heures utiles
//
// 🔑 LE SEGMENT PORTEUR `E → S` — la notion centrale. Dans les trois géométries, l'accroché s'insère
// dans un trajet QUI EXISTAIT DÉJÀ ; `E` et `S` en sont l'entrée et la sortie, et ce sont toujours
// deux points de l'ANCRE, donc deux faits, jamais un choix :
//
//   RETOUR  E = liv ANC  ·  S = le dépôt          le retour À VIDE de l'ancre
//   MUTU    E = chg ANC  ·  S = liv ANC           la mission CHARGÉE de l'ancre
//
// Une seule formule, deux porteurs. Elle vaut **0** quand l'accroché est pile sur la route et
// pénalise le contre-sens au double. C'est ce qui la rend directionnelle là où une simple distance
// ne l'est pas : un rechargement à Limoges est à 547 km de Marseille, mais comme il est sur l'axe
// Marseille → Nantes, il ne coûte que 13 km.
//
// ⚠️ SEULES LES MANUTENTIONS DE L'ACCROCHÉ ENTRENT : celles de l'ancre existent avec ou sans lui.
// ⚠️ Le PLANCHER DE 2 H de la manutention domine la plupart des dossiers (≈ 4 h ajoutées, soit
// ≈ 0,36 journée) : une rallonge n'est jamais nulle, même sur un accroché pile sur la route.
//
// ⚠️ CE MODULE NE REFUSE RIEN. Il MESURE. Savoir si la rallonge doit devenir une barrière (le
// garde-fou G4) est une question ouverte — le week-end fait peut-être déjà le travail, cela se
// mesure (A5). Ce qui est TRANCHÉ (Louis, 2026-08-12), c'est qu'elle doit être AFFICHÉE sur la
// proposition : « cette boucle immobilise le camion x heures de plus que la mission seule » est
// utile à l'exploitation même si elle ne refuse rien.
//
// 🔗 ÉCRITURE UNIQUE, VRAIMENT : `scripts/lib/gardefous.mjs` importe ce module. L'application et
// les campagnes de mesure calculent donc la MÊME chose — sans quoi un seuil calibré sur les
// analyses ne voudrait rien dire une fois posé dans le moteur.

export const HEURES_UTILES_PAR_JOUR = 11; // 7h → 18h

// La manutention de l'ACCROCHÉ, chargement + livraison, en heures.
export function manutAccroche(acc, rules = RULES_DEFAULTS) {
  const vol = parseFloat(acc?.vol) || 0;
  return manutHeures(vol, acc?.fteC, rules) + manutHeures(vol, acc?.fteL, rules);
}

// Le tronc commun des géométries : une fois `E`, `S` et les deux points de l'accroché connus, tout
// le reste est identique. Si un jour les deux géométries divergent ici, c'est qu'on a réintroduit
// deux règles là où il n'y en a qu'une.
//
// Rend `null` si un point manque — l'appelant n'affiche alors rien plutôt qu'un chiffre faux
// (même contrat que `kmEcoBoucleRetour`).
export function mesuresAccroche({ E, S, chgAcc, livAcc, acc, rules = RULES_DEFAULTS }) {
  if (!E || !S || !chgAcc || !livAcc) return null;
  const vitesse = rules?.vitessePL || 70;

  const a = hav(E, chgAcc);        // la liaison
  const b = hav(chgAcc, livAcc);   // le trajet de l'accroché — jamais un coût
  const c = hav(livAcc, S);        // la sortie
  const R = hav(E, S);             // le trajet remplacé — la seule baseline qui subsiste
  const porteur = a + b + c;
  const detour = porteur - R;

  // Forme « % du porteur ». ⚠️ `R` peut être nul (l'ancre livre à son propre dépôt) : le rapport
  // n'a alors aucun sens, on rend `null` plutôt qu'un Infinity.
  const detourPct = R > 0 ? (detour / R) * 100 : null;

  // LA VENTILATION PAR POINT. Le terme d(chgACC, S) apparaît une fois en + et une fois en − : il se
  // télescope, et la somme des deux redonne le détour EXACTEMENT. Elle ne rend rien plus ni moins
  // sévère — elle sert à dire à l'exploitant QUOI changer : « rallonge 118 km, dont 112 imputables
  // au chargement ».
  const dChgAccS = hav(chgAcc, S);
  const detourChg = a + dChgAccS - R;
  const detourLiv = b + c - dChgAccS;

  // La part du porteur roulée SANS profit — à vide au retour, à un seul dossier en mutualisation.
  const m2 = porteur > 0 ? ((a + c) / porteur) * 100 : 0;

  const manut = manutAccroche(acc, rules);
  const rallongeH = detour / vitesse + manut;
  const rallongeJ = rallongeH / HEURES_UTILES_PAR_JOUR;
  // L'ancienne mesure, sans manutention — conservée pour chiffrer l'écart, jamais pour décider.
  const rallongeJKmSeuls = detour / vitesse / HEURES_UTILES_PAR_JOUR;

  return { a, b, c, R, porteur, detour, detourPct, detourChg, detourLiv, m2, manut, rallongeH, rallongeJ, rallongeJKmSeuls };
}

// RETOUR — le porteur est le retour à VIDE de l'ancre : de sa livraison jusqu'au dépôt.
export function mesuresRetour({ depot, livAncre, chgAccroche, livAccroche, acc, rules = RULES_DEFAULTS }) {
  return mesuresAccroche({ E: livAncre, S: depot, chgAcc: chgAccroche, livAcc: livAccroche, acc, rules });
}

// MUTUALISATION — le porteur est la mission CHARGÉE de l'ancre : de son chargement à sa livraison.
// ⚠️ Asymétrie économique à garder en tête : remplir du vide (retour) vaut mieux que rallonger une
// mission vendue (mutualisation). Géométriquement identique, économiquement non — c'est un argument
// pour deux valeurs de seuil, jamais pour deux règles.
export function mesuresMutu({ chgAncre, livAncre, chgAccroche, livAccroche, acc, rules = RULES_DEFAULTS }) {
  return mesuresAccroche({ E: chgAncre, S: livAncre, chgAcc: chgAccroche, livAcc: livAccroche, acc, rules });
}

// « Immobilise le camion 4 h de plus (0,4 j) » — la phrase que lit le planificateur.
// Sous une heure on ne prétend pas à la minute près : le calcul repose sur des distances à vol
// d'oiseau corrigées, annoncer « 12 min » serait une fausse précision.
export function libelleRallonge(mesures) {
  if (!mesures || !Number.isFinite(mesures.rallongeH)) return null;
  const fr = (n) => n.toString().replace(".", ",");
  const h = mesures.rallongeH;
  const heures = h < 1 ? "moins d'1 h" : `${fr(h < 10 ? Math.round(h * 10) / 10 : Math.round(h))} h`;
  const jours = mesures.rallongeJ >= 0.1 ? ` (${fr(Math.round(mesures.rallongeJ * 10) / 10)} j)` : "";
  return `${heures}${jours}`;
}
