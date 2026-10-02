import {
  RULES_DEFAULTS,
  gardeDetourRetour, gardeDetourMutu, gardeRendement, gardePlancherAbsurditeActif,
  coutJourCamion, coutJourDecalage, coutJourAvance,
} from '../data/referentiels.js';

// ── LA PILE DE GARDE-FOUS ET LE SCORE DE CLASSEMENT — POINT D'APPLICATION UNIQUE ─────────────────
//
// Décision normative : `docs/boucles/couplage-synthese.md` (Louis, 2026-08-14). Avant ce
// module, cette doctrine n'existait NULLE PART dans l'application : elle n'était qu'une doctrine
// mesurée par des scripts d'analyse hors application (`scripts/lib/gardefous.mjs`), et le moteur
// classait ses propositions sur les kilomètres évités, rien d'autre.
//
// Ce module dit DEUX choses, et rien de plus :
//   ① la boucle passe-t-elle les garde-fous ?  → `{ ok, cause, message }`
//   ② à quel rang la proposer ?                → `score`
//
// 🔑 IL NE CALCULE AUCUNE GRANDEUR. Il consomme les mesures rendues par `engine/mesuresBoucle.js`
// (détour, porteur, rallonge manutention comprise) et les km évités calculés par le moteur. C'est
// la condition de l'écriture unique : `scripts/lib/gardefous.mjs` dépend du MÊME `mesuresBoucle.js`,
// donc une campagne de mesure et l'application jugent les mêmes chiffres. Si un jour une formule
// apparaît ici, l'un des deux mondes se mettra à dire autre chose que l'autre — sans alerte.
//
// ── LA PILE, TELLE QU'ELLE EST TRANCHÉE ─────────────────────────────────────────────────────────
//
//   G1  territoire      ailleurs, en amont — `utils/zones.js` : `checkRetourPiliers` au retour
//                       (règle des piliers D7, depuis le 2026-09-15), `checkMutuZones` en
//                       mutualisation. `memePerimetreMutu` dit QUI peut mutualiser, jamais OÙ.
//   G2  détour          `détour ≤ 500 km` (400 jusqu'au 2026-08-19), en KILOMÈTRES ABSOLUS (forme
//                       tranchée, ne pas rouvrir en pourcentage). Deux réglages, retour et mutualisation.
//   G5  rendement       `km évités ≥ 750 × rallongeJours`. La rallonge est celle qui COMPREND LA
//                       MANUTENTION : c'est ce que G5 voit et qu'aucune règle géométrique ne voit.
//   ⑦   absurdité       `détour ≤ d(E,S)` — le trou connu du budget absolu. DÉSACTIVÉ PAR DÉFAUT,
//                       question encore ouverte (panel de 50 boucles réelles).
//
// ⚠️ G3 (qualité de remplissage M2) et G4 (immobilisation) NE SONT PAS ICI, et ce n'est pas un
// oubli : ils ont été RETIRÉS COMME BARRIÈRES le 2026-08-14 tout en restant AFFICHÉS au
// planificateur en mention neutre (`_mesures.m2`, `libelleRallonge`). Ne pas les recâbler en refus.
// G3 refusait plus de bonnes boucles que de mauvaises ; G4 ne bloquait aucun couple que G2 ne
// bloquait déjà (0 sur 946 516).
//
// ⚠️ G6 (gain minimum 300 km) est retiré lui aussi. Le plancher `minKmEco` (50 km) que le moteur
// applique juste à côté N'EST PAS G6 : c'est le plancher absolu du moteur, il reste, il ne descend
// pas à zéro.
//
// ── CE QUI PASSE, ET CE QUI CLASSE — DEUX QUESTIONS DISTINCTES ──────────────────────────────────
// `gardeRendement(rules)` et `coutJourCamion(rules)` valent tous deux 750 aujourd'hui et mesurent
// la même grandeur (le prix d'une journée de camion en kilomètres). Ils restent DEUX réglages :
// l'un BARRE, l'autre ORDONNE ce qui a déjà été accepté. On peut vouloir barrer sévèrement et
// classer doucement. Ne jamais déduire l'un de l'autre.

// Identifiants de cause — NOMMÉS ET STABLES. Un refus muet est un bug : le planificateur doit
// pouvoir lire pourquoi, et le diagnostic doit pouvoir compter par cause. Ces chaînes voyagent
// jusqu'aux compteurs de debug (`boucle_rejets_<cause>`) : les renommer casse l'historique.
export const CAUSES_GARDE = {
  DETOUR: "detourTropLong",
  RENDEMENT: "rendementInsuffisant",
  CONTRE_SENS: "contreSens",
};

