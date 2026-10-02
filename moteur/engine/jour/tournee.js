// ── LE CŒUR : ÉVALUER UNE TOURNÉE À JOURS IMPOSÉS ──────────────────────────────────────────────
//
// Le prototype des essais CHOISIT les jours (tout au plus tôt). Ici c'est l'inverse : le module
// REÇOIT une tournée — un camion, des lots, un ordre d'arrêts, et pour chaque opération une date
// imposée ou libre — et rend un verdict à niveaux plus des chiffres. Il ne déplace jamais une date
// imposée. Il remplit les dates libres, et c'est tout ce qu'il « décide ».
//
// « Proposé = posé » tient PAR CONSTRUCTION : le remplissage se termine toujours par une passe où
// toutes les fenêtres valent [jour, jour]. Imposer ce que le module vient de proposer, c'est donc
// rejouer exactement cette dernière passe.

import {
  isoDeJour, jourOuvre, jourOuvreOuSuivant, jourOuvreOuPrecedent, jourDe, jourFinDe,
  semaineDe, EPS, estFerme, fermesEntre, ecartOuvre,
} from "./calendrier.js";
import { nomFerie } from "./feries.js";
import {
  contexte, etatInitial, pas, cloturer, evaluerSequence,
  kmEntre, kmLotSeul, kmSequence,
} from "./passe.js";
import { fusionnerReglages, reglesMoteur } from "./reglages.js";
import { structureTournee, g1Tournee, g2g5Tournee } from "./gardes.js";
import { extrasArretBloc } from "./transbo.js";
import { cpConnu } from "../../data/gps.js";

// ── NIVEAUX ────────────────────────────────────────────────────────────────────────────────────
const RANG = { ok: 0, info: 1, orange: 2, rouge: 3, refus: 4 };
const pire = (a, b) => (RANG[b] > RANG[a] ? b : a);

// ── DIRE LES CHOSES EN FRANÇAIS ────────────────────────────────────────────────────────────────
// Un chargement est masculin, une livraison est féminine : sans cette table on écrit « Le livraison
// ne peut pas être tenu », et un planificateur cesse de lire les messages qu'on lui adresse.
// `e` porte l'accord des participes (tenu/tenue, fixé/fixée, confirmé/confirmée).
const OPS = {
  CHG: { def: "Le", ind: "le", au: "au", nom: "chargement", son: "son", e: "" },
  LIV: { def: "La", ind: "la", au: "à la", nom: "livraison", son: "sa", e: "e" },
};
const NOM_OP = { CHG: "chargement", LIV: "livraison" };
// « Le chargement du lot MARTIN » / « la livraison du lot MARTIN ».
const opDuLot = (type, nom, maj = true) => `${maj ? OPS[type].def : OPS[type].ind} ${OPS[type].nom} du lot ${nom}`;
const acc = (type) => OPS[type].e;

// Une date pour l'écran : « lun. 19/10 ». Le jour de la semaine se calcule à partir de l'ISO seul —
// aucune horloge, le module reste déterministe.
const JOURS_SEM = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const jfr = (iso) => {
  if (!iso) return "sans date";
  const [y, m, d] = String(iso).split("-");
  const sem = JOURS_SEM[new Date(Date.UTC(+y, +m - 1, +d)).getUTCDay()];
  return `${sem} ${d}/${m}`;
};

// ── VALIDATION ET MISE EN FORME DE L'ENTRÉE ────────────────────────────────────────────────────
// Rend { ops, lots, erreurs } ; `ops` suit l'ordre de la tournée, une entrée par arrêt.
function preparer(entree) {
  const erreurs = [];
  const lots = new Map();
  for (const l of entree.lots || []) {
    if (lots.has(l.id)) erreurs.push({ code: "ORDRE_INVALIDE", message: `Le lot ${l.nom || l.id} figure deux fois dans la tournée.` });
    lots.set(l.id, l);
  }

  const ordre = entree.ordre || [];
  const vus = new Map();   // lotId → { CHG: index, LIV: index }
  for (let i = 0; i < ordre.length; i++) {
    const a = ordre[i];
    if (!lots.has(a.lot)) {
      erreurs.push({ code: "ORDRE_INVALIDE", lot: a.lot, type: a.type, message: `L'arrêt n° ${i + 1} désigne un lot absent de la tournée.` });
      continue;
    }
    if (a.type !== "CHG" && a.type !== "LIV") {
      erreurs.push({ code: "ORDRE_INVALIDE", lot: a.lot, message: `L'arrêt n° ${i + 1} n'est ni un chargement ni une livraison.` });
      continue;
    }
    const v = vus.get(a.lot) || {};
    if (v[a.type] !== undefined) {
      erreurs.push({ code: "ORDRE_INVALIDE", lot: a.lot, type: a.type, message: `${opDuLot(a.type, lots.get(a.lot).nom || a.lot)} figure deux fois.` });
      continue;
    }
    v[a.type] = i;
    vus.set(a.lot, v);
  }
  for (const [id, l] of lots) {
    const v = vus.get(id) || {};
    const nom = l.nom || id;
    if (v.CHG === undefined || v.LIV === undefined) {
      erreurs.push({ code: "ORDRE_INVALIDE", lot: id, message: `Le lot ${nom} est incomplet : il lui manque ${v.CHG === undefined ? "son chargement" : "sa livraison"}.` });
    } else if (v.LIV < v.CHG) {
      erreurs.push({ code: "ORDRE_INVALIDE", lot: id, type: "LIV", message: `Le lot ${nom} est livré avant d'être chargé.` });
    }
  }
  if (erreurs.length) return { erreurs };

  // Fenêtres : une date imposée vaut [j, j] ; sinon la flex vendue, bornée aux jours ouvrés.
  const ops = [];
  for (let i = 0; i < ordre.length; i++) {
    const a = ordre[i];
    const lot = lots.get(a.lot);
    const op = a.type === "CHG" ? lot.chg : lot.liv;
    const nom = lot.nom || lot.id;
    if (!op) {
      erreurs.push({ code: "ORDRE_INVALIDE", lot: lot.id, type: a.type, message: `Le lot ${nom} n'a pas de ${NOM_OP[a.type]} renseigné${acc(a.type)}.` });
      continue;
    }
    if (op.confirme && !op.date) {
      erreurs.push({ code: "ORDRE_INVALIDE", lot: lot.id, type: a.type, message: `${opDuLot(a.type, nom)} est marqué${acc(a.type)} confirmé${acc(a.type)} mais n'a pas de date.` });
      continue;
    }

    const flexMin = op.flex?.[0] ? jourOuvreOuSuivant(op.flex[0]) : null;
    const flexMax = op.flex?.[1] ? jourOuvreOuPrecedent(op.flex[1]) : null;
    const souhaite = op.souhaite ? jourOuvreOuSuivant(op.souhaite) : null;
    let prefere = op.prefere ? jourOuvreOuSuivant(op.prefere) : null;

    // ── Le BLOC DU CAMION d'une opération transbordée (28/09, `transbo.js`) ──────────────────
    // `op.flex` est déjà la fenêtre du camion ; `op.transbo` porte la date VL, la fenêtre vendue au
    // client et les deux bornes fines. « Juste après quand c'est possible » : la préférée est le
    // bord de la fenêtre, QUELLE QUE SOIT celle de l'appelant — une retouche qui libère une date en
    // gardant l'ancienne en préférence (`proposerDecalage`, `retouche.js` de l'application) ne doit
    // pas éloigner le bloc de la navette.
    const tb = op.transbo || null;
    let transbo = null;
    if (tb) {
      if (flexMin !== null && flexMax !== null && flexMax >= flexMin) prefere = a.type === "CHG" ? flexMin : flexMax;
      // Les bornes fines de la passe : la MÊME traduction que la recherche v2 (`extrasArretBloc`).
      const extras = extrasArretBloc(tb);
      const vlJ = tb.vl ? (jourOuvre(tb.vl) ?? jourOuvreOuSuivant(tb.vl)) : null;
      const fc = tb.flexClient;
      transbo = {
        extras, tMin: extras.tMin ?? null, tFinMax: extras.tFinMax ?? null, vl: tb.vl ?? null, vlJ,
        clientMin: fc?.[0] ? jourOuvreOuSuivant(fc[0]) : null,
        clientMax: fc?.[1] ? jourOuvreOuPrecedent(fc[1]) : null,
        ordre: null,
      };
    }

    let imposee = null;
    let nonOuvree = false;
    let ferie = null;
    if (op.date) {
      imposee = jourOuvre(op.date);
      if (imposee === null) nonOuvree = true;
      // Un férié se traite comme un samedi (27/09) : une date imposée ce jour-là est refusée au
      // même niveau, avec le nom du férié pour que le planificateur comprenne.
      else if (estFerme(imposee)) { nonOuvree = true; ferie = nomFerie(op.date); imposee = null; }
    }
    // Un bloc transbordé IMPOSÉ du mauvais côté de la navette (28/09, « jamais ») : au chargement,
    // un jour qui finit avant que la collecte soit finie ; à la livraison, le jour de la livraison
    // par la navette ou après. Refus `TRANSBO_ORDRE` (`evaluerTournee`), comme un jour non ouvré :
    // ce n'est pas une date difficile, c'est une date impossible (la marchandise n'est pas au dépôt).
    if (transbo && imposee !== null) {
      if (transbo.tMin !== null && 2 * imposee + 2 <= transbo.tMin + EPS) transbo.ordre = "avant";
      if (transbo.tFinMax !== null && 2 * imposee >= transbo.tFinMax - EPS) transbo.ordre = "apres";
    }

    // Fenêtre de travail. Une opération imposée est clouée ; une opération libre reste dans sa
    // flex. Sans flex connue, on se rabat sur la date souhaitée — jamais sur « n'importe quand ».
    let fenetre;
    if (imposee !== null) fenetre = [imposee, imposee];
    else if (flexMin !== null && flexMax !== null) fenetre = [flexMin, flexMax];
    else if (souhaite !== null) fenetre = [souhaite, souhaite];
    else fenetre = null;

    if (fenetre && fenetre[1] < fenetre[0]) fenetre = null;

    // La fenêtre du lot FAIT SEUL — celle qui sert de référence aux km évités. C'est la fenêtre
    // COMMERCIALE, jamais celle que la tournée vient d'épingler : ce que le lot aurait coûté tout
    // seul ne dépend pas de la place qu'on lui a trouvée dans un voyage. Sans cela, reposer une
    // proposition (toutes dates imposées) changerait la baseline, donc les km évités, donc le
    // verdict — et « proposé = posé » tomberait.
    let fenetreSeul = null;
    if (flexMin !== null && flexMax !== null && flexMax >= flexMin) fenetreSeul = [flexMin, flexMax];
    else if (fenetre) fenetreSeul = fenetre;

    ops.push({
      fenetreSeul,
      index: i, lot: lot.id, nom, type: a.type,
      cp: a.type === "CHG" ? lot.cpC : lot.cpL,
      volume: lot.volume || 0,
      dureeH: op.dureeH || 0,
      imposee, nonOuvree, ferie, dateImposee: op.date || null, confirme: !!op.confirme,
      flexMin, flexMax, souhaite, prefere,
      fenetre, transbo,
    });
  }
  if (erreurs.length) return { erreurs };
  // La route forcée (29/09 soir) : jugée une fois toutes les opérations connues — sa validité
  // dépend de l'arrêt qui précède.
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    const lot = lots.get(o.lot);
    const op = o.type === "CHG" ? lot.chg : lot.liv;
    o.routeForcee = routeForceeValide(op.routeForcee, o, k > 0 ? ops[k - 1] : null);
  }
  return { ops, lots };
}

