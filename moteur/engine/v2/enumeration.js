// ═══════════════════════════════════════════════════════════════════════════════════════════════
// L'ÉNUMÉRATION DES TOURNÉES — UN SEUL CODE pour le banc et pour la recherche v2 (T3, 2026-09-23)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Extrait tel quel de `scripts/banc/lib/enumeration.mjs` (qui ne fait plus que ré-exporter ce
// fichier) : la recherche de boucle v2 (`recherche.js`) énumère EXACTEMENT comme le banc, et le
// banc mesure EXACTEMENT ce que l'application proposera. ESM pur, aucune dépendance node :
// utilisable dans le navigateur, sous vitest et sous `node` nu.
//
// Ce fichier est le PORT de l'énumération de l'essai 2 (`essais-v2/essai-2/lib/enumeration.mjs`),
// rebranchée sur `src/engine/jour/` : la passe (`contexte`, `etatInitial`, `pas`, `cloturer`) et les
// garde-fous (`structureTournee`, `g1Tournee`, `g2g5Tournee`) viennent du module livré. L'algorithme
// — parcours en profondeur, quatre élagages exacts, construction par niveaux — n'est pas retouché.
//
// ── LES CHANGEMENTS PAR RAPPORT À L'ESSAI 2 ────────────────────────────────────────────────────
//
// ① `arrondi` traverse jusqu'à `contexte` : c'est ce qui permet au banc de rejouer les deux modes.
//
// ② 🔴 LA CORRECTION DU DÉFAUT CONNU DE `retourOk` (`ancreAgence`). L'essai 2 essayait chaque
//    dépôt du sous-ensemble et laissait n'importe lequel de ses lots ouvrir la tournée. Une tournée
//    pouvait donc partir du dépôt de l'agence A pour aller chercher D'ABORD le lot de l'agence B —
//    c'est-à-dire PRENDRE le lot d'un autre, ce que le métier interdit (« on donne ses lots, on n'en
//    prend jamais »). Le premier lot chargé doit être celui de l'agence du camion ; les suivants
//    sont des lots DONNÉS à ce camion. `ancreAgence: false` rend le comportement d'origine, pour
//    mesurer l'écart.
//
// ③ (T3) Les tables G1 (`mutuOk`, `retourOk`) sont calculées À LA DEMANDE et mémoïsées, au lieu
//    d'être remplies d'avance en O(n² × agences). Les valeurs sont les mêmes, cellule par cellule :
//    seul le moment du calcul change. La recherche v2 construit un moteur sur tout le planning et
//    n'interroge qu'une poignée de couples ; le banc, lui, les interroge presque tous.
//
// ④ (T3) `meilleureSequence(membres, d, { balayerDepart: true })` essaie le premier chargement à
//    chaque jour de sa fenêtre (voir le parcours). Le banc ne le demande jamais : ses résultats
//    sont inchangés. La recherche le demande dès qu'une candidate porte une date fixe.

import { contexte, etatInitial, pas, cloturer, attenteCourante, kmLotSeul, estFerme } from "../jour/index.js";
import { structureTournee, g2g5Tournee } from "../jour/index.js";
import { checkRetourPiliers, checkMutuZones } from "../../utils/zones.js";
import { memePerimetreMutu } from "../chainBuilder.js";

