import { LOT_STATUS } from '../data/referentiels.js';

// ── LES LIENS DE BOUCLE D'UN DOSSIER — POINT DE LECTURE UNIQUE ───────────────────────────────────
//
// POURQUOI CE MODULE (M3P, étape ①, ADR 0010 du 2026-08-13).
//
// Aujourd'hui un dossier ne peut désigner qu'UN partenaire : `_boucleWith` est un champ scalaire.
// Ce n'est pas un oubli, c'est une impossibilité du modèle — et c'est la raison pour laquelle une
// tournée à trois, que le Gantt pose DÉJÀ correctement, ne rapporte aucun kilomètre au KPI : le
// dossier du milieu devrait désigner ses deux voisins, il n'en a pas la place.
//
// La cible est arrêtée (ADR 0010) : **la tournée est l'objet**. Les dossiers d'une même tournée
// partageront un identifiant, un rôle et un rang — la forme que `loop_members` porte déjà côté
// serveur. Et un même dossier pourra appartenir à TROIS boucles : sa mutualisation, le retour, et
// la mutualisation de l'autre bout, atteinte par ce retour :
//
//     D → chg A  chg B → liv B  liv A → chg C  chg D → liv D  liv C → D
//         └── mutu 1 ──┘└─ retour ─┘└── mutu 2 ──┘
//
// D'où la forme de ce module, qui n'est PAS « rendre le partenaire » :
//   • une LISTE, parce qu'il y en aura plusieurs ;
//   • chaque entrée TYPÉE, parce que « mutualisé avec » et « enchaîné derrière » n'autorisent pas
//     les mêmes choses. Sans le type, `plagesMutu` imposerait une plage horaire commune à un
//     dossier qui roule trois jours plus tard.
//
// ⚠️ CE MODULE NE CHANGE AUCUN COMPORTEMENT. Il lit exactement les mêmes champs qu'avant et rend
// donc, aujourd'hui, au plus UN partenaire. C'est un SAS : quand le modèle basculera sur la
// tournée, ces quelques fonctions seront les seules à changer — tous leurs appelants, eux, lisent
// déjà une liste. C'est ce qui rend l'étape ① sûre AVANT l'arbitrage, et pourquoi elle est
// identique quelle que soit l'architecture retenue.

// ⚠️ DEUX LECTURES DU MÊME LIEN, ET C'EST VOULU — état des lieux au 2026-08-13, conservé tel quel.
//
//   • la DÉCISION (`lienDecide`, cf. plus bas) ne lit que `_boucleWith`, le marqueur persistant posé
//     à l'acceptation. C'est lui qui commande le badge ★ et les kilomètres évités : élargir ce que
//     compte le KPI ne se fait pas par effet de bord d'un rangement ;
//   • l'AFFICHAGE et la plage horaire tolèrent en plus `_bouclePartnerId`, un résidu de certaines
//     propositions. C'était déjà la pratique de `plagesMutu` et de la fiche chantier.
//
// Ce module ne tranche pas cette asymétrie, il la rend VISIBLE en un seul endroit — c'était tout
// l'intérêt du sas. La trancher, si on le souhaite, sera une décision explicite.
function idPartenaireEcrit(lot) {
  return lot?._boucleWith || lot?._bouclePartnerId || null;
}

// ── LES LIENS D'UN LOT, SOUS LEUR FORME PORTÉE (tranche 4A, ADR 0010 étape ②) ────────────────────
//
// `_boucleLiens` — une LISTE de `{ avec, type, role, sequence, mutuRole, operatingAgency }`. C'est
// elle qui fait foi depuis 4A : un lot du milieu de tournée porte DEUX entrées, ce que le champ
// scalaire `_boucleWith` ne savait pas dire (« une impossibilité du modèle », cf. l'en-tête).
//
// ⚠️ LES CHAMPS SCALAIRES NE DISPARAISSENT PAS, ils deviennent le MIROIR du premier lien —
// écrit ici et nulle part ailleurs. C'est ce qui permet à 4A de ne casser personne : la
// projection serveur (`shred.py`), `roleDuLot`, `plagesMutu`, `detectBoucles` et les données
// DÉJÀ EN BASE continuent de lire ce qu'ils lisaient. Aucune migration : `lots.extra` est du
// JSONB, il porte une liste d'objets aussi bien qu'un scalaire (vérifié le 2026-09-04).
//
// 🔴 Conséquence connue et ASSUMÉE en 4A : sur un lot du milieu, le miroir ne peut refléter qu'UN
// des deux liens, donc `roleDuLot` (qui lit `_boucleType` au niveau du lot) rend le rôle du
// PREMIER. Le rôle par lien est le travail de 4B/4C, pas d'ici — 4A rend la tournée à trois
// REPRÉSENTABLE et SURVIVABLE, il ne la fait pas encore juger.
export function liensDuLot(lot) {
  if (!lot) return [];
  if (Array.isArray(lot._boucleLiens)) {
    return lot._boucleLiens.filter(l => l && l.avec);
  }
  // Repli sur la forme scalaire — un lot enregistré avant 4A, ou reçu d'une base ancienne.
  const avec = idPartenaireEcrit(lot);
  if (!avec || !lot._boucleType) return [];
  return [{
    avec,
    type: lot._boucleType,
    role: lot._boucleRole ?? null,
    sequence: lot._sequence ?? null,
    mutuRole: lot._mutuRole ?? null,
    operatingAgency: lot._operatingAgency ?? null,
    // L4-7 : le chiffre suit le lien, et le repli hérité le récupère depuis le champ de lot.
    // Sans cette ligne, réécrire un lien sur un lot enregistré avant 4A effacerait son gain.
    kmEco: typeof lot._boucleKmEco === "number" ? lot._boucleKmEco : null,
    // L'IMMOBILISATION suit le même chemin que le gain, et pour la même raison (cf. `ecrireLien`).
    rallongeJours: typeof lot._boucleRallongeJours === "number" ? lot._boucleRallongeJours : null,
  }];
}

