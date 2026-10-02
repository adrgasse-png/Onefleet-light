// ── L'AXE DES JOURS OUVRÉS ─────────────────────────────────────────────────────────────────────
//
// Port fidèle de `essais-v2/essai-2/lib/evaluateur-jour.mjs`. Le principe : les samedis et les
// dimanches ne sont PAS sur l'axe. Une semaine vaut 5 cases, et « le camion rentre avant le
// week-end » (Q17) s'exprime alors comme « la sortie tient dans un bloc de 5 cases » — sans jamais
// manipuler de date ni de jour de la semaine dans le calcul. C'est ce qui rend la règle d'or
// structurelle plutôt que vérifiée après coup.
//
// Le temps se compte en DEMI-JOURNÉES : `t = 2 × jourOuvré + (0 = matin | 1 = après-midi)`.
//
// ── LES JOURS FÉRIÉS : DES CASES FERMÉES (Louis, 2026-09-27 : « comme les week-ends ») ─────────
// Un férié qui tombe en semaine RESTE une case de l'axe — l'arithmétique `sem × 5 + j` ne bouge
// pas, et toutes les dates de la maquette, du banc et de la recherche gardent leur index. Mais c'est
// une case FERMÉE : aucune opération n'y commence, et aucune sortie du dépôt ne la traverse. La
// semaine se découpe donc en BLOCS de jours ouverts consécutifs (une semaine sans férié = un bloc de
// 5 cases), et Q17 s'énonce désormais « la sortie tient dans un BLOC » — la même règle, avec la même
// absoluité : le camion rentre au dépôt avant le férié (chargé s'il le faut, C6) et repart après.
// Sans férié dans la semaine, chaque fonction de bloc ci-dessous rend EXACTEMENT ce que rendait
// l'expression d'origine (`finDeSemaine`, `2 × 5 × semaine`) : c'est ce que vérifie l'épreuve
// différentielle, et le test `feries.test.js` sur des semaines sans férié.

import { estFerie } from "./feries.js";

export const JOURS_SEMAINE = 5;

// Lundi 5 janvier 2026 — l'origine de l'axe. Une constante, jamais l'horloge : le module doit
// rendre la même chose aujourd'hui et dans six mois.
const ORIGINE = Date.UTC(2026, 0, 5);
const MS_JOUR = 86400000;

// ISO « AAAA-MM-JJ » → index de jour ouvré, ou `null` si la date tombe un samedi/dimanche.
export function jourOuvre(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return null;
  const delta = Math.round((Date.UTC(y, m - 1, d) - ORIGINE) / MS_JOUR);
  const sem = Math.floor(delta / 7);
  const jS = delta - 7 * sem;
  if (jS >= JOURS_SEMAINE) return null;
  return sem * JOURS_SEMAINE + jS;
}

// Index de jour ouvré → ISO.
export function isoDeJour(i) {
  const sem = Math.floor(i / JOURS_SEMAINE);
  const jS = i - sem * JOURS_SEMAINE;
  return new Date(ORIGINE + (sem * 7 + jS) * MS_JOUR).toISOString().slice(0, 10);
}

// Décale de n jours OUVRÉS (n peut être négatif).
export function decalerJours(iso, n) {
  const j = jourOuvre(iso);
  if (j === null) return null;
  return isoDeJour(j + n);
}

// Jour ouvré le plus proche VERS L'AVANT — la borne BASSE d'une fenêtre de flex qui tomberait
// un samedi. Un férié se traite comme un samedi (27/09) : on avance jusqu'au premier jour OUVERT.
export function jourOuvreOuSuivant(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return null;
  const delta = Math.round((Date.UTC(y, m - 1, d) - ORIGINE) / MS_JOUR);
  for (let k = 0; k < 7; k++) {
    const sem = Math.floor((delta + k) / 7);
    const jS = delta + k - 7 * sem;
    if (jS < JOURS_SEMAINE) return ouvertOuSuivant(sem * JOURS_SEMAINE + jS);
  }
  return null;
}

// Jour ouvré le plus proche VERS L'ARRIÈRE — la borne HAUTE d'une fenêtre de flex. Ajout au port :
// sans elle, une flex qui se termine un dimanche serait arrondie au lundi SUIVANT, c'est-à-dire
// élargie d'un jour ouvré au détriment du client. Un férié se traite comme un dimanche (27/09) : on
// recule jusqu'au dernier jour OUVERT.
export function jourOuvreOuPrecedent(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return null;
  const delta = Math.round((Date.UTC(y, m - 1, d) - ORIGINE) / MS_JOUR);
  for (let k = 0; k < 7; k++) {
    const sem = Math.floor((delta - k) / 7);
    const jS = delta - k - 7 * sem;
    if (jS < JOURS_SEMAINE) return ouvertOuPrecedent(sem * JOURS_SEMAINE + jS);
  }
  return null;
}

