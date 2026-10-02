// ── LES CONTRÔLES ENTRE TOURNÉES ───────────────────────────────────────────────────────────────
//
// `evaluerTournee` ne voit qu'une tournée à la fois : elle ne peut pas savoir que le camion qu'on
// lui donne est déjà dehors. C'est le rôle de ce fichier — et il n'en fait pas plus. Tout ce qui se
// juge à l'intérieur d'une tournée reste dans `tournee.js`.

import { evaluerTournee } from "./tournee.js";
import { fusionnerReglages } from "./reglages.js";
import { jourOuvre } from "./calendrier.js";

// Date pour l'écran : « lun. 19/10 ». Mêmes conventions que `tournee.js`.
const JOURS_SEM = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const jfr = (iso) => {
  if (!iso) return "sans date";
  const [y, m, d] = String(iso).split("-");
  return `${JOURS_SEM[new Date(Date.UTC(+y, +m - 1, +d)).getUTCDay()]} ${d}/${m}`;
};

// Deux périodes [début, fin] en jours ouvrés se chevauchent-elles ? Bornes INCLUSES : à la maille
// de la journée, un camion rentré le mardi et reparti le mardi a deux tournées ce jour-là. Rend le
// nombre de jours ouvrés COMMUNS (0 = aucun chevauchement).
function joursCommuns(a, b) {
  const a0 = jourOuvre(a[0]), a1 = jourOuvre(a[1]);
  const b0 = jourOuvre(b[0]), b1 = jourOuvre(b[1]);
  if (a0 === null || a1 === null || b0 === null || b1 === null) return 0;
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0) + 1);
}

// ── LE JOUR DE CONTACT (décision de Louis, 2026-09-24) ─────────────────────────────────────────
// Deux tournées du même camion qui partagent UN SEUL jour ne se chevauchent pas forcément : l'une
// peut finir le matin et l'autre partir l'après-midi. `reglages.contactJour` dit comment on en
// juge, à partir des instants de départ et de retour (`sortiesFines` de `evaluerTournee`) :
//   · "demi_journee" (défaut) — admis si la première a rendu le camion dans une demi-journée
//     ANTÉRIEURE à celle où la seconde le prend (rentrée le matin, repartie l'après-midi) ;
//   · "fin" — admis si la première est rentrée avant que la seconde parte, au fil du temps ;
//   · "aucun" — bornes incluses sans exception (le comportement d'avant le 24/09).
// Deux jours communs, ou des instants inconnus : c'est un chevauchement, `camionDejaPris` s'applique.
const AVANT = 1e-6;
function contactAdmis(finesA, finesB, mode) {
  if (mode !== "demi_journee" && mode !== "fin") return false;
  if (!finesA || !finesB) return false;
  const [premiere, seconde] = finesA[0] <= finesB[0] ? [finesA, finesB] : [finesB, finesA];
  const retour = premiere[1], depart = seconde[0];
  if (mode === "fin") return retour <= depart + 1e-9;
  return Math.floor(retour - AVANT) < Math.floor(depart + 1e-9);
}

const aUneConfirmation = (t) => (t.lots || []).some(l => l.chg?.confirme || l.liv?.confirme);

// Le nom d'une tournée pour l'écran (retours de Louis du 29/09) : ses lots, joints par « + »
// (« la tournée BLAVIER + DUREL »), dans l'ordre de leur premier arrêt — l'identifiant (« T1 »)
// ne dit rien au planificateur. L'entrée d'`evaluerPlanning` porte les lots de chaque tournée
// (`lots[].nom`, à défaut `lots[].id`) ; sans lot, on garde l'identifiant.
function nomTournee(t) {
  const lots = t.lots || [];
  const nomDe = new Map(lots.map(l => [l.id, l.nom || l.id]));
  const ids = [...new Set([...(t.ordre || []).map(a => a.lot), ...lots.map(l => l.id)])].filter(id => nomDe.has(id));
  return ids.length ? ids.map(id => nomDe.get(id)).join(" + ") : t.id;
}

