import { gc, hav, gcPrecision } from '../data/gps.js';
import { RULES_DEFAULTS, LOT_STATUS, parseDur, manutHeures, seuilProxRetour } from '../data/referentiels.js';
import { debug } from '../utils/debug.js';
import { hasWeekendBetween, diffDaysIso, datesAround, addWorkdays, subWorkdays, diffWorkdays, buildWorkAxis, getMonday, addDaysIso } from '../utils/dates.js';
import { isLotLocked } from '../utils/statusHelpers.js';
import { dateChgSouhaitee, dateLivSouhaitee, flexChgJours } from '../utils/datesBoucle.js';
import { checkRetourPiliers, checkMutuZones } from '../utils/zones.js';
import { lienDecide, pairesMutu, liensDuLot, rolesDuLot, tourneesDeBoucles, maillonsEnVolVers, ecrireLien } from '../utils/boucleLiens.js';
import { mesuresRetour as mesuresRetourAccroche, mesuresMutu as mesuresMutuAccroche } from './mesuresBoucle.js';
import { evaluerGardes } from './gardesBoucle.js';
import { agLookup, memePerimetreMutu, DAY_START, DAY_END, toAbs, fromAbs, findFridayIdx, buildChain, buildMutuChain, plagesDuLot, plagesCommunes, plageAt, attenteMaxCollecte, chaineTraverseWeekend } from './chainBuilder.js';

// Ré-export pour compatibilité : parseDur vit désormais dans data/referentiels.js
// (définition unique — audit 2026-07-19), mais les consommateurs historiques
// (tests, OneFleet) l'importent d'ici.
export { parseDur };

// ── Q15 — CONTRAINTE DURE : LE CHARGEMENT D'UN DOSSIER VENDU NE BOUGE JAMAIS ────
// Arbitrage Louis 2026-07-31, après le diagnostic CHT-463530/CHT-400887 : la mutualisation y
// avait déplacé le chargement de l'ancre du vendredi 18/09 au lundi 21/09 pour satisfaire la
// garde week-end (Q17). Les deux règles sont absolues — quand elles se contredisent, ce n'est
// PAS un arbitrage à rendre au cas par cas : la boucle n'existe simplement pas. Aucune
// proposition, aucun avertissement, aucun « décalage assumé ».
//
// Jusqu'ici la règle vivait en DEUX exemplaires divergents :
//   • en mutualisation, un simple critère de TRI (`chgAncTenu`) : quand aucune séquence ne tenait
//     la date vendue, la boucle passait quand même, avec un log en guise de conscience ;
//   • en retour et dans detectBoucles, rien du tout — la date de B n'était jamais RELUE après
//     le passage du planificateur, seulement supposée intacte par les commentaires.
// D'où ce prédicat UNIQUE, appelé par les trois chemins : impossible de rediverger, et un
// quatrième chemin ajouté demain n'a qu'une seule fonction à appeler.
//
// `blocks` = la chaîne effectivement PLANIFIÉE (invariant « proposé = posé » : on relit la sortie
// du vrai planificateur, jamais une estimation). Égalité STRICTE : charger un dossier vendu plus
// tôt que la date convenue est aussi impossible que plus tard — le client n'est pas prêt.
// Chargement introuvable ou débordant hors axe ⇒ non tenu (on ne valide jamais sur une absence).
export function chgVenduTenu(blocks, lot) {
  if (!lot?.dateC) return true; // aucune date vendue connue → rien à protéger
  const chgs = (blocks || []).filter(b => b.type === "chg" && b.lotId === lot.id);
  if (!chgs.length || chgs.some(b => b._overflow)) return false;
  // Un chargement long est découpé en parts : la date qui engage le client est celle de la 1ʳᵉ.
  return chgs.map(b => b.date).filter(Boolean).sort()[0] === lot.dateC;
}

// ── UNE MUTUALISATION EST-ELLE TENUE PAR LA POSE ? (arbitrage Louis 2026-08-01) ──────────────────
// Une mutualisation acceptée peut ne pas être tenue à la pose : quand aucune chaîne imbriquée ne
// respecte les dates vendues, `reflowVehicle` repose les deux dossiers SÉPARÉMENT (le filet Q15).
// La boucle, elle, reste `accepted` en base — c'est une décision du planificateur, le moteur ne la
// détruit pas dans son dos. Résultat : la fiche affichait « ⇌ Mutualisation, −1236 km » au-dessus
// d'un Gantt qui posait deux allers-retours complets. Le chiffre n'était encaissé nulle part.
//
// D'où ce prédicat, qui se prononce sur les BLOCS RÉELLEMENT POSÉS et rien d'autre — aucun champ
// nouveau à persister, aucune croyance à maintenir à jour : la mutualisation est un FAIT observable
// du planning. Signature d'une paire réellement mutualisée : les deux missions sont IMBRIQUÉES —
// chacun des deux dossiers est chargé avant que l'autre ne soit livré. Reposés séparément, le
// premier est livré (et le camion rentré au dépôt) avant que le second ne charge.
//
// Renvoie `null` — et non `false` — quand la pose est incomplète ou absente : on ne crie pas au
// loup sur une donnée manquante (fiche ouverte avant chargement des placements, dossier pas encore
// posé). Symétrique de la prudence de `chgVenduTenu`, qui ne VALIDE jamais sur une absence.
export function mutuTenueALaPose(blocks, lotId, partnerId) {
  if (!lotId || !partnerId) return null;
  const datesDe = (type, id) => (blocks || [])
    .filter(b => b.type === type && b.lotId === id && !b._overflow)
    .map(b => b.date).filter(Boolean).sort();
  const chgLot = datesDe("chg", lotId)[0];
  const chgPar = datesDe("chg", partnerId)[0];
  const livLot = datesDe("liv", lotId).pop();
  const livPar = datesDe("liv", partnerId).pop();
  if (!chgLot || !chgPar || !livLot || !livPar) return null;
  return chgLot <= livPar && chgPar <= livLot;
}

// ── UNE BOUCLE A-T-ELLE ÉTÉ DÉCIDÉE ? (arbitrage Louis 2026-08-03) ───────────────────────────────
// POURQUOI : le badge ★ du Gantt et le compteur « km économisés » ne doivent créditer QUE des
// boucles que le planificateur a ARBITRÉES, jamais un simple voisinage sur le camion.
// Avant, `detectBoucles` qualifiait de « boucle » deux dossiers seulement parce qu'ils étaient
// posés l'un derrière l'autre et que la géométrie collait — un glisser-déposer, ou le pur hasard
// du planning, suffisait à décrocher l'étoile et à créditer des kilomètres que personne n'avait
// décidé d'économiser. Le KPI comptait alors des gains fictifs (cas constaté : CHT-735480 →
// CHT-254940, deux dossiers JAU voisins, 500 km crédités sans aucune boucle acceptée).
//
// La DÉCISION est matérialisée par le couple `_boucleType` / `_boucleWith` posé sur les DEUX
// dossiers au moment où le planificateur accepte une proposition du moteur (retour : à
// l'acceptation par l'agence opératrice ; mutualisation : au placement direct). On exige donc un
// lien NOMMÉ vers l'autre dossier — pas seulement un `_boucleType` quelconque, qui pourrait venir
// d'une boucle formée avec un TROISIÈME dossier.
//
// Le lien suffit dans UN sens : le retour tague l'accroché à la création du dossier et l'ancre
// seulement à l'acceptation — entre les deux, un seul côté porte la référence.
//
// ⚠️ Ce prédicat ne se prononce QUE sur la qualification (badge + km évités). Il ne pilote NI le
// chaînage des camions, NI le fait qu'un dossier en suive un autre sur le Gantt : deux dossiers
// voisins continuent de s'enchaîner exactement comme avant, ils ne portent simplement plus de
// décoration « boucle ».
// ⚠️ Le prédicat lui-même vit désormais dans `utils/boucleLiens.js` (M3P étape ①, 2026-08-13) —
// point de lecture unique des liens de boucle, avec les autres. Rien n'a changé de son contenu :
// c'est le même test, au même endroit du raisonnement, simplement écrit là où la bascule vers la
// notion de TOURNÉE (ADR 0010) viendra le modifier une fois pour toutes. `boucleDecidee` reste
// exporté d'ici : c'est le nom que connaissent le moteur, les tests et l'interface.
export function boucleDecidee(lotUn, lotDeux) {
  return lienDecide(lotUn, lotDeux);
}

// ── FORMULE UNIQUE « KM ÉVITÉS » (BOUCLE RETOUR) ────────────────────────────────
// Unifiée le 2026-07-23. La MÊME formule décide la boucle (findBoucleCandidates),
// la score, s'affiche sur la carte de suggestion, ET alimente la pastille Gantt / le
// KPI (via detectBoucles). Avant, detectBoucles ne comptait qu'un seul terme (le retour
// à vide de l'ancre) → un chiffre ~2× plus petit que la valeur de décision. Ce helper est
// le point unique : les deux fonctions l'appellent, elles ne peuvent plus rediverger.
//
// Rôles EXPLICITES — le nommage lotAcc/lotAnc est INVERSÉ entre les deux appelants, donc on
// raisonne en rôles, jamais en noms de variables :
//   ancre  = lot chronologiquement premier ; son PL, basé au dépôt de son agence
//              VENDEUSE, ancre le trajet et rentre au dépôt à la fin.
//   accroché = lot repris au retour depuis la zone de livraison de l'ancre.
// kmEco = (ancre seule + accroché seul) − trajet combiné, où :
//   « seul »  = dépôt(agence vendeuse) → chg → liv → dépôt (chaque lot fait son aller-retour)
//   combiné   = dépôt ancre → chgP → livP → chgAcc → livAcc → dépôt ancre
// Tolérance GPS (cf. garde ligne rail __RAIL_ROUTE__) : renvoie null si un point manque —
// l'appelant garde alors son repli et NE fabrique PAS un chiffre fantaisiste.
export function kmEcoBoucleRetour({ depotAncre, chgAncre, livAncre, depotAccroche, chgAccroche, livAccroche }) {
  if (!depotAncre || !chgAncre || !livAncre || !depotAccroche || !chgAccroche || !livAccroche) return null;
  const ancreSeule = hav(depotAncre, chgAncre) + hav(chgAncre, livAncre) + hav(livAncre, depotAncre);
  const accrocheSeul = hav(depotAccroche, chgAccroche) + hav(chgAccroche, livAccroche) + hav(livAccroche, depotAccroche);
  const combine = hav(depotAncre, chgAncre)
    + hav(chgAncre, livAncre)
    + hav(livAncre, chgAccroche)
    + hav(chgAccroche, livAccroche)
    + hav(livAccroche, depotAncre);
  return {
    kmEco: Math.round((ancreSeule + accrocheSeul) - combine),
    ancreSeule: Math.round(ancreSeule),
    accrocheSeul: Math.round(accrocheSeul),
    combine: Math.round(combine),
  };
}

// « KM ÉVITÉS » — VERSION RÉELLE (arbitrage Louis 2026-07-28).
// `kmEcoBoucleRetour` ci-dessus compare des circuits GÉOMÉTRIQUES : dépôt→chg→liv→dépôt à vol
// d'oiseau, sans calendrier. Or ce sont les horaires, les week-ends et le retour dépôt du vendredi
// (Q17) qui créent les kilomètres — la pose peut insérer des trajets que le circuit idéal ignore.
// Le planificateur voyait donc un gain sans rapport avec le gain réel. On compare désormais ce qui
// sera RÉELLEMENT roulé, à partir des chaînes posées par buildChain.
//
// Les quatre chaînes attendues (l'appelant les fournit — il sait lesquelles correspondent à SA
// proposition, invariant « proposé = posé ») :
//   chaineAncre      — l'ancre tel qu'il roule DANS la boucle (son retour dépôt final saute :
//                        le PL enchaîne sur l'accroché au lieu de rentrer à vide)
//   chaineAccroche     — l'accroché repris depuis la zone de livraison de l'ancre, retour dépôt inclus
//   chaineAncreSeule  — l'ancre seul, aller-retour depuis le dépôt de son agence vendeuse
//   chaineAccrocheSeul — idem pour l'accroché
// Renvoie null si une chaîne est vide ou déborde de l'axe : l'appelant garde alors son repli
// géométrique plutôt que d'afficher un chiffre faux.
const EST_RETOUR_FINAL = (b) => (b.type === "vid" || b.type === "ret") && !b._weekendDepot;
const kmDesBlocs = (blocks, { sansRetourFinal = false } = {}) => (blocks || [])
  .filter(b => !b._overflow && !(sansRetourFinal && EST_RETOUR_FINAL(b)))
  .reduce((s, b) => s + (b.km || 0), 0);

export function kmEcoBoucleRetourReel({ chaineAncre, chaineAccroche, chaineAncreSeule, chaineAccrocheSeul }) {
  const chaines = [chaineAncre, chaineAccroche, chaineAncreSeule, chaineAccrocheSeul];
  if (chaines.some(c => !c || !c.length || c.some(b => b._overflow))) return null;
  // Dans la boucle, l'ancre ne rentre pas au dépôt : le PL repart vers le chargement de
  // l'accroché. Sa coupure du vendredi (_weekendDepot) est en revanche un retour INTERNE, conservé.
  const combine = kmDesBlocs(chaineAncre, { sansRetourFinal: true }) + kmDesBlocs(chaineAccroche);
  const ancreSeule = kmDesBlocs(chaineAncreSeule);
  const accrocheSeul = kmDesBlocs(chaineAccrocheSeul);
  if (!combine || !ancreSeule || !accrocheSeul) return null;
  return {
    kmEco: Math.round((ancreSeule + accrocheSeul) - combine),
    ancreSeule: Math.round(ancreSeule),
    accrocheSeul: Math.round(accrocheSeul),
    combine: Math.round(combine),
  };
}

// « KM ÉVITÉS » D'UNE MUTUALISATION — VERSION GÉOMÉTRIQUE.
// Sœur exacte de `kmEcoBoucleRetour` ci-dessus, extraite d'`evaluerMutu` le 2026-08-06 (elle y était
// recopiée en ligne, donc invisible et inappelable de l'extérieur : les outils d'analyse ne
// pouvaient pas chiffrer une mutualisation « sur le papier », alors qu'ils le font pour les retours
// depuis toujours). Même méthode, même contrat, même repli null : c'est un RANGEMENT, pas un
// changement de règle — `evaluerMutu` appelle désormais ce helper au lieu de refaire le calcul.
//
// Une seule vraie différence avec le retour : la mutualisation admet DEUX ordres de tournée, et on
// retient le moins roulant. Les deux dossiers voyagent ensemble (d'où la contrainte de capacité,
// qui n'existe pas au retour et qui reste à la charge de l'appelant — elle n'est pas géométrique).
//   S1 — dépôt → chg ANC → chg ACC → liv ACC → liv ANC → dépôt   (dernier chargé, premier livré)
//   S2 — dépôt → chg ACC → chg ANC → liv ANC → liv ACC → dépôt
//
// TROIS DÉPÔTS, à ne surtout pas confondre (correctif mutualisation régionale, 2026-07-29) :
//   depotCircuit         — dépôt du CAMION (celui de l'ancre) : le circuit combiné en part et y revient ;
//   depotVendeuseAncre   — dépôt de l'agence VENDEUSE de l'ancre, pour son trajet « tout seul » ;
//   depotVendeuseAccroche— idem pour l'accroché. Entre deux agences d'une même région ce n'est PAS
//                          le même point que `depotCircuit`, et les confondre minore le trajet
//                          « sans boucle » donc gonfle l'économie affichée.
// Les champs `brut` portent les valeurs NON arrondies : le moteur en a besoin pour départager S1/S2
// et pour ses replis, l'arrondi ne servant qu'à l'affichage et aux outils d'analyse.
export function kmEcoMutualisation({
  depotCircuit, depotVendeuseAncre, depotVendeuseAccroche,
  chgAncre, livAncre, chgAccroche, livAccroche,
}) {
  if (!depotCircuit || !depotVendeuseAncre || !depotVendeuseAccroche
    || !chgAncre || !livAncre || !chgAccroche || !livAccroche) return null;
  const ancreSeule = hav(depotVendeuseAncre, chgAncre) + hav(chgAncre, livAncre) + hav(livAncre, depotVendeuseAncre);
  const accrocheSeul = hav(depotVendeuseAccroche, chgAccroche) + hav(chgAccroche, livAccroche) + hav(livAccroche, depotVendeuseAccroche);
  const kmS1 = hav(depotCircuit, chgAncre) + hav(chgAncre, chgAccroche)
    + hav(chgAccroche, livAccroche) + hav(livAccroche, livAncre) + hav(livAncre, depotCircuit);
  const kmS2 = hav(depotCircuit, chgAccroche) + hav(chgAccroche, chgAncre)
    + hav(chgAncre, livAncre) + hav(livAncre, livAccroche) + hav(livAccroche, depotCircuit);
  const prendreS1 = kmS1 <= kmS2;
  const combine = prendreS1 ? kmS1 : kmS2;
  return {
    kmEco: Math.round((ancreSeule + accrocheSeul) - combine),
    ancreSeule: Math.round(ancreSeule),
    accrocheSeul: Math.round(accrocheSeul),
    combine: Math.round(combine),
    seq: prendreS1 ? "S1" : "S2",
    brut: { ancreSeule, accrocheSeul, kmS1, kmS2 },
  };
}

// ── SCORE QUALITATIF D'UNE PROPOSITION ──
// Le score répond à « est-ce que ça vaut le coup ? », qui est une question de PROPORTION : 200 km
// évités ne veulent pas dire la même chose sur un aller-retour de 500 km que sur un de 3 000.
// L'ancienne échelle en km absolus (scoreExcellentKm…) est supprimée — une seule échelle, en %,
// pour que la couleur du panneau, la pastille du Gantt et le KPI racontent la même histoire.
//
// Le dénominateur est le trajet des DEUX lots posés séparément : c'est ce qu'on aurait roulé sans
// la boucle. Renvoie un entier 0-100 (0 si le gain est nul ou le total inconnu).
export function pctGainBoucle(kmEco, kmASeul, kmBSeul) {
  const total = (kmASeul || 0) + (kmBSeul || 0);
  if (!total || !kmEco || kmEco <= 0) return 0;
  return Math.round((kmEco / total) * 100);
}

export function scoreBoucle(pct, rules = RULES_DEFAULTS) {
  if (pct >= (rules.scoreExcellentPct ?? 30)) return "excellent";
  if (pct >= (rules.scoreBonPct ?? 15)) return "bon";
  if (pct >= (rules.scorePossiblePct ?? 5)) return "possible";
  return "neutre";
}

