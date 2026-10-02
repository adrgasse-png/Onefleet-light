// ── CE QU'UN GESTE A LE DROIT DE TOUCHER ───────────────────────────────────────────────────────
//
// Deux règles métier, et seulement celles-là :
//   ① une opération CONFIRMÉE ne bouge pas. Confirmer, c'est avoir annoncé un jour au client ; la
//      défaire demande un rappel, donc un geste explicite de déconfirmation, jamais un effet de
//      bord d'un déplacement ;
//   ② « on DONNE ses lots, on n'en PREND jamais » — un planificateur place un lot vendu par son
//      agence sur le camion qu'il veut ; il ne va pas chercher le lot d'une autre agence. La seule
//      exception est le lot déjà sous-traité : s'il roule sur un de NOS camions AVANT le geste, on
//      peut le recaler — dans sa fenêtre seulement (D4) —, le garder sur nos camions ou le rendre à
//      son agence vendeuse ; le donner au camion d'une troisième agence est une demande (D5).
//      Et notre propre lot, tant qu'il roule sur une tournée d'une AUTRE région (un camion hors de
//      `mesAgences`), ne se reprend ni ne se donne sans elle : c'est leur tournée (D6, § 2.5).
//
// `avant` / `apres` : { tournees: [ entrée de `evaluerTournee`, avec un `id` ] }.

import { fusionnerReglages } from "./reglages.js";

// Accord en genre (« la livraison … est confirmée ») et date lisible : mêmes conventions que
// `tournee.js`, point d'écriture unique.
const OPS = {
  CHG: { def: "Le", ind: "le", pron: "il", nom: "chargement", e: "" },
  LIV: { def: "La", ind: "la", pron: "elle", nom: "livraison", e: "e" },
};
const opDuLot = (type, nom, maj = true) => `${maj ? OPS[type].def : OPS[type].ind} ${OPS[type].nom} du lot ${nom}`;
const acc = (type) => OPS[type].e;

const JOURS_SEM = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const jfr = (iso) => {
  if (!iso) return "sans date";
  const [y, m, d] = String(iso).split("-");
  return `${JOURS_SEM[new Date(Date.UTC(+y, +m - 1, +d)).getUTCDay()]} ${d}/${m}`;
};

// Aplatit un état de planning en une table d'opérations, indexée par « lot|CHG » / « lot|LIV ».
function aplatir(etat) {
  const table = new Map();
  for (const t of etat?.tournees || []) {
    for (const l of t.lots || []) {
      for (const [cle, op] of [["CHG", l.chg], ["LIV", l.liv]]) {
        if (!op) continue;
        table.set(`${l.id}|${cle}`, {
          lot: l.id, nom: l.nom || l.id, type: cle,
          date: op.date || null, confirme: !!op.confirme, flex: op.flex || null,
          agence: l.agence, tournee: t.id,
          camion: t.camion?.id || null, agenceCamion: t.camion?.agence || null,
        });
      }
    }
  }
  return table;
}

export function controlerGeste({ avant, apres, mesAgences }, reglagesPartiels) {
  fusionnerReglages(reglagesPartiels);   // valide la forme des réglages ; aucun seuil n'entre ici
  const A = aplatir(avant);
  const B = aplatir(apres);
  const miennes = new Set(mesAgences || []);
  const signaux = [];

  for (const [cle, a] of A) {
    const b = B.get(cle);

    // ① Une opération confirmée : ni date, ni camion, ni disparition.
    if (a.confirme) {
      if (!b) {
        signaux.push({
          niveau: "refus", code: "DATE_CONFIRMEE", lot: a.lot, type: a.type,
          message: `${opDuLot(a.type, a.nom)} est confirmé${acc(a.type)} au ${jfr(a.date)} : ${OPS[a.type].ind} retirer du planning demande de déconfirmer d'abord.`,
          detail: { avant: a, apres: null },
        });
      } else if (b.date !== a.date) {
        signaux.push({
          niveau: "refus", code: "DATE_CONFIRMEE", lot: a.lot, type: a.type,
          message: `${opDuLot(a.type, a.nom)} est confirmé${acc(a.type)} au ${jfr(a.date)} auprès du client : ${OPS[a.type].ind} déplacer au ${jfr(b.date)} demande de déconfirmer d'abord.`,
          detail: { avant: a.date, apres: b.date },
        });
      } else if (b.camion !== a.camion) {
        signaux.push({
          niveau: "refus", code: "DATE_CONFIRMEE", lot: a.lot, type: a.type,
          message: `${opDuLot(a.type, a.nom)} est confirmé${acc(a.type)} : ${OPS[a.type].nom === "livraison" ? "elle" : "il"} ne peut pas changer de camion (${a.camion} → ${b.camion}) sans déconfirmation.`,
          detail: { avant: a.camion, apres: b.camion },
        });
      }
    }

    // ② À qui est ce lot, et sur quel camion roule-t-il ?
    const bouge = !b || b.date !== a.date || b.camion !== a.camion || b.tournee !== a.tournee;
    if (bouge) ajouterDroits(signaux, a, b, miennes);
  }

  // Un lot AJOUTÉ au planning : même règle, c'est un geste sur ce lot — sans « avant », donc sans
  // sous-traitance à faire valoir.
  for (const [cle, b] of B) {
    if (A.has(cle)) continue;
    ajouterDroits(signaux, null, b, miennes);
  }

  return { ok: !signaux.some(s => s.niveau === "refus"), signaux };
}

