import { gc, hav } from '../data/gps.js';
import { RULES_DEFAULTS, parseDur, manutHeures } from '../data/referentiels.js';
import { debug } from '../utils/debug.js';
import { isLotLocked } from '../utils/statusHelpers.js';
import { lotResserrable } from '../utils/resserrage.js';
import { hasWeekendBetween } from '../utils/dates.js';
import { alerteSortieDeFlexChg } from '../utils/datesBoucle.js';

export function agLookup(id, agencesData) {
  return agencesData?.find(a => a.id === id) || { id, name: id, cp: "", color: "#6A6960", region: "" };
}

// Région d'une agence, NORMALISÉE (minuscules, sans espaces parasites).
// Une agence inconnue, ou dont la région n'est pas renseignée, rend "" — voir `memePerimetreMutu`.
export function regionDe(soc, agencesData) {
  if (!soc) return "";
  return String(agLookup(soc, agencesData).region || "").trim().toLowerCase();
}

// PÉRIMÈTRE DE MUTUALISATION (arbitrage Louis 2026-07-29) — deux lots peuvent partir ensemble sur
// le même camion s'ils relèvent de la MÊME AGENCE, ou de deux agences d'une MÊME RÉGION.
// La région suffit parce que la cible d'organisation est « 1 région = 1 planificateur » :
// l'acceptation de l'agence voisine est IMPLICITE (aucun circuit de validation, cf. regles-metier.md §3).
//
// ⚠️ La région VIDE n'est jamais comparable. Deux sources la produisent : le repli d'`agLookup`
// ci-dessus (agence inconnue → region: "") et `agencies.region_code`, NULLABLE en base depuis la
// migration 0005. Sans le test `!!rA`, un `"" === ""` mettrait toutes les agences non renseignées
// dans le même périmètre — c'est-à-dire ouvrirait la mutualisation nationale par accident.
export function memePerimetreMutu(socAcc, socAnc, agencesData) {
  if (!socAcc || !socAnc) return false;
  if (socAcc === socAnc) return true;
  const rA = regionDe(socAcc, agencesData);
  return !!rA && rA === regionDe(socAnc, agencesData);
}

// Hourly scheduler: each block is placed sequentially starting from 7h on dateC.
// Working hours: 7h-18h (11h/day). Blocks that overflow 18h continue at 7h next day.
// dateC and dateL are hard constraints. The engine signals warnings if timing is tight.
// Blocks get absolute hour positions (startH/endH from Monday 7h).

export const DAY_START = 7;  // 7h
export const DAY_END = 18;   // 18h
export const DAY_HOURS = DAY_END - DAY_START; // 11h useful per day

// ── PLAGE HORAIRE ÉLARGIE, DOSSIER PAR DOSSIER (arbitrage Louis 2026-07-31, lot 2) ──────────────
//
// La journée ouvrée 7h-18h reste la norme, et reste la SEULE que le moteur de boucles connaisse.
// Un dossier peut exceptionnellement l'élargir — départ plus tôt, fin plus tard — pour éviter de
// déborder d'une journée entière sur un reliquat de 2-3 h.
//
// ⚠️ RÈGLE STRUCTURANTE : cet élargissement ne doit JAMAIS influencer une décision de boucle.
// `findBoucleCandidates` et `detectBoucles` appellent les planificateurs en direct et raisonnent
// donc toujours en 7h-18h ; seule la POSE (`reflowVehicle`) active la plage du dossier, via
// `opts.appliquerPlageLot`. Une boucle ne doit pas exister *parce que* quelqu'un a autorisé un
// dépassement du soir. Même motif que `opts.gardeWeekendRetour`, plus bas.
export const PLAGE_STD = { debut: DAY_START, fin: DAY_END };

// Borne une plage saisie et retombe sur la journée standard si elle n'a pas de sens.
// Le plafond à 23 n'est pas cosmétique : `fromAbs` déduit le jour d'une division par 24 — une
// fin à 24h ferait basculer les blocs au lendemain en silence.
export function normaliserPlage(p) {
  const debut = Number(p?.debut), fin = Number(p?.fin);
  if (!Number.isFinite(debut) || !Number.isFinite(fin)) return PLAGE_STD;
  if (debut < 0 || fin > 23 || debut >= fin) return PLAGE_STD;
  return { debut, fin };
}

// Plage effective d'un dossier — champs absents = journée standard.
export function plageDuLot(lot) {
  return normaliserPlage({ debut: lot?.plageDebut, fin: lot?.plageFin });
}

// Plage d'une PAIRE mutualisée = INTERSECTION des deux dossiers. L'élargissement ne s'applique que
// si les DEUX clients l'ont accepté : sans ça, l'autorisation donnée par l'un ferait sonner à 5h
// du matin chez l'autre.
export function plageCommune(a, b) {
  const pa = plageDuLot(a), pb = plageDuLot(b);
  return normaliserPlage({ debut: Math.max(pa.debut, pb.debut), fin: Math.min(pa.fin, pb.fin) });
}

// ── UNE PLAGE PAR DATE (arbitrage Louis 2026-08-03) ──────────────────────────────────────────────
//
// Le réglage était porté par le DOSSIER ENTIER : autoriser un dépassement pour absorber le reliquat
// d'une seule journée élargissait du même coup toutes les autres, y compris celles qui n'en avaient
// aucun besoin. Le dossier porte désormais une table :
//
//   lot.plagesParDate = { "2026-09-14": { debut: 5, fin: 21 }, "2026-09-16": { debut: 7, fin: 20 } }
//
// `plageDebut` / `plageFin` sont CONSERVÉS comme repli du dossier : les dossiers déjà en base
// fonctionnent à l'identique, et une date sans entrée dédiée hérite de la plage du dossier, puis de
// `PLAGE_STD`. Pas de migration SQL — comme `plageDebut`/`plageFin`, le champ n'a pas de colonne et
// transite par le résidu JSONB `lots.extra` (`onefleet-api/app/domain/shred.py`).
//
// Le résolveur SE LIT COMME UNE PLAGE PLATE (spread de l'enveloppe) : c'est délibéré, tout code non
// encore converti continue de fonctionner sur les bornes du dossier. C'est ce qui rend la conversion
// incrémentale et sûre.
export function plagesDuLot(lot) {
  const base = plageDuLot(lot);
  const parDate = lot?.plagesParDate || {};
  const dates = Object.keys(parDate);
  return {
    ...base,                                    // enveloppe : bornes du dossier, pour les gardes
    // `estStandard` regarde l'enveloppe ET la table : sans lui, un dossier resté en 7h-18h mais
    // portant une journée élargie serait pris pour « rien à arbitrer » par `avecGardeJamaisPire`,
    // qui sauterait alors la garde « jamais pire ».
    estStandard: base.debut === PLAGE_STD.debut && base.fin === PLAGE_STD.fin
      && dates.every(d => {
        const p = normaliserPlage(parDate[d]);
        return p.debut === PLAGE_STD.debut && p.fin === PLAGE_STD.fin;
      }),
    at(day, weekDays) {
      const p = parDate[weekDays?.[day]];
      return p ? normaliserPlage(p) : base;
    },
  };
}

// Plages d'une PAIRE mutualisée, date par date. Même règle qu'avant, appliquée au JOUR : deux
// dossiers qui partagent un camion ne peuvent pas avoir deux journées différentes, donc on prend
// l'intersection — et seulement celle du jour concerné.
export function plagesCommunes(lotAcc, lotAnc) {
  const pAcc = plagesDuLot(lotAcc), pAnc = plagesDuLot(lotAnc);
  const base = plageCommune(lotAcc, lotAnc);
  return {
    ...base,
    estStandard: pAcc.estStandard && pAnc.estStandard,
    at(day, weekDays) {
      const a = pAcc.at(day, weekDays), b = pAnc.at(day, weekDays);
      return normaliserPlage({ debut: Math.max(a.debut, b.debut), fin: Math.min(a.fin, b.fin) });
    },
  };
}

// Adaptateur unique, appelé à CHAQUE site de lecture. Il accepte indifféremment une plage plate
// (`PLAGE_STD`, appels externes, tests existants) ou un résolveur : c'est ce qui permet à toutes
// les signatures publiques de rester inchangées.
export const plageAt = (plage, day, weekDays) =>
  typeof plage?.at === "function" ? plage.at(day, weekDays) : (plage || PLAGE_STD);

// « Cette plage est-elle la journée standard, partout ? » — enveloppe ET table par date.
export const plageEstStandard = (plage) =>
  typeof plage?.estStandard === "boolean"
    ? plage.estStandard
    : plage?.debut === PLAGE_STD.debut && plage?.fin === PLAGE_STD.fin;

// Un bloc déborde-t-il de la journée standard ? Sert au badge sur le Gantt : un camion qui roule
// à 20h doit se voir.
export function horsPlageStandard(startH, endH) {
  return startH < DAY_START || endH > DAY_END;
}

// Convert day index + hour to absolute hour (from start of week)
export function toAbs(day, h) { return day * 24 + h; }
// Convert absolute hour to day + hour
export function fromAbs(abs) { return { day: Math.floor(abs / 24), h: abs % 24 }; }

// Retourne le jour JS (0=Dim,1=Lun,...,6=Sam) pour un day-index dans weekDays
// weekDays[dayIndex] est une date ISO "YYYY-MM-DD"
export function dayOfWeek(dayIndex, weekDays) {
  const iso = weekDays?.[dayIndex];
  if (!iso) return -1;
  return new Date(iso + "T12:00:00").getDay();
}

// Retourne true si le day-index correspond à un samedi ou dimanche
export function isWeekend(dayIndex, weekDays) {
  const dow = dayOfWeek(dayIndex, weekDays);
  return dow === 0 || dow === 6;
}

// Pour un abs-time, avancer jusqu'au prochain lundi matin si on est en weekend.
// weekDays est optionnel ; si absent, on se base sur le résidu mod 7
// (jeu=0, ven=1, lun=2, mar=3, mer=4, jeu=5, ven=6, lun=7, mar=8 dans extendedDays).
// RÈGLE VENDREDI : le PL doit impérativement être rentré au dépôt le vendredi soir (DAY_END).
// RÈGLE CHARGEMENT FIN DE SEMAINE : un chargement peut avoir lieu le vendredi ;
// la route et la livraison sont repoussées au lundi suivant si nécessaire.
// `plage` : journée ouvrée applicable, PLAGE_STD (7h-18h) par défaut — cf. § plage élargie.
export function snapToWorkingHours(abs, weekDays, plage = PLAGE_STD) {
  let { day, h } = fromAbs(abs);
  // La plage est résolue POUR LE JOUR COURANT, et re-résolue à chaque fois qu'on change de jour :
  // deux journées d'une même mission peuvent avoir des amplitudes différentes.
  let p = plageAt(plage, day, weekDays);
  // Snap heure hors plage ouvrable
  if (h < p.debut) h = p.debut;
  if (h >= p.fin) { day += 1; h = plageAt(plage, day, weekDays).debut; }
  // Sauter les weekends : si le jour est sam ou dim dans weekDays, avancer au lundi
  // On itère max 3 fois pour gérer Sam+Dim
  for (let guard = 0; guard < 3; guard++) {
    const dow = dayOfWeek(day, weekDays);
    // dow === -1 : jour hors fenêtre → pas de règle weekend applicable
    if (dow === -1) break;
    if (dow === 6) { day += 2; h = plageAt(plage, day, weekDays).debut; } // Sam → Lun
    else if (dow === 0) { day += 1; h = plageAt(plage, day, weekDays).debut; } // Dim → Lun
    else break;
  }
  return toAbs(day, h);
}

// ── RECUL EN HEURES OUVRÉES — le symétrique de `snapToWorkingHours` (2026-08-01) ─────────────────
// Rend l'instant situé `duree` heures OUVRÉES AVANT `finAbs`, en remontant les nuits et les
// week-ends (qui ne consomment rien). Sert à poser un bloc « au plus tard » : on connaît l'heure à
// laquelle il doit être TERMINÉ, on en déduit quand partir.
//
// Motivé par l'approche initiale d'une mutualisation (CHT-050731) : elle était posée au DÉMARRAGE
// de la chaîne, alors que le premier chargement, lui, est ancré à sa propre date. Quand les deux
// diffèrent — ce qui arrive dès que le balayage d'ancrage recule le départ pour sortir une heure de
// route du vendredi — le camion montait chez le client puis y restait garé DEUX JOURNÉES. Le
// raisonnement du moteur était bon (alléger le vendredi pour tenir Q17), son exécution absurde.
export function reculerHeuresOuvrees(finAbs, duree, weekDays, plage = PLAGE_STD) {
  let reste = duree;
  let cur = finAbs;
  // Borne de sécurité : une approche ne recule jamais de plus de quelques jours ouvrés.
  for (let garde = 0; garde < 500 && reste > 1e-9; garde++) {
    const { day, h } = fromAbs(cur);
    if (day < 0) return toAbs(0, plageAt(plage, 0, weekDays).debut);
    const p = plageAt(plage, day, weekDays);
    // Hors journée ouvrée (ou jour chômé) : sauter à la fin de la journée ouvrée précédente.
    if (h <= p.debut || isWeekend(day, weekDays)) {
      let prev = day - 1;
      for (let g2 = 0; g2 < 5 && prev >= 0 && isWeekend(prev, weekDays); g2++) prev -= 1;
      if (prev < 0) return toAbs(0, plageAt(plage, 0, weekDays).debut);
      cur = toAbs(prev, plageAt(plage, prev, weekDays).fin);
      continue;
    }
    if (h > p.fin) { cur = toAbs(day, p.fin); continue; }
    // Heures ouvrées disponibles en remontant dans la journée courante.
    const prend = Math.min(h - p.debut, reste);
    cur -= prend;
    reste -= prend;
  }
  return cur;
}

// Schedule a block of `duration` hours starting at absolute hour `cursor`.
// weekDays optionnel : si fourni, les weekends sont sautés.
// RÈGLE VENDREDI : la route vide doit finir avant DAY_END du vendredi.
// Returns { startAbs, endAbs }
export function scheduleBlock(cursor, duration, weekDays, plage = PLAGE_STD) {
  let absStart = snapToWorkingHours(cursor, weekDays, plage);
  let { day, h } = fromAbs(absStart);
  let remaining = duration;
  const startAbs = toAbs(day, h);
  let endAbs = startAbs;
  while (remaining > 0) {
    const { day: d, h: hr } = fromAbs(endAbs);
    const availToday = plageAt(plage, d, weekDays).fin - hr;
    if (availToday <= 0) {
      // Fin de journée → passer au lendemain matin en sautant les weekends
      const nextDay = toAbs(d + 1, plageAt(plage, d + 1, weekDays).debut);
      endAbs = snapToWorkingHours(nextDay, weekDays, plage);
      continue;
    }
    const used = Math.min(remaining, availToday);
    remaining -= used;
    endAbs += used;
  }
  return { startAbs, endAbs };
}

// RÈGLE VENDREDI SOIR (v5) :
// Le PL doit IMPÉRATIVEMENT être au dépôt vendredi avant DAY_END.
// Cette règle s'applique à tout bloc route (trs/vid/app/repo), peu importe le jour de départ :
// si le bloc finit après vendredi DAY_END (de la même semaine ouvrée), on décale TOUT le bloc
// au lundi matin suivant. Le chg/liv peut rester son jour, seuls les blocs route bougent.
// Retourne { cursor: nouveau curseur snappé si décalage, decale: bool }
// Trouve l'index dans weekDays du vendredi de la même semaine que dayIdx.
// Si dayIdx est déjà un vendredi, retourne dayIdx. Retourne -1 si introuvable.
// Note : weekDays est indexé en jours ouvrés seulement (pas de weekends), donc on ne peut
// pas calculer simplement `dayIdx + (5 - dow)` comme on le ferait sur un calendrier classique.
export function findFridayIdx(dayIdx, weekDays) {
  for (let i = dayIdx; i < (weekDays?.length || 0); i++) {
    if (dayOfWeek(i, weekDays) === 5) return i;
    if (dayOfWeek(i, weekDays) === -1) break;
  }
  return -1;
}

// Trouve l'index dans weekDays du lundi suivant strictement dayIdx. Retourne -1 si introuvable.
export function findNextMondayIdx(dayIdx, weekDays) {
  for (let i = dayIdx + 1; i < (weekDays?.length || 0); i++) {
    if (dayOfWeek(i, weekDays) === 1) return i;
    if (dayOfWeek(i, weekDays) === -1) break;
  }
  return -1;
}

