// ── LE TRANSBORDEMENT COCHÉ PAR LE PLANIFICATEUR — UNE SEULE RÈGLE (retours du 27/09) ──────────
//
// Une navette (véhicule léger) collecte chez le client à la date VENDUE ; la marchandise attend au
// dépôt de l'agence VENDEUSE (tranché le 18/09 : aller chercher celui de l'agence du bout ne
// rapporte rien de plus) ; le poids lourd la charge au dépôt un autre jour. Symétrique à la
// livraison : le camion livre au dépôt, la navette livre le client à la date vendue.
//
// Pour le calcul, trois choses changent :
//   · l'ADRESSE de l'arrêt du camion : le dépôt de l'agence vendeuse (`lot.depotCp`) ;
//   · sa FENÊTRE et son MOMENT (règle de Louis du 28/09, contrat K2 ci-dessous) ;
//   · sa DURÉE : le bloc du camion au dépôt dure UNE DEMI-JOURNÉE, quel que soit le volume.
//
// ── LA RÈGLE DU BLOC (Louis, 28/09 — « à inscrire ») ─────────────────────────────────────────
// « Un transbo au CHG est toujours APRÈS le CHG, et un transbo à la LIV est toujours AVANT la
// LIV. » Et pour le placer : « juste après le CHG VL quand c'est possible, sinon après si ça permet
// une boucle » (symétrique à la livraison : juste avant, sinon avant).
//   · La DATE VL (contrat K1) : `op.vl`, le jour où la navette (véhicule léger) charge chez le
//     client (au CHG) ou le livre (à la LIV). Absente → `op.souhaite`, la date vendue — c'est le cas
//     de tous les lots existants, et de l'application (aucun champ en base). `souhaite`, `flex` et
//     `flexVendue` restent ceux du CLIENT ; `date` est le jour du CAMION (le bloc au dépôt).
//   · Au CHG : le chargement VL commence le MATIN du jour VL et dure la manutention du lot
//     (`dureeH` de l'opération). Le bloc du camion commence au plus tôt au début de la
//     DEMI-JOURNÉE QUI SUIT sa fin — l'après-midi du même jour si la collecte finit à midi au plus
//     tard (≤ une demi-journée du module), sinon le lendemain ouvré au matin — et au plus tard
//     `vl + N` jours ouvrés (la marchandise n'attend pas plus à quai).
//   · À la LIV : la livraison VL commence le MATIN du jour VL ; le bloc du camion doit être FINI à
//     la fin de la veille ouvrée (au plus tard la veille au soir), et commence au plus tôt `vl − N`.
//   · N = `reglages.transbo.attenteQuaiJours` (10, hypothèse de la maquette) ; la durée du bloc =
//     `reglages.transbo.dureeBlocH` (défaut : une demi-journée du module, `heuresJour / 2`). Fériés
//     et week-ends sont des jours fermés, comme partout (une collecte qui finit un vendredi soir
//     donne un bloc au plus tôt le lundi matin ; un lundi de Pâques le repousse au mardi).
//   · « Juste après quand c'est possible » : la date PRÉFÉRÉE du camion est le bord de sa fenêtre
//     (la plus tôt au CHG, la plus tard à la LIV) — `tournee.js` l'impose à toute opération
//     transbordée, quelle que soit la préférence de l'appelant (une retouche qui « libère » une date
//     en gardant l'ancienne en préférence ne doit pas éloigner le bloc de la navette). Le
//     remplissage ne s'en écarte que si la tournée ne tient pas ; la recherche v2, elle, énumère la
//     fenêtre et garde la meilleure boucle (à égalité, la plus tôt).
//   · Le bloc est un CRÉNEAU du planning, pas une estimation de manutention : il n'est pas majoré de
//     la marge du compte large (`margeDuree`, +15 %) — sinon 5 h 30 deviendraient 6 h 20, plus
//     qu'une demi-journée, et l'après-midi « juste après » ne tiendrait jamais qu'au compte serré.
//   · JAMAIS le bloc avant la fin du CHG VL, ni après le début de la LIV VL : la passe ne l'y met
//     pas (`pas` de `passe.js` : début au plus tôt `tMin`, fin au plus tard `tFinMax`), et une date
//     de camion IMPOSÉE qui les violerait est un refus `TRANSBO_ORDRE` (`tournee.js`). Au-delà de
//     l'attente à quai, c'est un orange `TRANSBO_QUAI` (la marchandise attendrait plus de N jours).
//   · 🔴 Q17 n'est pas touchée : le bloc est une opération comme une autre pour la passe (au dépôt de
//     l'agence vendeuse), sa sortie doit tenir dans son bloc de jours ouverts.
// ❓ Le placement du bloc est à confirmer avec les planificateurs (synthèse) ; l'autre option notée
// par Louis — le transbo comme un arrêt numéroté à part entière — n'est pas codée.
//
// 🔑 C'EST LA SEULE SOURCE DE CETTE RÈGLE. La lisent : la maquette (`bac-a-sable/moteur.js`,
// `lotPourModule` et `opTransbordee` ; `propositionEntree.js`), l'adaptateur de l'application
// (`engine/v2/adaptateur.js`, donc la recherche v2 et le planning posé), la recherche v2 pour son
// énumération (`blocTransbo`, `extrasArretBloc`), le calcul lui-même pour ses bornes fines
// (`tournee.js`, `bornesDuBloc`), et le banc (`scripts/banc/lib/planning-reel.mjs`, `lotDuBlob`). Si l'un d'eux
// la réécrivait à sa façon, « proposé = posé » tomberait sur un lot transbordé — c'est exactement
// ce qui se passait avant le 27/09 : la recherche cherchait chez le client (scénario 11 : 810 km
// évités annoncés, 742 posés).
//
// ⚠️ Ce n'est PAS la recherche qui PROPOSE un transbordement (levier du planificateur, v3) : ici on
// ne fait que traduire la case cochée.