// Le budget de détour applicable, selon la géométrie. Deux clés parce que les deux porteurs ne
// valent pas la même chose : au retour on remplit du vide, en mutualisation on rallonge une mission
// déjà vendue. Les mesures disaient 400 / 300 ; une valeur unique (400, puis 500 le 2026-08-19) a été retenue, écart
// assumé — d'où deux réglages plutôt qu'un, pour pouvoir refermer l'écart sans toucher au code.
export function budgetDetour(geometrie, rules = RULES_DEFAULTS) {
  return geometrie === "mutu" ? gardeDetourMutu(rules) : gardeDetourRetour(rules);
}

// ── LE SCORE, SEUL ──────────────────────────────────────────────────────────────────────────────
//
//   score = km évités − λ × rallongeJours − μ × joursRetard − ν × joursAvance
//
// 🔑 LE DÉTOUR N'ENTRE PAS DANS LE SCORE. L'identité `km évités = (trajet que l'accroché aurait
// fait seul) − détour` le soustrait DÉJÀ, au coefficient 1. L'y remettre facturerait deux fois les
// mêmes kilomètres — c'est l'erreur classique sur ce calcul, elle est explicitement écartée par la
// note de décision (§ A2 et A4).
//
// `rallongeJours` : la rallonge MANUTENTION COMPRISE (`mesuresBoucle.rallongeJ`), jamais l'ancienne
//                   mesure kilométrique seule (`rallongeJKmSeuls`), fausse d'un tiers de journée.
// `décalageJours` : jours CALENDAIRES **signés** entre la livraison déjà annoncée de l'ANCRE et
//                   celle que la boucle propose — POSITIF = RETARD (livraison plus tardive que
//                   l'annoncée), NÉGATIF = AVANCE (livraison plus tôt). Zéro si le lot est
//                   verrouillé — il ne peut pas bouger, il n'y a donc rien à facturer.
//
// 🔵 ASYMÉTRIE RETARD/AVANCE (arbitrage Louis 2026-08-18) : « livraison avancée à pénaliser moins
// qu'une livraison retardée ». Le retard se paie à μ (`coutJourDecalage`), l'avance à ν
// (`coutJourAvance`), et ν < μ dans les valeurs livrées — une avance dérange le client, mais moins
// qu'un retard. Avant cette date, ce module prenait la VALEUR ABSOLUE du décalage : une avance de
// trois jours coûtait exactement comme un retard de trois jours.
// ⚠️ VÉRIFIÉ, PAS DÉDUIT DU NOM : le signe employé ici est celui du point d'appel
// (`engine/boucleEngine.js`, `decalageAncre_retour`/`decalageAncre_mutu`, calculés par
// `diffDaysIso(dateAnnoncée, dateProposée)` = proposée − annoncée, donc positif quand la date
// proposée est plus tardive). ✅ Ce point d'appel transmet bien le signe brut depuis le 2026-08-18
// (vérifié le 2026-09-15 : plus aucun `Math.abs()` sur `decalageAncre_retour` / `decalageAncre_mutu`) —
// l'asymétrie retard/avance est active de bout en bout.
//
// Le score est arrondi au kilomètre : il s'exprime dans l'unité de ses termes, et la fausse
// précision d'une décimale sur des distances à vol d'oiseau corrigées n'aurait aucun sens.
export function scoreClassementBoucle({ kmEco = 0, rallongeJours = 0, decalageJours = 0, rules = RULES_DEFAULTS } = {}) {
  const lambda = coutJourCamion(rules);
  const muRetard = coutJourDecalage(rules);
  const nuAvance = coutJourAvance(rules);
  const eco = Number.isFinite(kmEco) ? kmEco : 0;
  const rall = Number.isFinite(rallongeJours) ? rallongeJours : 0;
  const dec = Number.isFinite(decalageJours) ? decalageJours : 0;
  const joursRetard = dec > 0 ? dec : 0;
  const joursAvance = dec < 0 ? -dec : 0;
  return Math.round(eco - lambda * rall - muRetard * joursRetard - nuAvance * joursAvance);
}