// Le miroir scalaire, reconstruit à partir de la liste. `null` partout quand il ne reste rien :
// `undefined` laisserait le champ absent du diff et la valeur d'avant survivrait à la fusion.
function avecMiroir(lot, liens) {
  const premier = liens[0] || null;
  // ⚠️ `undefined` quand un lien existe mais ne porte pas le marqueur, `null` quand il n'y a PLUS
  // de lien du tout. Ce n'est pas une coquetterie : `undefined` disparaît du JSON envoyé (le
  // serveur voit une absence, ce que faisait déjà la désolidarisation), tandis que `null` est
  // transmis et EFFACE explicitement côté base — ce qu'on veut, et seulement ce qu'on veut, quand
  // on détache le dernier lien. Écrire `null` partout ferait dire à un lot mutualisé qu'il n'a
  // pas d'agence opératrice au lieu de ne rien en dire.
  const marqueur = (v) => (premier ? (v ?? undefined) : null);
  return {
    ...lot,
    _boucleLiens: liens.length ? liens : null,
    _boucleType: premier ? premier.type : null,
    _boucleWith: premier ? premier.avec : null,
    _boucleRole: marqueur(premier?.role),
    _sequence: marqueur(premier?.sequence),
    _mutuRole: marqueur(premier?.mutuRole),
    _operatingAgency: marqueur(premier?.operatingAgency),
    // L4-7 — le gain suit le LIEN, `_boucleKmEco` n'en est plus que le miroir. Sur une boucle à
    // deux, miroir et lien portent le même chiffre : rien ne bouge pour l'existant. Sur une
    // tournée à trois, le miroir ne peut refléter qu'UNE greffe — c'est `kmEcoTournee` qu'il faut
    // lire, et c'est la raison d'être de cette tranche.
    _boucleKmEco: marqueur(premier?.kmEco),
    // Même statut que `_boucleKmEco` : un MIROIR du premier lien, plus la valeur elle-même.
    _boucleRallongeJours: marqueur(premier?.rallongeJours),
    // `_bouclePartnerId` est un résidu de proposition, jamais une décision : il ne doit pas
    // ressusciter un lien qu'on vient de retirer.
    ...(liens.length ? {} : { _bouclePartnerId: null }),
  };
}

// ÉCRIRE UN LIEN — point d'écriture unique (le pendant de `partenairesDeBoucle`, qui lit).
// Rend un NOUVEAU lot ; ne mute rien. Un lien déjà présent vers `avec` est REMPLACÉ, jamais
// dupliqué : réaccepter une proposition ne doit pas doubler la tournée.
export function ecrireLien(lot, { avec, type, role = null, sequence = null, mutuRole = null, operatingAgency = null, kmEco = null, rallongeJours = null }) {
  if (!lot || !avec || !type) return lot;
  const tous = liensDuLot(lot);
  const ancien = tous.find(l => l.avec === avec) || null;
  // ⚠️ `kmEco` est la SEULE valeur qu'une réécriture ne remplace pas par du vide : c'est une
  // MESURE, pas un rôle. Taguer le second membre d'une paire (« ce lot est ton partenaire »)
  // n'apporte aucun chiffre, et effacer celui qui avait été retenu à la décision perdrait le gain
  // de la tournée en silence. Un appelant qui en fournit un l'emporte toujours.
  // ⚠️ `rallongeJours` est conservée exactement comme `kmEco`, et pour la même raison : c'est une
  // MESURE retenue à la décision, pas un rôle. Le défaut était le même que celui que L4-7 a réparé
  // sur le gain, laissé en place sur l'immobilisation — la greffe suivante l'écrasait, et la
  // lecture « le premier chiffre trouvé parmi les membres » rendait alors celle d'UNE greffe prise
  // au hasard de l'ordre des membres.
  const lien = { avec, type, role, sequence, mutuRole, operatingAgency,
    kmEco: kmEco ?? ancien?.kmEco ?? null,
    rallongeJours: rallongeJours ?? ancien?.rallongeJours ?? null };
  const autres = tous.filter(l => l.avec !== avec);
  return avecMiroir(lot, [...autres, lien]);
}