export function enforceFridayRule(cursor, duration, weekDays) {
  const { day } = fromAbs(cursor);
  const dow = dayOfWeek(day, weekDays);
  if (dow < 1 || dow > 5) return { cursor, decale: false }; // hors lun-ven : pas applicable directement
  // Trouver le vendredi de la semaine du cursor (via findFridayIdx, robuste aux weekDays sans weekends)
  const fridayDayIdx = findFridayIdx(day, weekDays);
  if (fridayDayIdx < 0) return { cursor, decale: false };
  // Compter les heures dispo entre cursor et vendredi DAY_END (en heures ouvrées)
  let availableH = 0;
  let probeDay = day;
  let probeH = fromAbs(cursor).h < DAY_START ? DAY_START : fromAbs(cursor).h;
  while (probeDay <= fridayDayIdx) {
    const probeDow = dayOfWeek(probeDay, weekDays);
    if (probeDow >= 1 && probeDow <= 5) {
      availableH += Math.max(0, DAY_END - probeH);
    }
    probeDay += 1;
    probeH = DAY_START;
  }
  if (duration <= availableH) return { cursor, decale: false };
  // Pas assez d'heures avant vendredi DAY_END → décaler au lundi suivant
  const lundiIdx = findNextMondayIdx(fridayDayIdx, weekDays);
  if (lundiIdx < 0) return { cursor, decale: false }; // lundi hors fenêtre → pas de décalage possible
  const lundiCursor = snapToWorkingHours(toAbs(lundiIdx, DAY_START), weekDays);
  return { cursor: lundiCursor, decale: true };
}

// Variante de enforceFridayRule pour les blocs TRS (trajet chargement → livraison).
// Règle métier : le PL ne peut pas se retrouver loin du dépôt pendant un weekend.
// Scénarios :
//  - trs + op suivante tiennent avant vendredi DAY_END → pas de décalage
//  - trs tient avant vendredi mais op suivante est la semaine suivante → DÉCALER trs au lundi
//    (sinon PL passe le weekend chez le client, marchandise chargée)
//  - trs ne tient pas avant vendredi DAY_END → DÉCALER au lundi (cohérent avec enforceFridayRule standard)
// Paramètres :
//  - cursor : curseur temporel absolu (heure de début du trs)
//  - trsDuration : durée du trs en heures
//  - nextOpDuration : durée de l'op suivante (chg ou liv selon contexte) en heures
//  - nextOpDate : date ISO de l'op suivante (dateC ou dateL)
//  - weekDays : array des jours ouvrés de la fenêtre planning (SANS les weekends)
// Retourne { cursor: potentiellement décalé au lundi suivant, decale: bool }
export function enforceFridayRuleRoute(cursor, trsDuration, nextOpDuration, nextOpDate, weekDays) {
  const { day } = fromAbs(cursor);
  const dow = dayOfWeek(day, weekDays);
  if (dow < 1 || dow > 5) return { cursor, decale: false };

  const fridayDayIdx = findFridayIdx(day, weekDays);
  if (fridayDayIdx < 0) return { cursor, decale: false };
  const nextOpDayIdx = weekDays.indexOf(nextOpDate);

  // Cas 1 : op suivante hors fenêtre planning.
  //  - hors fenêtre EN AVANT (date au-delà du dernier jour de l'axe) : c'est forcément
  //    « la semaine suivante ou plus tard » → appliquer directement le cas 3 (décalage lundi),
  //    sinon le PL partirait en fin de semaine et passerait le weekend loin du dépôt.
  //  - sinon (date absente/passée) : fallback sur enforceFridayRule standard (durée du trs seule).
  if (nextOpDayIdx < 0) {
    const lastAxisDate = weekDays[weekDays.length - 1];
    if (nextOpDate && lastAxisDate && nextOpDate > lastAxisDate) {
      const lundiIdx0 = findNextMondayIdx(fridayDayIdx, weekDays);
      if (lundiIdx0 < 0) return { cursor, decale: false };
      return { cursor: snapToWorkingHours(toAbs(lundiIdx0, DAY_START), weekDays), decale: true };
    }
    return enforceFridayRule(cursor, trsDuration, weekDays);
  }

  // Cas 2 : op suivante dans la même semaine ouvrée que le cursor (lun-ven courante)
  //   → vérifier que trs + op tiennent avant vendredi DAY_END
  if (nextOpDayIdx <= fridayDayIdx) {
    let availableH = 0;
    let probeDay = day;
    let probeH = fromAbs(cursor).h < DAY_START ? DAY_START : fromAbs(cursor).h;
    while (probeDay <= fridayDayIdx) {
      const probeDow = dayOfWeek(probeDay, weekDays);
      if (probeDow >= 1 && probeDow <= 5) {
        availableH += Math.max(0, DAY_END - probeH);
      }
      probeDay += 1;
      probeH = DAY_START;
    }
    if (trsDuration + nextOpDuration <= availableH) {
      return { cursor, decale: false };
    }
    // Pas assez de temps → décaler au lundi suivant
    const lundiIdx = findNextMondayIdx(fridayDayIdx, weekDays);
    if (lundiIdx < 0) return { cursor, decale: false };
    const lundiCursor = snapToWorkingHours(toAbs(lundiIdx, DAY_START), weekDays);
    return { cursor: lundiCursor, decale: true };
  }

  // Cas 3 : op suivante la semaine suivante ou plus tard
  //   → le trs ne doit pas commencer dans la semaine courante, car il laisserait
  //     le PL loin du dépôt pendant le weekend. Décaler au lundi suivant le vendredi.
  const lundiIdx = findNextMondayIdx(fridayDayIdx, weekDays);
  if (lundiIdx < 0) return { cursor, decale: false };
  const lundiCursor = snapToWorkingHours(toAbs(lundiIdx, DAY_START), weekDays);
  return { cursor: lundiCursor, decale: true };
}

// Split an absolute range into per-day visual blocks, en excluant les jours weekend
export function splitByDay(startAbs, endAbs, weekDays, plage = PLAGE_STD) {
  const parts = [];
  let cur = startAbs;
  while (cur < endAbs) {
    const { day, h } = fromAbs(cur);
    const jourSuivant = () => snapToWorkingHours(
      toAbs(day + 1, plageAt(plage, day + 1, weekDays).debut), weekDays, plage);
    // Sauter les weekends dans les parts visuelles
    if (weekDays) {
      const dow = dayOfWeek(day, weekDays);
      if (dow === 6 || dow === 0) {
        cur = jourSuivant();
        continue;
      }
    }
    const finJour = plageAt(plage, day, weekDays).fin;
    const endOfDay = toAbs(day, finJour);
    const segEnd = Math.min(endAbs, endOfDay);
    if (segEnd > cur) {
      // `|| finJour` : un segment qui finit pile à minuit rend h = 0, qu'il faut lire comme la
      // fin de la journée ouvrée et non comme 0h.
      parts.push({ day, hStart: h, hEnd: fromAbs(segEnd).h || finJour });
    }
    cur = segEnd;
    if (cur < endAbs) cur = jourSuivant();
  }
  return parts;
}

export function fmtH(h) { return `${h}h`; }