// ── BOUCLE DETECTION ──
// Detects if consecutive lots on a PL form a boucle.
// Logic: for each pair of chronologically consecutive lots A→B:
//   1. Dates cohérentes: B loads on or after A delivers (écart 0-3 jours ouvrés, dates ISO)
//   2. Pas de week-end entre livAcc et chgAnc (audit 2026-07-19, B1 : règle métier « un week-end
//      intercalé casse la boucle » — alignement sur findBoucleCandidates et reflowVehicle)
//   3. Position cohérente: liaison livAnc → chgAcc ≤ seuilProxRetourKm (même F4 que les propositions
//      de RETOUR — c'est la géométrie mesurée ici ; cf. commentaire au point d'application)
// If all conditions met → drop A's route vide and re-chain B from A's delivery point.
// Le rechaînage de B passe par le VRAI planificateur buildChain (audit 2026-07-19, B3/B4 :
// l'ancienne copie locale « rebuildLotAnc » divergeait — liaison perdue, règle même-jour absente).
export function detectBoucles(blocks, lots, vehicule, weekDays, agencesData = [], rules = RULES_DEFAULTS) {
  if (!blocks || blocks.length === 0) return blocks;
  // Ligne rail virtuelle : pas d'agence réelle (dépôt fictif « centre France ») → les distances
  // de liaison/« km évités » seraient fantaisistes. Pas de détection de boucle sur cette ligne.
  if (vehicule?.id === "__RAIL_ROUTE__") return blocks;

  const lotIds = [];
  const lotBlocks = {};
  blocks.forEach(b => {
    if (!b.lotId) return;
    if (!lotBlocks[b.lotId]) { lotBlocks[b.lotId] = []; lotIds.push(b.lotId); }
    lotBlocks[b.lotId].push(b);
  });

  if (lotIds.length < 2) return blocks;

  // Tri chronologique par DATE ISO du premier chargement (et non par index de fenêtre :
  // les blocs conservés d'un lot hors axe portent des index d'un autre axe).
  const firstChgDate = (id) => (lotBlocks[id] || [])
    .filter(x => x.type === "chg" && x.date && !x._overflow)
    .map(x => x.date).sort()[0] || "9999-12-31";
  lotIds.sort((a, b) => (firstChgDate(a) < firstChgDate(b) ? -1 : firstChgDate(a) > firstChgDate(b) ? 1 : 0));

  // ── LES UNITÉS DE TOURNÉE — UNE PAIRE MUTUALISÉE EST INSÉCABLE (correctif α, 2026-08-13) ──────
  // CE QUI SE PASSAIT. Cette fonction parcourait les dossiers DEUX PAR DEUX et rechaînait le second
  // derrière le premier avec `buildChain`, le planificateur d'UN SEUL dossier. Elle ne savait pas
  // qu'une paire mutualisée forme un bloc : sur un camion portant `X` puis la paire `(P, Q)`, elle
  // prenait le couple `(X, P)`, rebâtissait P TOUT SEUL depuis la livraison de X, et laissait Q sur
  // place. Résultat : quatre blocs de transport au lieu de deux, deux livraisons dans le même
  // créneau, et un kilométrage qui explosait (1 842 km affichés pour ~920 km roulés — cas
  // fondateur du 06/08 ; reproduit ici à 1 493 km pour ~970).
  //
  // On raisonne donc en UNITÉS : un dossier seul, ou une paire mutualisée dont les deux membres
  // comptent pour une. La lecture des paires passe par le point unique `pairesMutu`
  // (`utils/boucleLiens.js`) — la même que celle de la POSE, pour qu'elles ne puissent plus diverger.
  //
  // ⚠️ Ce n'est PAS une notion nouvelle : c'est la TOURNÉE de l'ADR 0010, vue du moteur de pose.
  // Quand le modèle de données saura la dire (M3P), une unité pourra compter jusqu'à quatre
  // dossiers — une mutualisation, un retour, et la mutualisation de l'autre bout.
  //
  // Chaque unité porte ses `membres` ET son `ancreId` — le dossier qui l'ANCRE. Pour un dossier
  // seul c'est lui-même ; pour une paire, c'est le dossier VENDU et déjà posé, celui dont la
  // mission fixe les dates, le camion et donc le dépôt. C'est cette identité que réclame la règle
  // des zones (P8, tranché plus bas), et elle ne se déduit PAS de la position : `_mutuRole` la
  // porte (cf. le piège historique A/B dans `CLAUDE.md`).
  const lotsPresents = lotIds.map(id => lots.find(l => l.id === id)).filter(Boolean);
  const uniteParLot = new Map();
  // `mutu` porte de quoi REJOUER la tournée de la paire (les deux lots et leur séquence) : c'est
  // ce qui permet, plus bas, de comparer l'accroché à la tournée DÉJÀ acquise et non à ses membres
  // pris séparément. Sur une unité d'un seul dossier, `mutu` reste absent.
  pairesMutu(lotsPresents).forEach(({ lotAcc: mAcc, lotAnc: mAnc, sequence }) => {
    const unite = { membres: [mAcc.id, mAnc.id], ancreId: mAnc.id, mutu: { lotAcc: mAcc, lotAnc: mAnc, sequence } };
    unite.membres.forEach(id => uniteParLot.set(id, unite));
  });
  const unites = [];
  const dejaDansUneUnite = new Set();
  lotIds.forEach(id => {
    if (dejaDansUneUnite.has(id)) return;
    const unite = uniteParLot.get(id) || { membres: [id], ancreId: id };
    unite.membres.forEach(m => dejaDansUneUnite.add(m));
    unites.push(unite);
  });
  if (unites.length < 2) return blocks;

  const newBlocks = [...blocks];

  // Fin de bloc en absolu, avec le même repli que le reste de la fonction (les blocs fabriqués à la
  // main dans les tests ne portent pas toujours `endAbs`).
  const finDe = (b) => b.endAbs || toAbs(b.day, b.endH || DAY_END);

  for (let i = 0; i < unites.length - 1; i++) {
    const uniteAnc = unites[i];
    const uniteAcc = unites[i + 1];

    // L'ACCROCHÉ NE PEUT PAS ÊTRE UNE PAIRE. Raccrocher une mutualisation derrière une mission,
    // c'est le COUPLAGE (Q-F) : il demande de simuler la paire avec `buildMutuChain` puis de
    // chaîner depuis sa fin, ce que cette fonction ne fait pas. Rebâtir un seul de ses membres la
    // détruirait — c'était α. On laisse donc la pose telle quelle : le camion enchaîne exactement
    // comme `reflowVehicle` l'a décidé, sans badge ni kilomètres. Rejet NOMMÉ, jamais muet.
    if (uniteAcc.membres.length > 1) {
      debug.inc("boucle_rejets_accroche_en_paire");
      debug.log("BOUCLE", `  detectBoucles ${uniteAnc.membres.join("+")}→${uniteAcc.membres.join("+")} : pas de rechaînage — l'accroché est une paire mutualisée (couplage non traité ici, cf. Q-F) ; la pose est conservée`);
      continue;
    }

    const lotAccId = uniteAcc.membres[0];
    const lotAcc = lots.find(l => l.id === lotAccId);
    if (!lotAcc) continue;

    // Marqueurs overflow exclus : leur day/date sont artificiels (dernier jour visible).
    // livAnc = la DERNIÈRE livraison de l'UNITÉ — pas celle d'un membre pris au hasard. Sur une
    // paire en S2, c'est l'accroché de la paire qui est livré en dernier : chaîner depuis l'autre
    // ferait repartir le camion ALORS QU'IL EST ENCORE CHARGÉ.
    // Comparaison sur la fin absolue, avec `>=` pour conserver la DERNIÈRE part à égalité : une
    // livraison de plusieurs jours porte plusieurs parts qui partagent le même `endAbs` mais pas la
    // même date, et c'est la date la plus tardive qui fait foi (audit 2026-07-19).
    let livAnc = null;
    newBlocks.forEach(b => {
      if (!uniteAnc.membres.includes(b.lotId) || b.type !== "liv" || b._overflow) return;
      if (!livAnc || finDe(b) >= finDe(livAnc)) livAnc = b;
    });
    // Le dossier de l'unité qui la TERMINE : c'est lui qui porte le point de départ du rechaînage
    // (sa livraison) et le retour dépôt à supprimer. C'est une donnée PHYSIQUE — où le camion se
    // trouve —, à ne pas confondre avec l'ancre de l'unité juste en dessous, qui est une identité.
    const lotAncId = livAnc ? livAnc.lotId : uniteAnc.membres[uniteAnc.membres.length - 1];
    const lotAnc = lots.find(l => l.id === lotAncId);
    if (!lotAnc) continue;

    // ── P8 — QUI REPRÉSENTE L'UNITÉ POUR LA RÈGLE DES ZONES (arbitrage Louis, 2026-08-13) ────────
    // « C'est l'ANCRE DE L'ANCRE qui définit les extrémités : le chg ANC initie la mutualisation,
    // la liv ANC la termine. »
    //
    // Autrement dit : une paire mutualisée se présente au territoire par les deux points de SON
    // ancre — le dossier vendu qui porte la mission. C'est cohérent avec la définition du segment
    // porteur d'une mutualisation (`chg ANC → liv ANC`, § 1.4 du dossier) et avec l'invariant
    // « le camion part du dépôt de l'ancre et y revient » : l'accroché de la paire s'insère DANS
    // cette mission, il ne la redéfinit pas.
    //
    // ⚠️ NE PAS CONFONDRE AVEC `lotAnc` CI-DESSUS. Deux questions distinctes, deux réponses :
    //   • « où est le camion quand il repart ? » → la DERNIÈRE livraison de l'unité (physique) ;
    //   • « quel territoire l'unité occupe-t-elle ? » → les points de SON ANCRE (identité).
    // Sur une paire en S2 ce n'est pas le même dossier, et les confondre ferait juger le territoire
    // sur un dossier qui n'ancre rien.
    const lotAncTerritoire = lots.find(l => l.id === uniteAnc.ancreId) || lotAnc;

    const chgAcc = newBlocks.find(b => b.lotId === lotAccId && b.type === "chg" && !b._overflow);
    if (!livAnc || !chgAcc || !livAnc.date || !chgAcc.date) continue;

    // Écart en jours OUVRÉS sur les dates ISO (indépendant de l'axe affiché)
    if (chgAcc.date < livAnc.date) continue;
    const ecart = diffWorkdays(livAnc.date, chgAcc.date);
    if (ecart > 3) continue;

    // B1 (audit 2026-07-19) : un week-end intercalé entre livAnc et chgAcc CASSE la boucle — le PL
    // doit être rentré à son dépôt le vendredi soir (règle vendredi). Le reflow a posé ce retour
    // dépôt ; on ne le défait plus. Alignement sur findBoucleCandidates (même règle métier).
    if (hasWeekendBetween(livAnc.date, chgAcc.date)) {
      debug.inc("boucle_rejets_weekend");
      continue;
    }

    // ── SEUIL DE RECHAÎNAGE — NE VAUT PLUS QUE POUR L'OPPORTUNISTE (arbitrage Louis 2026-08-19) ──
    // La distance mesurée est `livAnc → chgAcc` : la liaison à vide d'un retour (le camion a
    // déchargé, il se repositionne pour recharger). C'est aussi la seule forme de boucle que sait
    // détecter cette fonction — elle enchaîne deux lots CONSÉCUTIFS dans le temps, jamais deux lots
    // chargés ensemble, qui est la forme d'une mutualisation.
    //
    // 🔴 CE TEST ÉTAIT LE MIROIR DE F4 dans `findBoucleCandidates`. F4 y a été SUPPRIMÉE le
    // 2026-08-19 : le miroir est donc cassé, et le laisser en l'état ouvrirait un trou net —
    // le moteur PROPOSERAIT une boucle dont la liaison dépasse 300 km (G1 et G2 l'autorisent
    // désormais : deux points d'une même zone peuvent être distants de ~330 km), le planificateur
    // l'accepterait, et cette fonction refuserait ensuite de l'honorer. Ni badge ★, ni km évités,
    // ni rechaînage : « proposé = posé » serait faux, en silence.
    //
    // D'où la SCISSION, qui suit exactement la ligne déjà tracée par le bloc Q20 ci-dessous
    // (chaînage physique ≠ qualification) :
    //   • boucle DÉCIDÉE  → on passe. Le planificateur a arbitré, la pile de garde-fous (G1 + G2 +
    //     G5) a jugé la géométrie complète, il n'y a plus rien à re-trancher ici.
    //   • rechaînage OPPORTUNISTE (deux dossiers simplement posés à la suite, aucune décision) →
    //     le seuil s'applique toujours. C'est là, et là seulement, que vit désormais
    //     `seuilProxRetourKm` : il dit à quelle distance un camion se repositionne de lui-même.
    //     ⚠️ Cette valeur reste À STATUER (question ouverte Q21) : 300 km avait été choisi pour
    //     borner des BOUCLES, pas pour décider où dort un équipage.
    // ⚠️ Le test n'est PAS restreint aux paires inter-agences (seul le contrôle de zone, juste en
    // dessous, l'est) : deux lots d'une même agence posés l'un après l'autre passent aussi par ici.
    const distRepo = hav(gc(lotAnc.cpL), gc(lotAcc.cpC));
    const decideeAvantSeuil = uniteAnc.membres.some(id => boucleDecidee(lots.find(l => l.id === id), lotAcc));
    if (distRepo >= seuilProxRetour(rules) && !decideeAvantSeuil) {
      debug.log("BOUCLE", `  detectBoucles ${lotAncId}→${lotAccId} : pas de rechaînage opportuniste — liaison ${Math.round(distRepo)}km ≥ ${seuilProxRetour(rules)}km et aucune boucle décidée (Q21, à statuer)`);
      continue;
    }

    // ── Q20 — LA RÈGLE DES 80 KM PRIME SUR LE RECHAÎNAGE (arbitrage Louis, 2026-08-18) ───────────
    // PROVISOIRE — la question reste OUVERTE (docs/decisions/questions-ouvertes.md, Q20). Entre
    // `seuilResterSurPlaceKm` (80 km) et `seuilProxRetourKm` (300 km), les deux règles se
    // contredisaient : `enchainementContinu`, dans `reflowVehicle` ci-dessus, avait posé un retour
    // dépôt parce que le PL n'était pas à pied d'œuvre pour le chantier suivant — et ce rechaînage
    // le défaisait aussitôt dès que la liaison passait sous 300 km, DÉCISION OU PAS (cf. le
    // commentaire plus bas, « CE TEST NE FAIT PAS continue, ET C'EST VOLONTAIRE » : le chaînage
    // physique est explicitement indépendant de la qualification). C'est cette preuve qui tranche :
    // qu'une boucle soit décidée ou non, le camion parcourt le MÊME trajet à vide entre livAnc et
    // chgAcc — la « décision » ne change que le badge ★ et les km évités, jamais où l'équipage
    // dort. Rien ne distingue donc un rechaînage opportuniste d'un rechaînage décidé du point de
    // vue de cette règle : elle prime dans les DEUX cas.
    // Ne s'applique qu'en présence d'une NUIT (ecart > 0) : sans nuit intercalée l'enchaînement
    // même jour reste inconditionnel (règle métier §4, comme dans `enchainementContinu`).
    // Piloté par `seuilResterSurPlaceKm` seul — aucune nouvelle clé de réglage : pour revenir en
    // arrière (laisser le rechaînage primer comme avant le 2026-08-18), retirer ce bloc.
    if (ecart > 0) {
      const agVeh = agLookup(vehicule?.ag, agencesData);
      const agGpsVeh = agVeh.cp ? gc(agVeh.cp) : null;
      if (!resteSurPlacePourLeSuivant(gc(lotAnc.cpL), gc(lotAcc.cpC), agGpsVeh, rules)) {
        debug.inc("boucle_rejets_pied_oeuvre");
        debug.log("BOUCLE", `  detectBoucles ${lotAncId}→${lotAccId} : pas de rechaînage — le PL n'est pas à pied d'œuvre pour ${lotAccId} (Q20, règle des ${rules.seuilResterSurPlaceKm ?? 80} km, arbitrage 2026-08-18, provisoire)`);
        continue;
      }
    }

    // ZONES DE CHALANDISE — même filtre que findBoucleCandidates (arbitrage Louis 2026-07-28,
    // point (a) : le badge du Gantt suit la règle des propositions). Sans ça, une boucle
    // assemblée à la main en glisser-déposer garderait son ★ et alimenterait le KPI « km
    // économisés » alors que le moteur aurait refusé de la proposer.
    // Asymétrie assumée : le contrôle ne vaut que pour un RETOUR (agences différentes). Deux
    // lots de la MÊME agence posés côte à côte relèvent de la mutualisation, explicitement
    // exclue de la règle.
    // ✅ **P8 TRANCHÉ (Louis, 2026-08-13)** — les extrémités sont celles de l'ANCRE DE L'UNITÉ
    // (`lotAncTerritoire`, cf. son commentaire plus haut) : `chg ANC` initie la mutualisation,
    // `liv ANC` la termine. Sur une unité d'un seul dossier, c'est le dossier lui-même — donc rien
    // ne change pour l'immense majorité des cas.
    // 🔑 RÈGLE DES PILIERS D7 (2026-09-15) — même contrôle que `findBoucleCandidates`, au même
    // dépôt : celui du CAMION (D6). Repli sur l'agence de l'ancre si le camion n'a pas d'agence
    // connue — c'est elle qui le possède dans tous les cas réels.
    if (lotAncTerritoire.soc !== lotAcc.soc) {
      const depotTerritoire = agLookup(vehicule?.ag, agencesData).cp || agLookup(lotAncTerritoire.soc, agencesData).cp || null;
      const zonesCheck = checkRetourPiliers({
        depot: depotTerritoire,
        chgAncre: lotAncTerritoire.cpC, livAncre: lotAncTerritoire.cpL,
        chgAccroche: lotAcc.cpC, livAccroche: lotAcc.cpL,
      }, rules.zonesRetour);
      if (!zonesCheck.ok) {
        debug.inc("boucle_rejets_zone");
        debug.log("BOUCLE", `  detectBoucles ${uniteAnc.membres.join("+")}→${lotAcc.id} : pas de boucle — ${zonesCheck.raison} (territoire jugé sur l'ancre ${lotAncTerritoire.id})`);
        continue;
      }
    }

    // ── RECHAÎNAGE DE B PAR LE VRAI PLANIFICATEUR (audit 2026-07-19, B3/B4) ─────
    // buildChain reconstruit la chaîne complète de B depuis le point de livraison de A :
    // liaison « repo » incluse si > seuilRoute (l'ancienne copie locale la perdait quand le
    // reflow avait déjà chaîné les lots — bug B3), règle vendredi, règle « chargement même
    // jour », dateC respectée (waitDateC — Q15 : les chargements ne bougent jamais) et dateL
    // de B respectée (lot placé = promesse client).
    const livAncEndAbs = livAnc.endAbs || toAbs(livAnc.day, livAnc.endH || DAY_END);

    // « KM ÉVITÉS » : formule UNIQUE de décision (helper partagé kmEcoBoucleRetour, unifié
    // 2026-07-23 — avant, on ne comptait ici que le retour à vide de l'ancre, ~2× trop petit).
    // Rôles : lotAnc = ancre (1er chrono), lotAcc = accroché. Dépôt = agence VENDEUSE de chaque
    // lot (repli sur le GPS de chargement si l'agence n'a pas de CP). Tolérance : un CP « unknown »
    // (gc renverrait le centre France → distances fausses) → pas de chiffre plutôt qu'un faux.
    const gcSafe = (cp) => gcPrecision(cp) === "unknown" ? null : gc(cp);
    const depotVendeuse = (soc, fallbackCp) => {
      const a = agLookup(soc, agencesData);
      return a.cp ? gc(a.cp) : gcSafe(fallbackCp);
    };
    const ecoGeo = kmEcoBoucleRetour({
      depotAncre: depotVendeuse(lotAnc.soc, lotAnc.cpC),
      chgAncre: gcSafe(lotAnc.cpC),
      livAncre: gcSafe(lotAnc.cpL),
      depotAccroche: depotVendeuse(lotAcc.soc, lotAcc.cpC),
      chgAccroche: gcSafe(lotAcc.cpC),
      livAccroche: gcSafe(lotAcc.cpL),
    });

    // ── β — LE RETOUR DÉPÔT NE SE RÉINVENTE PAS ICI (correctif 2026-08-13) ──────────────────────
    // `buildChain` termine TOUJOURS par une rentrée au dépôt, sauf si on lui demande de la sauter.
    // On ne le lui demandait jamais. La chaîne rebâtie de l'accroché repartait donc avec une
    // rentrée que `reflowVehicle` venait délibérément de supprimer — et elle n'était retirée que
    // si le lien SUIVANT se qualifiait à son tour. Sinon elle restait, et percutait le chargement
    // du chantier d'après : deux dossiers dans le même créneau, sur le même camion.
    //
    // Le trou est structurel : la POSE décide la rentrée avec `enchainementContinu` (écart ≤ 1 jour
    // ouvré ET camion à pied d'œuvre), la DÉTECTION avec ses propres critères (écart ≤ 3 jours,
    // zones, seuil de 300 km, Q15). Les deux ne coïncident pas, et toute règle connue d'un seul des
    // deux rouvre le même trou.
    //
    // On ne re-tranche donc pas : ON RELIT CE QUE LA POSE A DÉCIDÉ. `reflowVehicle` a jugé avec
    // toutes les règles en main (week-end, pied d'œuvre, faisabilité du retour du soir) ; s'il n'a
    // pas dessiné de rentrée finale, c'est que le camion ne rentre pas. La coupure du vendredi
    // (`_weekendDepot`) est un retour INTERNE à la chaîne (chargement vendredi / route lundi, Q17) :
    // elle ne compte pas comme une rentrée finale, ici comme partout ailleurs.
    const posePrevoitRentree = (blocks || []).some(b => b.lotId === lotAccId
      && (b.type === "vid" || b.type === "ret") && !b._weekendDepot && !b._overflow);

    const chainAcc = buildChain(lotAcc, vehicule, weekDays, {
      startCursorAbs: livAncEndAbs,
      startGps: gc(lotAnc.cpL),
      waitDateC: true,
      skipRetourDepot: !posePrevoitRentree,
      // 🔴 Q17 (2026-09-15) : le rechaînage repart de la livraison de l'ancre, donc HORS du dépôt. Il
      // n'avait aucune garde week-end : un accroché chargé le vendredi et livré le lundi remplaçait la
      // pose (conforme) par une chaîne où le camion passe le week-end chargé chez le client. Mêmes
      // remèdes qu'à la pose pour un maillon enchaîné — ceux qui ramènent le camion au dépôt.
      gardeWeekendRetour: true,
      departHorsDepot: true,
      rules,
    }, agencesData);
    // Invariant « jamais de suppression silencieuse » : si B n'est pas rechaînable sur cet axe
    // (dateC hors fenêtre → buildChain retourne []), on ne touche à rien.
    if (chainAcc.length === 0) continue;
    // Q17 NON TENUE même après remèdes → pas de rechaînage : on garde la pose de `reflowVehicle`, qui a
    // fait rentrer le camion au dépôt avant l'accroché. Jamais une boucle contre la règle d'or.
    if (chaineTraverseWeekend(chainAcc, weekDays)) {
      debug.inc("boucle_rejets_weekend");
      debug.log("BOUCLE", `  detectBoucles ${lotAncId}→${lotAccId} : pas de rechaînage — ${lotAccId} passerait un week-end hors dépôt depuis la livraison de l'ancre (Q17)`);
      continue;
    }

    // Q15 — CONTRAINTE DURE. Ici les DEUX lots sont déjà posés, donc déjà vendus : reformer la
    // boucle ne peut déplacer aucun des deux chargements. Le rechaînage de B repart de la fin de
    // livraison de A (`startCursorAbs`) ; `waitDateC` est censé l'empêcher de charger avant sa date,
    // mais rien ne le retenait de charger APRÈS (règle vendredi, journée pleine, débordement d'axe).
    // On relit donc la chaîne produite au lieu de faire confiance à l'option. Non tenu ⇒ pas de
    // boucle : on laisse les blocs posés intacts (le PL enchaîne sans le badge ★ ni les km évités),
    // conformément à l'invariant « jamais de suppression ni de décalage silencieux ».
    if (!chgVenduTenu(chainAcc, lotAcc)) {
      debug.inc("boucle_rejets_chg_vendu");
      debug.log("BOUCLE", `  detectBoucles ${lotAncId}→${lotAccId} : pas de boucle — le rechaînage déplacerait le chargement VENDU de ${lotAccId} (${lotAcc.dateC} → ${chainAcc.find(b => b.type === "chg")?.date || "?"}) — Q15`);
      continue;
    }

    // ── LA BOUCLE A-T-ELLE ÉTÉ DÉCIDÉE ? (arbitrage Louis 2026-08-03) ─────────────────────────
    // Le badge ★ et les « km évités » ne récompensent QUE des boucles arbitrées par le
    // planificateur — jamais deux dossiers simplement posés l'un derrière l'autre. Cf.
    // `boucleDecidee` plus haut pour le pourquoi (le KPI ne doit compter que des économies
    // décidées, pas des coïncidences de planning).
    //
    // ⚠️ CE TEST NE FAIT PAS `continue`, ET C'EST VOLONTAIRE. Tout ce qui suit se partage en deux :
    //   • le RECHAÎNAGE (suppression du retour dépôt de l'ancre + repose de la chaîne de
    //     l'accroché depuis le point de livraison) — c'est la tournée PHYSIQUE du camion, elle
    //     reste inchangée, décision ou pas : deux dossiers voisins s'enchaînent comme avant ;
    //   • la QUALIFICATION (calcul des km évités, drapeau `_boucle`, pastille) — elle, exige la
    //     décision.
    // Transformer ce test en `continue` remettrait un retour dépôt à vide entre chaque paire de
    // dossiers voisins : un changement de planning majeur, invisible dans un test de badge.
    // Une unité ancre peut compter plusieurs dossiers : la décision se lit sur N'IMPORTE lequel de
    // ses membres — c'est la tournée entière qui se raccroche à l'accroché, pas seulement le
    // dossier qui la termine.
    // Déjà calculée plus haut (bloc « seuil de rechaînage ») : une seule lecture de la décision
    // dans cette itération, pour qu'aucune divergence ne puisse s'installer entre les deux usages.
    const decidee = decideeAvantSeuil;
    // ── LES KM ÉVITÉS SE COMPTENT SUR LA TOURNÉE, PAS SUR UN MEMBRE (Lot 1, 2026-08-18) ─────────
    // AVANT : `creditable = uniteAnc.membres.length === 1` — dès que l'unité ancre était une paire
    // mutualisée, le moteur REFUSAIT de chiffrer. Ce n'était pas une prudence gratuite : la
    // comparaison d'alors opposait la chaîne d'UN membre à la mission qu'il aurait faite seul,
    // c'est-à-dire un chiffre faux, et faux vers le haut. Le gain existait bel et bien, il était
    // seulement invisible. On ne répare donc pas un chiffre : on en fait APPARAÎTRE un.
    //
    // CE QU'ON COMPTE — le gain INCRÉMENTAL de l'accroche retour, et lui seul :
    //
    //   km évités = ( tournée de l'unité ancre roulant SEULE + accroché roulant seul )
    //             − ( tournée de l'unité ancre SANS son retour dépôt + accroché rechaîné )
    //
    // 🔑 LA RÉFÉRENCE EST LA TOURNÉE DÉJÀ ACQUISE, PAS SES MEMBRES SÉPARÉS. Prendre les membres
    // séparés recompterait ici le gain de la MUTUALISATION — or il est déjà crédité de son côté
    // (`_boucleKmEco`, posé par `reflowVehicle` sur le premier chargement de la chaîne mutu). Le
    // KPI additionne les deux : ils doivent rester DISJOINTS. C'est aussi ce qui rend le double
    // couplage lisible — gain total = gain de la mutualisation + gain du retour, sans recouvrement.
    //
    // Sur une unité d'un seul dossier, « la tournée de l'unité roulant seule » EST « la chaîne de
    // l'ancre seule » : le calcul reste identique à celui d'avant. Aucun chiffre existant ne bouge,
    // et c'est la propriété que fige le test de non-régression.
    const qualifie = decidee;
    let kmEvites = null; // reste null sans décision → aucun chiffre n'alimente le KPI
    if (qualifie) {
      // « KM ÉVITÉS » sur les km RÉELLEMENT roulés (2026-07-28). L'axe d'affichage (weekDays) est
      // souvent trop court pour une mission longue et tronquerait les km : on rejoue sur un axe
      // large, ouvert au plus ancien chargement de la tournée comme de l'accroché.
      const datesDepart = [...uniteAnc.membres.map(id => lots.find(l => l.id === id)?.dateC), lotAcc.dateC]
        .filter(Boolean).sort();
      // Ouvert 12 jours ouvrés AVANT (2026-09-16) : l'axe doit porter les ancrages que la pose
      // essaie sur une paire (`simulerPaireCommeLaPose`) — l'horizon est allongé d'autant.
      const axeLarge = buildWorkAxis(subWorkdays(datesDepart[0], 12), 57);
      const chaineSeule = (lot) => buildChain(
        lot, { ...vehicule, ag: lot.soc }, axeLarge, { rules, gardeWeekendRetour: true }, agencesData,
      );
      // LA TOURNÉE DE L'UNITÉ ROULANT SEULE. Pour une paire, c'est `buildMutuChain` — le MÊME
      // planificateur que la pose, appelé avec le camion réel (donc son dépôt à lui, pas celui
      // d'une agence vendeuse) et SANS `skipRetourDepot` : la tournée part du dépôt et y revient,
      // puisque c'est précisément ce retour à vide que l'accroché vient remplir.
      // 🔑 La paire est rejouée COMME LA POSE LA POSE — balayage des ancrages compris
      // (`simulerPaireCommeLaPose`, 2026-09-16, diag CHT-933597). Rejouée sur sa seule date
      // persistée, elle pouvait rouler une autre tournée que celle du Gantt : 2 531 km « ancre
      // seule » comptés pour 2 457 réellement posés, donc un gain affiché trop haut.
      const chaineUniteSeule = uniteAnc.mutu
        ? simulerPaireCommeLaPose(uniteAnc.mutu, vehicule, axeLarge, { rules, gardeWeekendRetour: true }, agencesData)
        : chaineSeule(lotAnc);
      const ecoReel = kmEcoBoucleRetourReel({
        // TOUS les membres de l'unité, et pas seulement celui qui la termine : sur une paire, les
        // blocs de l'autre membre manquaient au « combiné », qui sortait donc trop bas — donc un
        // gain affiché trop haut. C'est la même erreur que celle corrigée côté référence, à
        // l'autre bout de la soustraction.
        chaineAncre: newBlocks.filter(b => uniteAnc.membres.includes(b.lotId)),
        chaineAccroche: chainAcc,
        chaineAncreSeule: chaineUniteSeule,
        chaineAccrocheSeul: chaineSeule(lotAcc),
      });
      // Le repli géométrique ne sait décrire qu'un dossier seul (`kmEcoBoucleRetour` prend UN
      // chargement et UNE livraison d'ancre) : sur une tournée mutualisée il parlerait d'autre
      // chose que ce qui roule. On préfère alors AUCUN chiffre — la boucle garde son badge, le KPI
      // ne bouge pas. Même doctrine qu'ailleurs : jamais un mauvais chiffre plutôt qu'un trou.
      const eco = ecoReel || (uniteAnc.mutu ? null : ecoGeo);
      kmEvites = eco ? eco.kmEco : null;
      if (!eco) debug.inc("boucle_non_chiffrable_tournee");
      debug.log("BOUCLE", `  detectBoucles ${uniteAnc.membres.join("+")}→${lotAccId} kmEvites=${kmEvites} ${ecoReel ? `(RÉEL : tournée ancre seule ${eco.ancreSeule} + accroché seul ${eco.accrocheSeul} − combiné ${eco.combine})` : (eco ? "(repli géométrique)" : "(NON CHIFFRÉ — tournée mutualisée dont une chaîne n'est pas exploitable)")}`);
    } else {
      debug.inc("boucle_rejets_non_decidee");
      debug.log("BOUCLE", `  detectBoucles ${lotAncId}→${lotAccId} : enchaînement conservé, mais AUCUNE boucle décidée (pas de _boucleType/_boucleWith reliant les deux dossiers) → ni badge ★ ni km évités`);
    }

    // Retirer le retour dépôt FINAL de A (le PL enchaîne sur B au lieu de rentrer à vide) et les
    // anciens blocs de B, puis poser la nouvelle chaîne. On PRÉSERVE en revanche la coupure du
    // vendredi de A (vid marqué _weekendDepot) : c'est un retour dépôt INTERNE à la chaîne de A
    // (chargement vendredi / route lundi, règle Q17), sans rapport avec le retour final que
    // l'enchaînement supprime. Sans cette garde, un support qui charge le vendredi perdait sa
    // coupure et repassait le week-end chargé loin du dépôt (CHT-003327).
    // Le retour dépôt final appartient à l'UNITÉ, pas à un membre : sur une paire, il porte le
    // `lotId` du dossier qui exécute la dernière opération. Le chercher sur un seul membre le
    // laissait en place — le camion « rentrait au dépôt » puis se repositionnait aussitôt.
    for (let bi = newBlocks.length - 1; bi >= 0; bi--) {
      const b = newBlocks[bi];
      const vidFinalDeAnc = uniteAnc.membres.includes(b.lotId) && (b.type === "vid" || b.type === "ret") && !b._weekendDepot;
      if (vidFinalDeAnc || b.lotId === lotAccId) {
        newBlocks.splice(bi, 1);
      }
    }

    // Marquage boucle — RÉSERVÉ AUX BOUCLES DÉCIDÉES (cf. `decidee` ci-dessus). Sans décision,
    // les blocs sont poussés tels quels : le camion enchaîne les deux dossiers exactement pareil,
    // simplement sans étoile ni kilomètres crédités.
    // La liaison « repo » (si elle existe) porte les km évités ; sinon (liaison < seuilRoute → pas
    // de bloc route) ils sont portés par le chargement de B, pour que le KPI « km économisés »
    // (somme des _kmEvites) reste alimenté.
    // Si le GPS manque (kmEvites === null) : la boucle se forme quand même (blocs marqués
    // _boucle), mais aucune valeur n'est attachée — pas de chiffre fantaisiste dans le KPI.
    // `qualifie` et non `decidee` : une tournée à trois roule, mais elle ne porte ni étoile ni
    // kilomètres tant que le modèle ne sait pas la décrire (cf. plus haut, M3P).
    if (qualifie) {
      const hasKm = kmEvites != null;
      let kmEvitesPlaced = false;
      chainAcc.forEach(b => {
        if (b.type === "repo") {
          b._boucle = true;
          if (hasKm && !kmEvitesPlaced) {
            b._kmEvites = kmEvites;
            b.pills = [...(b.pills || []), `−${kmEvites}km évités`];
            kmEvitesPlaced = true;
          }
        }
        if (b.type === "chg" || b.type === "liv") b._boucle = true;
      });
      if (hasKm && !kmEvitesPlaced) {
        const firstChgAcc = chainAcc.find(b => b.type === "chg");
        if (firstChgAcc) {
          firstChgAcc._kmEvites = kmEvites;
          firstChgAcc.pills = [...(firstChgAcc.pills || []), `−${kmEvites}km évités`];
        }
      }
    }
    newBlocks.push(...chainAcc);
  }

  return newBlocks;
}

export function checkRetourBase(dateOp, lieuOp, baseAgence, rules) {
  if (!dateOp || !lieuOp || !baseAgence) return true; // si données manquantes, ne pas rejeter
  const dist = hav(lieuOp, baseAgence);
  const vitesse = (rules && rules.vitessePL) ? rules.vitessePL : 70;
  const dayEnd = (rules && rules.dayEnd) ? rules.dayEnd : 18;
  // Trouver le vendredi de la semaine de dateOp
  const d = new Date(dateOp + "T12:00:00");
  const dow = d.getDay(); // 0=dim,1=lun,...,5=ven,6=sam
  // Nombre de jours jusqu'au prochain vendredi (ou vendredi courant)
  let daysToFriday = (5 - dow + 7) % 7;
  // Si c'est samedi/dimanche on cherche le vendredi suivant
  if (dow === 6) daysToFriday = 6;
  if (dow === 0) daysToFriday = 5;
  const friday = new Date(d);
  friday.setDate(d.getDate() + daysToFriday);
  // Heures disponibles : l'opération consomme son jour (fin supposée à DAY_END du jour dateOp),
  // donc seuls les jours OUVRÉS pleins restants jusqu'à vendredi DAY_END comptent.
  // (Fix audit 2026-06-10 : l'ancien calcul ajoutait une journée fantôme et comptait le dimanche
  // comme ouvré depuis un samedi → des retours base impossibles étaient validés.)
  const dayStart = (rules && rules.dayStart) ? rules.dayStart : 7;
  let workdaysToFriday = daysToFriday;
  if (dow === 6 || dow === 0) workdaysToFriday = 5; // sam/dim → lun..ven suivants (5 jours ouvrés)
  const hoursAvailable = workdaysToFriday * (dayEnd - dayStart);
  // Temps de trajet nécessaire
  const hoursRequired = dist / vitesse;
  return hoursRequired <= hoursAvailable;
}

// Variante à l'HEURE près (audit 2026-07-19, I5) : quand la fin réelle de l'opération est connue
// (simulations de findBoucleCandidates), on compte les heures ouvrées entre la fin d'op et
// vendredi DAY_END de la même semaine sur l'axe fourni. L'ancienne version à la journée comptait
// « 0 h disponibles » pour toute opération du vendredi et rejetait même un retour d'1 h qui
// tenait largement avant 18 h — des boucles valides de fin de semaine étaient perdues.
export function checkRetourBaseAbs(endAbs, lieuOp, baseAgence, axis, rules) {
  if (endAbs == null || !lieuOp || !baseAgence) return true; // données manquantes → ne pas rejeter
  const vitesse = (rules && rules.vitessePL) ? rules.vitessePL : 70;
  const fridayIdx = findFridayIdx(fromAbs(endAbs).day, axis);
  if (fridayIdx < 0) return true; // vendredi hors axe : contrainte non mesurable → ne pas rejeter
  const hoursAvailable = workHoursBetween(endAbs, toAbs(fridayIdx, DAY_END));
  return hav(lieuOp, baseAgence) / vitesse <= hoursAvailable;
}

// Heures ouvrées restant entre un instant et le vendredi DAY_END de SA semaine — c'est-à-dire
// le temps dont dispose encore le PL avant la coupure du week-end.
// Infinity si non mesurable (vendredi hors axe) → ne jamais rejeter sur une donnée absente.
export function heuresAvantWeekend(abs, axis) {
  if (abs == null) return Infinity;
  const fridayIdx = findFridayIdx(fromAbs(abs).day, axis);
  if (fridayIdx < 0) return Infinity;
  return workHoursBetween(abs, toAbs(fridayIdx, DAY_END));
}

// RÈGLE ABSOLUE (arbitrage Louis 2026-07-21, Q17) : un PL n'est JAMAIS loin de son dépôt
// pendant un week-end. Répond à : « partant de `abs` au lieu `etapes[0]`, le PL peut-il avoir
// parcouru `etapes` puis être rentré au `depot` avant le vendredi DAY_END qui précède ce
// week-end ? ». `etapes` permet d'évaluer les deux positions possibles avant la coupure :
//   · [chg]        → la route n'est pas partie, le PL rentre depuis le lieu de chargement
//   · [chg, liv]   → la route est faite, le PL rentre depuis la zone de livraison (livraison lundi)
// ⚠ Le `depot` attendu est celui du VÉHICULE qui exécute la mission, pas celui de l'agence
// vendeuse du lot : en boucle retour, c'est le PL de l'agence opératrice qui porte les deux lots.
export function peutRentrerAvantWeekend(abs, etapes, depot, axis, rules) {
  if (abs == null || !depot || !etapes || etapes.length === 0) return true;
  if (etapes.some(e => !e)) return true; // GPS manquant → ne pas rejeter
  const dispo = heuresAvantWeekend(abs, axis);
  if (dispo === Infinity) return true;
  const vitesse = (rules && rules.vitessePL) ? rules.vitessePL : 70;
  let km = 0;
  for (let i = 1; i < etapes.length; i++) km += hav(etapes[i - 1], etapes[i]);
  km += hav(etapes[etapes.length - 1], depot);
  return km / vitesse <= dispo;
}

// RETIRÉ le 2026-07-28 : `classifyLocalAuto` (Local = chg ET liv dans un rayon de 150 km du
// dépôt de l'agence vendeuse). C'était le SEUL seuil kilométrique codé en dur du projet, hors
// de RULES_DEFAULTS, et il ne servait qu'à PRÉ-COCHER le bouton Local/National du formulaire
// d'enrichissement — jamais à une décision moteur. Le planificateur choisit désormais
// explicitement (le champ reste obligatoire côté FlowFormEnrich, qui bloque le passage à
// l'étape suivante tant qu'il n'est pas renseigné).


// ── HELPERS MOTEUR BOUCLE ──

// Heures OUVRÉES entre deux instants absolus d'un axe de jours ouvrés (sans week-ends),
// bornées à l'amplitude DAY_START–DAY_END de chaque jour. Sert au contrôle ecartMaxH
// (attente non-productive entre deux lots d'une boucle).
export function workHoursBetween(aAbs, bAbs) {
  if (bAbs <= aAbs) return 0;
  let h = 0;
  const dStart = fromAbs(aAbs).day, dEnd = fromAbs(bAbs).day;
  for (let d = dStart; d <= dEnd; d++) {
    const s = Math.max(aAbs, toAbs(d, DAY_START));
    const e = Math.min(bAbs, toAbs(d, DAY_END));
    if (e > s) h += e - s;
  }
  return h;
}

// Nombre minimum de jours ouvrés entre chargement et livraison (trajet physique)
export function joursMinLot(lot, rules) {
  // Repli sans durée saisie : abaque partagé (manutRatio PAR ETP) — aligné 2026-07-21
  const durC = parseDur(lot.dureC) || manutHeures(lot.vol, lot.fteC, rules);
  const route = hav(gc(lot.cpC), gc(lot.cpL)) / rules.vitessePL;
  const durL = parseDur(lot.dureL) || manutHeures(lot.vol, lot.fteL, rules);
  return Math.ceil((durC + route + durL) / (rules.dayEnd - rules.dayStart));
}
export function joursMaxLot(lot, rules) { return joursMinLot(lot, rules) + 2; }

// Trouve le plId sur lequel un lot donné est placé dans placements. Null si non placé.
export function findPlacedVehicle(lotId, placements) {
  for (const [plId, blocks] of Object.entries(placements || {})) {
    if (blocks?.some(b => b.lotId === lotId)) return plId;
  }
  return null;
}

// Types de véhicules non porteurs : jamais proposés au placement autonome d'un lot
// (arbitrage Q12 2026-07-19). La remorque se couple à un PL ; un VL ou une caisse mobile
// ne porte pas un lot de déménagement seul.
export const NON_PORTEUR_TYPES = ["remorque", "VL", "caisse mobile"];

// Un véhicule peut-il porter ce lot ? (type porteur + capacité suffisante — arbitrage Q12)
// Volume ou capacité absents/invalides (données legacy) → on ne bloque que sur le type.
export function isVehicleCompatible(veh, vol) {
  if (!veh) return false;
  if (NON_PORTEUR_TYPES.includes(veh.type)) return false;
  const v = parseFloat(vol);
  if (!v || v <= 0) return true;
  const cap = parseFloat(veh.cap);
  if (!cap || cap <= 0) return true;
  return cap >= v;
}

// Le PL a-t-il des blocs (d'autres lots, ou manuels) sur une plage de dates ISO ?
// Sert au contrôle de faisabilité des propositions de boucle (arbitrage Q14 2026-07-19) :
// une boucle n'est proposée que si le PL de B est libre sur toute la période de la mission
// combinée — sinon le reflow sérialiserait et décalerait des dates en silence.
export function plBusyInRange(plId, startISO, endISO, placements, excludeLotIds = []) {
  if (!startISO || !endISO) return false;
  const ex = new Set(excludeLotIds);
  const blocking = ["app", "chg", "liv", "trs", "repo", "bou", "vid", "ret"];
  return (placements?.[plId] || []).some(b =>
    b.date && b.date >= startISO && b.date <= endISO
    && blocking.includes(b.type)
    && !ex.has(b.lotId));
}

// Un PL est-il disponible à une date donnée ?
// strict=true : tout bloc (app/chg/liv/trs/repo/bou/vid/ret) compte comme occupation
// strict=false : seulement chg/liv/trs/repo/bou comptent
export function isPLAvailableOnDate(plId, dateStr, placements, strict = true) {
  const blocks = placements?.[plId] || [];
  const blockingTypes = strict
    ? ["app", "chg", "liv", "trs", "repo", "bou", "vid", "ret"]
    : ["chg", "liv", "trs", "repo", "bou"];
  return !blocks.some(b => b.date === dateStr && blockingTypes.includes(b.type));
}

// Un PL est-il disponible sur toute une plage de dates (chg → liv inclus) ?
// Utilisé pour le placement local : le PL doit être libre chaque jour de la mission.
// pendingReservations : tableau optionnel de { plId, dateC, dateL } pour les lots en _pendingBoucle
// qui bloquent des créneaux en attente d'acceptation d'une agence opératrice.
export function isPLAvailableInRange(plId, dateC, dateL, placements, strict = true, pendingReservations = []) {
  if (!dateC) return false;
  const endDate = dateL && dateL >= dateC ? dateL : dateC;
  const start = new Date(dateC + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");
  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // aucun bloc ne tombe un week-end
    days.push(new Date(d).toISOString().slice(0, 10));
  }
  // Check blocs placés
  if (!days.every(day => isPLAvailableOnDate(plId, day, placements, strict))) return false;
  // Check réservations pending sur ce PL
  const pendingOnThisPL = pendingReservations.filter(r => r.plId === plId);
  for (const r of pendingOnThisPL) {
    const rStart = r.dateC;
    const rEnd = r.dateL || r.dateC;
    // Chevauchement de plages ?
    if (!(endDate < rStart || dateC > rEnd)) return false;
  }
  return true;
}

// Extrait les réservations pending depuis les lots (lots en _pendingBoucle qui visent un PL)
export function getPendingReservations(lots) {
  return lots
    .filter(l => l._pendingBoucle && l._pendingBoucle.partnerPlId)
    .map(l => ({
      plId: l._pendingBoucle.partnerPlId,
      dateC: l.dateC,
      dateL: l.dateL,
      lotId: l.id,
    }));
}

// Liste des PL d'une agence disponibles ET compatibles (type porteur + capacité ≥ vol — Q12)
// sur une date donnée. vol=0 → pas de filtre capacité (compat).
export function findAvailablePLs(agId, dateStr, vehicles, placements, vol = 0) {
  return vehicles
    .filter(v => v.ag === agId && isVehicleCompatible(v, vol))
    .filter(v => isPLAvailableOnDate(v.id, dateStr, placements, true));
}