// RETIRER UN SEUL LIEN — la règle C5 : « retirer un membre ne casse que ses propres liens ».
// 🔴 C'est le geste que 4A existe pour rendre possible. Avant, `handleDeleteLot` remettait à
// `null` TOUS les champs `_boucle*` du partenaire : sur un lot du milieu, retirer un voisin
// effaçait aussi le lien vers l'autre, et la tournée restante devenait muette.
export function retirerLien(lot, avec) {
  if (!lot || !avec) return lot;
  return avecMiroir(lot, liensDuLot(lot).filter(l => l.avec !== avec));
}

// RETIRER TOUS LES LIENS D'UN LOT — le geste « RETIRER UN MEMBRE D'UNE TOURNÉE » (C5, U6).
// 🔴 À ne pas confondre avec `romprLien` ci-dessous, et la nuance est toute la règle C5 : ici c'est
// le lot LUI-MÊME qui quitte le voyage, donc tous SES liens tombent — mais uniquement les siens,
// ceux qui subsistent entre les autres membres ne sont pas touchés.
export function retirerTousLiens(lot) {
  if (!lot) return lot;
  return avecMiroir(lot, []);
}

// ROMPRE UN SEUL LIEN, DES DEUX CÔTÉS — « ces deux lots ne voyagent plus ensemble ».
//
// 🔴 CE QUE CETTE FONCTION RÉPARE (tranche 4E). La désolidarisation d'une mutualisation appelait
// `retirerTousLiens` sur CHACUN des deux lots. Tant qu'un lot ne pouvait porter qu'un lien, les
// deux gestes étaient indiscernables. Depuis 4A ils ne le sont plus : sur une tournée à trois,
// l'ancre porte la mutualisation ET le retour — rompre la mutualisation effaçait donc AUSSI le
// retour, en silence, et laissait l'accroché pointer vers un partenaire qui ne le désignait plus.
// C'est exactement ce que C5 interdit (« on ne casse que ses propres liens, jamais ceux des
// autres ») et ce que C3 interdit (« défaire un maillon ne défait jamais le précédent »).
//
// Sur une boucle à DEUX, le résultat est identique à l'ancien comportement — il ne reste rien à
// retirer d'autre. C'est ce qui rend la correction sans risque pour l'existant.
export function romprLien(lots, unId, deuxId) {
  if (!Array.isArray(lots) || !unId || !deuxId || unId === deuxId) return lots;
  return lots.map(l => {
    if (l?.id === unId) return retirerLien(l, deuxId);
    if (l?.id === deuxId) return retirerLien(l, unId);
    return l;
  });
}

// LE LIEN QUI VAUT DÉCISION — prédicat strict, inchangé depuis l'arbitrage Louis 2026-08-03.
// On exige un lien NOMMÉ vers l'autre dossier (pas seulement un `_boucleType` quelconque, qui
// pourrait venir d'une boucle formée avec un TROISIÈME dossier), dans un sens ou dans l'autre.
//
// 🔴 4A — LA STRICTESSE EST CONSERVÉE, MAIS ELLE SAIT COMPTER JUSQU'À TROIS. `_boucleLiens` n'est
// écrit QUE par `ecrireLien`, c'est-à-dire à une décision : le lire ne relâche donc rien. Le repli
// scalaire, lui, reste volontairement sur `_boucleWith` SEUL — jamais `idPartenaireEcrit`, qui
// tolère en plus `_bouclePartnerId`, un résidu de PROPOSITION. Élargir ce que compte le KPI ne se
// fait pas par effet de bord d'un rangement (c'était déjà écrit ici, ça le reste).
export function lienDecide(lotUn, lotDeux) {
  if (!lotUn || !lotDeux) return false;
  const pointeVers = (a, b) => (Array.isArray(a._boucleLiens)
    ? a._boucleLiens.some(l => l && l.avec === b.id && !!l.type)
    : (!!a._boucleType && a._boucleWith === b.id));
  return pointeVers(lotUn, lotDeux) || pointeVers(lotDeux, lotUn);
}

