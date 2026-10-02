// Les jetons de la charte — lus par `BTYPES`, plus bas. Ce sont des chaînes
// `var(--…)` avec repli : aucune dépendance au navigateur, les scripts Node qui
// importent ce fichier pour ses constantes métier ne s'en aperçoivent pas.
import { T, Trajet } from '../styles/tokens.js';

// ── RÉGIONS (référentiel géographique uniquement — agences/véhicules/users dans Firestore) ──
export const REGIONS = [
  { id: "sud",    name: "Région Sud & PACA" },
  { id: "se",     name: "Région Sud-Est" },
  { id: "so",     name: "Région Sud-Ouest" },
  { id: "ouest",  name: "Région Ouest" },
  { id: "centre", name: "Région Centre" },
  { id: "idf",    name: "Région Île-de-France" },
  { id: "nord",   name: "Région Nord & Est" },
  { id: "est",    name: "Région Est" },
];
// ── AGENCES (fallback — la source de vérité est agencesData depuis Firestore) ──
export const AGENCES = {};
export const VEHICLE_TYPES = ["PL", "remorque", "caisse mobile", "VL"];
// ── BLOCK TYPES ──
// LA SOURCE UNIQUE DE CE QUE CHAQUE NATURE DE BLOC EST — et, depuis le lot 6
// (`plan-dev-ux-v3.md` § 10.3, 2026-09-02), ce n'en est plus la source de couleur.
//
// `label`/`court` restent lus tels quels par le tag du bloc, la légende et la colonne
// « Segment » de l'export Excel — la NATURE d'un segment ne change pas de nom.
//
// La COULEUR, elle, a changé d'AXE (§ 10.1) : ce que la grille montre d'un coup d'œil n'est
// plus « ce bloc est un chargement » (la légende et le tag le disent déjà) mais « ce lot
// est l'ancre ou l'accroché de sa boucle ». Concrètement :
//   • un ARRÊT (chg/liv) est coloré par le RÔLE DU LOT (`COUL_ROLE`, via `roleDuLot` —
//     `utils/boucleLiens.js`), jamais par `bg`/`bc`/`tx` ci-dessous : `AtomBlock` ne les lit
//     plus pour ces deux types. Ils restent écrits mais plus RIEN ne les lit pour chg/liv
//     depuis que `GouttiereVoisine` (leur dernier lecteur) a été remplacée par de vraies
//     colonnes voisines (chantier UX v6, lot L5, 2026-09-15) — ni la grille, ni la légende.
//   • un TRAJET (les six autres) reste neutre et se distingue par PLEIN (chargé) / CREUX
//     (à vide) — jamais deux gris à comparer, cf. § 10.2 — `bg`/`bc`/`tx` en portent donc
//     désormais les TROIS familles (`Trajet.*`, `styles/tokens.js`), et non plus une couleur
//     par type : les six types s'y répartissent en deux (un trajet mutualisé, la 3ᵉ famille,
//     n'est pas un TYPE mais un ÉTAT — porté par le lot, pas par `BTYPES` — cf. `AtomBlock`).
//     Repli défensif inchangé : un type inconnu retombe sur `BTYPES.trs`, ici comme ailleurs.
//   • `dashed` ne change pas de rôle : c'est un style de bordure hors de cet axe, laissé tel
//     quel — le lot 6 ne retouche que la couleur, § 9.1 (« repeint, rien d'autre »).
export const BTYPES = {
  app: { label: "Approche", bg: Trajet.emptyFill, bc: Trajet.emptyLine, tx: T.tx3, dashed: true },
  // `court` : la forme employée quand le ruban de tournée porte déjà le nom du client et que la
  // case n'a plus la place d'écrire le libellé entier (cf. `RubansPL`). Seules les deux
  // opérations en ont besoin — les blocs de route ne sont jamais réduits à une ligne.
  chg: { label: "Chargement", court: "CHG", bg: T.bll, bc: T.bl, tx: T.bl },
  trs: { label: "Route", bg: Trajet.routeFill, bc: Trajet.routeFill, tx: Trajet.ink, dashed: true },
  liv: { label: "Livraison", court: "LIV", bg: T.gl, bc: T.g, tx: T.g },
  ret: { label: "Retour dépôt", bg: Trajet.emptyFill, bc: Trajet.emptyLine, tx: T.tx3, dashed: true },
  vid: { label: "Route vide", bg: Trajet.emptyFill, bc: Trajet.emptyLine, tx: T.tx3, dashed: true },
  // Le « ★ » a quitté ce libellé : il partait tel quel dans les blocs du Gantt ET dans la colonne
  // « Segment » de l'export Excel — un caractère décoratif au milieu d'un tableur. (La légende
  // le dessinait, elle, en vraie icône `Star` À CÔTÉ du même libellé sans étoile : les deux se
  // contredisaient. Depuis le lot 6, la légende ne parle plus de NATURE du tout — elle décrit le
  // rôle et les deux familles de trajet, cf. `LegendBar.jsx`.)
  // ⚠️ Jamais généré par le moteur (grep vérifié, 2026-09-02) — gardé pour les listes qui le
  // mentionnent défensivement. Même famille que `trs` (§ 9.3 : « route » = chargé) : un trajet
  // mutualisé se signale par un ÉTAT du lot (`AtomBlock`), pas par ce type.
  bou: { label: "Route chargée", bg: Trajet.routeFill, bc: Trajet.routeFill, tx: Trajet.ink },
  repo: { label: "Repositionnement", bg: Trajet.emptyFill, bc: Trajet.emptyLine, tx: T.tx3, dashed: true },
};
// ── DURATIONS (quart de journée) ──
export const DUREE_OPTIONS = [
  { v: "qj1", l: "¼J", s: "2h", h: 2 },
  { v: "qj2", l: "½J", s: "4h", h: 4 },
  { v: "qj3", l: "¾J", s: "6h", h: 6 },
  { v: "1day", l: "1J", s: "8h", h: 8 },
  { v: "1qj", l: "1¼J", s: "10h", h: 10 },
  { v: "1hj", l: "1½J", s: "12h", h: 12 },
  { v: "1tj", l: "1¾J", s: "14h", h: 14 },
  { v: "2day", l: "2J", s: "16h", h: 16 },
];
// Normalise une durée (clé DUREE_OPTIONS ou valeur legacy) en heures. Null si inconnue.
// Définition UNIQUE (audit moteurs 2026-07-19) — les moteurs l'importent d'ici,
// plus de copies locales dans chainBuilder/boucleEngine.
export function parseDur(d) {
  if (!d) return null;
  const opt = DUREE_OPTIONS.find(o => o.v === d);
  if (opt) return opt.h;
  if (d === "2h") return 2;
  if (d === "halfday") return 4;
  if (d === "1day") return 8;
  if (d === "multi") return 16;
  return null;
}