export function creerMoteur({ lots, table, depotDe, capParAgence, zones, agencesData, rules, abaque,
                              liaisonMax, minKmEco, critere = "geo", arrondi = "demi_journee",
                              resteMinPourCommencerH, ancreAgence = true }) {
  const n = lots.length;
  const idx = new Map(lots.map((l, i) => [l.id, i]));
  const lotsById = new Map(lots.map(l => [l.id, l]));
  const arretsDe = lots.map(l => table.get(l.id));
  const socs = lots.map(l => l.soc);
  const depots = lots.map(l => depotDe(l));
  const kmSeul = lots.map(l => kmLotSeul(depotDe(l), l.cpC, l.cpL));

  const agences = [...new Set(socs)];
  const agIdx = new Map(agences.map((a, i) => [a, i]));
  const depotDAgence = agences.map(a => depotDe(lots.find(l => l.soc === a)));
  const capDAgence = agences.map(a => capParAgence.get(a));
  const ctxParAgence = agences.map((a, i) => contexte({
    depotCp: depotDAgence[i], capacite: capDAgence[i], abaques: abaque, arrondi,
    resteMinPourCommencerH,
  }));

  // ── G1, calculé à la demande (③) ──
  // 0 = pas encore calculé, 1 = refusé, 2 = accepté. Même prédicat que l'essai 2, cellule par cellule.
  const memoMutu = new Uint8Array(n * n);
  const mutuOkDe = (i, j) => {
    const k = i * n + j;
    if (memoMutu[k] === 0) {
      const ok = i !== j && memePerimetreMutu(socs[i], socs[j], agencesData)
        && checkMutuZones({ chgAncre: lots[i].cpC, chgAccroche: lots[j].cpC }, zones).ok;
      memoMutu[k] = ok ? 2 : 1;
    }
    return memoMutu[k] === 2;
  };
  const memoRetour = agences.map(() => null);
  const retourOkDe = (d, i, j) => {
    if (!memoRetour[d]) memoRetour[d] = new Uint8Array(n * n);
    const m = memoRetour[d];
    const k = i * n + j;
    if (m[k] === 0) {
      const ok = i !== j && socs[i] !== socs[j] && checkRetourPiliers({
        depot: depotDAgence[d], chgAncre: lots[i].cpC, livAncre: lots[i].cpL,
        chgAccroche: lots[j].cpC, livAccroche: lots[j].cpL,
      }, zones).ok;
      m[k] = ok ? 2 : 1;
    }
    return m[k] === 2;
  };

  const cpt = { sousEnsembles: 0, noeuds: 0, sequencesCompletes: 0, tournees: 0,
    refusG2: 0, refusG5: 0, refusGain: 0, refusAncre: 0 };

  const kmSeulEvalCache = new Array(n).fill(undefined);
  const depotsDe = (membres) => [...new Set(membres.map(i => agIdx.get(socs[i])))];

  let replisKmSeul = 0;
  const kmSeulEval = (i) => {
    if (kmSeulEvalCache[i] === undefined) {
      const s = lotSeul(i);
      if (!s) replisKmSeul++;
      kmSeulEvalCache[i] = s ? s.km : kmSeul[i];
    }
    return kmSeulEvalCache[i];
  };

  const kmEvitesReelsDe = (membres, r) => Math.round(membres.reduce((s, i) => s + kmSeulEval(i), 0) - r.km);
  const valeurDe = (membres, r, g) => (critere === "reel" ? kmEvitesReelsDe(membres, r) : g.kmEvites);

  function fabriquer(membres, d, ctx, arrets, r, g, structure) {
    const sommeReels = membres.reduce((s, i) => s + kmSeulEval(i), 0);
    // `r.joursIso[k]` est le jour de `arrets[k]` : la passe empile un jour par arrêt, dans l'ordre.
    const chgParLot = {};
    arrets.forEach((a, k) => { if (a.type === "CHG") chgParLot[a.lot] = r.joursIso[k] ?? null; });
    return {
      chgParLot,
      membres: membres.map(i => lots[i].id),
      soc: agences[d], depot: ctx.depotCp,
      seq: arrets.map(a => `${a.type}:${a.lot}`),
      jours: r.joursIso, jourDepart: r.jourDepart, jourRetour: r.jourRetour,
      joursMobilises: r.joursMobilises, volumeMax: r.volumeMaxABord,
      coupures: r.coupures, attente: r.joursAttente,
      km: g.kmTournee, kmEvites: g.kmEvites,
      kmReel: r.km, kmEvitesReels: Math.round(sommeReels - r.km),
      detourTournee: g.detourTournee, forme: structure.forme,
      detours: g.greffes.map(x => x.detour), types: g.greffes.map(x => x.type),
      rendementTournee: r.joursMobilises > 0 ? Math.round(g.kmTournee / r.joursMobilises) : null,
    };
  }

  // ── L'ENTONNOIR DES REJETS ───────────────────────────────────────────────────────────────────
  // Un sous-ensemble qui ne rend aucune tournée a une cause, et une seule est retenue : la PLUS
  // AVANCÉE atteinte dans le parcours. Sans ce relevé, « 90 % des paires sont refusées » ne dit
  // rien de ce qu'il faudrait changer pour en récupérer.
  const STADES = ["ancre", "G1", "calendrier", "attente", "km", "G2", "G5", "gain"];
  const rangStade = Object.fromEntries(STADES.map((s, i) => [s, i]));

  function meilleureSequence(membres, d, opts = {}) {
    const k = membres.length;
    const ctx = ctxParAgence[d];
    const sommeSeuls = membres.reduce((s, i) => s + kmSeul[i], 0);
    const plafondKm = sommeSeuls - minKmEco;

    let stade = -1;
    const noter = (s) => { if (rangStade[s] > stade) stade = rangStade[s]; };
    const motifs = {};

    const charge = new Uint8Array(k), livre = new Uint8Array(k);
    const seq = new Array(2 * k);
    const tetes = [];
    let best = null, meilleureValeur = -Infinity;

    const rec = (etat, prof, aBord, nLivres) => {
      cpt.noeuds++;
      if (nLivres === k) {
        cpt.sequencesCompletes++;
        const r = cloturer(ctx, etat);
        noter("attente");
        if (r.joursAttente > liaisonMax) return;
        const arrets = seq.slice(0, 2 * k).map(([li, t]) => arretsDe[membres[li]][t]);
        const structure = structureTournee(arrets);
        const g = g2g5Tournee({ arrets, structure, lotsById, depotCp: ctx.depotCp,
          depotLot: (id) => depots[idx.get(id)], rules });
        if (!g.ok) { if (g.cause === "G2") { cpt.refusG2++; noter("G2"); } else { cpt.refusG5++; noter("G5"); } return; }
        noter("gain");
        const valeur = valeurDe(membres, r, g);
        if (valeur < minKmEco) { cpt.refusGain++; return; }
        if (!best || valeur > meilleureValeur) {
          meilleureValeur = valeur;
          best = fabriquer(membres, d, ctx, arrets, r, g, structure);
        }
        return;
      }

      for (let li = 0; li < k; li++) {
        const gi = membres[li];
        if (!charge[li]) {
          if (aBord > 0) {
            if (!mutuOkDe(membres[tetes[tetes.length - 1]], gi)) continue;
          } else if (tetes.length) {
            if (!retourOkDe(d, membres[tetes[tetes.length - 1]], gi)) continue;
          }
          noter("G1");
          const r = pas(ctx, etat, arretsDe[gi].CHG, prof);
          if (!r.ok) { motifs[r.motif] = (motifs[r.motif] || 0) + 1; continue; }
          noter("calendrier");
          if (r.etat.km > plafondKm) { noter("km"); continue; }
          if (attenteCourante(r.etat) > liaisonMax) continue;
          const nouvelleTete = aBord === 0;
          if (nouvelleTete) tetes.push(li);
          charge[li] = 1; seq[prof] = [li, "CHG"];
          rec(r.etat, prof + 1, aBord + 1, nLivres);
          charge[li] = 0;
          if (nouvelleTete) tetes.pop();
        } else if (!livre[li]) {
          const r = pas(ctx, etat, arretsDe[gi].LIV, prof);
          if (!r.ok) { motifs[r.motif] = (motifs[r.motif] || 0) + 1; continue; }
          noter("calendrier");
          if (r.etat.km > plafondKm) { noter("km"); continue; }
          if (attenteCourante(r.etat) > liaisonMax) continue;
          livre[li] = 1; seq[prof] = [li, "LIV"];
          rec(r.etat, prof + 1, aBord - 1, nLivres + 1);
          livre[li] = 0;
        }
      }
    };

    for (let li = 0; li < k; li++) {
      const gi = membres[li];
      // ② LA CORRECTION : le premier lot chargé appartient à l'agence du camion.
      if (ancreAgence && socs[gi] !== agences[d]) { cpt.refusAncre++; continue; }
      noter("ancre");
      // ④ (T3) `balayerDepart` : le premier chargement est essayé à CHAQUE jour de sa fenêtre, pas
      // seulement au plus tôt. Sans lui, un lot libre qui ouvre la tournée part au premier jour de sa
      // flex et attend des jours un partenaire à date FIXE (confirmé, posé d'une autre agence) : la
      // borne d'attente l'élague, et la tournée que le planning porte déjà n'est jamais retrouvée.
      // Absent (le banc, un vivier où tout est libre) : exactement le comportement de l'essai 2.
      const chg0 = arretsDe[gi].CHG;
      const debuts = [];
      if (opts.balayerDepart && chg0.fenetre && chg0.fenetre[1] > chg0.fenetre[0]) {
        // `departMax` / `departMin` bornent le balayage quand l'appelant les connaît (la recherche :
        // aucun arrêt ne précède le premier, donc il ne commence pas après la première date fixe).
        const de = Math.max(chg0.fenetre[0], opts.departMin ?? -Infinity);
        const a = Math.min(chg0.fenetre[1], opts.departMax ?? Infinity);
        // Un jour férié n'ouvre rien (27/09) : partir « à partir d'un férié », c'est partir le
        // lendemain — même état, déjà essayé. On ne l'essaie donc pas.
        for (let s = de; s <= a; s++) if (!estFerme(s)) debuts.push({ ...chg0, fenetre: [s, chg0.fenetre[1]] });
      } else debuts.push(chg0);
      let dejaVu = null;
      for (const arret0 of debuts) {
        const etat0 = etatInitial(ctx, arret0);
        const r = pas(ctx, etat0, arret0, 0);
        cpt.noeuds++;
        if (!r.ok) { motifs[r.motif] = (motifs[r.motif] || 0) + 1; continue; }
        // Deux jours d'essai qui aboutissent au même état (le chargement n'a pas pu commencer plus
        // tôt de toute façon) : même sous-arbre, on ne le reparcourt pas.
        if (debuts.length > 1) {
          if (dejaVu !== null && r.etat.t === dejaVu) continue;
          dejaVu = r.etat.t;
        }
        noter("calendrier");
        if (r.etat.km > plafondKm) { noter("km"); continue; }
        tetes.push(li); charge[li] = 1; seq[0] = [li, "CHG"];
        rec(r.etat, 1, 1, 0);
        charge[li] = 0; tetes.pop();
      }
    }
    derniereCause = best ? null : (stade < 0 ? "ancre" : STADES[stade]);
    derniersMotifs = motifs;
    return best;
  }

  // Cause du dernier appel à `meilleureSequence` — lue juste après par l'énumération.
  let derniereCause = null;
  let derniersMotifs = {};

  function lotSeul(i) {
    const d = agIdx.get(socs[i]);
    const ctx = ctxParAgence[d];
    let etat = etatInitial(ctx, arretsDe[i].CHG);
    for (const t of ["CHG", "LIV"]) {
      const r = pas(ctx, etat, arretsDe[i][t], 0);
      if (!r.ok) return null;
      etat = r.etat;
    }
    const r = cloturer(ctx, etat);
    return { membres: [lots[i].id], soc: socs[i], depot: ctx.depotCp,
      seq: [`CHG:${lots[i].id}`, `LIV:${lots[i].id}`], jours: r.joursIso,
      jourDepart: r.jourDepart, jourRetour: r.jourRetour, joursMobilises: r.joursMobilises,
      volumeMax: r.volumeMaxABord, coupures: r.coupures, attente: r.joursAttente,
      km: r.km, kmEvites: 0, kmReel: r.km, kmEvitesReels: 0, forme: "1",
      chgParLot: { [lots[i].id]: r.joursIso[0] ?? null } };
  }

  return { n, idx, lots, agences, agIdx, depotDAgence, capDAgence, depotsDe,
    meilleureSequence, lotSeul, cpt, mutuOkDe, retourOkDe, kmSeul,
    kmSeulEval, replis: () => replisKmSeul,
    cause: () => derniereCause, motifs: () => derniersMotifs };
}