// LES LIENS DE BOUCLE D'UN DOSSIER, sous forme de liste typée.
//
// Chaque entrée : { lot, type, role }
//   lot  — le dossier partenaire, résolu dans `lots`
//   type — "mutualisation" (chargés ensemble, même journée) | "retour" (enchaîné derrière)
//   role — le rôle du PARTENAIRE dans le lien : "ancre" | "accroche" | null si indéterminable
//
// Le lien suffit dans UN SEUL SENS : un retour tague l'accroché à la création du dossier et l'ancre
// seulement à l'acceptation — entre les deux, un seul côté porte la référence (cf. `boucleDecidee`).
// On regarde donc les deux directions.
export function partenairesDeBoucle(lot, lots) {
  if (!lot) return [];
  const tous = lots || [];
  const trouves = new Map(); // par id — un même dossier ne figure jamais deux fois

  const ajouter = (autre, type, role) => {
    if (!autre || autre.id === lot.id || trouves.has(autre.id)) return;
    trouves.set(autre.id, { lot: autre, type: type || null, role: role || null });
  };

  // Sens 1 — ce lot désigne quelqu'un. Depuis 4A c'est une LISTE : un lot du milieu en désigne
  // deux, et les deux doivent sortir (sans quoi la tournée à trois reste invisible au KPI).
  liensDuLot(lot).forEach(lien => {
    ajouter(tous.find(l => l.id === lien.avec), lien.type, roleDuPartenaire(lot, false, lien));
  });
  // Sens 2 — quelqu'un désigne ce lot.
  tous.forEach(autre => {
    if (autre.id === lot.id) return;
    liensDuLot(autre)
      .filter(lien => lien.avec === lot.id)
      .forEach(lien => ajouter(autre, lien.type, roleDuPartenaire(autre, true, lien)));
  });

  return [...trouves.values()];
}

// LE RÔLE DE CE DOSSIER — point de lecture unique (lot 6, `plan-dev-ux-v3.md` § 10.1).
// → "seul" (hors boucle) | "ancre" | "accroche"
//
// Extrait de `LotDetailSheet.jsx` (2026-08-04, `jeSuisAccroche`) et NON réinventé : deux sources
// selon le type de boucle —
//   • mutualisation : `_mutuRole` ("initiateur" = accroché, "partenaire" = ancre) ;
//   • retour : seul l'accroché reçoit `_boucleRole`/`_operatingAgency` (posés à l'acceptation,
//     `OneFleet.jsx`) — l'ancre est le lot propre de l'agence opératrice, laissé vierge.
//
// Gardé par `partenairesDeBoucle(lot, lots).length > 0` : un `_boucleType` sans partenaire
// RÉSOLU dans `lots` (dossier retiré de la vue filtrée, lien devenu orphelin après une
// désolidarisation…) rend "seul" plutôt qu'une couleur de rôle sans rien pour la justifier —
// c'est la seule chose que ce module ajoute à la dérivation d'origine, exactement dans son
// esprit (« la qualification suit la DÉCISION, pas l'adjacence », CLAUDE.md).
export function roleDuLot(lot, lots) {
  if (!lot || !lot._boucleType || partenairesDeBoucle(lot, lots).length === 0) return "seul";
  const jeSuisAccroche = lot._boucleType === "mutualisation"
    ? lot._mutuRole !== "partenaire"
    : !!(lot._boucleRole || lot._operatingAgency);
  return jeSuisAccroche ? "accroche" : "ancre";
}

// LES RÔLES D'UN LOT, UN PAR LIEN (U3, tranche 4F).
//
// 🔴 CE QUE `roleDuLot` NE SAIT PAS DIRE, ET POURQUOI CE N'EST PAS UN OUBLI. Il rend UN rôle, lu
// sur les champs de niveau lot — qui ne sont depuis 4A que le miroir du PREMIER lien. Sur une
// boucle à deux c'est exact : un lot n'a qu'un voisin, donc qu'un rôle. Sur une tournée à trois,
// le lot du MILIEU en tient deux : il est l'ancre de la greffe qu'il porte et l'accroché de celle
// qui le porte. Le miroir ne peut en refléter qu'un, et l'écran affichait donc la moitié de ce que
// le lot est.
//
// Rend une entrée PAR LIEN — `{ partenaire, type, role }`, `role` étant "ancre" | "accroche" |
// null quand rien ne l'écrit. Un lot sans lien rend `[]` : c'est un lot seul, et « seul » n'est
// pas un rôle qu'on tient dans un voyage, c'est l'absence de voyage.
//
// ⚠️ La qualification suit la DÉCISION, jamais l'adjacence (CLAUDE.md) : le rôle se lit sur les
// marqueurs écrits à l'acceptation, jamais sur la position des blocs sur le Gantt.
//   • mutualisation — `mutuRole` du lien : "initiateur" = accroché, "partenaire" = ancre ;
//   • retour — seul l'accroché reçoit `role`/`operatingAgency` (posés à l'acceptation,
//     `handleTodoAction`) ; l'ancre est le lot propre de l'agence opératrice, laissé vierge.
// C'est exactement la dérivation de `roleDuLot`, lue sur LE LIEN au lieu du lot.
export function rolesDuLot(lot, lots) {
  if (!lot) return [];
  const tous = lots || [];
  // On repart de `partenairesDeBoucle` — le point de lecture unique — pour hériter de ses deux
  // sens (un retour ne tague l'ancre qu'à l'acceptation) et de sa garde : un lien dont le
  // partenaire n'est pas RÉSOLU dans `lots` ne donne pas un rôle sans rien pour le justifier.
  return partenairesDeBoucle(lot, tous).map(({ lot: partenaire, type }) => {
    // ⚠️ Le `mutuRole` est lu SUR LE LIEN, pas sur le miroir de lot. À trois lots les deux
    // lectures s'accordent toujours (chaque lien a une extrémité, dont le miroir est exact) et
    // aucun test ne les distingue — c'est écrit en tête de `rolesDuLot.test.js`. On garde
    // celle-ci parce qu'elle ne dépend pas de la forme « chaîne de trois », rien de plus.
    const monLien = liensDuLot(lot).find(l => l.avec === partenaire.id) || null;
    const sonLien = liensDuLot(partenaire).find(l => l.avec === lot.id) || null;
    let role = null;
    if (type === "mutualisation") {
      const mien = monLien?.mutuRole ?? (monLien ? null : lot._mutuRole);
      const sien = sonLien?.mutuRole ?? (sonLien ? null : partenaire._mutuRole);
      if (mien === "initiateur" || sien === "partenaire") role = "accroche";
      else if (mien === "partenaire" || sien === "initiateur") role = "ancre";
    } else if (type === "retour") {
      const porteLesMarqueurs = (l, lien) => (lien
        ? !!(lien.role || lien.operatingAgency)
        : !!(l._boucleRole || l._operatingAgency));
      if (porteLesMarqueurs(lot, monLien)) role = "accroche";
      else if (porteLesMarqueurs(partenaire, sonLien)) role = "ancre";
    }
    return { partenaire, type, role };
  });
}