// buildChainInterne(lot, vehicule, weekDays, opts) — construction « brute » d'une chaîne à
// partir d'un curseur donné. NE PAS APPELER DIRECTEMENT depuis l'extérieur : le point d'entrée
// public est buildChain (plus bas), qui ajoute la garde week-end sur le retour dépôt (Q17).
// opts.startCursorAbs : point de départ temporel (par défaut 7h sur dateC)
// opts.startGps       : point GPS de départ (par défaut dépôt de l'agence). Si fourni et à
//                       plus de `seuilRoute` km du chg, génère un bloc approche depuis ce point.
// opts.skipRetourDepot: true = ne génère PAS le bloc vid final (retour dépôt). Utile pour le
//                       reflow multi-lots : seul le dernier lot de la chaîne retourne au dépôt.
// opts.ignoreDateL    : true = sémantique « livraison au plus tôt » (contexte BOUCLE uniquement :
//                       simulations de findBoucleCandidates). Par défaut (hors boucle), le moteur
//                       RESPECTE dateL : départ route au plus tard, livraison posée le jour demandé.
// opts.waitDateC      : true = le chargement n'est jamais posé AVANT dateC 7h (le curseur attend).
//                       Utilisé par detectBoucles (rechaînage d'un lot B déjà placé, dont la date
//                       de chargement est verrouillée — arbitrage Q15 2026-07-19). Par défaut false :
//                       les simulations de boucle doivent pouvoir charger plus tôt dans la flex.
// opts.rules          : règles métier (RULES_DEFAULTS par défaut) — vitessePL, seuilRoute,
//                       manutRatio, manutMin. Permet à l'admin d'agir sur les placements.
function buildChainInterne(lot, vehicule, weekDays, opts = {}, agencesData = []) {
  // Journée ouvrée applicable. La plage élargie du dossier n'est lue QUE si l'appelant la demande
  // explicitement — c'est-à-dire uniquement à la POSE (`reflowVehicle`). Volontairement inactive dans
  // les simulations de `findBoucleCandidates` et `detectBoucles` : une boucle ne doit jamais être
  // proposée *parce qu'*un dépassement du soir a été autorisé sur un dossier. Même motif que
  // `opts.gardeWeekendRetour`.
  const plage = opts.appliquerPlageLot ? plagesDuLot(lot) : PLAGE_STD;
  // Bornes de la journée, RÉSOLUES PAR DATE (2026-08-03). Toute lecture d'amplitude passe par là :
  // une mission de trois jours dont un seul est élargi ne doit pas voir les deux autres s'étendre.
  const deb = (day) => plageAt(plage, day, weekDays).debut;
  const fin = (day) => plageAt(plage, day, weekDays).fin;
  const heuresUtilesLe = (day) => fin(day) - deb(day);
  const ag = agLookup(vehicule.ag, agencesData);
  if (!ag.cp && !ag.name) return [];
  const rules = opts.rules || RULES_DEFAULTS;
  const vitesse = rules.vitessePL || 70;
  const seuilRoute = rules.seuilRoute ?? 15;
  // Repli quand le lot n'a aucune durée saisie : même abaque que le formulaire
  // (manutRatio PAR ETP, équipe du lot, arrondi ¼J supérieur) — aligné 2026-07-21.
  const manutFallback = (vol, fte) => manutHeures(vol, fte, rules);

  const agGps = gc(ag.cp);
  const cGps = gc(lot.cpC);
  const lGps = gc(lot.cpL);

  const dayC = weekDays.indexOf(lot.dateC);
  const dayL = weekDays.indexOf(lot.dateL);
  if (dayC < 0) return [];
  const maxDay = weekDays.length - 1;

  // RÈGLE LIVRAISON À DATE (arbitrage 2026-06-10) — hors boucle, dateL est RESPECTÉE :
  // le PL part au plus tard pour livrer le jour demandé (juste-à-temps, PL au dépôt entre-temps).
  // En boucle (opts.ignoreDateL), on optimise : livraison au plus tôt dans la fenêtre.
  // B2 fix conservé : dateL absente → same-day (la livraison suit la route immédiatement).
  const respectDateL = !opts.ignoreDateL && !!lot.dateL;
  // Cible de livraison : index de dateL dans l'axe, ou maxDay+1 si dateL est au-delà de l'axe
  // (→ le bloc liv sortira en marqueur overflow « sem. suiv. » au lieu d'être avancé).
  const lastAxisDate = weekDays[maxDay];
  const livTargetDay = !respectDateL ? null
    : dayL >= 0 ? dayL
    : (lastAxisDate && lot.dateL > lastAxisDate) ? maxDay + 1
    : null; // dateL passée / hors axe en arrière : on livre au plus tôt (le warning signalera le retard)

  // Origine (GPS) du trajet d'approche : dépôt par défaut, ou point transmis pour reflow
  const startGps = opts.startGps || agGps;
  const kmApproche = hav(startGps, cGps);
  const kmRetour = hav(lGps, agGps);

  // POINTS DE PASSAGE (2026-07-28) — chaque bloc de route porte désormais son origine et sa
  // destination. Jusqu'ici ces repères n'étaient que des variables locales, consommées puis
  // jetées : un bloc « Route » sur le Gantt était anonyme (label vide), impossible de savoir
  // d'où à où sans rejouer toute la chaîne. Ils alimentent le clic sur un bloc route et
  // l'affichage du parcours d'une boucle.
  const ptDepot = { label: `Dépôt ${ag.name || ag.cp || ""}`.trim(), cp: ag.cp, gps: agGps };
  const ptChg = { label: lot.vC || lot.cpC || "Chargement", cp: lot.cpC, gps: cGps, lotId: lot.id, etape: "chg" };
  const ptLiv = { label: lot.vL || lot.cpL || "Livraison", cp: lot.cpL, gps: lGps, lotId: lot.id, etape: "liv" };
  // Le point de départ de l'approche n'est le dépôt que si aucun autre n'a été transmis.
  // `opts.startPoint` est fourni par le reflow (livraison du lot précédent) : sans lui, on sait
  // seulement que ce n'est pas le dépôt, d'où le libellé générique.
  const ptDepart = startGps === agGps
    ? ptDepot
    : (opts.startPoint || { label: "Chantier précédent", gps: startGps });

  const parseDurFn = parseDur;

  let uid = 0;
  const mkId = () => `${lot.id}-${vehicule.id}-${++uid}`;

  // Start cursor : soit fourni (reflow), soit 7h sur dateC
  let cursor = opts.startCursorAbs !== undefined
    ? opts.startCursorAbs
    : toAbs(dayC, deb(dayC));
  const allBlocks = [];

  // Helper: schedule a logical block → produce one or more visual blocks.
  // Si respectFriday=true (blocs route uniquement), on applique enforceFridayRule :
  // si le bloc ne rentre pas dans le vendredi, on avance le cursor au lundi matin.
  function addBlock(type, label, durationH, km, vol, extra, respectFriday = false) {
    if (respectFriday) {
      const { cursor: newCursor, decale } = enforceFridayRule(cursor, durationH, weekDays);
      if (decale) cursor = newCursor;
    }
    const { startAbs, endAbs } = scheduleBlock(cursor, durationH, weekDays, plage);
    const parts = splitByDay(startAbs, endAbs, weekDays, plage);
    const isMultiPart = parts.length > 1;

    parts.forEach((p, pi) => {
      // B1 fix: ne pas simplement ignorer les parts hors fenêtre pour chg/liv.
      // Pour les blocs opérationnels (chg/liv), si toutes les parts sont hors fenêtre,
      // on génère un bloc marqueur sur le dernier jour visible pour éviter le chargement sans livraison.
      // Pour les blocs de route (trs/app/vid/repo), on ignore silencieusement.
      const isOp = type === "chg" || type === "liv";
      if (p.day < 0 || p.day > maxDay) {
        // Si c'est la dernière part d'un bloc op et aucun part visible n'a encore été ajouté → marqueur
        if (isOp && pi === parts.length - 1) {
          const alreadyAdded = allBlocks.some(b => b._srcBlock === `${type}-${label}` && !b._overflow);
          if (!alreadyAdded) {
            // Aucune part visible → afficher indicateur sur dernier jour visible
            allBlocks.push({
              id: mkId(), type, day: maxDay, date: weekDays[maxDay] || "", lotId: lot.id, plId: vehicule.id,
              label: `${label} (sem. suiv.)`,
              pills: ["→ sem. suiv."],
              km: 0, vol: isOp ? vol : 0, duration: 1,
              startH: fin(maxDay) - 1, endH: fin(maxDay),
              startAbs, endAbs,
              chantier: isOp ? lot.id : undefined,
              _overflow: true,
              _segment: undefined,
              ...extra,
            });
          }
        }
        return;
      }
      const partDur = p.hEnd - p.hStart;
      const partKm = isMultiPart ? Math.round(km * partDur / durationH) : km;
      const timeLabel = `${fmtH(p.hStart)}-${fmtH(p.hEnd)}`;
      const pills = [];
      if (km > 0) pills.push(`${isMultiPart ? partKm : km}km`);
      if (vol > 0 && (type === "chg" || type === "liv")) {
        pills.push(`${vol}m³`);
      }
      pills.push(timeLabel);
      if (isMultiPart) pills.push(`${pi + 1}/${parts.length}`);

      const partLabel = isMultiPart && label
        ? (pi === 0 ? `${label} →` : pi === parts.length - 1 ? `→ ${label.split("→").pop() || label}` : `${label} (suite)`)
        : label;

      allBlocks.push({
        id: mkId(), type, day: p.day, date: weekDays[p.day] || "", lotId: lot.id, plId: vehicule.id,
        label: partLabel, pills,
        km: isMultiPart ? partKm : km,
        vol: (type === "chg" || type === "liv") ? vol : 0,
        duration: partDur,
        startH: p.hStart, endH: p.hEnd,
        ...(horsPlageStandard(p.hStart, p.hEnd) ? { _horsPlageStd: true } : {}),
        startAbs, endAbs,
        chantier: (type === "chg" || type === "liv") ? lot.id : undefined,
        _srcBlock: `${type}-${label}`,
        _segment: isMultiPart ? { part: pi, total: parts.length } : undefined,
        ...extra,
      });
    });

    cursor = endAbs;
  }

  // Durée du chargement — calculée AVANT l'approche : la règle vendredi de l'approche
  // (ci-dessous) a besoin de savoir si le chargement tient encore avant la coupure.
  const durC = parseDurFn(lot.dureC) || manutFallback(lot.vol, lot.fteC);

  // 1. Approche OU repositionnement
  // Si startGps = dépôt → bloc "app" (approche depuis dépôt)
  // Si startGps = livraison d'un lot précédent → bloc "repo" (repositionnement inter-lots)
  //    — ce cas arrive pendant un reflow multi-lots
  // RÈGLE VENDREDI APPROCHE (Q17, arbitrage Louis 2026-07-21 : un PL n'est JAMAIS loin de son
  // dépôt le week-end) : l'approche ne doit pas partir si le chargement qui la suit ne tient plus
  // avant vendredi DAY_END — sinon le PL arrive chez le client le vendredi soir et y passe le
  // week-end, à vide mais loin de sa base (et le conducteur loin de chez lui).
  // Même primitive que pour la route (enforceFridayRuleRoute) : approche + chargement doivent
  // tenir avant la coupure, sinon l'approche est décalée au lundi.
  if (kmApproche > seuilRoute) {
    const durApp = Math.max(1, Math.ceil(kmApproche / vitesse));
    const isFromDepot = startGps === agGps;
    const { cursor: appCursor, decale: appDecale } = enforceFridayRuleRoute(
      cursor, durApp, durC, lot.dateC, weekDays
    );
    if (appDecale) {
      debug.inc("friday_decalages_approche");
      debug.log("BUILDCHAIN", `  ${lot.id} APPROCHE décalée au lundi (règle vendredi Q17) · ${fromAbs(cursor).day}/${fromAbs(cursor).h}h → ${fromAbs(appCursor).day}/${fromAbs(appCursor).h}h`);
      cursor = appCursor;
    }
    // respectFriday=false : la règle vendredi vient d'être appliquée ci-dessus.
    addBlock(isFromDepot ? "app" : "repo", ``, durApp, kmApproche, 0,
      { _from: ptDepart, _to: ptChg }, false);
  }

  // 2. Chargement — on dateC
  // opts.waitDateC : le chargement d'un lot déjà placé (rechaînage boucle) ne peut pas être
  // avancé avant sa date négociée — le curseur attend dateC 7h (arbitrage Q15 2026-07-19 :
  // les dates de chargement sont verrouillées à la vente).
  if (opts.waitDateC && dayC >= 0) {
    const dateCStart = toAbs(dayC, deb(dayC));
    if (cursor < dateCStart) cursor = dateCStart;
  }
  // lockStatus sur les blocs : uniquement "locked" | undefined (plus de "pending"/"callback")
  // Source de vérité = statut canonique du lot
  const lockStatus = isLotLocked(lot) ? "locked" : undefined;
  const flagsC = lot.transboC || lot.gardeMeublesC || lot.monteMeubleC || lot.objetsLourds?.length > 0 || lot.railRoute || lockStatus ? {
    _lotFlags: { transbo: lot.transboC, gardeMeubles: lot.gardeMeublesC, ...(lot.monteMeubleC ? { monteMeuble: true } : {}), objetsLourds: lot.objetsLourds?.length > 0, railRoute: lot.railRoute, lockStatus }
  } : {};
  // RÈGLE CHARGEMENT MÊME JOUR : un chargement qui tient en une journée (durC ≤ heures utiles)
  // ne doit pas DÉMARRER s'il ne peut pas se TERMINER avant DAY_END le jour même — on ne lance
  // pas un chargement qu'on ne finit pas dans la journée. On le décale au matin ouvré suivant.
  // (Les chargements intrinsèquement multi-jours, durC > heures utiles, s'étalent normalement.)
  // Cas concret boucle retour : si la livraison de B finit à 15h (reste 3h) et le chargement de A
  // dure 3h, 3h n'est PAS inférieur aux 3h restantes → A charge le lendemain matin.
  {
    // « Tient en une journée » et « il reste assez de temps » s'apprécient sur LA journée où le
    // chargement démarrerait, pas sur une amplitude moyenne du dossier.
    const snapped = snapToWorkingHours(cursor, weekDays, plage);
    const { day: snapDay, h: snapH } = fromAbs(snapped);
    if (durC <= heuresUtilesLe(snapDay) && fin(snapDay) - snapH <= durC) {
      cursor = snapToWorkingHours(toAbs(snapDay + 1, deb(snapDay + 1)), weekDays, plage);
    }
  }
  // Warning « Chargement décalé » (audit 2026-07-19, B6) : si la chaîne amont déborde et que le
  // chargement démarre APRÈS la date promise au client, le signaler — symétrique du warning
  // « Arrivée tardive » qui n'existait que pour les livraisons. Comparaison en dates ISO.
  {
    const chgStartDay = fromAbs(snapToWorkingHours(cursor, weekDays, plage)).day;
    const chgDate = weekDays[chgStartDay];
    if (lot.dateC && chgDate && chgDate > lot.dateC) {
      flagsC._warning = "Chargement décalé — après la date demandée";
    }
    // SORTIE DE LA FENÊTRE DE FLEX (Lot 3, 2026-08-18) — signal DISTINCT du précédent, et plus
    // grave. Le décalage ci-dessus dit « ce n'est plus la date demandée », ce qui est bénin : la
    // souplesse existe pour ça. Celui-ci dit « on a dépassé la souplesse ACCORDÉE par le client » —
    // la promesse commerciale est rompue, quelqu'un doit le rappeler.
    //
    // Le cas visé par l'arbitrage : une mutualisation est annulée, l'accroche retour greffée
    // derrière SURVIT (c'est la règle), mais sa date glisse. Tant qu'elle reste dans la fenêtre,
    // rien à dire. Dès qu'elle en sort, il faut alerter. Le contrôle est ici, dans le poseur, et non
    // dans le geste d'annulation : ainsi il couvre TOUS les chemins qui déplacent un chargement —
    // annulation, repose, glisser-déposer — et pas seulement celui auquel on aura pensé.
    //
    // La fenêtre est ancrée sur la date SOUHAITÉE du client, jamais sur la date planifiée : cf.
    // `alerteSortieDeFlexChg`, qui porte aussi la garde anti-bruit (souplesse nulle ⇒ pas d'alerte).
    const alerteFlex = alerteSortieDeFlexChg(lot, chgDate);
    if (alerteFlex) flagsC._warningFlex = alerteFlex;
  }
  addBlock("chg", `${lot.cli} · ${lot.vC} (${(lot.cpC || "").slice(0, 2)})`, durC, 0, lot.vol, { _at: ptChg, ...flagsC });

  // 2 bis. COUPURE AU DÉPÔT APRÈS CHARGEMENT (arbitrage Louis 2026-07-22)
  // Pratique courante en déménagement : quand la tournée complète ne peut pas se terminer avant la
  // coupure du vendredi, on ne décale PAS le chargement — sa date est promise au client. Le PL rentre
  // CHARGÉ au dépôt, y passe le week-end (Q17 respecté : il est à sa base), et la route + la livraison
  // repartent le lundi. Conséquence physique : le trajet vers la livraison part alors DU DÉPÔT et non
  // du lieu de chargement — d'où le calcul de kmRoute ci-dessous, après la coupure.
  // Opt-in : c'est buildChain qui décide, en essayant ce remède AVANT le décalage global au lundi.
  let routeFromGps = cGps;
  // Point de DÉPART AFFICHÉ de la route (parcours de boucle) — distinct de `routeFromGps`, qui sert
  // au calcul des km. Les deux ne coïncident pas quand le chargement est à portée du dépôt (≤
  // seuilRoute) : la coupure est alors créditée sans qu'aucun trajet soit roulé, le camion ne
  // *revient* pas au dépôt puisqu'il n'en est jamais vraiment parti. Annoncer « la route part du
  // dépôt » serait faux pour le planificateur : elle part de chez le client. On garde le calcul des
  // km au dépôt (écart ≤ seuilRoute, soit 15 km sur des routes de plusieurs centaines) et on
  // affiche le lieu réel.
  let ptRouteDepart = ptChg;
  if (opts.coupureDepotApresChg) {
    const lundiIdx = findNextMondayIdx(fromAbs(cursor).day, weekDays);
    if (lundiIdx < 0) return []; // pas de lundi dans l'axe → coupure impossible
    const kmRentree = hav(cGps, agGps);
    if (kmRentree > seuilRoute) {
      const durRentree = Math.max(1, Math.ceil(kmRentree / vitesse));
      addBlock("vid", ``, durRentree, kmRentree, 0,
        { _weekendDepot: true, _from: ptChg, _to: ptDepot }, false);
      ptRouteDepart = ptDepot; // rentrée réellement roulée : la route repart bien du dépôt
    } else {
      // Chargement à portée du dépôt (≤ seuilRoute) : aucun trajet retour à dessiner, le PL est
      // déjà à sa base après le chargement. On marque tout de même le dernier bloc (le chargement)
      // comme retour dépôt pour que la garde week-end (chaineTraverseWeekend) crédite la coupure —
      // sinon elle croit le PL resté loin de sa base et rejette ce remède, se rabattant sur le
      // décalage complet au lundi qui casse la date client (cas CHT-735480 : chargement Les Angles
      // à ~7 km du dépôt Avignon → coupure valide mais invisible faute de bloc vid).
      const lastBlock = allBlocks[allBlocks.length - 1];
      if (lastBlock) lastBlock._weekendDepot = true;
    }
    // Le PL repart du dépôt le lundi — mais PAS avant d'y être arrivé : un retour qui déborde sur
    // le lundi doit pousser le curseur jusqu'à son heure d'arrivée réelle, sinon la route suivante
    // est posée en parallèle du retour (deux blocs simultanés sur le même camion).
    cursor = Math.max(toAbs(lundiIdx, deb(lundiIdx)), cursor);
    routeFromGps = agGps;
  }
  const kmRoute = hav(routeFromGps, lGps);

  // 3. Route
  // RÈGLE LIVRAISON À DATE (arbitrage 2026-06-10) : hors boucle, le PL part AU PLUS TARD pour
  // livrer le jour demandé — on cherche le dernier jour ouvré de départ tel que la route se
  // termine au plus tard à dateL 7h (granularité jour : départ à 7h du jour retenu). Le PL reste
  // au dépôt entre le chargement et le départ (disponible, conforme à la règle vendredi).
  // En boucle (ignoreDateL), la route part dès la fin du chargement (comportement historique).
  // RÈGLE VENDREDI ROUTE (fix v7) : si trs + liv ne tiennent pas dans la même semaine,
  // décaler trs au lundi suivant pour que le PL reste au dépôt de son agence pendant le weekend.
  if (kmRoute > seuilRoute) {
    const durRoute = Math.max(1, Math.ceil(kmRoute / vitesse));
    if (livTargetDay !== null) {
      let lateCursor = cursor;
      const firstDay = fromAbs(snapToWorkingHours(cursor, weekDays, plage)).day;
      for (let d = firstDay; d <= Math.min(livTargetDay, maxDay); d++) {
        if (isWeekend(d, weekDays)) continue;
        const cand = Math.max(cursor, toAbs(d, deb(d)));
        if (scheduleBlock(cand, durRoute, weekDays, plage).endAbs <= toAbs(livTargetDay, deb(livTargetDay))) {
          lateCursor = cand;
        } else break; // monotone : plus tard ne rentrera pas non plus
      }
      cursor = lateCursor;
    }
    const durLivEstimated = parseDurFn(lot.dureL) || manutFallback(lot.vol, lot.fteL);
    const { cursor: adjustedCursor, decale: trsDecale } = enforceFridayRuleRoute(
      cursor, durRoute, durLivEstimated, lot.dateL, weekDays
    );
    if (trsDecale) {
      debug.inc("friday_decalages_buildchain");
      if (typeof debug !== "undefined" && debug.log) {
        debug.log("BUILDCHAIN", `  ${lot.id} TRS décalé au lundi (règle vendredi) · cursor ${fromAbs(cursor).day}/${fromAbs(cursor).h}h → ${fromAbs(adjustedCursor).day}/${fromAbs(adjustedCursor).h}h`);
      }
      cursor = adjustedCursor;
    }
    // L'alerte « camion chargé immobile » n'est plus calculée ici : elle est DÉRIVÉE de la chaîne
    // finalement retenue, par `marquerInactivite` (appelée depuis `buildChain`). Motif : elle doit
    // voir TOUS les temps morts, y compris ceux qui naissent après ce point (attente entre l'arrivée
    // de la route et la livraison) ou d'un remède week-end appliqué plus tard. Cf. § INACTIVITÉ.
    // respectFriday=false : la règle vendredi-route a déjà été appliquée ci-dessus,
    // inutile de ré-appliquer enforceFridayRule standard par-dessus.
    // La route ne part pas toujours du lieu de chargement : après une coupure dépôt (2 bis)
    // réellement roulée, elle repart du dépôt — d'où `ptRouteDepart`, et non `ptChg` en dur.
    addBlock("trs", ``, durRoute, kmRoute, 0, {
      _from: ptRouteDepart,
      _to: ptLiv,
    }, false);
  }

  // 4. Livraison.
  // Hors boucle : posée le jour demandé (dateL) — le curseur attend dateL 7h si la route arrive
  // avant. Si dateL est au-delà de l'axe, livTargetDay = maxDay+1 → addBlock génère le marqueur
  // overflow « (sem. suiv.) » au lieu d'avancer la livraison sur la semaine courante.
  // En boucle (ignoreDateL) ou sans dateL : dès la fin de la route (au plus tôt).
  const durL = parseDurFn(lot.dureL) || manutFallback(lot.vol, lot.fteL);
  if (livTargetDay !== null) {
    const livTargetAbs = toAbs(livTargetDay, deb(livTargetDay));
    if (cursor < livTargetAbs) cursor = livTargetAbs;
  }

  // Warning si la livraison tombe APRÈS la date demandée (retard vs promesse client).
  // Comparaison en dates ISO — plus de repli sur dayC quand dateL est hors de l'axe affiché
  // (l'ancien repli produisait un faux « Arrivée tardive » sur des livraisons en réalité avancées).
  let _warning;
  if (!opts.ignoreDateL && lot.dateL) {
    const livStartDay = fromAbs(snapToWorkingHours(cursor, weekDays, plage)).day;
    const livDate = weekDays[livStartDay];
    if (livDate && livDate > lot.dateL) _warning = "Arrivée tardive — livraison après la date demandée";
  }
  const flagsL = lot.transboL || lot.gardeMeublesL || lot.monteMeubleL || lot.objetsLourds?.length > 0 || lot.railRoute || lockStatus ? {
    _lotFlags: { transbo: lot.transboL, gardeMeubles: lot.gardeMeublesL, ...(lot.monteMeubleL ? { monteMeuble: true } : {}), objetsLourds: lot.objetsLourds?.length > 0, railRoute: lot.railRoute, lockStatus }
  } : {};
  addBlock("liv", `${lot.cli} · ${lot.vL} (${(lot.cpL || "").slice(0, 2)})`, durL, 0, lot.vol, { _at: ptLiv, _warning, ...flagsL });

  // 5. Route vide — sauf si reflow avec lot suivant sur le même PL (opts.skipRetourDepot).
  // RÈGLE VENDREDI (v5) : le PL doit être rentré au dépôt le vendredi soir (DAY_END).
  // Si le retour ne tient pas dans le vendredi, enforceFridayRule le décale automatiquement au lundi.
  // Le chg/liv peut rester vendredi, mais le retour vide est repoussé au lundi matin.
  if (!opts.skipRetourDepot && kmRetour > seuilRoute) {
    const durRet = Math.max(1, Math.ceil(kmRetour / vitesse));
    addBlock("vid", ``, durRet, kmRetour, 0, { _from: ptLiv, _to: ptDepot }, true);
  }

  return allBlocks;
}