// ── L'UNIVERS DES TOURNÉES D'UN VIVIER ─────────────────────────────────────────────────────────
// Construction par NIVEAUX, exactement comme l'essai 2 : les candidats de taille k sont fabriqués
// en ajoutant un lot à un sous-ensemble retenu de taille k−1 (hypothèse non démontrée, cf. le
// rapport de l'essai 2 § 1.2). `tailleMax` plafonne à 3 par défaut — le moteur d'aujourd'hui ne
// pose jamais plus de trois lots sur une tournée (arbitrage du 2026-09-02).
export function enumererUnivers(M, { tailleMax = 3 } = {}) {
  const n = M.n;
  const retenues = [];
  const seuls = [];
  const refus = {};      // cause → nombre de (sous-ensemble, dépôt) écartés, par taille
  const motifsCal = {};  // motif de la passe → nombre d'arrêts refusés

  const essayer = (membres, d, k) => {
    M.cpt.sousEnsembles++;
    const t = M.meilleureSequence(membres, d);
    if (!t) {
      const c = M.cause() || "inconnu";
      refus[k] = refus[k] || {};
      refus[k][c] = (refus[k][c] || 0) + 1;
      for (const [m, v] of Object.entries(M.motifs())) motifsCal[m] = (motifsCal[m] || 0) + v;
    }
    return t;
  };

  for (let i = 0; i < n; i++) {
    const s = M.lotSeul(i);
    if (s) seuls.push(s);
  }

  let niveau = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const membres = [i, j];
      for (const d of M.depotsDe(membres)) {
        const t = essayer(membres, d, 2);
        if (t) { retenues.push(t); niveau.push({ membres, t }); }
      }
    }
  }
  M.cpt.tournees += niveau.length;

  for (let k = 3; k <= tailleMax; k++) {
    const vus = new Set();
    const suivant = [];
    for (const base of niveau) {
      for (let j = 0; j < n; j++) {
        if (base.membres.includes(j)) continue;
        const membres = [...base.membres, j].sort((a, b) => a - b);
        const cle = membres.join(",");
        if (vus.has(cle)) continue;
        vus.add(cle);
        for (const d of M.depotsDe(membres)) {
          const t = essayer(membres, d, k);
          if (t) { retenues.push(t); suivant.push({ membres, t }); }
        }
      }
    }
    M.cpt.tournees += suivant.length;
    niveau = suivant;
    if (!niveau.length) break;
  }

  return { tournees: retenues, seuls, refus, motifsCal };
}