// ── ABAQUE MANUTENTION (arbitrage métier 2026-07-21) ──
// Référence UNIQUE de la cadence de manutention, côté saisie ET côté moteur :
//   · ETP     : 2 par défaut, 3 au-delà de 50 m³
//   · cadence : `manutRatio` (10 m³/h) s'entend **PAR ETP** — aligné le 2026-07-21 ; auparavant
//               le repli moteur l'appliquait globalement, sans tenir compte de l'équipe, ce qui
//               donnait des durées incohérentes avec celles proposées à la saisie.
//   · durée   : volume / (cadence × ETP), arrondie au palier DUREE_OPTIONS SUPÉRIEUR (on ne
//               sous-estime jamais le temps sur site), plancher `manutMin` (¼J = 2h).
export const ABAQUE_MANUT = { m3ParHeureParEtp: 10, etpBase: 2, etpRenfort: 3, seuilRenfortM3: 50 };

// Équipe préconisée par l'abaque pour un volume donné.
export function etpAbaque(vol) {
  return (parseFloat(vol) || 0) > ABAQUE_MANUT.seuilRenfortM3 ? ABAQUE_MANUT.etpRenfort : ABAQUE_MANUT.etpBase;
}

// Durée de manutention en HEURES, calée sur un palier DUREE_OPTIONS.
// `fte` = équipe réellement saisie sur le lot ; à défaut, celle de l'abaque.
// `rules` permet à l'admin d'agir sur la cadence (manutRatio) et le plancher (manutMin).
export function manutHeures(vol, fte, rules = {}) {
  const v = parseFloat(vol) || 0;
  const cadence = rules.manutRatio || ABAQUE_MANUT.m3ParHeureParEtp;
  const plancher = rules.manutMin ?? 2;
  const equipe = fte > 0 ? fte : etpAbaque(v);
  const brut = Math.max(plancher, v / (cadence * equipe));
  const opt = DUREE_OPTIONS.find(o => o.h >= brut) || DUREE_OPTIONS[DUREE_OPTIONS.length - 1];
  return opt.h;
}

// Proposition faite à la SAISIE (formulaire de création) à partir du seul volume.
// Retourne { fte, heures, dureKey, dureLabel } — ou null si le volume n'est pas exploitable.
// Le planificateur reste libre de la modifier (chips durée / ± ETP).
export function suggestManut(vol) {
  const v = parseFloat(vol) || 0;
  if (v <= 0) return null;
  const fte = etpAbaque(v);
  const heures = v / (ABAQUE_MANUT.m3ParHeureParEtp * fte);
  const arrondi = manutHeures(v, fte);
  const opt = DUREE_OPTIONS.find(o => o.h === arrondi) || DUREE_OPTIONS[DUREE_OPTIONS.length - 1];
  return { fte, heures, dureKey: opt.v, dureLabel: opt.l };
}

// ── PRESTATION TYPES ──
export const PRESTA_OPTIONS = [
  { v: "access", l: "Access" },
  { v: "access_plus", l: "Access +" },
  { v: "standing", l: "Standing" },
  { v: "standing_plus", l: "Standing +" },
  { v: "optimum", l: "Optimum" },
];
// ── OBJETS LOURDS ──
export const OBJETS_LOURDS_OPTIONS = ["Moto", "Voiture", "Coffre-fort", "Piano droit", "Piano à queue"];
// ──────────────────────────────────────────────────────────────
// STATUT LOT — modèle unifié (M8)
// ──────────────────────────────────────────────────────────────
// Un lot a toujours exactement UN statut parmi :
//   - "placed_locked"    : placé, date confirmée client, intouchable par le moteur de boucle
//   - "placed_unlocked"  : placé, date provisoire, peut être décalé par une proposition de boucle
//   - "pending_agency"   : retour proposé à une agence B, en attente de réponse
//   - "callback"         : aucune solution trouvée (ni boucle, ni capacité locale) — à rappeler
//
// Règles :
//   - Un lot placed_locked reste éligible comme candidat B dans une boucle, mais ses dates ne bougent pas.
//   - Un lot placed_unlocked accepte un décalage de dates par le moteur.
//   - Une boucle validée (retour accepté ou mutualisation validée) → placed_locked côté A.
//   - Le lot complémentaire impacté par une boucle reste placed_unlocked, dates mises à jour + todo.
//   - Callback = uniquement branche "no solution", jamais choisi volontairement.
//
// Compat : on maintient `_locked: bool` comme miroir dérivé pendant la transition,
// pour que les fonctions utilitaires non encore migrées (findBoucleCandidates, etc.) continuent de marcher.

export const LOT_STATUS = {
  PLACED_LOCKED: "placed_locked",
  PLACED_UNLOCKED: "placed_unlocked",
  PENDING_AGENCY: "pending_agency",
  CALLBACK: "callback",
};

// Label UI court pour chaque statut — CE QUI S'AFFICHE SUR UN LOT (la pastille).
// « Placé · confirmé » disait « Placé ✓ » : le crochet portait seul toute la différence avec
// « Placé · à confirmer », en un caractère dessiné par le système. Les deux libellés se lisent
// désormais l'un en face de l'autre, et le cadenas de `lib/iconesStatut.js` redit la même chose.
//
// 🔑 Arbitrage 2 / 15 (2026-09-07, plan-dev-ux-v5.md § 6) — LE VERROU S'AFFICHE EN CREUX :
// `placed_locked` n'a plus rien à dire sur une pastille (le verrou CHG n'affichait déjà rien,
// c'est Q15 ; le verrou LIV se lit désormais en creux — absent ⇒ verrouillé). ⚠️ La clé RESTE :
// `getLotStatus` la rend toujours, un `undefined` afficherait le code brut `placed_locked` à
// l'écran. Tout lecteur de cette table doit tolérer la chaîne vide. La légende, elle, continue de
// NOMMER ce statut — via `LOT_STATUS_DESCRIPTIONS` juste en dessous, jamais celle-ci.
//
// 🔴 RENOMMÉ le 2026-09-15 soir (brief M4 § 0.2/2.2, chantier UX v7, lot M4) : `callback` disait
// « Client à rappeler » depuis le 2026-09-14 — Louis a demandé de le renommer « Lots impossibles à
// placer », partout où le statut s'affiche, la CLÉ `callback` restant inchangée (persistée). Cette
// table sert l'étiquette d'UN SEUL lot (pastille de carte, fiche) : forme SINGULIÈRE. Le titre de
// ligne/légende/filtre, qui parle d'un ENSEMBLE de lots, prend la forme plurielle — posée à côté,
// dans `LOT_STATUS_DESCRIPTIONS` (légende) et en dur dans `BandeauStatuts.jsx`/
// `PlacedLotsPopover.jsx` (titre de ligne, filtre).
export const LOT_STATUS_LABELS = {
  placed_locked: "",
  placed_unlocked: "Placé · à confirmer",
  pending_agency: "En attente agence",
  callback: "Lot impossible à placer",
};