// RÈGLE WEEK-END RETOUR (Q17 étendu au retour dépôt — arbitrage Louis 2026-07-22)
// ─────────────────────────────────────────────────────────────────────────────
// Q17 dit : « un PL ne reste JAMAIS loin de son dépôt pendant un week-end. » Jusqu'ici la règle
// était appliquée en amont (approche, route) via enforceFridayRuleRoute, mais JAMAIS au retour :
// enforceFridayRule sait seulement DÉCALER le retour au lundi quand il ne tient pas avant
// vendredi DAY_END — ce qui produit exactement la situation interdite (cas réel CHT-974192 :
// livraison Finistère vendredi 9h, retour de 19h → PL immobilisé le week-end à 1 260 km de sa base).
// La garde ci-dessous raisonne par SEGMENTS dépôt → dépôt : une chaîne peut désormais rentrer au
// dépôt en cours de route (coupure après chargement, cf. buildChain), et un week-end passé AU DÉPÔT
// est légitime. On découpe donc la chaîne à chaque retour dépôt ("vid") et on ne signale que les
// segments pendant lesquels un vendredi s'intercale AVANT que le PL ne soit rentré.
// Retourne true dès qu'un segment traverse un week-end hors dépôt.
export function chaineTraverseWeekend(blocks, weekDays) {
  const poses = (blocks || []).filter(b => !b._overflow && b.day >= 0)
    .slice().sort((a, b) => a.day - b.day || a.startH - b.startH);
  if (!poses.length) return false;
  // On découpe la chaîne à chaque retour dépôt ("vid"/_weekendDepot) et on contrôle chaque segment.
  // Un segment de queue laissé ouvert (aucun retour final — cas skipRetourDepot, maillon enchaîné)
  // est LUI AUSSI contrôlé (cf. après la boucle) : un maillon qui charge le vendredi et repart le
  // lundi passe un week-end hors dépôt à l'intérieur de sa propre chaîne, même s'il enchaîne ensuite.
  let debutSegment = null;
  for (const b of poses) {
    if (debutSegment === null) debutSegment = b.day;
    // Un bloc "vid" = retour dépôt dessiné ; un bloc marqué _weekendDepot sans trajet (chargement
    // à portée du dépôt sous coupure) vaut aussi retour dépôt — sinon une coupure pourtant valide
    // serait rejetée dès que le lieu de chargement jouxte la base (cf. buildChain / buildMutuChain).
    if (b.type !== "vid" && !b._weekendDepot) continue;
    // Le segment se clôt le jour où le PL ARRIVE au dépôt — pas le jour où il prend la route pour y
    // aller. Un retour long (> 1 journée) est découpé en plusieurs blocs `vid` par splitByDay : se
    // fier au `day` du PREMIER morceau faisait croire le PL rentré dès le vendredi alors qu'il était
    // encore à des centaines de km le samedi, et validait donc une coupure qui viole Q17
    // (cas CHT-092958 : retour Rennes → 83500 vendredi 12h → lundi 16h, compté comme rentré vendredi).
    // `endAbs` porte la fin du bloc ENTIER (identique sur tous ses morceaux) → jour d'arrivée réel.
    const jourArrivee = b.endAbs !== undefined ? fromAbs(b.endAbs).day : b.day;
    const vendrediIdx = findFridayIdx(debutSegment, weekDays);
    if (vendrediIdx >= 0 && vendrediIdx < jourArrivee) return true;
    debutSegment = null; // PL rentré au dépôt : nouveau segment à partir du bloc suivant
  }
  // Segment de queue ouvert (pas de retour dépôt final) : un vendredi STRICTEMENT avant le dernier
  // bloc du segment = le PL a passé un week-end hors dépôt dans sa propre chaîne (chargement vendredi
  // / route lundi). Le comparateur strict (<) laisse passer une mission qui se termine LE vendredi
  // (aucun week-end encore franchi) pour ne pas signaler à tort une tournée bouclée dans la semaine.
  if (debutSegment !== null) {
    const lastDay = poses[poses.length - 1].day;
    const vendrediIdx = findFridayIdx(debutSegment, weekDays);
    if (vendrediIdx >= 0 && vendrediIdx < lastDay) return true;
  }
  return false;
}

// ── NUITS HORS DÉPÔT EN SEMAINE (arbitrage Louis 2026-07-29) ────────────────────────────────
// Fonction SŒUR de `chaineTraverseWeekend` : même découpage de la chaîne en segments dépôt → dépôt,
// mais on compte cette fois les nuits de SEMAINE passées loin de la base avant le retour.
//
// ⚠️ Ce n'est PAS une contrainte, contrairement à Q17 sur le week-end. Une nuit dehors en semaine
// est parfaitement légitime sur les longues distances (Rennes → Marseille ne rentre pas dans la
// journée). C'est un SIGNAL : le planificateur juge, et dispose d'un levier (ETP et durées de
// manutention) pour tenter de faire rentrer le camion le soir même. Rien n'est jamais bloqué.
//
// Une « nuit de semaine » = le passage d'un jour ouvré au jour ouvré suivant (lun→mar … jeu→ven).
// Le passage vendredi→lundi n'est jamais compté : c'est le domaine de Q17, qui l'interdit déjà.
//
// Nuits ouvrées franchies entre deux index de jour (bornes incluses côté départ).
// Le test porte sur les DATES et non sur les index : l'axe de calcul peut contenir les
// week-ends (fenêtre Gantt) ou les sauter (axe ouvré window-independent). Dans les deux cas,
// une nuit n'est comptée que si les deux jours sont ouvrés ET qu'aucun week-end ne les sépare —
// la coupure du vendredi au lundi relève de Q17, pas de ce signal.
export function nuitsOuvreesEntre(d1, d2, weekDays) {
  let n = 0;
  for (let d = d1; d < d2; d++) {
    if (isWeekend(d, weekDays) || isWeekend(d + 1, weekDays)) continue;
    const a = weekDays?.[d], b = weekDays?.[d + 1];
    if (a && b && hasWeekendBetween(a, b)) continue;
    n++;
  }
  return n;
}

// Retourne la liste des segments concernés :
//   [{ debutJour, finJour, nuits, blocId, dateDebut, dateFin }]
export function nuitsHorsDepot(blocks, weekDays) {
  const poses = (blocks || []).filter(b => !b._overflow && b.day >= 0)
    .slice().sort((a, b) => a.day - b.day || a.startH - b.startH);
  if (!poses.length) return [];

  const nuitsEntre = (d1, d2) => nuitsOuvreesEntre(d1, d2, weekDays);

  const segments = [];
  let debut = null;       // index de jour du premier bloc du segment
  let blocDebut = null;   // ce bloc, pour y accrocher le signal
  for (const b of poses) {
    if (debut === null) { debut = b.day; blocDebut = b; }
    // Même convention que chaineTraverseWeekend : un bloc "vid" (ou marqué _weekendDepot) clôt le
    // segment, et c'est le jour d'ARRIVÉE au dépôt qui compte (`endAbs`), pas celui du départ.
    // `_nuitDepot` (cf. marquerNuitsAuDepot) clôt lui aussi le segment : le PL a bien passé la
    // nuit à sa base, même si aucun trajet n'a été dessiné. Volontairement ABSENT de
    // `chaineTraverseWeekend` : Q17 garde ses propres remèdes, on ne l'assouplit pas par ce biais.
    if (b.type !== "vid" && !b._weekendDepot && !b._nuitDepot) continue;
    const jourArrivee = b.endAbs !== undefined ? fromAbs(b.endAbs).day : b.day;
    const nuits = nuitsEntre(debut, jourArrivee);
    if (nuits > 0) segments.push({ debutJour: debut, finJour: jourArrivee, nuits, blocId: blocDebut.id, dateDebut: weekDays[debut] || "", dateFin: weekDays[jourArrivee] || "" });
    debut = null; blocDebut = null;
  }
  // Segment de queue (pas de retour dépôt dessiné : maillon enchaîné vers le chantier suivant).
  // On le compte jusqu'à son dernier bloc — le camion est bien resté dehors ces nuits-là.
  if (debut !== null) {
    const dernier = poses[poses.length - 1];
    const finJour = dernier.endAbs !== undefined ? fromAbs(dernier.endAbs).day : dernier.day;
    const nuits = nuitsEntre(debut, finJour);
    if (nuits > 0) segments.push({ debutJour: debut, finJour, nuits, blocId: blocDebut.id, dateDebut: weekDays[debut] || "", dateFin: weekDays[finJour] || "" });
  }
  return segments;
}

// ── NUIT AU DÉPÔT QUAND LE PL EST À PORTÉE (arbitrage Louis 2026-08-19, diag CHT-774981) ───────
//
// La règle « à pied d'œuvre » (`seuilResterSurPlaceKm`, cf. `boucleEngine.resteSurPlacePourLeSuivant`)
// ne jouait qu'ENTRE deux chantiers, jamais À L'INTÉRIEUR d'une chaîne. Un PL qui terminait sa route
// à 17h à 9 km de sa base y dormait donc dehors, et le signal « nuit hors dépôt » le comptait comme
// tel — cas fondateur CHT-774981 : arrivée Nantes (44000) le 19/08 à 17h, livraison le 20/08 à 7h,
// dépôt (44800) à 9 km. Le planificateur, lui, fait évidemment rentrer le camion.
//
// PORTÉE : TOUTES les nuits d'inactivité de la chaîne — approche→chargement, chargement→départ de
// la route (attente « juste-à-temps »), arrivée de la route→livraison, livraison→retour.
// Une nuit passée AU MILIEU d'un trajet n'en est pas une : le camion roule encore. D'où le
// raisonnement sur les blocs LOGIQUES (un trajet long est éclaté en morceaux par `splitByDay`,
// qui partagent `startAbs`/`endAbs`), jamais sur leurs morceaux.
//
// MODÉLISATION — arbitrage « km comptés, aucun bloc décalé » : le trajet du soir et celui du matin
// se font HORS plage de travail, ce qui est la réalité d'un équipage qui rentre chez lui. On ne
// crée donc aucun bloc et on ne touche à aucun horaire : la nuit est CRÉDITÉE au dépôt (`_nuitDepot`)
// et les km de l'aller-retour sont portés par le bloc qui clôt la journée, pour que la tournée ne
// les sous-estime pas (cf. `kmNuitsAuDepot`, consommé par le KPI). Conséquence VOULUE : aucune date
// ne peut bouger, donc la garde « jamais pire » n'a rien à arbitrer et Q17 est hors d'atteinte.
//
// Référentiel GPS incomplet ⇒ on ne crédite rien : dans le doute le camion est réputé dehors, le
// même choix prudent que `resteSurPlacePourLeSuivant`.
export function marquerNuitsAuDepot(blocks, vehicule, weekDays, agencesData = [], rules = RULES_DEFAULTS) {
  const ag = agLookup(vehicule?.ag, agencesData);
  const agGps = gc(ag?.cp);
  if (!agGps) return blocks;
  const seuil = rules?.seuilResterSurPlaceKm ?? 80;

  const poses = (blocks || [])
    .filter(b => !b._overflow && b.day >= 0 && b.startAbs !== undefined && b.endAbs !== undefined)
    .slice().sort((x, y) => x.startAbs - y.startAbs || x.day - y.day || x.startH - y.startH);
  if (poses.length < 2) return blocks;

  // Regroupement en blocs logiques : morceaux consécutifs partageant startAbs/endAbs et type.
  const logiques = [];
  for (const b of poses) {
    const prev = logiques[logiques.length - 1];
    if (prev && prev.startAbs === b.startAbs && prev.endAbs === b.endAbs && prev.type === b.type) prev.parts.push(b);
    else logiques.push({ startAbs: b.startAbs, endAbs: b.endAbs, type: b.type, parts: [b] });
  }

  // Où est le PL à la FIN d'un bloc ? Les trajets portent `_to`, les arrêts portent `_at`.
  const gpsFin = (l) => {
    const dernier = l.parts[l.parts.length - 1];
    return dernier._to?.gps || dernier._at?.gps || null;
  };

  for (let i = 0; i < logiques.length - 1; i++) {
    const cur = logiques[i], next = logiques[i + 1];
    const jourFin = fromAbs(cur.endAbs).day;
    const jourReprise = fromAbs(next.startAbs).day;
    const nuits = nuitsOuvreesEntre(jourFin, jourReprise, weekDays);
    if (nuits <= 0) continue;                      // pas de nuit ouvrée d'inactivité ici
    const pos = gpsFin(cur);
    if (!pos) continue;
    const km = hav(pos, agGps);
    if (km > seuil) continue;                      // trop loin : le camion reste dehors, c'est légitime

    // Le marqueur va sur le bloc qui CLÔT la journée — c'est lui que `nuitsHorsDepot` lit pour
    // fermer le segment, et lui qui porte les km de l'aller-retour.
    const porteur = cur.parts[cur.parts.length - 1];
    const dates = [];
    for (let d = jourFin; d < jourReprise; d++) {
      if (nuitsOuvreesEntre(d, d + 1, weekDays) === 0) continue;
      const iso = weekDays?.[d];
      if (iso) dates.push(iso);
    }
    // Un aller-retour PAR NUIT : trois nuits d'attente, c'est trois fois le trajet.
    porteur._nuitDepot = { km: Math.round(2 * km * nuits), nuits, dates };
    debug.inc("nuits_au_depot");
  }
  return blocks;
}

// Km roulés hors plage pour rentrer dormir au dépôt (cf. marquerNuitsAuDepot). Comptés à part
// parce qu'ils ne sont portés par aucun bloc de trajet : sans ce lecteur, le KPI les perdrait.
export function kmNuitsAuDepot(blocks) {
  return (blocks || []).reduce((s, b) => s + (b._nuitDepot?.km || 0), 0);
}

// AFFICHAGE PAR SOIRÉE (arbitrage Louis 2026-07-31) — remplace `marquerNuitsHorsDepot`, qui posait
// un badge agrégé « X nuits hors dépôt » sur le PREMIER bloc du segment.
//
// Deux raisons de changer :
//  ① le badge s'affichait au DÉBUT de la tournée, c'est-à-dire à l'endroit où le camion est encore
//     à sa base. Ce qu'on veut lire, c'est « ce soir-là, le camion dort dehors » — donc une marque
//     au bout de CHAQUE journée concernée ;
//  ② un badge accroché à un bloc ne peut rien dire des journées SANS bloc. Or c'est exactement le
//     cas qui compte : un camion chargé le lundi qui n'a sa route que le jeudi passe mardi et
//     mercredi immobile, sans aucun bloc à ces dates — les deux nuits les plus coûteuses étaient
//     précisément les seules invisibles.
//
// Rend donc un Set de DATES ISO : « après cette journée-là, le camion ne rentre pas au dépôt ».
// Le Gantt le consomme par cellule (PL × jour), qu'elle contienne des blocs ou non. On raisonne en
// dates et non en index de jour parce que l'axe de calcul du moteur n'est pas celui de la fenêtre
// affichée (cf. `engineAxisFor` / `axisForBlocks`).
export function datesNuitHorsDepot(blocks, weekDays) {
  const dates = new Set();
  for (const seg of nuitsHorsDepot(blocks, weekDays)) {
    for (let d = seg.debutJour; d < seg.finJour; d++) {
      // Une soirée ne compte que si elle porte réellement une nuit ouvrée : le vendredi soir d'un
      // segment qui se prolongerait au lundi relève de Q17, pas de ce signal.
      if (nuitsOuvreesEntre(d, d + 1, weekDays) === 0) continue;
      const iso = weekDays?.[d];
      if (iso) dates.add(iso);
    }
  }
  return dates;
}

// ── INACTIVITÉ : CAMION CHARGÉ IMMOBILE (arbitrage Louis 2026-07-31, cas CHT-435739) ───────────
//
// Ce signal REMPLACE l'ancienne alerte « camion chargé en attente hors dépôt avant départ ».
// Celle-ci testait un LIEU (« le camion est-il loin de sa base ? ») et ne regardait qu'un seul
// trou, celui entre le chargement et le départ de la route. Deux familles de gaspillage lui
// échappaient donc complètement :
//   ① le camion rentré CHARGÉ au dépôt pour le week-end (coupure Q17), qu'elle excluait par
//      construction — or l'immobilisation est réelle, et souvent évitable en chargeant plus tard ;
//   ② le camion ARRIVÉ près du lieu de livraison qui attend le jour promis. Cas fondateur
//      CHT-435739 : route finie le mardi 10h, livraison le mercredi 7h → 8 h ouvrées à l'arrêt,
//      totalement invisibles.
//
// Le nouveau critère mesure la CHOSE QUI COÛTE, pas la position : le temps ouvré pendant lequel le
// camion, CHARGÉ, ne fait rien. Il est donc indifférent au lieu, ce qui rend les anciennes
// exclusions (coupure dépôt, gap traversant un week-end) inutiles — un samedi ne compte pas parce
// qu'il n'est pas ouvré, pas parce qu'on l'a exclu.
//
// SEUIL : 4 h ouvrées. Le chiffre n'est pas arbitraire — la journée fait 11 h (7h-18h), donc un
// bloc qui finit à 14h laisse exactement 4 h. « Plus de 4 h » se lit « le camion a fini avant 14h
// et n'est pas reparti », et écarte de lui-même le simple résidu de fin de journée.
//
// PÉRIMÈTRE : camion CHARGÉ uniquement, c'est-à-dire entre la fin du chargement et le début de la
// livraison. Un camion vide qui attend n'est pas immobilisé : il reste disponible pour autre chose.
export const SEUIL_INACTIVITE_H = 4;