// Les bornes fines d'un bloc transbordé, portées par l'arrêt de la passe (ajout ⑧ de `passe.js`) ;
// rien pour une opération ordinaire.
const extrasBloc = (o) => (o.transbo ? o.transbo.extras : {});

// `imposee` distingue une fenêtre CLOUÉE PAR LE PLANIFICATEUR d'une fenêtre que le remplissage
// vient de réduire à un jour. Les deux valent [j, j] pour la passe, mais seule la première ouvre
// le mode diagnostic : le module n'a pas à se rattraper de ses propres choix.
const arretsDe = (ops, fenetres) => ops.map((o, k) => ({
  lot: o.lot, type: o.type, cp: o.cp, volume: o.volume, dureeH: o.dureeH,
  fenetre: fenetres[k], imposee: o.imposee !== null, ...extrasBloc(o),
  ...(o.routeForcee ? { routeForcee: true } : {}),
}));

// ── LA ROUTE FORCÉE PAR LE PLANIFICATEUR (Louis, 2026-09-29 soir) ──────────────────────────────
// `op.routeForcee = { depuis: "LOT|TYPE" | "DEPOT", dateDepuis, date }` : « ce tronçon passe, je le
// sais » — l'arrêt précédent à sa date → cet arrêt à sa date. Une exception LOCALE, jamais un
// réglage : elle ne vaut que pour ce tronçon-là, tel qu'il était quand on l'a forcé. Elle est donc
// ignorée (sans signal : l'écran la purge de son côté) dès que
//   · la date de l'opération n'est plus imposée, ou n'est plus celle du forçage ;
//   · l'arrêt qui la précède dans l'ordre n'est plus `depuis` (un lot inséré entre les deux : les
//     nouveaux tronçons se calculent normalement — le planificateur a validé A → B, pas A → X → B) ;
//   · la date imposée de cet arrêt précédent n'est plus `dateDepuis`.
// Valide, elle est portée par l'arrêt de la passe (`routeForcee: true`, ajout ⑨ de `passe.js`), qui
// ne s'en sert que si la route, comptée normalement, ferait manquer le jour. Rien d'autre n'est
// relâché : Q17, capacité, ordre, confirmé.
function routeForceeValide(rf, o, prec) {
  if (!rf || o.imposee === null || rf.date !== o.dateImposee) return null;
  if (!prec) return rf.depuis === "DEPOT" ? { depuis: "DEPOT" } : null;
  if (rf.depuis !== `${prec.lot}|${prec.type}`) return null;
  if (prec.imposee === null || prec.dateImposee !== rf.dateDepuis) return null;
  return { depuis: rf.depuis };
}

// ── LA PASSE, EN MODE DIAGNOSTIC ───────────────────────────────────────────────────────────────
// Quand une date IMPOSÉE est intenable, on ne s'arrête pas, et le calcul continue pour relever les
// autres signaux (chiffres marqués `partiels`). Trois essais, dans cet ordre :
//   1. le camion rentre au dépôt et en repart calé pour arriver PILE au jour imposé — la date est
//      tenue, au prix d'un passage par le dépôt (`tenue: true`, « le camion doit repasser par le
//      dépôt pour être au rendez-vous ») ;
//   2. sinon (29/09) la date GLISSE, depuis l'endroit où est le camion : au plus tôt après l'arrêt
//      précédent, sans aller-retour au dépôt (`tenue: false`, « au mieux le … ») ;
//   3. le dépôt en DERNIER recours : glisser depuis le dépôt (l'ancien 2e essai), quand glisser
//      sur place est refusé par la passe (la règle d'or, par exemple).
// Avant le 29/09, le 2e essai glissait depuis le dépôt : quand le jour imposé était déjà passé au
// moment où le camion était prêt (une livraison imposée au 22/10, le camion à Toulon le 27/10), le
// camion faisait l'aller-retour au dépôt pour rien — 2 500 km de plus, la date repoussée d'une
// semaine, 0 km évités (scénario 1 de la maquette, retours du 29/09).
//
// 🔴 Q17 reste intacte dans ce mode : le retour au dépôt qu'on force (essais 1 et 3) est TOUJOURS
// réalisable dans la semaine en cours — la passe ne s'engage sur un arrêt qu'après avoir vérifié
// que l'arrêt PUIS le retour tiennent avant le vendredi soir. Le nouveau segment repart d'un jour
// ouvré, au dépôt. Le glissement sur place (essai 2) est un `pas` ordinaire : il rentre au dépôt
// pour le week-end (ou le férié) comme toute la passe, ou il échoue.
//
// ── L'APPROCHE LE MATIN MÊME, SAUF SI LA TOURNÉE A BESOIN DE LA VEILLE (24/09) ─────────────────
// Partir le matin même (`reglages.approcheMemeJour`) retarde le premier arrêt dans sa journée, donc
// tout ce qui suit. Ce n'est jamais une raison de refuser une date ni d'en choisir une plus
// lointaine : quand une lecture ne tient pas avec l'approche du matin, on la relit avec l'approche
// de la VEILLE (le prototype, `ctx.veille`) et on garde la plus permissive — même règle que les
// deux comptes (« en cas de doute, on lit au plus permissif »). Seconde lecture pour les seules
// lectures qui ne tiennent pas du premier coup.
const coutLecture = (x) => (x.fini ? x.ruptures.length : Number.POSITIVE_INFINITY);
function passeDiagnostic(ctx, arrets) {
  const r = passeDiagnosticSimple(ctx, arrets);
  if (!ctx.veille || coutLecture(r) === 0) return r;
  const v = passeDiagnosticSimple(ctx.veille, arrets);
  return coutLecture(v) < coutLecture(r) ? v : r;
}

