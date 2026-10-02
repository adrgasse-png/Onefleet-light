/* ═══════════════════════════════════════════════════════════════════════════
 * Les jetons de couleur, côté JavaScript.
 *
 * Depuis le 2026-08-21, les valeurs ne sont PLUS écrites ici : elles vivent une
 * seule fois, dans `src/index.css`, sous forme de variables CSS. Ce fichier n'en
 * est plus que la porte d'entrée pour les styles en ligne du JSX
 * (`style={{ background: T.s2 }}`), le temps que la migration vers les classes
 * Tailwind avance.
 *
 * Chaque jeton est donc un `var(--…)` — avec la valeur d'origine en SECOURS,
 * pour qu'un composant rendu avant l'arrivée de la feuille de style (ou un test
 * qui monte un composant seul) affiche la bonne couleur malgré tout.
 *
 * ⚠️ Conséquence à connaître : ces chaînes ne sont plus des hexadécimaux. On ne
 * peut plus leur coller un suffixe d'opacité (`${T.g}30` ne veut plus rien
 * dire) — c'est à cela que sert `alpha()`, plus bas.
 * ═══════════════════════════════════════════════════════════════════════════ */

const jeton = (nom, secours) => `var(--${nom}, ${secours})`;

export const T = {
  bg: jeton("background", "#FFFFFF"),
  s: jeton("card", "#FFF"),
  s2: jeton("muted", "#F7FAFB"),
  s3: jeton("accent", "#EDF3F5"),

  bd: jeton("border", "#E1E9EC"),
  bd2: jeton("input", "#C6D5DA"),

  tx: jeton("foreground", "#0F1B20"),
  tx2: jeton("muted-foreground", "#5C6E75"),
  tx3: jeton("text-faint", "#93A5AC"),

  // Vert dédoublé le 2026-09-01 (lot 0 bis, plan-dev-ux-v3.md § 4.5) : `g` est
  // désormais l'encre (#3F7A1B, 5,24:1 sur blanc), valeur par défaut — le vert
  // vif Hexvia ne tenait que 2,61:1 sur blanc pour du texte. `gv` porte ce vif,
  // réservé aux aplats qui ne portent aucun caractère (liste figée au § 4.5).
  g: jeton("primary", "#3F7A1B"),
  gl: jeton("success-bg", "#EEF7E7"),
  gm: jeton("primary-hover", "#4E8F22"),
  gv: jeton("gain-vif", "#65B32E"),

  am: jeton("warning", "#A85F09"),
  al: jeton("warning-bg", "#FDF3E4"),

  bl: jeton("info", "#086882"),
  bll: jeton("info-bg", "#DFEAED"),

  // L'anneau de focus (`--ring`) : suit `--primary` par construction (cf.
  // index.css), pas de style en ligne qui s'en serve à ce jour — exporté ici
  // pour qu'on puisse le lire sans recopier un hexadécimal.
  ring: jeton("ring", "#3F7A1B"),

  pr: jeton("accent-violet", "#534AB7"),
  prl: jeton("accent-violet-bg", "#EEEDFE"),

  or: jeton("accent-orange", "#C45E0A"),
  orl: jeton("accent-orange-bg", "#FEF0E4"),

  rd: jeton("destructive", "#B42318"),
  rl: jeton("destructive-bg", "#FDEDEC"),
};