// Vrai si la date ISO tombe un samedi ou un dimanche — le seul endroit du module qui a besoin de
// nommer le week-end, pour le signal `DATE_NON_OUVREE`.
export function estWeekEnd(iso) {
  return jourOuvre(iso) === null;
}

// ── LES CASES FERMÉES ET LES BLOCS ─────────────────────────────────────────────────────────────
// Le masque des cases fermées d'une semaine de l'axe (bit k = le k-ième jour ouvré est férié),
// mémoïsé par semaine : la passe interroge ces fonctions à chaque arrêt de chaque séquence
// énumérée, et une semaine ne se calcule qu'une fois. Pur et sans horloge.
const MEMO_SEMAINE = new Map();
function masqueFermes(sem) {
  let m = MEMO_SEMAINE.get(sem);
  if (m === undefined) {
    m = 0;
    for (let k = 0; k < JOURS_SEMAINE; k++) if (estFerie(isoDeJour(sem * JOURS_SEMAINE + k))) m |= 1 << k;
    MEMO_SEMAINE.set(sem, m);
  }
  return m;
}

// Vrai si l'index de jour ouvré `j` est une case FERMÉE (un férié tombé en semaine).
export function estFerme(j) {
  const sem = Math.floor(j / JOURS_SEMAINE);
  return (masqueFermes(sem) & (1 << (j - sem * JOURS_SEMAINE))) !== 0;
}

// Vrai si la date ISO est un jour sans opération : samedi, dimanche ou férié.
export function estJourFerme(iso) {
  const j = jourOuvre(iso);
  return j === null || estFerme(j);
}

// Premier jour OUVERT à partir de `j` (inclus) — et, symétrique, dernier jour ouvert jusqu'à `j`.
// Deux fériés se suivent au plus (une Ascension un 7 mai, veille du 8 mai) ; la borne de 10 est
// une sécurité, jamais atteinte.
export function ouvertOuSuivant(j) {
  let k = j;
  for (let n = 0; n < 10 && estFerme(k); n++) k++;
  return k;
}
export function ouvertOuPrecedent(j) {
  let k = j;
  for (let n = 0; n < 10 && estFerme(k); n++) k--;
  return k;
}

// Nombre de cases fermées dans [a, b] (bornes incluses, dans n'importe quel ordre).
export function fermesEntre(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  let n = 0;
  for (let s = Math.floor(lo / JOURS_SEMAINE); s <= Math.floor(hi / JOURS_SEMAINE); s++) {
    const m = masqueFermes(s);
    if (m === 0) continue;
    for (let k = 0; k < JOURS_SEMAINE; k++) {
      const j = s * JOURS_SEMAINE + k;
      if (j >= lo && j <= hi && (m & (1 << k))) n++;
    }
  }
  return n;
}

// L'écart de `a` à `b` en jours OUVERTS (signé) : ce que dirait un planificateur. Un férié entre les
// deux ne compte pas, comme un week-end — du mardi au jeudi d'une semaine au mercredi férié, il y a
// UN jour. Sans férié entre les deux : `b − a`, exactement.
export function ecartOuvre(a, b) {
  if (b === a) return 0;
  return b > a ? b - a - fermesEntre(a + 1, b) : -(a - b - fermesEntre(b + 1, a));
}

// `j` décalé de `n` jours OUVERTS (n signé), en sautant les cases fermées. Sans férié : `j + n`.
export function decalerOuvres(j, n) {
  let k = j;
  const pas1 = n >= 0 ? 1 : -1;
  for (let r = Math.abs(n); r > 0;) {
    k += pas1;
    if (!estFerme(k)) r--;
  }
  return k;
}