// LA TOURNÉE À LAQUELLE UN LOT APPARTIENT — ses membres, dans l'ordre où le parcours les atteint.
// Rend `[]` pour un lot seul (jamais `[lot]`) : la même convention que `tourneesDeBoucles`, où un
// dossier sans lien n'est pas une tournée d'un seul membre.
export function tourneeDuLot(lot, lots) {
  if (!lot) return [];
  const t = tourneesDeBoucles(lots || []).find(x => x.membres.some(m => m.id === lot.id));
  return t ? t.membres : [];
}

// Le rôle tenu par le PARTENAIRE, déduit des marqueurs de mutualisation (`_mutuRole` : le dossier
// qui porte "initiateur" est l'accroché, celui qui porte "partenaire" est l'ancre — cf.
// `reflowVehicle`). Hors mutualisation le rôle n'est pas écrit : on rend null plutôt que de le
// deviner à la position, piège n°1 du dossier (cf. CLAUDE.md, « Piège historique »).
function roleDuPartenaire(porteurDuLien, lienInverse = false, lien = null) {
  // Depuis 4A le type et le `mutuRole` se lisent sur LE LIEN quand il est fourni : sur un lot du
  // milieu, les champs de niveau lot ne reflètent que le premier des deux (cf. `avecMiroir`).
  const type = lien ? lien.type : porteurDuLien._boucleType;
  if (type !== "mutualisation") return null;
  const roleDuPorteur = lien ? lien.mutuRole : porteurDuLien._mutuRole;
  if (roleDuPorteur !== "initiateur" && roleDuPorteur !== "partenaire") return null;
  const rolePorteur = roleDuPorteur === "initiateur" ? "accroche" : "ancre";
  const roleAutre = rolePorteur === "accroche" ? "ancre" : "accroche";
  return lienInverse ? rolePorteur : roleAutre;
}

// LES DOSSIERS CHARGÉS AVEC CELUI-CI — ceux qui partagent le camion ET la journée.
// Réservé à la mutualisation : dans une boucle RETOUR l'accroché charge APRÈS la livraison de
// l'ancre, les deux ne se partagent aucune journée de travail.
export function partenairesMutu(lot, lots) {
  return partenairesDeBoucle(lot, lots).filter(p => p.type === "mutualisation");
}