function passeDiagnosticSimple(ctx, arrets) {
  let etat = etatInitial(ctx, arrets[0]);
  const ruptures = [];
  for (let i = 0; i < arrets.length; i++) {
    let r = pas(ctx, etat, arrets[i], i);
    if (!r.ok) {
      // 01/10 (règle des 150 km) : une date imposée DANS la semaine que l'arrêt ne tient pas — il
      // déborderait sur le week-end, et la coupure chargée au loin est exclue — se lit comme une
      // fenêtre dépassée : « la route ne tient pas jusqu'à cet arrêt » (orange). Une date imposée
      // APRÈS le week-end (`apresFermeture`), elle, reste le refus : c'est le report lui-même qui
      // est demandé, et c'est lui que la règle interdit.
      const debordeLoin = r.motif === "q17_coupure_chargee_loin" && !r.detail?.apresFermeture;
      const rattrapable = (r.motif === "fenetre_depassee" || debordeLoin) && arrets[i].imposee;
      if (!rattrapable) return { fini: false, rupture: { arret: i, motif: r.motif, detail: r.detail }, ruptures };
      const jourImpose = arrets[i].fenetre[0];
      // 1er essai : on repart du dépôt, calé pour arriver pile au jour imposé.
      const base = etatAuDepot(ctx, etat, arrets[i], jourImpose);
      r = pas(ctx, base, arrets[i], i);
      let tenue = true;
      if (!r.ok) {
        // L'opération GLISSE, borne haute relâchée — c'est exactement ce que le signal
        // DATES_INCOMPATIBLES annonce au planificateur (« au mieux le … »).
        tenue = false;
        const libre = { ...arrets[i], fenetre: [jourImpose, Number.MAX_SAFE_INTEGER] };
        // 2e essai (29/09, scénario 1) : glisser DEPUIS L'ENDROIT OÙ EST LE CAMION, pas depuis le
        // dépôt. Le jour imposé est déjà passé quand le camion est prêt : le retour au dépôt ne le
        // rattrapera jamais (on ne remonte pas le temps), il ne ferait qu'ajouter l'aller-retour
        // et du retard — Toulon → Guer → Toulon, 2 500 km, une livraison repoussée au 03/11 au
        // lieu du 27/10, et une « boucle » à 0 km évités que personne ne comprend. Glisser sur
        // place donne une date au moins aussi tôt, avec moins de km (inégalité triangulaire), et
        // c'est ce que le planificateur lit : « au mieux le mar. 27/10 », juste après l'arrêt
        // d'avant. Aucun segment DEPOT de diagnostic : si le camion rentre, c'est une coupure
        // ORDINAIRE de la passe (Q17, `pas` la décide comme partout ailleurs).
        r = pas(ctx, etat, libre, i);
        // 3e essai, en dernier recours : l'ancien 2e — rentrer au dépôt, et glisser depuis là.
        // Il ne sert que si `pas` refuse de glisser sur place (la règle d'or, typiquement) : Q17
        // n'est jamais relâchée, ni ici ni là.
        if (!r.ok) r = pas(ctx, base, libre, i);
        // 01/10 (règle des 150 km, ajout ⑩ de `passe.js`) : la date imposée ne tient pas, ET la glisser
        // lui ferait passer le week-end au dépôt, chargé, pour repartir au loin — ce que la règle
        // interdit. Ce n'est PAS un refus de la tournée : c'est toujours « la route ne tient pas
        // jusqu'à cet arrêt » (orange, « Forcer la route » possible si le forçage suffit). On finit donc
        // le diagnostic SANS la limite, pour garder des chiffres, et la rupture le note
        // (`coupureLoin`) : le signal dira que reporter après le week-end est exclu, au lieu
        // d'annoncer un « au mieux lundi » que le module refuserait ensuite.
        let coupureLoin = null;
        if (!r.ok && r.motif === "q17_coupure_chargee_loin") {
          coupureLoin = r.detail;
          const sansLimite = { ...ctx, coupureChargeeMaxKm: null };
          r = pas(sansLimite, etat, libre, i);
          if (!r.ok) r = pas(sansLimite, base, libre, i);
        }
        if (!r.ok) return { fini: false, rupture: { arret: i, motif: r.motif, detail: r.detail }, ruptures };
        if (coupureLoin) { ruptures.push({ arret: i, jourImpose, tenue, motifInitial: "fenetre_depassee", coupureLoin }); etat = r.etat; continue; }
      }
      ruptures.push({ arret: i, jourImpose, tenue, motifInitial: "fenetre_depassee" });
    }
    etat = r.etat;
  }
  return { fini: true, res: cloturer(ctx, etat), ruptures };
}

// L'état « le camion est rentré au dépôt et en repart pour arriver pile au jour imposé ».
function etatAuDepot(ctx, e, arret, jourImpose) {
  const Rd = ctx.route(e.pos, ctx.depotCp);
  const rentre = !e.auDepot;
  const tRetour = e.t + (rentre ? Rd.demi : 0);
  const segments = e.segments.slice();
  if (rentre) {
    if (Rd.km > 0 || Rd.demi > 0) {
      segments.push({ genre: "ROUTE", de: e.pos, vers: ctx.depotCp, km: Rd.km, tDebut: e.t, tFin: tRetour });
    }
    segments.push({ genre: "DEPOT", cp: ctx.depotCp, tDebut: tRetour, aBord: e.aBord, coupure: true, diagnostic: true });
  }
  const R0 = ctx.route(ctx.depotCp, arret.cp);
  // 🔑 ON NE REMONTE JAMAIS LE TEMPS. Caler le départ pour arriver pile au jour imposé est le but,
  // mais si ce départ tombe AVANT le retour au dépôt qu'on vient de facturer, la tournée
  // repartirait dans le passé : `sorties` se chevaucheraient, et `planning.js`, qui s'appuie
  // dessus pour dire si un camion est libre, lirait n'importe quoi. Dans ce cas l'épingle n'est
  // simplement pas tenable — c'est le second essai, `tenue: false`, qui le dira.
  return {
    t: Math.max(2 * jourImpose - R0.demi, tRetour),
    pos: ctx.depotCp, auDepot: true, tSortie: null,
    km: e.km + (rentre ? Rd.km : 0),
    aBord: e.aBord, volMax: e.volMax, tempoDemi: e.tempoDemi,
    coupures: e.coupures + (rentre ? 1 : 0),
    demiProductifs: e.demiProductifs + (rentre ? Rd.demi : 0),
    jourDepart: e.jourDepart,
    jours: e.jours.slice(),
    sorties: rentre ? [...e.sorties, [e.tSortie, tRetour]] : e.sorties.slice(),
    segments, ops: e.ops.slice(), dernierJourOp: null, dernierVolOp: 0,
  };
}

// ── REMPLISSAGE DES DATES LIBRES ───────────────────────────────────────────────────────────────
// Rend { fenetres, res, ruptures, fini, bloquee }. `bloquee` = l'opération libre qui n'a trouvé
// aucun jour dans sa flex.
function remplir(ctx, ops, mode) {
  const fenetres = ops.map(o => o.fenetre);
  if (fenetres.some(f => !f)) {
    const k = fenetres.findIndex(f => !f);
    return { fenetres, bloquee: ops[k], fini: false, ruptures: [] };
  }

  if (mode === "au_plus_tot") {
    const r = passeDiagnostic(ctx, arretsDe(ops, fenetres));
    return { fenetres, ...r };
  }

  // « près du préféré » : opération par opération, dans l'ordre de la tournée. Les libres qui
  // suivent restent à leur flex — elles seront évaluées au plus tôt — ce qui rend chaque décision
  // dépendante seulement de ce qui la précède. C'est ce qui rend une retouche STABLE.
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    if (o.imposee !== null) continue;
    const cible = o.prefere ?? o.souhaite ?? o.fenetre[0];
    const candidats = [];
    // Une date libre ne tombe jamais un jour férié (27/09) ; et la distance à la cible se compte en
    // jours OUVERTS, comme par-dessus un week-end : du mardi au jeudi d'une semaine au mercredi
    // férié, il y a un jour, pas deux. Sans férié : exactement l'ordre d'origine.
    for (let d = o.fenetre[0]; d <= o.fenetre[1]; d++) if (!estFerme(d)) candidats.push(d);
    const dist = (x) => Math.abs(ecartOuvre(cible, x));
    candidats.sort((x, y) => (dist(x) - dist(y)) || (x - y));

    let repli = null;
    let choisi = null;
    // Quand AUCUN jour ne convient, on veut dire POURQUOI. Une capacité dépassée ou un mur Q17
    // n'est pas « la flex est trop étroite » : on retient la cause la plus parlante rencontrée.
    let cause = null;
    for (const d of candidats) {
      fenetres[k] = [d, d];
      const r = passeDiagnostic(ctx, arretsDe(ops, fenetres));
      if (!r.fini) {
        if (!cause || (cause.motif === "fenetre_depassee" && r.rupture.motif !== "fenetre_depassee")) cause = r.rupture;
        continue;
      }
      if (r.ruptures.length === 0) { choisi = d; break; }
      if (repli === null) repli = d;
    }
    if (choisi === null) choisi = repli;
    if (choisi === null) {
      fenetres[k] = o.fenetre;
      return { fenetres, bloquee: o, rupture: cause, fini: false, ruptures: [] };
    }
    fenetres[k] = [choisi, choisi];
  }

  const r = passeDiagnostic(ctx, arretsDe(ops, fenetres));
  return { fenetres, ...r };
}

// ── KM DU LOT FAIT SEUL ────────────────────────────────────────────────────────────────────────
// Depuis le dépôt de SON agence, ses retours dépôt du week-end compris, avec le MÊME abaque et la
// MÊME passe que la tournée. C'est la correction de méthode de l'essai 2 § 4.3.1 : la formule
// géométrique surestime les km évités de 34 % à deux lots, 55 % à quatre.
function kmSeulReel(lot, ops, reglages, abaque, distance) {
  const chg = ops.find(o => o.lot === lot.id && o.type === "CHG");
  const liv = ops.find(o => o.lot === lot.id && o.type === "LIV");
  if (!chg || !liv || !chg.fenetreSeul || !liv.fenetreSeul) return null;
  const ctx = contexte({
    depotCp: lot.depotCp, capacite: null, abaques: abaque, km: distance,
    heuresJour: reglages.heuresJour,
    deuxOpsParJour: reglages.deuxOpsParJour, weekendCharge: reglages.weekendCharge,
    arrondi: reglages.arrondi, resteMinPourCommencerH: reglages.resteMinPourCommencerH,
    approcheMemeJour: reglages.approcheMemeJour,
    coupureChargeeMaxKm: reglages.coupureChargeeMaxKm,
  });
  // Un lot transbordé fait seul l'est aussi : mêmes bornes fines du bloc (28/09).
  const arrets = [
    { lot: lot.id, type: "CHG", cp: lot.cpC, volume: lot.volume || 0, dureeH: chg.dureeH, fenetre: chg.fenetreSeul, ...extrasBloc(chg) },
    { lot: lot.id, type: "LIV", cp: lot.cpL, volume: lot.volume || 0, dureeH: liv.dureeH, fenetre: liv.fenetreSeul, ...extrasBloc(liv) },
  ];
  let r = evaluerSequence({ ctx, depotCp: lot.depotCp, capacite: null, arrets });
  // Même repli que la tournée : l'approche de la veille si celle du matin ne tient pas.
  if (!r.faisable && ctx.approcheMemeJour !== "veille") {
    r = evaluerSequence({ ctx: { ...ctx, approcheMemeJour: "veille" }, depotCp: lot.depotCp, capacite: null, arrets });
  }
  // Un lot infaisable SEUL (sa flex ne tient pas sous Q17) n'a pas de km réels : on retombe sur la
  // géométrie plutôt que de rendre zéro, qui ferait croire à une économie.
  return r.faisable ? r.km : null;
}