import {
  jourOuvre, jourOuvreOuSuivant, jourOuvreOuPrecedent, isoDeJour, decalerOuvres, ouvertOuSuivant, ouvertOuPrecedent, EPS,
} from "./calendrier.js";
import { REGLAGES_DEFAUT } from "./reglages.js";

// N, lu dans des réglages partiels ou complets (ou absents : le défaut).
export const attenteQuaiJours = (reglages) =>
  reglages?.transbo?.attenteQuaiJours ?? REGLAGES_DEFAUT.transbo.attenteQuaiJours;

// Une demi-journée du module, en heures (`heuresJour / 2` : 5 h 30 pour 7 h → 18 h). Même valeur
// que la passe (`contexte`, `hDemi`) : c'est l'unité de l'axe.
const demiJourneeH = (reglages) => (reglages?.heuresJour || REGLAGES_DEFAUT.heuresJour) / 2;

// La durée du bloc du camion au dépôt, en heures : `reglages.transbo.dureeBlocH`, sinon une
// demi-journée du module (28/09 : « un bloc demi-journée », quel que soit le volume).
export const dureeBlocH = (reglages) => reglages?.transbo?.dureeBlocH ?? demiJourneeH(reglages);

// ── LE BLOC DU CAMION D'UNE OPÉRATION TRANSBORDÉE (contrat K2, 28/09) ──────────────────────────
// `vl` : la date VL (ISO — `op.vl ?? op.souhaite`, contrat K1) ; `dureeVLH` : la manutention chez le
// client (le `dureeH` de l'opération) ; `type` : "CHG" | "LIV". Rend, ou `null` sans date VL :
//   · `fenetre`        — [isoMin, isoMax] : les jours où le bloc peut se tenir (peut être VIDE,
//                        isoMin > isoMax, si la collecte dure plus que l'attente à quai : le calcul
//                        le dit alors « intenable ») ;
//   · `dureeH`         — la durée du bloc (`dureeBlocH`) ;
//   · `debutAuPlusTot` — au CHG, `{ date, demi }` : le bloc ne commence pas avant le début de cette
//                        demi-journée (0 = matin, 1 = après-midi) — celle qui suit la fin du CHG VL ;
//   · `finAuPlusTard`  — à la LIV, `{ date, demi }` : le bloc est fini au plus tard à la fin de cette
//                        demi-journée — l'après-midi de la veille ouvrée de la LIV VL.
// Une date VL tombée un jour fermé se lit comme avant le 28/09 : au CHG, la collecte a lieu le
// premier jour ouvert qui suit ; à la LIV, elle ne change que la borne basse (`vl − N` depuis le
// jour ouvré qui précède) — la veille ouvrée, elle, est toujours le dernier jour ouvert AVANT `vl`.
export function blocTransbo({ vl, dureeVLH = 0, type }, reglages) {
  if (!vl) return null;
  const n = attenteQuaiJours(reglages);
  const dureeH = dureeBlocH(reglages);
  const j = jourOuvre(vl);
  if (type === "CHG") {
    const a = j ?? jourOuvreOuSuivant(vl);
    if (a === null) return null;
    const jVL = ouvertOuSuivant(a);
    // La collecte occupe des demi-journées entières à partir du matin du jour VL — au moins une :
    // le bloc ne partage jamais la demi-journée où la navette commence. On avance d'autant de
    // demi-journées, en sautant les jours fermés (une collecte d'un jour et demi commencée un
    // vendredi finit le lundi midi).
    const demis = Math.max(1, Math.ceil((dureeVLH || 0) / demiJourneeH(reglages) - EPS));
    let t = 2 * jVL;
    for (let k = 0; k < demis; k++) {
      t += 1;
      if (t % 2 === 0) t = 2 * ouvertOuSuivant(t / 2);
    }
    const jMin = Math.floor(t / 2);
    return {
      type, vl, dureeH,
      fenetre: [isoDeJour(jMin), isoDeJour(decalerOuvres(jVL, n))],
      debutAuPlusTot: { date: isoDeJour(jMin), demi: t % 2 },
      finAuPlusTard: null,
    };
  }
  const b = j ?? jourOuvreOuPrecedent(vl);
  if (b === null) return null;
  // La veille ouvrée : le dernier jour OUVERT strictement avant la date VL (un lundi → le vendredi ;
  // le lendemain d'un férié → la veille du férié ; une date VL un samedi → le vendredi).
  const veille = j === null ? b : ouvertOuPrecedent(j - 1);
  return {
    type, vl, dureeH,
    fenetre: [isoDeJour(decalerOuvres(b, -n)), isoDeJour(veille)],
    debutAuPlusTot: null,
    finAuPlusTard: { date: isoDeJour(veille), demi: 1 },
  };
}