// Pour "sans boucle" : dans la fenêtre de flex, liste les dates où au moins un PL est dispo
export function findAvailableDatesInWindow(agId, dateC, flexC, vehicles, placements, vol = 0) {
  const dates = datesAround(dateC, flexC);
  const out = [];
  dates.forEach(d => {
    const avail = findAvailablePLs(agId, d, vehicles, placements, vol);
    if (avail.length > 0) {
      out.push({ date: d, availablePLs: avail, isPreferred: d === dateC });
    }
  });
  return out;
}

// Saturation jour x agence : basée sur les placements réels (PL occupés sur la date).
// Ne compte que les porteurs (Q12 : remorques/VL/caisses mobiles hors flotte de placement).
export function computeSaturation(dateStr, agId, vehicles, placements, excludeTypes = NON_PORTEUR_TYPES) {
  const agVehs = vehicles.filter(v => v.ag === agId && !excludeTypes.includes(v.type));
  const total = agVehs.length;
  if (total === 0) return { used: 0, total: 0, rate: 0, availablePLs: [] };
  const availablePLs = agVehs.filter(v => isPLAvailableOnDate(v.id, dateStr, placements, true));
  const used = total - availablePLs.length;
  return { used, total, rate: Math.round(used / total * 100), availablePLs };
}

// ══════════════════════════════════════════════════════════════
// SCORING V2 — Prend `placements` en compte et gère l'impact
// dates sur lot partenaire non verrouillé.
// ══════════════════════════════════════════════════════════════
// Principes :
//  1. On ne cherche que parmi lots DÉJÀ placés (present dans placements)
//  2. Pour un lot B non verrouillé, on peut "déplacer" B dans sa fenêtre flex
//     pour matcher avec A. Si la meilleure boucle nécessite ce déplacement,
//     on flag `impactPartnerDates: true` sur la candidate.
//  3. Pour la mutualisation, le PL utilisé = celui sur lequel B est placé.
//     Capacité garantie par construction.
//  4. Pour le retour, le PL utilisé = celui sur lequel B est placé, A s'insère
//     entre liv B et retour dépôt. Pas de check capa non plus.
// ──────────────────────────────────────────────────────────────

// ── DÉTECTION DE CONFLITS SUR MODIFICATION DE DATE ──────────────────────────
// Quand on change les dates d'un lot (via LotDetailModal ou impact boucle),
// les blocs Gantt du même PL peuvent se chevaucher avec la nouvelle plage.
// Cette fonction retourne la liste des lots impactés (chevauchement horaire).
//
// Paramètres :
//   lotId       : le lot dont on change les dates
//   newDateC    : nouvelle date de chargement (ISO)
//   newDateL    : nouvelle date de livraison (ISO)
//   placements  : { plId: [blocks] }
//   weekDays    : tableau des jours de la fenêtre
//
// Retourne : [{ lotId, lotClient, plId, overlap: [{ date, type }] }]
export function detectDateConflicts(lotId, newDateC, newDateL, placements, weekDays) {
  // Trouver le PL sur lequel ce lot est placé
  const plId = Object.keys(placements).find(pid =>
    (placements[pid] || []).some(b => b.lotId === lotId)
  );
  if (!plId) return [];

  const plBlocks = placements[plId] || [];
  if (!newDateC) return [];

  // Plage ISO occupée par le lot après modification (audit 2026-07-19, I3 : comparaison en
  // dates ISO — les index de jour `b.day` des blocs conservés hors axe pointent sur un AUTRE
  // axe que weekDays ; l'ancienne comparaison par index ratait ou inventait des conflits).
  const effDateL = newDateL && newDateL >= newDateC ? newDateL : newDateC;

  // Blocs des AUTRES lots sur le même PL
  const otherLotIds = [...new Set(
    plBlocks.filter(b => b.lotId && b.lotId !== lotId).map(b => b.lotId)
  )];

  const conflicts = [];
  otherLotIds.forEach(otherId => {
    const otherBlocks = plBlocks.filter(b => b.lotId === otherId && ["chg", "liv", "trs", "repo"].includes(b.type));
    const overlapping = otherBlocks.filter(b => {
      const bDate = b.date || weekDays?.[b.day] || "";
      return bDate && bDate >= newDateC && bDate <= effDateL;
    });
    if (overlapping.length > 0) {
      const firstChg = plBlocks.find(b => b.lotId === otherId && b.type === "chg");
      conflicts.push({
        lotId: otherId,
        lotClient: firstChg?.label?.split(" · ")[0] || otherId,
        plId,
        overlap: overlapping.map(b => ({ date: b.date || weekDays?.[b.day] || "", type: b.type })),
      });
    }
  });

  return conflicts;
}


// ORDRE DES PROPOSITIONS — clé PRIMAIRE : `scoreClassement` décroissant (arbitrage Louis 2026-08-14).
//
//   score = km évités − 750 × rallongeJours − 200 × décalageJours     (cf. engine/gardesBoucle.js)
//
// 🔴 RENVERSEMENT ASSUMÉ — À LIRE AVANT DE CRIER À LA RÉGRESSION.
// L'arbitrage du **2026-07-30** avait fait de `kmEco` la clé UNIQUE et posé en principe que
// « c'est le planificateur qui arbitre, pas le tri » — le décalage de la livraison du partenaire
// (`impactPartnerDates`) venait d'être RETIRÉ du classement, où il servait de clé primaire et
// faisait passer une boucle sans impact devant une boucle nettement plus économique.
// L'arbitrage du **2026-08-14** (`docs/boucles/couplage-synthese.md`, règle R4 « Comment l'outil classe les
// propositions ») le REMPLACE explicitement, sur la foi d'une campagne de mesure : classer sur les
// seuls kilomètres évités retenait **29 % de boucles douteuses au retour**. Il manquait deux
// choses au classement, et aucune n'est un kilomètre — une journée de camion mobilisée en plus, et
// un jour de livraison décalé chez un client déjà prévenu. Ce ne sont pas les mêmes 750/200 que
// les garde-fous : ceux-là REFUSENT, ceux-ci ORDONNENT ce qui a déjà été accepté.
//
// Ce qui NE change PAS, et c'est ce qui rend le renversement compatible avec le principe de
// juillet : le tri n'INTERDIT toujours rien. `impactPartnerDates` reste affiché sur la carte de
// proposition (⚡ « Livraison décalée »), garde tout son circuit de confirmation client, et une
// boucle qui décale reste PROPOSÉE — simplement pas en tête si son décalage ne se paie pas.
//
// 🔑 Le détour n'entre pas dans le score : `km évités = (trajet de l'accroché seul) − détour` le
// soustrait déjà au coefficient 1. Cf. `gardesBoucle.js`.
//
// `kmEco` reste le DÉPARTAGE à score égal (et le repli si `scoreClassement` manque — candidat
// fabriqué par un test ou par un chemin qui n'est pas passé par `evaluerGardes`). Comparateur
// exporté pour être testé seul : les scénarios qui produisent deux candidats concurrents sont trop
// lourds à monter en fixture.
export function compareBoucleCandidates(a, b) {
  const sa = Number.isFinite(a.scoreClassement) ? a.scoreClassement : a.kmEco;
  const sb = Number.isFinite(b.scoreClassement) ? b.scoreClassement : b.kmEco;
  if (sb !== sa) return sb - sa;
  if (b.kmEco !== a.kmEco) return b.kmEco - a.kmEco;
  if (a.impactPartnerDates !== b.impactPartnerDates) return a.impactPartnerDates ? 1 : -1;
  return 0;
}

// ══ LA PAIRE TELLE QUE LA POSE LA CONSTRUIT (2026-09-16, diag CHT-933597) ══════════════════════
//
// CE QUI SE PASSAIT. La pose (`reflowVehicle`) ne rejoue jamais une paire mutualisée sur la seule
// `dateC` persistée de son accroché : elle balaye les dates d'ANCRAGE de sa fenêtre de flex et
// retient la première chaîne qui tient les chargements vendus (« ancrage ≠ atterrissage »). La
// recherche de boucle, elle, appelait `buildMutuChain` sur la date persistée, sans balayage — donc
// sur une AUTRE chaîne que celle du Gantt. Cas fondateur : paire CHT-430364 (accroché, verrouillé,
// chargé le 22/10) + CHT-887633 (ancre, chargée le 23/10). Posée depuis un ancrage au 21/10 :
// approche le 21, chargements les 22 et 23. Rejouée au 22/10 : approche le 22 au matin, chargement
// d'une journée repoussé au 23, ancre arrivée le vendredi 15h → lundi → Q15 → le retour SIMON
// (CHT-933597, 2 100 km évités) n'a jamais été proposé.
//
// D'où ces deux briques, lues par la POSE ET par la RECHERCHE : la liste des ancrages essayés et le
// critère qui en retient un. Une seule écriture — elles ne peuvent plus diverger.

// Les dates d'ancrage essayées pour l'accroché d'une paire, dans l'ordre de préférence : sa date
// persistée d'abord (le groupage déjà accepté reste préféré), puis sa fenêtre de flex — ancrée sur la
// date SOUHAITÉE — du moindre décalage au plus grand, puis la plus tôt. Seules les dates de l'axe.
export function datesAncragePaire(lotAcc, axis) {
  const dates = [lotAcc.dateC];
  // `flexChgJours` et non `lotAcc.flexC` : les lots bruts du state portent `_flexC` (CHT-528539).
  const flexCAcc = flexChgJours(lotAcc);
  if (flexCAcc > 0) {
    const dateVoulueAcc = dateChgSouhaitee(lotAcc);
    datesAround(dateVoulueAcc, flexCAcc, 1)
      .filter(d => d !== lotAcc.dateC && axis.indexOf(d) >= 0)
      .sort((x, y) =>
        Math.abs(diffDaysIso(dateVoulueAcc, x)) - Math.abs(diffDaysIso(dateVoulueAcc, y))
        || (x < y ? -1 : 1))
      .forEach(d => dates.push(d));
  }
  return dates;
}

// Une chaîne de paire est-elle ACCEPTABLE ? Le chargement vendu de l'ancre tient (Q15) et, si
// l'accroché est verrouillé, son chargement ATTERRIT sur sa date exacte — l'ancrage a pu varier,
// l'atterrissage non. `lotAcc` est le lot PERSISTÉ, jamais la copie réancrée.
export function paireTenueALaPose(chain, lotAcc, lotAnc) {
  if (!chgVenduTenu(chain, lotAnc)) return false;
  return !isLotLocked(lotAcc) || chgVenduTenu(chain, lotAcc);
}

// La paire simulée COMME LA POSE LA POSERAIT, au départ du dépôt : même balayage, même critère.
// Rend la première chaîne acceptable ; à défaut la chaîne de la date persistée (le comportement
// d'avant), pour que l'appelant rejette avec son propre motif — on ne fabrique jamais un succès.
export function simulerPaireCommeLaPose(paire, veh, axis, opts, agencesData = []) {
  let premiere = null;
  for (const d of datesAncragePaire(paire.lotAcc, axis)) {
    const lotAccEssai = d === paire.lotAcc.dateC ? paire.lotAcc : { ...paire.lotAcc, dateC: d };
    const chain = buildMutuChain(lotAccEssai, paire.lotAnc, paire.sequence, veh, axis, opts, agencesData);
    if (!chain.length) continue;
    if (!premiere) premiere = chain;
    if (paireTenueALaPose(chain, paire.lotAcc, paire.lotAnc)) return chain;
  }
  return premiere || [];
}

// LA TOURNÉE D'UNE UNITÉ TELLE QU'ELLE EST POSÉE SUR LE GANTT (2026-09-16).
// Pour greffer un retour, la recherche a besoin de faits : où et quand le camion est libre, quand il
// a fini de charger, combien roule la tournée acquise. Ces faits sont sur le Gantt — les relire vaut
// mieux que les recalculer, puisque tout recalcul peut diverger de ce qui roule.
// Les blocs sont RÉINDEXÉS sur `axis` par leur date et leurs heures : `day`/`startAbs` persistés
// dépendent de l'axe de la pose, jamais de celui de la simulation.
// Rend `null` — et l'appelant simule comme avant — dès qu'un fait manque : un membre sans
// chargement ou sans livraison posés, un bloc débordant ou hors axe.
export function chaineUnitePosee(plId, lotIds, placements, axis) {
  const ids = new Set(lotIds);
  const blocs = (placements?.[plId] || []).filter(b => b.lotId && ids.has(b.lotId));
  if (!blocs.length) return null;
  for (const id of ids) {
    if (!blocs.some(b => b.type === "chg" && b.lotId === id)) return null;
    if (!blocs.some(b => b.type === "liv" && b.lotId === id)) return null;
  }
  const out = [];
  for (const b of blocs) {
    if (b._overflow || !b.date || !Number.isFinite(b.startH) || !Number.isFinite(b.endH)) return null;
    const day = axis.indexOf(b.date);
    if (day < 0) return null;
    out.push({ ...b, day, startAbs: toAbs(day, b.startH), endAbs: toAbs(day, b.endH) });
  }
  return out.sort((x, y) => x.startAbs - y.startAbs);
}