// ── LES PÉRIODES HORS DÉPÔT ────────────────────────────────────────────────────────────────────
// `planning.js` s'en sert pour dire si un camion est déjà dehors : elles doivent être TRIÉES et
// DISJOINTES, sinon le contrôle « camion déjà pris » compare n'importe quoi. La passe les produit
// déjà ainsi ; le mode diagnostic, lui, peut faire repartir la tournée d'un jour antérieur, et on
// fusionne alors les périodes qui se recouvrent.
//
// 🔴 La fusion ne peut JAMAIS créer une période qui enjambe un week-end : deux périodes qui se
// recouvrent partagent un jour ouvré, donc une semaine, et chaque période tient dans sa semaine.
// La garde ci-dessous le vérifie quand même plutôt que de le supposer.
//
// Chaque période porte aussi ses INSTANTS (`fines` : départ et retour sur l'axe des demi-journées,
// `t = 2 × jourOuvré + fraction`), alignés un pour un sur les périodes ISO : `planning.js` s'en
// sert pour juger un jour de CONTACT entre deux tournées (`reglages.contactJour`).
function normaliserSorties(brutes, continu) {
  const periodes = brutes
    .map(([a, b]) => [jourDe(a), Math.max(jourFinDe(b, continu), jourDe(a)), a, b])
    .sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]));

  const fusion = [];
  for (const p of periodes) {
    const dernier = fusion[fusion.length - 1];
    const recouvre = dernier && p[0] <= dernier[1];
    const memeSemaine = dernier && semaineDe(dernier[0]) === semaineDe(Math.max(dernier[1], p[1]));
    // Même garde pour un férié : la fusion ne doit pas en enjamber un (27/09).
    const sansFerie = dernier && fermesEntre(dernier[0], Math.max(dernier[1], p[1])) === 0;
    if (recouvre && memeSemaine && sansFerie) {
      dernier[1] = Math.max(dernier[1], p[1]);
      dernier[2] = Math.min(dernier[2], p[2]);
      dernier[3] = Math.max(dernier[3], p[3]);
    } else fusion.push([p[0], p[1], p[2], p[3]]);
  }
  return {
    sorties: fusion.map(([a, b]) => [isoDeJour(a), isoDeJour(b)]),
    fines: fusion.map(([, , ta, tb]) => [ta, tb]),
  };
}

// ── L'OCCUPATION DU CAMION ─────────────────────────────────────────────────────────────────────
// Une période hors dépôt ne dit pas tout : un camion rentré CHARGÉ au dépôt (coupure du week-end,
// ou attente d'une date imposée) porte encore les meubles de cette tournée jusqu'à ce qu'il
// reparte. Il n'est pas libre pour une autre tournée entre-temps. `planning.js` juge donc « camion
// déjà pris » sur l'OCCUPATION : les sorties, fusionnées à travers chaque coupure chargée. Une
// coupure À VIDE libère le camion, comme avant. Même forme que `sorties` (+ `fines`).
function occupationsDe(brutes, segments, continu) {
  const chargees = segments.filter(s => s.genre === "DEPOT" && s.coupure && (s.aBord || 0) > 1e-9);
  const chargeAuRetour = (t) => chargees.some(c => Math.abs(c.tDebut - t) < 1e-6);
  const triees = brutes.slice().sort((x, y) => x[0] - y[0]);
  const fusion = [];
  for (const [a, b] of triees) {
    const dernier = fusion[fusion.length - 1];
    if (dernier && (dernier.charge || a <= dernier.b)) {
      dernier.b = Math.max(dernier.b, b);
    } else fusion.push({ a, b });
    fusion[fusion.length - 1].charge = chargeAuRetour(b);
  }
  return {
    occupations: fusion.map(({ a, b }) => [isoDeJour(jourDe(a)), isoDeJour(Math.max(jourFinDe(b, continu), jourDe(a)))]),
    fines: fusion.map(({ a, b }) => [a, b]),
  };
}

// ── LE TRACÉ JOUR PAR JOUR ─────────────────────────────────────────────────────────────────────
function tracerJours(res) {
  if (res.jourDepart === null) return { jours: [], joursVides: 0 };
  const jours = [];
  let joursVides = 0;
  let aBord = 0;
  let dernierGenre = null;
  for (let j = res.jourDepart; j <= res.jourRetour; j++) {
    // Un jour férié n'a pas de ligne, pas plus qu'un samedi (qui n'est pas sur l'axe) : le camion
    // est au dépôt, ce n'est ni un jour de camion ni un jour de tempo (27/09).
    if (estFerme(j)) continue;
    const activites = [];
    for (const s of res.segments) {
      const debut = s.tDebut;
      const fin = s.tFin === undefined ? s.tDebut + 1 : s.tFin;
      // En mode continu les bornes sont des flottants : un segment qui finit pile au début de la
      // journée `j` ne l'occupe pas, et EPS empêche le bruit de virgule d'en décider.
      if (fin <= 2 * j + EPS || debut >= 2 * j + 2 - EPS) continue;
      // `tDebut` / `tFin` (29/09, planning « matin / après-midi » de la maquette) : les bornes du
      // SEGMENT entier, sur l'axe des demi-journées (même axe qu'`arrets[].demiDebut`) — la journée
      // `j` va de 2j (matin) à 2j + 2 ; l'écran en tire l'étage (matin, après-midi) de chaque
      // activité. Ajout pur : rien d'autre ne change dans `jours[]`.
      const bornes = { tDebut: debut, tFin: fin };
      if (s.genre === "ROUTE") activites.push({ genre: "ROUTE", vers: s.vers, km: s.km, ...bornes, ...(s.forcee ? { forcee: true } : {}) });
      else if (s.genre === "DEPOT") activites.push({ genre: "DEPOT", ...bornes });
      else activites.push({ genre: s.genre, lot: s.lot, ...bornes });
      if (s.aBord !== undefined) aBord = s.aBord;
      dernierGenre = s.genre;
    }
    if (activites.length === 0) {
      // Rien ce jour-là : le camion attend. Au dépôt s'il vient d'y rentrer, sur place sinon —
      // c'est le modèle de la passe, qui passe le tempo là où il se trouve.
      activites.push({ genre: dernierGenre === "DEPOT" ? "DEPOT" : "VIDE" });
      joursVides++;
    }
    jours.push({ date: isoDeJour(j), aBord: Math.round(aBord * 100) / 100, activites });
  }
  return { jours, joursVides };
}

// ── LA FONCTION PUBLIQUE ───────────────────────────────────────────────────────────────────────
export function evaluerTournee(entree, reglagesPartiels) {
  return evaluer(entree, reglagesPartiels, {});
}

// ── « FORCER LA ROUTE » SUFFIRAIT-IL ? (30/09, chantier « un bloc bouge seul ») ──────────────────
// Un `DATES_INCOMPATIBLES` porte `detail.forcable` : `true` si forcer la route jusqu'à cet arrêt (le
// tronçon tel qu'il est posé, depuis l'arrêt précédent à sa date) le rendrait tenu, sans refus ;
// `false` sinon — le problème n'est pas la route mais Q17 (le retour avant le week-end ou le férié),
// un arrêt précédent qui finit trop tard, une date libre de part et d'autre, ou une exception déjà
// posée qui ne suffit pas. L'écran ne propose « Forcer la route » que si c'est `true` : un bouton qui
// « accepte » sans rien changer est pire que pas de bouton. Une évaluation de plus, par arrêt en
// défaut seulement (rien quand tout tient), jamais récursive (`opts.sansForcable`).
function forcableDe(entree, reglagesPartiels, ops, k) {
  const o = ops[k];
  if (o.imposee === null || o.routeForcee) return false;
  const prec = k > 0 ? ops[k - 1] : null;
  if (prec && prec.imposee === null) return false;
  const rf = { depuis: prec ? `${prec.lot}|${prec.type}` : "DEPOT", dateDepuis: prec ? prec.dateImposee : null, date: o.dateImposee };
  const cle = o.type === "CHG" ? "chg" : "liv";
  const essai = {
    ...entree,
    lots: (entree.lots || []).map(l => (l.id === o.lot ? { ...l, [cle]: { ...l[cle], routeForcee: rf } } : l)),
  };
  const r = evaluer(essai, reglagesPartiels, { sansForcable: true });
  return r.verdict !== "refus" && !r.signaux.some(s => s.code === "DATES_INCOMPATIBLES" && s.lot === o.lot && s.type === o.type);
}