// Heures OUVRÉES entre deux instants absolus (les week-ends et les nuits ne comptent pas).
export function heuresOuvreesEntre(absDebut, absFin, weekDays, plage = PLAGE_STD) {
  if (!(absFin > absDebut)) return 0;
  const a = fromAbs(absDebut), b = fromAbs(absFin);
  let total = 0;
  for (let d = a.day; d <= b.day; d++) {
    if (isWeekend(d, weekDays)) continue;
    const p = plageAt(plage, d, weekDays);
    const debut = d === a.day ? Math.max(p.debut, a.h) : p.debut;
    const fin = d === b.day ? Math.min(p.fin, b.h) : p.fin;
    if (fin > debut) total += fin - debut;
  }
  return total;
}

const fmtHeures = (h) => `${String(h).replace(".", ",")} h`;

// Pose le signal sur la chaîne d'un lot. Pur signal : aucun bloc, km ni date n'est modifié.
//
// CONSTAT vs CONSIGNE — la distinction posée le 2026-07-31 est conservée :
//   • le CONSTAT `_inactivite { heures, resserrable }` est posé sur CHAQUE temps mort dépassant le
//     seuil : c'est de la matière de diagnostic, elle ne coûte rien à personne ;
//   • la CONSIGNE visible `_warning` (« dates à resserrer ») n'apparaît que si le lot est
//     réellement resserrable (cf. `utils/resserrage.js`) — une consigne qu'on ne peut pas suivre
//     use l'attention du planificateur — ET seulement sur le PLUS GROS temps mort de la chaîne :
//     deux fois le même ordre sur un même dossier n'apprend rien de plus.
// Le signal est accroché au bloc qui PRÉCÈDE le trou, là où l'immobilisation commence.
//
// EXEMPTION — LE CHARGEMENT DU VENDREDI (arbitrage Louis 2026-08-03) :
// charger le vendredi pour partir le lundi n'est pas un gaspillage, c'est un CHOIX du
// planificateur — le client déménage le vendredi, la route se fait la semaine suivante. Compter
// les heures ouvrées du vendredi revenait à afficher « dates à resserrer » sur une pratique qu'il
// ne faut justement pas resserrer. Ce temps mort n'alimente donc ni le constat ni la consigne :
// la situation est délibérée, elle n'a pas à peupler le diagnostic non plus.
//
// Trois conditions, ensemble :
//   ① le trou commence à la fin d'un CHARGEMENT — c'est ce qui distingue « le camion se prépare »
//      de « le camion attend ». Un retour dépôt du vendredi (coupure Q17, bloc `vid`) ou une route
//      terminée le vendredi restent comptés : là, le camion ne se prépare plus, il patiente ;
//   ② le trou commence un VENDREDI ;
//   ③ le trou TRAVERSE le week-end (samedi et dimanche n'étant pas ouvrés, tout bloc suivant est au
//      plus tôt le lundi), et la route chargée n'a pas encore commencé.
// Le `vid` de collecte entre deux chargements mutualisés ne compte pas comme un départ de route :
// les deux dossiers sont chargés le vendredi, le camion part le lundi — même pratique.
const ROUTE_CHARGEE = ["trs", "bou"];

// Les blocs POSÉS d'une chaîne, dans l'ordre où le camion les roule.
const blocsPoses = (blocks) => (blocks || []).filter(b => !b._overflow && b.day >= 0)
  .slice().sort((a, b) => a.day - b.day || a.startH - b.startH);

// LA ROUTE CHARGÉE A-T-ELLE DÉMARRÉ ? Un `trs` de COLLECTE — celui qui relie les deux chargements
// d'une paire mutualisée — n'en est pas un départ : les deux dossiers sont chargés le vendredi et
// le camion part le lundi, c'est exactement la pratique exemptée ci-dessus. Le § EXEMPTION l'écrivait
// déjà (« le `vid` de collecte […] ne compte pas comme un départ de route ») mais le code ne le
// faisait pas : `buildMutuChainInterne` type ces liaisons `trs`, comme les autres. On les reconnaît
// à leur DESTINATION (`_to.etape`), déjà portée par les points de passage des deux constructeurs.
// ⚠️ Sans `_to`, comportement historique inchangé (tout `trs`/`bou` compte) — et la chaîne d'un
// dossier seul n'a jamais de route vers un chargement, donc `buildChain` n'est pas affecté.
const estRouteChargeeDemarree = (b) => ROUTE_CHARGEE.includes(b.type) && b._to?.etape !== "chg";

// L'EXEMPTION « CHARGEMENT DU VENDREDI » — c'est une PRATIQUE MÉTIER, pas un périmètre : elle vaut
// donc à l'identique pour les deux règles qui lisent les temps morts (le signal `_inactivite`
// ci-dessous, et la barrière `ecartMaxH` de la mutualisation). Écriture unique : les trois
// conditions sont détaillées au § EXEMPTION ci-dessus.
function estChargementDuVendredi(poses, i, weekDays) {
  return poses[i].type === "chg"
    && dayOfWeek(poses[i].day, weekDays) === 5
    && poses[i + 1].day > poses[i].day
    && !poses.slice(0, i + 1).some(estRouteChargeeDemarree);
}

export function marquerInactivite(blocks, lot, weekDays, plage = PLAGE_STD) {
  const poses = blocsPoses(blocks);
  if (poses.length < 2) return blocks;

  // Fenêtre « camion chargé » : de la fin du chargement au début de la livraison.
  const finChg = poses.filter(b => b.type === "chg")
    .reduce((m, b) => Math.max(m, toAbs(b.day, b.endH)), -Infinity);
  const debutLiv = poses.filter(b => b.type === "liv")
    .reduce((m, b) => Math.min(m, toAbs(b.day, b.startH)), Infinity);
  if (!(finChg < debutLiv)) return blocks;

  const resserrable = lotResserrable(lot);
  let plusGros = null;
  for (let i = 0; i < poses.length - 1; i++) {
    const finBloc = toAbs(poses[i].day, poses[i].endH);
    const debutSuivant = toAbs(poses[i + 1].day, poses[i + 1].startH);
    if (finBloc < finChg || debutSuivant > debutLiv) continue; // camion vide : hors périmètre
    // Chargement du vendredi pour un départ le lundi : pratique voulue, on ne dit rien (cf. § ci-dessus).
    if (estChargementDuVendredi(poses, i, weekDays)) continue;
    // 🔴 LE VENDREDI APRÈS-MIDI NE COMPTE PAS (retour Louis du 2026-09-16) — un temps mort qui
    // COMMENCE un vendredi et passe le week-end : le camion rentre au dépôt (Q17), l'après-midi du
    // vendredi n'est pas une immobilisation qu'on pourrait « resserrer ». L'exemption ci-dessus ne
    // couvrait que le CHARGEMENT posé en dernier le vendredi ; un chargement suivi de son retour
    // dépôt le même vendredi déclenchait « Camion chargé immobile 7 h » (CHT-056466, CHT-513380).
    // Seules comptent alors les heures ouvrées APRÈS le week-end (lendemain sur l'axe ouvré = lundi).
    // Pur signal : la barrière `ecartMaxH` (`attenteMaxCollecte`, qui partage
    // `estChargementDuVendredi`) n'est volontairement PAS touchée.
    // Même garde que l'exemption du chargement : la route chargée n'a pas encore commencé (un camion
    // parti en route le vendredi relève d'un autre cas, déjà tranché et testé).
    const debutAttente = dayOfWeek(poses[i].day, weekDays) === 5 && poses[i + 1].day > poses[i].day
      && !poses.slice(0, i + 1).some(estRouteChargeeDemarree)
      ? toAbs(poses[i].day + 1, 0)
      : finBloc;
    const heures = heuresOuvreesEntre(debutAttente, debutSuivant, weekDays, plage);
    if (heures <= SEUIL_INACTIVITE_H) continue;
    poses[i]._inactivite = { heures, resserrable };
    if (!plusGros || heures > plusGros._inactivite.heures) plusGros = poses[i];
  }
  if (plusGros && resserrable) {
    const consigne = `Camion chargé immobile ${fmtHeures(plusGros._inactivite.heures)} — dates à resserrer`;
    // Le bloc porte parfois déjà un avertissement (« Chargement décalé », « Arrivée tardive ») :
    // on ajoute le nôtre au lieu de l'écraser, les deux informations sont utiles.
    plusGros._warning = plusGros._warning ? `${plusGros._warning} · ${consigne}` : consigne;
    debug.inc("inactivite_signalee");
  }
  return blocks;
}

// ── L'ATTENTE DE COLLECTE D'UNE PAIRE MUTUALISÉE — la mesure que lit la barrière `ecartMaxH` ─────
//
// LA FENÊTRE EST LE POINT DÉLICAT, et un premier jet s'y est trompé — trace gardée, la faute est
// facile à refaire. Mesurer « toute la tournée » (premier chargement → dernière livraison) paraît
// naturel et donne des chiffres énormes (51 h sur un cas d'essai) : mais ces heures-là sont
// presque toutes le fait d'une DATE DE LIVRAISON TARDIVE VOULUE PAR LE CLIENT. Le camion attend
// parce qu'on livre le mardi suivant, pas parce qu'on a mutualisé. Une barrière posée là
// refuserait des paires parfaitement saines pour un temps mort qui existerait de toute façon.
//
// La règle du RETOUR ne fait pas cette erreur : elle mesure la JONCTION ENTRE LES DEUX DOSSIERS
// (liv ANCRE → chg ACCROCHÉ), jamais l'attente interne à la mission d'un dossier. La fenêtre
// retenue ici en est l'exacte transposition : en mutualisation, ce que la PAIRE fabrique, c'est la
// COLLECTE — du dernier bloc de chargement du premier dossier au premier bloc de chargement du
// second. Tout le reste (attente avant livraison, écart entre les deux livraisons) appartient aux
// dossiers eux-mêmes, et c'est déjà le domaine du signal `_inactivite`.
//
//   `marquerInactivite`    SIGNAL, après la pose.   « le camion porte CE dossier »        seuil 4 h
//                          dernier chg → première liv d'un lot
//   `attenteMaxCollecte`   BARRIÈRE, à la recherche. « aller chercher le SECOND dossier »  `ecartMaxH`
//                          fin du chg du 1ᵉʳ lot → début du chg du 2ᵉ
//
// PAR TROU, JAMAIS EN CUMUL : la règle se dit « pas plus d'une demi-journée d'inactivité ENTRE DEUX
// ACTIONS ». Trois attentes de 2 h ne font pas une attente de 6 h, et n'ont pas la même cause.
//
// CONTRAT : `null` veut dire « pas de collecte à juger » (un seul dossier chargé), et RIEN
// d'autre. Dès qu'il y a deux dossiers, la réponse est toujours un `{ heures, apres }` chiffré —
// `heures: 0` quand il n'y a rien à reprocher, `apres` étant le bloc qui précède le trou, donc là
// où l'immobilisation commence (`null` s'il n'y a pas de trou). Sans cette séparation, un appelant
// ne saurait pas distinguer « aucune attente » de « rien à mesurer ».
export function attenteMaxCollecte(blocks, weekDays, plage = PLAGE_STD) {
  const poses = blocsPoses(blocks);
  const chgs = poses.filter(b => b.type === "chg");
  if (chgs.length < 2) return null;

  // Un chargement qui déborde sur deux jours produit PLUSIEURS blocs `chg` du même lot
  // (`splitByDay`) : on raisonne donc par dossier, jamais par bloc — sinon la coupure de minuit
  // d'un chargement unique passerait pour une attente de collecte.
  const premierLot = chgs[0].lotId;
  const chgsSecond = chgs.filter(b => b.lotId !== premierLot);
  if (!chgsSecond.length) return null;

  const finCollecteDebut = chgs.filter(b => b.lotId === premierLot)
    .reduce((m, b) => Math.max(m, toAbs(b.day, b.endH)), -Infinity);
  const debutCollecteFin = chgsSecond
    .reduce((m, b) => Math.min(m, toAbs(b.day, b.startH)), Infinity);
  const pire = { heures: 0, apres: null };
  if (!(finCollecteDebut < debutCollecteFin)) return pire;

  for (let i = 0; i < poses.length - 1; i++) {
    const finBloc = toAbs(poses[i].day, poses[i].endH);
    const debutSuivant = toAbs(poses[i + 1].day, poses[i + 1].startH);
    if (finBloc < finCollecteDebut || debutSuivant > debutCollecteFin) continue;
    if (estChargementDuVendredi(poses, i, weekDays)) continue;
    const heures = heuresOuvreesEntre(finBloc, debutSuivant, weekDays, plage);
    if (heures > pire.heures) { pire.heures = heures; pire.apres = poses[i]; }
  }
  return pire;
}

// buildChain — point d'entrée public. Construit la chaîne, puis applique la garde week-end.
// Si la tournée laisserait le PL hors dépôt pendant un week-end, TROIS remèdes sont essayés dans
// l'ordre (arbitrage Louis 2026-07-22 : la date de chargement promise au client prime) :
//   1. COUPURE AU DÉPÔT après le chargement — le chargement reste à sa date, le PL rentre chargé
//      au dépôt, la route + la livraison repartent le lundi. C'est la pratique métier courante en
//      déménagement, et elle tient les DEUX dates (chargement et livraison) dans les cas réels
//      CHT-308024 / CHT-241946 / CHT-587683.
//   1 bis. LIVRAISON AVANCÉE dans la fenêtre de flex — le chargement reste à sa date lui aussi,
//      mais on livre 1 à 4 jours ouvrés AVANT la date demandée pour que le PL soit rentré avant la
//      coupure. Retenu à la place de la coupure uniquement s'il rapproche la livraison de la
//      promesse client (cf. `chercherLivraisonAvancee`, cas CHT-221011).
//   2. Repli — décaler toute la tournée au lundi suivant : la date de chargement n'est alors plus
//      tenue (le warning « Chargement décalé » du bloc chg signale l'écart au planificateur).
// Dernier repli : si aucun des trois ne résout, on conserve la chaîne d'origine — décaler ne ferait
// que retarder le client sans rien résoudre.
//
// opts.gardeWeekendRetour : OPT-IN. La garde n'est active que pour une tournée réellement posée
//   qui part du dépôt ET y revient (reflowVehicle, premier lot du PL). Volontairement inactive :
//   - dans les SIMULATIONS de boucle (findBoucleCandidates / detectBoucles) — elles ont leur
//     propre garde Q17 (peutRentrerAvantWeekend) et décaler leurs chaînes fausserait le scoring ;
//   - ~~sur les maillons intermédiaires d'un reflow multi-lots~~ — PÉRIMÉ depuis le 2026-09-15 :
//     `hasWeekendBetween` ne voyait que le week-end ENTRE deux chantiers, jamais celui qu'un maillon
//     enchaîné traverse DANS sa propre chaîne (chargé vendredi, livré lundi). La pose active désormais
//     la garde sur tout maillon, avec `departHorsDepot`.
// opts.departHorsDepot : le camion ne part pas du dépôt (maillon enchaîné). Les remèdes qui ramènent
//   le camion au dépôt (coupure, livraison avancée) restent permis ; le décalage au lundi est interdit
//   (il laisserait le camion attendre sur place tout le week-end) et la chaîne revient marquée
//   `hors_depot` — `reflowVehicle` fait alors rentrer le camion avant ce chantier.
export function buildChain(lot, vehicule, weekDays, opts = {}, agencesData = []) {
  // Le signal « nuits hors dépôt » n'est plus gravé dans les blocs : il est DÉRIVÉ à l'affichage
  // par `datesNuitHorsDepot`, sur la chaîne finalement retenue. Un signal dérivé ne peut pas
  // survivre à la tournée qui l'a produit — ce qu'un flag persisté dans `placements` faisait dès
  // qu'un reflow rendait la nuit caduque.
  const blocks = avecGardeJamaisPire(
    () => buildChainGardeWeekend(lot, vehicule, weekDays, opts, agencesData),
    () => buildChainGardeWeekend(lot, vehicule, weekDays, { ...opts, appliquerPlageLot: false }, agencesData),
    opts, plagesDuLot(lot), weekDays,
  );
  // Signal « camion chargé immobile », posé sur la chaîne RETENUE (après garde week-end et garde
  // « jamais pire ») — sinon il décrirait une tournée qu'on vient d'écarter. Hors boucle seulement :
  // en boucle (`ignoreDateL`) la livraison est posée au plus tôt, il n'y a pas de date promise à
  // resserrer et le levier appartient au moteur de boucles, pas au planificateur.
  if (!opts.ignoreDateL) {
    marquerInactivite(blocks, lot, weekDays, opts.appliquerPlageLot ? plagesDuLot(lot) : PLAGE_STD);
  }
  // Nuits passées à portée du dépôt : créditées à la base, sur la chaîne RETENUE elle aussi.
  // Après `marquerInactivite` à dessein — les deux signaux sont indépendants : un camion chargé
  // qui attend trois jours reste un gaspillage à signaler, même s'il dort au dépôt.
  marquerNuitsAuDepot(blocks, vehicule, weekDays, agencesData, opts.rules);
  return blocks;
}