// La fenêtre [isoMin, isoMax] de l'arrêt du CAMION pour une opération transbordée — la `fenetre`
// de `blocTransbo`. `vl` : la date VL (ISO) ; `dureeVLH` : la durée de la collecte (sans elle, une
// collecte d'au plus une demi-journée : le bloc peut suivre le même jour). `null` sans date, ou si
// la fenêtre est vide. Signature du 27/09 conservée (`dureeVLH` ajouté en 4ᵉ position).
export function fenetreTransbo(vl, type, reglages, dureeVLH = 0) {
  const b = blocTransbo({ vl, dureeVLH, type }, reglages);
  if (!b || b.fenetre[0] > b.fenetre[1]) return null;
  return b.fenetre;
}

// Les deux bornes FINES du bloc, sur l'axe des demi-journées du module (`t = 2 × jourOuvré +
// fraction`) : ce que la passe lit (`pas`, champs `tMin` / `tFinMax` d'un arrêt). `bloc` : la sortie
// de `blocTransbo`, ou le `transbo` que `transborderLot` pose sur une opération (mêmes champs).
export function bornesDuBloc(bloc) {
  const d = bloc?.debutAuPlusTot, f = bloc?.finAuPlusTard;
  const jd = d ? jourOuvre(d.date) : null;
  const jf = f ? jourOuvre(f.date) : null;
  return {
    tMin: jd === null ? null : 2 * jd + d.demi,
    tFinMax: jf === null ? null : 2 * jf + f.demi + 1,
  };
}

// Ce qu'un arrêt de la PASSE porte en plus pour un bloc transbordé : sa durée non majorée
// (`sansMarge`) et ses deux bornes fines. Lu par `tournee.js` (la tournée ET le lot fait seul) et par
// la recherche v2 pour son énumération — une seule traduction, sinon « proposé = posé » tomberait.
export function extrasArretBloc(bloc) {
  if (!bloc) return {};
  const { tMin, tFinMax } = bornesDuBloc(bloc);
  const x = { sansMarge: true };
  if (tMin !== null) x.tMin = tMin;
  if (tFinMax !== null) x.tFinMax = tFinMax;
  return x;
}

