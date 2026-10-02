import { datesAround, addWorkdays, fmtDateFRShort } from './dates.js';

// DATES RETENUES PAR UNE BOUCLE — point d'application UNIQUE (2026-07-31)
//
// Quand le planificateur accepte une boucle, la proposition a choisi une date de chargement pour le
// lot A (l'accroché) : le moteur balaye sa fenêtre de flex et retient celle qui roule le moins tout
// en tenant la date VENDUE de l'ancre (Q15). Cette date DOIT être celle qu'on enregistre — sinon le
// lot part en base avec une date que la boucle n'a jamais retenue, et toute repose ultérieure
// (`reflowVehicle`) réancre la tournée dessus.
//
// C'est exactement ce qui s'est produit le 2026-07-31 (CHT-547538 accroché à CHT-400887) : la règle
// n'était appliquée QUE sur le chemin « lot nouveau » (`buildLotFromForm`). Un lot EXISTANT recalé
// sur une boucle — mutualisation acceptée, ou boucle retour acceptée par l'agence partenaire —
// gardait sa date demandée. La paire repartait donc du vendredi, la garde week-end (Q17) décalait
// toute la tournée au lundi, et le chargement vendu de l'ancre partait avec elle.
//
// D'où ce helper unique, appelé par les TROIS chemins : impossible de rediverger, et un quatrième
// chemin ajouté demain n'a qu'une seule fonction à appeler.
//
// Ce qu'il ne fait PAS : toucher aux dates du ANCRE. Celles-là ne bougent jamais (Q15) — seul le
// lot en cours de vente se déplace, et uniquement dans sa fenêtre de flex négociée.
// ── LA DATE SOUHAITÉE PAR LE CLIENT ─────────────────────────────────────────────────────────────
// `dateC`/`dateL` portent la date PLANIFIÉE : accepter une boucle les déplace dans la fenêtre de
// flex. `dateCSouhaitee`/`dateLSouhaitee` (colonne `requested_date`, migration 0006) portent ce que
// le client a DEMANDÉ : figées à la création, jamais réécrites par le moteur.
//
// Deux usages, et deux seulement :
//   • ancrer la fenêtre de flex — sinon elle se recentre sur chaque date retenue et la souplesse
//     promise au client dérive d'acceptation en acceptation ;
//   • dire si une proposition tombe sur la date voulue (badge « ✓ Date souhaitée par le client ») —
//     comparé à `dateC`, ce test se comparait à lui-même dès la 1ʳᵉ boucle acceptée : toujours vrai.
//
// Repli sur la date planifiée : les dossiers créés avant la migration n'ont pas de date souhaitée
// propre (le backfill l'aligne sur la date convenue) — et un lot en cours de saisie non plus.
export function dateChgSouhaitee(lot) {
  return lot?.dateCSouhaitee || lot?.dateC;
}

export function dateLivSouhaitee(lot) {
  return lot?.dateLSouhaitee || lot?.dateL || lot?.dateC;
}