// ── GARDE-FOU « JAMAIS PIRE » — NON NÉGOCIABLE ─────────────────────────────────────────────────
//
// Élargir la journée ne peut, en principe, que RACCOURCIR une mission : plus d'heures utiles par
// jour ⇒ un bloc finit à la même heure absolue ou plus tôt ⇒ le camion rentre le même jour ou
// avant. `chaineTraverseWeekend` ne peut donc passer que de vrai à faux, jamais l'inverse.
//
// Ce raisonnement a UNE faille, étroite mais réelle : la boucle « route au plus tard » cherche le
// DERNIER jour de départ permettant de livrer à la date promise. Avec des journées plus longues,
// un départ plus tardif peut devenir possible — donc un bloc peut, dans un cas de figure précis,
// commencer plus tard, et le retour au dépôt qui suit glisser d'un jour.
//
// Plutôt que de démontrer l'invariant par le raisonnement, on le VÉRIFIE à l'exécution : on
// construit les deux chaînes et on ne retient l'élargie que si elle ne dégrade rien. Coût : une
// construction supplémentaire, et seulement sur les dossiers explicitement élargis (donc rares).
//
// ⚠️ Ne pas « simplifier » cette fonction au motif qu'elle coûte un calcul de plus : c'est elle
// qui rend la RÈGLE D'OR Q17 inviolable par cette fonctionnalité. Sans elle, un dépassement du
// soir autorisé par un planificateur pourrait laisser un PL dehors le week-end.
function avecGardeJamaisPire(construireElargie, construireStandard, opts, plage, weekDays) {
  const elargie = construireElargie();
  // Rien à arbitrer si la plage du dossier EST la journée standard, ou si l'appelant n'a pas
  // demandé l'élargissement : la chaîne construite est déjà la standard.
  if (!opts.appliquerPlageLot) return elargie;
  // `plageEstStandard` regarde l'ENVELOPPE **et** la table par date : un dossier resté en 7h-18h
  // mais dont une seule journée est élargie doit passer par la garde, pas la contourner.
  if (plageEstStandard(plage)) return elargie;

  const standard = construireStandard();
  const finDe = (blocs) => (blocs || []).reduce((m, b) => Math.max(m, b.endAbs ?? 0), 0);
  const ok = elargie.length > 0
    // ① Q17 : ne jamais introduire un week-end hors dépôt que la standard n'avait pas.
    && !(chaineTraverseWeekend(elargie, weekDays) && !chaineTraverseWeekend(standard, weekDays))
    // ② Ne jamais finir plus tard que la standard — l'élargissement sert à raccourcir.
    && finDe(elargie) <= finDe(standard);
  return ok ? elargie : standard;
}

// Jour (index d'axe) où la livraison est POSÉE par une chaîne, ou null si elle n'y figure pas —
// chaîne vide, ou livraison rejetée en marqueur overflow « sem. suiv. » au-delà de l'axe.
function jourLivraisonPosee(blocs) {
  let jour = null;
  for (const b of blocs || []) {
    if (b.type !== "liv" || b._overflow || b.day < 0) continue;
    if (jour === null || b.day < jour) jour = b.day;
  }
  return jour;
}

// Écart, en jours ouvrés, entre la livraison posée par une chaîne et la date promise au client.
// NON SIGNÉ : s'écarter de 2 jours de la promesse coûte autant en avance qu'en retard — c'est ce
// qui permet de comparer un remède qui avance à un remède qui retarde. Une chaîne dont la livraison
// part en overflow est infiniment loin de la promesse : elle ne peut jamais gagner l'arbitrage.
// `weekDays` ne contient que des jours ouvrés (cf. buildWorkAxis) : l'écart d'index EST l'écart en
// jours ouvrés.
function ecartLivraison(blocs, dayL) {
  const jour = jourLivraisonPosee(blocs);
  return jour === null ? Infinity : Math.abs(jour - dayL);
}

// Le bloc livraison porte la trace de l'avance : le planificateur doit VOIR que la date posée n'est
// pas celle qui a été demandée, et pourquoi. `_warning` est recalculé ici contre la VRAIE promesse
// client (`lot.dateL`) : buildChainInterne l'a évalué contre la date avancée qu'on lui a soufflée,
// et aurait donc crié « Arrivée tardive » sur une livraison en réalité en avance.
function marquerLivraisonAvancee(blocs, lot, weekDays, dayL) {
  const jour = jourLivraisonPosee(blocs);
  const datePosee = jour === null ? null : weekDays[jour];
  for (const b of blocs) {
    if (b.type !== "liv") continue;
    delete b._warning;
    if (!datePosee) continue;
    if (datePosee > lot.dateL) {
      b._warning = "Arrivée tardive — livraison après la date demandée";
    } else if (datePosee < lot.dateL) {
      const jours = dayL - jour;
      b._livAvancee = { demandee: lot.dateL, posee: datePosee, jours };
      b._warning = `Livraison avancée de ${jours} j — seul moyen de rentrer au dépôt avant le week-end`;
    }
  }
}

// ── REMÈDE « LIVRER PLUS TÔT » (arbitrage Louis 2026-08-01) ───────────────────────────────────
// Cas fondateur CHT-221011 : Aix-en-Provence → Paris, chargement mer. 23/09, livraison demandée
// ven. 25/09. Paris ↔ dépôt Marseille = 827 km ≈ 12 h de conduite, soit PLUS qu'une journée ouvrée
// (11 h) : toute livraison posée un vendredi rend le retour au dépôt mathématiquement impossible
// avant la coupure, quelle que soit l'heure de la livraison. La chaîne brute laissait donc le PL à
// Paris tout le week-end, et le seul remède connu (la coupure au dépôt) repoussait la livraison au
// mardi suivant — 2 jours ouvrés de retard, plus 29 h de camion chargé immobile au dépôt. Or livrer
// le JEUDI, un jour EN AVANCE, ramenait le PL à sa base le vendredi à 14 h : mission bouclée dans
// la semaine, Q17 respectée, date de chargement tenue.
//
// Le moteur ne savait que RETARDER (boucle « départ au plus tard » de buildChainInterne), jamais
// avancer. Ce remède comble le trou, sous quatre conditions strictes :
//   - DERNIER RECOURS : tenté uniquement sur une chaîne qui viole DÉJÀ Q17. Un placement qui passe
//     tel quel n'est jamais touché — la date demandée reste la date posée ;
//   - BORNÉ par `flexLivraisonJours` (4 j ouvrés), et coupé net si le client impose sa date
//     (`dateLivImposee`) — même sémantique que la fenêtre du moteur de boucles ;
//   - AVANCE MINIMALE : on essaie J−1, puis J−2… et on retient le premier jour qui rend la tournée
//     conforme, pas le meilleur en km ;
//   - « JAMAIS PIRE » : retenu seulement s'il rapproche la livraison de la promesse client par
//     rapport au remède déjà en main (`ecartRef`, l'écart de la coupure). C'est cette garde qui
//     rend le remède sans effet de bord sur les dossiers qui se résolvaient déjà correctement.
// Pas de confirmation client requise (arbitrage Louis 2026-08-01), cohérent avec la doctrine déjà
// inscrite sur `flexLivraisonJours` : « un client accepte une livraison plus tôt que demandée ».
// ⚠️ La date du lot en base n'est PAS réécrite : le dossier garde sa `dateL` demandée, seul le bloc
// posé bouge. L'écart est donc visible (warning du bloc + anomalie ④ du diag), volontairement.
function chercherLivraisonAvancee(lot, vehicule, weekDays, opts, agencesData, ecartRef) {
  // En boucle (`ignoreDateL`) la livraison est déjà posée au plus tôt : rien à avancer.
  if (opts.ignoreDateL || !lot.dateL || lot.dateLivImposee) return null;
  const rules = opts.rules || RULES_DEFAULTS;
  const flexL = rules.flexLivraisonJours ?? 4;
  if (flexL <= 0) return null;

  const dayL = weekDays.indexOf(lot.dateL);
  const dayC = weekDays.indexOf(lot.dateC);
  if (dayL < 0 || dayC < 0) return null; // hors axe : l'arithmétique en jours ouvrés ne tient plus

  for (let n = 1; n <= flexL; n++) {
    const jour = dayL - n;
    if (jour < dayC) break; // on ne livre jamais avant d'avoir chargé
    if (isWeekend(jour, weekDays)) continue;
    const cand = buildChainInterne(
      { ...lot, dateL: weekDays[jour] }, vehicule, weekDays,
      { ...opts, gardeWeekendRetour: false }, agencesData,
    );
    if (!cand.length || chaineTraverseWeekend(cand, weekDays)) continue;
    // La date avancée n'est qu'une CONSIGNE passée au planificateur de chaîne : si la route ne peut
    // pas arriver à temps, la livraison retombe plus tard que la cible visée. On juge donc sur la
    // livraison réellement posée, jamais sur la date qu'on espérait.
    if (ecartLivraison(cand, dayL) >= ecartRef) continue;
    marquerLivraisonAvancee(cand, lot, weekDays, dayL);
    return cand;
  }
  return null;
}

// ── Q17 — LE DERNIER RECOURS, ET POURQUOI IL NE DOIT PLUS ÊTRE SILENCIEUX (2026-08-18) ──────────
//
// 🔴 RAPPEL : « un poids lourd n'est JAMAIS hors dépôt le week-end » est une contrainte ABSOLUE.
// Aucune économie de kilomètres n'est un argument contre elle, et une option non conforme ne se
// propose pas, même « pour comparaison ».
//
// Il reste pourtant un cas où le moteur ne PEUT pas la tenir : une mission qui, même reprise à zéro
// un lundi matin, dépasse la semaine ouvrée. Les trois remèdes supposent tous que la mission TIENT
// dans une semaine — livrer plus tôt, couper au dépôt le vendredi, décaler au lundi. Quand elle n'y
// tient pas, le camion est physiquement dehors le samedi, et refuser de poser la mission la ferait
// simplement DISPARAÎTRE du planning : l'invariant « jamais de suppression silencieuse » vaut ici
// aussi, et un dossier invisible est plus dangereux qu'un dossier signalé.
//
// CE QUI CHANGE. Jusqu'au 2026-08-18, ce repli rendait la chaîne non conforme sans compteur, sans
// journal et sans marque — invisible au planificateur comme au diagnostic. Une règle d'or violée en
// silence est le pire des deux mondes : on croit la règle tenue partout, et on ne sait même pas
// combien de fois elle ne l'est pas. Désormais le cas se COMPTE, se JOURNALISE et s'AFFICHE.
//
// ⚠️ CE N'EST PAS UNE AUTORISATION, et il ne faut pas lire ce commentaire comme un assouplissement.
// Ce que la règle d'or interdit, c'est de PROPOSER une option non conforme quand une conforme
// existe. Ici aucune n'existe : la pose n'est pas un choix entre plusieurs options, c'est le seul
// état atteignable. La conduite à tenir face à ces dossiers — les refuser à la vente, les découper,
// affréter — est une décision de direction, et elle demande d'abord de savoir combien il y en a.
// C'est exactement ce que ce compteur rend possible.
//
// ⚠️ BIAIS DE COMPTAGE CONNU : `avecGardeJamaisPire` construit la chaîne DEUX FOIS sur les dossiers
// à plage horaire élargie (et seulement ceux-là, qui sont rares). Un tel dossier peut donc compter
// double. Le compteur mesure un ORDRE DE GRANDEUR, pas un décompte exact — ne pas le présenter
// comme un nombre de dossiers.
// DEUX CAUSES, DEUX GESTES — ne pas les confondre à l'écran :
//   `hors_axe`   la semaine suivante n'est pas AFFICHÉE, donc le décalage au lundi n'est pas
//                représentable. Ce n'est pas une impasse métier : le geste est d'élargir la fenêtre.
//                En production l'axe couvre ~130 jours, ce cas y est donc rarissime.
//   `trop_long`  la mission déborde la semaine ouvrée même reprise d'un lundi frais. Là, c'est une
//                vraie impasse : aucune fenêtre plus large n'y changera quoi que ce soit.
const Q17_MOTIFS = {
  hors_axe: "Week-end hors dépôt — la semaine suivante n'est pas affichée, élargir la période",
  trop_long: "Week-end hors dépôt — aucun remède possible (mission > 1 semaine ouvrée)",
  // Chantier enchaîné (le camion n'est pas rentré au dépôt avant lui) que ni la coupure ni la livraison
  // avancée ne sauvent. `reflowVehicle` fait alors rentrer le camion avant ce chantier : ce motif ne doit
  // subsister sur une pose que si même cette rentrée n'a pas été possible (2026-09-15).
  hors_depot: "Week-end hors dépôt — le camion n'est pas rentré au dépôt avant ce chantier",
};

function q17SansRemede(blocks, weekDays, quoi, motif) {
  if (!chaineTraverseWeekend(blocks, weekDays)) return blocks;
  debug.inc("weekend_hors_depot_sans_remede");
  debug.inc(`weekend_hors_depot_${motif}`);
  debug.log("BUILDCHAIN", `  \u{1F534} ${quoi} — Q17 NON TENUE : ${Q17_MOTIFS[motif]}. La chaîne est posée telle quelle, le camion passe le week-end hors dépôt.`);
  // Le signal se pose sur le PREMIER bloc de la chaîne — celui que le planificateur voit en premier
  // sur le Gantt. `_warningFriday` est le canal rouge (🚨) déjà rendu par `AtomBlock` : il n'avait
  // jusqu'ici aucun émetteur, c'est précisément l'usage pour lequel il attendait.
  const premier = blocks.find(b => !b._overflow) || blocks[0];
  if (premier) premier._warningFriday = Q17_MOTIFS[motif];
  return blocks;
}