// ── LES BORNES D'UN BLOC (Q17 généralisée) ─────────────────────────────────────────────────────
// Toutes rendent un INDEX DE JOUR ouvré ; l'appelant multiplie par 2 pour l'axe des demi-journées.
//
// Fin (EXCLUE) du bloc qui contient `j` : le premier jour fermé qui suit `j` dans sa semaine, sinon
// le lundi suivant. Une case fermée n'appartient à aucun bloc : son bloc « finit » à son propre
// début (rien n'y tient). Sans férié : `JOURS_SEMAINE × (semaine + 1)` — le `finDeSemaine` d'origine.
export function finDeBlocJ(j) {
  const sem = Math.floor(j / JOURS_SEMAINE);
  const m = masqueFermes(sem);
  if (m === 0) return JOURS_SEMAINE * (sem + 1);
  for (let k = j - sem * JOURS_SEMAINE; k < JOURS_SEMAINE; k++) if (m & (1 << k)) return sem * JOURS_SEMAINE + k;
  return JOURS_SEMAINE * (sem + 1);
}

// Premier jour du bloc SUIVANT celui qui contient `j` : on saute la fin du bloc puis les cases
// fermées qui la suivent (un lundi de Pâques repousse au mardi). Sans férié : le lundi suivant.
export function debutBlocSuivantJ(j) {
  return ouvertOuSuivant(finDeBlocJ(j));
}

// Premier jour du bloc qui contient `j` — le plus tôt qu'un camion puisse quitter le dépôt pour
// un arrêt du jour `j` sans traverser de case fermée. Pour une case fermée : le bloc qui la suit.
// Sans férié : le lundi de la semaine de `j` (le `2 × 5 × semaine` d'origine, divisé par 2).
export function debutDeBlocJ(j) {
  if (estFerme(j)) return debutBlocSuivantJ(j);
  const sem = Math.floor(j / JOURS_SEMAINE);
  const m = masqueFermes(sem);
  if (m === 0) return JOURS_SEMAINE * sem;
  for (let k = j - sem * JOURS_SEMAINE - 1; k >= 0; k--) if (m & (1 << k)) return sem * JOURS_SEMAINE + k + 1;
  return JOURS_SEMAINE * sem;
}

// Vrai si le bloc qui contient `j` est une semaine entière (aucun férié dans la semaine) : le plus
// long bloc possible. Une mission qui n'y tient pas ne tiendra dans aucun.
export function blocComplet(j) {
  return masqueFermes(Math.floor(j / JOURS_SEMAINE)) === 0;
}

// ── LE TEMPS EN DEMI-JOURNÉES, ENTIER OU CONTINU ───────────────────────────────────────────────
// En mode `arrondi: "demi_journee"` (le prototype) `t` est un ENTIER de demi-journées. En mode
// `"fin"` c'est un FLOTTANT sur le même axe. Les deux epsilons ci-dessous séparent deux besoins
// qu'on confond facilement :
//   · EPS   — tolérance d'ÉGALITÉ, pour que 6.000000001 ≤ 6 reste vrai ;
//   · AVANT — le « juste avant » : de combien reculer pour désigner le dernier instant OCCUPÉ par
//             un intervalle qui se termine en `t`. Une demi-journée en mode entier, un cheveu en
//             mode continu.
export const EPS = 1e-9;
const AVANT = 1e-6;

// Jour ouvré qui CONTIENT l'instant `t` (début inclus).
export const jourDe = (t) => Math.floor(t / 2 + EPS);

// Dernier jour ouvré OCCUPÉ par un intervalle qui se termine en `t`. `continu` = mode "fin".
export const jourFinDe = (t, continu = false) => Math.floor((t - (continu ? AVANT : 1)) / 2 + EPS);

export const semaineDe = (j) => Math.floor(j / JOURS_SEMAINE);

// Première demi-journée du lundi SUIVANT la semaine du jour `j`. C'était la borne (exclue) avant
// laquelle toute sortie du dépôt devait être terminée ; depuis les fériés (27/09), c'est `finDeBloc`
// qui la porte — elle lui est égale sur une semaine sans férié.
export const finDeSemaine = (j) => 2 * JOURS_SEMAINE * (semaineDe(j) + 1);

// Les mêmes bornes de bloc, en DEMI-JOURNÉES — ce que la passe manipule.
//   · `finDeBloc(j)`       — la borne (exclue) avant laquelle une sortie partie le jour `j` doit être
//                             rentrée : le début du premier férié qui suit, sinon le lundi suivant ;
//   · `debutBlocSuivant(j)` — la première demi-journée où le camion peut repartir après ce bloc ;
//   · `debutDeBloc(j)`      — la première demi-journée où il peut partir pour un arrêt du jour `j`.
export const finDeBloc = (j) => 2 * finDeBlocJ(j);
export const debutBlocSuivant = (j) => 2 * debutBlocSuivantJ(j);
export const debutDeBloc = (j) => 2 * debutDeBlocJ(j);