function evaluer(entree, reglagesPartiels, opts) {
  const R = fusionnerReglages(reglagesPartiels);
  // La distance : injectée par `reglages.distance` (une matrice OSRM un jour, une distance factice
  // dans les tests), sinon la haversine mémoïsée de `passe.js`. UNE seule mesure pour tout —
  // passes, lot fait seul, mode géométrique, détour de greffe (défaut D2, T0).
  const distance = typeof R.distance === "function" ? R.distance : kmEntre;
  const prep = preparer(entree);
  if (prep.erreurs) return refusImmediat(prep.erreurs);

  const { ops, lots } = prep;
  const signaux = [];

  // Une date imposée un samedi ou un dimanche n'est pas une date de travail : refus net, avant
  // tout calcul — l'axe des jours ouvrés ne sait pas la représenter. Un jour FÉRIÉ, pareil (27/09,
  // « comme un week-end ») : même code, même niveau, le nom du férié en plus.
  for (const o of ops) {
    if (o.nonOuvree) {
      signaux.push({
        niveau: "refus", code: "DATE_NON_OUVREE", lot: o.lot, type: o.type,
        message: o.ferie
          ? `${opDuLot(o.type, o.nom)} est fixé${acc(o.type)} au ${jfr(o.dateImposee)}, un jour férié (${o.ferie}) : aucune opération ce jour-là.`
          : `${opDuLot(o.type, o.nom)} est fixé${acc(o.type)} au ${jfr(o.dateImposee)}, un jour non ouvré.`,
        detail: o.ferie ? { date: o.dateImposee, ferie: o.ferie } : { date: o.dateImposee },
      });
    }
    // Le bloc transbordé imposé du mauvais côté de la navette (28/09, « jamais ») : même niveau,
    // même moment — la marchandise n'est pas au dépôt ce jour-là (ou le client l'attend déjà).
    if (o.transbo?.ordre) signaux.push(signalTransboOrdre(o, o.transbo.ordre, o.dateImposee));
  }
  if (signaux.length) return sortieRefus(signaux, ops);

  // Un code postal inconnu du référentiel est placé au centre de la France par `gc()` : toutes les
  // distances qui le touchent sont fausses, et le verdict avec elles. On le DIT (défaut D3, T0) —
  // niveau `reglages.niveaux.cpInconnu`, refus par défaut — puis on calcule quand même, pour que
  // l'écran garde des chiffres (faux, et annoncés comme tels). Arrêts d'abord, dépôts ensuite.
  signaux.push(...signauxCpInconnus(ops, entree, lots, R));

  const opsSansFenetre = ops.filter(o => !o.fenetre);
  if (opsSansFenetre.length) {
    for (const o of opsSansFenetre) {
      signaux.push({
        niveau: "refus", code: "FLEX_INTENABLE", lot: o.lot, type: o.type,
        message: `${opDuLot(o.type, o.nom)} n'a ni date imposée, ni fenêtre de flexibilité exploitable.`,
        detail: null,
      });
    }
    return sortieRefus(signaux, ops);
  }

  // Capacité : « forçable » lève le contrôle dur de la passe et le dégrade en orange.
  const forcee = R.niveaux.capacite === "forcable" && !!entree.forcerCapacite;
  const capacite = forcee ? null : (entree.camion?.capacite ?? null);
  const optsCtx = {
    depotCp: entree.camion?.depotCp, capacite, km: distance,
    heuresJour: R.heuresJour,
    deuxOpsParJour: R.deuxOpsParJour, weekendCharge: R.weekendCharge,
    arrondi: R.arrondi, resteMinPourCommencerH: R.resteMinPourCommencerH,
    approcheMemeJour: R.approcheMemeJour,
    coupureChargeeMaxKm: R.coupureChargeeMaxKm,
  };

  // ── LES DEUX COMPTES — UNE RÈGLE, ET UNE SEULE ───────────────────────────────────────────────
  //
  //   le large TIENT (finit sans aucune rupture)  →  tout le résultat vient du large, aucun signal
  //   sinon                                       →  tout le résultat vient du JUSTE
  //                                                  · le juste tient  → orange SERRE
  //                                                  · sinon           → les signaux du juste
  //
  // 🔑 POURQUOI « TOUT », Y COMPRIS QUAND LE JUSTE NE TIENT PAS NON PLUS. C'est le défaut n° 2 du
  // banc du 2026-09-21 : l'ancienne version ne basculait sur le juste que s'il tenait ENTIÈREMENT,
  // et gardait sinon la lecture au large — qui honore parfois UNE DATE IMPOSÉE DE MOINS. Sur le
  // planning réel, 4 des 10 tournées portant une date incompatible en mode continu se voyaient
  // annoncer un rendez-vous manqué qui, à la lecture serrée, était tenu (`EC-952-EW#2`,
  // `GL-539-CK#1`, `GN-482-TP#1`, `GQ-156-KL#3`). Annoncer au planificateur qu'une date ne tient
  // pas alors qu'elle tient est la pire erreur que ce module puisse faire : il rappelle un client
  // pour rien. La règle est donc « en cas de doute, on lit au plus permissif », sans exception.
  const ctxLarge = contexte({ ...optsCtx, abaques: R.comptes.large });
  const ctxJuste = contexte({ ...optsCtx, abaques: R.comptes.juste });
  const tenu = (r) => r.fini && r.ruptures.length === 0;

  // Le repli sur l'approche de la veille (voir `passeDiagnostic`) : un contexte jumeau par compte.
  if (ctxLarge.approcheMemeJour !== "veille") {
    ctxLarge.veille = contexte({ ...optsCtx, approcheMemeJour: "veille", abaques: R.comptes.large });
    ctxJuste.veille = contexte({ ...optsCtx, approcheMemeJour: "veille", abaques: R.comptes.juste });
  }

  const auLarge = remplir(ctxLarge, ops, R.remplissage);
  let auJuste = null;
  let compte = "large", abaque = R.comptes.large, rempli = auLarge;
  if (!tenu(auLarge)) {
    auJuste = remplir(ctxJuste, ops, R.remplissage);
    compte = "juste"; abaque = R.comptes.juste; rempli = auJuste;
  }

  const comptes = {
    large: { tient: tenu(auLarge), motif: tenu(auLarge) ? null : motifDe(auLarge) },
    juste: { tient: false, motif: null },
  };
  // La lecture au juste des MÊMES dates, gardée pour la route forcée (29/09 soir) : les heures
  // qu'un forçage a « gagnées » se disent au compte le moins sévère qui en avait besoin.
  let lectureJuste = auJuste;
  if (compte === "large") {
    // Mêmes dates, abaque plus rapide : le contrôle est un renseignement, pas une recherche.
    const j = passeDiagnostic(ctxJuste, arretsDe(ops, rempli.fenetres));
    lectureJuste = j;
    comptes.juste = { tient: tenu(j), motif: tenu(j) ? null : motifDe(j) };
  } else if (auJuste) {
    comptes.juste = { tient: tenu(auJuste), motif: tenu(auJuste) ? null : motifDe(auJuste) };
  }

  // ── AUCUN DES DEUX COMPTES NE TIENT ──────────────────────────────────────────────────────────
  if (!rempli.fini) {
    signaux.push(signalEchec(rempli, ops, entree, R));
    return sortieRefus(signaux, ops, rempli.fenetres);
  }

  const res = rempli.res;
  const partiels = rempli.ruptures.length > 0;

  // ── LES ARRÊTS RETENUS ───────────────────────────────────────────────────────────────────────
  const arrets = ops.map((o, k) => {
    const op = res.ops[k];
    const jour = op ? jourDe(op.tDebut) : rempli.fenetres[k][0];
    const date = isoDeJour(jour);
    // Une opération TRANSBORDÉE (28/09) : la date que le client voit est la date VL (la navette),
    // pas celle du camion au dépôt. « Hors de la fenêtre vendue » et l'écart à la date souhaitée
    // portent donc sur la date VL ; le jour du camion se juge sur la fenêtre du quai (plus bas,
    // `TRANSBO_QUAI`).
    const tb = o.transbo;
    // 01/10 (passe sur les contrôles) : une date IMPOSÉE que la route ne tient pas est GLISSÉE par le
    // mode diagnostic (« au mieux le … ») — mais la date POSÉE par le planificateur, elle, n'a pas
    // bougé. C'est elle qu'on juge contre la fenêtre vendue : dire « fixée au 03/11, hors de la fenêtre,
    // rappel client » pour une date que personne n'a posée était faux (et s'ajoutait à l'orange de la
    // route). `jourJuge` : le jour imposé d'un arrêt non tenu, sinon le jour retenu.
    const glisse = rempli.ruptures.find(r => r.arret === k && !r.tenue);
    const jourJuge = glisse ? glisse.jourImpose : jour;
    const horsFlex = tb
      ? tb.vlJ !== null && tb.clientMin !== null && tb.clientMax !== null && (tb.vlJ < tb.clientMin || tb.vlJ > tb.clientMax)
      : o.flexMin !== null && o.flexMax !== null && (jourJuge < o.flexMin || jourJuge > o.flexMax);
    const jourClient = tb ? tb.vlJ : jour;
    return {
      lot: o.lot, type: o.type, date, libre: o.imposee === null, horsFlex,
      // En jours OUVERTS : un férié entre la date souhaitée et la date posée ne compte pas (27/09).
      // Donnée seulement depuis le 28/09 (plus de signal `ECART_SOUHAITE`) : le banc la lit.
      ecartSouhaiteJ: o.souhaite === null || jourClient === null ? null : ecartOuvre(o.souhaite, jourClient),
      demiDebut: op ? op.tDebut : null, demiFin: op ? op.tFin : null,
      // La date jugée contre la fenêtre (cf. `jourJuge`) : égale à `date`, sauf pour un arrêt glissé.
      ...(glisse ? { dateJugee: isoDeJour(jourJuge) } : {}),
    };
  });

  // ── LES SIGNAUX ──────────────────────────────────────────────────────────────────────────────
  // SERRE dit « ça tient, mais sans battement ». Si le compte serré ne tient pas non plus, ce n'est
  // plus « serré » : ce sont ses propres signaux d'intenabilité qui parlent, et ajouter SERRE
  // par-dessus ne ferait que diluer le message.
  if (compte === "juste" && comptes.juste.tient) {
    signaux.push({
      niveau: "orange", code: "SERRE", lot: null, type: null,
      message: `Cette tournée ne tient qu'au compte serré (${R.comptes.juste.kmParJour} km par jour, sans marge de manutention) : il n'y a aucun battement.`,
      detail: { motifAuLarge: comptes.large.motif },
    });
  }

  for (const rupt of rempli.ruptures) {
    const o = ops[rupt.arret];
    const posee = arrets[rupt.arret].date;
    // 01/10 (passe sur les contrôles) : `detail.depuis` — l'arrêt d'AVANT sur le tronçon (à sa date
    // posée), ou "DEPOT". Le signal reste accroché à l'arrêt qui ne tient plus, et `message` ne change
    // pas ; mais c'est presque toujours l'arrêt d'avant que le planificateur vient de bouger (« on me
    // parle de la livraison alors que je bouge le chargement ») : l'écran s'en sert pour dire le tronçon.
    const avant = rupt.arret > 0 ? ops[rupt.arret - 1] : null;
    const depuis = avant
      ? { lot: avant.lot, type: avant.type, nom: avant.nom, date: avant.dateImposee || arrets[rupt.arret - 1].date }
      : "DEPOT";
    signaux.push({
      niveau: R.niveaux.suiteInfaisable, code: "DATES_INCOMPATIBLES", lot: o.lot, type: o.type,
      message: rupt.tenue
        ? `La route jusqu'${OPS[o.type].au} ${OPS[o.type].nom} du lot ${o.nom} ne tient pas : le camion doit repasser par le dépôt pour être au rendez-vous du ${jfr(o.dateImposee)}.`
        : rupt.coupureLoin
          // 01/10 : pas de « au mieux lundi » — le report après le week-end est exclu (règle des 150 km).
          ? `${opDuLot(o.type, o.nom)} ne peut pas être tenu${acc(o.type)} au ${jfr(o.dateImposee)}, même au compte serré, et ne peut pas passer après le week-end ou le jour férié (à ${rupt.coupureLoin.kmApres} km du dépôt : le camion ne rentre pas chargé pour repartir à plus de ${rupt.coupureLoin.max} km). Avancez la tournée, ou passez par un transbordement.`
          : `${opDuLot(o.type, o.nom)} ne peut pas être tenu${acc(o.type)} au ${jfr(o.dateImposee)}, même au compte serré : au mieux le ${jfr(posee)}.`,
      detail: {
        imposee: o.dateImposee, calculee: posee, tenue: rupt.tenue, depuis,
        ...(rupt.coupureLoin ? { coupureLoin: rupt.coupureLoin } : {}),
        ...(opts.sansForcable ? {} : { forcable: forcableDe(entree, reglagesPartiels, ops, rupt.arret) }),
      },
    });
  }

  // La route forcée par le planificateur (29/09 soir) : une info, jamais plus — le planificateur
  // l'a décidée, avec un motif que l'écran garde. Elle n'est dite que si elle a SERVI (la route
  // comptée normalement faisait manquer le jour) : une exception devenue inutile ne dit rien.
  // Elle vaut aux DEUX comptes (le planificateur se porte garant du tronçon) : un tronçon forcé qui
  // ne tenait qu'au compte serré ne dit donc plus « serré », il dit « forcé ». Les heures annoncées
  // sont celles du compte serré quand il avait lui aussi besoin du forçage (le chiffre le moins
  // alarmant qui reste vrai), sinon celles du compte retenu.
  const forceesAuJuste = new Map(
    (lectureJuste?.fini ? lectureJuste.res.ops : []).filter(x => x.routeForcee).map(x => [x.arret, x]),
  );
  for (const op of res.ops) {
    if (!op.routeForcee) continue;
    const o = ops[op.arret];
    const auJuste = forceesAuJuste.get(op.arret);
    // Forcée au compte retenu (le large) alors que le compte serré la tenait : c'est un tronçon
    // « serré » dont le planificateur s'est porté garant — on le dit, sans grossir le chiffre.
    const tenaitAuJuste = compte === "large" && !!lectureJuste && !auJuste;
    const demi = auJuste ? auJuste.demiGagnees : op.demiGagnees;
    const heuresGagnees = Math.round(demi * (R.heuresJour / 2) * 10) / 10;
    const h = heuresGagnees.toLocaleString("fr-FR");
    signaux.push({
      niveau: "info", code: "ROUTE_FORCEE", lot: o.lot, type: o.type,
      message: tenaitAuJuste
        ? `La route jusqu'${OPS[o.type].au} ${OPS[o.type].nom} du lot ${o.nom} (${jfr(o.dateImposee)}) est forcée par le planificateur : au compte serré elle tenait, au compte normal il manquait ${h} h de route.`
        : `La route jusqu'${OPS[o.type].au} ${OPS[o.type].nom} du lot ${o.nom} (${jfr(o.dateImposee)}) est forcée par le planificateur : le calcul comptait ${h} h de route de plus.`,
      detail: { depuis: o.routeForcee?.depuis ?? null, heuresGagnees, km: Math.round(op.kmForces), tenaitAuJuste },
    });
  }

  if (forcee && entree.camion?.capacite != null && res.volumeMaxABord > entree.camion.capacite + 1e-9) {
    signaux.push({
      niveau: "orange", code: "CAPACITE", lot: null, type: null,
      message: `Le camion porte jusqu'à ${res.volumeMaxABord} m³ pour une capacité de ${entree.camion.capacite} m³ — dépassement forcé par le planificateur.`,
      detail: { volumeMaxABord: res.volumeMaxABord, capacite: entree.camion.capacite },
    });
  }

  // 📛 Plus d'info `ECART_SOUHAITE` (« … tombe le …, N jours avant / après la date souhaitée — dans
  // la fenêtre vendue ») depuis le 28/09, dans les deux sens : dans la fenêtre vendue il n'y a rien
  // à signaler, et la date est déjà affichée (retour de Louis sur les fiches et la proposition). La
  // donnée reste (`arrets[].ecartSouhaiteJ`). `HORS_FLEX` (hors de la fenêtre) ne change pas.
  for (const a of arrets) {
    const o = ops.find(x => x.lot === a.lot && x.type === a.type);
    const tb = o.transbo;
    if (a.horsFlex && tb) {
      // La date VL (la navette chez le client) sort de la fenêtre vendue : c'est le client qu'il
      // faut rappeler — le jour du camion au dépôt, lui, ne le concerne pas.
      signaux.push({
        niveau: R.niveaux.horsFlex, code: "HORS_FLEX", lot: a.lot, type: a.type,
        message: `${OPS[a.type].def} ${OPS[a.type].nom} chez le client du lot ${o.nom} (navette) est fixé${acc(a.type)} au ${jfr(tb.vl)}, hors de la fenêtre vendue au client (${jfr(isoDeJour(tb.clientMin))} au ${jfr(isoDeJour(tb.clientMax))}) : un rappel client est nécessaire.`,
        detail: { date: tb.vl, flex: [isoDeJour(tb.clientMin), isoDeJour(tb.clientMax)], vl: true },
      });
    } else if (a.horsFlex) {
      signaux.push({
        niveau: R.niveaux.horsFlex, code: "HORS_FLEX", lot: a.lot, type: a.type,
        message: `${opDuLot(a.type, o.nom)} est fixé${acc(a.type)} au ${jfr(a.dateJugee || a.date)}, hors de la fenêtre vendue au client (${jfr(isoDeJour(o.flexMin))} au ${jfr(isoDeJour(o.flexMax))}) : un rappel client est nécessaire.`,
        detail: { date: a.dateJugee || a.date, flex: [isoDeJour(o.flexMin), isoDeJour(o.flexMax)] },
      });
    }
    // Le bloc du camion au-delà de l'attente à quai (une date de camion imposée, ou glissée par le
    // mode diagnostic) : la marchandise attendrait plus de N jours ouvrés au dépôt. Orange, au niveau
    // de `horsFlex` (une date hors de sa fenêtre, pas une impossibilité). L'autre côté de la fenêtre
    // — avant la navette au chargement, après elle à la livraison — est le refus `TRANSBO_ORDRE`.
    if (tb && o.flexMin !== null && o.flexMax !== null) {
      const j = jourOuvre(a.dateJugee || a.date);
      const quai = a.type === "CHG" ? j > o.flexMax : j < o.flexMin;
      if (quai) {
        signaux.push({
          niveau: R.niveaux.horsFlex, code: "TRANSBO_QUAI", lot: a.lot, type: a.type,
          message: a.type === "CHG"
            ? `Le chargement au dépôt du lot ${o.nom} est fixé au ${jfr(a.date)} : la marchandise collectée le ${jfr(tb.vl)} attendrait au dépôt au-delà du ${jfr(isoDeJour(o.flexMax))}.`
            : `La livraison au dépôt du lot ${o.nom} est fixée au ${jfr(a.date)} : la marchandise attendrait au dépôt plus longtemps qu'admis avant la livraison du client le ${jfr(tb.vl)} (au plus tôt le ${jfr(isoDeJour(o.flexMin))}).`,
          detail: { date: a.date, vl: tb.vl, fenetre: [isoDeJour(o.flexMin), isoDeJour(o.flexMax)] },
        });
      }
    }
  }

  // ── LES CHIFFRES ─────────────────────────────────────────────────────────────────────────────
  const { jours, joursVides } = tracerJours(res);
  const listeLots = [...lots.values()];
  const geo = R.kmGardes === "geometriques";
  const km = geo ? Math.round(kmSequence(entree.camion?.depotCp, ops.map(o => o.cp), distance)) : res.km;
  let kmSeuls = 0;
  let kmSeulsSurs = true;
  for (const l of listeLots) {
    if (geo) { kmSeuls += kmLotSeul(l.depotCp, l.cpC, l.cpL, distance); continue; }
    const s = kmSeulReel(l, ops, R, abaque, distance);
    if (s === null) { kmSeuls += kmLotSeul(l.depotCp, l.cpC, l.cpL, distance); kmSeulsSurs = false; }
    else kmSeuls += s;
  }
  kmSeuls = Math.round(kmSeuls);
  const kmEvites = listeLots.length >= 2 ? kmSeuls - km : 0;

  if (joursVides > 0) {
    signaux.push({
      niveau: "info", code: "JOURS_VIDES", lot: null, type: null,
      message: `La tournée comporte ${joursVides} jour${joursVides > 1 ? "s" : ""} de tempo — de la place pour une mutualisation de plus.`,
      detail: { joursVides },
    });
  }

  if (listeLots.length >= 2 && kmEvites < 0) {
    signaux.push({
      niveau: "refus", code: "KM_EVITES_NEGATIFS", lot: null, type: null,
      message: `Cette tournée coûte ${-kmEvites} km de plus que les ${listeLots.length} lots faits séparément.`,
      detail: { km, kmSeuls, kmEvites, sur: kmSeulsSurs },
    });
  } else if (listeLots.length >= 2 && kmEvites === 0) {
    // Une tournée qui n'économise plus rien n'est plus une tournée : c'est la juxtaposition de
    // deux voyages sur le même camion. Cela arrive quand les dates écartent les lots au point que
    // le camion repasse par le dépôt entre les deux — et rien ne le disait au planificateur, qui
    // croyait tenir une mutualisation.
    signaux.push({
      niveau: "orange", code: "SANS_GAIN", lot: null, type: null,
      message: `Telle qu'elle est datée, cette tournée n'évite aucun kilomètre : le camion repasse par le dépôt entre les lots, comme s'ils étaient faits séparément.`,
      detail: { km, kmSeuls, coupuresDepot: res.coupures, sur: kmSeulsSurs },
    });
  }

  // ── LES GARDE-FOUS DE GREFFE ─────────────────────────────────────────────────────────────────
  const greffes = evaluerGreffes({ ops, lots: listeLots, entree, R, signaux, distance });

  const verdict = signaux.reduce((v, s) => pire(v, s.niveau), "ok");
  const periodes = normaliserSorties(res.sorties, R.arrondi === "fin");
  const occupe = occupationsDe(res.sorties, res.segments, R.arrondi === "fin");
  return {
    verdict, signaux, arrets, jours,
    chiffres: {
      km, kmSeuls, kmEvites,
      joursCamion: res.joursMobilises, joursVides,
      volumeMaxABord: res.volumeMaxABord,
      coupuresDepot: res.coupures,
      depart: isoDeJour(res.jourDepart), retour: isoDeJour(res.jourRetour),
      partiels,
    },
    comptes,
    sorties: periodes.sorties,
    sortiesFines: periodes.fines,
    occupations: occupe.occupations,
    occupationsFines: occupe.fines,
    greffes,
  };
}

