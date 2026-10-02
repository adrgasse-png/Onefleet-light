// ── WEEK HELPERS ──
export function getMonday(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day; // snap to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// Numéro de semaine ISO 8601 (1..53) — pour afficher « S30 » à côté d'un lot placé.
export function getWeekNumber(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T12:00:00");
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // Lun=0 … Dim=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // jeudi de la semaine
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((target - firstThursday) / (7 * 24 * 3600 * 1000));
}

export function getWeekDays(weekStart) {
  const monday = getMonday(weekStart);
  const d = new Date(monday + "T12:00:00");
  const days = [];
  for (let i = 0; i < 5; i++) {
    const dd = new Date(d);
    dd.setDate(d.getDate() + i);
    days.push(dd.toISOString().slice(0, 10));
  }
  return days;
}

// Returns 9 days : 2 days of previous week (Thu, Fri) + 5 days current week + 2 days next week (Mon, Tue)
// This allows the planner to anticipate and smooth the planning across week boundaries.
export function getExtendedDays(weekStart) {
  const monday = getMonday(weekStart);
  const d0 = new Date(monday + "T12:00:00");
  const days = [];
  // 2 days before: Thu (-4) and Fri (-3) of previous week
  for (let offset of [-4, -3]) {
    const dd = new Date(d0); dd.setDate(d0.getDate() + offset);
    days.push(dd.toISOString().slice(0, 10));
  }
  // 5 days of current week (Mon-Fri)
  for (let i = 0; i < 5; i++) {
    const dd = new Date(d0); dd.setDate(d0.getDate() + i);
    days.push(dd.toISOString().slice(0, 10));
  }
  // 2 days after: Mon (+7) and Tue (+8) of next week
  for (let offset of [7, 8]) {
    const dd = new Date(d0); dd.setDate(d0.getDate() + offset);
    days.push(dd.toISOString().slice(0, 10));
  }
  return days;
}

// Axe de jours ouvrés consécutifs (sans weekends), à partir du lundi <= startISO.
// Sert de fenêtre interne au planificateur (buildChain) quand on a besoin d'estimer
// des dates au-delà des 9 jours affichés — indépendant de la semaine visualisée.
export function buildWorkAxis(startISO, n) {
  const out = [];
  const d = new Date(getMonday(startISO) + "T12:00:00");
  while (out.length < n) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(d).toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function getDaysInRange(dateC, dateL) {
  const start = new Date(dateC + "T12:00:00");
  const end = new Date((dateL || dateC) + "T12:00:00");
  if (end < start) return [dateC];
  const arr = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    arr.push(new Date(d).toISOString().slice(0, 10));
  }
  return arr;
}

export const JOUR_NAMES = ["Lun", "Mar", "Mer", "Jeu", "Ven"];
export const JOUR_NAMES_EXT = ["Jeu", "Ven", "Lun", "Mar", "Mer", "Jeu", "Ven", "Lun", "Mar"];
// `IS_WEEK_BOUNDARY` et `IS_CURRENT_WEEK` ont été RETIRÉS le 2026-08-22. Ils servaient à griser les
// quatre colonnes voisines et à poser un double filet à la frontière de semaine : ces quatre
// colonnes n'existent plus (elles tiennent en deux gouttières, cf. `GRID_COLS` ci-dessous), et la
// frontière se lit maintenant au changement de fond de la gouttière — un double filet en plus
// n'aurait fait que redire la même chose. Leur remplaçant est `JOURS_SEMAINE`.

// ── LES COLONNES DU GANTT — 9 JOURS, 8 COLONNES (arbitrage Louis 2026-08-22) ────────────────────
//
// La fenêtre affichée couvre neuf jours : les deux derniers de la semaine précédente, les cinq de
// la semaine courante, les deux premiers de la suivante. Elle occupait autant de colonnes,
// larges — `200px 140px 140px 180px×5 140px 140px`, soit **1 660 px**. Deux conséquences, toutes
// deux mesurées à l'écran :
//   • la semaine courante ne commençait qu'au 480ᵉ pixel, derrière 280 px de semaine PRÉCÉDENTE ;
//   • sur un écran de 1 600 px, le vendredi tombait donc hors champ dès l'ouverture — la colonne
//     qu'on regarde le plus était la seule qu'il fallait aller chercher.
//
// Les quatre jours voisins tenaient en DEUX gouttières de 34 px (`GouttiereVoisine`), et les cinq
// jours de la semaine se partagent tout le reste. Ce qui se passe chez les voisins n'est pas
// effacé : la gouttière compte les opérations et mène à leur semaine d'un clic.
//
// 🔁 RETOUCHE (chantier UX 2026-09-14, Louis : « le vendredi d'avant et le lundi d'après doivent
// figurer, en grisé »). Chaque gouttière ne combine plus deux jours (jeudi+vendredi / lundi+mardi)
// : elle n'en montre plus qu'UN — le jour collé à la semaine affichée (`JOURS_AVANT[1]`,
// `JOURS_APRES[0]`, cf. plus bas), avec sa date en clair au lieu d'un simple chevron. Le jour le
// plus éloigné (jeudi d'avant, mardi d'après) sort de l'affichage — il n'était de toute façon
// jamais qu'un chiffre agrégé dans les 34 px, jamais distingué.
//
// 🔁 RETOUCHE (chantier UX v6, lot L5, 2026-09-15 — Louis : « élargir les jours de la semaine
// suivante et précédente »). `GouttiereVoisine` (un chiffre agrégé + trois puces de couleur) est
// RETIRÉ : le jour voisin devient une VRAIE `PlanningCell` (prop `voisin`), qui rend ses vrais
// blocs grisés — colonne ~60 % d'un jour de la semaine, pas 46 px fixes : `minmax(66px, .6fr)`
// plutôt qu'une largeur en dur, pour qu'elle respire comme les cinq colonnes `1fr` sur un grand
// écran sans jamais descendre sous 66 px (assez pour un tag CHG/LIV lisible en compact). La colonne
// camion (150px) est inchangée par cette retouche.
export const GRID_COLS = "150px minmax(66px, .6fr) repeat(5, minmax(110px, 1fr)) minmax(66px, .6fr)";

// La colonne de grille où tombe chaque jour de la fenêtre (la colonne 1 porte le nom du camion).
// Les jours 0 et 1 partagent la gouttière de gauche, les jours 7 et 8 celle de droite.
export const COL_DU_JOUR = [2, 2, 3, 4, 5, 6, 7, 8, 8];
// Les jours groupés derrière chaque gouttière, et ceux de la semaine courante.
export const JOURS_AVANT = [0, 1];
export const JOURS_APRES = [7, 8];
export const JOURS_SEMAINE = [2, 3, 4, 5, 6];

// La colonne d'un jour, bornée — un index hors fenêtre retombe sur la gouttière la plus proche
// plutôt que de produire un `gridColumn` invalide, qui casserait toute la ligne en silence.
export function colDuJour(i) {
  if (!(i >= 0)) return COL_DU_JOUR[0];
  return COL_DU_JOUR[Math.min(i, COL_DU_JOUR.length - 1)];
}

export function fmtDateShort(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

export function fmtDateFR(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// « ven. 02/10 » — le jour de la semaine compte pour un planificateur (le vendredi, c'est Q17).
export function fmtJourDateCourt(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  const jour = d.toLocaleDateString("fr-FR", { weekday: "short" });
  return `${jour} ${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`;
}

// « jeudi 17 sept. » — le séparateur de jour d'une liste triée par date (bandeau, J3 du 2026-09-16).
export function fmtJourDateLong(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" });
}

export function fmtDateFRShort(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}
// Helper unique pour calculer une deadline planif.
// dateRef : date ISO de référence (généralement dateC du lot)
// joursAvant : nombre de jours à soustraire (0 = deadline = dateRef elle-même, n = dateRef - n)
// Si la deadline calculée est dans le passé → ramenée au jour courant.
// Pour les lots CALLBACK (pas de PL dispo), passer joursAvant=null → deadline = aujourd'hui.
export function computeDeadline(dateRef, joursAvant) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  if (joursAvant === null || joursAvant === undefined || !dateRef) {
    return today.toISOString().slice(0, 10);
  }
  const d = new Date(dateRef + "T12:00:00");
  d.setDate(d.getDate() - joursAvant);
  const chosen = d < today ? today : d;
  return chosen.toISOString().slice(0, 10);
}

// ── LA FENÊTRE DE FLEX DE CHARGEMENT — LE POINT D'APPLICATION UNIQUE ────────────────────────────
//
// Liste les dates ouvrées atteignables autour de `dateStr` : `reach` jours OUVRÉS en amont,
// `reach` jours OUVRÉS en aval, plus la date d'ancrage elle-même si elle est ouvrée.
//
// 🔴 UNITÉ = JOURS OUVRÉS (arbitrage Louis E1, 2026-09-02). Jusqu'ici cette fonction balayait
// `−reach … +reach` en jours de CALENDRIER puis jetait les samedis et dimanches : la largeur
// réelle de la fenêtre dépendait donc du jour de la semaine de l'ancrage. « 1 sem » (flex = 5)
// donnait ± 3 jours ouvrés depuis un mercredi, mais 3 avant / 4 après depuis un lundi — une
// fenêtre ASYMÉTRIQUE, que son libellé ne décrivait pas, et qu'aucun test ne voyait (ils
// vérifiaient tous des largeurs, jamais leur symétrie). On compte désormais en jours ouvrés des
// deux côtés : la fenêtre a la même largeur quel que soit le jour d'ancrage.
//
// ⚠️ CONSÉQUENCE ASSUMÉE (E7, tranché) : un lot déjà en base garde son `_flexC`, qui change
// simplement d'unité — un `5` vaut désormais 5 jours ouvrés, soit une fenêtre plus large qu'à sa
// saisie. Aucune reprise de données, aucune double règle dans le moteur.
//
// `fenetreMin` : plancher de la fenêtre, exprimé dans la même unité (jours ouvrés). Il sert aux
// appelants qui veulent au moins ± 1 jour ouvré dès que le client a accordé de la souplesse
// (`datesAround(d, flexC, flexC === 0 ? 0 : 1)`) — une flex de 0 reste une date STRICTE.
//
// 🔑 NE JAMAIS RÉÉCRIRE CE CALCUL AILLEURS : le moteur (`findBoucleCandidates`, `reflowVehicle`),
// le contrôle « sort de la fenêtre de flex » (`utils/datesBoucle.js`), la saisie et les scripts
// d'analyse lisent tous cette fonction. Deux implémentations divergeraient au premier correctif,
// et le moteur proposerait une date que le contrôle jugerait hors limites.
export function datesAround(dateStr, flexDays, fenetreMin = 0) {
  const reach = Math.max(fenetreMin || 0, flexDays || 0);
  const d0 = new Date(dateStr + "T12:00:00");
  const ouvre = (d) => d.getDay() !== 0 && d.getDay() !== 6;
  const iso = (d) => d.toISOString().slice(0, 10);

  // Amont : on remonte jusqu'à avoir compté `reach` jours OUVRÉS (les week-ends ne se comptent
  // pas, ils se traversent), puis on remet la liste dans l'ordre chronologique.
  const avant = [];
  const dA = new Date(d0);
  while (avant.length < reach) {
    dA.setDate(dA.getDate() - 1);
    if (ouvre(dA)) avant.push(iso(dA));
  }
  avant.reverse();

  // La date d'ancrage n'entre dans la fenêtre que si elle est elle-même ouvrée — un chargement
  // demandé un samedi n'a jamais été proposable ce jour-là, et ne le devient pas ici.
  const out = ouvre(d0) ? [...avant, iso(d0)] : [...avant];

  // Aval : symétrique de l'amont.
  const dB = new Date(d0);
  let apres = 0;
  while (apres < reach) {
    dB.setDate(dB.getDate() + 1);
    if (ouvre(dB)) { out.push(iso(dB)); apres++; }
  }
  return out;
}

export function diffDaysIso(a, b) {
  if (!a || !b) return 999;
  const d1 = new Date(a + "T12:00:00");
  const d2 = new Date(b + "T12:00:00");
  return Math.round((d2 - d1) / 86400000);
}

// Compte les jours OUVRÉS entre deux dates ISO (excl. weekends)
// Utilisé pour comparer avec joursMin/joursMax qui sont calculés en jours ouvrés
export function diffWorkdays(a, b) {
  if (!a || !b) return 999;
  let d = new Date(a + "T12:00:00");
  const end = new Date(b + "T12:00:00");
  let count = 0;
  while (d < end) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

// Détecte si un weekend s'intercale strictement entre dateAcc et dateAnc (exclu des deux bornes).
// Utilisé pour filtrer les boucles où un trajet inter-op traverserait un weekend
// (ex: op N vendredi, op N+1 mardi suivant → un weekend complet dans l'intervalle → le PL
// ne peut pas rester loin du dépôt pendant ce laps, la boucle sera silencieusement décalée).
// Retourne true si au moins un samedi ou dimanche se trouve strictement entre dateAcc et dateAnc.
export function hasWeekendBetween(dateAcc, dateAnc) {
  if (!dateAcc || !dateAnc) return false;
  const d1 = new Date(dateAcc + "T12:00:00");
  const d2 = new Date(dateAnc + "T12:00:00");
  if (d1 >= d2) return false;
  const d = new Date(d1);
  d.setDate(d.getDate() + 1);
  while (d < d2) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return true;
    d.setDate(d.getDate() + 1);
  }
  return false;
}
export function addDaysIso(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
export function nextWorkday(iso) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Retire n jours ouvrés
export function subWorkdays(iso, n) {
  if (!n || n <= 0) return iso;
  let d = new Date(iso + "T12:00:00");
  let removed = 0;
  while (removed < n) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) removed++;
  }
  return d.toISOString().slice(0, 10);
}

// Ajoute n jours ouvrés
export function addWorkdays(iso, n) {
  if (!n || n <= 0) return iso;
  let d = new Date(iso + "T12:00:00");
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}
// ── MOIS ── (calendrier de navigation du sélecteur de semaine)
// Toutes ces fonctions raisonnent en ISO `YYYY-MM-DD` comme le reste du fichier, et passent par
// `T12:00:00` pour ne jamais dépendre du fuseau horaire.

// Premier jour du mois d'une date.
export function startOfMonth(iso) {
  if (!iso) return "";
  return `${iso.slice(0, 7)}-01`;
}

// Décale de n mois (n négatif = recule). Le jour est ramené au dernier jour du mois cible quand il
// n'y existe pas : `addMonths("2026-01-31", 1)` → 28/02 et non 03/03, ce que ferait un `setMonth` nu.
export function addMonths(iso, n) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const total = (y * 12) + (m - 1) + n;
  const yCible = Math.floor(total / 12);
  const mCible = (total % 12) + 1;
  // Jour 0 du mois suivant = dernier jour du mois cible.
  const dernier = new Date(Date.UTC(yCible, mCible, 0)).getUTCDate();
  const jour = Math.min(d, dernier);
  return `${String(yCible).padStart(4, "0")}-${String(mCible).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
}

// Lundis des semaines qui couvrent le mois d'une date — une ligne de calendrier par lundi.
// La première et la dernière semaine débordent sur les mois voisins : c'est voulu, une semaine
// n'appartient pas à un mois, et le planning se lit toujours du lundi au vendredi.
export function semainesDuMois(iso) {
  const debut = getMonday(startOfMonth(iso));
  const finMois = addDaysIso(startOfMonth(addMonths(iso, 1)), -1);
  const derniereSemaine = getMonday(finMois);
  const out = [];
  let cur = debut;
  while (cur <= derniereSemaine) {
    out.push(cur);
    cur = addDaysIso(cur, 7);
  }
  return out;
}

// « septembre 2026 » — en-tête du calendrier.
export function fmtMoisFR(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

export function fmtDateRange(d1, d2) {
  if (!d1) return "";
  const s1 = fmtDateShort(d1);
  if (!d2 || d2 === d1) return s1;
  return `${s1}–${fmtDateShort(d2)}`;
}

// Une heure DÉCIMALE (`startH`/`endH` des blocs, 7 → 18 en standard, 5 → 21 en journée élargie)
// vers sa forme lisible « 5h30 » — minutes toujours sur deux chiffres, jamais tronquées (lot 7,
// § 11.1 : la carte de survol du signal « heures supp. » lit les bornes RÉELLES de la journée
// sur les blocs, jamais un texte fixe — encore faut-il les écrire proprement quand elles ne
// tombent pas sur l'heure ronde).
export function fmtHeureDecim(h) {
  if (!Number.isFinite(h)) return "";
  // Arrondir en MINUTES TOTALES d'abord, jamais heure puis minutes séparément : arrondir les deux
  // parts indépendamment peut rendre une retenue orpheline (`5.999` → H=5, m=round(59,94)=60 →
  // "5h60", jamais "6h00"). Un seul arrondi, puis on redécoupe.
  const totalMin = Math.round(h * 60);
  const H = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${H}h${String(m).padStart(2, "0")}`;
}