// CE QUI SE DIT D'UN STATUT — la légende (`LegendeStatutsModal`) nomme les quatre en toutes
// lettres, `placed_locked` compris : une légende explique ce qui existe, y compris ce qui se lit
// en creux. Table distincte de `LOT_STATUS_LABELS` (arbitrage 15) : ne jamais lire l'une pour
// l'autre — l'une est un AFFICHAGE (peut être vide), l'autre une EXPLICATION (jamais vide).
//
// 🔴 RENOMMÉ le 2026-09-15 soir (brief M4 § 0.2/2.2) — cette table nomme une CATÉGORIE de statut
// (la légende, un titre), pas un lot précis : `callback` y prend donc la forme PLURIELLE « Lots
// impossibles à placer », par cohérence avec le titre de ligne du bandeau (`BandeauStatuts.jsx`,
// `LIGNES_STATUTS`) et le filtre (`PlacedLotsPopover.jsx`) — alors que `LOT_STATUS_LABELS`
// ci-dessus, posé sur UN lot, en garde la forme singulière « Lot impossible à placer ».
export const LOT_STATUS_DESCRIPTIONS = {
  placed_locked: "Placé · confirmé",
  placed_unlocked: "Placé · à confirmer",
  pending_agency: "En attente agence",
  callback: "Lots impossibles à placer",
};

// ── RÔLES UTILISATEUR ────────────────────────────────────────────────────────
// Miroir du référentiel serveur : `USER_ROLES` (onefleet-api/app/domain/shred.py)
// et la table `user_roles` (db/sql/02_seed_referentiels.sql). ⚠️ Ajouter un rôle
// ici ne suffit PAS : `users.role_code` porte une clé étrangère, il faut aussi une
// migration Alembic — sans quoi toute écriture échoue en violation de contrainte.
//
// `lecteur` est né du SSO Entra (plan docs/exploitation/sso-entra.md, lot 1) :
// cinq des sept groupes Entra n'écrivent pas. Sans lui, il aurait fallu les
// mapper sur `planif` — qui, lui, écrit sur le planning.
export const ROLES_UTILISATEUR = {
  admin: {
    label: "Admin",
    description: "Voit tout et enregistre partout. Seul rôle à ouvrir l'onglet Admin.",
  },
  planif: {
    label: "Planif",
    description: "Enregistre sur les agences qui lui sont attribuées. Sans attribution, il ne voit rien.",
  },
  lecteur_national: {
    label: "Lecteur national",
    description: "Voit le planning du groupe entier, et n'y enregistre rien. Direction générale, rail.",
  },
  lecteur: {
    label: "Lecteur",
    description: "Voit les agences qui lui sont attribuées, sans rien enregistrer. Sans attribution, il ne voit rien.",
  },
  rail_manager: {
    label: "Rail manager",
    description: "Parc de caisses. Module Rail différé — non attribuable pour l'instant.",
  },
};

// Les rôles que l'écran Admin propose. `rail_manager` en est absent tant que le
// module Rail n'est pas sorti : il existe en base, on ne l'attribue pas.
// Ordre : du plus large au plus étroit, c'est ainsi qu'on les compare.
export const ROLES_ATTRIBUABLES = ["admin", "planif", "lecteur_national", "lecteur"];

// Les seuls rôles qui ÉCRIVENT. Point de lecture unique — miroir de
// `ROLES_ECRITURE` (onefleet-api/app/authz.py), qui fait foi.
export const ROLES_ECRITURE = new Set(["admin", "planif"]);

// Les rôles qui voient TOUT, sans qu'aucune agence leur soit attribuée.
// ⚠️ Deux axes indépendants, qu'on confond parce qu'`admin` est au maximum des
// deux : `lecteur_national` voit tout SANS écrire, `planif` écrit SANS tout voir.
// Miroir de `ROLES_NATIONAUX` (onefleet-api/app/authz.py).
export const ROLES_NATIONAUX = new Set(["admin", "lecteur_national"]);

// Rôle de moindre privilège : le repli quand on ne sait pas qui est en face.
// Il ne voit rien et n'écrit rien — c'est bien le minimum.
export const ROLE_MOINDRE_PRIVILEGE = "lecteur";