// ── LES CODES POSTAUX INCONNUS ─────────────────────────────────────────────────────────────────
// Un signal par code postal fautif et par endroit : l'arrêt qui le porte, le dépôt du camion (toute
// la tournée en dépend), le dépôt de l'agence d'un lot (il fausse son « fait seul », donc les km
// évités). Un même CP déjà signalé sur un arrêt ne se répète pas pour un dépôt.
function signauxCpInconnus(ops, entree, lots, R) {
  const out = [];
  const vus = new Set();
  const niveau = R.niveaux.cpInconnu;
  for (const o of ops) {
    if (cpConnu(o.cp)) continue;
    vus.add(String(o.cp ?? ""));
    out.push({
      niveau, code: "CP_INCONNU", lot: o.lot, type: o.type,
      message: `Le code postal ${o.cp || "(vide)"} ${OPS[o.type].au === "au" ? "du" : "de la"} ${OPS[o.type].nom} du lot ${o.nom} n'est pas reconnu : les distances de cette tournée ne sont pas fiables.`,
      detail: { cp: o.cp ?? null, ou: "arret" },
    });
  }
  const depots = [[entree.camion?.depotCp, null, "depot_camion"],
    ...[...lots.values()].map(l => [l.depotCp, l, "depot_lot"])];
  for (const [cp, l, ou] of depots) {
    if (cp === undefined || cp === null || cpConnu(cp) || vus.has(String(cp))) continue;
    vus.add(String(cp));
    out.push({
      niveau, code: "CP_INCONNU", lot: l ? l.id : null, type: null,
      message: l
        ? `Le code postal ${cp} du dépôt de l'agence du lot ${l.nom || l.id} n'est pas reconnu : ses kilomètres « fait seul », donc les km évités, ne sont pas fiables.`
        : `Le code postal ${cp} du dépôt du camion n'est pas reconnu : les distances de cette tournée ne sont pas fiables.`,
      detail: { cp, ou },
    });
  }
  return out;
}