// ── LA FLEXIBILITÉ DE CHARGEMENT NÉGOCIÉE — DEUX NOMS POUR LE MÊME CHAMP (2026-08-01) ────────────
// Piège coûteux, trouvé sur CHT-528539 : le moteur lisait `lot.flexC`, mais un dossier ENREGISTRÉ
// ne porte pas ce nom. Il porte `_flexC` — et la reconstitution côté API RETIRE explicitement
// `flexC` (`extra.__omit__`, cf. `onefleet-api/app/domain/recompose.py`). Les deux formes coexistent
// donc légitimement :
//   • `flexC`  — sur un objet FORMULAIRE (`buildLotFromForm`, `formDraft`), qui alimente
//                `findBoucleCandidates` : les appelants y traduisent à la main (`flexC: lot._flexC`) ;
//   • `_flexC` — sur un lot du state, donc tout ce que reçoit `reflowVehicle` (`lots`, `allLots`,
//                `fullLots` sont passés BRUTS par les cinq appelants).
//
// Conséquence avant ce helper : dans `reflowVehicle`, `parseInt(lot.flexC ?? 0)` valait toujours 0,
// et le balayage de la fenêtre de flex — le remède posé le 2026-07-31, puis élargi le 2026-08-01 —
// était du **code mort en production**. Il passait pourtant tous ses tests : les fixtures écrivaient
// `flexC`, la forme du formulaire, jamais celle de la base. Toute fixture de lot POSÉ doit désormais
// utiliser `_flexC`, sous peine de tester une situation qui n'existe pas.
export function flexChgJours(lot) {
  const v = parseInt(lot?.flexC ?? lot?._flexC ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function datesBoucleRetenues(chosen, base) {
  return {
    // `base.dateC` en repli : une boucle sans date retenue (ou un snapshot ancien) ne doit jamais
    // effacer la date du lot.
    dateC: chosen?.dateC || base?.dateC,
    // Repli en cascade identique à celui d'origine : un lot sans date de livraison connue est livré
    // le jour de son chargement.
    dateL: chosen?.dateL || base?.dateL || base?.dateC,
  };
}

// ── SORTIR DE LA FENÊTRE DE FLEX — LE SIGNAL DEMANDÉ PAR LA DIRECTION (Lot 3, 2026-08-18) ────────
//
// Arbitrage : « le retour doit survivre, mais les dates peuvent ne plus matcher : si on sort de la
// fenêtre de flex alors il faut déclencher une alerte. »
//
// Deux choses distinctes, qu'il ne faut pas confondre :
//   • le chargement est DÉCALÉ — il ne tombe plus sur la date demandée. Déjà signalé ailleurs, et
//     c'est bénin : la flexibilité existe précisément pour ça ;
//   • le chargement SORT DE LA FENÊTRE — il dépasse la souplesse que le client a accordée. Là, la
//     promesse commerciale est rompue, et quelqu'un doit rappeler le client.
//
// 🔑 LA FENÊTRE EST ANCRÉE SUR LA DATE SOUHAITÉE, jamais sur la date planifiée. `dateC` bouge à
// chaque boucle acceptée : s'y ancrer ferait dériver la souplesse d'acceptation en acceptation, et
// un dossier finirait à deux semaines de sa demande sans qu'aucun contrôle n'ait rien vu passer.
// C'est exactement la raison d'être de `requested_date` (migration 0006).
//
// 🔑 MÊME DÉFINITION DE FENÊTRE QUE LE MOTEUR — on appelle `datesAround`, celle qui sert déjà à
// chercher les dates possibles. Réécrire le calcul ici créerait deux fenêtres qui divergeraient au
// premier correctif : le moteur proposerait une date que ce contrôle jugerait hors limites.
//
// On ne juge JAMAIS sur une absence : sans date ou sans dossier, on ne signale rien. Refuser ou
// alerter sur une donnée manquante transformerait un trou de saisie en règle métier silencieuse.
export function dansFenetreFlexChg(lot, dateProposee) {
  if (!lot || !dateProposee) return true;
  const souhaitee = dateChgSouhaitee(lot);
  if (!souhaitee) return true;
  return datesAround(souhaitee, flexChgJours(lot)).includes(dateProposee);
}

// L'ALERTE ELLE-MÊME — rendue seulement quand il y a lieu d'alerter, `null` sinon.
//
// ⚠️ RESTREINTE AUX DOSSIERS DONT LA SOUPLESSE A ÉTÉ NÉGOCIÉE (`flexChgJours > 0`), et ce n'est pas
// un détail. Sans flexibilité, la fenêtre se réduit au seul jour demandé : le moindre décalage
// deviendrait une alerte, alors qu'il est déjà signalé par le message « Chargement décalé ». On
// aurait deux signaux pour un même fait, dont un en rouge — et une alerte rouge qui se déclenche
// tout le temps finit par n'être plus lue du tout. Ce qui se signale ici, c'est le dépassement
// d'une souplesse ACCORDÉE, pas l'absence de souplesse.
export function alerteSortieDeFlexChg(lot, dateProposee) {
  const flex = flexChgJours(lot);
  if (flex <= 0) return null;
  if (dansFenetreFlexChg(lot, dateProposee)) return null;
  // Dates en clair (2026-09-15) : l'ISO brut « 2026-10-05 » s'affichait tel quel à l'écran.
  return `Hors fenêtre de flexibilité — chargement au ${fmtDateFRShort(dateProposee)}, souplesse accordée : ${flex} j ouvrés autour du ${fmtDateFRShort(dateChgSouhaitee(lot))}`;
}

// ── LES FENÊTRES DE FLEXIBILITÉ, À AFFICHER — point de lecture UNIQUE (2026-09-14) ─────────────
// Chantier UX v6 (Louis : « exprimer la fenêtre de flexibilité différemment, en jours ouvrés, calqué
// sur le moteur »). Avant ce jour, la fiche du lot (`LotDetailSheet`) recalculait sa fenêtre en jours
// CALENDAIRES (`setDate(± flex)`) pendant que le moteur et l'écran de proposition comptaient en jours
// OUVRÉS (`datesAround`) : pour un même lot, deux écrans annonçaient deux fenêtres différentes. Ces deux
// fonctions sont désormais la seule source des bornes affichées — fiche, proposition, réception.
// Elles ne DÉCIDENT rien : le moteur reste seul juge ; elles relisent ses définitions.

// Chargement — la fenêtre négociée, en jours ouvrés, autour de la date SOUHAITÉE (même ancrage et
// même fonction que `dansFenetreFlexChg` ci-dessus, donc que `allowedDatesAcc` de `boucleEngine`).
// `null` quand aucune souplesse n'a été négociée : il n'y a alors rien à afficher.
export function fenetreFlexChg(lot) {
  const jours = flexChgJours(lot);
  const souhaitee = dateChgSouhaitee(lot);
  if (!jours || !souhaitee) return null;
  const dates = datesAround(souhaitee, jours);
  if (!dates.length) return null;
  return { debut: dates[0], fin: dates[dates.length - 1], jours, souhaitee };
}

// Livraison — la règle du moteur de boucles (`boucleEngine.js`, « livraison plus tôt que demandée =
// OK, plus tard = borné par flexL ») : `flexLivraisonJours` jours OUVRÉS au plus tard après la date
// demandée (`dateLMaxAcc = addWorkdays(dateLRef, flexL)`), plus tôt accepté ; une date imposée par le
// client (`dateLivImposee`) ferme la fenêtre. `null` = pas de fenêtre (date stricte).
// ⚠️ Hors boucle, `chainBuilder` sait aussi AVANCER une livraison de ≤ flexL jours ouvrés pour tenir
// Q17 (`chercherLivraisonAvancee`) : c'est le même principe (« plus tôt accepté »), rien à ajouter ici.
export function fenetreFlexLiv(lot, rules) {
  if (!lot || lot.dateLivImposee) return null;
  const jours = rules?.flexLivraisonJours ?? 4;
  const souhaitee = dateLivSouhaitee(lot);
  if (!jours || jours <= 0 || !souhaitee) return null;
  return { auPlusTard: addWorkdays(souhaitee, jours), jours, souhaitee };
}

// Une date de livraison proposée tient-elle dans la fenêtre ? Même prudence que `dansFenetreFlexChg` :
// sans donnée, on ne juge pas (vrai). Plus tôt que la date souhaitée : toujours dans la fenêtre.
export function dansFenetreFlexLiv(lot, rules, dateProposee) {
  if (!lot || !dateProposee) return true;
  const souhaitee = dateLivSouhaitee(lot);
  if (!souhaitee) return true;
  const f = fenetreFlexLiv(lot, rules);
  return dateProposee <= (f ? f.auPlusTard : souhaitee);
}