// Le PICTO d'un statut a déménagé dans `src/lib/iconesStatut.js` (`ICONE_STATUT`) : ce sont
// désormais des composants `lucide-react`, et ce fichier-ci est aussi importé par les scripts
// Node d'analyse — il ne doit rien devoir au navigateur.
export const RULES_DEFAULTS = {
  dayStart: 7, dayEnd: 18, vitessePL: 70,
  // manutMin : durée minimum d'une manutention (chargement/livraison) calculée depuis le volume.
  // Arbitrage métier 2026-06-10 : 2h partout (alignement sur la valeur réellement posée par le
  // planificateur d'heures ; les anciennes mentions « 1h » / « 30 min » sont caduques).
  manutRatio: 10, manutMin: 2, seuilRoute: 15,
  // ── 🔴 LES SEUILS DE PROXIMITÉ NE FORMENT PLUS DE BOUCLES (arbitrage Louis 2026-08-19) ─────
  // Il y en avait deux — 300 km au retour (liaison à vide chgAcc↔livAnc), 80 km en mutualisation
  // (détour de collecte chgAcc↔chgAnc). Tous deux bornaient une DISTANCE BRUTE, avant que le
  // moindre garde-fou n'ait vu la géométrie complète. Ils sont retirés de la formation des
  // boucles, pour deux raisons distinctes :
  //
  //   RETOUR — la campagne « fil de l'eau vs big bang » (2026-08-18) a montré que ce seuil
  //            PLAFONNAIT le détour avant que G2 le mesure : la liaison est le PREMIER TERME du
  //            détour, donc G2 n'a jamais pu voir un couple que ce seuil avait déjà écarté
  //            (liaison max observée sur l'univers : 298 km, contre un plafond à 300 — la
  //            population était plaquée contre la borne). Or G2 juge mieux : il pèse la liaison
  //            contre le TRAJET REMPLACÉ. Une liaison de 350 km alignée sur la route du porteur
  //            ne coûte presque rien ; une liaison de 100 km à contresens coûte cher. Un seuil sur
  //            la distance brute ne sait pas faire cette différence. G1 (zones) + G2 + G5 restent.
  //
  //   MUTU   — il était le SEUL garde-fou géographique, faute de zones applicables : c'est cette
  //            solitude, et rien d'autre, qui l'avait maintenu à 80 km le 2026-08-03. Elle a
  //            cessé — **G1 couvre désormais la mutualisation** (`checkMutuZones`, utils/zones.js :
  //            les deux chargements dans LA MÊME zone déclarée). Le seuil kilométrique n'a donc
  //            plus de raison d'être, et la clé `seuilProxMutuKm` est SUPPRIMÉE.
  //
  // ⚠️ CE QUI RESTE DE `seuilProxRetourKm` — et c'est un tout autre métier : le RECHAÎNAGE
  // PHYSIQUE. Entre deux chantiers d'un même PL, `detectBoucles` s'en sert pour décider si le
  // camion enchaîne en direct ou rentre au dépôt (`engine/boucleEngine.js`, « Q20 — la règle des
  // 80 km prime sur le rechaînage »). Ce n'est pas un garde-fou de boucle : il vaut DÉCISION OU
  // PAS, puisqu'il ne dit pas si une boucle est bonne mais où l'équipage dort. Il est donc
  // conservé tel quel, et son sort est **À STATUER** — question ouverte Q21
  // (`docs/decisions/questions-ouvertes.md`), à trancher avec Q20 qui porte sur le même conflit.
  // ⚠️ Ne jamais relire la clé « en dur » : passer par `seuilProxRetour(rules)` (plus bas).
  seuilProxRetourKm: 300,   // ⚠️ RECHAÎNAGE PHYSIQUE UNIQUEMENT — ne forme plus aucune boucle (Q21, à statuer)
  minKmEco: 50,             // kmEco minimum pour émettre un candidat
  // ── LA PILE DE GARDE-FOUS DES BOUCLES (arbitrage Louis 2026-08-14) ────────
  // Décision normative : `docs/boucles/couplage-synthese.md`. Six règles filtraient les boucles
  // proposées ; aucune n'avait jamais été mesurée. Elles l'ont été sur 7 mois de dossiers réels
  // (4 909 dossiers, 45 agences, 946 516 couples formés et jugés un à un). **La pile passe de SIX à
  // TROIS**, et ce qui est retiré ne l'est pas par indulgence :
  //
  //   G1 territoire      CONSERVÉ, et ÉTENDU À LA MUTUALISATION le 2026-08-19. Il n'a pas de clé
  //                      de seuil : il vit dans `zonesRetour` (ci-dessous), lu par
  //                      `checkRetourZones` au retour et par `checkMutuZones` en mutualisation.
  //                      `memePerimetreMutu` ne fait PAS partie de G1 : il dit qui a le droit de
  //                      mutualiser (agence / région), jamais où.
  //   G2 détour          150 → 400 km. À 150 km il refusait 96 % des couples : le filtre coûtait
  //                      plus qu'il ne protégeait (le cas fondateur — 375 km de détour — était
  //                      refusé). Cf. `gardeDetourRetourKm` / `gardeDetourMutuKm`.
  //   G3 remplissage M2  RETIRÉ COMME BARRIÈRE. Seule règle de la pile à faire l'INVERSE de son
  //                      métier : elle refusait plus de bonnes boucles que de mauvaises. Elle reste
  //                      AFFICHÉE au planificateur (`_mesures.m2`, « rentrerait à 85 % vide »),
  //                      en mention neutre — jamais en refus. Aucune clé : plus rien à régler.
  //   G4 immobilisation  RETIRÉ COMME BARRIÈRE. Il ne bloquait AUCUN couple que les autres ne
  //                      bloquaient déjà (0 sur 946 516) — son doublon est G2. Reste affiché
  //                      (`_mesures.rallongeJ`, `libelleRallonge`). Aucune clé.
  //   G5 rendement       450 → 750 km/jour. La règle la plus informative de toutes, et la seule à
  //                      voir la MANUTENTION. Cf. `gardeRendementKmJ`.
  //   G6 gain minimum    RETIRÉ (il valait 300 km). 99 % de ce qu'il refusait est déjà refusé par
  //                      G5 une fois celui-ci à 750. ⚠️ `minKmEco` (50 km, juste au-dessus) N'EST
  //                      PAS G6 et ne descend pas à zéro : c'est le plancher absolu du moteur.
  //
  // Ce que le planificateur lit, en une phrase : « une boucle ne part pas de plus de 400 km de sa
  // route, et chaque journée de camion mobilisée en plus doit rapporter au moins 750 km évités. »
  //
  // ⚠️ Ne jamais relire ces clés en dur : passer par les accesseurs `gardeDetourRetour(rules)`,
  // `gardeDetourMutu(rules)`, `gardeRendement(rules)`… définis plus bas. Point d'application unique
  // du verdict : `engine/gardesBoucle.js` — aucune de ces valeurs ne se relit ailleurs.
  //
  // G2 — DÉTOUR MAXIMUM DE L'ACCROCHÉ, EN KILOMÈTRES ABSOLUS.
  // 🔴 La FORME du budget a été tranchée le 2026-08-14, ne pas la rouvrir en pourcentage : la
  // campagne montre que le budget optimal DÉCROÎT quand le couloir s'allonge — exactement l'inverse
  // de ce que produit un %. Un couloir long a déjà consommé sa marge.
  // Deux clés parce que les deux géométries ne remplissent pas le même vide : au RETOUR le porteur
  // est un trajet à vide (on remplit du néant), en MUTUALISATION c'est une mission déjà vendue et
  // déjà chargée (on rallonge un client qui n'a rien demandé) — d'où une tolérance en principe plus
  // basse. Les mesures désignaient d'ailleurs 400 au retour et 300 en mutualisation ; **400 a été
  // retenu partout par simplicité, l'écart est ASSUMÉ** et reste ouvert (cf. § « Ce qui reste
  // ouvert » de la note de décision). Les deux clés existent précisément pour pouvoir le refermer
  // sans toucher au code.
  //
  // 🔵 400 → 500 km (arbitrage Louis 2026-08-19). La campagne « fil de l'eau vs big bang »
  // (2026-08-18, `docs/boucles/campagnes/`) a balayé G2 de 300 à 800 km AU FIL DE L'EAU, régime de
  // production. Ce que 500 rapporte : **+26 634 km évités (+3,7 %) et +17 boucles** sur 7 mois,
  // contre **+8 boucles douteuses** — 8 de plus sur 740 posées.
  // ⚠️ CE QUE LA MESURE NE DIT PAS, et il faut le savoir en relisant ce chiffre : elle ne DÉSIGNE
  // pas 500. Le rendement du desserrage s'effondre exactement à ce pas (300→400 : 10 414 km par
  // boucle douteuse ; 400→500 : 3 329, soit ÷3 ; puis plat au-delà). Le coude est à 400 ; 500 est
  // un point comme un autre sur une pente régulière. C'est donc un ARBITRAGE, assumé comme tel,
  // pas une valeur que les données auraient élue.
  // ⚠️ Et cette pente a été mesurée AVANT le retrait des seuils de proximité (ci-dessus) : le
  // seuil retour censurait précisément la population qui peuple les bandes hautes. **Non
  // remesuré — décision de Louis du 2026-08-19 : « on verra à l'usage ».**
  gardeDetourRetourKm: 500,
  gardeDetourMutuKm: 500,
  // G5 — RENDEMENT : km évités minimum par JOURNÉE DE CAMION mobilisée en plus.
  // La journée en question est la RALLONGE **manutention comprise** (`engine/mesuresBoucle.js`) —
  // pas la seule rallonge kilométrique : le plancher de 2 h par manutention ajoute ~4 h à presque
  // tout dossier, soit ~0,36 journée qu'aucune règle géométrique ne peut voir.
  // Pourquoi 750 et non 450 : les deux ont été mesurées. À 450 la pile récupérait +20,6 % de km
  // évités mais laissait passer 39 boucles douteuses (2 %) ; à 750 elle en laisse 8 (1 %) pour
  // 5,3 % de kilomètres en moins. **Diviser les douteuses par cinq pour un vingtième du gain** est
  // le meilleur échange du dossier : la valeur d'un garde-fou n'est pas kilométrique, elle est de
  // ne pas proposer une boucle que le planificateur refuserait d'un coup d'œil.
  gardeRendementKmJ: 750,
  // ⑦ — PLANCHER D'ABSURDITÉ : « jamais un détour supérieur au trajet qu'il remplace »
  // (`détour ≤ d(E,S)`, le segment porteur). C'est le TROU CONNU du budget en kilomètres absolus :
  // un couple dont le porteur fait 150 km et le détour 380 km passe G2 à 400, alors que le camion
  // roule 2,5 fois plus pour prendre le lot que pour ne pas le prendre.
  // 🟡 **QUESTION ENCORE OUVERTE** — aucune campagne ne peut la trancher (elle demande de regarder
  // des boucles et de dire si elles ont du sens) : c'est l'objet du panel de 50 boucles réelles.
  // 🔴 ROUVERTE LE 2026-08-19, et c'est sa propre note de décision qui l'exige. Le 18/08, ⑦ était
  // écarté au motif que « le budget de détour élimine déjà 99 % des contre-sens », avec une seule
  // condition de réouverture nommée : « que ce budget soit un jour relâché — jamais le calendrier ».
  // Ce budget est passé de 400 à 500 km le 19/08, et les deux seuils de proximité ont été retirés
  // le même jour. ⑦ est désormais le SEUL garde-fou codé qui facture le contre-sens — donc le seul
  // rattrapage disponible depuis que plus rien ne facture le roulage à vide (M2/G3 n'est
  // qu'affiché). Il reste livré DÉSACTIVÉ : l'activer est une décision de Louis, pas du code.
  // Livré DÉSACTIVÉ, activable en administration pour mesurer ce qu'il retire. Ce n'est pas un
  // budget à calibrer, c'est une règle binaire — d'où un booléen et non un seuil.
  gardePlancherAbsurdite: false,
  // ── LE SCORE DE CLASSEMENT DES PROPOSITIONS (arbitrage Louis 2026-08-14) ──
  //   score = km évités − λ × rallongeJours − μ × joursRetard − ν × joursAvance
  // Le moteur classait sur les km évités et RIEN d'autre ; ce classement retenait 29 % de boucles
  // douteuses au retour. Deux choses lui manquaient, et aucune n'est un kilomètre.
  //
  // 🔑 LE DÉTOUR N'ENTRE PAS DANS LE SCORE, et c'est l'erreur classique à ne pas commettre :
  // l'identité `km évités = (trajet que l'accroché aurait fait seul) − détour` le soustrait DÉJÀ,
  // au coefficient 1. L'y remettre facturerait deux fois les mêmes kilomètres.
  //
  // λ — le prix d'une journée de camion, en kilomètres. MESURÉ : c'est la seule valeur qui ressorte
  // identique sur les deux géométries et sur les deux populations de contrôle.
  // ⚠️ MÊME VALEUR que `gardeRendementKmJ`, mais **DEUX RÔLES DIFFÉRENTS**, et deux réglages qui
  // doivent le rester : l'un est une BARRIÈRE (il refuse), l'autre un COEFFICIENT DE CLASSEMENT (il
  // ordonne ce qui a déjà été accepté). Une même grandeur ne veut pas le même chiffre selon qu'elle
  // filtre ou qu'elle classe : on peut vouloir barrer sévèrement et classer doucement, ou l'inverse.
  // Les fusionner sous prétexte qu'elles valent 750 aujourd'hui rendrait l'un des deux arbitrages
  // impossible à poser demain.
  scoreCoutJourCamionKm: 750,
  // μ — le prix d'un jour de RETARD de la livraison ANNONCÉE de l'ancre, en kilomètres (livraison
  // proposée APRÈS la date déjà annoncée au client).
  // 🟡 **ARBITRAGE COMMERCIAL, PAS UNE MESURE** — aucune campagne ne le produit. C'est ce qu'on
  // accepte de payer pour rappeler un client dont la livraison était déjà annoncée. **Valeur
  // provisoire, la plus incertaine du lot**, à confirmer après quelques semaines d'usage ; à dire
  // quand on l'affiche. Le décalage se compte en jours CALENDAIRES et non ouvrés : c'est ce que le
  // client ressent, et avec la règle du week-end une rallonge d'une demi-journée peut produire
  // trois jours de décalage.
  // 📈 PORTÉ DE 200 À 400 LE 2026-08-18, sur mesure (septembre 2026, `docs/boucles/campagnes/
  // mesure-mu-plancher-A5-2026-08-18.md`). La mesure a montré que le prix RÉEL d'une journée de
  // décalage épargnée DÉCROÎT quand on monte μ : 134 km au palier 0→100, 114 au palier 100→200,
  // puis seulement 69 au palier 200→400. À 200 on achetait donc bien en dessous du prix qu'on
  // déclarait être prêt à payer. Le passage à 400 coûte 822 km sur 77 000 (1 % des km évités) et
  // retire 12 journées de décalage imposées à des clients — les boucles sans aucun décalage
  // passent de 58 % à 63 %. ⚠️ Au-delà de 400 la mesure n'est plus lisible (artefact de la méthode
  // d'appariement) : ne pas monter davantage sans remesurer autrement.
  scoreCoutJourDecalageKm: 400,
  // ν — le prix d'un jour d'AVANCE de la livraison ANNONCÉE de l'ancre, en kilomètres (livraison
  // proposée AVANT la date déjà annoncée) — arbitrage Louis 2026-08-18 : « livraison avancée à
  // pénaliser moins qu'une livraison retardée ». Avant cette décision, le code prenait la VALEUR
  // ABSOLUE du décalage : une avance de trois jours coûtait autant qu'un retard de trois jours,
  // alors qu'un retard est une gêne bien plus forte pour le client qu'une avance.
  // Une livraison avancée dérange moins le client qu'un retard, mais elle le dérange quand même —
  // il faut le rappeler, il doit être présent, ses accès doivent être libres — donc elle coûte,
  // MOINS cher que μ. 🟡 Même statut que μ : arbitrage commercial, pas une mesure.
  // ⚠️ Distinct de μ pour la même raison que λ est distinct de `gardeRendementKmJ` : deux
  // coefficients, deux décisions, jamais fusionnés au prétexte qu'ils pénalisent tous deux un
  // « jour » de décalage.
  // 📈 PORTÉ DE 100 À 200 LE 2026-08-18, EN MÊME TEMPS QUE μ ET POUR LA MÊME RAISON. Le rapport
  // de 1 à 2 entre l'avance et le retard est celui qui a été arbitré ; monter μ seul aurait changé
  // DEUX choses à la fois (le niveau ET le rapport), et on n'aurait plus su attribuer un effet à
  // l'une ou à l'autre. ⚠️ Le taux d'échange mesuré porte sur le décalage TOTAL (le moteur en
  // prenait la valeur absolue) : il ne dit rien sur le partage avance/retard, qui reste un
  // arbitrage. Ce qu'il dit, en revanche : 37 % des décalages sont des avances (1,8 j en moyenne)
  // contre 63 % de retards (2,6 j) — la distinction n'est pas marginale.
  scoreCoutJourAvanceKm: 200,
  // ── BALAYAGE DE LA FENÊTRE DE FLEX (arbitrage Louis 2026-07-28) ───────────
  // Gain minimum (km réellement roulés) exigé pour proposer un GROUPAGE À UNE AUTRE DATE que celle
  // déjà promise aux deux clients. En dessous, on ne dérange personne : la date d'origine est
  // conservée. Motivation : certaines missions longues (PACA↔Bretagne) ne tiennent dans la semaine
  // — retour dépôt du vendredi soir compris, règle Q17 — QUE si le chargement part en début de
  // semaine ; décalé d'un ou deux jours, le moteur produisait un aller-retour dépôt parasite à
  // +2 000 km (cas CHT-092958/CHT-961457). Le décalage n'est jamais silencieux : il remonte via
  // `partnerNewDateC` → todo de confirmation client.
  // PLAFOND DE PROPOSITIONS DE BOUCLE (arbitrage Louis E2, 2026-09-02) — le moteur s'arrête à 3.
  // Il en rendait 8, en dur dans `boucleEngine.js`. Conséquence assumée : les trois refusées, il ne
  // reste rien. C'est aussi ce qui permet à l'écran de proposition d'afficher un RANG (« 2/3 »)
  // plutôt qu'un score.
  maxPropositionsBoucle: 3,
  // 🔴 `gainMinDecalageChgKm` (300 km) a été RETIRÉ le 2026-09-03 (arbitrage Louis). Il exigeait
  // qu'une autre date de chargement de l'accroché fasse gagner au moins 300 km réellement roulés
  // pour l'emporter sur le groupage serré sur l'ancre. Motif du retrait : « les meilleures boucles
  // apparaîtront au planif, et si elle est sans intérêt il ne la sélectionnera pas » — on cesse
  // d'empiler des règles de départage par-dessus les garde-fous. Le balayage retient désormais la
  // chaîne qui roule le moins, la date demandée par le client ne servant que de départage à km
  // égaux. ⚠️ Ne pas réintroduire cette clé sans rouvrir l'arbitrage : une base existante peut
  // encore la porter dans ses `rules`, elle n'est plus lue par personne.
  // ── ZONES DE CHALANDISE — G1 (arbitrage 2026-07-28, étendu à la mutu le 2026-08-19) ────────
  // UN SEUL référentiel de zones, DEUX contrôles (cf. utils/zones.js) :
  //   • RETOUR — la boucle relie DEUX zones : le camion part chargé de l'une, livre dans
  //     l'autre, y recharge et rentre chargé (`checkRetourZones`).
  //   • MUTUALISATION — les deux CHARGEMENTS se collectent dans LA MÊME zone (`checkMutuZones`).
  //     Les livraisons restent libres. Ce contrôle REMPLACE `seuilProxMutuKm` (80 km), supprimé.
  // ⚠️ Le nom de la clé reste `zonesRetour` bien qu'elle serve les deux scénarios : elle est
  // PERSISTÉE en base, la renommer demanderait une migration pour aucun gain fonctionnel.
  // `coeur` / `peripherie` sont distingués pour un usage FUTUR (quels départements chaque
  // agence traite en vente) ; pour le moteur, l'union des deux fait foi.
  // Liste vide ⇒ règle inactive (comportement d'avant l'arbitrage).
  zonesRetour: [
    {
      code: "ouest", label: "Ouest",
      coeur: ["29", "56", "35", "44"],
      peripherie: ["22", "50", "53", "72", "49", "85"],
    },
    {
      code: "paca", label: "PACA",
      coeur: ["13", "83", "84", "30"],
      peripherie: ["04", "05", "06", "34"],
    },
  ],
  // Flexibilité livraison globale : appliquée à tous les lots sauf si dateLivImposee=true.
  // Permet au moteur de proposer des boucles avec livraison jusqu'à dateL + flexLivraisonJours.
  // Règle métier : un client accepte une livraison plus tôt que demandée. On borne le "plus tard".
  flexLivraisonJours: 4,
  // Enchaînement continu entre deux chantiers d'un même PL : écart MAX en jours ouvrés entre la
  // livraison d'un chantier et le chargement du suivant en deçà duquel le PL enchaîne en direct
  // (repositionnement, sans rentrer au dépôt). Au-delà, le PL ne reste PAS à attendre sur place :
  // il rentre au dépôt entre les deux et repart du dépôt pour le chantier suivant (arbitrage Louis
  // 2026-07-23 : « le camion rentre même si le prochain chantier est plusieurs jours plus tard »).
  // 1 = seul le jour ouvré suivant (ou le jour même) est considéré comme un enchaînement direct.
  // Un week-end intercalé rompt toujours la continuité, quel que soit ce seuil (règle Q17).
  seuilEnchainementJours: 1,
  // NUIT ENTRE DEUX CHANTIERS : à quelle distance du prochain chargement le PL a-t-il le droit de
  // dormir sur place au lieu de rentrer au dépôt ? (arbitrage Louis 2026-08-03, diag CHT-829278)
  // `seuilEnchainementJours` raisonnait en JOURS seuls : livraison mercredi 14h + chargement jeudi
  // = « enchaînement continu », donc retour dépôt supprimé — alors que le camion, VIDE, passait
  // la nuit à 82 km de sa base pour repartir le lendemain à 494 km de là. Une nuit dehors ne se
  // justifie que si le PL est DÉJÀ à pied d'œuvre : sous ce seuil il reste sur place (ou entame la
  // route), au-delà il rentre dormir au dépôt. Garde-fou complémentaire, non paramétrable : si le
  // dépôt est PLUS PRÈS que le prochain chargement, le PL rentre quoi qu'il arrive — rentrer ne
  // coûte alors presque rien et l'équipage dort chez lui.
  // 80 km = « le coin d'à côté », ~1 h de route. (Cette valeur reprenait l'ordre de grandeur de
  // `seuilProxMutuKm`, supprimé le 2026-08-19 : elle vit désormais sa vie, ce sont deux règles
  // sans rapport — l'une dit où le camion dort, l'autre disait quelles boucles se forment.)
  seuilResterSurPlaceKm: 80,
  // Attente non-productive maximale entre deux lots d'une boucle (en heures).
  // Mesure le temps où le PL attend sur site sans opération : hors route de liaison,
  // hors chargement, hors livraison. Par défaut ½J = 5.5h (amplitude 7h–18h).
  // 0 = connexions uniquement le même jour ; 11 = 1 jour d'écart accepté.
  ecartMaxH: 5.5,
  // Seuils du score qualitatif d'une proposition de boucle, en POURCENTAGE du trajet total évité
  // (arbitrage Louis 2026-07-29). L'échelle en kilomètres absolus qui existait ici jugeait une
  // boucle sur la distance parcourue plutôt que sur ce qu'elle fait gagner : deux déménagements
  // locaux dont la mise en boucle supprime 60 km sur 150 (40 % !) restaient « neutres », tandis
  // qu'une longue distance médiocre passait « excellente » en économisant 8 % de son trajet.
  // Une seule échelle dans tout l'outil — le nombre de km évités reste affiché à côté, mais ne
  // décide plus de la couleur.
  scoreExcellentPct: 30,
  scoreBonPct: 15,
  scorePossiblePct: 5,
  // ── LE CHANTIER DÉBORDE D'UNE JOURNÉE (arbitrage Louis 2026-07-31, lot 2) ──
  // Reliquat de travail (route et retour dépôt COMPRIS) au-dessous duquel un dernier jour de
  // mission est jugé « de trop » : la modale propose alors de le résorber (équipe, durées, ou
  // journée élargie). 3 h est calé sur la fin de journée réglable jusqu'à 21h, soit +3 h — un
  // reliquat de 3 h est donc exactement ce qu'un dépassement du soir peut absorber.
  // 0 = alerte désactivée.
  reliquatMaxH: 3,
  // `alerteNuitsMin` RETIRÉ (arbitrage Louis 2026-07-31). Le seuil pilotait une alerte au placement
  // dès la 1ʳᵉ nuit hors dépôt — supprimée : sur longue distance la nuit dehors est inévitable, et
  // l'interruption n'offrait aucun levier utile. L'information se lit désormais sur le Gantt, en
  // bas de chaque soirée concernée. Ne pas le réintroduire sans relire `utils/resserrage.js`.
  // ── DIAGNOSTIC MULTI-CAMION (arbitrage Louis 2026-07-29) ──────────────────
  // Le moteur n'évalue une boucle que sur LE camion où le lot partenaire est déjà posé. Quand ce
  // camion est la seule cause du rejet (capacité trop juste, PL déjà occupé), la boucle est perdue
  // en silence. Une seconde passe EN LECTURE SEULE rejoue alors la même évaluation sur les autres
  // camions du même dépôt et propose, quand l'un d'eux convient, de RÉAFFECTER le lot partenaire
  // sur ce camion pour récupérer la boucle (« boucles écartées »).
  // Jamais de réaffectation automatique : c'est une proposition, validée par l'agence opératrice
  // (retour) ou confirmée explicitement (mutualisation). Ces deux plafonds bornent le calcul :
  //   diagBouclePLMax  : camions alternatifs essayés par lot partenaire rejeté ;
  //   diagBoucleSimMax : simulations de diagnostic pour l'ensemble d'une recherche.
  // 0 sur l'un ou l'autre ⇒ diagnostic désactivé.
  diagBouclePLMax: 4,
  diagBoucleSimMax: 24,
  // Unique deadline pour toutes les todos "à verrouiller / confirmer / rappeler"
  // Règle d'application :
  //   - lot_callback (pas de PL dispo)                        → deadline = jour même
  //   - placed_unlocked (placement sans boucle ni lock)       → deadline = dateC - N jours
  //   - impact dates sur lot B' suite à boucle                → deadline = dateC_Anc' - N jours
  // Si la deadline calculée est dans le passé → ramenée au jour courant.
  deadlineVerrouillageJours: 15,
  // ── LE CODE COULEUR DES « BOUCLES PROPOSÉES » (G3.2, plan-dev-ux-v5.md § 6) ──────────────────
  // « Alerter si le planif de l'autre côté prend du temps à répondre. » Deux seuils, en JOURS
  // OUVRÉS écoulés depuis `_pendingBoucle.createdAt` (`diffWorkdays`, `utils/dates.js`) : sous le
  // premier, ton neutre ; entre les deux, `text-warning` ; à partir du second, `text-destructive`.
  // 🔴 A4 a été fermée sur ce principe même — « écrire le fait plutôt que le verdict » — la ligne
  // qui lit ces seuils doit toujours DIRE le nombre de jours, la couleur seule n'étant ni lisible
  // en niveaux de gris, ni vérifiable.
  seuilAttenteBoucleAlerteJours: 2,
  seuilAttenteBoucleCritiqueJours: 4,
};