function buildChainGardeWeekend(lot, vehicule, weekDays, opts = {}, agencesData = []) {
  const blocks = buildChainInterne(lot, vehicule, weekDays, opts, agencesData);
  // La garde week-end s'applique dès que le lot part du dépôt (gardeWeekendRetour), y compris quand
  // il enchaîne en continu vers le lot suivant (skipRetourDepot). Raison : skipRetourDepot ne
  // concerne que le retour dépôt FINAL de fin de tournée — pas la coupure du vendredi À L'INTÉRIEUR
  // de la chaîne (chargement vendredi / route lundi). Un maillon enchaîné qui charge le vendredi
  // doit quand même rentrer chargé au dépôt pour le week-end (cas CHT-003327 : livre le même jour
  // que le chargement du lot suivant → skipRetourDepot, mais passait le week-end chargé à 56 km du
  // dépôt). Le remède 1 (coupureDepotApresChg) insère le retour du vendredi sans dessiner de retour
  // FINAL tant que skipRetourDepot reste vrai — les deux retours sont bien découplés.
  if (!opts.gardeWeekendRetour) return blocks;
  if (!chaineTraverseWeekend(blocks, weekDays)) return blocks;

  // Remède 1 — coupure au dépôt après le chargement (préféré : tient la date promise au client).
  const coupure = buildChainInterne(
    lot, vehicule, weekDays,
    { ...opts, coupureDepotApresChg: true, gardeWeekendRetour: false },
    agencesData,
  );
  const coupureOk = coupure.length > 0 && !chaineTraverseWeekend(coupure, weekDays);

  // Remède 1 bis — livrer plus tôt dans la fenêtre de flex (cf. chercherLivraisonAvancee).
  // Évalué APRÈS la coupure pour pouvoir se comparer à elle : l'avance n'est retenue que si elle
  // rapproche la livraison de la date promise. Sans coupure valide en main, la référence est
  // l'infini — n'importe quelle avance conforme vaut mieux que la chaîne qui viole Q17.
  const dayLPromis = weekDays.indexOf(lot.dateL);
  const ecartRef = coupureOk && dayLPromis >= 0 ? ecartLivraison(coupure, dayLPromis) : Infinity;
  const avance = chercherLivraisonAvancee(lot, vehicule, weekDays, opts, agencesData, ecartRef);
  if (avance) {
    debug.inc("weekend_livraisons_avancees");
    debug.log("BUILDCHAIN", `  ${lot.id} livraison avancée (règle week-end Q17) · demandée ${lot.dateL} → posée ${weekDays[jourLivraisonPosee(avance)]}, chargement maintenu au ${lot.dateC}`);
    return avance;
  }

  if (coupureOk) {
    debug.inc("weekend_coupures_depot");
    debug.log("BUILDCHAIN", `  ${lot.id} coupure au dépôt après chargement (règle week-end Q17) · chargement maintenu au ${lot.dateC}`);
    return coupure;
  }

  // 🔴 Q17 — DÉPART HORS DÉPÔT : le remède 2 est INTERDIT (correctif 2026-09-15). Décaler au lundi un
  // lot qui repart de la livraison du chantier précédent ne ramène pas le camion chez lui : il attend
  // le lundi SUR PLACE, vide, tout le week-end — et `chaineTraverseWeekend` ne le voit pas, la chaîne
  // décalée commençant le lundi. On rend la chaîne telle quelle, marquée : c'est à `reflowVehicle` de
  // faire rentrer le camion au dépôt AVANT ce lot (il repartira alors du dépôt, remède 2 compris).
  if (opts.departHorsDepot) return q17SansRemede(blocks, weekDays, lot.id, "hors_depot");

  // Remède 2 — décalage de toute la tournée au lundi suivant (la date de chargement n'est plus tenue).
  const premierJour = blocks.filter(b => !b._overflow && b.day >= 0)
    .reduce((min, b) => Math.min(min, b.day), Infinity);
  const vendrediIdx = findFridayIdx(premierJour, weekDays);
  const lundiIdx = findNextMondayIdx(vendrediIdx, weekDays);
  // Dernier recours n° 1 — le lundi suivant est hors de l'axe : aucun décalage n'est représentable.
  if (lundiIdx < 0) return q17SansRemede(blocks, weekDays, lot.id, "hors_axe");

  const retente = buildChainInterne(
    lot, vehicule, weekDays,
    { ...opts, startCursorAbs: toAbs(lundiIdx, DAY_START), gardeWeekendRetour: false },
    agencesData,
  );
  // Dernier recours n° 2 — même repartie d'un lundi frais, la mission déborde la semaine ouvrée.
  if (!retente.length || chaineTraverseWeekend(retente, weekDays)) {
    return q17SansRemede(blocks, weekDays, lot.id, "trop_long");
  }

  debug.inc("weekend_decalages_retour");
  debug.log("BUILDCHAIN", `  ${lot.id} chaîne décalée au lundi (règle week-end retour Q17) · jour ${premierJour} → ${lundiIdx}`);
  return retente;
}


// buildMutuChain — chaîne interleavée d'une MUTUALISATION (contexte boucle par construction) :
// les livraisons sont posées au plus tôt dans la séquence (arbitrage 2026-06-10 : en boucle on
// optimise le trajet ; les dates des lots sont réécrites à l'acceptation → « proposé = posé »).
// opts.rules : règles métier (RULES_DEFAULTS par défaut).
function buildMutuChainInterne(lotAcc, lotAnc, sequence, vehicule, weekDays, opts = {}, agencesData = []) {
  // Cf. buildChainInterne. En mutualisation on prend l'INTERSECTION des deux dossiers : élargir
  // la journée d'un client ne doit pas imposer l'horaire élargi à l'autre.
  const plage = opts.appliquerPlageLot ? plagesCommunes(lotAcc, lotAnc) : PLAGE_STD;
  // Bornes résolues par date, comme dans `buildChainInterne` — ici sur l'intersection du jour.
  const deb = (day) => plageAt(plage, day, weekDays).debut;
  const fin = (day) => plageAt(plage, day, weekDays).fin;
  const heuresUtilesLe = (day) => fin(day) - deb(day);
  const ag = agLookup(vehicule.ag, agencesData);
  if (!ag.cp && !ag.name) return [];
  const rules = opts.rules || RULES_DEFAULTS;
  const vitesse = rules.vitessePL || 70;
  const seuilRoute = rules.seuilRoute ?? 15;
  // Même repli abaque que buildChain (cf. commentaire là-bas)
  const manutFallback = (vol, fte) => manutHeures(vol, fte, rules);
  const agGps = gc(ag.cp);
  const aGpsC = gc(lotAcc.cpC), aGpsL = gc(lotAcc.cpL);
  const bGpsC = gc(lotAnc.cpC), bGpsL = gc(lotAnc.cpL);

  // Détermine l'ordre des opérations selon S1/S2
  // Chaque entrée : { lot, type ("chg"|"liv"), gps }
  const ops = sequence === "S1"
    ? [
        { lot: lotAnc, type: "chg", gps: bGpsC },
        { lot: lotAcc, type: "chg", gps: aGpsC },
        { lot: lotAcc, type: "liv", gps: aGpsL },
        { lot: lotAnc, type: "liv", gps: bGpsL },
      ]
    : [
        { lot: lotAcc, type: "chg", gps: aGpsC },
        { lot: lotAnc, type: "chg", gps: bGpsC },
        { lot: lotAnc, type: "liv", gps: bGpsL },
        { lot: lotAcc, type: "liv", gps: aGpsL },
      ];

  const parseDurFn = parseDur;

  const startGps = opts.startGps || agGps;

  // POINTS DE PASSAGE (2026-07-28) — même principe que buildChain. En mutualisation c'est encore
  // plus utile : les deux dossiers s'imbriquent, et sans origine/destination sur les blocs de
  // route il est impossible de reconstituer l'ordre réel du camion depuis le Gantt.
  const ptDepot = { label: `Dépôt ${ag.name || ag.cp || ""}`.trim(), cp: ag.cp, gps: agGps };
  const ptDe = (op) => ({
    label: (op.type === "chg" ? op.lot.vC : op.lot.vL) || (op.type === "chg" ? op.lot.cpC : op.lot.cpL) || "?",
    cp: op.type === "chg" ? op.lot.cpC : op.lot.cpL,
    gps: op.gps, lotId: op.lot.id, etape: op.type,
  });
  const ptDepart = startGps === agGps
    ? ptDepot
    : (opts.startPoint || { label: "Chantier précédent", gps: startGps });

  const dayCRef = Math.min(weekDays.indexOf(lotAcc.dateC), weekDays.indexOf(lotAnc.dateC));
  // Garde (fix S2) : si l'une des deux dates de chargement est hors axe, dayCRef = -1 →
  // curseur négatif → tous les blocs invisibles SANS marqueur. Symétrique de buildChain
  // (dayC < 0 → []) : l'appelant (reflowVehicle) conserve alors les blocs existants.
  if (opts.startCursorAbs === undefined && dayCRef < 0) return [];
  let cursor = opts.startCursorAbs !== undefined ? opts.startCursorAbs : toAbs(dayCRef, deb(dayCRef));
  const allBlocks = [];
  let prevGps = startGps;
  let coupureFaite = false; // une seule coupure au dépôt par chaîne (cf. plus bas)
  let uid = 0;
  const mkId = (lotId, type) => `${lotId}-${vehicule.id}-mu${++uid}-${type}`;
  const maxDay = weekDays.length - 1;

  // Bloc d'approche initial (dépôt → première opération)
  // RÈGLE VENDREDI ROUTE (fix v7) : appliquer la règle pour éviter que le PL parte du dépôt
  // vendredi après-midi et se retrouve chez le client le weekend.
  const kmApprocheInit = hav(prevGps, ops[0].gps);
  if (kmApprocheInit > seuilRoute) {
    const durApp = Math.max(1, Math.ceil(kmApprocheInit / vitesse));
    const opAncreDateInit = ops[0].type === "chg" ? ops[0].lot.dateC : ops[0].lot.dateL;
    const opAncreDurInit = ops[0].type === "chg"
      ? (parseDurFn(ops[0].lot.dureC) || manutFallback(ops[0].lot.vol, ops[0].lot.fteC))
      : (parseDurFn(ops[0].lot.dureL) || manutFallback(ops[0].lot.vol, ops[0].lot.fteL));
    // APPROCHE AU PLUS TARD (arbitrage Louis 2026-08-01, cas CHT-050731). L'approche était posée
    // au démarrage de la chaîne ; or la 1ʳᵉ opération, elle, est ancrée à SA date (cf. « forcer le
    // cursor à dateC » plus bas). Dès que les deux diffèrent, l'écart devenait du temps mort : le
    // camion montait chez le client et y restait garé jusqu'au chargement — 2 journées et 3 nuits
    // hors dépôt sur le cas fondateur. On recule donc le départ pour que l'approche se termine
    // JUSTE avant le début possible de la 1ʳᵉ opération. Aucun km, aucune date client ne change :
    // seule l'heure de départ du dépôt bouge, comme le ferait un planificateur.
    // La règle vendredi s'applique ENSUITE, sur ce départ retardé : si reculer faisait partir le
    // camion un vendredi pour une opération du lundi, elle le renvoie au lundi (Q17 préservée).
    // ⚠️ DEPUIS LE DÉPÔT SEULEMENT (arbitrage Louis 2026-09-15) : une LIAISON depuis le chantier
    // précédent part tout de suite après la livraison — l'équipage roule le soir et dort près du
    // chargement suivant. La reculer ferait partir le camion le matin du chargement et casserait des
    // enchaînements que la proposition a annoncés (cas L0257+L0263 → L0271, vivier SharePoint).
    const dayOp0 = weekDays.indexOf(opAncreDateInit);
    if (dayOp0 >= 0 && startGps === agGps) {
      const debutOp0 = Math.max(cursor, toAbs(dayOp0, deb(dayOp0)));
      const departTardif = reculerHeuresOuvrees(debutOp0, durApp, weekDays, plage);
      if (departTardif > cursor) cursor = departTardif;
    }
    const frApp = enforceFridayRuleRoute(cursor, durApp, opAncreDurInit, opAncreDateInit, weekDays);
    if (frApp.decale) {
      debug.inc("friday_decalages_mutu");
      if (typeof debug !== "undefined" && debug.log) {
        debug.log("BUILDCHAIN", `  MUTU ${ops[0].lot.id} approche initiale décalée au lundi (règle vendredi) · ${fromAbs(cursor).day}/${fromAbs(cursor).h}h → ${fromAbs(frApp.cursor).day}/${fromAbs(frApp.cursor).h}h`);
      }
      cursor = frApp.cursor;
    }
    const sched = scheduleBlock(cursor, durApp, weekDays, plage);
    const parts = splitByDay(sched.startAbs, sched.endAbs, weekDays, plage);
    // APPROCHE ou LIAISON — même distinction que `buildChainInterne` (cf. `isFromDepot` là-bas).
    // Ce type était écrit « app » EN DUR (corrigé le 2026-08-13) : une paire mutualisée chaînée
    // derrière un autre chantier annonçait donc « approche depuis le dépôt » alors qu'elle partait
    // du chantier précédent. Trois effets visibles, aucun théorique : `utils/chgDecale.js` donnait
    // la mauvaise cause dans l'alerte « chargement décalé », la légende et la couleur étaient
    // fausses, et l'étoile ★ ne pouvait pas s'accrocher (elle ne vit que sur les blocs « repo »).
    const typeTrajetInit = startGps === agGps ? "app" : "repo";
    parts.forEach((p) => {
      if (p.day < 0 || p.day > maxDay) return;
      const partDur = p.hEnd - p.hStart;
      allBlocks.push({
        id: mkId("init", typeTrajetInit), type: typeTrajetInit, day: p.day, date: weekDays[p.day] || "",
        lotId: ops[0].lot.id, plId: vehicule.id,
        label: ``, pills: [`${Math.round(kmApprocheInit * partDur / durApp)}km`, `${fmtH(p.hStart)}-${fmtH(p.hEnd)}`],
        km: Math.round(kmApprocheInit * partDur / durApp), vol: 0,
        duration: partDur, startH: p.hStart, endH: p.hEnd,
        ...(horsPlageStandard(p.hStart, p.hEnd) ? { _horsPlageStd: true } : {}),
        startAbs: sched.startAbs, endAbs: sched.endAbs,
        _from: ptDepart, _to: ptDe(ops[0]),
      });
    });
    cursor = sched.endAbs;
    prevGps = ops[0].gps;
  }

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];

    // Trajet entre op précédente et op courante
    if (i > 0) {
      // RÈGLE VENDREDI ROUTE (fix v7) : ancre temporelle de l'op suivante (dateC si chg, dateL si
      // liv) + sa durée. Sert à la règle vendredi ET au test de coupure ci-dessous.
      const opAncreDate = op.type === "chg" ? op.lot.dateC : op.lot.dateL;
      const opAncreDur = op.type === "chg"
        ? (parseDurFn(op.lot.dureC) || manutFallback(op.lot.vol, op.lot.fteC))
        : (parseDurFn(op.lot.dureL) || manutFallback(op.lot.vol, op.lot.fteL));
      // Départ AFFICHÉ de la liaison — cf. `ptRouteDepart` dans buildChain : il ne bascule sur le
      // dépôt que si la rentrée a vraiment été roulée, pas quand la coupure est créditée à vide.
      let ptLiaisonDepart = ptDe(ops[i - 1]);

      // COUPURE AU DÉPÔT (mutu — arbitrage Louis 2026-07-22, étendu à la mutu 2026-07-23) :
      // si la liaison vers l'op suivante devait être repoussée à la semaine suivante (règle
      // vendredi → frProbe.decale), le PL resterait le week-end à prevGps, chargé, loin du dépôt.
      // Sous coupureDepotApresChg, on le fait plutôt rentrer CHARGÉ au dépôt le vendredi (bloc vid
      // _weekendDepot) et repartir DU DÉPÔT le lundi. Sans ce remède, la seule issue serait de
      // décaler TOUTE la mutu au lundi — ce qui casserait la date de chargement promise au client
      // (cas CHT-147829/CHT-702532 : chargement Rennes vendredi tenu, retour dépôt Guer le vendredi).
      // Une seule coupure par chaîne, comme buildChain.
      if (opts.coupureDepotApresChg && !coupureFaite) {
        const kmProbe = hav(prevGps, op.gps);
        const durProbe = Math.max(1, Math.ceil(kmProbe / vitesse));
        const frProbe = enforceFridayRuleRoute(cursor, durProbe, opAncreDur, opAncreDate, weekDays);
        if (frProbe.decale) {
          const kmRentree = hav(prevGps, agGps);
          let finRentreeAbs = cursor;
          if (kmRentree > seuilRoute) {
            const durRentree = Math.max(1, Math.ceil(kmRentree / vitesse));
            const schedR = scheduleBlock(cursor, durRentree, weekDays, plage);
            finRentreeAbs = schedR.endAbs;
            const partsR = splitByDay(schedR.startAbs, schedR.endAbs, weekDays, plage);
            partsR.forEach((p) => {
              if (p.day < 0 || p.day > maxDay) return;
              const partDur = p.hEnd - p.hStart;
              allBlocks.push({
                id: mkId(ops[i - 1].lot.id, "vid"), type: "vid", day: p.day, date: weekDays[p.day] || "",
                lotId: ops[i - 1].lot.id, plId: vehicule.id,
                label: ``, pills: [`${Math.round(kmRentree * partDur / durRentree)}km`, `${fmtH(p.hStart)}-${fmtH(p.hEnd)}`],
                km: Math.round(kmRentree * partDur / durRentree), vol: 0,
                duration: partDur, startH: p.hStart, endH: p.hEnd,
        ...(horsPlageStandard(p.hStart, p.hEnd) ? { _horsPlageStd: true } : {}),
                startAbs: schedR.startAbs, endAbs: schedR.endAbs,
                _weekendDepot: true,
                _from: ptDe(ops[i - 1]), _to: ptDepot,
              });
            });
            ptLiaisonDepart = ptDepot; // rentrée réellement roulée
          } else {
            // Chargement à portée du dépôt : pas de bloc vid dessiné. On marque le dernier bloc
            // (l'op qui précède la coupure) comme retour dépôt pour que chaineTraverseWeekend
            // crédite la coupure — même angle mort que buildChain (cf. CHT-735480).
            const lastBlock = allBlocks[allBlocks.length - 1];
            if (lastBlock) lastBlock._weekendDepot = true;
          }
          // Lundi suivant — mais jamais avant l'arrivée réelle au dépôt (même correctif que
          // buildChainInterne : un retour à cheval sur le week-end doit pousser le curseur).
          cursor = Math.max(frProbe.cursor, finRentreeAbs);
          prevGps = agGps;         // le PL repart du dépôt
          coupureFaite = true;
        }
      }

      const km = hav(prevGps, op.gps);
      if (km > seuilRoute) {
        const durRoute = Math.max(1, Math.ceil(km / vitesse));
        // Durée = dureC ou dureL du lot. Évite que le PL se retrouve loin du dépôt le weekend
        // (ex : trs ChgAnc→ChgAcc jeudi, ChgAcc sem suivante → PL passe le weekend hors dépôt).
        const frRoute = enforceFridayRuleRoute(cursor, durRoute, opAncreDur, opAncreDate, weekDays);
        if (frRoute.decale) {
          debug.inc("friday_decalages_mutu");
          if (typeof debug !== "undefined" && debug.log) {
            debug.log("BUILDCHAIN", `  MUTU ${op.lot.id} trs→${op.type} décalé au lundi (règle vendredi) · ${fromAbs(cursor).day}/${fromAbs(cursor).h}h → ${fromAbs(frRoute.cursor).day}/${fromAbs(frRoute.cursor).h}h`);
          }
          cursor = frRoute.cursor;
        }
        const sched = scheduleBlock(cursor, durRoute, weekDays, plage);
        const parts = splitByDay(sched.startAbs, sched.endAbs, weekDays, plage);
        parts.forEach((p) => {
          if (p.day < 0 || p.day > maxDay) return;
          const partDur = p.hEnd - p.hStart;
          allBlocks.push({
            id: mkId(op.lot.id, "trs"), type: "trs", day: p.day, date: weekDays[p.day] || "",
            lotId: op.lot.id, plId: vehicule.id,
            label: ``, pills: [`${Math.round(km * partDur / durRoute)}km`, `${fmtH(p.hStart)}-${fmtH(p.hEnd)}`],
            km: Math.round(km * partDur / durRoute), vol: 0,
            duration: partDur, startH: p.hStart, endH: p.hEnd,
        ...(horsPlageStandard(p.hStart, p.hEnd) ? { _horsPlageStd: true } : {}),
            startAbs: sched.startAbs, endAbs: sched.endAbs,
            // Après une coupure dépôt roulée, la liaison repart du dépôt et non de l'op précédente.
            _from: ptLiaisonDepart,
            _to: ptDe(op),
          });
        });
        cursor = sched.endAbs;
      }
    }

    // Si chg : forcer le cursor à dateC du lot si pas déjà dépassé
    if (op.type === "chg") {
      const dayC = weekDays.indexOf(op.lot.dateC);
      if (dayC >= 0) {
        const dayStart = toAbs(dayC, deb(dayC));
        if (cursor < dayStart) cursor = dayStart;
      }
    }
    // Pas de forçage du cursor à dateL pour les livraisons : la livraison se pose
    // dès la fin de la route. dateL est une borne MAX, livrer plus tôt est OK
    // (à confirmer client — flag _livraisonAnticipee côté boucleEngine).

    // Bloc opérationnel chg/liv
    const dur = (op.type === "chg" ? parseDurFn(op.lot.dureC) : parseDurFn(op.lot.dureL))
      || manutFallback(op.lot.vol, op.type === "chg" ? op.lot.fteC : op.lot.fteL);
    // RÈGLE CHARGEMENT MÊME JOUR (audit 2026-07-19, alignement sur buildChain) : un chargement
    // qui tient en une journée n'est pas démarré s'il ne peut pas se terminer avant DAY_END —
    // on ne charge pas un client en deux fois à cheval sur deux jours.
    let opWarning;
    if (op.type === "chg") {
      {
        // Amplitude appréciée sur LA journée où le chargement démarrerait (cf. buildChainInterne).
        const snapped = snapToWorkingHours(cursor, weekDays, plage);
        const { day: snapDay, h: snapH } = fromAbs(snapped);
        if (dur <= heuresUtilesLe(snapDay) && fin(snapDay) - snapH <= dur) {
          cursor = snapToWorkingHours(toAbs(snapDay + 1, deb(snapDay + 1)), weekDays, plage);
        }
      }
      // Warning « Chargement décalé » (B6) — même règle que buildChain, en dates ISO.
      const chgStartDay = fromAbs(snapToWorkingHours(cursor, weekDays, plage)).day;
      const chgDate = weekDays[chgStartDay];
      if (op.lot.dateC && chgDate && chgDate > op.lot.dateC) {
        opWarning = "Chargement décalé — après la date demandée";
      }
    }
    const sched = scheduleBlock(cursor, dur, weekDays, plage);
    const parts = splitByDay(sched.startAbs, sched.endAbs, weekDays, plage);
    const isMulti = parts.length > 1;
    const lockStatus = isLotLocked(op.lot) ? "locked" : undefined;
    const flags = (op.type === "chg" ? op.lot.transboC : op.lot.transboL)
      || (op.type === "chg" ? op.lot.gardeMeublesC : op.lot.gardeMeublesL)
      || (op.type === "chg" ? op.lot.monteMeubleC : op.lot.monteMeubleL)
      || op.lot.objetsLourds?.length > 0 || op.lot.railRoute || lockStatus
      ? { _lotFlags: {
          transbo: op.type === "chg" ? op.lot.transboC : op.lot.transboL,
          gardeMeubles: op.type === "chg" ? op.lot.gardeMeublesC : op.lot.gardeMeublesL,
          // Monte-meuble (2026-09-16) : affichage seul, aucun calcul ne le lit.
          ...((op.type === "chg" ? op.lot.monteMeubleC : op.lot.monteMeubleL) ? { monteMeuble: true } : {}),
          objetsLourds: op.lot.objetsLourds?.length > 0,
          railRoute: op.lot.railRoute,
          lockStatus,
        } }
      : {};
    const ville = op.type === "chg" ? op.lot.vC : op.lot.vL;
    const cp = op.type === "chg" ? op.lot.cpC : op.lot.cpL;
    const labelOp = `${op.lot.cli} · ${ville} (${(cp || "").slice(0, 2)})`;

    const visibleParts = parts.filter(p => p.day >= 0 && p.day <= maxDay);
    if (visibleParts.length === 0 && parts.some(p => p.day > maxDay)) {
      // Overflow : marqueur sur dernier jour visible
      allBlocks.push({
        id: mkId(op.lot.id, op.type), type: op.type, day: maxDay, date: weekDays[maxDay] || "",
        lotId: op.lot.id, plId: vehicule.id,
        label: `${labelOp} (sem. suiv.)`, pills: ["→ sem. suiv."],
        km: 0, vol: op.lot.vol, duration: 1,
        startH: fin(maxDay) - 1, endH: fin(maxDay),
        startAbs: sched.startAbs, endAbs: sched.endAbs,
        chantier: op.lot.id,
        _overflow: true, _boucle: true, ...flags,
      });
    } else {
      visibleParts.forEach((p, pi) => {
        const partDur = p.hEnd - p.hStart;
        const pills = [`${op.lot.vol}m³`, `${fmtH(p.hStart)}-${fmtH(p.hEnd)}`];
        if (isMulti) pills.push(`${pi + 1}/${parts.length}`);
        const partLabel = isMulti && labelOp
          ? (pi === 0 ? `${labelOp} →` : pi === parts.length - 1 ? `→ ${labelOp.split("→").pop() || labelOp}` : `${labelOp} (suite)`)
          : labelOp;
        allBlocks.push({
          id: mkId(op.lot.id, op.type), type: op.type, day: p.day, date: weekDays[p.day] || "",
          lotId: op.lot.id, plId: vehicule.id,
          label: partLabel, pills,
          km: 0, vol: op.lot.vol,
          duration: partDur, startH: p.hStart, endH: p.hEnd,
        ...(horsPlageStandard(p.hStart, p.hEnd) ? { _horsPlageStd: true } : {}),
          startAbs: sched.startAbs, endAbs: sched.endAbs,
          chantier: op.lot.id,
          _segment: isMulti ? { part: pi, total: parts.length } : undefined,
          _boucle: true,
          _at: ptDe(op),
          _warning: opWarning,
          ...flags,
        });
      });
    }
    cursor = sched.endAbs;
    prevGps = op.gps;
  }

  // Retour dépôt final si pas skipRetourDepot
  if (!opts.skipRetourDepot) {
    const kmRetour = hav(prevGps, agGps);
    if (kmRetour > seuilRoute) {
      const durRet = Math.max(1, Math.ceil(kmRetour / vitesse));
      // RÈGLE VENDREDI : décaler le retour au lundi si il ne tient pas dans le vendredi
      const fr = enforceFridayRule(cursor, durRet, weekDays);
      if (fr.decale) cursor = fr.cursor;
      const sched = scheduleBlock(cursor, durRet, weekDays, plage);
      const parts = splitByDay(sched.startAbs, sched.endAbs, weekDays, plage);
      parts.forEach((p) => {
        if (p.day < 0 || p.day > maxDay) return;
        const partDur = p.hEnd - p.hStart;
        allBlocks.push({
          id: mkId(ops[ops.length - 1].lot.id, "vid"), type: "vid", day: p.day, date: weekDays[p.day] || "",
          lotId: ops[ops.length - 1].lot.id, plId: vehicule.id,
          label: ``, pills: [`${Math.round(kmRetour * partDur / durRet)}km`, `${fmtH(p.hStart)}-${fmtH(p.hEnd)}`],
          km: Math.round(kmRetour * partDur / durRet), vol: 0,
          duration: partDur, startH: p.hStart, endH: p.hEnd,
        ...(horsPlageStandard(p.hStart, p.hEnd) ? { _horsPlageStd: true } : {}),
          startAbs: sched.startAbs, endAbs: sched.endAbs,
          _from: ptDe(ops[ops.length - 1]), _to: ptDepot,
        });
      });
    }
  }

  return allBlocks;
}