// ── G1 / G2 / G5, GREFFE PAR GREFFE ────────────────────────────────────────────────────────────
function evaluerGreffes({ ops, lots, entree, R, signaux, distance }) {
  if (lots.length < 2) return [];
  const rules = reglesMoteur(R);
  const lotsById = new Map(lots.map(l => [l.id, {
    id: l.id, soc: l.agence, cpC: l.cpC, cpL: l.cpL,
    vol: l.volume, fteC: l.chg?.fte, fteL: l.liv?.fte,
  }]));
  const arrets = ops.map(o => ({ lot: o.lot, type: o.type, cp: o.cp }));
  const structure = structureTournee(arrets);
  const depotCp = entree.camion?.depotCp;
  const depotLot = (id) => lots.find(l => l.id === id)?.depotCp || depotCp;

  if (R.zones && R.zones.length) {
    const g1 = g1Tournee({ structure, lotsById, depotCp, zones: R.zones, agencesData: R.agencesData });
    if (!g1.ok) {
      signaux.push({
        niveau: R.niveaux.gardes, code: "TERRITOIRE", lot: g1.acc, type: null,
        message: `Le lien entre les lots ${g1.anc} et ${g1.acc} ne tient pas la règle de territoire : ${g1.raison}.`,
        detail: g1,
      });
    }
  }

  const g = g2g5Tournee({ arrets, structure, lotsById, depotCp, depotLot, rules, km: distance });
  const liste = (g.greffes || []).map(x => ({
    lot: x.lot, lien: x.type, detourKm: x.detour, kmEvites: x.kmEco,
    rallongeJ: Math.round(x.rallongeJ * 1000) / 1000,
    g2: x.detour <= R.detourMaxKm,
    g5: x.kmEco >= R.rendementMinKmJ * x.rallongeJ,
  }));
  if (!g.ok) {
    const x = g.greffe;
    const nom = lots.find(l => l.id === x.lot)?.nom || x.lot;
    if (g.cause === "G2") {
      signaux.push({
        niveau: R.niveaux.gardes, code: "DETOUR", lot: x.lot, type: null,
        message: `Prendre le lot ${nom} rallonge la tournée de ${x.detour} km, au-delà des ${R.detourMaxKm} km admis pour une greffe.`,
        detail: x,
      });
    } else {
      signaux.push({
        niveau: R.niveaux.gardes, code: "RENDEMENT", lot: x.lot, type: null,
        message: `Le lot ${nom} n'évite que ${x.kmEco} km pour ${Math.round(x.rallongeJ * 10) / 10} jour de camion en plus : sous le seuil de ${R.rendementMinKmJ} km par jour.`,
        detail: x,
      });
    }
  }
  return liste;
}

// ── ÉCHECS ────────────────────────────────────────────────────────────────────────────────────
function motifDe(r) {
  if (r.fini && r.ruptures.length) return "dates_incompatibles";
  if (r.rupture && r.rupture.motif !== "fenetre_depassee") return r.rupture.motif;
  if (r.bloquee) return "flex_intenable";
  return r.rupture?.motif || null;
}

const MESSAGE_Q17 = {
  q17_semaine_insuffisante: "la mission ne tient pas dans une semaine de travail — le camion serait hors de son dépôt le week-end",
  // Depuis le 27/09, la règle d'or vaut aussi pour les jours fériés (« comme un week-end »).
  q17_retour_impossible: "le camion ne peut plus rentrer à son dépôt avant le week-end ou le jour férié",
  q17_weekend_charge: "le camion devrait passer le week-end (ou le jour férié) dehors, chargé, ce que le réglage interdit",
  boucle_q17: "aucun enchaînement ne permet de rentrer au dépôt chaque week-end et chaque jour férié",
};

// ── LE BLOC TRANSBORDÉ DU MAUVAIS CÔTÉ DE LA NAVETTE (28/09) ─────────────────────────────────
// `sens` : "avant" (un chargement au dépôt avant la fin de la collecte chez le client) ou "apres"
// (une livraison au dépôt qui ne serait pas finie avant que la navette livre le client). `date` :
// le jour du camion en cause (imposé, ou `null` quand c'est la passe qui n'a trouvé aucun moment).
function signalTransboOrdre(o, sens, date) {
  const tb = o.transbo;
  const quand = (t) => `${jfr(isoDeJour(Math.floor(t / 2)))}${t % 2 ? " après-midi" : ""}`;
  if (sens === "avant") {
    return {
      niveau: "refus", code: "TRANSBO_ORDRE", lot: o.lot, type: o.type,
      message: `Le chargement au dépôt du lot ${o.nom}${date ? ` est fixé au ${jfr(date)} :` : " :"} le camion ne peut charger au dépôt qu'après la collecte chez le client par la navette (${jfr(tb.vl)}), au plus tôt le ${quand(tb.tMin)}.`,
      detail: { date, vl: tb.vl, sens, auPlusTot: isoDeJour(Math.floor(tb.tMin / 2)), apresMidi: tb.tMin % 2 === 1 },
    };
  }
  const veille = Math.ceil(tb.tFinMax / 2) - 1;
  return {
    niveau: "refus", code: "TRANSBO_ORDRE", lot: o.lot, type: o.type,
    message: `La livraison au dépôt du lot ${o.nom}${date ? ` est fixée au ${jfr(date)} :` : " :"} le camion doit avoir livré au dépôt avant que la navette livre le client (${jfr(tb.vl)}), au plus tard le ${jfr(isoDeJour(veille))} au soir.`,
    detail: { date, vl: tb.vl, sens, auPlusTard: isoDeJour(veille) },
  };
}