// ── LECTURE DU SEUIL DE PROXIMITÉ RESTANT — POINT D'APPLICATION UNIQUE ───────────────────────
// Les règles sont PERSISTÉES en base (table `rules`). Une base créée avant le 2026-08-03 ne
// contient que l'ancienne clé unique `seuilProxKm: 80` : ce lecteur porte le repli, pour que le
// moteur, l'écran d'administration et les scripts d'analyse lisent tous EXACTEMENT la même valeur
// — au lieu de recopier le `??` à cinq endroits qui divergeraient au premier oubli.
//
// ⚠️ 2026-08-19 — CE LECTEUR NE FORME PLUS AUCUNE BOUCLE. Il ne sert qu'au RECHAÎNAGE PHYSIQUE
// (cf. le commentaire de la clé, plus haut) : le PL enchaîne-t-il en direct entre deux chantiers,
// ou rentre-t-il au dépôt ? Son sort est à statuer (Q21). Son jumeau `seuilProxMutu` a été
// SUPPRIMÉ avec la clé qu'il lisait — la mutualisation est bornée par G1 (`checkMutuZones`), pas
// par un rayon.
// (La fonction ne porte PAS le nom exact de la clé — `seuilProxRetour(rules)` lit
//  `rules.seuilProxRetourKm` — pour qu'on ne puisse jamais confondre « la clé » et « la lecture
//  avec repli » au premier coup d'œil dans le moteur.)
export function seuilProxRetour(rules = RULES_DEFAULTS) {
  return rules?.seuilProxRetourKm ?? rules?.seuilProxKm ?? 300;
}