// ── MOTEUR BOUCLE V1 ──
// Implémente spec_retour_v1.md et spec_mutualisation_simple_v1.md
// Signature étendue : vehicles requis pour check capacité F5
export function findBoucleCandidates(lotDraft, existingLots, placements, weekDays, rules = RULES_DEFAULTS, vehicles = [], agencesData = []) {
  if (!lotDraft.cpC || !lotDraft.cpL || !lotDraft.dateC) return [];
  // CP inconnu (arbitrage 2026-06-10) : position approximée au centre de la France →
  // distances fausses. Le lot reste planifiable (signal visible côté UI) mais il est
  // EXCLU des propositions automatiques de boucle.
  if (gcPrecision(lotDraft.cpC) === "unknown" || gcPrecision(lotDraft.cpL) === "unknown") {
    debug.inc("boucle_rejets_cp_inconnu");
    debug.log("BOUCLE", `=== ABANDON ${lotDraft.id || 'draft'}: CP non reconnu (${lotDraft.cpC}/${lotDraft.cpL}) — exclu des boucles ===`);
    return [];
  }
  // ── C2 bis — ON PLACE TOUJOURS UN LOT SEUL (tranche 4B, règle arbitrée le 2026-09-02) ─────────
  // L'ACCROCHÉ est simple ; l'ANCRE, elle, peut être une paire. Cette dissymétrie est la règle,
  // pas une limite technique : c'est elle qui BORNE la tournée à trois. Sans elle, ouvrir le
  // verrou côté ancre (juste en dessous) laisserait le moteur composer des voyages sans fin —
  // une paire greffée derrière une paire en ferait quatre, puis six.
  //
  // 🔴 CE CONTRÔLE FERME UN CHEMIN QUI ÉTAIT OUVERT. Le verrou historique ne regardait QUE l'ancre :
  // un lot déjà mutualisé pouvait, lui, recevoir une proposition de retour sur une ancre libre, et
  // l'accepter fabriquait une tournée à trois. Mais la POSE ne savait pas l'honorer — `detectBoucles`
  // refuse de rechaîner quand l'accroché est une paire (rejet nommé « accroché en paire »), donc
  // cette tournée-là roulait sans badge et sans un kilomètre crédité. On ne retire pas une
  // possibilité : on retire une promesse que rien ne tenait.
  if (liensDuLot(lotDraft).length) {
    debug.inc("boucle_rejets_accroche_deja_lie");
    debug.log("BOUCLE", `=== ABANDON ${lotDraft.id || 'draft'}: déjà membre d'une tournée (${liensDuLot(lotDraft).map(l => `${l.type}→${l.avec}`).join(", ")}) — on ne greffe qu'un lot SEUL (C2 bis) ===`);
    return [];
  }
  debug.inc("boucle_recherches");

  // Normaliser vol en number (le form passe vol comme string depuis <input>)
  const lotDraftVol = parseFloat(lotDraft.vol) || 0;
  const lotDraftNorm = { ...lotDraft, vol: lotDraftVol };

  // Fenêtre de chargement autorisée pour A (négocié client, saisi au form)
  // flexC=0 → fenêtre exactement 0 jour (date exacte uniquement)
  // ANCRÉE SUR LA DATE SOUHAITÉE (2026-07-31) : la souplesse a été négociée autour de ce que le
  // client a DEMANDÉ, pas autour de la dernière date que le planning a retenue. Ancrée sur `dateC`,
  // la fenêtre se recentrait à chaque boucle acceptée — un dossier demandé au 18/09 puis placé au
  // 21/09 devenait déplaçable jusqu'au 28/09, et ainsi de suite : la promesse client dérivait.
  // Accepte les deux formes du champ (`flexC` du formulaire, `_flexC` d'un lot du state) :
  // ce point d'entrée est appelé avec un draft, mais rien ne l'y oblige. Cf. `utils/datesBoucle.js`.
  const flexC = flexChgJours(lotDraft);
  const dateChgVoulueA = dateChgSouhaitee(lotDraft);
  const allowedDatesAcc = new Set(datesAround(dateChgVoulueA, flexC, flexC === 0 ? 0 : 1));

  // Fenêtre de livraison : règle globale admin (flexLivraisonJours, défaut 4j).
  // Override : si dateLivImposee=true sur le lot, flexL=0 (date stricte).
  // Règle métier : livraison plus tôt que demandée = OK, plus tard = borné par flexL.
  const flexL = lotDraft.dateLivImposee ? 0 : (rules.flexLivraisonJours ?? 4);

  // F3 (arbitrage 2026-06-10) : fenêtre MÉTIER autour des dates du lot A, indépendante de la
  // semaine affichée à l'écran (résultat déterministe et reproductible — indispensable pour le
  // futur backend/OR-Tools). B est candidat si sa plage [dateC..dateL] chevauche
  // [dateC_Acc − flexC − 3 j ouvrés ; dateL_Acc + flexL + 3 j ouvrés] (3 = écart max de liaison).
  //
  // ANCRAGE DOUBLE — DATE POSÉE **ET** DATE SOUHAITÉE (2026-08-03). Ce pré-filtre n'est qu'un
  // dégrossissage : l'évaluation fine, elle, part de la date SOUHAITÉE par le client
  // (`allowedDatesAcc`, arbitrage 2026-07-31 — « la souplesse a été négociée autour de ce que le
  // client a DEMANDÉ »). Les deux étapes doivent donc partir du même point, sinon le pré-filtre
  // écarte des partenaires que l'évaluation fine aurait acceptés : un dossier demandé au 02/06 mais
  // posé au 16/06 voyait sa fenêtre de dégrossissage glisser de deux semaines, et les partenaires
  // du début de sa flex disparaissaient avant même d'être évalués. Aujourd'hui la marge de 3 jours
  // absorbe l'écart (dérive max observée en base : 5 jours ; rupture à partir de 8) — c'est un
  // piège dormant, pas un bug actif. On prend donc l'UNION des deux ancrages : la borne la plus
  // précoce pour le début, la plus tardive pour la fin. Le pré-filtre ne peut ainsi, PAR
  // CONSTRUCTION, jamais exclure un candidat que l'évaluation fine aurait pu retenir — il ne fait
  // que s'élargir, jamais se rétrécir.
  const chgPoseAcc = lotDraft.dateC;
  const livPoseAcc = lotDraft.dateL || lotDraft.dateC;
  const livVoulueAcc = dateLivSouhaitee(lotDraft);
  const f3Start = subWorkdays(dateChgVoulueA < chgPoseAcc ? dateChgVoulueA : chgPoseAcc, flexC + 3);
  const f3End = addWorkdays(livVoulueAcc > livPoseAcc ? livVoulueAcc : livPoseAcc, flexL + 3);

  debug.log("BOUCLE", `=== Recherche ${lotDraft.id || 'draft'} soc=${lotDraft.soc} ${lotDraft.cpC}→${lotDraft.cpL} dateC=${lotDraft.dateC} flexC=${flexC} flexL=${flexL}${lotDraft.dateLivImposee ? " (imposée)" : ""} vol=${lotDraftVol} ===`);
  debug.log("BOUCLE", `lots candidats=${existingLots.length} vehicles=${vehicles.length} PL placés=[${Object.keys(placements).join(',')}]`);

  const gpsA_C = gc(lotDraft.cpC);
  const gpsA_L = gc(lotDraft.cpL);
  const agAcc = agLookup(lotDraft.soc, agencesData);
  const gpsDepotAcc = agAcc.cp ? gc(agAcc.cp) : gpsA_C;

  // 🔴 LES DEUX SEUILS DE PROXIMITÉ NE FORMENT PLUS AUCUNE BOUCLE (arbitrage Louis 2026-08-19).
  // Ils bornaient une DISTANCE BRUTE, chacun de son côté, avant que le moindre garde-fou n'ait vu
  // la géométrie complète. La campagne « fil de l'eau vs big bang » (2026-08-18) a montré que le
  // seuil retour PLAFONNAIT le détour avant même que G2 le mesure — la liaison est le premier
  // terme du détour, donc G2 n'a jamais pu voir un couple que ce seuil avait déjà écarté. Les deux
  // sont donc retirés de la formation des boucles, et remplacés par ce qui les doublait déjà :
  //   RETOUR → G1 (`checkRetourPiliers`, règle des piliers D7 depuis le 2026-09-15) + G2 + G5.
  //   MUTU   → G1 (`checkMutuZones`, NOUVEAU — G1 ne couvrait que le retour) + G2 + G5.
  // Ce qui reste de `seuilProxRetourKm` : le RECHAÎNAGE PHYSIQUE (« le PL enchaîne-t-il en direct
  // ou rentre-t-il au dépôt ? », plus haut dans ce fichier). Ce n'est pas un garde-fou de boucle,
  // c'est une règle de conduite du camion, elle vaut décision ou pas — et elle reste À STATUER
  // (question ouverte Q21, cf. docs/decisions/questions-ouvertes.md). Ce fichier ne le lit donc
  // plus QUE dans `detectBoucles` — plus une seule lecture ici, dans la recherche de candidats.
  const minKmEco = rules.minKmEco ?? 50;
  const results = [];
  // Boucles ÉCARTÉES à cause du camion (diagnostic multi-camion, lot 4.1 — 2026-07-29).
  // Ce ne sont PAS des propositions plaçables : elles sont remontées à part (`final._bloques`)
  // pour être affichées en information, sans aucun bouton d'action.
  const bloques = [];
  // Budget global de la seconde passe de diagnostic : elle ne tourne que sur des scénarios déjà
  // REJETÉS, mais chaque essai rejoue une simulation complète (buildChain/buildMutuChain).
  const budgetDiag = { sims: rules.diagBoucleSimMax ?? 24 };

  // ── LA RECHERCHE RAISONNE EN TOURNÉES, PLUS EN LOTS (tranche 4B) ────────────────────────────
  //
  // Jusqu'ici l'ancre était forcément un lot LIBRE : « pas de boucle sur boucle » (V1). Ce verrou
  // interdisait les deux formes que le Lot 4 existe pour proposer — un RETOUR derrière une paire
  // mutualisée, une MUTUALISATION devant un lot qui porte déjà un retour.
  //
  // Il est remplacé par trois règles, qui disent la même prudence sans fermer la porte :
  //   • C1 — la tournée compte AU PLUS TROIS lots. `tourneesDeBoucles` est la MÊME lecture que
  //     celle du KPI et de la projection serveur : une seule définition de « tournée ».
  //   • une orientation ne se greffe pas sur elle-même (pas de retour sur retour, pas de
  //     mutualisation sur mutualisation) : ce sont deux autres sujets, et ils ne sont pas celui-ci.
  //   • une paire ne s'évalue QU'UNE FOIS, depuis son ancre — sans quoi le même voyage sortirait
  //     deux fois dans la liste, une par membre, et la dédupe finale (`partnerLot × type`) ne le
  //     verrait pas.
  const tourneesExistantes = tourneesDeBoucles(existingLots);
  const tourneeParLot = new Map();
  tourneesExistantes.forEach(t => t.membres.forEach(m => tourneeParLot.set(m.id, t)));
  // Les paires mutualisées, lues par le point unique — la même lecture que la POSE (`reflowVehicle`)
  // et que `detectBoucles`. C'est elle qui permet de simuler la paire avec son VRAI planificateur.
  const paireParLot = new Map();
  pairesMutu(existingLots).forEach(paire => {
    paireParLot.set(paire.lotAcc.id, paire);
    paireParLot.set(paire.lotAnc.id, paire);
  });

  // ── « PROPOSÉ = POSÉ », PAR CONSTRUCTION ET NON PLUS PAR IMITATION (2026-09-16, diag CHT-933597) ──
  // Jusqu'ici l'invariant tenait parce que la recherche appelait les MÊMES planificateurs que la
  // pose. Ce n'est pas suffisant : la pose ne leur donne pas les mêmes entrées (balayage des
  // ancrages d'une paire, curseur de liaison, plage horaire, enchaînement ou rentrée au dépôt, garde
  // Q17 du maillon enchaîné…), et chaque règle ajoutée d'un côté ouvrait un écart de l'autre.
  //
  // Avant d'émettre une proposition, on REJOUE DONC LA POSE qu'entraînerait son acceptation : les
  // liens écrits comme les écrit l'interface (`handleTodoAction` au retour, `handleSuggestionPlace`
  // en mutualisation), l'accroché aux dates annoncées, la livraison de l'ancre avancée si la
  // proposition l'annonce, puis `reflowVehicle` sur le camion — sur le même axe que `placeLotOnPL`.
  // La proposition n'est émise que si cette pose :
  //   • charge et livre l'accroché aux dates ANNONCÉES ;
  //   • tient le chargement vendu de chaque lot déjà sur le voyage (Q15) ;
  //   • en mutualisation, pose réellement la paire imbriquée (pas le filet « séparément »).
  // Sinon on annoncerait au planificateur un planning que le Gantt ne montrera pas : rejet nommé.
  //
  // Lecture seule : aucun état n'est écrit, et les compteurs de debug incrémentés par la pose
  // rejouée sont restaurés (ils mesurent des poses réelles, pas des vérifications).
  const poseTientLaProposition = ({ type, plId, lotAnc, dateC, dateL, sequence = null, partnerNewDateL = null, lotsVendus }) => {
    const accId = lotDraft.id || "__brouillon__";
    const lienAcc = type === "retour"
      ? { avec: lotAnc.id, type: "retour", role: "operateur" }
      : { avec: lotAnc.id, type: "mutualisation", sequence, mutuRole: "initiateur" };
    const lienAnc = type === "retour"
      ? { avec: accId, type: "retour" }
      : { avec: accId, type: "mutualisation", sequence, mutuRole: "partenaire" };
    const accHyp = ecrireLien({ ...lotDraftNorm, id: accId, dateC, dateL,
      status: LOT_STATUS.PLACED_LOCKED, _locked: true, _pendingBoucle: undefined }, lienAcc);
    const ancHyp = ecrireLien(partnerNewDateL ? { ...lotAnc, dateL: partnerNewDateL } : lotAnc, lienAnc);
    const lotsHyp = [...existingLots.filter(l => l.id !== accId && l.id !== lotAnc.id), ancHyp, accHyp];
    const seeded = [
      ...(placements?.[plId] || []).filter(b => b.lotId !== accId),
      { id: `__marker__${accId}`, lotId: accId, plId },
    ];
    // Axe de `placeLotOnPL` (`axeLargePourPL`) : une semaine avant le premier chargement du camion,
    // 130 jours ouvrés — allongé seulement si la livraison annoncée tomberait au-delà.
    const idsSurPL = new Set(seeded.map(b => b.lotId));
    const premierChg = lotsHyp.filter(l => idsSurPL.has(l.id)).map(l => l.dateC).filter(Boolean).sort()[0] || dateC;
    const debutAxe = addDaysIso(getMonday(premierChg), -7);
    const axe = buildWorkAxis(debutAxe, Math.max(130, diffWorkdays(debutAxe, dateL || dateC) + 30));

    // `debug.metrics` peut manquer (module de debug simulé dans les tests) : rien à restaurer alors.
    const compteurs = debug.metrics ? { ...debug.metrics } : null;
    let pose;
    try {
      pose = reflowVehicle(plId, lotsHyp, seeded, axe, vehicles, agencesData, rules);
    } finally {
      if (compteurs) Object.assign(debug.metrics, compteurs);
    }
    const datesDe = (t) => pose.filter(b => b.type === t && b.lotId === accId && !b._overflow).map(b => b.date).filter(Boolean).sort();
    const chgPose = datesDe("chg")[0];
    const livPose = datesDe("liv").pop();
    if (chgPose !== dateC || livPose !== dateL) {
      return { ok: false, raison: `la pose chargerait l'accroché le ${chgPose || "?"} et le livrerait le ${livPose || "?"} (annoncé ${dateC} → ${dateL})` };
    }
    const nonTenu = (lotsVendus || []).find(m => !chgVenduTenu(pose, m));
    if (nonTenu) {
      const vu = pose.filter(b => b.type === "chg" && b.lotId === nonTenu.id).map(b => b.date).sort()[0];
      return { ok: false, raison: `la pose déplacerait le chargement VENDU de ${nonTenu.id} (${nonTenu.dateC} → ${vu || "?"}) — Q15` };
    }
    if (type === "mutualisation" && mutuTenueALaPose(pose, accId, lotAnc.id) === false) {
      return { ok: false, raison: `la pose ne tiendrait pas la mutualisation (${accId} et ${lotAnc.id} reposés séparément)` };
    }
    return { ok: true };
  };

  existingLots.forEach(lotAnc => {
    // Pré-requis communs
    if (!lotAnc.cpC || !lotAnc.cpL) { debug.inc("boucle_rejets_pas_cp"); debug.log("BOUCLE", `  SKIP ${lotAnc.id}: pas de CP`); return; }
    if (lotAnc.id === lotDraft.id) return;
    // ── V1, VERSION 4B : l'ancre peut être une UNITÉ déjà en voyage, dans la limite de trois ─────
    const tourneeAnc = tourneeParLot.get(lotAnc.id) || null;
    const membresTournee = tourneeAnc ? tourneeAnc.membres.map(m => m.id) : [lotAnc.id];
    const typesTournee = tourneeAnc ? tourneeAnc.types : [];
    // C1 — TROIS LOTS, PAS QUATRE. La borne est dure et ne se négocie pas « au passage » : c'est
    // elle qui empêche le chantier de dériver vers une composition libre de tournées.
    if (membresTournee.length + 1 > 3) {
      debug.inc("boucle_rejets_tournee_pleine");
      debug.log("BOUCLE", `  SKIP ${lotAnc.id}: sa tournée compte déjà ${membresTournee.length} lots (${membresTournee.join("+")}) — C1 borne à trois`);
      return;
    }
    // ── C2 — UN SEUL MAILLON EN VOL À LA FOIS SUR UNE TOURNÉE (tranche 4E) ────────────────────
    //
    // 🔴 L'ANGLE MORT DES « DEUX TEMPS ». Entre le moment où un retour est PROPOSÉ et celui où
    // l'agence opératrice répond, il n'existe AUCUN lien : `tourneesDeBoucles` — donc C1, donc les
    // deux gardes d'orientation — ne voit rien. La tournée visée se présentait ici avec une place
    // de libre. Une paire A+B qui attendait la réponse sur un retour X recevait donc une seconde
    // proposition Y, et si les deux agences disaient oui, le voyage finissait à QUATRE lots : la
    // borne dure de C1 se contournait par le seul fait d'attendre.
    //
    // Et la seconde proposition serait de toute façon une PROMESSE QUE RIEN NE TIENT : le maillon
    // en vol n'est pas dans les liens, donc la simulation qui vient (`buildMutuChain`,
    // `accrocheTientDerriere`) ne le porte pas — on annoncerait des dates calculées sur un voyage
    // amputé de ce qu'on a déjà promis à quelqu'un d'autre. C'est le défaut que 4C existe pour
    // interdire, et le motif exact de la règle C2 : une paire, PUIS l'autre.
    //
    // ⚠️ La proposition en vol reste refusable — c'est tout l'intérêt des deux temps. Un refus
    // efface `_pendingBoucle` (cf. `handleTodoAction`), la tournée se rouvre au geste suivant, et
    // rien n'a été défait du maillon précédent.
    const enVol = maillonsEnVolVers(membresTournee, existingLots, { sauf: lotDraft.id });
    if (enVol.length) {
      debug.inc("boucle_rejets_maillon_en_vol");
      debug.log("BOUCLE", `  SKIP ${lotAnc.id}: un maillon est déjà en vol sur cette tournée (${enVol.map(m => m.accrocheId).join(",")}) — C2, une paire puis l'autre`);
      return;
    }
    // ── C3 — L'ACCROCHÉ D'UN RETOUR N'ANCRE RIEN (garde explicite, audit du 2026-09-15) ───────────
    // Il roule sur le camion d'une AUTRE agence. Le prendre pour ancre d'une mutualisation confierait
    // DEUX lots à cette agence (« jamais deux lots à une agence tierce », C3) et greffe une paire
    // DERRIÈRE une mission (refus maintenu par C1). Rien ne l'interdisait explicitement : la
    // proposition tombait par accident, `accrocheTientDerriere` rejouant l'ANCRE du retour comme si
    // elle venait après la paire — avec un journal qui nommait l'ancre « le retour ». Le retour, lui,
    // était déjà écarté (« pas de retour sur retour »). Le rôle se lit sur le LIEN (`rolesDuLot`).
    if (rolesDuLot(lotAnc, existingLots).some(r => r.type === "retour" && r.role === "accroche")) {
      debug.inc("boucle_rejets_accroche_de_retour");
      debug.log("BOUCLE", `  SKIP ${lotAnc.id}: accroché d'un retour, il roule sur le camion d'une autre agence — il ne peut ancrer aucune greffe (C3)`);
      return;
    }
    // La paire mutualisée à laquelle appartient l'ancre, s'il y en a une. `null` = un lot seul,
    // et tout ce qui suit se comporte alors EXACTEMENT comme avant 4B.
    const paireAnc = paireParLot.get(lotAnc.id) || null;
    // Une paire ne s'évalue qu'une fois, et c'est son ANCRE qui la représente : c'est le lot VENDU
    // et déjà posé, celui dont la mission fixe les dates, le camion et donc le dépôt — la même
    // identité que celle retenue par `detectBoucles`, et celle que la règle C3 désigne pour porter
    // le troisième lot (« jamais deux lots à une autre agence »).
    if (paireAnc && paireAnc.lotAnc.id !== lotAnc.id) {
      debug.log("BOUCLE", `  SKIP ${lotAnc.id}: membre non-ancre de la paire ${paireAnc.lotAnc.id}+${paireAnc.lotAcc.id} — la paire est évaluée depuis son ancre`);
      return;
    }
    // ── DEUX ENSEMBLES, À NE JAMAIS CONFONDRE ────────────────────────────────────────────────
    //   • LA TOURNÉE — tout ce qui roule déjà sur ce camion. Sert à DEUX choses seulement : borner
    //     à trois (C1) et dire qui n'est pas un intrus sur le PL (V2).
    //   • L'UNITÉ ANCRE — ce qu'on RESIMULE pour y greffer l'accroché : la paire mutualisée, ou le
    //     lot seul. Un retour déjà accroché derrière l'ancre n'en fait pas partie : il vient APRÈS,
    //     et c'est un contrôle séparé (« l'accroché existant tient-il toujours derrière ? ») qui
    //     s'en occupe, plus bas dans le scénario mutualisation.
    // Les confondre resimulerait le troisième lot comme s'il faisait partie du chargement.
    const lotsDeLaTournee = tourneeAnc ? tourneeAnc.membres : [lotAnc];
    const lotsDeLUnite = paireAnc ? [paireAnc.lotAnc, paireAnc.lotAcc] : [lotAnc];
    // CP inconnu → distances fausses (centre France) → exclu des propositions
    if (gcPrecision(lotAnc.cpC) === "unknown" || gcPrecision(lotAnc.cpL) === "unknown") { debug.inc("boucle_rejets_cp_inconnu"); debug.log("BOUCLE", `  SKIP ${lotAnc.id}: CP non reconnu (${lotAnc.cpC}/${lotAnc.cpL})`); return; }
    const plIdBPose = findPlacedVehicle(lotAnc.id, placements);
    if (!plIdBPose) { debug.inc("boucle_rejets_pas_place"); debug.log("BOUCLE", `  SKIP ${lotAnc.id}: non placé`); return; }
    // F3 — B dans la fenêtre MÉTIER de A (indépendante de la semaine affichée).
    // 4B : sur une paire, c'est le VOYAGE qui doit chevaucher la fenêtre, pas un membre pris seul —
    // son premier chargement et sa dernière livraison. Un dégrossissage qui ne regarderait qu'un
    // membre écarterait une paire que l'évaluation fine aurait retenue.
    const chgTournee = membresTournee.length > 1
      ? lotsDeLaTournee.map(m => m.dateC).filter(Boolean).sort()[0] : lotAnc.dateC;
    const livTournee = membresTournee.length > 1
      ? lotsDeLaTournee.map(m => m.dateL || m.dateC).filter(Boolean).sort().pop() : (lotAnc.dateL || lotAnc.dateC);
    // Le premier chargement de l'UNITÉ (et non de la tournée) : c'est lui qui ouvre la mission
    // qu'on resimule, donc le repère des contrôles de week-end.
    const chgUnite = lotsDeLUnite.map(m => m.dateC).filter(Boolean).sort()[0] || lotAnc.dateC;
    if (livTournee < f3Start || chgTournee > f3End) { debug.inc("boucle_rejets_hors_fenetre"); debug.log("BOUCLE", `  SKIP ${lotAnc.id}: hors fenêtre métier (dateC=${chgTournee} dateL=${livTournee} vs ${f3Start}..${f3End})`); return; }

    const gpsB_C = gc(lotAnc.cpC);
    const gpsB_L = gc(lotAnc.cpL);
    const agAnc = agLookup(lotAnc.soc, agencesData);
    const gpsDepotAnc = agAnc.cp ? gc(agAnc.cp) : gpsB_C;
    // Fix B : rejeter si vehAnc introuvable (PL fantôme)
    const vehBPose = vehicles.find(v => v.id === plIdBPose);
    if (!vehBPose) { debug.log("BOUCLE", `  SKIP ${lotAnc.id}: vehAnc ${plIdBPose} introuvable`); return; }
    debug.log("BOUCLE", `  CANDIDAT ${lotAnc.id} soc=${lotAnc.soc} plId=${plIdBPose} cap=${vehBPose.cap}m³ locked=${isLotLocked(lotAnc)}`);
    // ── LES DEUX BOUTS DU VOYAGE ANCRE (4B) ──────────────────────────────────────────────────
    // Sur un lot seul, ce sont son chargement et sa livraison — rien ne change. Sur une PAIRE, le
    // voyage commence au chargement de l'un et finit à la livraison de l'AUTRE : c'est la séquence
    // qui le dit (S1 → l'ancre charge puis est livrée en dernier ; S2 → l'accroché encadre), et
    // c'est exactement la lecture que fait la POSE (`reflowVehicle`, `finLotDe`). Confondre les
    // deux ferait partir l'accroché du mauvais point, donc mesurer une liaison qui n'existe pas.
    // 🔑 Une paire se charge et se décharge en PILE : S1 = ChgAnc → ChgAcc → LivAcc → LivAnc,
    // S2 = ChgAcc → ChgAnc → LivAnc → LivAcc. Le même lot ouvre donc le voyage et le ferme — ce
    // n'est pas une coïncidence d'écriture, c'est la géométrie du chargement d'un camion.
    const lotFinUnite = paireAnc ? (paireAnc.sequence === "S1" ? paireAnc.lotAnc : paireAnc.lotAcc) : lotAnc;
    const gpsFinUnite = paireAnc ? gc(lotFinUnite.cpL) : gpsB_L;
    const membreParId = new Map(lotsDeLUnite.map(m => [m.id, m]));
    const gpsChgDe = (lotId) => { const m = membreParId.get(lotId); return m ? gc(m.cpC) : gpsB_C; };
    const gpsLivDe = (lotId) => { const m = membreParId.get(lotId); return m ? gc(m.cpL) : null; };

    // 4B — sur une paire, un SEUL membre verrouillé fige tout le voyage : on ne peut pas avancer
    // la livraison de l'un sans toucher à la chaîne de l'autre. Le doute profite à la promesse client.
    const bLocked = lotsDeLUnite.some(m => isLotLocked(m));

    // ── ÉVALUATION DES SCÉNARIOS POUR UN CAMION DONNÉ ───────────────────────────────────────
    // Extraite en fonction le 2026-07-29 (lot 4.1), puis SCINDÉE EN DEUX le même jour
    // (mutualisation régionale) : `evaluerRetour` et `evaluerMutu` sont deux closures sœurs,
    // appelées l'une APRÈS l'autre sur le même camion par `evaluerScenarios` (plus bas).
    //
    // POURQUOI DEUX FONCTIONS. Les deux scénarios étaient deux blocs `if` mutuellement exclusifs
    // (`soc ≠ soc` ⇒ retour, `soc === soc` ⇒ mutu) dans une seule closure truffée de `return;`
    // secs. Tant qu'ils s'excluaient, un `return` de l'un ne pouvait rien annuler chez l'autre.
    // Depuis que la mutualisation est ouverte aux agences d'une MÊME RÉGION, un couple de lots
    // peut relever des DEUX scénarios à la fois — et un rejet du retour (zones, week-end, PL
    // occupé) aurait alors tué silencieusement l'évaluation de la mutualisation. Séparer les
    // corps rend l'indépendance STRUCTURELLE : chaque `return;` ne sort plus que de son propre
    // scénario, et un `return;` ajouté par erreur demain ne peut plus déborder sur l'autre.
    //
    // Le camion est reçu en paramètre (et non lu dans la fermeture) pour pouvoir REJOUER la même
    // évaluation sur un autre PL du même dépôt en LECTURE SEULE (`diagnostic`) — cf. diagnostic
    // multi-camion, plus bas.
    //
    // ⚠️ Les corps héritent de `return;` secs (rejets) : leur valeur de retour n'est donc pas
    // exploitable. Le résultat passe par `bilan`, qui porte UN SLOT PAR SCÉNARIO, réinitialisé à
    // chaque appel et à lire IMMÉDIATEMENT après (un appel imbriqué l'écraserait).
    let bilan = null;

    // ══ SCÉNARIO RETOUR (inter-agences) ══
    // RÈGLE DE GOUVERNANCE : le lot draft (A) est TOUJOURS le retour, jamais l'aller.
    // L'agence vendeuse A peut confier son voyage au camion d'une agence opératrice B
    // déjà sortie pour son propre lot, mais elle ne peut PAS s'approprier le voyage
    // déjà calé de B. Une seule séquence est donc autorisée :
    //   B-first : Dépôt B → ChgAnc → LivAnc → ChgAcc → LivAcc → Dépôt B
    // La branche A-first (A en aller, B en retour) a été retirée — cf. admin → règles.
    const evaluerRetour = (vehAnc, plIdAnc, out) => {
      // `emettre` pousse la proposition ; `rejetVehicule` note un rejet imputable AU CAMION — les
      // deux seules causes qu'un autre PL du même dépôt peut lever. Tous les autres rejets (zones,
      // distance, week-end, flex, kmEco) ne dépendent que des lots et de leurs dates : les rejouer
      // ailleurs donnerait exactement le même verdict. Les deux arrivent par `out` (et non par la
      // fermeture) pour que chaque scénario écrive dans SON slot de `bilan`.
      const { emettre, rejetVehicule, diagnostic } = out;
      // 4B — un RETOUR ne se greffe pas derrière un retour. Ce n'est pas une prudence de plus :
      // la tournée à trois arbitrée est « une paire mutualisée + un retour », dans un sens ou dans
      // l'autre. Enchaîner deux retours est un AUTRE sujet (le camion repartirait d'un troisième
      // point sans jamais rentrer), qui n'a été ni mesuré ni arbitré.
      if (typesTournee.includes("retour")) {
        debug.inc("boucle_rejets_retour_sur_retour");
        debug.log("BOUCLE", `    RETOUR ${lotAnc.id} SKIP — sa tournée porte déjà un retour (${membresTournee.join("+")})`);
        return;
      }
      if (lotAnc.soc !== lotDraft.soc && !lotDraft.vendeuseSeulement) {
        // B (déjà placé) charge et livre en premier ; A est ensuite chargé sur le PL de B
        // depuis le lieu de livraison de B. La flex de A doit permettre dateC_Acc ≥ dateL_Anc
        // (garde-fou `allowedDatesAcc` plus bas).
        {
          // F3bis — ZONES DE CHALANDISE (arbitrage Louis 2026-07-28). Placé AVANT F4 : c'est le
          // filtre le plus discriminant et le moins cher (comparaison de départements, aucune
          // géométrie). Rôles : ancre = lotAnc (déjà placé, son PL ancre le trajet), accroché =
          // lotDraft (A). Cas fondateur CHT-158193 / CHT-003327 : l'ancre descend Rennes (35,
          // Ouest) → Marseille (13, PACA) et l'accroché recharge à Sanary (83, PACA) — jusque-là
          // parfait — mais LIVRE À PARIS (75), hors des deux zones. La liaison Marseille↔Sanary
          // ne fait que 37 km : F4 laissait passer sans broncher, aucun seuil ne regardait la
          // livraison de A. D'où ce contrôle, qui porte sur les 4 extrémités de la boucle.
          // 🔑 RÈGLE DES PILIERS D7 (codée le 2026-09-15, doctrine § 2.2 de
          // `docs/boucles/boucles-etat-a-date.md`). Le croisement complet exigeait les DEUX piliers ;
          // la doctrine en demande UN : « maison » (chg ANC et liv ACC dans la zone du dépôt) ou
          // « au loin » (liv ANC et chg ACC dans une même autre zone). ⚠️ Le cas fondateur ci-dessus
          // PASSE désormais le territoire par le pilier au loin (le camion recharge en PACA, là où
          // il a déchargé) — c'est G2, le détour, qui juge si Paris est sur la route du retour.
          // Dépôt = celui du CAMION (D6), le même `gpsDepotPL` que les contrôles week-end plus bas ;
          // repli sur l'agence de l'ancre. Sur une paire, `lotAnc` est l'ancre de la paire (P8).
          const zonesCheck = checkRetourPiliers({
            depot: agLookup(vehAnc.ag, agencesData).cp || agAnc.cp || null,
            chgAncre: lotAnc.cpC, livAncre: lotAnc.cpL,
            chgAccroche: lotDraft.cpC, livAccroche: lotDraft.cpL,
          }, rules.zonesRetour);
          if (!zonesCheck.ok) {
            debug.inc("boucle_rejets_zone");
            debug.log("BOUCLE", `    RETOUR ${lotAnc.id} REJECT zones — ${zonesCheck.raison}`);
            return;
          }
          // F4 — RETIRÉE COMME BARRIÈRE (arbitrage Louis 2026-08-19). La liaison à vide
          // chgAcc↔livAnc est toujours MESURÉE et tracée — elle reste l'information la plus
          // parlante d'un rejet ou d'une acceptation — mais elle ne refuse plus rien par
          // elle-même. Deux règles la couvrent déjà, et mieux :
          //   • G1 (zones, juste au-dessus) borne la géographie de façon TOPOLOGIQUE ;
          //   • G2 borne le DÉTOUR, dont cette liaison est le premier terme — et le détour, lui,
          //     tient compte du trajet remplacé : une liaison de 350 km parfaitement alignée sur
          //     la route du porteur ne coûte presque rien, une liaison de 100 km à contresens
          //     coûte cher. Un seuil sur la distance brute ne sait pas faire cette différence.
          // ⚠️ CE QUE PLUS RIEN NE FACTURE : le roulage à VIDE en tant que tel. G2 mesure un
          // détour NET, G5 des km/jour ; la seule mesure qui voyait le vide (M2/G3) a été retirée
          // comme barrière le 2026-08-14 et ne sert plus qu'à l'affichage. C'est un choix assumé,
          // pas un oubli — le rattrapage disponible est le garde-fou ⑦ (`gardePlancherAbsurdite`,
          // livré désactivé), qui refuse un détour supérieur au trajet qu'il remplace.
          const distChgAccLivAnc = hav(gpsA_C, gpsFinUnite);
          debug.log("BOUCLE", `    RETOUR ${lotAnc.id} liaison à vide chgAcc(${lotDraft.cpC}) ↔ fin du voyage ancre(${lotFinUnite.cpL}) = ${Math.round(distChgAccLivAnc)}km (mesure, plus de seuil — G2 borne le détour)`);
          {
            // F5 — capacité (B déjà livré → cale vide)
            debug.log("BOUCLE", `    RETOUR ${lotAnc.id} F5: volAcc=${lotDraftVol} vs capAnc=${vehAnc.cap}`);
            if (lotDraftVol <= vehAnc.cap) {
              // ── Dates calculées par le VRAI planificateur buildChain ──────────────────
              // Unification (corrige le décalage +1j « fencepost » ET applique heures ouvrées
              // + week-end + règle vendredi exactement comme le placement). On planifie B puis A
              // sur un axe de jours ouvrés assez large pour ne pas dépendre de la fenêtre 9 jours.
              // Garantit « date proposée == date posée ».
              // L'axe démarre AVANT le premier chargement de l'unité (2026-09-16, diag CHT-933597) : il
              // doit porter les ancrages que la pose essaie sur une paire (fenêtre de flex autour de la
              // date souhaitée, jusqu'à 10 j ouvrés) et l'approche posée la veille d'un chargement.
              // Démarré sur le chargement, il excluait l'ancrage même que la pose avait retenu.
              // L'horizon est allongé d'autant : la fin de l'axe ne recule pas.
              const debutUnite = [lotDraft.dateC, ...lotsDeLUnite.flatMap(m => [m.dateC, dateChgSouhaitee(m)])]
                .filter(Boolean).sort()[0];
              const simStartISO = subWorkdays(debutUnite, 12);
              const simAxis = buildWorkAxis(simStartISO, 57);
              // ignoreDateL : contexte BOUCLE → sémantique « au plus tôt » (on optimise le trajet,
              // la livraison de B peut être avancée dans sa fenêtre — arbitrage 2026-06-10).
              //
              // RÈGLE D'AJUSTEMENT (regles-metier §4) : lot A bouge en premier ; lot B seulement
              // si STRICTEMENT nécessaire. Deux passes :
              //   Passe 1 — B garde sa date de livraison demandée (buildChain respecte dateL).
              //   Passe 2 — fallback : B avancé au plus tôt dans sa fenêtre (ignoreDateL), si la
              //             passe 1 ne permet pas d'accrocher A (chgAcc hors flex, attente > ecartMaxH…).
              //             Interdite si B est verrouillé (placed_locked : ses dates ne bougent pas).
              // Le contrôle ecartMaxH (arbitrage 2026-06-10 : règle désormais APPLIQUÉE) est intégré
              // à chaque passe : attente non-productive du PL entre liv B et chg A, en heures ouvrées,
              // route de liaison déduite (elle est productive pour la boucle).
              const ecartMaxH = rules.ecartMaxH ?? 5.5;
              // ── 4C — « PROPOSÉ = POSÉ » SUR UNE UNITÉ 🔴 ────────────────────────────────────
              // C'est LE risque technique du Lot 4, et il était connu avant d'écrire une ligne : si
              // on ouvrait le verrou en gardant `buildChain`, la recherche simulerait la paire avec
              // le planificateur d'UN SEUL lot. Mesuré au banc : proposition annoncée 03/06 → 05/06,
              // posée 05/06 → 10/06. On annoncerait des dates qu'on ne poserait pas.
              // La paire est donc simulée par `buildMutuChain` — le MÊME planificateur que celui qui
              // posera (`reflowVehicle`), avec la même séquence lue au même endroit (`pairesMutu`).
              //
              // ⚠️ `gardeWeekendRetour` n'est demandé QUE pour la paire, et c'est délibéré. Sur un
              // lot seul, les contrôles week-end explicites de `evaluerSim` (plus bas) font le
              // travail depuis toujours : les doubler changerait un comportement établi. Une paire,
              // elle, est DÉJÀ POSÉE sous Q17 — la resimuler sans sa garde produirait une chaîne
              // que la pose refuserait, c'est-à-dire exactement le défaut que 4C existe pour fermer.
              // Et si la garde devait déplacer un chargement vendu, `chgVenduTenu` rejette : la
              // contradiction entre Q15 et Q17 ne s'arbitre pas, la boucle n'existe pas.
              // 🔑 ET LA PAIRE EST SIMULÉE COMME LA POSE LA POSE (2026-09-16, diag CHT-933597) — avec le
              // balayage des ancrages de `reflowVehicle` (`simulerPaireCommeLaPose`). Le même
              // planificateur ne suffisait pas : la pose ne lui donne pas les mêmes entrées.
              const chaineUniteAncre = (ignoreDateL) => (paireAnc
                ? simulerPaireCommeLaPose(paireAnc, vehAnc, simAxis, { ignoreDateL, rules, gardeWeekendRetour: true }, agencesData)
                : buildChain(lotAnc, vehAnc, simAxis, { ignoreDateL, rules }, agencesData));
              // ── PASSE 1 : L'ANCRE TELLE QU'ELLE ROULE — LE GANTT, PAS UN RECALCUL (2026-09-16) ──────
              // « L'ancre garde sa date » décrit exactement la tournée déjà posée : on la RELIT
              // (`chaineUnitePosee`) au lieu de la reconstruire. C'est un fait — l'heure où le camion est
              // libre, où il a fini de charger, ce que roule la tournée acquise — et c'est la seule
              // lecture qui ne peut pas diverger du Gantt. La simulation ne sert plus qu'aux
              // HYPOTHÈSES (passe 2 : livraison de l'ancre avancée), qui n'existent sur aucun écran.
              // Uniquement sur le camion qui porte réellement l'unité : le diagnostic multi-camion
              // évalue un autre PL, où rien n'est posé.
              // Pose incomplète ou incohérente avec les dates vendues (lot modifié sans recalcul du
              // placement) → `null` : on simule comme avant plutôt que de raisonner sur un Gantt périmé.
              const chaineUnitePoseeAnc = (() => {
                if (plIdAnc !== plIdBPose) return null;
                const posee = chaineUnitePosee(plIdAnc, lotsDeLUnite.map(m => m.id), placements, simAxis);
                if (!posee) return null;
                if (lotsDeLUnite.some(m => !chgVenduTenu(posee, m))) {
                  debug.log("BOUCLE", `    RETOUR ${lotAnc.id} pose de l'unité incohérente avec ses dates vendues — simulée à la place`);
                  return null;
                }
                return posee;
              })();
              const trySim = (bRespecteDateL) => {
                const bSim = (bRespecteDateL && chaineUnitePoseeAnc) ? chaineUnitePoseeAnc : chaineUniteAncre(!bRespecteDateL);
                // Sur une paire, le repère de fin de chargement est le DERNIER : c'est à ce
                // moment-là que le camion est plein et peut juger sa rentrée avant le week-end.
                const bChgSim = paireAnc ? bSim.filter(b => b.type === "chg").pop() : bSim.find(b => b.type === "chg");
                const bLivSim = bSim.filter(b => b.type === "liv").pop();
                if (!bLivSim || bLivSim._overflow) return { reject: "B non planifiable" };

                // Q15 — CONTRAINTE DURE : le chargement VENDU de B ne bouge jamais. Ce contrôle
                // MANQUAIT dans la branche retour : `bChgSim` était calculé pour ses seules heures
                // (`bChgEndAbs`, contrôles week-end) et sa DATE n'était jamais relue. La règle ne
                // reposait donc que sur la confiance faite à `buildChain` — or ce dernier peut
                // repousser un chargement (règle vendredi, garde week-end, débordement d'axe). La
                // passe 2 (`ignoreDateL`) n'y change rien : elle n'assouplit que la LIVRAISON de B,
                // jamais son chargement. Un rejet ici est donc définitif, pas rattrapable au
                // remaniement.
                // C4 — la règle vaut pour CHAQUE membre déjà vendu du voyage, pas seulement pour
                // celui qui le représente. Sur une paire, greffer un retour ne doit pas faire
                // glisser le chargement de l'autre membre : il est vendu lui aussi.
                const nonTenu = lotsDeLUnite.find(m => !chgVenduTenu(bSim, m));
                if (nonTenu) {
                  debug.inc("boucle_rejets_chg_vendu");
                  const chgVu = bSim.filter(b => b.type === "chg" && b.lotId === nonTenu.id).map(b => b.date).sort()[0];
                  return { reject: `déplacerait le chargement VENDU de ${nonTenu.id} (${nonTenu.dateC} → ${chgVu || "?"}) — Q15` };
                }

                // Plage physique B : [jMin−1, jMax−1] (joursMinLot = nb de jours ouvrés occupés,
                // diffWorkdays = offset, d'où le −1). Échec en passe 1 → la passe 2 retentera
                // avec B avancé au plus tôt.
                // 4B — chaque membre garde SA plage physique : `joursMinLot` décrit un lot, pas un
                // voyage. Vérifier la paire globalement laisserait un membre s'étirer pendant que
                // l'autre se comprime, sans que rien ne le dise.
                for (const m of lotsDeLUnite) {
                  const livM = bSim.filter(b => b.type === "liv" && b.lotId === m.id).pop();
                  if (!livM) return { reject: `${m.id} n'est pas livré dans la chaîne de l'unité ancre` };
                  const jMinM = joursMinLot(m, rules), jMaxM = joursMaxLot(m, rules);
                  const dateLMEff = bLocked ? (m.dateL || livM.date) : livM.date;
                  const ecartM = diffWorkdays(m.dateC, dateLMEff);
                  if (ecartM < jMinM - 1 || ecartM > jMaxM - 1) return { reject: `ecart(${m.id})=${ecartM} hors [${jMinM - 1},${jMaxM - 1}] (dateL_eff=${dateLMEff})` };
                }

                // PLANCHER FLEX A : A ne peut pas être chargé avant le 1er jour de la fenêtre
                // négociée par l'agence vendeuse. Le curseur de A est donc le plus tardif entre
                // « fin de livraison B » et « 1er jour de flex de A ».
                const earliestAISO = [...allowedDatesAcc].sort()[0];
                const earliestAIdx = earliestAISO ? simAxis.indexOf(earliestAISO) : -1;
                const floorAbsAcc = earliestAIdx >= 0 ? toAbs(earliestAIdx, DAY_START) : bLivSim.endAbs;
                const startCursorAcc = Math.max(bLivSim.endAbs, floorAbsAcc);
                // dateL de A volontairement non contrainte dans la sim : A est livré au plus tôt
                // après B (la borne max est validée plus bas via flexL).
                const aSim = buildChain({ ...lotDraftNorm, dateL: undefined }, vehAnc, simAxis, { startGps: gpsFinUnite, startCursorAbs: startCursorAcc, ignoreDateL: true, rules }, agencesData);
                const aChgSim = aSim.find(b => b.type === "chg");
                const aLivSim = aSim.filter(b => b.type === "liv").pop();
                if (!aChgSim || !aLivSim || aChgSim._overflow || aLivSim._overflow) return { reject: "A non planifiable" };
                if (!allowedDatesAcc.has(aChgSim.date)) return { reject: `dateC_Acc=${aChgSim.date} hors flex A` };
                const liaisonH = aSim
                  .filter(b => (b.type === "repo" || b.type === "app") && b.startAbs < aChgSim.startAbs)
                  .reduce((s, b) => s + (b.duration || 0), 0);
                const attenteH = Math.max(0, workHoursBetween(bLivSim.endAbs, aChgSim.startAbs) - liaisonH);
                if (attenteH > ecartMaxH) {
                  debug.inc("boucle_rejets_attente");
                  return { reject: `attente non-productive ${attenteH.toFixed(1)}h > ecartMaxH=${ecartMaxH}h (hors liaison ${liaisonH}h)` };
                }
                // bSim/aSim remontés : ce sont LES chaînes de cette proposition — elles servent au
                // calcul des km évités RÉELS (invariant « proposé = posé »).
                // Les points que le camion a ENCORE à parcourir après son dernier chargement :
                // le lieu de ce chargement, puis les livraisons restantes, dans l'ordre de la
                // chaîne. Sur un lot seul c'est `[chg, liv]` — la lecture d'avant, au mot près.
                // Sur une paire, la livraison intermédiaire s'y ajoute, et c'est bien elle qui
                // décide si le camion peut rentrer avant le week-end.
                const etapesApresChg = [
                  gpsChgDe(bChgSim?.lotId),
                  ...bSim.filter(b => b.type === "liv" && b.startAbs >= (bChgSim?.endAbs ?? 0))
                    .map(b => gpsLivDe(b.lotId)).filter(Boolean),
                ].filter(Boolean);
                return { bLivSim, bChgEndAbs: bChgSim?.endAbs, dateL_B_proposed: bLivSim.date, aChgSim, aLivSim, attenteH, bSim, aSim, etapesApresChg };
              };

              // Dépôt de référence = celui du VÉHICULE qui exécute la boucle (agence opératrice).
              // Corrigé 2026-07-21 (Q17) : le contrôle ChgAcc→LivAcc utilisait `gpsDepotAcc`, le dépôt de
              // l'agence VENDEUSE de A. En boucle retour, A est chargé loin (chez le client de A)
              // mais porté par le PL de B → on validait un « retour à la base » vers une base qui
              // n'était pas la sienne, souvent à 2 pas du chargement. C'est ce qui laissait un PL
              // passer le week-end chargé à ~1000 km de son dépôt (cas T11).
              const agVeh = agLookup(vehAnc.ag, agencesData);
              const gpsDepotPL = agVeh.cp ? gc(agVeh.cp) : gpsDepotAnc;
              // Le plus long trajet CHARGÉ du voyage ancre : c'est lui qui décide s'il y a un
              // risque d'immobilisation loin de la base. Sur un lot seul, c'est son propre trajet.
              const kmBCBL = paireAnc
                ? Math.max(...lotsDeLUnite.map(m => hav(gc(m.cpC), gc(m.cpL))))
                : hav(gpsB_C, gpsB_L);
              const kmACAL = hav(gpsA_C, gpsA_L);
              const kmALDepot = hav(gpsA_L, gpsDepotPL);
              const jMinAcc = joursMinLot(lotDraftNorm, rules), jMaxAcc = joursMaxLot(lotDraftNorm, rules);
              const dateLRefAcc = lotDraft.dateL || lotDraft.dateC;
              const dateLMaxAcc = flexL > 0 ? addWorkdays(dateLRefAcc, flexL) : dateLRefAcc;

              // ── ÉVALUATION D'UNE SIMULATION ────────────────────────────────────────────────
              // Extrait en fonction le 2026-07-22 pour pouvoir REJOUER l'évaluation sur une autre
              // passe : un rejet week-end ne doit plus être définitif tant que la flex disponible
              // n'a pas été exploitée (arbitrage Louis — « le rejet ne vaut qu'après avoir tenté de
              // remanier les dates »). Retourne soit { reject, weekend? }, soit les dates retenues.
              const evaluerSim = (s) => {
                const dateL_B_prop = s.dateL_B_proposed;
                // 4B — la « livraison de l'ancre » d'un voyage, c'est sa DERNIÈRE. Sur un lot seul
                // c'est la sienne (lecture inchangée) ; sur une paire, celle du lot qui ferme.
                const dateL_B_eff = bLocked ? (lotFinUnite.dateL || dateL_B_prop) : dateL_B_prop;
                const dC_Acc = s.aChgSim.date;
                const dL_Acc = s.aLivSim.date;

                // Q4 — plage physique de A, puis borne max de sa flex livraison.
                // Livrer plus tôt que demandé reste OK (client ravi, simple confirmation).
                const ecartAcc = diffWorkdays(dC_Acc, dL_Acc);
                if (ecartAcc < jMinAcc - 1 || ecartAcc > jMaxAcc - 1) return { reject: `ecartAcc=${ecartAcc} hors [${jMinAcc - 1},${jMaxAcc - 1}] (dateC_Acc=${dC_Acc} dateL_Acc=${dL_Acc})` };
                if (dL_Acc > dateLMaxAcc) return { reject: `dateL_Acc=${dL_Acc} > dateL max autorisée ${dateLMaxAcc}` };

                // RÈGLE WEEK-END (Q17) : le PL ne doit à aucun moment de la mission se retrouver
                // loin de son dépôt pendant un week-end. Quatre segments à contrôler.
                // ⚠ Le vendredi de référence est celui qui PRÉCÈDE le week-end franchi — donc celui
                // de la semaine du CHARGEMENT. L'ancien contrôle « depuis la livraison » partait de
                // la fin de livraison, située APRÈS le week-end : il mesurait la mauvaise coupure et
                // laissait toujours passer. On part donc de la fin du chargement, en ajoutant la
                // route au trajet de retour pour le motif « PL déjà rendu en zone de livraison ».
                const viol = [];
                if (kmBCBL > (rules.seuilRoute ?? 15) && hasWeekendBetween(chgUnite, dateL_B_eff)) {
                  const etapes = s.etapesApresChg && s.etapesApresChg.length ? s.etapesApresChg : [gpsB_C, gpsB_L];
                  const okDepuisChgAnc = peutRentrerAvantWeekend(s.bChgEndAbs, [etapes[0]], gpsDepotPL, simAxis, rules);
                  const okDepuisLivAnc = peutRentrerAvantWeekend(s.bChgEndAbs, etapes, gpsDepotPL, simAxis, rules);
                  if (!okDepuisChgAnc && !okDepuisLivAnc) viol.push("ChgAnc→LivAnc");
                }
                // LivAnc → ChgAcc : temps mort entre les deux lots. Si un weekend s'y intercale, la règle
                // vendredi impose au PL de rentrer à son dépôt : la boucle n'est plus continue (il
                // faudrait redescendre ~870 km lundi, ce qui annule tout l'intérêt). Rejet
                // inconditionnel — même si livAnc et chgAcc sont la même ville, c'est l'immobilisation
                // du PL loin de sa base pendant le weekend qui casse la boucle.
                if (hasWeekendBetween(dateL_B_eff, dC_Acc)) viol.push("LivAnc→ChgAcc (weekend = boucle rompue)");
                if (kmACAL > (rules.seuilRoute ?? 15) && hasWeekendBetween(dC_Acc, dL_Acc)) {
                  const okDepuisChgAcc = peutRentrerAvantWeekend(s.aChgSim.endAbs, [gpsA_C], gpsDepotPL, simAxis, rules);
                  const okDepuisLivAcc = peutRentrerAvantWeekend(s.aChgSim.endAbs, [gpsA_C, gpsA_L], gpsDepotPL, simAxis, rules);
                  if (!okDepuisChgAcc && !okDepuisLivAcc) viol.push("ChgAcc→LivAcc");
                }
                // LivAcc → RETOUR DÉPÔT — 4ᵉ segment, AJOUTÉ le 2026-07-22 (dossier CHT-570751).
                // C'était le trou : les trois contrôles ci-dessus couvraient la mission jusqu'à la
                // livraison de A, mais pas le trajet de retour. Une boucle était donc proposée puis
                // acceptée alors que le PL livrait le vendredi et ne pouvait plus rentrer
                // (CHT-570751 : livré ven 04/09 dans le Var, 968 km du dépôt, retour lundi + mardi).
                // Pas de garde `hasWeekendBetween` ici : le retour est la DERNIÈRE étape, il n'y a pas
                // d'opération suivante à comparer. La question est directement « depuis la fin de la
                // livraison de A, le PL peut-il rejoindre son dépôt avant la coupure ? » —
                // peutRentrerAvantWeekend répond Infinity (donc true) si aucun vendredi n'est en vue.
                if (kmALDepot > (rules.seuilRoute ?? 15)
                    && !peutRentrerAvantWeekend(s.aLivSim.endAbs, [gpsA_L], gpsDepotPL, simAxis, rules)) {
                  viol.push("LivAcc→dépôt (PL bloqué hors base le weekend)");
                }
                if (viol.length > 0) return { reject: `weekend entre ops : [${viol.join(", ")}]`, weekend: true };

                // bSim/aSim portés jusqu'au bout : `ev` est la seule variable qui survit aux
                // remaniements/compactions (cf. plus bas), donc les chaînes RETENUES voyagent avec.
                return { dateL_B_prop, dateL_B_eff, dC_Acc, dL_Acc, bSim: s.bSim, aSim: s.aSim };
              };

              let sim = trySim(true);
              let passe = 1;
              if (sim.reject) {
                debug.log("BOUCLE", `    RETOUR ${lotAnc.id} passe 1 (B garde sa date) : ${sim.reject}`);
                if (bLocked) { debug.log("BOUCLE", `    RETOUR ${lotAnc.id} REJECT — B verrouillé, pas de passe 2`); return; }
                sim = trySim(false); passe = 2;
                if (sim.reject) { debug.log("BOUCLE", `    RETOUR ${lotAnc.id} REJECT passe 2 (B avancé) : ${sim.reject}`); return; }
              }
              let ev = evaluerSim(sim);

              // REMANIEMENT AVANT REJET (arbitrage Louis 2026-07-22) : un rejet week-end n'est
              // définitif qu'une fois la flex disponible exploitée. La passe 2 (livraison de B
              // avancée au plus tôt dans sa fenêtre) n'était jouée QUE sur échec des contrôles de
              // faisabilité, jamais sur violation week-end — CHT-570751 a donc été accepté sans
              // qu'on ait tenté de compresser la mission. On retente ici.
              // C'est le SEUL levier disponible : la date de chargement de B est verrouillée à la
              // vente (Q15), et les dates de A sont des conséquences (A charge dès que le PL est
              // libre après B). Décaler A à la semaine suivante n'en est pas un : le contrôle
              // LivAnc→ChgAcc ci-dessus casse la boucle dès qu'un week-end les sépare.
              if (ev.reject && ev.weekend && passe === 1 && !bLocked) {
                debug.log("BOUCLE", `    RETOUR ${lotAnc.id} passe 1 rejetée (${ev.reject}) → remaniement : retente avec B avancé au plus tôt`);
                const sim2 = trySim(false);
                if (sim2.reject) {
                  debug.log("BOUCLE", `    RETOUR ${lotAnc.id} remaniement impossible (passe 2 infaisable : ${sim2.reject})`);
                } else {
                  const ev2 = evaluerSim(sim2);
                  if (ev2.reject) {
                    debug.log("BOUCLE", `    RETOUR ${lotAnc.id} remaniement insuffisant (passe 2 : ${ev2.reject})`);
                  } else {
                    debug.inc("boucle_sauvees_par_remaniement");
                    debug.log("BOUCLE", `    RETOUR ${lotAnc.id} ✓ sauvée par remaniement — B avancé à ${ev2.dateL_B_prop}`);
                    // Seul `ev` porte les dates retenues au-delà d'ici — pas de réaffectation de `sim`.
                    ev = ev2; passe = 2;
                  }
                }
              }

              // COMPACTION DE LA TOURNÉE (arbitrage Louis 2026-07-24, règle métier §4 « ordre de
              // mobilité »). Jusqu'ici la passe 2 (B livré au plus tôt) n'était qu'un REPLI sur échec
              // de la passe 1. Nouveau : même quand la passe 1 réussit, si B n'est pas verrouillé on
              // joue aussi la passe 2 et on la PRÉFÈRE dès qu'elle livre A plus tôt — donc libère le
              // PL plus tôt (retour dépôt avancé, tampon week-end gagné). Priorité de mobilité :
              //   LIV A (levier)  >  LIV B = CHG A (suivent le couplage buildChain)  >  CHG B (jamais,
              //   chargement figé à la vente).
              // Le décalage de B réutilise le mécanisme impactPartnerDates existant (nouvelle date de
              // livraison de B + todo de confirmation à son agence). B verrouillé ⇒ LIV B figée ⇒ on
              // garde la passe 1 (pas de compaction de ce côté). Bascule sur gain STRICT de LIV A : à
              // LIV A égale, on ne dérange pas la date déjà promise de B pour rien.
              if (!ev.reject && passe === 1 && !bLocked) {
                const simCompact = trySim(false);
                if (!simCompact.reject) {
                  const evCompact = evaluerSim(simCompact);
                  // DÉCLENCHEURS (arbitrage Louis 2026-07-24) : on préfère la passe 2 dès qu'elle SERRE
                  // la tournée — càd rapproche une opération de sa date au plus tôt. Trois leviers, un
                  // seul suffit :
                  //   • CHG A plus tôt  → charger A au plus tôt est un objectif en soi ;
                  //   • LIV A plus tôt  → livrer A plus tôt libère le PL plus tôt ;
                  //   • LIV B plus tôt  → supprime une plage d'IMPRODUCTIVITÉ : B est arrivé mais
                  //     patientait CHARGÉ pour livrer à sa date « demandée » plus tardive (ex. arrive
                  //     le mardi, livrait le mercredi). Passe 2 le livre au plus tôt → l'attente saute.
                  // CHG B ne bouge jamais. Le décalage de B est confirmé côté client (impactPartnerDates
                  // → todo). La passe 2 étant « au plus tôt » partout, elle ne rend jamais une date plus
                  // tardive : compacter ne fait que rapprocher (client ravi), jamais reculer.
                  const serreCHGAcc = evCompact.dC_Acc < ev.dC_Acc;
                  const serreLIVAcc = evCompact.dL_Acc < ev.dL_Acc;
                  const serreLIVAnc = evCompact.dateL_B_prop < ev.dateL_B_prop;
                  if (!evCompact.reject && (serreCHGAcc || serreLIVAcc || serreLIVAnc)) {
                    debug.inc("boucle_compactees");
                    debug.log("BOUCLE", `    RETOUR ${lotAnc.id} ✓ COMPACTÉE — CHG A ${ev.dC_Acc}→${evCompact.dC_Acc}, LIV A ${ev.dL_Acc}→${evCompact.dL_Acc}, LIV B ${ev.dateL_B_prop}→${evCompact.dateL_B_prop}`);
                    ev = evCompact; passe = 2;
                  }
                }
              }

              if (ev.reject) {
                if (ev.weekend) debug.inc("boucle_rejets_weekend");
                debug.log("BOUCLE", `    RETOUR ${lotAnc.id} REJECT (passe ${passe}) ${ev.reject}`);
                return;
              }

              const dateL_B_proposed = ev.dateL_B_prop;
              const dateL_B_effective = ev.dateL_B_eff;
              const dateC_A_retour = ev.dC_Acc;
              const dateL_A_retour = ev.dL_Acc;
              debug.log("BOUCLE", `    RETOUR ${lotAnc.id} dateL_Anc (buildChain): demandé=${lotAnc.dateL} · calculé=${dateL_B_proposed} · effectif=${dateL_B_effective}${bLocked ? " (B locked, garde sa date)" : (dateL_B_proposed !== lotAnc.dateL ? " ⚠ B décalé" : "")}`);
              debug.log("BOUCLE", `    RETOUR ${lotAnc.id} dateC_Acc (buildChain)=${dateC_A_retour}${dateC_A_retour !== lotDraft.dateC ? ` ⚠ demandé=${lotDraft.dateC}` : ""}`);
              debug.log("BOUCLE", `    RETOUR ${lotAnc.id} dateL_Acc (buildChain)=${dateL_A_retour}${dateL_A_retour !== dateLRefAcc ? ` ⚠ demandé=${dateLRefAcc}` : ""}`);
              const livAccEarlierThanRequested = dateL_A_retour < dateLRefAcc;
              if (livAccEarlierThanRequested) {
                debug.log("BOUCLE", `    RETOUR ${lotAnc.id} ℹ livraison anticipée : ${dateL_A_retour} au lieu de ${dateLRefAcc} — à confirmer avec client`);
              }

              // Q14 (arbitrage 2026-07-19) : faisabilité vs planning RÉEL du PL de B. La boucle
              // occupe le PL en continu de chgAnc à livAcc ; si d'autres lots (ou blocs manuels) y sont
              // déjà posés sur cette période, la proposition serait infaisable — le reflow
              // sérialiserait et décalerait des dates en silence. → rejet en amont.
              const spanStartRetour = chgUnite < dateC_A_retour ? chgUnite : dateC_A_retour;
              const spanEndRetour = (dateL_B_effective && dateL_B_effective > dateL_A_retour) ? dateL_B_effective : dateL_A_retour;
              // ── V2 (4B) — LE CO-VOYAGEUR N'EST PAS UN INTRUS ─────────────────────────────────
              // `plBusyInRange` demande « ce camion porte-t-il déjà autre chose sur la période ? ».
              // Sur une paire, l'autre membre EST sur le camion, forcément, et sur toute la
              // période : la question posée telle quelle recevait toujours « oui », et aucune
              // greffe sur une paire ne pouvait passer. On exclut donc les membres du voyage —
              // ils ne sont pas un obstacle, ils sont le voyage.
              if (plBusyInRange(plIdAnc, spanStartRetour, spanEndRetour, placements, [lotDraft.id, ...membresTournee])) {
                debug.inc("boucle_rejets_pl_occupe");
                debug.log("BOUCLE", `    RETOUR ${lotAnc.id} REJECT — PL ${plIdAnc} occupé par un autre lot sur [${spanStartRetour}..${spanEndRetour}] (Q14)`);
                rejetVehicule(`PL ${plIdAnc} déjà occupé par un autre chantier du ${spanStartRetour} au ${spanEndRetour}`);
                return;
              }

              // kmEco retour — formule UNIQUE via le helper partagé (même valeur que la pastille
              // Gantt / le KPI, alimentés par detectBoucles). Rôles : ancre = lotAnc (déjà placé,
              // son PL ancre le trajet), accroché = lotDraft (« A »). Les CP inconnus sont déjà
              // filtrés en amont (SKIP CP non reconnu) → eco n'est jamais null ici.
              const ecoGeo = kmEcoBoucleRetour({
                depotAncre: gpsDepotAnc, chgAncre: gpsB_C, livAncre: gpsB_L,
                depotAccroche: gpsDepotAcc, chgAccroche: gpsA_C, livAccroche: gpsA_L,
              });
              // KM ÉVITÉS RÉELS (2026-07-28) : chaînes de CETTE proposition (ev.bSim/ev.aSim, qui
              // survivent aux remaniements et à la compaction) vs chaque lot posé seul depuis le
              // dépôt de son agence vendeuse. Repli géométrique si une chaîne n'est pas exploitable.
              const chaineSeuleRetour = (lot) => buildChain(
                lot, { ...vehAnc, ag: lot.soc }, simAxis, { rules, gardeWeekendRetour: true }, agencesData,
              );
              // 🔑 LA RÉFÉRENCE EST LA TOURNÉE DÉJÀ ACQUISE, PAS SES MEMBRES SÉPARÉS — exactement la
              // doctrine de `detectBoucles` (Lot 1). Comparer l'accroché aux deux membres pris
              // séparément recompterait ici le gain de la MUTUALISATION, déjà crédité de son côté :
              // le KPI additionne les deux, ils doivent rester DISJOINTS. C'est aussi ce qui rend le
              // double couplage lisible — gain total = gain de la paire + gain du retour.
              // La tournée acquise, c'est celle du Gantt quand elle y est complète — retour au dépôt
              // compris : sans son dernier retour (unité suivie d'un autre lot), elle sous-compterait
              // le trajet « ancre seule », donc on la simule comme la pose (2026-09-16).
              // Sur un lot seul, « seul » se compte depuis le dépôt de son agence VENDEUSE
              // (`chaineSeuleRetour`) : la pose n'est reprise que si c'est aussi celui du camion.
              const poseeFinitAuDepot = chaineUnitePoseeAnc
                && (paireAnc || agLookup(vehAnc.ag, agencesData).cp === agAnc.cp)
                && EST_RETOUR_FINAL(chaineUnitePoseeAnc[chaineUnitePoseeAnc.length - 1]);
              const chaineUniteSeule = poseeFinitAuDepot
                ? chaineUnitePoseeAnc
                : paireAnc
                  ? simulerPaireCommeLaPose(paireAnc, vehAnc, simAxis, { rules, gardeWeekendRetour: true }, agencesData)
                  : chaineSeuleRetour(lotAnc);
              const ecoReel = kmEcoBoucleRetourReel({
                chaineAncre: ev.bSim,
                chaineAccroche: ev.aSim,
                chaineAncreSeule: chaineUniteSeule,
                chaineAccrocheSeul: chaineSeuleRetour(lotDraftNorm),
              });
              // Le repli géométrique ne sait décrire qu'UN dossier ancre (`kmEcoBoucleRetour` prend
              // un chargement et une livraison). Sur une paire il parlerait d'autre chose que ce qui
              // roule : on préfère alors ne rien proposer plutôt qu'un gain faux — jamais un mauvais
              // chiffre plutôt qu'un trou. Même doctrine que `detectBoucles`.
              const eco = ecoReel || (paireAnc ? null : ecoGeo);
              if (!eco) {
                debug.inc("boucle_rejets_tournee_non_chiffrable");
                debug.log("BOUCLE", `    RETOUR ${lotAnc.id} REJECT — tournée mutualisée dont une chaîne n'est pas exploitable : aucun gain chiffrable`);
                return;
              }
              const kmEco_retour = eco ? eco.kmEco : 0;
              debug.log("BOUCLE", `    RETOUR ${lotAnc.id} kmEco=${kmEco_retour} ${ecoReel ? "RÉEL" : "(repli géométrique)"} (ancre seul=${eco?.ancreSeule} + accroché(A) seul=${eco?.accrocheSeul} - combiné=${eco?.combine}) vs minKmEco=${minKmEco}`);

              // Part du trajet total que la boucle supprime — c'est elle qui donne la couleur.
              const pctGain_retour = pctGainBoucle(kmEco_retour, eco?.accrocheSeul, eco?.ancreSeule);
              // PARCOURS RÉELLEMENT PROPOSÉ (2026-07-29) : les deux chaînes simulées, mises bout à
              // bout comme le PL les roulera. Le retour dépôt final de l'ancre saute — il ne rentre
              // pas, il enchaîne sur le chargement de l'accroché ; c'est exactement le périmètre déjà
              // retenu pour le calcul des km évités (EST_RETOUR_FINAL), donc le parcours affiché et le
              // gain annoncé parlent des mêmes kilomètres. Le panneau n'a plus à recalculer quoi que
              // ce soit à vol d'oiseau : il rend ce qui sera posé (« proposé = posé »).
              const chaineSimulee_retour = [
                ...(ev.bSim || []).filter(b => !EST_RETOUR_FINAL(b)),
                ...(ev.aSim || []),
              ];

              // UI-RAL : ce que l'accroché AJOUTE au voyage. Calculé ICI (et non plus dans l'objet
              // émis) parce que depuis le 2026-08-14 il ne sert plus seulement à afficher : c'est
              // l'entrée de la pile de garde-fous. Porteur du retour : liv ANC → dépôt du camion
              // (le vide qu'on remplit), et non le dépôt de l'agence vendeuse de l'accroché.
              const mesures_retour = mesuresRetourAccroche({
                // 4B — le vide qu'on remplit part de la DERNIÈRE livraison du voyage ancre, pas de
                // celle du lot qui le représente. Sur une paire, l'écart entre les deux est
                // précisément le détour que les garde-fous doivent peser.
                depot: gpsDepotPL, livAncre: gpsFinUnite,
                chgAccroche: gpsA_C, livAccroche: gpsA_L,
                acc: lotDraftNorm, rules,
              });
              // DÉCALAGE DE LA LIVRAISON DE L'ANCRE, en jours CALENDAIRES — le terme μ du score.
              // Zéro quand l'ancre est verrouillée : sa livraison ne bouge pas, il n'y a rien à
              // facturer. On réutilise EXACTEMENT le signal qui alimente déjà `impactPartnerDates`
              // et `partnerNewDateL` (`dateL_B_proposed`) : un second signal divergerait au premier
              // correctif.
              // 🔑 VALEUR SIGNÉE, PLUS ABSOLUE (arbitrage Louis 2026-08-18 : « livraison avancée à
              // pénaliser moins qu'une livraison retardée »). `diffDaysIso(a, b)` rend `b − a` :
              // POSITIF = la livraison proposée est PLUS TARDIVE que l'annoncée = RETARD ;
              // NÉGATIF = plus tôt = AVANCE. `evaluerGardes` applique μ à l'un, ν à l'autre.
              // ⚠️ Ne jamais remettre `Math.abs` ici : le calcul du score serait juste, et
              // l'asymétrie resterait morte — le moteur ne lui transmettrait plus l'information
              // qui la rend applicable. C'était l'état du 2026-08-18 au matin.
              const decalageAncre_retour = (!bLocked && dateL_B_proposed && lotAnc.dateL && dateL_B_proposed !== lotAnc.dateL)
                ? diffDaysIso(lotAnc.dateL, dateL_B_proposed)
                : 0;
              const gardes_retour = evaluerGardes({
                mesures: mesures_retour, kmEco: kmEco_retour,
                decalageJours: decalageAncre_retour, geometrie: "retour", rules,
              });
              if (!gardes_retour.ok) {
                debug.inc(`boucle_rejets_${gardes_retour.cause}`);
                debug.log("BOUCLE", `    RETOUR ${lotAnc.id} REJECT garde-fou ${gardes_retour.cause} — ${gardes_retour.message}`);
                return;
              }

              // « Proposé = posé » par construction (cf. `poseTientLaProposition`). Pas en diagnostic
              // multi-camion : le camion évalué n'est pas celui de l'unité, la pose y serait fictive.
              if (kmEco_retour >= minKmEco && !diagnostic) {
                const verdictPose = poseTientLaProposition({
                  type: "retour", plId: plIdAnc, lotAnc,
                  dateC: dateC_A_retour, dateL: dateL_A_retour,
                  partnerNewDateL: (!bLocked && dateL_B_proposed !== lotAnc.dateL) ? dateL_B_proposed : null,
                  lotsVendus: lotsDeLaTournee,
                });
                if (!verdictPose.ok) {
                  debug.inc("boucle_rejets_pose_divergente");
                  debug.log("BOUCLE", `    RETOUR ${lotAnc.id} REJECT proposé ≠ posé — ${verdictPose.raison}`);
                  return;
                }
              }
              if (kmEco_retour >= minKmEco) {
                if (!diagnostic) debug.inc("boucle_candidats_proposes");
                debug.log("BOUCLE", `    ✓ RETOUR ${lotAnc.id} ACCEPTÉ — kmEco=${kmEco_retour} scoreClassement=${gardes_retour.score} (rallonge=${gardes_retour.composantes.rallongeJours?.toFixed(2)} j · détour=${gardes_retour.composantes.detourKm} km · décalage=${decalageAncre_retour} j)`);
                debug.log("BOUCLE", `    RETOUR ${lotAnc.id} récap dates A: demandé=${lotDraft.dateC}→${lotDraft.dateL || lotDraft.dateC} · proposé=${dateC_A_retour}→${dateL_A_retour}${dateC_A_retour !== lotDraft.dateC ? " ⚠ chg décalé (doit attendre fin livAnc)" : ""}${livAccEarlierThanRequested ? " ⚠ liv anticipée" : ""}`);
                emettre({
                  type: "retour",
                  partnerLot: lotAnc,
                  partnerAgence: lotAnc.soc,
                  partnerPlId: plIdAnc,
                  dateC: dateC_A_retour,
                  dateL: dateL_A_retour,
                  distRepo: Math.round(distChgAccLivAnc),
                  ecartJours: diffDaysIso(dateL_B_effective, dateC_A_retour),
                  kmEco: kmEco_retour,
                  pctGain: pctGain_retour,
                  score: scoreBoucle(pctGain_retour, rules),
                  isPreferred: dateC_A_retour === dateChgVoulueA,
                  impactPartnerDates: !bLocked && dateL_B_proposed !== lotAnc.dateL,
                  partnerNewDateC: null,
                  partnerNewDateL: bLocked ? null : dateL_B_proposed,
                  _livraisonAnticipee: livAccEarlierThanRequested ? { proposee: dateL_A_retour, demandee: dateLRefAcc } : null,
                  sequence: "retour",
                  kmTrajRetour: eco ? eco.combine : 0,
                  kmTrajBSeul: eco ? eco.ancreSeule : 0,
                  kmTrajASeul: eco ? eco.accrocheSeul : 0,
                  // UI-RAL (tranché Louis 2026-08-12) : ce que l'accroché AJOUTE au voyage, en km
                  // et en temps d'immobilisation. Depuis le 2026-08-14 ce n'est plus qu'un affichage :
                  // c'est l'entrée de la pile de garde-fous (cf. `mesures_retour` plus haut).
                  _mesures: mesures_retour,
                  // G1 — LE PILIER QUI A FAIT PASSER LE TERRITOIRE (D7, 2026-09-15). Rendu pour que
                  // l'écran l'AFFICHE sans rien recalculer : « pilier maison », « au loin »… `null`
                  // quand aucune zone n'est déclarée (règle inactive). Ne pas le reconstituer à
                  // l'écran avec `checkRetourZones` : celle-ci ne connaît que le croisement complet.
                  territoire: zonesCheck.inactif ? null : {
                    pilier: zonesCheck.pilier, zoneDepot: zonesCheck.zoneDepot, zoneLoin: zonesCheck.zoneLoin,
                  },
                  // LE SCORE DE CLASSEMENT (arbitrage Louis 2026-08-14) — c'est lui qui ordonne les
                  // propositions, cf. `compareBoucleCandidates`. ⚠️ À ne pas confondre avec `score`
                  // ci-dessus, qui est l'ÉTIQUETTE QUALITATIVE ("excellent"/"bon"/…) servant de
                  // classe CSS à la carte de suggestion depuis 2026-07-29 : deux notions, deux
                  // champs. Les composantes sont attachées pour que l'interface les AFFICHE sans
                  // rien recalculer (« + 940 km évités · + 1,2 j de camion · détour 180 km »).
                  scoreClassement: gardes_retour.score,
                  scoreComposantes: gardes_retour.composantes,
                  _chaineSimulee: chaineSimulee_retour,
                });
              }
            }
            else {
              debug.log("BOUCLE", `    RETOUR ${lotAnc.id} REJECT F5 capacité (volAcc=${lotDraftVol} > cap=${vehAnc.cap})`);
              rejetVehicule(`capacité insuffisante (${vehAnc.cap} m³ pour ${lotDraftVol} m³ à charger)`);
            }
          }
        } // fin B-first (séquence unique — voir RÈGLE DE GOUVERNANCE en tête de scénario)

      }
      else debug.log("BOUCLE", `    RETOUR ${lotAnc.id} SKIP (même soc=${lotAnc.soc} ou vendeuseSeulement)`);
    }; // fin evaluerRetour

    // ══ SCÉNARIO MUTUALISATION (même agence, OU même région) ══
    // Fix E : deux séquences avec leurs propres chaînes de dates
    // S1 : Dépôt → ChgAnc → ChgAcc → LivAcc → LivAnc → Dépôt  (B charge en premier)
    // S2 : Dépôt → ChgAcc → ChgAnc → LivAnc → LivAcc → Dépôt  (A charge en premier)
    //
    // PÉRIMÈTRE (arbitrage Louis 2026-07-29) : la mutualisation n'est plus réservée à une seule
    // agence, elle s'ouvre aux agences d'une MÊME RÉGION. L'acceptation de l'agence voisine est
    // IMPLICITE — la cible d'organisation étant « 1 région = 1 planificateur », c'est la même
    // personne qui monte la boucle des deux côtés : aucun circuit de validation, aucune notification.
    // 🔵 GARDE-FOU GÉOGRAPHIQUE — CHANGÉ LE 2026-08-19 (arbitrage Louis). C'était `seuilProxMutuKm`,
    // 80 km bruts entre les deux chargements, et il était SEUL : les zones de chalandise ne
    // s'appliquaient pas à la mutualisation. C'est précisément cette solitude qui l'avait maintenu
    // à 80 km le 2026-08-03 pendant que le retour, lui, passait à 300. Désormais **G1 couvre les
    // deux scénarios** : le seuil kilométrique est retiré et remplacé par `checkMutuZones` — les
    // deux chargements doivent se collecter dans LA MÊME zone déclarée. Même doctrine qu'au
    // retour : la règle n'est pas métrique, elle est topologique, et ce qui reste kilométrique
    // (le détour de collecte) est mesuré par G2 sur la géométrie réelle, pas par un rayon fixe.
    const evaluerMutu = (vehAnc, plIdAnc, out) => {
      const { emettre, rejetVehicule, diagnostic } = out;
      // 4B — une MUTUALISATION ne se greffe pas sur une mutualisation. Trois lots dans le même
      // camion en même temps, ce n'est plus le double couplage arbitré : c'est une composition
      // libre de tournées, jamais mesurée et jamais tranchée.
      if (typesTournee.includes("mutualisation")) {
        debug.inc("boucle_rejets_mutu_sur_mutu");
        debug.log("BOUCLE", `    MUTU ${lotAnc.id} SKIP — sa tournée porte déjà une mutualisation (${membresTournee.join("+")})`);
        return;
      }
      // L'ORIENTATION N°2 DU LOT 4 : l'ancre porte DÉJÀ un retour, et on lui propose un
      // co-voyageur devant. La paire se calcule comme d'habitude — mais le lot accroché derrière
      // doit encore tenir après elle, et c'est un contrôle en propre (cf. `accrocheTientDerriere`).
      const accrocheExistant = lotsDeLaTournee.find(m => m.id !== lotAnc.id) || null;
      // `vendeuseSeulement` interdit à un dossier de partir sur le camion d'une AUTRE agence. Le
      // drapeau ne filtrait jusqu'ici que le retour : la mutualisation étant intra-agence, il n'y
      // avait rien à interdire. Maintenant qu'elle peut franchir la frontière d'agence, il doit
      // valoir ici aussi — la mutualisation chez soi, elle, reste évidemment permise.
      if (lotDraft.vendeuseSeulement && lotAnc.soc !== lotDraft.soc) {
        debug.log("BOUCLE", `    MUTU ${lotAnc.id} SKIP (lot A en agence vendeuse uniquement, ancre ${lotAnc.soc})`);
        return;
      }
      if (memePerimetreMutu(lotAnc.soc, lotDraft.soc, agencesData)) {
        // G1 — TERRITOIRE : les deux chargements se collectent dans LA MÊME zone déclarée.
        // `memePerimetreMutu` ci-dessus dit qui a le DROIT de mutualiser (même agence, ou deux
        // agences d'une même région) ; ceci dit OÙ. Les deux sont nécessaires : une région
        // administrative n'est pas une zone de chalandise, et deux agences d'une même région
        // peuvent charger dans deux zones différentes.
        const zonesMutuCheck = checkMutuZones({
          chgAncre: lotAnc.cpC, chgAccroche: lotDraft.cpC,
        }, rules.zonesRetour);
        if (!zonesMutuCheck.ok) {
          debug.inc("boucle_rejets_zone");
          debug.log("BOUCLE", `    MUTU ${lotAnc.id} REJECT zones — ${zonesMutuCheck.raison}`);
          return;
        }
        // Détour de collecte : MESURÉ et tracé, plus jamais barrière (cf. le commentaire de tête
        // de ce scénario). C'est G2 qui le borne, en le pesant contre le trajet qu'il remplace.
        const distChgAccChgAnc = hav(gpsA_C, gpsB_C);
        debug.log("BOUCLE", `    MUTU ${lotAnc.id} détour de collecte chgAcc(${lotDraft.cpC}) ↔ chgAnc(${lotAnc.cpC}) = ${Math.round(distChgAccChgAnc)}km (mesure, plus de seuil)`);

        // F5 — capacité (A et B simultanément dans le camion)
        debug.log("BOUCLE", `    MUTU ${lotAnc.id} F5: volAcc+volAnc=${lotDraftVol}+${lotAnc.vol}=${lotDraftVol+lotAnc.vol} vs cap=${vehAnc.cap}`);
        if (lotDraftVol + lotAnc.vol > vehAnc.cap) {
          debug.log("BOUCLE", `    MUTU ${lotAnc.id} REJECT F5 capa insuffisante`);
          rejetVehicule(`capacité insuffisante (${vehAnc.cap} m³ pour ${lotDraftVol + lotAnc.vol} m³ à charger ensemble)`);
          return;
        }

        // ── DÉPÔTS (corrigé 2026-07-29, mutualisation régionale) ──────────────────────────────
        // Deux dépôts DIFFÉRENTS interviennent, et les confondre fausse le gain annoncé :
        //
        //  • le CIRCUIT mutualisé part et revient au dépôt du CAMION (celui de l'ancre B) — c'est
        //    le seul trajet réellement roulé. Aligné sur `gpsDepotPL` de la branche retour (:808).
        //  • le contrefactuel « chaque lot tout seul » repart, pour CHAQUE lot, du dépôt de SA
        //    PROPRE agence vendeuse : sans mutualisation, l'agence de A aurait sorti son camion
        //    depuis chez elle. La branche retour le fait déjà explicitement (`chaineSeuleRetour`,
        //    `{ ...vehAnc, ag: lot.soc }`).
        //
        // Tant que la mutualisation était réservée à une seule agence, les deux dépôts étaient le
        // même point et l'erreur était invisible. Entre deux agences d'une même région, elle
        // fausse `kmEco` et `pctGain` — donc le classement des propositions.
        const agVehMutu = agLookup(vehAnc.ag, agencesData);
        const gpsDepot = agVehMutu.cp ? gc(agVehMutu.cp) : gpsDepotAnc;
        const depotVendeuse = (soc, repli) => { const a = agLookup(soc, agencesData); return a.cp ? gc(a.cp) : repli; };
        const gpsDepotVendeuseAcc = depotVendeuse(lotDraft.soc, gpsA_C);
        const gpsDepotVendeuseAnc = depotVendeuse(lotAnc.soc, gpsB_C);
        // Géométrie de la mutualisation — helper partagé `kmEcoMutualisation` (point d'application
        // unique, cf. son commentaire). Les valeurs `brut` sont utilisées telles quelles : elles sont
        // au bit près celles que ce bloc calculait à la main avant l'extraction du 2026-08-06.
        const ecoGeoMutu = kmEcoMutualisation({
          depotCircuit: gpsDepot, depotVendeuseAncre: gpsDepotVendeuseAnc, depotVendeuseAccroche: gpsDepotVendeuseAcc,
          chgAncre: gpsB_C, livAncre: gpsB_L, chgAccroche: gpsA_C, livAccroche: gpsA_L,
        });
        // Inatteignable en pratique — `gc()` renvoie toujours un point (repli centre France) — mais
        // le helper a le droit de dire non, et un chiffre fabriqué serait pire que pas de proposition.
        if (!ecoGeoMutu) { debug.log("BOUCLE", `    MUTU ${lotAnc.id} REJECT — position manquante`); return; }
        const kmB_seul_m = ecoGeoMutu.brut.ancreSeule;
        const kmA_seul_m = ecoGeoMutu.brut.accrocheSeul;

        // ── Dates calculées par le VRAI planificateur buildMutuChain (unification « proposé = posé ») ──
        // On groupe le chargement de A sur le jour de chargement (fixe) de B, puis buildMutuChain pose
        // les livraisons AU PLUS TÔT en appliquant heures ouvrées + week-end + règle vendredi, exactement
        // comme le placement réel. La règle vendredi intégrée à buildMutuChain remplace les anciens
        // contrôles « weekendViol » manuels : si un trajet long traverse un week-end, la route est
        // décalée au lundi → la livraison glisse → l'écart sort de [jMin−1, jMax−1] et la séquence est
        // rejetée. On évalue les deux séquences possibles (S1 = B charge avant A ; S2 = A charge avant B).
        //
        // ── BALAYAGE DE LA FENÊTRE DE FLEX (arbitrage Louis 2026-07-28) ────────────────────────
        // RÈGLE : la date de chargement d'un dossier VENDU est intouchable. L'ancre B est vendu →
        // `lotAnc.dateC` ne bouge JAMAIS (Q15). Le lot A est en cours de vente → son chargement peut se
        // déplacer DANS SA FENÊTRE DE FLEX négociée, et uniquement là.
        // Jusqu'ici A n'était pas seulement contraint, il était ÉPINGLÉ sur la date de B
        // (`aMutuSim.dateC = lotAnc.dateC`), sa propre fenêtre ne servant que de filtre d'acceptation.
        // On balaye donc les dates de chargement possibles pour A et on retient celle dont la chaîne
        // POSÉE roule le moins. Garde-fou restant : A verrouillé ou flex nulle ⇒ pas de balayage.
        // (Le seuil `gainMinDecalageChgKm`, qui préférait la date groupée sur B tant qu'une autre ne
        // faisait pas gagner 300 km, a été RETIRÉ le 2026-09-03 — cf. le bloc CHOIX plus bas.)
        const aLocked = isLotLocked(lotDraftNorm);
        const peutBalayer = !aLocked && flexC > 0;
        // Base = comportement historique : A chargé le même jour que B (groupage serré).
        const datesChgAcc = [lotAnc.dateC];
        if (peutBalayer) {
          [...allowedDatesAcc]
            .filter(d => d !== lotAnc.dateC)
            // Ordre de préférence à gain égal : le moins de décalage vs la date demandée par A, puis le plus tôt.
            .sort((x, y) => Math.abs(diffDaysIso(dateChgVoulueA, x)) - Math.abs(diffDaysIso(dateChgVoulueA, y)) || (x < y ? -1 : 1))
            .forEach(d => datesChgAcc.push(d));
        }
        debug.log("BOUCLE", `    MUTU ${lotAnc.id} balayage flex A : ${datesChgAcc.length} date(s) candidate(s)${peutBalayer ? "" : ` (inactif — ${aLocked ? "A verrouillé" : "flex nulle"})`} · chg B figé au ${lotAnc.dateC}`);

        const simStartMutu = [lotDraft.dateC, ...datesChgAcc].sort()[0];
        const simAxisMutu = buildWorkAxis(simStartMutu, 45);
        const jMinA_m = joursMinLot(lotDraftNorm, rules), jMaxA_m = joursMaxLot(lotDraftNorm, rules);
        const jMinB_m = joursMinLot(lotAnc, rules), jMaxB_m = joursMaxLot(lotAnc, rules);
        const dateLRefA_m = lotDraft.dateL || lotDraft.dateC;
        const dateLMaxA_m = flexL > 0 ? addWorkdays(dateLRefA_m, flexL) : dateLRefA_m;

        // ATTENTE NON-PRODUCTIVE — `ecartMaxH` ÉTENDU À LA MUTUALISATION (2026-08-14, demande Louis).
        //
        // La règle n'existait qu'au RETOUR, où elle borne le temps mort entre la livraison de
        // l'ancre et le chargement de l'accroché. La mutualisation n'avait AUCUN contrôle de temps,
        // ni géométrique ni calendaire — alors que sa géométrie en fabrique par construction :
        // chaque chargement est ancré à SA date vendue (cf. « forcer le cursor à dateC » dans
        // `buildMutuChainInterne`), donc deux chargements à deux dates différentes laissent le
        // camion CHARGÉ, à l'arrêt, entre les deux. Rien ne le bornait.
        //
        // CE QUI EST MESURÉ : la COLLECTE seule — de la fin du chargement du premier dossier au
        // début de celui du second. C'est la transposition exacte de la règle du retour, qui borne
        // la JONCTION ENTRE LES DEUX DOSSIERS (liv ANCRE → chg ACCROCHÉ) et jamais l'attente
        // interne à la mission d'un dossier. Mesurer toute la tournée reviendrait à refuser une
        // paire saine parce que le client a demandé une livraison tardive — un temps mort qui
        // existerait sans mutualisation, et que le signal `_inactivite` couvre déjà. Cf.
        // `attenteMaxCollecte`, où le raisonnement est écrit en entier.
        //
        // MÊME SEUIL que le retour, volontairement : c'est la même règle métier (« pas plus d'une
        // demi-journée d'inactivité entre deux actions »), et rien ne justifie aujourd'hui deux
        // valeurs — aucune des deux n'a encore été mesurée (balayage en fil de l'eau à faire).
        const ecartMaxH = rules.ecartMaxH ?? 5.5;

        const evalMutuSeq = (seq, dateChgAcc) => {
          const aMutuSim = { ...lotDraftNorm, dateC: dateChgAcc, dateL: undefined };
          // gardeWeekendRetour (Q17 étendu, 2026-07-22) : la simulation doit voir la MÊME chaîne que
          // celle qui sera posée (invariant « proposé = posé ») — donc garde active ici AUSSI, pas
          // seulement à la pose. Si la mission laisserait le PL dehors le week-end, buildMutuChain la
          // décale au lundi ; les contrôles de flex ci-dessous (allowedDatesAcc, ecartAcc/ecartAnc) tranchent
          // alors sur les dates décalées → le rejet n'intervient qu'après avoir tenté le décalage.
          const blocks = buildMutuChain(aMutuSim, lotAnc, seq, vehAnc, simAxisMutu, { rules, gardeWeekendRetour: true }, agencesData);
          const chgAcc = blocks.find(b => b.type === "chg" && b.lotId === lotDraftNorm.id);
          const livAcc = blocks.filter(b => b.type === "liv" && b.lotId === lotDraftNorm.id).pop();
          const livAnc = blocks.filter(b => b.type === "liv" && b.lotId === lotAnc.id).pop();
          if (!chgAcc || !livAcc || !livAnc || chgAcc._overflow || livAcc._overflow || livAnc._overflow) return null;
          // Q15 — CONTRAINTE DURE, ÉVALUÉE EN PREMIER : si la chaîne posée déplace le chargement
          // VENDU de B, cette séquence n'existe pas. `buildMutuChain` peut le décaler via le remède 2
          // de la garde week-end (décalage de toute la tournée au lundi) : c'était toléré tant que
          // `chgAncTenu` n'était qu'un critère de tri, et une mutu pouvait passer en repoussant la date
          // promise au client (cas fondateur CHT-463530/CHT-400887, chg de l'ancre ven 18/09 → lun
          // 21/09). Q17 et Q15 sont toutes deux absolues : leur conflit ne se négocie pas, il
          // supprime la boucle.
          if (!chgVenduTenu(blocks, lotAnc)) {
            debug.inc("boucle_rejets_chg_vendu");
            debug.log("BOUCLE", `    MUTU ${lotAnc.id} REJECT ${seq}/chgAcc=${dateChgAcc} — déplacerait le chargement VENDU de B (${lotAnc.dateC} → ${blocks.find(b => b.type === "chg" && b.lotId === lotAnc.id)?.date || "?"}) — Q15`);
            return null;
          }
          const dC_Acc = chgAcc.date, dL_Acc = livAcc.date, dL_Anc = livAnc.date;
          // A doit charger dans sa fenêtre de flexibilité négociée
          if (!allowedDatesAcc.has(dC_Acc)) return null;
          // Écart physique A = span−1 jour ouvré ; livraison A pas plus tard que la limite de flex
          const ecartAcc = diffWorkdays(dC_Acc, dL_Acc);
          if (ecartAcc < jMinA_m - 1 || ecartAcc > jMaxA_m - 1) return null;
          if (dL_Acc > dateLMaxA_m) return null;
          // Écart physique B (B garde sa date si verrouillé) — mesuré depuis son chargement, qui ne
          // bouge jamais (dossier vendu).
          const dL_B_eff = bLocked ? lotAnc.dateL : dL_Anc;
          const ecartAnc = diffWorkdays(lotAnc.dateC, dL_B_eff);
          if (ecartAnc < jMinB_m - 1 || ecartAnc > jMaxB_m - 1) return null;
          // Attente de collecte (cf. § ci-dessus). Mesurée sur la chaîne POSÉE, pas estimée : même
          // invariant « proposé = posé » que les contrôles qui précèdent. La plage est la journée
          // standard — `evalMutuSeq` ne demande pas `appliquerPlageLot` à `buildMutuChain`, la
          // chaîne mesurée est donc bien celle-là.
          // Un rejet ici n'est PAS définitif : le balayage de la flex de l'accroché et l'autre
          // séquence (S1/S2) sont réessayés — c'est l'équivalent de la passe 2 du retour.
          const attente = attenteMaxCollecte(blocks, simAxisMutu);
          if (attente && attente.heures > ecartMaxH) {
            debug.inc("boucle_rejets_attente");
            debug.log("BOUCLE", `    MUTU ${lotAnc.id} REJECT ${seq}/chgAcc=${dateChgAcc} — attente de collecte ${attente.heures.toFixed(1)}h > ecartMaxH=${ecartMaxH}h`);
            return null;
          }
          // km RÉELLEMENT roulés par la chaîne posée (≠ km géométriques du circuit idéal) : c'est le
          // seul indicateur qui voit les détours parasites insérés par la garde week-end. Sert à
          // départager les dates de groupage entre elles, PAS à calculer kmEco (resté géométrique
          // pour rester comparable d'un partenaire à l'autre).
          const kmChaine = blocks.reduce((s, b) => s + (b.km || 0), 0);
          // `blocks` remonté : c'est LE parcours de cette proposition (celui qui sera posé si elle est
          // retenue), affiché tel quel dans le panneau au lieu d'être re-déduit des codes postaux.
          return { dateC_Acc: dC_Acc, dateL_Acc: dL_Acc, dateL_Anc: dL_Anc, kmChaine, blocks };
        };

        // Km géométriques du circuit — indépendants de la date, donc calculés une fois (par
        // `kmEcoMutualisation` plus haut, en même temps que les trajets « chaque lot tout seul »).
        const kmS1_geo = ecoGeoMutu.brut.kmS1;
        const kmS2_geo = ecoGeoMutu.brut.kmS2;

        // Évalue une date de chargement de A : les 2 séquences, puis la meilleure au sens km
        // géométriques (critère inchangé — le balayage ne redéfinit pas le choix S1/S2, il l'englobe).
        // Toute séquence qui déplacerait le chargement vendu de B a déjà été éliminée par
        // `evalMutuSeq` (Q15) : ce qui arrive ici tient la date de B par construction.
        const evalDateChgAcc = (dateChgAcc) => {
          const mS1 = evalMutuSeq("S1", dateChgAcc);
          const mS2 = evalMutuSeq("S2", dateChgAcc);
          if (!mS1 && !mS2) return null;
          let prendreS1;
          if (!mS2) prendreS1 = true;
          else if (!mS1) prendreS1 = false;
          else prendreS1 = kmS1_geo <= kmS2_geo;
          const m = prendreS1 ? mS1 : mS2;
          return {
            dateChgAcc, seq: prendreS1 ? "S1" : "S2", kmTraj: prendreS1 ? kmS1_geo : kmS2_geo,
            dateC_Acc: m.dateC_Acc, dateL_Acc: m.dateL_Acc, dateL_Anc: m.dateL_Anc,
            kmChaine: m.kmChaine, blocks: m.blocks,
          };
        };

        // Aucune date de chargement de A ne survit ⇒ AUCUNE proposition. C'est le cas normal quand
        // tenir le chargement vendu de B est incompatible avec la garde week-end : la mutualisation
        // n'est pas « dégradée », elle n'existe pas.
        const evals = datesChgAcc.map(evalDateChgAcc).filter(Boolean);
        if (!evals.length) {
          debug.log("BOUCLE", `    MUTU ${lotAnc.id} REJECT — aucune date de chargement de A ne permet de tenir le chargement vendu de B (${lotAnc.dateC})`);
          return;
        }

        // CHOIX — 🔴 PLUS AUCUN SEUIL (arbitrage Louis 2026-09-03). On retient simplement, dans la
        // fenêtre de flex de A, la chaîne qui ROULE LE MOINS.
        //
        // Ce qui a été retiré : `gainMinDecalageChgKm` (300 km), qui exigeait qu'une autre date de
        // chargement fasse gagner au moins ce montant pour l'emporter sur le groupage serré. Motif du
        // retrait, dans les mots de Louis : « les meilleures boucles apparaîtront au planif, et si
        // elle est sans intérêt il ne la sélectionnera pas » — on cesse d'empiler des règles de
        // départage par-dessus les garde-fous ; c'est le planificateur qui arbitre ce qui lui est
        // proposé. ⚠️ Ce seuil ne protégeait de toute façon la date promise que dans le cas où le
        // groupage serré était PLANIFIABLE : quand il ne l'était pas, le code prenait déjà la
        // meilleure alternative au kilomètre brut, sans rien exiger.
        //
        // Ce qui NE change pas : la date de chargement VENDUE de l'ancre reste intouchable (Q15,
        // contrainte dure appliquée en amont par `evalMutuSeq`), et A ne peut se déplacer que dans
        // sa fenêtre de flex négociée (`allowedDatesAcc`). Le balayage ne choisit donc qu'entre des
        // dates déjà toutes acceptables ; le seuil ne faisait qu'en préférer une.
        //
        // Départage à km ÉGAUX, dans cet ordre : la date la plus proche de celle que le client a
        // DEMANDÉE (`dateChgVoulueA`, l'ancrage retenu le 2026-07-31 — la souplesse a été négociée
        // autour de la demande, pas autour de la dernière date retenue), puis la plus précoce.
        // ── 4C, ORIENTATION N°2 — « PROPOSÉ = POSÉ » VU DE L'AUTRE BOUT 🔴 ────────────────────
        // Mutualiser devant une ancre qui porte déjà un retour ALLONGE le voyage : le camion
        // collecte un lot de plus, livre un lot de plus, et le lot accroché derrière part donc plus
        // tard et d'ailleurs. Sans ce contrôle, on proposerait une mutualisation dont l'acceptation
        // déplacerait EN SILENCE le chargement — vendu — d'un troisième lot. C'est le défaut exact
        // que 4C existe pour fermer, pris par son autre extrémité.
        //
        // On ne rejette pas la proposition pour autant : on ÉCARTE LES DATES qui ne tiennent pas.
        // La fenêtre de flex de l'accroché en cours de vente est là pour ça — c'est le même
        // balayage que partout ailleurs, avec un critère de plus.
        const accrocheTientDerriere = (e) => {
          if (!accrocheExistant) return true;
          const blocsPaire = e.blocks || [];
          const derniereLiv = blocsPaire.filter(b => b.type === "liv").pop();
          if (!derniereLiv) return false;
          const lotFin = [lotAnc, lotDraftNorm].find(l => l.id === derniereLiv.lotId);
          const gpsFinPaire = lotFin ? gc(lotFin.cpL) : gpsB_L;
          // ⚠️ LE CURSEUR EST UN PLANCHER, PAS UN ANCRAGE. `buildChain` privilégie
          // `startCursorAbs` sur la `dateC` du lot : le lui donner nu ferait charger l'accroché
          // AU PLUS TÔT derrière la paire — donc avant sa date vendue — et `chgVenduTenu` le
          // refuserait pour un décalage que personne n'a demandé. On prend donc le plus TARDIF
          // entre « la paire est finie » et « le premier instant du jour vendu », exactement comme
          // le fait la branche retour avec son `floorAbsAcc`. La question posée devient la bonne :
          // la paire libère-t-elle le camion À TEMPS pour honorer le chargement déjà vendu ?
          // 🔑 Depuis le 2026-09-15 (arbitrage Louis : « le camion commence la liaison tout de suite
          // après »), la liaison part DÈS la fin de la paire et c'est `waitDateC` qui tient le
          // chargement à son jour vendu — plus un plancher au matin du chargement, qui faisait rouler
          // la liaison le jour même et divergeait de la pose.
          const cSim = buildChain(
            { ...accrocheExistant, dateL: undefined }, vehAnc, simAxisMutu,
            { startGps: gpsFinPaire, startCursorAbs: derniereLiv.endAbs, waitDateC: true, ignoreDateL: true, rules },
            agencesData,
          );
          const cChg = cSim.find(b => b.type === "chg");
          const cLiv = cSim.filter(b => b.type === "liv").pop();
          if (!cChg || !cLiv || cChg._overflow || cLiv._overflow) {
            debug.log("BOUCLE", `    MUTU ${lotAnc.id} date ${e.dateChgAcc} ÉCARTÉE — l'accroché ${accrocheExistant.id} ne se replanifie plus derrière la paire`);
            return false;
          }
          // Q15 — le chargement de l'accroché est vendu lui aussi. La règle ne connaît pas de
          // rang : elle vaut pour le troisième lot comme pour le premier.
          if (!chgVenduTenu(cSim, accrocheExistant)) {
            debug.inc("boucle_rejets_chg_vendu");
            debug.log("BOUCLE", `    MUTU ${lotAnc.id} date ${e.dateChgAcc} ÉCARTÉE — déplacerait le chargement VENDU de ${accrocheExistant.id} (${accrocheExistant.dateC} → ${cChg.date}) — Q15`);
            return false;
          }
          // Et sa plage physique tient toujours : allonger la mission ne doit pas l'étirer.
          const jMinC = joursMinLot(accrocheExistant, rules), jMaxC = joursMaxLot(accrocheExistant, rules);
          const ecartC = diffWorkdays(cChg.date, cLiv.date);
          if (ecartC < jMinC - 1 || ecartC > jMaxC - 1) {
            debug.log("BOUCLE", `    MUTU ${lotAnc.id} date ${e.dateChgAcc} ÉCARTÉE — plage de ${accrocheExistant.id} hors [${jMinC - 1},${jMaxC - 1}] (${ecartC})`);
            return false;
          }
          return true;
        };
        const pool = accrocheExistant ? evals.filter(accrocheTientDerriere) : evals;
        if (!pool.length) {
          debug.inc("boucle_rejets_accroche_ne_suit_plus");
          debug.log("BOUCLE", `    MUTU ${lotAnc.id} REJECT — aucune date ne laisse le retour ${accrocheExistant?.id} tenir derrière la paire`);
          return;
        }
        const choix = [...pool].sort((x, y) => x.kmChaine - y.kmChaine
          || Math.abs(diffDaysIso(dateChgVoulueA, x.dateChgAcc)) - Math.abs(diffDaysIso(dateChgVoulueA, y.dateChgAcc))
          || (x.dateChgAcc < y.dateChgAcc ? -1 : 1))[0];
        if (choix && choix.dateChgAcc !== lotAnc.dateC) {
          debug.inc("boucle_balayages_flex");
          debug.log("BOUCLE", `    MUTU ${lotAnc.id} ✓ BALAYAGE — chg A porté au ${choix.dateC_Acc} (${choix.kmChaine} km) · chg B inchangé au ${lotAnc.dateC}`);
        }

        const bestSeq = choix.seq;
        const dateC_A_mutu = choix.dateC_Acc;
        const dateL_A_mutu = choix.dateL_Acc;
        const dateL_B_proposed_mutu = choix.dateL_Anc;
        const kmTrajMutu = choix.kmTraj;

        const dateL_B_effective_mutu = bLocked ? lotAnc.dateL : dateL_B_proposed_mutu;

        // ── kmEco SUR LES KM RÉELLEMENT ROULÉS (arbitrage Louis 2026-07-28) ─────────────────────
        // Historiquement kmEco comparait des CIRCUITS GÉOMÉTRIQUES : dépôt→chg→liv→dépôt à vol
        // d'oiseau, sans calendrier. Or c'est la POSE qui crée les km — horaires, week-ends, retour
        // dépôt du vendredi (Q17) peuvent insérer des trajets que le circuit idéal ignore. Le
        // planificateur voyait donc un gain théorique très éloigné du gain réel (CHT-092958 :
        // « 2 041 km évités » annoncés pour ~224 km réels). On compare désormais ce qui sera
        // réellement roulé : chaîne mutualisée posée vs les deux lots posés séparément.
        // `{ ...vehAnc, ag: lot.soc }` : chaque lot est simulé seul DEPUIS LE DÉPÔT DE SON AGENCE
        // VENDEUSE — même correctif et même raison que `chaineSeuleRetour` dans la branche retour.
        // Sans lui, le lot de l'agence voisine partait du dépôt de l'ancre, ce qui minorait son
        // trajet « sans boucle » et donc l'économie affichée.
        const kmChainePosee = (lot) => {
          const blocs = buildChain(lot, { ...vehAnc, ag: lot.soc }, simAxisMutu, { rules, gardeWeekendRetour: true }, agencesData);
          if (!blocs.length || blocs.some(b => b._overflow)) return null;
          return blocs.reduce((s, b) => s + (b.km || 0), 0);
        };
        const kmB_seul_reel = kmChainePosee(lotAnc);
        const kmA_seul_reel = kmChainePosee({ ...lotDraftNorm, dateC: dateC_A_mutu });
        // Repli sur la géométrie si l'un des deux lots n'est pas planifiable seul (on ne peut alors
        // rien comparer de réel — mieux vaut l'ancien indicateur que pas d'indicateur du tout).
        const kmEco_mutu = (kmB_seul_reel !== null && kmA_seul_reel !== null)
          ? Math.round((kmB_seul_reel + kmA_seul_reel) - choix.kmChaine)
          : Math.round((kmB_seul_m + kmA_seul_m) - kmTrajMutu);
        debug.log("BOUCLE", `    MUTU ${lotAnc.id} kmEco=${kmEco_mutu} ${(kmB_seul_reel !== null && kmA_seul_reel !== null) ? `(RÉEL : B seul ${kmB_seul_reel} + A seul ${kmA_seul_reel} − mutu ${choix.kmChaine})` : "(repli géométrique — un lot non planifiable seul)"}`);

        // Q14 (arbitrage 2026-07-19) : faisabilité vs planning RÉEL du PL — la mission mutualisée
        // occupe le PL du premier chargement à la dernière livraison ; un autre lot déjà posé sur
        // cette période rend la proposition infaisable → rejet en amont.
        const spanStartMutu = lotAnc.dateC < dateC_A_mutu ? lotAnc.dateC : dateC_A_mutu;
        const endCandidatesMutu = [dateL_A_mutu, dateL_B_effective_mutu, spanStartMutu].filter(Boolean);
        const spanEndMutu = endCandidatesMutu.sort().pop();
        // V2 (4B) — même correction qu'au retour : les lots du voyage déjà posé ne sont pas des
        // intrus sur le camion. Le retour déjà accroché derrière l'ancre en fait partie.
        if (plBusyInRange(plIdAnc, spanStartMutu, spanEndMutu, placements, [lotDraft.id, ...membresTournee])) {
          debug.inc("boucle_rejets_pl_occupe");
          debug.log("BOUCLE", `    MUTU ${lotAnc.id} REJECT — PL ${plIdAnc} occupé par un autre lot sur [${spanStartMutu}..${spanEndMutu}] (Q14)`);
          rejetVehicule(`PL ${plIdAnc} déjà occupé par un autre chantier du ${spanStartMutu} au ${spanEndMutu}`);
          return;
        }

        // Trajets « chaque lot posé seul », en km RÉELS dès qu'ils sont calculables : c'est le
        // dénominateur du pourcentage de gain, il doit parler des mêmes kilomètres que kmEco (sans
        // quoi un kmEco réel divisé par un total géométrique donnerait un pourcentage fantaisiste,
        // au-delà de 100 % dans les cas où la géométrie sous-estime la pose). Repli géométrique
        // exactement quand kmEco lui-même s'y replie.
        const kmEcoEstReel = kmB_seul_reel !== null && kmA_seul_reel !== null;
        const kmASeul_mutu = Math.round(kmEcoEstReel ? kmA_seul_reel : kmA_seul_m);
        const kmBSeul_mutu = Math.round(kmEcoEstReel ? kmB_seul_reel : kmB_seul_m);
        // Même exigence de cohérence sur le trajet mutualisé : les km de la chaîne posée quand on
        // compare du réel, le circuit géométrique quand on est en repli.
        const kmCombine_mutu = Math.round(kmEcoEstReel ? choix.kmChaine : kmTrajMutu);
        const pctGain_mutu = pctGainBoucle(kmEco_mutu, kmASeul_mutu, kmBSeul_mutu);

        // UI-RAL — même formule, autre porteur : en mutualisation l'accroché s'insère dans la
        // mission CHARGÉE de l'ancre (chg ANC → liv ANC), pas dans son retour à vide. Hoistée hors
        // de l'objet émis depuis le 2026-08-14 : elle alimente désormais la pile de garde-fous.
        const mesures_mutu = mesuresMutuAccroche({
          chgAncre: gpsB_C, livAncre: gpsB_L,
          chgAccroche: gpsA_C, livAccroche: gpsA_L,
          acc: lotDraftNorm, rules,
        });
        // Décalage de la livraison de l'ancre, en jours calendaires (termes μ/ν du score). Même
        // règle qu'au retour, SIGNE COMPRIS : positif = retard, négatif = avance (cf. le
        // commentaire détaillé sur `decalageAncre_retour`). Ne pas réintroduire `Math.abs`.
        const decalageAncre_mutu = (!bLocked && dateL_B_proposed_mutu && lotAnc.dateL && dateL_B_proposed_mutu !== lotAnc.dateL)
          ? diffDaysIso(lotAnc.dateL, dateL_B_proposed_mutu)
          : 0;
        const gardes_mutu = evaluerGardes({
          mesures: mesures_mutu, kmEco: kmEco_mutu,
          decalageJours: decalageAncre_mutu, geometrie: "mutu", rules,
        });
        if (!gardes_mutu.ok) {
          debug.inc(`boucle_rejets_${gardes_mutu.cause}`);
          debug.log("BOUCLE", `    MUTU ${lotAnc.id} REJECT garde-fou ${gardes_mutu.cause} — ${gardes_mutu.message}`);
          return;
        }

        // « Proposé = posé » par construction — même contrôle qu'au retour (cf. `poseTientLaProposition`).
        // Le lot déjà accroché derrière l'ancre est vendu lui aussi : il est dans `lotsVendus`.
        // `partnerNewDateL` n'est pas rejoué : l'acceptation d'une mutualisation n'écrit aucune date
        // de l'ancre (`handleSuggestionPlace` exige un `partnerNewDateC`, toujours nul — Q15).
        if (kmEco_mutu >= minKmEco && !diagnostic) {
          const verdictPose = poseTientLaProposition({
            type: "mutualisation", plId: plIdAnc, lotAnc,
            dateC: dateC_A_mutu, dateL: dateL_A_mutu, sequence: bestSeq,
            lotsVendus: lotsDeLaTournee,
          });
          if (!verdictPose.ok) {
            debug.inc("boucle_rejets_pose_divergente");
            debug.log("BOUCLE", `    MUTU ${lotAnc.id} REJECT proposé ≠ posé — ${verdictPose.raison}`);
            return;
          }
        }
        if (kmEco_mutu >= minKmEco) {
          if (!diagnostic) debug.inc("boucle_candidats_proposes");
          debug.log("BOUCLE", `    ✓ MUTU ${lotAnc.id} ACCEPTÉ séquence=${bestSeq} kmEco=${kmEco_mutu} scoreClassement=${gardes_mutu.score} (rallonge=${gardes_mutu.composantes.rallongeJours?.toFixed(2)} j · détour=${gardes_mutu.composantes.detourKm} km · décalage=${decalageAncre_mutu} j)`);
          debug.log("BOUCLE", `    MUTU ${lotAnc.id} dates B: demandé=${lotAnc.dateC}→${lotAnc.dateL} · effectif=${lotAnc.dateC}→${dateL_B_effective_mutu}${dateL_B_effective_mutu !== lotAnc.dateL ? " ⚠ B livré + tôt" : ""}`);
          debug.log("BOUCLE", `    MUTU ${lotAnc.id} dates A: demandé=${lotDraft.dateC}→${lotDraft.dateL || lotDraft.dateC} · proposé=${dateC_A_mutu}→${dateL_A_mutu}${dateC_A_mutu !== lotDraft.dateC || dateL_A_mutu !== (lotDraft.dateL || lotDraft.dateC) ? " ⚠ A décalé (contrainte séquence " + bestSeq + ")" : ""}`);
          const dateLRefA_mutu = lotDraft.dateL || lotDraft.dateC;
          const livAccEarlierMutu = dateL_A_mutu < dateLRefA_mutu;
          emettre({
            type: "mutualisation",
            partnerLot: lotAnc,
            partnerAgence: lotAnc.soc,
            partnerPlId: plIdAnc,
            dateC: dateC_A_mutu,
            dateL: dateL_A_mutu,
            distRepo: Math.round(distChgAccChgAnc),
            ecartJours: diffDaysIso(lotAnc.dateC, dateC_A_mutu),
            kmEco: kmEco_mutu,
            pctGain: pctGain_mutu,
            score: scoreBoucle(pctGain_mutu, rules),
            isPreferred: dateC_A_mutu === dateChgVoulueA,
            impactPartnerDates: !bLocked && dateL_B_proposed_mutu !== lotAnc.dateL,
            // Le chargement de B est VENDU : jamais déplacé par le moteur (Q15). Seule sa livraison
            // peut être avancée (partnerNewDateL).
            partnerNewDateC: null,
            partnerNewDateL: bLocked ? null : dateL_B_effective_mutu,
            _livraisonAnticipee: livAccEarlierMutu ? { proposee: dateL_A_mutu, demandee: dateLRefA_mutu } : null,
            sequence: bestSeq,
            kmTrajMutu: kmCombine_mutu,
            kmTrajBSeul: kmBSeul_mutu,
            kmTrajASeul: kmASeul_mutu,
            _mesures: mesures_mutu,
            // Score de classement + composantes affichables — cf. la branche retour pour le piège
            // de nommage : `score` est l'étiquette qualitative (classe CSS), `scoreClassement` est
            // le nombre qui ORDONNE les propositions depuis l'arbitrage du 2026-08-14.
            scoreClassement: gardes_mutu.score,
            scoreComposantes: gardes_mutu.composantes,
            _chaineSimulee: choix.blocks || [],
          });
        }
        else debug.log("BOUCLE", `    MUTU ${lotAnc.id} REJECT kmEco=${kmEco_mutu} < minKmEco=${minKmEco} (séquence ${bestSeq})`);
      }
    }; // fin evaluerMutu

    // Joue les DEUX scénarios sur le même camion, chacun écrivant dans son propre slot. Aucun ne
    // peut plus interrompre l'autre : c'est tout l'objet de la scission (cf. en-tête plus haut).
    // Un couple de lots peut donc produire un candidat RETOUR *et* un candidat MUTUALISATION ;
    // ils cohabitent dans `results` (la dédupe finale est faite par `partnerLot × type`) et sont
    // départagés par le tri final — `kmEco` décroissant (cf. tri final, plus bas).
    const evaluerScenarios = (vehAnc, plIdAnc, diagnostic = false) => {
      bilan = {
        retour: { candidat: null, rejetVehicule: null },
        mutu:   { candidat: null, rejetVehicule: null },
      };
      // En diagnostic, la proposition est retenue pour analyse mais JAMAIS poussée dans les
      // résultats : le comportement de placement reste strictement inchangé.
      const sortie = (slot) => ({
        diagnostic,   // les corps s'en servent pour ne pas fausser les compteurs de debug
        rejetVehicule: (cause) => { slot.rejetVehicule = { cause }; },
        emettre: (cand) => { slot.candidat = cand; if (!diagnostic) results.push(cand); },
      });
      evaluerRetour(vehAnc, plIdAnc, sortie(bilan.retour));
      evaluerMutu(vehAnc, plIdAnc, sortie(bilan.mutu));
    };

    // Passe NORMALE : le camion sur lequel le lot partenaire est réellement posé. C'est elle, et
    // elle seule, qui alimente les propositions plaçables.
    evaluerScenarios(vehBPose, plIdBPose);
    // Mémorisés MAINTENANT : le diagnostic ci-dessous rappelle `evaluerScenarios`, qui écrase
    // `bilan` à chaque essai. Ces deux constantes sont les verdicts de la passe normale.
    const scenarioRetour = bilan.retour;
    const scenarioMutu = bilan.mutu;

    // ── DIAGNOSTIC MULTI-CAMION + RÉAFFECTATION (arbitrage Louis 2026-07-29, étendu) ─────────
    // Constat : le moteur n'a jamais testé qu'UN camion par lot partenaire. Si la boucle est
    // rejetée parce que CE camion-là est trop petit ou déjà pris, personne ne sait qu'elle aurait
    // pu se faire — le manque à gagner est invisible.
    // On rejoue donc la même évaluation, EN LECTURE SEULE, sur les autres camions de l'agence
    // OPÉRATRICE (celle qui porte le lot partenaire). Même agence = même dépôt = mêmes distances
    // et mêmes dates : seules la capacité et la disponibilité changent, ce qui est exactement le
    // périmètre des rejets qu'on rejoue. Un camion d'une AUTRE agence donnerait une boucle
    // différente (autre dépôt, autres km) et, en retour, contredirait la règle de gouvernance
    // (c'est le camion de l'agence opératrice qui porte la boucle) — donc jamais essayé.
    //
    // ÉVOLUTION (2026-07-29, seconde décision) : le simple signalement ne suffisait pas — il
    // laissait le planificateur ressaisir les deux dossiers à la main pour récupérer la boucle.
    // Chaque cas diagnostiqué porte désormais de quoi PROPOSER la réaffectation du lot partenaire
    // sur le camion libre : le candidat complet (`candidat`) et le mouvement à opérer
    // (`reaffectation`). Ce qui ne change pas : rien n'est poussé dans `results`, donc aucune
    // proposition plaçable de plus, et surtout AUCUNE réaffectation automatique — c'est une
    // proposition, validée par l'agence opératrice (retour) ou confirmée explicitement (mutu).
    //
    // Depuis la mutualisation régionale, un même couple peut avoir été rejeté sur LES DEUX
    // scénarios : chacun est diagnostiqué séparément, avec le volume qui correspond à SA
    // géométrie. Le budget global `budgetDiag.sims` reste partagé — il borne le coût total.
    for (const [type, scenario] of [["retour", scenarioRetour], ["mutualisation", scenarioMutu]]) {
      if (scenario.candidat || !scenario.rejetVehicule || budgetDiag.sims <= 0) continue;
      const volNecessaire = type === "mutualisation"
        ? lotDraftVol + (parseFloat(lotAnc.vol) || 0)          // mutu : les deux lots dans la caisse
        : Math.max(lotDraftVol, parseFloat(lotAnc.vol) || 0);  // retour : jamais les deux à la fois
      const alternatifs = findAvailablePLs(vehBPose.ag, lotAnc.dateC, vehicles, placements, volNecessaire)
        .filter(v => v.id !== plIdBPose)
        // Le plus PETIT camion qui passe d'abord : citer un 90 m³ pour un lot de 35 m³ serait un
        // mauvais conseil (on immobilise une grosse caisse pour rien).
        .sort((a, b) => (parseFloat(a.cap) || 0) - (parseFloat(b.cap) || 0))
        .slice(0, rules.diagBouclePLMax ?? 4);
      // ── POURQUOI IL N'Y A PAS DE CAMION : GABARIT ou DISPONIBILITÉ ? (2026-08-03, soir) ─────
      // `findAvailablePLs` applique « assez grand » ET « libre ce jour-là » en un seul passage :
      // liste vide, on ne sait plus lequel des deux a mordu. Le message partait donc du plus
      // optimiste (« n'est libre »), ce qui laissait croire à un problème de disponibilité — donc
      // qu'un autre jour passerait — alors que le camion n'existe tout simplement PAS.
      // On relit le gabarit à part, UNIQUEMENT pour écrire la phrase : `alternatifs` reste la
      // seule source de vérité sur qui peut porter la boucle, et n'est pas touché.
      const auGabarit = vehicles.filter(v => v.ag === vehBPose.ag && v.id !== plIdBPose
        && isVehicleCompatible(v, volNecessaire));
      // Plus grande caisse de l'agence, PORTEURS SEULEMENT : annoncer une remorque de 100 m³
      // rendrait la phrase fausse. `isVehicleCompatible(v, 0)` ne garde que le test de type (un
      // volume nul court-circuite le test de capacité) — même prédicat que ci-dessus, donc aucune
      // liste de types recopiée qui pourrait dériver.
      const plusGrandeCaisse = vehicles
        .filter(v => v.ag === vehBPose.ag && isVehicleCompatible(v, 0))
        .reduce((m, v) => Math.max(m, parseFloat(v.cap) || 0), 0);
      // « Faute de camion » au sens strict : aucun alternatif ne convient. Jusqu'ici l'émission
      // était À L'INTÉRIEUR de la boucle ci-dessous, donc une liste vide — ou des essais qui
      // échouent tous — faisait disparaître la boucle écartée SANS LAISSER DE TRACE. C'était le
      // seul cas totalement invisible, et c'est précisément celui que le planificateur appelle
      // « écarté faute de camion » (arbitrage Louis 2026-08-03).
      let cite = false;
      for (const alt of alternatifs) {
        if (budgetDiag.sims <= 0) break;
        budgetDiag.sims--;
        evaluerScenarios(alt, alt.id, true);
        // ⚠️ L'appel ci-dessus vient d'ÉCRASER `bilan`. On relit donc le slot du scénario en
        // cours de diagnostic — jamais `scenarioRetour`/`scenarioMutu`, qui portent les verdicts
        // de la passe normale et servent ici à décrire le rejet d'origine.
        const essai = (type === "mutualisation" ? bilan.mutu : bilan.retour).candidat;
        if (!essai) continue;

        // Le camion alternatif est-il libre sur TOUTE la mission, et pas seulement le jour du
        // chargement de B ? `findAvailablePLs` ne teste qu'une journée (cf. sa définition) : ça
        // suffisait pour informer, pas pour proposer un mouvement. Sans ce contrôle, on offrirait
        // une réaffectation qui, une fois acceptée, décalerait en silence un chantier déjà posé
        // sur le camion d'accueil.
        const jours = (essai._chaineSimulee || []).map(b => b.date).filter(Boolean).sort();
        if (!jours.length) continue;
        if (!isPLAvailableInRange(alt.id, jours[0], jours[jours.length - 1], placements, true,
          getPendingReservations(existingLots))) {
          debug.log("BOUCLE", `    · ${alt.id} écarté : occupé sur la plage ${jours[0]}→${jours[jours.length - 1]}`);
          continue;
        }

        debug.inc("boucle_bloquees_diagnostiquees");
        debug.log("BOUCLE", `    ⚑ ÉCARTÉE ${lotAnc.id} — ${scenario.rejetVehicule.cause} · faisable sur ${alt.id} (kmEco=${essai.kmEco})`);
        bloques.push({
          type: essai.type,
          partnerLot: lotAnc,
          partnerAgence: lotAnc.soc,
          plRejet: plIdBPose,
          capRejet: vehBPose.cap,
          causeRejet: scenario.rejetVehicule.cause,
          plAlternatif: alt.id,
          agAlternatif: agLookup(alt.ag, agencesData).name || alt.ag,
          capAlternatif: alt.cap,
          kmEcoPotentiel: essai.kmEco,
          dateC: essai.dateC,
          dateL: essai.dateL,
          // ── De quoi PROPOSER la boucle, et plus seulement la regretter ──
          // Le mouvement à opérer sur le lot partenaire. Ses DATES ne bougent pas : seul le
          // camion qui le porte change (règle Q15 — la date de chargement d'un dossier vendu est
          // intouchable, et c'est justement l'ancre B).
          reaffectation: {
            lotId: lotAnc.id,
            dePlId: plIdBPose, capDe: vehBPose.cap,
            versPlId: alt.id, capVers: alt.cap, agVers: alt.ag,
          },
          // Candidat complet, identique à ce qu'aurait produit la passe normale si B avait été
          // posé sur le bon camion. Son `partnerPlId` vaut `alt.id` (les corps d'évaluation
          // reçoivent le PL en paramètre) : le lot A atterrira donc bien sur le camion d'accueil.
          candidat: essai,
        });
        cite = true;
        break; // un seul camion cité par boucle écartée — le plus petit qui convienne
      }

      // Aucun camion cité : la boucle existe, mais rien ne peut la porter. On l'émet quand même,
      // avec la raison en clair et SANS solution à décrire — `kmEcoPotentiel`, `dateC`, `dateL`,
      // `plAlternatif`, `reaffectation` et `candidat` sont volontairement absents : il n'y a pas
      // de mouvement à proposer, donc pas de bouton (cf. `docs/regles-metier.md` §3).
      //
      // ⚠️ Le garde sur le budget n'est pas cosmétique : budget épuisé ⇒ on n'a PAS fini de
      // chercher. Affirmer « aucun camion ne convient » serait alors un mensonge — on préfère ne
      // rien dire, comme avant.
      if (!cite && budgetDiag.sims > 0) {
        // HORS GABARIT = aucun camion de l'agence ne peut charger ce volume, quel que soit le jour.
        // C'est une contrainte de FLOTTE, pas de planning : rien à retenter. Les autres cas, eux,
        // peuvent se débloquer en changeant de date — d'où la distinction, portée aussi par
        // `sansCamionCause` pour que l'interface et le Monitoring n'aient pas à lire la phrase
        // (un simple reformulage casserait le couplage).
        const horsGabarit = auGabarit.length === 0;
        const pluriel = auGabarit.length > 1;
        const sujet = pluriel
          ? `les ${auGabarit.length} camions assez grands de l'agence sont`
          : `le seul camion assez grand de l'agence est`;
        debug.inc(horsGabarit ? "boucle_bloquees_hors_gabarit" : "boucle_bloquees_sans_camion");
        debug.log("BOUCLE", `    ⚑ ÉCARTÉE ${lotAnc.id} — ${scenario.rejetVehicule.cause} · ${horsGabarit ? `hors gabarit (${volNecessaire} m³ > ${plusGrandeCaisse} m³)` : `aucun camion libre (${auGabarit.length} au gabarit, ${alternatifs.length} testé(s))`}`);
        bloques.push({
          type,
          partnerLot: lotAnc,
          partnerAgence: lotAnc.soc,
          plRejet: plIdBPose,
          capRejet: vehBPose.cap,
          causeRejet: scenario.rejetVehicule.cause,
          sansCamionCause: horsGabarit ? "gabarit" : "occupe",
          sansCamion: horsGabarit
            ? `aucun camion de l'agence ne peut charger ${volNecessaire} m³`
              + (plusGrandeCaisse > 0 ? ` — le plus grand fait ${plusGrandeCaisse} m³` : "")
            : alternatifs.length === 0
              ? `${sujet} déjà pris le ${lotAnc.dateC}`
              : `${sujet} occupé${pluriel ? "s" : ""} sur la période de la mission`,
        });
      }
    }
  });

  // Dédupe par (partnerLot, type) — garde la MEILLEURE au sens du classement, c'est-à-dire au sens
  // exact de `compareBoucleCandidates` (score, puis km évités). Elle gardait le meilleur `kmEco`
  // seul : depuis que le tri final classe sur le score (arbitrage 2026-08-14), départager les
  // doublons sur un autre critère que le tri reviendrait à éliminer la candidate que le tri aurait
  // pourtant mise en tête. Un seul juge du « meilleur », ici comme au tri.
  const bestByKey = {};
  results.forEach(r => {
    const k = `${r.partnerLot.id}-${r.type}`;
    if (!bestByKey[k] || compareBoucleCandidates(r, bestByKey[k]) < 0) bestByKey[k] = r;
  });

  // PLAFOND DE PROPOSITIONS — 3 (arbitrage Louis E2, 2026-09-02 ; valait 8 en dur).
  // ⚠️ Conséquence assumée par Louis, écrite au plan (§ Lot 6, tranche 6.0 point 2) : si les trois
  // propositions sont refusées, IL NE RESTE RIEN à proposer — le bouton « Analyse » ne pourra
  // montrer que les boucles écartées par un garde-fou, pas des boucles valables non retenues.
  // Le plafond passe par `RULES_DEFAULTS` et non plus par une constante en dur, pour qu'il se règle
  // depuis l'écran Admin comme les autres seuils.
  const plafond = rules.maxPropositionsBoucle ?? 3;
  const final = Object.values(bestByKey)
    .sort(compareBoucleCandidates)
    .slice(0, plafond);

  debug.log("BOUCLE", `=== RÉSULTATS: ${results.length} bruts → ${final.length} retenus · ${bloques.length} écartée(s) faute de camion ===`);
  final.forEach(r => debug.log("BOUCLE", `   → ${r.type} avec ${r.partnerLot.id} kmEco=${r.kmEco} scoreClassement=${r.scoreClassement} (étiquette ${r.score})`));

  // Les boucles écartées voyagent en PROPRIÉTÉ de la liste, pas dedans : la signature de
  // `findBoucleCandidates` reste « un tableau de candidats plaçables » (elle est le point d'entrée
  // futur d'OR-Tools, cf. CLAUDE.md), et tout code existant qui itère dessus est inchangé.
  // ⚠️ Un `.filter()`/`.map()` sur le résultat perd la propriété : les appelants la relèvent tout
  // de suite (cf. OneFleet.jsx `findCandidates`).
  // NON ÉNUMÉRABLE à dessein : la liste reste strictement égale à un tableau ordinaire pour
  // `toEqual`, `JSON.stringify` ou un `{...spread}` — le diagnostic ne doit rien changer d'observable
  // au contrat existant.
  Object.defineProperty(final, "_bloques", { value: bloques, enumerable: false, configurable: true });
  return final;
}