// 🔑 L'ORDRE COMPTE. « Aucun jour de la flex ne convient » est vrai de presque tous les échecs,
// mais ce n'est presque jamais l'explication utile : si le camion est trop petit ou si la règle
// d'or bloque, c'est ÇA qu'il faut dire au planificateur, pas « élargissez la fenêtre ».
function signalEchec(rempli, ops, entree, R) {
  const rupt = rempli.rupture || {};
  const o = ops[rupt.arret] || {};
  const cp = entree.camion?.depotCp;
  const dur = rupt.motif && rupt.motif !== "fenetre_depassee";

  if (!dur && rempli.bloquee) {
    const b = rempli.bloquee;
    // Un bloc transbordé : sa fenêtre n'est pas celle vendue au client, c'est l'attente à quai
    // autour de la navette (28/09).
    const quelle = b.transbo ? "du transbordement" : "vendue";
    const quoi = b.transbo ? `${OPS[b.type].ind} ${OPS[b.type].nom} au dépôt du lot ${b.nom}` : opDuLot(b.type, b.nom, false);
    return {
      niveau: "refus", code: "FLEX_INTENABLE", lot: b.lot, type: b.type,
      message: b.flexMin === null
        ? `${opDuLot(b.type, b.nom)} n'a aucune fenêtre exploitable.`
        : `Aucun jour de la fenêtre ${quelle} (${jfr(isoDeJour(b.flexMin))} au ${jfr(isoDeJour(b.flexMax))}) ne permet de tenir ${quoi} dans cette tournée.`,
      detail: { flex: b.flexMin === null ? null : [isoDeJour(b.flexMin), isoDeJour(b.flexMax)], ...(b.transbo ? { transbo: true } : {}) },
    };
  }
  // Une livraison au dépôt IMPOSÉE qui ne peut pas être finie avant la navette, même en repartant
  // du dépôt : la glisser plus tard la mettrait après le client — le refus du 28/09, pas un « au
  // mieux le … ». Le jour est permis ; c'est la route qui n'y arrive pas à temps.
  if (rupt.motif === "fenetre_depassee" && rupt.detail?.finMax != null && o.transbo) {
    const x = signalTransboOrdre(o, "apres", null);
    return {
      ...x,
      message: `La livraison au dépôt du lot ${o.nom} ne peut pas être finie avant que la navette livre le client (${jfr(o.transbo.vl)})${o.dateImposee ? ` : fixée au ${jfr(o.dateImposee)}, le camion n'arrive pas à temps au dépôt, même au compte serré` : ""}.`,
      detail: { ...x.detail, date: o.dateImposee, route: true },
    };
  }
  if (rupt.motif === "capacite") {
    return {
      niveau: "refus", code: "CAPACITE", lot: o.lot, type: o.type,
      message: `Le camion porterait ${Math.round((rupt.detail?.aBord || 0) * 100) / 100} m³ après le chargement du lot ${o.nom || ""}, pour une capacité de ${rupt.detail?.capacite} m³.`,
      detail: rupt.detail,
    };
  }
  if (rupt.motif === "sequence_invalide") {
    return {
      niveau: "refus", code: "ORDRE_INVALIDE", lot: o.lot, type: o.type,
      message: `L'ordre des arrêts est incohérent : le lot ${o.nom || ""} est livré alors qu'il n'est pas à bord.`,
      detail: rupt.detail,
    };
  }
  // La règle des 150 km (Louis, 01/10 — ajout ⑩ de `passe.js`) : l'arrêt ne passe pas avant le
  // week-end (ou le férié), et le camion ne rentre pas chargé au dépôt pour repartir le livrer au
  // loin. Un refus à part, avec sa phrase : ce n'est pas « la règle d'or » qui est en cause (le camion
  // POURRAIT rentrer), c'est l'aller-retour chargé qu'on ne fait pas. La phrase dit les deux issues.
  if (rupt.motif === "q17_coupure_chargee_loin") {
    const d = rupt.detail || {};
    return {
      niveau: "refus", code: "COUPURE_CHARGEE_LOIN", lot: o.lot, type: o.type,
      message: `${o.nom ? opDuLot(o.type, o.nom) : "Cet arrêt"} ne passe pas avant le week-end ou le jour férié, et se trouve à ${d.kmApres} km du dépôt : le camion ne rentre pas chargé pour repartir ${o.type === "CHG" ? "charger" : "livrer"} à plus de ${d.max} km. Avancez la tournée pour finir avant, ou passez par un transbordement.`,
      detail: d,
    };
  }
  if (MESSAGE_Q17[rupt.motif]) {
    return {
      niveau: "refus", code: "Q17", lot: o.lot, type: o.type,
      message: `Règle d'or : ${MESSAGE_Q17[rupt.motif]}${o.nom ? ` (bloqué sur ${opDuLot(o.type, o.nom, false)}` : ""}${o.nom && cp ? `, dépôt ${cp})` : o.nom ? ")" : ""}.`,
      detail: rupt.detail,
    };
  }
  // Une opération LIBRE dont la fenêtre est dépassée : sa flex ne contient aucun jour tenable.
  return {
    niveau: "refus", code: "FLEX_INTENABLE", lot: o.lot, type: o.type,
    message: `Aucun jour de la fenêtre ${o.type ? `de ${opDuLot(o.type, o.nom, false)}` : "de l'arrêt"} ne permet de tenir cette tournée, même au compte serré (${R.comptes.juste.kmParJour} km par jour).`,
    detail: rupt.detail,
  };
}

function refusImmediat(erreurs) {
  const signaux = erreurs.map(e => ({ niveau: "refus", code: e.code, lot: e.lot ?? null, type: e.type ?? null, message: e.message, detail: null }));
  return sortieRefus(signaux, []);
}

function sortieRefus(signaux, ops, fenetres) {
  return {
    verdict: "refus", signaux,
    arrets: (ops || []).map((o, k) => ({
      lot: o.lot, type: o.type,
      date: fenetres?.[k] ? isoDeJour(fenetres[k][0]) : (o.dateImposee || null),
      libre: o.imposee === null, horsFlex: false, ecartSouhaiteJ: null,
      demiDebut: null, demiFin: null,
    })),
    jours: [],
    chiffres: {
      km: 0, kmSeuls: 0, kmEvites: 0, joursCamion: 0, joursVides: 0, volumeMaxABord: 0,
      coupuresDepot: 0, depart: null, retour: null, partiels: true,
    },
    comptes: { large: { tient: false, motif: "refus" }, juste: { tient: false, motif: "refus" } },
    sorties: [], sortiesFines: [], occupations: [], occupationsFines: [], greffes: [],
  };
}

// ── « DÉCALER LA SUITE » ───────────────────────────────────────────────────────────────────────
//
// SÉMANTIQUE, sans piège : `depuis` désigne un arrêt qu'on garde EN PLACE, et le geste libère ce
// qui le SUIT. C'est « à partir de cet arrêt-là, recalcule » au sens de « cet arrêt est mon point
// d'appui », pas « cet arrêt est mon problème ».
//
// ⚠️ D'où une chausse-trappe signalée par la maquette : quand c'est la DERNIÈRE livraison qui
// coince, `depuis = cette livraison` ne libère RIEN, et le geste ne répare rien. Il fallait penser
// à désigner l'arrêt PRÉCÉDENT. `inclure: true` supprime ce détour : l'arrêt désigné est libéré
// lui aussi, s'il n'est pas confirmé.
//
// `depuis` accepte trois formes — la signature ne change pas, la maquette l'appelle déjà :
//   · un NOMBRE            — index dans `entree.ordre` ; libère ce qui suit ;
//   · `{ lot, type }`      — le même, désigné par son arrêt ;
//   · `{ …, inclure: true }` — libère AUSSI l'arrêt désigné ; s'écrit aussi `{ index: n, inclure: true }`.
//
// Une opération CONFIRMÉE n'est jamais libérée, quelle que soit la forme : `inclure` ne force rien.
// Rend `{ entree, resultat }` et ne modifie aucun objet reçu.
export function proposerDecalage(entree, depuis, reglagesPartiels) {
  const ordre = entree.ordre || [];
  const idx = typeof depuis === "number"
    ? depuis
    : typeof depuis?.index === "number"
      ? depuis.index
      : ordre.findIndex(a => a.lot === depuis?.lot && a.type === depuis?.type);
  const inclure = typeof depuis === "object" && depuis !== null && depuis.inclure === true;

  const aLiberer = new Set();
  for (let i = Math.max(0, idx) + (inclure ? 0 : 1); i < ordre.length; i++) {
    aLiberer.add(`${ordre[i].lot}|${ordre[i].type}`);
  }
  const lots = (entree.lots || []).map(l => {
    const copie = { ...l };
    for (const t of ["chg", "liv"]) {
      const op = l[t === "chg" ? "chg" : "liv"];
      if (!op) continue;
      const cle = `${l.id}|${t === "chg" ? "CHG" : "LIV"}`;
      copie[t] = aLiberer.has(cle) && !op.confirme
        ? { ...op, date: null, prefere: op.prefere ?? op.date ?? null }
        : { ...op };
    }
    return copie;
  });

  const proposition = { ...entree, lots };
  return { entree: proposition, resultat: evaluerTournee(proposition, reglagesPartiels) };
}

export { kmEntre };