// Les trajets — nouveaux au 2026-09-01 (lot 0, plan-dev-ux-v3.md § 4.1) : un
// axe « plein / creux », jamais deux gris à comparer. Cf. lot 6 § 10.2 pour
// le raisonnement complet. Noms JS explicites (pas d'abréviation à deux
// lettres) : contrairement à `T.*` ci-dessus, il n'existait aucune convention
// d'abréviation héritée pour cette famille.
//
// 🔁 RÉVISÉ le 2026-09-14 (arbitrage Louis, guidelines § 9.2) : le plein devient un GRIS CLAIR et
// son texte une encre FONCÉE (`ink`) ; le vide est hachuré partout (`hatchVoid`, grille comprise).
// ⚠️ `onFill` (blanc) ne sert PLUS au texte d'un trajet — il reste l'encre d'un aplat saturé de
// RÔLE, cf. `COUL_ROLE_ON` plus bas. Un trajet écrit son km en `Trajet.ink`.
export const Trajet = {
  // 🔁 RÉVISÉ le 2026-09-15 (chantier UX v7, lot M1, retour 3 de Louis) : un cran plus clair
  // qu'avant (`#C9D3D8`), écart gardé visible avec `--empty-fill` (`#F1F5F6`).
  routeFill: jeton("route-fill", "#D9E1E4"),   // trajet CHARGÉ (mutualisé compris) : gris clair plein
  ink: jeton("route-ink", "#0F1B20"),          // le texte posé sur un trajet chargé
  emptyFill: jeton("empty-fill", "#F1F5F6"),   // trajet À VIDE : fond sous la hachure
  emptyLine: jeton("empty-line", "#B9C7CC"),   // trait de la hachure, contour du vide
  // `infoStrong` (le teal `#3F899D` qui distinguait un trajet mutualisé) est RETIRÉ le 2026-09-02
  // (lot A, arbitrage Louis) : la mutualisation reste un trajet chargé comme un autre. Le filet
  // `--info` qui la signalait en bas du bloc est RETIRÉ à son tour le 2026-09-14 (guidelines
  // § 9.6) : sur la grille, un trajet est plein ou vide, et rien d'autre.
  // Le blanc « lisible sur un aplat fort ». Ne s'écrit PLUS sur un trajet depuis que le plein est
  // clair (2026-09-14, lire `ink`) ; gardé pour ses lecteurs de RÔLE (pastille ANC) le temps que
  // le chantier v6 les bascule sur `COUL_ROLE_ON`.
  onFill: jeton("primary-foreground", "#FFFFFF"),
  // 🔁 Espacement du pas RÉVISÉ le 2026-09-15 (lot M1, retour 2 de Louis, « plus léger : lignes
  // plus espacées ») : 4 px → 8 px de pas, même angle, même trait de 1 px.
  hatchVoid: jeton(
    "hatch-void",
    "repeating-linear-gradient(135deg, #B9C7CC 0 1px, transparent 1px 8px)"
  ), // la part À VIDE d'un trajet, PARTOUT depuis le 2026-09-14 (grille, barres, légende)
};

// La barre client (guidelines § 9.5, 2026-09-14) — la bande qui porte le nom du client, compact
// ET détaillé. Une couleur de catégorie, pas d'alerte.
// Le type d'une boucle (guidelines § 9.7, 2026-09-14) — le fond de la pastille RETOUR / MUTUALISATION.
// 🔁 RÉVISÉ le 2026-09-28 (retours du 28/09, contrat K5) : `retour` passe du bordeaux `#7A2333` au
// violet de la charte (secours aligné sur `--accent-violet`, cf. `index.css`).
export const TypeBoucle = {
  retour: jeton("boucle-retour", "#534AB7"),
  mutualisation: jeton("boucle-mutu", "#6BBBAE"),
};

// La pastille TRANSBO (guidelines § 9.9, 2026-09-27) — la seule couleur nouvelle du chantier « v2 :
// retours du 27/09 » : un fuchsia qu'aucun autre sens n'occupe. Pastille pâle (`bg`) + encre (`ink`),
// comme les étiquettes CHG / LIV d'une carte du planning.
export const Transbo = {
  ink: jeton("transbo", "#A61E6E"),
  bg: jeton("transbo-bg", "#FCE7F2"),
};

// 🔁 RÉVISÉ le 2026-09-15 (chantier UX v7, lot M1, retour 4 de Louis) : le pêche unique se scinde
// en deux jetons — `bar`/`border` pour un lot SANS boucle décidée (bleu ardoise),
// `barBoucle`/`borderBoucle` pour une tournée AVEC boucle décidée (vert Hexvia, = `--gain-vif`).
export const Client = {
  bar: jeton("client-bar", "#5B7083"),
  border: jeton("client-bar-border", "#495C6C"),
  barBoucle: jeton("client-bar-boucle", "#65B32E"),
  borderBoucle: jeton("client-bar-boucle-border", "#4E8F22"),
};

// La bordure d'un encadré coloré : la même teinte que son fond, un cran plus
// soutenue. Une seule règle (25 % de couleur dans le fond pâle) remplace les huit
// valeurs qui traînaient en dur dans le JSX — cf. l'explication dans `index.css`.
// `Tb.bl` va avec `T.bll`, `Tb.g` avec `T.gl`, etc.
export const Tb = {
  bl: jeton("info-border", "#B3C6DA"),
  g: jeton("success-border", "#B3D5C3"),
  am: jeton("warning-border", "#EBCEAF"),
  rd: jeton("destructive-border", "#EDC0BB"),
  pr: jeton("accent-violet-border", "#C7C4EC"),
  or: jeton("accent-orange-border", "#EFCBAD"),
};