// Le PL reste-t-il dormir sur place plutôt que de rentrer au dépôt ? (arbitrage Louis 2026-08-03)
// N'a de sens que lorsqu'une NUIT s'intercale entre deux chantiers — le même jour, la question ne
// se pose pas. Deux conditions cumulatives, la seconde non paramétrable :
//   - le prochain chargement est à portée (≤ seuilResterSurPlaceKm) : le PL est déjà à pied
//     d'œuvre, rentrer serait un aller-retour pour rien ;
//   - le dépôt n'est pas PLUS PRÈS que ce prochain chargement — sinon rentrer ne coûte presque
//     rien et l'équipage dort chez lui.
// Référentiel GPS incomplet ⇒ false : dans le doute le PL rentre au dépôt (choix prudent, c'est
// l'option qui ne laisse jamais un camion dehors par accident de donnée).
function resteSurPlacePourLeSuivant(gpsFin, gpsNextChg, agGps, rules = RULES_DEFAULTS) {
  if (!gpsFin || !gpsNextChg || !agGps) return false;
  const kmNext = hav(gpsFin, gpsNextChg);
  if (kmNext > (rules.seuilResterSurPlaceKm ?? 80)) return false;
  return hav(gpsFin, agGps) > kmNext;
}

// Enchaînement continu entre deux chantiers d'un même PL.
// Le PL ne saute le retour dépôt (repositionnement direct vers le chantier suivant) QUE s'il
// enchaîne réellement, sans attendre sur place. Conditions cumulatives :
//   - aucun week-end intercalé (Q17 : le PL ne reste jamais loin de son dépôt un week-end) ;
//   - l'écart en jours ouvrés reste ≤ seuilEnchainementJours (défaut 1 = jour ouvré suivant) ;
//   - si une NUIT s'intercale (écart ≥ 1 jour ouvré), le PL doit en plus être à pied d'œuvre pour
//     le chantier suivant (cf. resteSurPlacePourLeSuivant). Sans ce dernier test, la règle ne
//     regardait que le CALENDRIER : « livré mercredi, rechargé jeudi » suffisait à supprimer le
//     retour dépôt, et le camion dormait dehors à vide sans aucun gain (diag CHT-829278 — il y
//     perdait même 62 km, le dépôt étant sur la route). Un écart de 0 jour reste un enchaînement
//     inconditionnel : sans nuit intercalée, il n'y a rien à arbitrer.
// Sinon le PL rentrerait attendre sur place : il rentre au dépôt entre les deux et repart du dépôt
// pour le chantier suivant (arbitrage Louis 2026-07-23, complété 2026-08-03).
// finISO : date de fin (livraison) du chantier courant ; nextChgISO : date de chargement du suivant.
// geo : { gpsFin, gpsNextChg, agGps } — obligatoire dès qu'une nuit peut s'intercaler.
function enchainementContinu(finISO, nextChgISO, rules = RULES_DEFAULTS, geo = null) {
  if (!finISO || !nextChgISO) return false;
  if (hasWeekendBetween(finISO, nextChgISO)) return false;
  const ecart = diffWorkdays(finISO, nextChgISO);
  if (ecart > (rules.seuilEnchainementJours ?? 1)) return false;
  if (ecart <= 0) return true; // même jour : aucune nuit dehors, enchaînement réel
  return resteSurPlacePourLeSuivant(geo?.gpsFin, geo?.gpsNextChg, geo?.agGps, rules);
}