// LES PAIRES MUTUALISÉES d'un ensemble de dossiers — { lotAcc, lotAnc, sequence }.
// Extrait de `reflowVehicle` (2026-08-13) pour que la POSE et la DÉTECTION DE BOUCLES lisent la
// même chose : `detectBoucles` avait besoin de savoir « ces deux dossiers voyagent ensemble » et ne
// le savait pas — c'est exactement l'anomalie α.
//
// Rôles (audit 2026-07-19, B2) : l'accroché est le dossier DÉCLENCHEUR de la mutualisation,
// l'ancre le partenaire déjà placé — même sémantique que `findBoucleCandidates` (S1 = l'ancre
// charge en premier, S2 = l'accroché charge en premier). Le rôle est porté par `_mutuRole` depuis
// l'acceptation ; sans lui, repli sur l'ordre d'apparition, comme avant.
export function pairesMutu(lots) {
  const traites = new Set();
  const paires = [];
  (lots || []).forEach(l => {
    if (traites.has(l.id)) return;
    // 4A — le filtre porte sur LE LIEN, plus sur `_boucleType` au niveau du lot. Un lot du milieu
    // de tournée porte un lien mutualisation ET un lien retour : son miroir scalaire ne peut en
    // refléter qu'un, et l'ancien test l'écartait donc une fois sur deux — soit exactement
    // l'anomalie α (« une paire mutualisée est insécable ») qui reviendrait à trois lots.
    if (!liensDuLot(l).some(x => x.type === "mutualisation")) return;
    const partenaire = partenairesMutu(l, lots)
      .map(p => p.lot)
      .find(p => !traites.has(p.id));
    if (!partenaire) return;
    // L'ordre S1/S2 et le rôle sont lus SUR LE LIEN quand il existe (même raison), avec repli sur
    // les champs de niveau lot pour les données d'avant 4A.
    const monLien = liensDuLot(l).find(x => x.avec === partenaire.id) || null;
    const sonLien = liensDuLot(partenaire).find(x => x.avec === l.id) || null;
    const sequence = monLien?.sequence || sonLien?.sequence || l._sequence || partenaire._sequence || "S2";
    const monRole = monLien?.mutuRole ?? l._mutuRole;
    const sonRole = sonLien?.mutuRole ?? partenaire._mutuRole;
    let lotAcc = l, lotAnc = partenaire;
    if (monRole === "partenaire" || sonRole === "initiateur") {
      lotAcc = partenaire; lotAnc = l;
    }
    paires.push({ lotAcc, lotAnc, sequence });
    traites.add(l.id);
    traites.add(partenaire.id);
  });
  return paires;
}

// LES DOSSIERS QUI VOYAGENT ENSEMBLE, vus depuis un identifiant — l'unité insécable d'une tournée.
// Rend toujours au moins `[lotId]`. Utilisé par `detectBoucles` pour ne jamais rebâtir un membre de
// paire tout seul (α), et par la pose pour traiter la paire d'un bloc.
export function membresDuGroupeMutu(lotId, lots) {
  const lot = (lots || []).find(l => l.id === lotId);
  if (!lot) return [lotId];
  return [lotId, ...partenairesMutu(lot, lots).map(p => p.lot.id)];
}

// ── LES TOURNÉES — REGROUPER LES BOUCLES QUI PARTAGENT UN DOSSIER (Lot 2, 2026-08-18) ────────────
//
// Une BOUCLE relie deux dossiers. Une TOURNÉE en relie autant qu'il en tient sur le voyage : la
// mutualisation à l'aller, l'accroche retour derrière. Jusqu'ici on ne savait compter que des
// paires — l'écran affichait donc DEUX boucles là où le camion ne fait qu'UN voyage, et personne ne
// pouvait répondre à la question posée : « combien de doubles couplages faisons-nous déjà, et que
// rapportent-ils ? »
//
// Cette fonction regroupe les liens : deux liens qui partagent un dossier appartiennent au même
// voyage. C'est un parcours de proche en proche, sans autre subtilité.
//
// ⚠️ ELLE NE DÉCIDE RIEN et ne lit aucun bloc posé : elle regroupe ce que les liens disent déjà.
// Un dossier sans lien n'apparaît dans AUCUNE tournée — il n'est pas une tournée d'un seul membre,
// et le compter comme telle gonflerait le dénominateur de tous les indicateurs.
//
// ⚠️ ELLE NE VÉRIFIE PAS que les dossiers partagent un camion. Aujourd'hui c'est équivalent : un
// lien de boucle n'existe qu'entre dossiers d'un même voyage. Si cela cessait d'être vrai, c'est
// ICI qu'il faudrait ajouter la vérification, et nulle part ailleurs.
//
// Rend, pour chaque tournée :
//   membres            — les dossiers, dans l'ordre où le parcours les atteint
//   liens              — [{ a, b, type }], a/b étant des ids triés (stables d'un appel à l'autre)
//   types              — les types de lien présents, dédoublonnés
//   estDoubleCouplage  — une mutualisation ET une accroche retour sur le même voyage
// ── LE GAIN D'UNE TOURNÉE — LA SOMME DE SES GREFFES (L4-7, arbitré le 2026-09-04) ────────────────
//
// AVANT : le gain était un champ DE LOT (`_boucleKmEco`), et tout le monde lisait « le premier
// marqueur non nul trouvé parmi les membres ». Sur une boucle à deux c'est exact — il n'y a qu'une
// greffe, donc qu'un chiffre. Sur une tournée à TROIS, ce n'était plus le gain du voyage : c'était
// celui d'une greffe prise au hasard de l'ordre des membres, l'autre passant à la trappe.
//
// DEPUIS : le gain suit le LIEN, comme tout le reste depuis 4A, et le total d'une tournée est la
// SOMME de ses greffes. C'est cohérent avec la façon dont la tournée se construit — « en deux
// temps, une paire puis l'autre » (règle C2) —, chaque greffe ayant sa mesure propre, et les deux
// gains restant DISJOINTS (celui de la mutualisation ne recouvre pas celui du retour : cf. le
// commentaire de `detectBoucles`, « la référence est la tournée déjà acquise »).
//
// 🔴 CE QUI NE BOUGE PAS POUR L'EXISTANT. Une boucle à deux crantée avant ce jour n'a pas de lien
// porteur : le repli rend exactement le chiffre qu'elle rendait hier. Une boucle à deux crantée
// depuis porte le même chiffre sur son lien ET sur son miroir `_boucleKmEco`. Aucun historique de
// KPI ne change de valeur.
//
// Un membre dont la greffe n'a pas été chiffrée (boucle ancienne, chaîne non exploitable) ne
// contribue rien : on additionne ce qu'on sait, on ne devine pas. `null` quand on ne sait RIEN —
// jamais `0`, qui dirait « cette tournée ne fait économiser aucun kilomètre ».
export function kmEcoTournee(membres) {
  const presents = (membres || []).filter(Boolean);
  // 🔑 On ne compte QUE les greffes INTERNES à l'ensemble reçu. Sans cette borne, demander le gain
  // d'une paire dont un membre est aussi le milieu d'une tournée à trois y ajouterait la greffe du
  // troisième — un total juste, mais répondant à une autre question que celle posée.
  const dansLEnsemble = new Set(presents.map(l => l.id));
  const parPaire = new Map();
  presents.forEach(lot => {
    liensDuLot(lot).filter(l => dansLEnsemble.has(l.avec)).forEach(lien => {
      // La clé est la PAIRE, pas le sens : les deux membres portent le même lien, et le chiffre
      // n'est souvent écrit que d'un côté (celui qui a décidé). On garde le premier non nul.
      const cle = [lot.id, lien.avec].sort().join("|");
      if (typeof lien.kmEco === "number" && parPaire.get(cle) == null) parPaire.set(cle, lien.kmEco);
      else if (!parPaire.has(cle)) parPaire.set(cle, null);
    });
  });
  const chiffres = [...parPaire.values()].filter(v => typeof v === "number");
  if (chiffres.length) return chiffres.reduce((s, v) => s + v, 0);
  // Repli hérité : un lot enregistré avant L4-7 ne porte le gain que sur lui-même.
  const legacy = presents.find(l => typeof l._boucleKmEco === "number");
  return legacy ? legacy._boucleKmEco : null;
}