// ── L'ADRESSE DE L'ARRÊT DU CAMION : GARDE-MEUBLES, PUIS TRANSBORDEMENT (compléments du 27/09) ──
// Le GARDE-MEUBLES (tranché le 18/09, CONCEPTS-METIER) est un FAIT du dossier, pas un levier : la
// case met l'adresse du garde-meubles (`{ libelle, cp, ville }`, par défaut le dépôt de mon agence)
// comme lieu de l'opération, et c'est TOUT — ni fenêtre, ni date, ni durée ne change. Le format de
// l'outil l'écrit déjà dans `cpC` / `cpL` (`versOutil.js`, la saisie de l'outil) : l'adaptateur n'a
// rien à faire. La maquette, elle, garde l'adresse du client à part (`gmC` / `gmL`) : cette fonction
// est son unique traduction (`bac-a-sable/moteur.js`, `propositionEntree.js`), sans quoi le planning
// livrait chez le client quand la recherche calculait au garde-meubles (proposé ≠ posé).
// GARDE-MEUBLES ET TRANSBORDEMENT SUR LA MÊME OPÉRATION : le transbordement l'emporte pour le CAMION
// (il charge au dépôt de l'agence vendeuse, dans la fenêtre du quai ; c'est la navette qui va au
// garde-meubles). Avec le garde-meubles par défaut — le dépôt de mon agence, qui est l'agence
// vendeuse puisque seul son planificateur saisit le lot — c'est le même lieu. Même ordre que la
// chaîne de l'outil (`cpC` = garde-meubles, puis `transborderLot` dans l'adaptateur).
export function lieuxDuLot(lot, { gmC = null, gmL = null, transboChg = false, transboLiv = false } = {}, reglages) {
  const cpGm = (gm) => (gm && gm.cp ? String(gm.cp) : null);
  const avecGm = lot && (cpGm(gmC) || cpGm(gmL))
    ? { ...lot, cpC: cpGm(gmC) ?? lot.cpC, cpL: cpGm(gmL) ?? lot.cpL }
    : lot;
  return transborderLot(avecGm, { chg: !!transboChg, liv: !!transboLiv }, reglages);
}

// Un lot du MODULE (forme d'entrée de `evaluerTournee`) → le même lot, ses opérations transbordées
// traduites en BLOC DU CAMION au dépôt de son agence (`lot.depotCp`). `chg` / `liv` : les deux cases
// du planificateur. Sans case cochée, le lot est rendu TEL QUEL (même objet).
// Sur l'opération transbordée (28/09) :
//   · `flex`    ← la fenêtre du CAMION (`blocTransbo`) : ce que le calcul remplit, et la fenêtre du
//                 lot fait seul (le lot seul serait transbordé lui aussi) ;
//   · `dureeH`  ← la durée du bloc (une demi-journée) ;
//   · `prefere` ← le bord de la fenêtre (« juste après » / « juste avant ») ;
//   · `transbo` ← `{ vl, dureeVLH, flexClient, debutAuPlusTot, finAuPlusTard }` : la date VL
//                 retenue, la durée de la collecte, la fenêtre VENDUE AU CLIENT (le signal
//                 `HORS_FLEX` porte désormais sur la date VL, la seule que le client voit) et les
//                 deux bornes fines du bloc.
// Inchangés : `souhaite` (le client), `vl` s'il est fourni (contrat K1), la date posée du camion
// (`date`), l'épingle, la confirmation. IDEMPOTENTE : une opération déjà traduite (qui porte
// `transbo`) repart de ses originaux — la traduire deux fois rend la même chose.
export function transborderLot(lot, { chg = false, liv = false } = {}, reglages) {
  if (!lot || (!chg && !liv)) return lot;
  const out = { ...lot };
  if (chg && lot.chg) {
    out.cpC = lot.depotCp ?? lot.cpC;
    out.chg = opDuCamion(lot.chg, "CHG", reglages);
  }
  if (liv && lot.liv) {
    out.cpL = lot.depotCp ?? lot.cpL;
    out.liv = opDuCamion(lot.liv, "LIV", reglages);
  }
  return out;
}

function opDuCamion(op, type, reglages) {
  const deja = op.transbo || null;
  const dureeVLH = deja ? deja.dureeVLH : (op.dureeH || 0);
  const flexClient = deja ? deja.flexClient : (op.flex ?? null);
  const vl = op.vl ?? op.souhaite ?? null;
  const bloc = blocTransbo({ vl, dureeVLH, type }, reglages);
  // Sans date VL (ni souhaitée) : rien à placer par rapport à la navette — l'adresse seule change,
  // comme avant le 28/09.
  if (!bloc) return { ...op };
  return {
    ...op,
    flex: bloc.fenetre,
    dureeH: bloc.dureeH,
    prefere: type === "CHG" ? bloc.fenetre[0] : bloc.fenetre[1],
    transbo: {
      vl, dureeVLH, flexClient,
      debutAuPlusTot: bloc.debutAuPlusTot, finAuPlusTard: bloc.finAuPlusTard,
    },
  };
}