// ── LECTURE DE LA PILE DE GARDE-FOUS ET DU SCORE — MÊME DISCIPLINE ────────────────────────────
// Cinq lecteurs, même raison d'être que les deux ci-dessus : les règles sont PERSISTÉES en base, et
// une base créée avant le 2026-08-14 ne connaît AUCUNE de ces clés. Sans repli explicite, le moteur
// lirait `undefined` — et un `undefined` dans une comparaison numérique ne refuse rien (`x > undefined`
// est toujours faux) : la pile serait silencieusement inactive sur toutes les bases existantes.
// Le repli renvoie donc ici la valeur de `RULES_DEFAULTS`, jamais rien d'autre.
//
// Comme plus haut, les fonctions ne portent pas le nom exact des clés : on ne doit jamais confondre
// « la clé » et « la lecture avec repli » d'un coup d'œil dans le moteur.
export function gardeDetourRetour(rules = RULES_DEFAULTS) {
  return rules?.gardeDetourRetourKm ?? 500;
}
export function gardeDetourMutu(rules = RULES_DEFAULTS) {
  return rules?.gardeDetourMutuKm ?? 500;
}
export function gardeRendement(rules = RULES_DEFAULTS) {
  return rules?.gardeRendementKmJ ?? 750;
}
// Booléen, donc `??` et non `||` : un `false` explicitement réglé en administration doit être lu
// comme un choix, pas retomber sur le défaut.
export function gardePlancherAbsurditeActif(rules = RULES_DEFAULTS) {
  return rules?.gardePlancherAbsurdite ?? false;
}
// λ et μ du score. Deux lecteurs distincts pour deux arbitrages distincts — cf. le commentaire de
// `scoreCoutJourCamionKm` : λ vaut aujourd'hui la même chose que `gardeRendement(rules)` mais ne
// s'en déduit PAS. Ne jamais remplacer l'un par l'autre.
export function coutJourCamion(rules = RULES_DEFAULTS) {
  return rules?.scoreCoutJourCamionKm ?? 750;
}
export function coutJourDecalage(rules = RULES_DEFAULTS) {
  return rules?.scoreCoutJourDecalageKm ?? 400;
}
// ν du score — coût d'un jour d'AVANCE de livraison, distinct de μ (coût du RETARD) depuis
// l'arbitrage Louis du 2026-08-18. Toujours ≤ μ dans les valeurs livrées, jamais imposé par le code.
export function coutJourAvance(rules = RULES_DEFAULTS) {
  return rules?.scoreCoutJourAvanceKm ?? 200;
}
// Les deux seuils du code couleur d'une boucle proposée (G3.2) — mêmes raisons de repli que les
// lecteurs ci-dessus : une base antérieure au 2026-09-08 ne connaît pas ces clés.
export function seuilAttenteBoucleAlerte(rules = RULES_DEFAULTS) {
  return rules?.seuilAttenteBoucleAlerteJours ?? 2;
}
export function seuilAttenteBoucleCritique(rules = RULES_DEFAULTS) {
  return rules?.seuilAttenteBoucleCritiqueJours ?? 4;
}