// L'IMMOBILISATION D'UNE TOURNÉE — la somme de ses greffes, exactement comme le gain.
//
// Le raisonnement de L4-7 vaut mot pour mot : chaque greffe est mesurée contre la tournée DÉJÀ
// ACQUISE (cf. `detectBoucles`), donc les deux rallonges sont disjointes et s'additionnent. Ce qui
// change ici, c'est seulement qu'on ne l'avait pas fait pour ce chiffre-là.
//
// `null` quand on ne sait RIEN — jamais `0`, qui dirait « cette tournée n'immobilise pas le camion
// plus longtemps ». Même borne que `kmEcoTournee` : on ne compte que les liens INTERNES à
// l'ensemble reçu.
export function rallongeTournee(membres) {
  const presents = (membres || []).filter(Boolean);
  const dansLEnsemble = new Set(presents.map(l => l.id));
  const parPaire = new Map();
  presents.forEach(lot => {
    liensDuLot(lot).filter(l => dansLEnsemble.has(l.avec)).forEach(lien => {
      const cle = [lot.id, lien.avec].sort().join("|");
      if (typeof lien.rallongeJours === "number" && parPaire.get(cle) == null) parPaire.set(cle, lien.rallongeJours);
      else if (!parPaire.has(cle)) parPaire.set(cle, null);
    });
  });
  const chiffres = [...parPaire.values()].filter(v => typeof v === "number");
  if (chiffres.length) return chiffres.reduce((s, v) => s + v, 0);
  const legacy = presents.find(l => typeof l._boucleRallongeJours === "number");
  return legacy ? legacy._boucleRallongeJours : null;
}

export function tourneesDeBoucles(lots) {
  const tous = lots || [];
  const parId = new Map(tous.map(l => [l.id, l]));
  const vus = new Set();
  const tournees = [];

  tous.forEach(depart => {
    if (vus.has(depart.id)) return;
    if (partenairesDeBoucle(depart, tous).length === 0) return;

    const membres = [];
    const liens = new Map();
    const aVoir = [depart.id];
    while (aVoir.length) {
      const id = aVoir.shift();
      if (vus.has(id)) continue;
      vus.add(id);
      const lot = parId.get(id);
      if (!lot) continue;
      membres.push(lot);
      partenairesDeBoucle(lot, tous).forEach(({ lot: autre, type }) => {
        const paire = [id, autre.id].sort();
        const cle = paire.join("");
        if (!liens.has(cle)) liens.set(cle, { a: paire[0], b: paire[1], type });
        if (!vus.has(autre.id)) aVoir.push(autre.id);
      });
    }

    const types = [...new Set([...liens.values()].map(l => l.type).filter(Boolean))];
    tournees.push({
      membres,
      liens: [...liens.values()],
      types,
      estDoubleCouplage: types.includes("mutualisation") && types.includes("retour"),
    });
  });

  return tournees;
}