// Le retour dépôt glissé ENTRE deux chantiers doit tenir dans la journée de la livraison.
// Un PL qui rentrerait le lendemain matin pour repartir aussitôt n'a rien gagné : il a dormi
// dehors ET perdu sa matinée. Dans ce cas on renonce au retour et il reste sur place — c'est le
// comportement d'avant l'arbitrage, conservé comme repli de faisabilité.
// Ne concerne PAS le retour dépôt FINAL d'une tournée, qui est dû quoi qu'il en coûte.
function retourDepotTientDansLaJournee(chain) {
  const dernier = [...(chain || [])].reverse();
  const vid = dernier.find(b => b.type === "vid");
  if (!vid) return true; // aucun retour dessiné (sous seuilRoute) : rien à vérifier
  if (vid._overflow) return false;
  const liv = dernier.find(b => b.type === "liv");
  return !liv || vid.day === liv.day;
}

// Date de la DERNIÈRE livraison réellement planifiée dans une chaîne — la fin physique de la
// mission, celle que la PROPOSITION lit déjà (`bSim.filter(liv).pop()` au retour derrière une paire,
// `accrocheTientDerriere` en mutualisation). Plus grande date ISO parmi les parts de livraison hors
// débordement : une livraison de plusieurs jours porte plusieurs parts, la plus tardive fait foi.
// `null` si aucune livraison exploitable (hors axe, chaîne vide) : l'appelant garde alors sa
// date nominale — on ne tranche jamais sur une absence (correctif 2026-09-15, cf. `reflowVehicle`).
function derniereLivraisonPosee(chain) {
  const dates = (chain || [])
    .filter(b => b.type === "liv" && !b._overflow && b.date)
    .map(b => b.date)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

// ══════════════════════════════════════════════════════════════
// REFLOW VEHICLE — recalcule toute la chaîne de blocs d'un PL
// ══════════════════════════════════════════════════════════════
// Source de vérité : les lots assignés à ce PL (identifiés via existingBlocks[].lotId).
// Approche :
//   1. Collecte les lots présents sur le PL (via existingBlocks[].lotId)
//   2. Trie chronologiquement par dateC ; pour les mutualisations, `_sequence` tiebreak (S1 = B avant A)
//   3. Chaîne les curseurs : fin du lot N = point de départ (temps + GPS) du lot N+1
//   4. Tous les lots intermédiaires sautent le bloc `vid` retour dépôt ; seul le dernier rentre
//   5. Entre 2 lots, le trajet est un bloc `repo` depuis livraison N vers chg N+1 (km = hav(livN_gps, chgN+1_gps))
//   6. Limite connue (audit 2026-07-19, I2) : pas d'heuristique « dépôt sur le chemin » — en
//      semaine le PL enchaîne toujours en direct, même si son dépôt est sur la route. Le retour
//      dépôt intermédiaire n'est forcé que par la règle week-end (point 4 ci-dessus).
//   7. detectBoucles tourne ensuite pour marquer les boucles retour adjacentes
//
// Blocs route manuels (sans lotId) : conservés intacts à leurs positions.
//
// RÈGLE « JAMAIS DE SUPPRESSION SILENCIEUSE » (arbitrage 2026-06-10, fix symptôme 2) :
// un reflow ne fait JAMAIS disparaître un lot du PL. Un lot dont la dateC est hors de l'axe
// fourni n'est pas rechaîné : ses blocs existants sont CONSERVÉS tels quels (leurs dates ISO
// restent justes ; le rendu est indexé par date). Règle à reprendre telle quelle dans le
// futur backend : tout recalcul de segments doit préserver l'ensemble des lots affectés.
export function reflowVehicle(plId, allLots, existingBlocks, weekDays, vehicles, agencesData = [], rules = RULES_DEFAULTS) {
  // Conserve les blocs existants d'un lot qui ne peut pas être rechaîné sur cet axe
  const keepExistingOf = (out, ...lotIds2) => {
    const ids = new Set(lotIds2);
    out.push(...(existingBlocks || []).filter(b => b.lotId && ids.has(b.lotId)));
  };
  const veh = vehicles.find(v => v.id === plId);
  if (!veh) return existingBlocks || [];

  const ag = agLookup(veh.ag, agencesData);
  if (!ag.cp) return existingBlocks || [];
  const agGps = gc(ag.cp);

  // 1. Récupère les IDs de lots présents (via les blocs existants)
  const lotIdsOnPL = [...new Set(
    (existingBlocks || []).map(b => b.lotId).filter(Boolean)
  )];
  if (lotIdsOnPL.length === 0) {
    // PL vide → conserve uniquement les blocs route manuels (sans lotId)
    return (existingBlocks || []).filter(b => !b.lotId);
  }

  // 2. Résout les lots, filtre les introuvables, trie par dateC puis séquence (S1 avant S2 si même date)
  const seqOrder = { "S1": 0, "S2": 1, "retour": 2 };
  // 🔑 La séquence se lit sur le LIEN DE MUTUALISATION, pas sur `_sequence` — qui n'est que le
  // miroir du PREMIER lien du lot (plan-dev-ux-v5.md § 8 bis, piège n°1). Sur le lot du MILIEU
  // d'une tournée à trois montée « retour d'abord », le miroir porte la séquence du RETOUR (ou
  // rien) : ce lot perdait son rang S1/S2 et se retrouvait trié APRÈS son propre partenaire de
  // paire, à égalité de `dateC`. Ce n'était pas un affichage — c'est l'ordre de POSE.
  // Repli sur le miroir quand aucun lien de mutualisation n'existe : sur une paire à deux, les
  // deux valeurs sont la même, et le comportement est strictement inchangé.
  const sequenceMutu = (lot) =>
    liensDuLot(lot).find(li => li.type === "mutualisation")?.sequence ?? lot._sequence;
  const lotsOnPL = lotIdsOnPL
    .map(id => allLots.find(l => l.id === id))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.dateC !== b.dateC) return a.dateC < b.dateC ? -1 : 1;
      const sa = seqOrder[sequenceMutu(a)] ?? 5;
      const sb = seqOrder[sequenceMutu(b)] ?? 5;
      return sa - sb;
    });

  if (lotsOnPL.length === 0) {
    return (existingBlocks || []).filter(b => !b.lotId);
  }

  // 3. Identifie les paires mutualisation (2 lots avec même _boucleWith croisé)
  // Ces paires demandent un traitement spécial : interleaving chg/liv selon S1/S2.
  // La détection elle-même vit dans `utils/boucleLiens.js` (M3P étape ①, 2026-08-13) : la POSE et
  // la DÉTECTION DE BOUCLES doivent lire exactement la même chose. `detectBoucles` l'ignorait, et
  // c'est précisément l'anomalie α — il rebâtissait un membre de paire tout seul.
  // Restreint aux lots de CE camion : une paire dont le partenaire roule ailleurs n'est pas une
  // paire pour ce reflow (comportement inchangé).
  const mutuPairs = pairesMutu(lotsOnPL); // { lotAcc, lotAnc, sequence }
  const handledIds = new Set(mutuPairs.flatMap(p => [p.lotAcc.id, p.lotAnc.id]));

  // 4. Chaîne les lots en passant curseur + GPS de fin de livraison au suivant
  const resultBlocks = [];
  let cursor;           // temps (toAbs)
  let prevLivGps = agGps; // GPS du point précédent (dépôt au démarrage)
  // Libellé de ce même point, transmis aux planificateurs pour que les blocs de route portent une
  // origine nommée. Sans lui, un repositionnement inter-chantiers n'affichait que « Chantier
  // précédent » — vrai mais inutilisable pour vérifier un trajet.
  let prevLivPoint = null; // null = dépôt (chainBuilder le déduit de startGps)

  // ── L'ENCHAÎNEMENT SE JUGE SUR LA FIN RÉELLE DE L'UNITÉ POSÉE (correctif 2026-09-15) ────────────
  // Une seule écriture pour les deux branches ci-dessous (paire mutualisée, lot seul).
  //
  // CE QUI SE PASSAIT. « Le camion enchaîne-t-il sur le lot suivant, ou rentre-t-il au dépôt ? » se
  // décidait sur la date de livraison PRÉVUE (`dateL`) du lot qui termine l'unité. Or la chaîne
  // réellement construite livre parfois plus tard :
  //   • sur une PAIRE, la livraison de l'ancre glisse d'un jour pour laisser passer celle de
  //     l'accroché — accepté (sujet tranché le 2026-07-31) et non persisté sur `dateL` ;
  //   • sur un LOT SEUL, quand un lot précédent le fait arriver en retard (« Arrivée tardive »).
  // L'écart avec le chargement suivant paraissait alors de deux jours au lieu d'un : « pas
  // d'enchaînement », pas de retour du soir (donc pas de repli « reste sur place »), le camion
  // rentrait au dépôt… et repartait charger le lot suivant plusieurs jours après sa date. Tournée à
  // trois « décidée non tenue à la pose », Q15 du troisième lot violé. Cas fondateur (vivier
  // SharePoint oct.-nov.) : paire L0005+L0112 livrée le 07/10 (prévu 06/10), retour L0126 décidé le
  // 08/10 posé le 09/10. Même motif sur un lot seul : L0062 livré le 28/10 (prévu 27/10), L0087 vendu
  // au 29/10 posé le 03/11.
  //
  // LA RÉFÉRENCE. La proposition (`findBoucleCandidates`) accroche le lot suivant à la DERNIÈRE
  // LIVRAISON de la chaîne simulée (`bSim.filter(liv).pop()`), jamais à une date nominale. La pose
  // s'aligne dessus : elle relit la chaîne.
  //
  // L'ŒUF ET LA POULE. `skipRetourDepot` est un paramètre de construction, et la garde week-end (Q17)
  // peut en principe déplacer les livraisons selon qu'un retour final est dessiné ou non. D'où, dans
  // cet ordre (`poserSurFinReelle`) :
  //   1. on construit avec la décision nominale — comportement inchangé tant que l'unité livre à la
  //      date prévue, soit l'immense majorité des cas (aucune reconstruction) ;
  //   2. on relit la dernière livraison posée ; si elle diffère ET change la décision, on reconstruit
  //      avec la décision tirée de la fin réelle (repli de faisabilité compris) ;
  //   3. on ne retient cette seconde chaîne que si elle est STABLE — sa propre fin réelle est celle
  //      qui a fondé la décision. Sinon on garde la première : pas d'oscillation, et jamais une
  //      décision fondée sur une date que la chaîne retenue ne pose pas ;
  //   4. 🔴 Q17 — cf. « RESTER SUR PLACE N'EST PERMIS QUE SI LE CHANTIER SUIVANT TIENT Q17 » ci-dessous :
  //      quelle que soit la décision retenue, un camion laissé sur place est un camion qui ne rentre
  //      pas avant le chantier suivant ; si ce chantier passerait un week-end hors dépôt, on le fait
  //      rentrer. Entre Q15 et Q17, Q17.
  // Q15 (`chgVenduTenu`) s'applique à la chaîne retenue exactement comme avant.
  //
  // ── RESTER SUR PLACE N'EST PERMIS QUE SI LE CHANTIER SUIVANT TIENT Q17 (correctif 2026-09-15) ────
  // CE QUI SE PASSAIT. La garde week-end (`gardeWeekendRetour`) n'était active que sur un chantier qui
  // PART DU DÉPÔT. Un maillon enchaîné (le camion est resté à la livraison précédente) était posé sans
  // elle : paire livrée le jeudi, lot suivant chargé le vendredi et livré le lundi → camion chargé loin
  // du dépôt tout le week-end. `hasWeekendBetween` ne protège que l'intervalle ENTRE deux chantiers,
  // jamais le week-end traversé DANS la chaîne du maillon. Louis, 2026-09-15 : « jamais possible de
  // rester le week-end dehors ».
  // CE QUI SE FAIT. Deux étages :
  //   • tout chantier est posé AVEC la garde week-end. Parti hors du dépôt (`departHorsDepot`), il n'a
  //     droit qu'aux remèdes qui ramènent le camion chez lui (coupure au dépôt après le chargement,
  //     livraison avancée) — le décalage au lundi le laisserait attendre sur place ;
  //   • avant de laisser le camion sur place, on pose le chantier suivant « à blanc » depuis là
  //     (`suivantTientQ17Depuis`). S'il traverserait encore un week-end, le camion RENTRE au dépôt
  //     entre les deux : le suivant repart du dépôt, avec tous ses remèdes (décalage au lundi compris).
  //     Le chargement vendu du suivant peut en glisser : c'est signalé (« Chargement décalé »), et
  //     c'est le prix de Q17.
  //
  // `suivant` = le prochain lot traité (null si l'unité est la dernière du camion) ; `gpsFin` = le
  // lieu de la dernière livraison de l'unité. Rend { skipDepot, retourDuSoir }.
  const deciderEnchainement = (finISO, gpsFin, suivant) => {
    if (!suivant) return { skipDepot: false, retourDuSoir: false };
    const continu = enchainementContinu(finISO, suivant.dateC, rules, {
      gpsFin, gpsNextChg: gc(suivant.cpC), agGps,
    });
    // Le PL POUVAIT enchaîner côté calendrier, mais on le fait rentrer parce qu'il est trop loin de
    // son prochain chargement : ce retour est un retour DU SOIR, il doit tenir avant la fin de la
    // journée. Sinon on y renonce (repli après le build) — rentrer le lendemain matin cumulerait la
    // nuit dehors et la matinée perdue. Au-delà du seuil d'enchaînement (plusieurs jours d'attente),
    // la question ne se pose pas : le PL a le temps, il rentre quoi qu'il arrive.
    return {
      skipDepot: continu,
      retourDuSoir: !continu
        && !hasWeekendBetween(finISO, suivant.dateC)
        && diffWorkdays(finISO, suivant.dateC) <= (rules.seuilEnchainementJours ?? 1),
    };
  };
  // Unité traitée juste après `lead` (lot seul, ou lot qui ouvre une paire) — même lecture que la
  // boucle principale : on saute les partenaires de paire déjà pris en charge.
  const uniteApres = (lead) => {
    const paire = mutuPairs.find(p => p.lotAcc.id === lead.id);
    const idx = lotsOnPL.findIndex(l => l.id === lead.id);
    return lotsOnPL.slice(idx + 1).find(l2 => l2.id !== paire?.lotAnc.id
      && !(handledIds.has(l2.id) && !mutuPairs.find(p => p.lotAcc.id === l2.id))) || null;
  };
  // Le chantier suivant, posé tel que la pose le poserait s'il repartait de la fin de `chaineUnite`
  // (garde week-end hors dépôt comprise), passerait-il un week-end hors dépôt ? Une paire suivante est
  // rejouée avec son vrai planificateur, et avec la décision d'enchaînement qu'elle prendrait elle-même
  // vers l'unité d'après — une rentrée finale fictive fausserait le contrôle du vendredi.
  const suivantTientQ17Depuis = (chaineUnite, gpsFin, suivant) => {
    const paireSuivante = mutuPairs.find(p => p.lotAcc.id === suivant.id);
    const lotsSuivants = paireSuivante ? [paireSuivante.lotAcc, paireSuivante.lotAnc] : [suivant];
    const jourSuivant = Math.min(...lotsSuivants.map(l => weekDays.indexOf(l.dateC)));
    if (jourSuivant < 0) return true; // hors axe : ses blocs seront conservés tels quels, rien à juger
    const finSuivant = paireSuivante ? (paireSuivante.sequence === "S1" ? paireSuivante.lotAnc : paireSuivante.lotAcc) : suivant;
    const apres = uniteApres(suivant);
    const optsSuivant = {
      appliquerPlageLot: true,
      // Liaison immédiate (arbitrage 2026-09-15) — le même curseur que la pose lui donnera.
      startCursorAbs: chaineUnite[chaineUnite.length - 1].endAbs,
      waitDateC: true,
      startGps: gpsFin,
      skipRetourDepot: apres
        ? deciderEnchainement(finSuivant.dateL || finSuivant.dateC, gc(finSuivant.cpL), apres).skipDepot
        : false,
      // Exactement ce que la pose lui donnera : garde active, départ hors dépôt.
      gardeWeekendRetour: true,
      departHorsDepot: true,
      rules,
    };
    const chaineSuivant = paireSuivante
      ? buildMutuChain(paireSuivante.lotAcc, paireSuivante.lotAnc, paireSuivante.sequence, veh, weekDays, optsSuivant, agencesData)
      : buildChain(suivant, veh, weekDays, optsSuivant, agencesData);
    return !chaineTraverseWeekend(chaineSuivant, weekDays);
  };
  // `construire(decision)` bâtit l'unité pour UNE décision (repli de faisabilité compris) et rend
  // { chain, skip } ; `libelle` ne sert qu'au journal.
  const poserSurFinReelle = ({ finNominale, gpsFin, suivant, construire, libelle }) => {
    // Étage Q17 : appliqué à la chaîne FINALEMENT retenue, quelle que soit la branche qui l'a produite.
    const tenirQ17 = (choisie) => {
      if (!suivant || !choisie.skip || !choisie.chain.length) return choisie;
      if (suivantTientQ17Depuis(choisie.chain, gpsFin, suivant)) return choisie;
      const rentree = construire({ skipDepot: false, retourDuSoir: false });
      if (!rentree.chain.length) return choisie;
      debug.inc("enchainements_refuses_q17");
      debug.log("BOUCLE", `  reflow ${libelle} : le camion RENTRE au dépôt avant ${suivant.id} — resté sur place, ${suivant.id} passerait un week-end hors dépôt (Q17)`);
      return rentree;
    };
    const decisionNominale = deciderEnchainement(finNominale, gpsFin, suivant);
    const pose = construire(decisionNominale);
    if (!suivant || !pose.chain.length) return pose;
    const finReelle = derniereLivraisonPosee(pose.chain);
    if (!finReelle || finReelle === finNominale) return tenirQ17(pose);
    const decisionReelle = deciderEnchainement(finReelle, gpsFin, suivant);
    if (decisionReelle.skipDepot === decisionNominale.skipDepot
        && decisionReelle.retourDuSoir === decisionNominale.retourDuSoir) return tenirQ17(pose);
    const rejoue = construire(decisionReelle);
    const stable = rejoue.chain.length > 0 && derniereLivraisonPosee(rejoue.chain) === finReelle;
    if (stable) {
      debug.log("BOUCLE", `  reflow ${libelle} : se termine réellement le ${finReelle} (prévu ${finNominale}) — enchaînement vers ${suivant.id} rejugé sur la fin réelle (${rejoue.skip ? "reste sur place" : "rentrée au dépôt"})`);
      return tenirQ17(rejoue);
    }
    debug.log("BOUCLE", `  reflow ${libelle} : fin réelle ${finReelle} ≠ prévue ${finNominale}, décision nominale conservée — la chaîne rejouée ne s'y termine plus`);
    return tenirQ17(pose);
  };

  for (let i = 0; i < lotsOnPL.length; i++) {
    const lot = lotsOnPL[i];

    // Si ce lot est dans une paire mutu déjà traitée, skip
    if (handledIds.has(lot.id) && !mutuPairs.find(p => p.lotAcc.id === lot.id)) continue;

    // Si ce lot ouvre une paire mutualisation : construire la chaîne interleavée
    const mutu = mutuPairs.find(p => p.lotAcc.id === lot.id);
    if (mutu) {
      // Détermine isLast : aucun autre lot non traité après cette paire
      const remainingAfter = lotsOnPL.slice(i + 1).filter(l2 =>
        l2.id !== mutu.lotAnc.id && (!handledIds.has(l2.id) || mutuPairs.find(p => p.lotAcc.id === l2.id))
      );
      const isLastMutu = remainingAfter.length === 0;
      const nextLotMutu = remainingAfter[0]; // prochain chantier après la paire (le cas échéant)
      const dayCRef = Math.min(
        weekDays.indexOf(mutu.lotAcc.dateC),
        weekDays.indexOf(mutu.lotAnc.dateC)
      );
      if (dayCRef < 0) {
        // Paire hors axe : blocs existants conservés (jamais de suppression silencieuse)
        keepExistingOf(resultBlocks, mutu.lotAcc.id, mutu.lotAnc.id);
        continue;
      }
      // GARDE WEEK-END RETOUR (Q17 étendu, portée élargie 2026-07-23) : active dès que la paire est
      // une mission complète dépôt → dépôt (part du dépôt ET y revient), quelle que soit sa position
      // dans la file — plus seulement quand elle est seule sur le PL. Aligné sur evalMutuSeq (garde
      // active en simulation), et sur la branche lot simple ci-dessous.
      const partDuDepotMutu = prevLivGps === agGps;
      // Dernière livraison de la paire (GPS + date de sortie) : S1 → LivAnc en dernier ; S2 → LivAcc.
      const finLotDe = (lotAccEff) => (mutu.sequence === "S1" ? mutu.lotAnc : lotAccEff);

      // ── Q15 À LA POSE — LE 4ᵉ CHEMIN (2026-07-31) ────────────────────────────────────────────
      // `reflowVehicle` était le seul producteur de boucles SANS aucun contrôle de la date vendue :
      // il rejouait la paire telle qu'elle était taguée, en ancrant la mission sur la `dateC`
      // PERSISTÉE de A. Or la date retenue par la proposition (A chargé dans sa flex, souvent
      // quelques jours après B) n'est jamais persistée — le lot garde sa date convenue. La paire
      // repartait donc du vendredi, la garde week-end (Q17) décalait TOUTE la tournée au lundi, et
      // le chargement VENDU de B partait avec elle. Cas fondateur CHT-547538 (accroché) /
      // CHT-400887 (ancre) : chargement vendu de l'ancre ven 18/09 → lun 21/09, sans AUCUNE
      // alerte — la proposition, elle, ne décalait rien (`partnerNewDateC: null`), donc rien ne
      // signalait l'écart au planificateur. Les trois gardes posées le même jour (mutu, retour,
      // detectBoucles) ne couvraient que la PROPOSITION : l'invariant « proposé = posé » tombait
      // ici, au dernier moment.
      //
      // Remède en deux temps, dans cet ordre :
      //   1. on REJOUE le placement de A dans sa fenêtre de flex — exactement ce que fait
      //      `evalMutuSeq` à la proposition — et on retient la 1ʳᵉ date qui tient la date vendue
      //      de B (sa date actuelle d'abord : le groupage déjà accepté reste préféré) ;
      //   2. si aucune ne la tient, la mutualisation N'EXISTE PAS : les deux lots sont reposés
      //      SÉPARÉMENT, chacun en mission autonome depuis le dépôt (filet plus bas).
      // ── ANCRAGE ≠ ATTERRISSAGE (CHT-968158 / CHT-435739, 2026-07-31) ──────────────────────────
      // `dateChgAcc` ci-dessous n'est PAS une date promise : c'est le point de DÉPART donné à
      // `buildMutuChain`, qui fait ensuite atterrir le chargement de A là où la chaîne le permet.
      // Les deux diffèrent couramment — ancrer sur mar 15/09 fait atterrir le chargement de A sur
      // ven 18/09, juste après celui de B.
      //
      // C'est ce qui rendait la boucle irrécupérable. La proposition (`evalMutuSeq`) renvoie la
      // date d'ATTERRISSAGE (`chgAcc.date`), qui est persistée comme `dateC` — correct, c'est bien
      // le jour où le camion charge. Mais `reflowVehicle` la réinjectait comme ANCRAGE, ce qui
      // reconstruit une chaîne DIFFÉRENTE : ancrée sur le vendredi, la garde week-end (Q17) décale
      // toute la tournée au lundi et emporte le chargement VENDU de B → Q15 rejette → mutualisation
      // abandonnée. 18/09 était la SEULE date de toute la fenêtre à casser la chaîne, et c'était
      // précisément celle qu'on réinjectait.
      //
      // D'où le balayage ci-dessous, mené QUEL QUE SOIT le verrou de A. L'ancien code s'en privait
      // quand A était verrouillé (« ses dates sont confirmées, on ne le replace pas ») : le
      // raisonnement confondait les deux notions. Ce qui est confirmé au client, c'est
      // l'ATTERRISSAGE ; l'ancrage n'est promis à personne. On balaye donc les mêmes dates que pour
      // un lot libre, et la garde posée dans la boucle n'accepte, si A est verrouillé, que les
      // chaînes qui reposent son chargement sur sa date exacte. Refuser de balayer ne protégeait
      // aucune date : le filet décalait ensuite le même lot BIEN PLUS LOIN, hors de sa flex.
      const aLockedMutu = isLotLocked(mutu.lotAcc);
      // La liste des ancrages vit dans `datesAncragePaire`, partagée avec la RECHERCHE de boucle
      // (`simulerPaireCommeLaPose`) : la proposition doit rejouer la paire exactement comme la pose
      // (diag CHT-933597). Fenêtre ancrée sur la date SOUHAITÉE, flex lue par `flexChgJours`.
      const datesChgAccReflow = datesAncragePaire(mutu.lotAcc, weekDays);

      let poseMutu = null;
      for (const dateChgAcc of datesChgAccReflow) {
        const lotAccEssai = dateChgAcc === mutu.lotAcc.dateC ? mutu.lotAcc : { ...mutu.lotAcc, dateC: dateChgAcc };
        // Toutes ces bornes dépendent de la date de chargement de A : elles se recalculent à
        // chaque essai, sinon l'ancrage resterait celui de la date écartée.
        const dayCRefEssai = Math.min(
          weekDays.indexOf(lotAccEssai.dateC),
          weekDays.indexOf(mutu.lotAnc.dateC)
        );
        if (dayCRefEssai < 0) continue;
        // Plage COMMUNE aux deux dossiers : en mutualisation, l'élargissement ne vaut que si les
        // deux clients l'ont accepté (cf. `plageCommune`). Même correction qu'au lot simple —
        // l'heure réglée doit valoir pour la première activité de la journée, approche comprise.
        const defaultCursorEssai = toAbs(dayCRefEssai,
          plageAt(plagesCommunes(lotAccEssai, mutu.lotAnc), dayCRefEssai, weekDays).debut);
        // Liaison immédiate depuis le chantier précédent (arbitrage 2026-09-15, cf. branche lot seul) ;
        // `buildMutuChain` ne charge jamais avant la `dateC` d'un lot.
        const startCursorEssai = cursor === undefined
          ? defaultCursorEssai
          : partDuDepotMutu ? Math.max(cursor, defaultCursorEssai) : cursor;
        const finLotEssai = finLotDe(lotAccEssai);
        // Enchaînement continu vers le chantier suivant : mêmes règles que pour un lot simple —
        // le PL ne saute le retour dépôt que s'il enchaîne sans attendre sur place. Sinon (week-end
        // OU plusieurs jours d'écart) il rentre au dépôt entre la mutu et le chantier suivant.
        // Une nuit entre la fin de la paire et le chantier suivant ne se passe dehors que si le PL
        // est déjà à pied d'œuvre — même arbitrage qu'au lot simple (2026-08-03).
        // 🔑 Jugé sur la fin RÉELLE de la paire, pas sur la `dateL` du lot qui la ferme : la livraison
        // de l'ancre glisse couramment d'un jour en mutualisation (correctif 2026-09-15, cf.
        // `poserSurFinReelle` en tête de fonction — cas L0005+L0112 → L0126).
        const construireMutu = ({ skipDepot, retourDuSoir }) => {
          const optsMutu = {
            appliquerPlageLot: true,
            startCursorAbs: startCursorEssai,
            startGps: prevLivGps,
            startPoint: prevLivPoint,
            skipRetourDepot: skipDepot,
            // 🔴 Q17 — la garde reste active sur une paire ENCHAÎNÉE (correctif 2026-09-15), comme au
            // lot simple plus bas (`gardeWeekendRetour: partDuDepot`, CHT-003327). Elle valait
            // `partDuDepotMutu && !skipDepotEssai`, et le repli ci-dessous la coupait : une paire suivie
            // d'un troisième lot perdait sa coupure du vendredi et dormait chargée chez le client.
            // Cf. `buildMutuChainGardeWeekend`.
            // 🔴 Et depuis le 2026-09-15 elle vaut AUSSI sur une paire qui ne part pas du dépôt, avec les
            // seuls remèdes qui ramènent le camion chez lui (`departHorsDepot`) — cf. « RESTER SUR PLACE
            // N'EST PERMIS QUE SI LE CHANTIER SUIVANT TIENT Q17 » en tête de fonction.
            gardeWeekendRetour: true,
            departHorsDepot: !partDuDepotMutu,
            rules,
          };
          let chain = buildMutuChain(lotAccEssai, mutu.lotAnc, mutu.sequence, veh, weekDays, optsMutu, agencesData);
          let skip = skipDepot;
          // Repli de faisabilité : retour du soir impossible avant la fin de journée → reste sur place.
          // La garde week-end, elle, n'est PAS levée par ce repli : rester sur place un soir de semaine
          // n'autorise jamais un week-end hors dépôt.
          if (retourDuSoir && chain.length && !retourDepotTientDansLaJournee(chain)) {
            skip = true;
            chain = buildMutuChain(lotAccEssai, mutu.lotAnc, mutu.sequence, veh, weekDays,
              { ...optsMutu, skipRetourDepot: true }, agencesData);
          }
          return { chain, skip };
        };
        const { chain: essai, skip: skipDepotEssai } = poserSurFinReelle({
          finNominale: finLotEssai.dateL || finLotEssai.dateC,
          gpsFin: gc(finLotEssai.cpL),
          suivant: isLastMutu ? null : nextLotMutu,
          construire: construireMutu,
          libelle: `${mutu.lotAcc.id}+${mutu.lotAnc.id}`,
        });
        if (essai.length === 0) continue;
        if (!chgVenduTenu(essai, mutu.lotAnc)) {
          debug.inc("boucle_rejets_chg_vendu");
          debug.log("BOUCLE", `  reflow ${mutu.lotAcc.id}+${mutu.lotAnc.id} REJECT chgAcc=${dateChgAcc} — déplacerait le chargement VENDU de ${mutu.lotAnc.id} (${mutu.lotAnc.dateC} → ${essai.find(b => b.type === "chg" && b.lotId === mutu.lotAnc.id)?.date || "?"}) — Q15`);
          continue;
        }
        // A VERROUILLÉ : son chargement est confirmé au client, donc il doit ATTERRIR exactement
        // sur sa date — l'ancrage a pu varier, l'atterrissage non. Même prédicat unique que pour la
        // date vendue de B : on relit la chaîne réellement planifiée, jamais une estimation.
        if (aLockedMutu && !chgVenduTenu(essai, mutu.lotAcc)) {
          debug.log("BOUCLE", `  reflow ${mutu.lotAcc.id}+${mutu.lotAnc.id} REJECT ancrage=${dateChgAcc} — ${mutu.lotAcc.id} est VERROUILLÉ et son chargement atterrirait le ${essai.find(b => b.type === "chg" && b.lotId === mutu.lotAcc.id)?.date || "?"} au lieu du ${mutu.lotAcc.dateC}`);
          continue;
        }
        if (dateChgAcc !== mutu.lotAcc.dateC) {
          const atterrissage = essai.find(b => b.type === "chg" && b.lotId === mutu.lotAcc.id)?.date;
          debug.log("BOUCLE", atterrissage === mutu.lotAcc.dateC
            // Cas CHT-968158 : rien n'a bougé côté client, seul le point de départ de la simulation
            // change. C'est la reconstruction à l'identique de la chaîne retenue à la proposition.
            ? `  reflow ${mutu.lotAcc.id}+${mutu.lotAnc.id} : chaîne réancrée sur ${dateChgAcc} — le chargement de ${mutu.lotAcc.id} atterrit bien le ${mutu.lotAcc.dateC}, aucune date client déplacée`
            : `  reflow ${mutu.lotAcc.id}+${mutu.lotAnc.id} : chargement de ${mutu.lotAcc.id} replacé dans sa flex (${mutu.lotAcc.dateC} → ${atterrissage}) pour tenir la date vendue de ${mutu.lotAnc.id} (${mutu.lotAnc.dateC})`);
        }
        poseMutu = { chain: essai, skipDepot: skipDepotEssai, finLot: finLotEssai };
        break;
      }

      if (poseMutu) {
        const { chain: mutuChain, skipDepot: skipDepotMutu, finLot: finMutuLot } = poseMutu;
        cursor = mutuChain[mutuChain.length - 1].endAbs;
        // GPS de sortie : si le PL rentre au dépôt (pas de skip), il repart du dépôt pour le
        // chantier suivant ; sinon il est positionné à la dernière livraison de la paire.
        prevLivGps = skipDepotMutu ? gc(finMutuLot.cpL) : agGps;
        prevLivPoint = skipDepotMutu
          ? { label: finMutuLot.vL || finMutuLot.cpL || "?", cp: finMutuLot.cpL, gps: prevLivGps, lotId: finMutuLot.id, etape: "liv" }
          : null;
        // KM ÉVITÉS mutu : contrairement au retour, la chaîne mutu imbriquée ne pose pas de bloc
        // « repo » ancre des km évités. On attache la valeur décidée (persistée sur le lot,
        // `_boucleKmEco`) au 1er chargement de la paire — une seule fois — pour que le KPI
        // « km économisés » (somme des `_kmEvites`) compte aussi les mutualisations.
        // 🔑 Le gain se lit sur le LIEN QUI RELIE CES DEUX LOTS, pas sur `_boucleKmEco` — miroir du
        // PREMIER lien (§ 8 bis, piège n°1). Sur le lot du milieu d'une tournée à trois, le miroir
        // peut porter le gain du RETOUR : la paire mutualisée se voyait alors créditer un chiffre
        // qui n'était pas le sien, et le KPI « km économisés » comptait de travers.
        // Repli sur le miroir quand le lien ne porte pas de chiffre (lot d'avant 4A) : à deux, les
        // deux valeurs sont la même, et le comportement est strictement inchangé.
        const kmEcoDuLien = (lot, partenaire) =>
          liensDuLot(lot).find(li => li.avec === partenaire.id)?.kmEco ?? lot._boucleKmEco;
        const kmEcoMutu = kmEcoDuLien(mutu.lotAcc, mutu.lotAnc)
          ?? kmEcoDuLien(mutu.lotAnc, mutu.lotAcc)
          ?? null;
        if (kmEcoMutu != null && kmEcoMutu > 0) {
          const firstChgMutu = mutuChain.find(b => b.type === "chg" && !b._overflow);
          if (firstChgMutu) {
            firstChgMutu._kmEvites = kmEcoMutu;
            firstChgMutu.pills = [...(firstChgMutu.pills || []), `−${kmEcoMutu}km évités`];
          }
        }
        resultBlocks.push(...mutuChain);
        continue;
      }

      // FILET (Q15, étape 2) : aucune date de chargement de A ne permet de tenir la date VENDUE de
      // B — la mutualisation n'existe pas. On repose les DEUX lots séparément, dans l'ordre de
      // leurs chargements, chacun en mission complète depuis le dépôt (le PL rentre entre les
      // deux). C'est le comportement « hors boucle » normal : le camion roule plus, mais aucune
      // date client n'est trahie. Invariant « jamais de suppression silencieuse » : un lot non
      // rechaînable conserve ses blocs existants.
      debug.log("BOUCLE", `  reflow ${mutu.lotAcc.id}+${mutu.lotAnc.id} : mutualisation ABANDONNÉE — aucune date de chargement de ${mutu.lotAcc.id} ne tient la date vendue de ${mutu.lotAnc.id} (${mutu.lotAnc.dateC}) — Q15 ; repose séparée`);
      // Chaîne les deux lots l'un après l'autre, sans effet de bord : l'ordre de passage décide
      // lequel des deux tient sa date, donc on doit pouvoir en essayer plusieurs avant d'appliquer.
      const poserSeparement = (ordre) => {
        const out = [];
        let cur = cursor, gps = prevLivGps, point = prevLivPoint;
        for (const lotSeul of ordre) {
          const daySeul = weekDays.indexOf(lotSeul.dateC);
          if (daySeul < 0) {
            out.push(...(existingBlocks || []).filter(b => b.lotId === lotSeul.id));
            continue;
          }
          const defaultCursorSeul = toAbs(daySeul, plageAt(plagesDuLot(lotSeul), daySeul, weekDays).debut);
          const chainSeule = buildChain(lotSeul, veh, weekDays, {
            appliquerPlageLot: true,
            // Liaison immédiate hors dépôt (arbitrage 2026-09-15), approche le jour du chargement sinon.
            startCursorAbs: cur === undefined ? defaultCursorSeul : gps === agGps ? Math.max(cur, defaultCursorSeul) : cur,
            waitDateC: gps !== agGps,
            startGps: gps,
            startPoint: point,
            // Garde week-end sur chaque lot reposé, départ hors dépôt compris (Q17, 2026-09-15).
            gardeWeekendRetour: true,
            departHorsDepot: gps !== agGps,
            rules,
          }, agencesData);
          if (chainSeule.length === 0) {
            out.push(...(existingBlocks || []).filter(b => b.lotId === lotSeul.id));
            continue;
          }
          cur = chainSeule[chainSeule.length - 1].endAbs;
          // Chaque lot reposé seul est une mission complète : le PL rentre au dépôt à la fin.
          gps = agGps;
          point = null;
          out.push(...chainSeule);
        }
        return { blocks: out, cursor: cur, prevLivGps: gps, prevLivPoint: point };
      };

      // L'ordre de passage n'est PAS neutre : le premier lot mobilise le camion et repousse le
      // second. À dates de chargement identiques (le cas typique d'une paire mutualisée), passer A
      // en premier ferait rater sa date au dossier VENDU de B — on remplacerait une violation de
      // Q15 par une autre. On essaie donc les deux ordres et on retient le premier qui tient la
      // date de B ; à défaut, l'ordre chronologique (règle d'ajustement §4 : B ne bouge qu'en
      // dernier recours). Le décalage qui subsiste alors porte sur A et reste SIGNALÉ par l'alerte
      // « chargement décalé » — visible, jamais silencieux.
      const chrono = [mutu.lotAcc, mutu.lotAnc].sort((x, y) => (x.dateC < y.dateC ? -1 : 1));
      const ordresEssayes = [chrono, [mutu.lotAnc, mutu.lotAcc]];
      let repose = null;
      for (const ordre of ordresEssayes) {
        const essaiSep = poserSeparement(ordre);
        if (chgVenduTenu(essaiSep.blocks, mutu.lotAnc)) {
          repose = essaiSep;
          debug.log("BOUCLE", `  reflow ${mutu.lotAcc.id}+${mutu.lotAnc.id} : repose séparée dans l'ordre ${ordre.map(l => l.id).join(" → ")} — date vendue de ${mutu.lotAnc.id} tenue`);
          break;
        }
      }
      if (!repose) {
        repose = poserSeparement(chrono);
        debug.log("BOUCLE", `  reflow ${mutu.lotAcc.id}+${mutu.lotAnc.id} : AUCUN ordre ne tient la date vendue de ${mutu.lotAnc.id} (${mutu.lotAnc.dateC}) — les deux chargements sont dus le même jour et le PL ne peut pas les servir tous les deux ; repose chronologique, décalage signalé`);
      }
      // SIGNALER, PAS MODÉLISER (arbitrage Louis 2026-08-01). La boucle reste `accepted` : le
      // moteur ne défait pas une décision de planificateur dans son dos. Mais la pose, elle, ne la
      // tient pas — et le planificateur doit le voir sans avoir à comparer deux écrans. On marque
      // donc les chargements des deux dossiers. `_warning` est le véhicule déjà en place : rendu
      // sur le bloc (`AtomBlock`), repris dans le détail (`RouteBlockModal`), et PERSISTÉ en base
      // (`placement_segments.warning_code`) — donc visible aussi dans `diag.sh`, section Alerte.
      //
      // Recopie plutôt que mutation : `poserSeparement` peut renvoyer des blocs EXISTANTS conservés
      // tels quels (lot hors axe, invariant « jamais de suppression silencieuse ») ; les modifier en
      // place écrirait dans `existingBlocks`, partagé avec l'appelant.
      const alerteMutu = "Mutualisation non tenue — les 2 dossiers roulent séparément";
      cursor = repose.cursor;
      prevLivGps = repose.prevLivGps;
      prevLivPoint = repose.prevLivPoint;
      resultBlocks.push(...repose.blocks.map(b => (b.type === "chg" && !b._overflow)
        // Concaténation, jamais écrasement : le chargement porte souvent déjà « Chargement décalé »,
        // et les deux informations comptent (même séparateur que les consignes de `chainBuilder`).
        ? { ...b, _warning: b._warning ? `${b._warning} · ${alerteMutu}` : alerteMutu }
        : b));
      continue;
    }

    const isFirst = resultBlocks.length === 0;
    // Prochain lot effectivement traité (en sautant les partenaires mutu déjà gérés)
    const nextLot = lotsOnPL.slice(i + 1).find(l2 =>
      !(handledIds.has(l2.id) && !mutuPairs.find(p => p.lotAcc.id === l2.id))
    );
    const isLast = !nextLot;
    // Retour dépôt intermédiaire : le PL n'enchaîne directement sur le lot suivant (saut du
    // retour dépôt + repositionnement) QUE si l'enchaînement est continu (cf. enchainementContinu :
    // pas de week-end intercalé ET écart ≤ seuilEnchainementJours). Sinon — week-end OU simplement
    // plusieurs jours d'attente — le PL rentre au dépôt entre les deux au lieu de patienter sur
    // place, et le lot suivant repartira du dépôt (startGps = dépôt).
    // Cas concret : quand une boucle est cassée (écart > 3 j, cf. T25), le lot restant récupère
    // ainsi son retour dépôt au lieu de laisser le PL bloqué loin de sa base tout le week-end.
    // 🔑 La décision (`deciderEnchainement`, retour du soir compris) est prise plus bas, sur la fin
    // RÉELLE du lot posé et non sur sa `dateL` (correctif 2026-09-15, `poserSurFinReelle`) : un lot
    // arrivé en retard derrière un voisin livre après sa date prévue (cas L0062 → L0087).

    // Curseur de départ : au premier lot, le début de la journée sur `dayC`. Sinon, cursor hérité
    // du lot précédent.
    //
    // ⚠️ L'HEURE DE DÉBUT DE JOURNÉE EST CELLE DE LA PREMIÈRE ACTIVITÉ, QUELLE QU'ELLE SOIT
    // (arbitrage Louis 2026-08-03) — approche, route ou chargement. `DAY_START` était codé en dur
    // ici : comme `buildChainInterne` privilégie `opts.startCursorAbs`, la branche qui lit la plage
    // du dossier n'était jamais empruntée DEPUIS LA POSE. Un dossier réglé « départ dès 5h » voyait
    // donc son APPROCHE partir quand même à 7h, alors que les journées suivantes démarraient bien
    // à 5h — d'où le constat « ça se règle sur le chargement mais pas sur l'approche ».
    // Ce n'est PAS une avance de départ pour faire tomber le chargement à 7h : l'arbitrage Q13
    // (« l'approche est posée le jour du chargement ») reste NON. On honore l'heure réglée, rien de plus.
    const dayC = weekDays.indexOf(lot.dateC);
    if (dayC < 0) {
      // Lot hors axe : blocs existants conservés tels quels (jamais de suppression silencieuse).
      // Leurs dates ISO restent justes ; on ne chaîne pas le curseur dessus (axe différent).
      keepExistingOf(resultBlocks, lot.id);
      continue;
    }
    const defaultCursor = toAbs(dayC, plageAt(plagesDuLot(lot), dayC, weekDays).debut);

    // Ce lot PART-il du dépôt ? Vrai pour le premier lot, et pour tout lot dont le précédent est
    // rentré au dépôt (prevLivGps repointé sur agGps, cf. plus bas). Faux sur un maillon enchaîné
    // en continu (prevLivGps = livraison du lot précédent).
    const partDuDepot = prevLivGps === agGps;
    // 🔑 LIAISON IMMÉDIATE (arbitrage Louis 2026-09-15 : « le camion commence la liaison tout de suite
    // après »). Parti du dépôt, le camion fait son approche le jour du chargement (Q13, inchangé).
    // Resté à la livraison précédente, il part AUSSITÔT : il roule le soir et dort près du chargement
    // suivant, qui reste tenu à sa date par `waitDateC`. C'est ce que simule la proposition
    // (`findBoucleCandidates` part de la fin de livraison) ; attendre le matin du chargement faisait
    // diverger la pose — L0271 annoncé livré le vendredi, posé le lundi après une coupure au dépôt.
    const startCursor = isFirst
      ? defaultCursor
      : partDuDepot ? Math.max(cursor, defaultCursor) : cursor;

    // buildChain avec les opts : point GPS de départ et skip retour dépôt seulement si enchaînement continu
    const construireLot = ({ skipDepot: skipDecide, retourDuSoir }) => {
      const optsChain = {
        // POSE : seul endroit où la plage horaire élargie d'un dossier s'applique (lot 2,
        // 2026-07-31). Les simulations de `findBoucleCandidates` / `detectBoucles` ne la passent
        // JAMAIS — une boucle ne doit pas exister parce qu'un dépassement du soir a été autorisé.
        appliquerPlageLot: true,
        startCursorAbs: startCursor,
        // Liaison immédiate : le chargement n'est jamais avancé avant sa date pour autant (Q15).
        waitDateC: !partDuDepot,
        startGps: prevLivGps,
        startPoint: prevLivPoint,
        skipRetourDepot: skipDecide,
        // GARDE WEEK-END RETOUR (Q17 étendu, 2026-07-22 ; portée élargie 2026-07-23 puis 2026-07-24) :
        // active sur TOUT lot qui PART DU DÉPÔT (partDuDepot), quelle que soit sa position dans la
        // file — pas seulement le premier. Un dossier posé en 2ᵉ/3ᵉ position qui repart du dépôt est
        // une mission autonome : son propre week-end doit être gardé, d'autant que le DERNIER lot d'un
        // PL n'a aucun « lot suivant » pour déclencher hasWeekendBetween (cas CHT-092958 / CHT-164258).
        // Reste active MÊME sur un maillon enchaîné (skipDepot) : skipDepot ne supprime que le retour
        // dépôt FINAL entre deux lots, alors que la garde protège aussi la COUPURE du vendredi À
        // L'INTÉRIEUR de la chaîne (chargement vendredi / route lundi). Un maillon qui charge le
        // vendredi doit rentrer chargé au dépôt pour le week-end même s'il livre le jour même que le
        // chargement du lot suivant (cas CHT-003327 : skipDepot vrai, mais week-end chargé loin du
        // dépôt sans la coupure). buildChain applique la coupure sans dessiner de retour final tant que
        // skipRetourDepot reste vrai.
        // 🔴 Q17 (2026-09-15) : la garde vaut désormais sur TOUT lot, qu'il parte du dépôt ou non. Un
        // maillon enchaîné n'a droit qu'aux remèdes qui ramènent le camion au dépôt (`departHorsDepot`) ;
        // si aucun ne suffit, le lot PRÉCÉDENT a déjà fait rentrer le camion (`suivantTientQ17Depuis`).
        gardeWeekendRetour: true,
        departHorsDepot: !partDuDepot,
        rules,
      };
      let chaine = buildChain(lot, veh, weekDays, optsChain, agencesData);
      let skip = skipDecide;

      // Repli de faisabilité : le retour du soir ne tient pas avant la fin de journée (livraison
      // tardive et/ou dépôt lointain) → le PL reste sur place, comme avant l'arbitrage 2026-08-03.
      if (retourDuSoir && chaine.length && !retourDepotTientDansLaJournee(chaine)) {
        skip = true;
        chaine = buildChain(lot, veh, weekDays, { ...optsChain, skipRetourDepot: true }, agencesData);
      }
      return { chain: chaine, skip };
    };
    const { chain, skip: skipDepot } = poserSurFinReelle({
      finNominale: lot.dateL || lot.dateC,
      gpsFin: gc(lot.cpL),
      suivant: isLast ? null : nextLot,
      construire: construireLot,
      libelle: lot.id,
    });

    if (chain.length === 0) {
      keepExistingOf(resultBlocks, lot.id);
      continue;
    }

    // Curseur final : endAbs du dernier bloc
    cursor = chain[chain.length - 1].endAbs;
    // GPS de sortie : si le PL est rentré au dépôt (pas de skip), il repart du dépôt ;
    // sinon il est positionné à la livraison du lot (repositionnement direct vers le suivant).
    prevLivGps = skipDepot ? gc(lot.cpL) : agGps;
    prevLivPoint = skipDepot
      ? { label: lot.vL || lot.cpL || "?", cp: lot.cpL, gps: prevLivGps, lotId: lot.id, etape: "liv" }
      : null;

    resultBlocks.push(...chain);
  }

  // 5. Conserve les blocs route manuels (sans lotId) tels quels
  const manualBlocks = (existingBlocks || []).filter(b => !b.lotId);
  const combined = [...resultBlocks, ...manualBlocks];

  // 6. Applique detectBoucles sur l'ensemble reconstruit
  return detectBoucles(combined, allLots, veh, weekDays, agencesData, rules);
}