// `options.touchee` (facultatif) : l'id — ou la liste d'ids — de la tournée que le geste vient de
// toucher. Sous « rouge_si_brouillon » / « orange_si_brouillon » (plus le défaut depuis D9, 24/09 :
// le défaut est « refus », quel que soit l'engagement), le contrat juge « l'AUTRE » tournée : rouge
// (ou orange) si elle est en brouillon, refus si elle porte une confirmation. Sans cette option, le module ne sait pas laquelle est « l'autre » et garde le
// jugement d'avant le 2026-09-23 (engagée si l'une OU l'autre porte une confirmation) —
// rétro-compatible avec la maquette et le banc, qui ne la passent pas.
function autreEngagee(A, B, touchees) {
  const tA = touchees.has(A.id), tB = touchees.has(B.id);
  if (tA && !tB) return aUneConfirmation(B);
  if (tB && !tA) return aUneConfirmation(A);
  return aUneConfirmation(A) || aUneConfirmation(B);
}

export function evaluerPlanning({ tournees }, reglagesPartiels, options = {}) {
  const R = fusionnerReglages(reglagesPartiels);
  const liste = tournees || [];
  const touchee = options?.touchee;
  const touchees = new Set(touchee === undefined || touchee === null ? [] : [].concat(touchee));
  const parTournee = {};
  for (const t of liste) parTournee[t.id] = evaluerTournee(t, reglagesPartiels);

  const signaux = [];
  for (let i = 0; i < liste.length; i++) {
    for (let j = i + 1; j < liste.length; j++) {
      const A = liste[i], B = liste[j];
      const camA = A.camion?.id, camB = B.camion?.id;
      if (!camA || camA !== camB) continue;

      // On juge l'OCCUPATION du camion (les sorties, prolongées à travers une coupure CHARGÉE :
      // un camion rentré au dépôt avec les meubles d'une tournée n'est pas libre pour une autre).
      // Repli sur `sorties` pour un résultat qui ne la porterait pas.
      const rA = parTournee[A.id], rB = parTournee[B.id];
      const pA = rA.occupations || rA.sorties, pB = rB.occupations || rB.sorties;
      const fA = rA.occupations ? rA.occupationsFines : rA.sortiesFines;
      const fB = rB.occupations ? rB.occupationsFines : rB.sortiesFines;
      for (let ia = 0; ia < pA.length; ia++) {
        for (let ib = 0; ib < pB.length; ib++) {
          const sA = pA[ia], sB = pB[ib];
          const communs = joursCommuns(sA, sB);
          if (communs === 0) continue;
          if (communs === 1 && contactAdmis(fA?.[ia], fB?.[ib], R.contactJour)) continue;
          // « rouge_si_brouillon » : on n'interdit que si l'AUTRE tournée est déjà engagée auprès
          // d'un client. Tant qu'elle est en brouillon, le planificateur arbitre.
          // « orange_si_brouillon » : même règle, un cran plus bas tant que l'autre est en brouillon.
          const engage = autreEngagee(A, B, touchees);
          const mode = R.niveaux.camionDejaPris;
          const niveau = mode === "rouge_si_brouillon" ? (engage ? "refus" : "rouge")
            : mode === "orange_si_brouillon" ? (engage ? "refus" : "orange")
              : mode;
          signaux.push({
            niveau, code: "CAMION_DEJA_PRIS", lot: null, type: null,
            tournees: [A.id, B.id],
            message: `Le camion ${camA} est déjà dehors du ${jfr(sB[0])} au ${jfr(sB[1])} pour la tournée ${nomTournee(B)} : il ne peut pas sortir du ${jfr(sA[0])} au ${jfr(sA[1])} pour la tournée ${nomTournee(A)}.`,
            detail: {
              camion: camA, tournees: [A.id, B.id], periodes: [sA, sB], engage,
              touchee: touchees.has(A.id) && !touchees.has(B.id) ? A.id
                : touchees.has(B.id) && !touchees.has(A.id) ? B.id : null,
            },
          });
        }
      }
    }
  }
  return { parTournee, signaux };
}
