// ── LES RÉGLAGES DU CALCUL À LA JOURNÉE ────────────────────────────────────────────────────────
//
// Aucune valeur métier n'est écrite ailleurs que dans ce fichier. Chaque entrée porte son STATUT :
//   · arbitré            — Louis a tranché, ne pas rouvrir sans lui ;
//   · hypothèse d'analyste — posé par les essais v2, jamais soumis au métier ;
//   · à caler            — la valeur attend une mesure ou un avis de planificateur.
//
// 🔴 CE QUI N'EST PAS ICI, ET NE LE SERA JAMAIS : la règle d'or Q17 (« un poids lourd n'est jamais
// hors de son dépôt le week-end »). Elle est structurelle — l'axe de `calendrier.js` et la passe de
// `passe.js` la portent dans leur forme même. Aucun réglage ne la relâche.

export const REGLAGES_DEFAUT = {
  // ── LES DEUX COMPTES (tolérance) ─────────────────────────────────────────────────────────────
  // Alignés MOT POUR MOT sur l'analyse A (`essais-v2/analyse-A-jour-heure/RAPPORT.md` § « Tolérance
  // testée ») : « au large » = l'abaque `normal` du prototype (650 km/j, marge de durée +15 %),
  // « au juste » = l'abaque `serré` (770 km/j, marge 0).
  //
  // 🔑 Pourquoi « juste » roule PLUS vite que « large ». 770 km/j = 70 km/h × 11 h ouvrées : c'est
  // la physique du moteur horaire, sans une minute de battement. C'est donc la lecture la plus
  // PERMISSIVE — elle fait tenir des tournées qu'un planificateur trouverait tendues. « Large »
  // désigne la MARGE laissée à l'exploitation, pas la vitesse : 650 km/j et +15 % de manutention.
  // Tient au large → rien à dire. Tient au juste seulement → orange « serré ». Ni l'un ni l'autre
  // → refus.
  //
  // `margeDuree` gonfle la manutention avant l'arrondi à la demi-journée supérieure.
  // Statut : hypothèse d'analyste, à caler avec les planificateurs (CONCEPTS-METIER.md, 🟠).
  //
  // ⚠️ `large.kmParJour` vaut 600 DEPUIS LE 2026-09-24 (650 avant, l'abaque `normal` de l'analyse
  // A) : choix de Louis du 23/09 sur la maquette (ZON « 600 / 770 »). C'est un RÉGLAGE, pas un
  // arbitrage figé — la synthèse le dit « à confirmer avec les planificateurs ». Plus bas, la zone
  // « serré » s'élargit : sur le planning réel du 21/09, la part des tournées posées en orange
  // SERRE passe de 13 % (650) à 24 % (600) au banc.
  comptes: {
    large: { kmParJour: 600, margeDuree: 0.15 },
    juste: { kmParJour: 770, margeDuree: 0 },
  },

  // ── C5 — DEUX OPÉRATIONS LE MÊME JOUR ────────────────────────────────────────────────────────
  // "toujours" (défaut, NEUTRE : c'est le comportement du prototype, deux demi-journées par jour)
  // · { volumeMax: n } — une seconde opération n'est admise le même jour que si les DEUX tiennent
  //   sous n m³ · "jamais" — une opération par jour.
  // Statut : à caler. Le métier dit « possible sur les petits volumes » sans donner le seuil.
  deuxOpsParJour: "toujours",

  // ── C6 — LE CAMION RENTRE-T-IL CHARGÉ POUR LE WEEK-END ? ─────────────────────────────────────
  // `true` (défaut, NEUTRE : comportement du prototype) — la coupure dépôt du vendredi est permise
  // camion chargé, c'est la pratique du déménagement longue distance.
  // `false` — le camion ne peut rentrer que vide ; une coupure chargée devient un refus `Q17`.
  // Statut : arbitré à `true` (docs/regles-metier.md, coupure dépôt week-end, 2026-07-22).
  weekendCharge: true,

  // ── LA COUPURE CHARGÉE LOIN DU DÉPÔT — « LA RÈGLE DES 150 KM » (Louis, 2026-10-01) ────────────
  // Quand un arrêt ne passe pas avant le week-end (ou un férié), le camion rentre CHARGÉ au dépôt
  // et repart ensuite (C6) — mais seulement si le dépôt est « sur le chemin » : l'arrêt qui suit la
  // coupure est à ce nombre de km du dépôt au plus (le cas de Louis : la dernière livraison, livrée le
  // lundi), OU passer par le dépôt rallonge la route de ce nombre de km au plus (arbitré le 01/10 :
  // « dépôt sur la route = admis »), OU l'arrêt qui précède est à ce nombre de km du dépôt au plus
  // (🟠 lecture de l'implémentation : charger le vendredi, partir le lundi). Sinon : refus
  // `COUPURE_CHARGEE_LOIN` — ni proposé par la recherche, ni posable à la main (avancer la tournée,
  // ou transborder).
  // `null` — aucune limite : le comportement d'avant le 01/10 (le camion rentrait chargé quelle que
  // soit la distance). Les km sont ceux de l'outil (vol d'oiseau × facteur, ~25 % sous la route).
  // Réglage destiné à l'Admin (« règles métier »).
  // Mesuré le 01/10 sur les 76 tournées réelles (`essais-v2/mesure-abaques-01-10/`) : aucune refusée
  // à 150 km. À la lettre (l'arrêt d'après seul), 52 coupures chargées réelles l'étaient, et la boucle
  // retour BLAVIER + SIMON de la maquette (Quimper, 187 km de Guer, 90 km de détour) aussi.
  coupureChargeeMaxKm: 150,

  // ── NIVEAUX DE SIGNAL ────────────────────────────────────────────────────────────────────────
  niveaux: {
    // Date imposée hors de la flex vendue : un rappel client, pas une impossibilité. "orange"
    // (arbitré, C7/P2) ou "refus".
    horsFlex: "orange",
    // G2 (détour) et G5 (rendement) dépassés APRÈS retouche. "orange" (défaut) ou "refus".
    // ⚠️ La RECHERCHE de boucle, elle, refuse toujours : ici on juge une tournée que le
    // planificateur a déjà en main, la barrière n'a pas le même sens. Statut : P3, ouvert.
    gardes: "orange",
    // Une date imposée entre lesquelles la route ne tient pas. "orange" (défaut), "rouge" ou
    // "refus". Statut : arbitré à « orange » le 24/09 (D9, trois niveaux : refus, orange, info) —
    // on montre le problème, on ne bloque ni la saisie ni « Confirmer » (esprit de C2).
    suiteInfaisable: "orange",
    // Deux tournées du même camion qui se chevauchent (`planning.js`).
    // "refus" (défaut, arbitré le 24/09, D9 : un camion ne porte jamais deux tournées qui se
    // chevauchent) · "rouge_si_brouillon" : rouge, mais refus si l'autre tournée porte une opération
    // confirmée · "orange_si_brouillon" : orange, refus si l'autre est confirmée · "rouge".
    // « L'autre » = celle que le geste n'a PAS touchée (`evaluerPlanning(…, { touchee })`) ; sans
    // cette option, la tournée est jugée engagée si l'une OU l'autre porte une confirmation.
    camionDejaPris: "refus",
    // Volume à bord supérieur à la capacité. "forcable" (défaut) — refus levable par
    // `entree.forcerCapacite`, qui dégrade alors le refus en orange (« Forcer » : remorque, camion
    // en renfort — des cas réels) · "refus" — refus sans appel.
    // Statut : ARBITRÉ — choix de Louis du 23/09 sur la maquette (CAP « refus avec Forcer »),
    // défaut du module depuis le 24/09 (avant : "refus").
    capacite: "forcable",
    // Un code postal inconnu du référentiel (`cpConnu` de `data/gps.js`) : placé au centre de la
    // France, il fausse toutes les distances. "refus" (défaut) · "rouge" · "orange" · "info".
    // Statut : hypothèse d'analyste (T0, défaut D3) — `regles-metier.md`, « CP reconnu ».
    cpInconnu: "refus",
  },

  // ── GARDE-FOUS DE GREFFE (G2 / G5) ───────────────────────────────────────────────────────────
  // Arbitrés : 500 km de détour par greffe (2026-08-19), 750 km/j de rendement (2026-08-14),
  // 70 km/h (moteur). ⚠️ Un budget PAR GREFFE, jamais un budget de tournée (arbitrage 2026-09-02).
  detourMaxKm: 500,
  rendementMinKmJ: 750,
  vitessePL: 70,

  // ── REMPLISSAGE DES DATES LIBRES ─────────────────────────────────────────────────────────────
  // "pres_du_prefere" (défaut) — chaque opération libre va au jour de sa flex le plus proche de
  //   `prefere ?? souhaite`, à condition que la tournée entière reste faisable. C'est ce qui rend
  //   une retouche STABLE : bouger un lot ne redistribue pas tout le reste.
  // "au_plus_tot" — le comportement du prototype des essais (première date possible). Sert à
  //   l'épreuve différentielle et au banc.
  remplissage: "pres_du_prefere",

  // ── COMPTABILITÉ KILOMÉTRIQUE ────────────────────────────────────────────────────────────────
  // "reels" (défaut) — `km` et `kmSeuls` sortent de la MÊME passe, retours dépôt du week-end
  //   compris. C'est la correction de méthode de l'essai 2 § 4.3.1 : la formule géométrique
  //   surestime les km évités de 34 % à 2 lots, 55 % à 4.
  // "geometriques" — l'ancienne mesure (`kmSequence` / `kmLotSeul`), pour que le banc puisse
  //   rejouer l'écart relevé par l'analyse A.
  // ⚠️ Ne porte QUE sur les chiffres de TOURNÉE. Le détour d'une greffe (G2/G5) reste géométrique
  // en toutes circonstances — c'est la seule mesure que le métier ait arbitrée, et la seule qui
  // soit identique à `mesuresBoucle.js` du moteur (épreuve d'identité à N = 2).
  kmGardes: "reels",

  // ── L'ARRONDI DU TEMPS ───────────────────────────────────────────────────────────────────────
  // "fin" (DÉFAUT depuis le 2026-09-21) — le temps s'accumule en CONTINU : route = km / kmParJour,
  //   manutention = heures majorées de `margeDuree`, aucune des deux arrondie, aucun plancher par
  //   arrêt. La date d'une opération est le jour où elle COMMENCE.
  // "demi_journee" — chaque segment est arrondi à la demi-journée SUPÉRIEURE, avec un plancher
  //   d'une demi-journée par arrêt. C'est le prototype des essais, et c'est ce que l'épreuve
  //   différentielle vérifie — elle le demande désormais EXPLICITEMENT.
  //
  // ✅ TRANCHÉ PAR LE BANC DU 2026-09-21 (`essais-v2/banc/RAPPORT.md` § 1) : rejoué sur les
  // 76 tournées RÉELLEMENT posées en production, l'arrondi à la demi-journée en refuse **15**
  // (19,7 %), le temps continu **1** (1,3 %) ; les jours de camion mobilisés tombent de 513 à 356
  // (−30,6 %) et l'écart moyen à la date souhaitée de 1,54 à 0,62 jour. Ces tournées roulent : un
  // modèle qui en refuse 15 se trompe 15 fois. L'arrondi était une TROISIÈME marge, cumulée à
  // `kmParJour` (650 au lieu de 770) et `margeDuree` (+15 %), et la seule que personne n'avait
  // décidée.
  // ⚠️ Ce que le banc ne dit PAS : « fin » rend 39 % à 72 % de tournées possibles en plus sur les
  // viviers, et aucune n'a été confrontée à un planificateur. Il dit qu'elles ne sont pas refusées
  // par le calendrier, pas qu'elles sont bonnes.
  arrondi: "fin",

  // Reste de journée ouvrée, en HEURES, nécessaire pour ENGAGER une livraison en mode continu.
  // En deçà, la livraison attend le lendemain matin. Au-delà, elle commence et déborde sur le
  // lendemain — c'est ce que fait le moteur horaire (15 h → 18 h puis 7 h → 8 h).
  // Statut : hypothèse d'analyste. 1 h est le seuil au-dessous duquel envoyer une équipe décharger
  // n'a plus de sens ; personne ne l'a arbitré.
  resteMinPourCommencerH: 1,

  // Journée ouvrée : 7h → 18h. Sert à l'arrondi de la manutention et à la rallonge de G5.
  heuresJour: 11,

  // ── L'APPROCHE LE MATIN MÊME ─────────────────────────────────────────────────────────────────
  // Quand le camion quitte le dépôt, À VIDE, pour un CHARGEMENT, part-il la veille ou le matin
  // même ? (Un camion qui repart chargé vers une livraison, après une coupure, garde la veille.)
  // "journee" (défaut) — le matin même (7 h) dès que l'arrêt commence encore ce jour-là (un
  //   chargement qui ne tient plus dans le reste de la journée ne se coupe pas : on garde alors
  //   l'approche la veille) et que le retour avant le week-end tient.
  // "matinee" — le matin même seulement si l'approche tient dans une demi-journée (au compte
  //   évalué : 325 km au large, 385 au juste).
  // "veille" — toujours la veille : le prototype des essais, qui calait l'arrivée au début de la
  //   journée de l'arrêt. `contexte()` de `passe.js` le garde pour l'épreuve différentielle.
  // Statut : ARBITRÉ le 2026-09-24 (Louis, « approche le matin même », RAPPORT-D9 § 5 a). La
  // valeur "journee" plutôt que "matinee" est une lecture de l'implémentation : sous "matinee",
  // GL-896-CK #2 (380 km d'approche, 5 h 51 à 650 km/j) partirait encore la veille, alors que le
  // Gantt la fait rouler de 7 h à 14 h puis charger l'après-midi. Q17 n'est pas concernée : le
  // départ ne recule que dans la même journée ouvrée.
  approcheMemeJour: "journee",

  // ── LE JOUR DE CONTACT ENTRE DEUX TOURNÉES DU MÊME CAMION (`planning.js`) ────────────────────
  // Deux tournées qui partagent UN jour sont-elles un chevauchement ?
  // "demi_journee" (défaut) — non, si la première a rendu le camion dans une demi-journée
  //   antérieure à celle où la seconde le prend (rentrée le matin, repartie l'après-midi) ;
  // "fin" — non, si la première est rentrée avant le départ de la seconde, au fil du temps ;
  // "aucun" — toujours (bornes incluses : le comportement d'avant le 24/09).
  // Deux jours communs, ou une vraie superposition : `CAMION_DEJA_PRIS`, au niveau de
  // `niveaux.camionDejaPris` (refus, D9 — inchangé).
  // Statut : ARBITRÉ le 2026-09-24 (Louis, « tolérer un jour de contact, jugé à la demi-journée »,
  // RAPPORT-D9 § 5 b).
  contactJour: "demi_journee",

  // ── G1, LE TERRITOIRE ────────────────────────────────────────────────────────────────────────
  // Zones de chalandise (même forme que `RULES_DEFAULTS.zonesRetour`) et annuaire des agences
  // (pour `memePerimetreMutu`). Listes VIDES = G1 INACTIF, comme dans le moteur : le module ne
  // décide pas à la place de l'appelant quelles zones sont déclarées.
  zones: [],
  agencesData: [],

  // ── LE TRANSBORDEMENT COCHÉ PAR LE PLANIFICATEUR (`transbo.js`) ──────────────────────────────
  // Une navette (véhicule léger) collecte chez le client le jour VL (`op.vl ?? op.souhaite`,
  // contrat K1) ; le poids lourd charge au DÉPÔT de l'agence vendeuse, APRÈS (symétrique à la
  // livraison : il livre au dépôt AVANT la navette). Règle de Louis du 28/09 (`transbo.js`) : le
  // bloc du camion commence au plus tôt la demi-journée qui suit la fin de la collecte (qui commence
  // le matin du jour VL et dure la manutention du lot), au plus tard N jours ouvrés après le jour
  // VL ; à la livraison, il est fini au plus tard la veille ouvrée au soir, au plus tôt N jours
  // ouvrés avant.
  // `attenteQuaiJours` : N, combien de jours ouvrés la marchandise peut attendre à quai.
  //   Statut : hypothèse de la maquette (10, `ATTENTE_QUAI` de `bac-a-sable/moteur.js`, qui lit
  //   cette valeur) — ❓ question 6 aux planificateurs : délai de mise à quai, durée de chargement à
  //   quai, coût de la navette n'ont aucune valeur connue.
  // `dureeBlocH` : la durée du bloc du camion au dépôt, en heures. `null` (défaut) = une
  //   demi-journée du module (`heuresJour / 2`, 5 h 30), quel que soit le volume — « un bloc
  //   demi-journée » (Louis, 28/09). Ce n'est pas une manutention estimée : la marge du compte
  //   large ne s'y ajoute pas (`transbo.js`). Statut : arbitré (la demi-journée) ; le placement du
  //   bloc est à confirmer avec les planificateurs.
  // Transbordement coché = v2 (Louis, 27/09) ; la recherche qui PROPOSE d'elle-même un
  // transbordement reste en v3.
  transbo: { attenteQuaiJours: 10, dureeBlocH: null },

  // ── LA DISTANCE ──────────────────────────────────────────────────────────────────────────────
  // `null` (défaut) — la haversine × facteur du moteur, mémoïsée (`kmEntre` de `passe.js`).
  // Une fonction `(cpA, cpB) → km` la remplace PARTOUT : passes des deux comptes, lot fait seul,
  // mode géométrique, détour de greffe (G2/G5). C'est la prise d'une matrice d'itinéraires réels
  // (OSRM, décision D1 du sprint : vol d'oiseau pour octobre). Ce n'est pas une valeur métier,
  // c'est un branchement ; elle doit être déterministe. Ajout T0 (défaut D2).
  distance: null,
};