// ── NORMALISATION DES RÈGLES REÇUES DE LA BASE — à appliquer AVANT la fusion sur les défauts ──
// Piège trouvé le 2026-08-03, et c'est LE point qui rend la compatibilité réelle plutôt que
// théorique. Le chargement fait `{ ...RULES_DEFAULTS, ...reglesDeLaBase }` (pour qu'une règle
// ajoutée depuis reçoive sa valeur par défaut). Or ce simple étalement SUFFIT à tuer le repli
// ci-dessus : une base d'avant la scission n'a que `seuilProxKm`, donc `seuilProxRetourKm` arrive
// du DÉFAUT (300) et le `?? seuilProxKm` n'est jamais atteint. Le réglage de l'utilisateur serait
// donc silencieusement ignoré — exactement ce qu'on veut éviter.
//
// D'où cette fonction : elle TRADUIT l'ancienne clé avant que les défauts n'aient voix au
// chapitre. Elle ne touche à rien d'autre, et ne fait rien dès que la base connaît l'une des clés
// issues de la scission (base déjà migrée, ou réglée en admin). `seuilProxMutuKm` figure encore
// dans le test « déjà migrée » : la clé est supprimée du code, mais elle reste présente dans les
// bases existantes, et sa présence prouve tout autant que la migration a eu lieu.
export function normaliserSeuilsProx(rules) {
  if (!rules || typeof rules !== "object") return rules;
  const dejaMigre = rules.seuilProxRetourKm != null || rules.seuilProxMutuKm != null;
  if (dejaMigre || rules.seuilProxKm == null) return rules;
  // 2026-08-19 : `seuilProxMutuKm` a été supprimé (G1 couvre la mutualisation) — seule la clé
  // retour est encore alimentée. Une base d'avant la scission garde donc son réglage là où il
  // sert toujours : le rechaînage physique.
  return { ...rules, seuilProxRetourKm: rules.seuilProxKm };
}
