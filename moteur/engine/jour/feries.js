// ── LES JOURS FÉRIÉS (Louis, 2026-09-27 : « comme les week-ends, pour l'affichage ET pour le moteur ») ──
//
// Les 11 jours fériés nationaux (Code du travail, art. L3133-1). Un jour férié se traite COMME UN
// WEEK-END : aucune opération ce jour-là, et le camion est au dépôt — la règle d'or (Q17) s'étend aux
// fériés, avec la même absoluité : ce n'est pas un réglage. Ce fichier ne fait que DIRE quels jours
// sont fériés ; c'est le calcul (`calendrier.js`, `passe.js`) qui en tire la règle.
//
// ❓ Non traités : les deux fériés propres à l'Alsace-Moselle (Vendredi saint, 26 décembre) —
// question ouverte, `essais-v2/CONCEPTS-METIER.md` § « Retours du 27/09 ».
//
// Pur et sans horloge : la même date rend toujours la même réponse. Contrat partagé par le moteur,
// le planning, la fiche et l'écran de proposition — un seul endroit sait ce qu'est un férié.

const FIXES = [
  ["01-01", "Jour de l'an"],
  ["05-01", "Fête du travail"],
  ["05-08", "Victoire 1945"],
  ["07-14", "Fête nationale"],
  ["08-15", "Assomption"],
  ["11-01", "Toussaint"],
  ["11-11", "Armistice"],
  ["12-25", "Noël"],
];

// Dimanche de Pâques (calendrier grégorien, algorithme dit « anonyme » de Meeus/Jones/Butcher).
function paques(annee) {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(annee, mois - 1, jour);
}

const MS_JOUR = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// Les fériés d'une année, en table « AAAA-MM-JJ » → nom. Mémoïsée : une année se calcule une fois.
const memo = new Map();
export function feriesDeLAnnee(annee) {
  if (memo.has(annee)) return memo.get(annee);
  const t = new Map(FIXES.map(([md, nom]) => [`${annee}-${md}`, nom]));
  const p = paques(annee);
  t.set(iso(p + 1 * MS_JOUR), "Lundi de Pâques");
  t.set(iso(p + 39 * MS_JOUR), "Ascension");
  t.set(iso(p + 50 * MS_JOUR), "Lundi de Pentecôte");
  memo.set(annee, t);
  return t;
}

// Le nom du férié qui tombe ce jour-là, ou `null`.
export function nomFerie(dateIso) {
  const annee = Number(String(dateIso).slice(0, 4));
  if (!annee) return null;
  return feriesDeLAnnee(annee).get(String(dateIso).slice(0, 10)) || null;
}

// Vrai si le jour est férié (quel que soit le jour de la semaine : un férié qui tombe un samedi est
// déjà un week-end, cela ne change rien).
export const estFerie = (dateIso) => nomFerie(dateIso) !== null;