// Fusion PROFONDE sur les sous-objets qui en ont besoin (`comptes`, `niveaux`, `transbo`) : un
// appelant qui ne veut changer que `niveaux.horsFlex` ne doit pas avoir à recopier les quatre
// autres. Tout le reste est remplacé tel quel.
export function fusionnerReglages(partiel) {
  const p = partiel || {};
  return {
    ...REGLAGES_DEFAUT,
    ...p,
    comptes: {
      large: { ...REGLAGES_DEFAUT.comptes.large, ...(p.comptes?.large || {}) },
      juste: { ...REGLAGES_DEFAUT.comptes.juste, ...(p.comptes?.juste || {}) },
    },
    niveaux: { ...REGLAGES_DEFAUT.niveaux, ...(p.niveaux || {}) },
    transbo: { ...REGLAGES_DEFAUT.transbo, ...(p.transbo || {}) },
  };
}

// Vue « règles du moteur » d'un jeu de réglages : les fonctions importées de `data/referentiels.js`
// (`gardeDetourRetour`, `gardeRendement`…) lisent des clés à elles. On les leur fournit depuis le
// point unique qu'est `reglages.js`, plutôt que de recopier des seuils.
export function reglesMoteur(reglages) {
  return {
    gardeDetourRetourKm: reglages.detourMaxKm,
    gardeDetourMutuKm: reglages.detourMaxKm,
    gardeRendementKmJ: reglages.rendementMinKmJ,
    vitessePL: reglages.vitessePL,
    zonesRetour: reglages.zones,
  };
}