// ── LES MAILLONS EN VOL — UNE PROPOSITION RETIENT SON SIÈGE (règle C2, tranche 4E) ───────────────
//
// 🔴 CE QUE CETTE FONCTION RÉPARE, ET POURQUOI ELLE EST ICI PLUTÔT QUE DANS LE MOTEUR.
//
// La règle C2 dit qu'une tournée à trois se construit EN DEUX TEMPS : une paire, puis l'autre —
// « jamais les deux d'un même geste », précisément pour qu'on puisse n'accepter que la moitié.
// Entre les deux temps, il existe un état que rien ne comptait : la proposition ENVOYÉE et PAS
// ENCORE RÉPONDUE (`_pendingBoucle`, le retour qui attend l'accord de l'agence opératrice).
//
// Or la borne C1 (« au plus trois lots ») se lit sur `tourneesDeBoucles`, qui ne connaît que les
// liens DÉCIDÉS. Un maillon en vol n'écrit aucun lien : la tournée qu'il vise se présentait donc à
// la recherche suivante comme si elle avait encore de la place. Une paire A+B avec un retour X en
// attente restait une tournée de DEUX membres — le moteur proposait un second retour Y, et si les
// deux agences répondaient oui, le voyage finissait à QUATRE lots. La borne dure de C1 se
// contournait par le seul fait d'attendre.
//
// Ce module est le bon endroit parce que la question posée est « qui voyage avec qui », la même
// que `tourneesDeBoucles` — et qu'elle doit avoir UNE seule réponse.
//
// ⚠️ CE N'EST PAS UNE DÉCISION, et le distinguo est exactement celui que `lienDecide` défend depuis
// l'arbitrage du 2026-08-03 : une proposition en vol ne vaut ni badge ★, ni kilomètre au KPI, ni
// rôle affiché. Elle retient un SIÈGE, rien de plus. C'est pour cela qu'elle vit dans une fonction
// à part, jamais dans `liensDuLot` : y verser le résidu de proposition ferait entrer une intention
// dans tout ce qui lit les liens.
export function maillonsEnVol(lots) {
  return (lots || [])
    .filter(l => l && l._pendingBoucle)
    .map(l => {
      const snap = l._pendingBoucle.chosenSnapshot || {};
      return {
        accrocheId: l.id,
        ancreId: snap.partnerLot?.id || l._pendingBoucle.partnerLotId || null,
        // Le type de la greffe proposée. `_pendingBoucle` ne naît aujourd'hui que d'un RETOUR (une
        // mutualisation se pose sans attendre personne, cf. `handleSuggestionPlace`) — le repli le
        // dit plutôt que de laisser un type vide traverser les gardes d'orientation.
        type: snap.type || "retour",
      };
    })
    .filter(m => m.ancreId);
}

// LES MAILLONS EN VOL QUI VISENT UNE TOURNÉE DONNÉE.
//
// `membresIds` : les membres décidés (au minimum le lot ancre lui-même, s'il voyage seul).
// `sauf` écarte une proposition précise — celle du lot qu'on est en train de replacer : sans elle,
// un dossier qui repasse par l'écran de proposition compterait contre lui-même.
export function maillonsEnVolVers(membresIds, lots, { sauf = null } = {}) {
  const dedans = new Set(membresIds || []);
  return maillonsEnVol(lots).filter(m =>
    m.accrocheId !== sauf && dedans.has(m.ancreId) && !dedans.has(m.accrocheId));
}

// REFUSER LE MAILLON EN VOL — « le refus d'un maillon ne défait jamais le précédent » (C3).
//
// 🔴 POURQUOI CE GESTE EST UNE FONCTION, et pas trois lignes dans le handler. Il tenait
// STRUCTURELLEMENT (la branche de refus de `handleTodoAction` ne touchait que l'accroché) mais
// rien ne le gardait : c'était une dette relevée à la fin de 4E, et le seul chemin pour la solder
// est celui déjà employé deux fois sur ce chantier — sortir le geste du hub et l'éprouver ici.
//
// Ce qu'il fait : le lot proposé redevient un lot posé et libre, sa proposition disparaît.
// Ce qu'il NE fait PAS, et c'est toute la règle : il ne touche AUCUN lien, ni sur l'accroché, ni
// sur l'ancre, ni sur le troisième membre. Sur une tournée à trois, refuser la greffe laisse la
// paire liée ET posée — c'est la moitié qu'on avait le droit de n'accepter qu'à moitié (C2).
export function refuserMaillonEnVol(lots, accrocheId) {
  if (!Array.isArray(lots) || !accrocheId) return lots;
  return lots.map(l => (l?.id === accrocheId
    ? { ...l, _pendingBoucle: undefined, status: LOT_STATUS.PLACED_UNLOCKED, _locked: false }
    : l));
}