// buildMutuChain — point d'entrée public de la chaîne mutualisée, avec la même garde week-end
// que buildChain (Q17 étendu au retour dépôt, 2026-07-22).
// Le retour dépôt d'une mutualisation souffrait du même angle mort : enforceFridayRule ne sait
// que DÉCALER le retour au lundi quand il ne tient pas avant vendredi DAY_END — laissant le PL
// (et les meubles de DEUX clients) immobilisé le week-end loin de la base.
//
// opts.gardeWeekendRetour : OPT-IN, à activer aux DEUX bouts du même candidat — simulation
//   (evalMutuSeq) ET pose (detectBoucles) — pour préserver l'invariant « proposé = posé ».
//   Conséquence utile : la chaîne décalée fait glisser les dates, que les contrôles de flex de
//   evalMutuSeq (allowedDatesAcc, ecartAcc/ecartAnc) valident ou rejettent ensuite. Le rejet d'une
//   mutualisation n'intervient donc qu'APRÈS avoir tenté le décalage, jamais d'emblée.
export function buildMutuChain(lotAcc, lotAnc, sequence, vehicule, weekDays, opts = {}, agencesData = []) {
  // Cf. buildChain : le signal « nuits hors dépôt » est dérivé à l'affichage, pas gravé ici.
  // Même garde-fou « jamais pire » que buildChain — voir son commentaire, il vaut aussi ici.
  const blocks = avecGardeJamaisPire(
    () => buildMutuChainGardeWeekend(lotAcc, lotAnc, sequence, vehicule, weekDays, opts, agencesData),
    () => buildMutuChainGardeWeekend(lotAcc, lotAnc, sequence, vehicule, weekDays, { ...opts, appliquerPlageLot: false }, agencesData),
    opts, plagesCommunes(lotAcc, lotAnc), weekDays,
  );
  // Nuits à portée du dépôt — même post-passe que buildChain, sur la chaîne retenue.
  marquerNuitsAuDepot(blocks, vehicule, weekDays, agencesData, opts.rules);
  return blocks;
}

function buildMutuChainGardeWeekend(lotAcc, lotAnc, sequence, vehicule, weekDays, opts = {}, agencesData = []) {
  const blocks = buildMutuChainInterne(lotAcc, lotAnc, sequence, vehicule, weekDays, opts, agencesData);
  // 🔴 LA GARDE VAUT AUSSI SUR UNE PAIRE ENCHAÎNÉE (`skipRetourDepot`) — correctif 2026-09-15, le même
  // que `buildChainGardeWeekend` a reçu le 2026-07-24 (CHT-003327) et que la paire n'avait jamais
  // reçu. `skipRetourDepot` ne supprime que le retour dépôt FINAL ; la COUPURE du vendredi est
  // INTERNE à la chaîne (chargement vendredi / route lundi). Sortir ici dès qu'un lot suit la paire
  // laissait le camion passer le week-end CHARGÉ chez le client — Q17 violée à la pose, et un écart
  // « proposé ≠ posé » sur la tournée à trois (la recherche simule la paire AVEC sa coupure). Cas
  // fondateur : paire 42-42703 + 12-61204, retour 35-21043 (vivier du 2026-09-14) — chargement à
  // Lanester le vendredi 25/09, départ de Lanester le lundi, retour annoncé 29/09 posé 30/09.
  // Un maillon enchaîné ne dessine pas de retour final : `chaineTraverseWeekend` contrôle alors son
  // segment de queue ouvert, et la coupure (remède 1) s'insère sans rentrée finale.
  if (!opts.gardeWeekendRetour) return blocks;
  if (!chaineTraverseWeekend(blocks, weekDays)) return blocks;

  // Remède 1 — coupure au dépôt après le chargement de fin de semaine (préféré : tient les dates
  // de chargement promises aux clients). Identique à buildChain : essayé AVANT le décalage global.
  const coupure = buildMutuChainInterne(
    lotAcc, lotAnc, sequence, vehicule, weekDays,
    { ...opts, coupureDepotApresChg: true, gardeWeekendRetour: false },
    agencesData,
  );
  if (coupure.length && !chaineTraverseWeekend(coupure, weekDays)) {
    debug.inc("weekend_coupures_depot_mutu");
    debug.log("BUILDCHAIN", `  MUTU ${lotAcc.id}+${lotAnc.id} coupure au dépôt après chargement (règle week-end Q17)`);
    return coupure;
  }

  // 🔴 Q17 — départ hors dépôt : pas de décalage au lundi, cf. `buildChainGardeWeekend`.
  if (opts.departHorsDepot) return q17SansRemede(blocks, weekDays, `MUTU ${lotAcc.id}+${lotAnc.id}`, "hors_depot");

  // Remède 2 — décalage de toute la tournée au lundi suivant (la date de chargement n'est plus tenue).
  const premierJour = blocks.filter(b => !b._overflow && b.day >= 0)
    .reduce((min, b) => Math.min(min, b.day), Infinity);
  const vendrediIdx = findFridayIdx(premierJour, weekDays);
  const lundiIdx = findNextMondayIdx(vendrediIdx, weekDays);
  // Dernier recours n° 1 — cf. `q17SansRemede` : on pose en le DISANT, on ne fait pas disparaître.
  if (lundiIdx < 0) return q17SansRemede(blocks, weekDays, `MUTU ${lotAcc.id}+${lotAnc.id}`, "hors_axe");

  const retente = buildMutuChainInterne(
    lotAcc, lotAnc, sequence, vehicule, weekDays,
    { ...opts, startCursorAbs: toAbs(lundiIdx, DAY_START), gardeWeekendRetour: false },
    agencesData,
  );
  // Repli identique à buildChain : si même un départ le lundi ne suffit pas (mission
  // intrinsèquement > 1 semaine), on conserve la chaîne d'origine — en la SIGNALANT.
  if (!retente.length || chaineTraverseWeekend(retente, weekDays)) {
    return q17SansRemede(blocks, weekDays, `MUTU ${lotAcc.id}+${lotAnc.id}`, "trop_long");
  }

  debug.inc("weekend_decalages_retour_mutu");
  debug.log("BUILDCHAIN", `  MUTU ${lotAcc.id}+${lotAnc.id} chaîne décalée au lundi (règle week-end retour Q17) · jour ${premierJour} → ${lundiIdx}`);
  return retente;
}