// Une teinte translucide d'un jeton — remplace l'ancien « hexadécimal + suffixe
// d'opacité » (`${T.g}30`), qui supposait que le jeton soit un hexadécimal.
// `pourcent` est la part de couleur, le reste étant transparent : 19 % équivaut
// à l'ancien suffixe `30` (0x30 = 48 sur 255).
export const alpha = (couleur, pourcent) =>
  `color-mix(in srgb, ${couleur} ${pourcent}%, transparent)`;

// Couleur des RÔLES ANCRE et ACCROCHÉ d'une boucle — fixe, jamais celle de
// l'agence : deux agences aux couleurs voisines rendaient les deux dossiers
// indiscernables. Le rôle est une information de lecture (« lequel des deux
// dossiers »), l'agence en est une autre — chacune sa couleur.
// Partagée par la carte du parcours et le panneau de propositions, qui doivent
// dire la même chose.
//
// RÉVISÉ le 2026-09-02 (lot A, arbitrage Louis) : un VRAI bleu pour l'ancre, un VRAI vert vif
// (Hexvia) pour l'accroché — famille RÔLE, un axe à elle, INDÉPENDANT de `--info` et de
// `--primary` (cf. `index.css`, bloc « Rôle d'un lot dans une boucle »). Trois exports, pas un :
//   • `COUL_ROLE`    — l'ARÊTE (bordure du mode détaillé) ET l'APLAT SATURÉ du mode compact.
//     ⚠️ `.ACC` (`--role-acc`, le vert vif) ne tient que 2,61:1 sur blanc : à n'employer QUE
//     comme trait/aplat, jamais comme texte — c'est tout le sens du dédoublement du vert du
//     2026-09-01 un peu plus haut, rejoué ici pour un second axe.
//   • `COUL_ROLE_BG` — l'aplat PÂLE du mode détaillé (fond de l'arrêt, derrière l'arête).
//   • `COUL_ROLE_INK` — l'encre à employer quand le rôle doit s'écrire en TEXTE sur un fond
//     clair (ex. la nature d'un arrêt en mode détaillé) : pour l'accroché, JAMAIS `COUL_ROLE.ACC`
//     — son encre dédiée, lisible (5,24:1) ; pour l'ancre, la MÊME valeur que l'arête, déjà
//     lisible en texte (~6,3:1), donc rien de nouveau à porter.
//   • `COUL_ROLE_ON` — 🆕 2026-09-14 — le texte D'UN APLAT SATURÉ de rôle (bloc compact, pastille
//     ACC/ANC, numéro d'un point de carte) : BLANC pour les DEUX rôles (arbitrage Louis, guidelines
//     § 9.1). ⚠️ Remplace la règle d'avant (« encre foncée `T.tx` sur l'accroché ») : sur le vert
//     vif, le blanc ne tient que 2,61:1 — choix assumé, repli prêt (`--role-acc` → `#4E8F22`).
//
// 🔁 L'ANCRE est TEAL depuis le 2026-09-14 (`#086882`, = `--info`), et non plus le bleu franc
// `#1155CC` (arbitrage Louis) — partout où le rôle se dessine.
// `ANC2` (2026-09-16, arbitrage Louis) : le second lot DÉJÀ sur le camion quand une proposition
// forme une tournée à trois — violet, lisible en texte comme le teal (≈ 6:1 sur blanc).
export const COUL_ROLE = { ACC: jeton("role-acc", "#65B32E"), ANC: jeton("role-ancre", "#086882"), ANC2: jeton("role-ancre2", "#7B4FA3") };
export const COUL_ROLE_BG = { ACC: jeton("role-acc-bg", "#EEF7E7"), ANC: jeton("role-ancre-bg", "#DFEAED"), ANC2: jeton("role-ancre2-bg", "#F0E9F6") };
export const COUL_ROLE_INK = { ACC: jeton("role-acc-ink", "#3F7A1B"), ANC: COUL_ROLE.ANC, ANC2: COUL_ROLE.ANC2 };
export const COUL_ROLE_ON = { ACC: jeton("role-on", "#FFFFFF"), ANC: jeton("role-on", "#FFFFFF"), ANC2: jeton("role-on", "#FFFFFF") };