// La fenêtre vendue d'une opération contient-elle cette date ? Sans fenêtre connue, le module ne
// juge pas (même règle que `mesAgences` vide) : l'appelant qui veut le contrôle passe `flex`.
function horsFenetre(op, flex) {
  if (!op?.date || !flex?.[0] || !flex?.[1]) return false;
  return op.date < flex[0] || op.date > flex[1];
}

function ajouterDroits(signaux, a, b, miennes) {
  if (miennes.size === 0) return;              // périmètre non renseigné : on ne juge pas
  const x = a || b;
  const deja = (code, type = null) => signaux.some(s => s.code === code && s.lot === x.lot && (type === null || s.type === type));
  const chezNous = (y) => !!y && miennes.has(y.agenceCamion);
  const ailleurs = (y) => !!y && !!y.agenceCamion && !miennes.has(y.agenceCamion);

  // ── Notre lot. On en fait ce qu'on veut… sauf sur la tournée d'une AUTRE région (D6). ──────────
  // Le reprendre défait leur tournée ; le leur donner, c'est leur proposer. Dans les deux cas, une
  // demande (§ 2.5 : « une proposition soumise à leur accord » ; § 3.3 : « camion d'une autre
  // région → devient une demande »).
  if (miennes.has(x.agence)) {
    const depuis = ailleurs(a), vers = ailleurs(b);
    if (!depuis && !vers) return;
    if (deja("CAMION_AUTRE_REGION")) return;
    const camion = depuis ? a : b;
    signaux.push({
      niveau: "refus", code: "CAMION_AUTRE_REGION", lot: x.lot, type: null, demande: true,
      message: depuis
        ? `Le lot ${x.nom} roule sur le camion ${camion.camion} de l'agence ${camion.agenceCamion}, hors de votre région : le reprendre défait leur tournée, c'est une demande soumise à leur accord.`
        : `Le camion ${camion.camion} appartient à l'agence ${camion.agenceCamion}, hors de votre région : y mettre le lot ${x.nom}, c'est leur adresser une proposition.`,
      detail: { agence: x.agence, agenceCamion: camion.agenceCamion, sens: depuis ? "reprendre" : "donner" },
    });
    return;
  }

  // ── Le lot d'une autre agence, qui roulait sur un de nos camions : il est sous-traité chez nous.
  if (chezNous(a)) {
    if (!b) return;                                        // on le rend : retiré du planning
    if (b.agenceCamion === a.agence) return;               // on le rend : sur un camion de son agence
    if (chezNous(b)) {
      // D4 — on le garde, et on le recale : dans sa fenêtre seulement.
      if (b.date !== a.date && horsFenetre(b, b.flex || a.flex) && !deja("SOUS_TRAITE_HORS_FENETRE", b.type)) {
        const flex = b.flex || a.flex;
        signaux.push({
          niveau: "refus", code: "SOUS_TRAITE_HORS_FENETRE", lot: x.lot, type: b.type, demande: true,
          message: `${opDuLot(b.type, x.nom)} est vendu${acc(b.type)} par l'agence ${x.agence} : vous pouvez ${OPS[b.type].ind} recaler dans sa fenêtre (${jfr(flex[0])} au ${jfr(flex[1])}). Au ${jfr(b.date)}, c'est une demande à cette agence.`,
          detail: { agence: x.agence, date: b.date, flex },
        });
      }
      return;
    }
    // D5 — vers le camion d'une troisième agence : on ne donne pas ce qui n'est pas à nous.
    if (deja("LOT_AUTRE_AGENCE")) return;
    signaux.push({
      niveau: "refus", code: "LOT_AUTRE_AGENCE", lot: x.lot, type: null, demande: true,
      message: `Le lot ${x.nom} est vendu par l'agence ${x.agence} et vous est sous-traité : vous pouvez le garder sur vos camions ou le lui rendre, pas le confier à l'agence ${b.agenceCamion || "d'un tiers"} — c'est une demande à l'agence ${x.agence}.`,
      detail: { agence: x.agence, agenceCamion: b.agenceCamion, sousTraite: true },
    });
    return;
  }

  // ── Le lot d'une autre agence, qui ne roulait pas chez nous : on ne le prend pas. ──────────────
  if (deja("LOT_AUTRE_AGENCE")) return;
  signaux.push({
    niveau: "refus", code: "LOT_AUTRE_AGENCE", lot: x.lot, type: null, demande: true,
    message: `Le lot ${x.nom} appartient à l'agence ${x.agence} et ne vous est pas sous-traité : on ne prend pas le lot d'un autre planificateur, on lui adresse une proposition.`,
    detail: { agence: x.agence, agenceCamion: (b || a).agenceCamion },
  });
}