// ── LE VERDICT ──────────────────────────────────────────────────────────────────────────────────
//
// `mesures`      — la sortie de `mesuresRetour` / `mesuresMutu` (`engine/mesuresBoucle.js`).
// `kmEco`        — les kilomètres évités, tels que le moteur les a calculés pour CETTE proposition.
// `decalageJours`— jours calendaires **signés** de décalage de la livraison de l'ancre (0 si
//                  verrouillée) — positif = retard, négatif = avance. Cf. le commentaire de
//                  `scoreClassementBoucle` pour la convention de signe et son statut réel en
//                  production.
// `geometrie`    — "retour" | "mutu" : ne choisit QUE le budget de détour applicable.
// `rules`        — les règles en vigueur. Aucun seuil n'est lu en dur : changer la règle change le
//                  verdict, c'est la propriété que les tests figent.
//
// Rend toujours un objet complet : `{ ok, cause, message, score, composantes, seuils }`. Les
// composantes sont attachées pour que l'interface AFFICHE sans recalculer — « + 940 km évités ·
// + 1,2 jour de camion · détour 180 km » doit sortir du même calcul que le verdict, sinon l'écran
// et le moteur finiront par se contredire.
//
// ⚠️ MESURE INDISPONIBLE (`mesures` nul — un point GPS manque, cf. le contrat de `mesuresAccroche`)
// ⇒ ON N'ÉCARTE PAS. Un garde-fou refuse sur un fait mesuré, jamais sur une absence de mesure :
// refuser ici transformerait une donnée manquante en règle métier silencieuse. La boucle passe,
// `mesuresIndisponibles` le signale, et le score se réduit aux termes connus (km évités et
// décalage). Même prudence que `chgVenduTenu`, qui ne VALIDE jamais sur une absence — ici,
// symétriquement, on ne REFUSE jamais sur une absence.
export function evaluerGardes({ mesures, kmEco = 0, decalageJours = 0, geometrie = "retour", rules = RULES_DEFAULTS } = {}) {
  const budget = budgetDetour(geometrie, rules);
  const rendementMin = gardeRendement(rules);
  const plancherActif = gardePlancherAbsurditeActif(rules);
  const seuils = { budgetDetourKm: budget, rendementKmJ: rendementMin, plancherAbsurdite: plancherActif };

  const detourKm = Number.isFinite(mesures?.detour) ? Math.round(mesures.detour) : null;
  const porteurKm = Number.isFinite(mesures?.R) ? Math.round(mesures.R) : null;
  const rallongeJours = Number.isFinite(mesures?.rallongeJ) ? mesures.rallongeJ : null;
  // Signe CONSERVÉ (arbitrage 2026-08-18) — ne PLUS écraser au Math.abs() ici : c'est exactement ce
  // qui rendait avance et retard indiscernables avant cette décision. Positif = retard, négatif =
  // avance (cf. le commentaire de `scoreClassementBoucle`).
  const dec = Number.isFinite(decalageJours) ? decalageJours : 0;
  const joursRetard = dec > 0 ? dec : 0;
  const joursAvance = dec < 0 ? -dec : 0;

  const composantes = { kmEco, rallongeJours, detourKm, porteurKm, decalageJours: dec, joursRetard, joursAvance };
  const score = scoreClassementBoucle({ kmEco, rallongeJours: rallongeJours ?? 0, decalageJours: dec, rules });
  const verdict = (ok, cause, message) => ({ ok, cause, message, score, composantes, seuils });

  if (!mesures) return { ...verdict(true, null, null), mesuresIndisponibles: true };

  // G2 — le budget de détour. Premier parce que c'est la règle que le planificateur connaît par
  // cœur (« 500 km ») et la seule qu'il puisse corriger en changeant de couple.
  if (detourKm !== null && detourKm > budget) {
    return verdict(false, CAUSES_GARDE.DETOUR,
      `détour de ${detourKm} km pour aller chercher l'accroché — le maximum est ${budget} km`);
  }

  // ⑦ — le plancher d'absurdité, quand il est activé. Il ne se substitue pas au budget, il le
  // complète : un budget en kilomètres absolus ne regarde pas la longueur du trajet remplacé, donc
  // un porteur de 150 km peut se voir greffer un détour de 380 km sans que G2 bronche.
  if (plancherActif && detourKm !== null && porteurKm !== null && detourKm > porteurKm) {
    return verdict(false, CAUSES_GARDE.CONTRE_SENS,
      `le camion roulerait ${detourKm} km pour prendre l'accroché, contre ${porteurKm} km pour le trajet qu'il remplace`);
  }

  // G5 — le rendement. Comparaison écrite sous forme de produit et non de division : `rallongeJours`
  // peut être nul (théoriquement — le plancher de manutention l'en empêche en pratique) et une
  // division donnerait alors un Infinity qui passerait ou barrerait selon le sens du test.
  if (rallongeJours !== null && kmEco < rendementMin * rallongeJours) {
    const requis = Math.round(rendementMin * rallongeJours);
    return verdict(false, CAUSES_GARDE.RENDEMENT,
      `${Math.round(kmEco)} km évités pour ${rallongeJours.toFixed(2).replace(".", ",")} journée(s) de camion — il en faudrait ${requis}`);
  }

  return verdict(true, null, null);
}
