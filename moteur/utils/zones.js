// ── ZONES DE CHALANDISE — G1, LE GARDE-FOU DE TERRITOIRE ────────────────────
// Arbitrage Louis 2026-07-28 (retour), ÉTENDU À LA MUTUALISATION le 2026-08-19.
// Le contrôle porte sur l'APPARTENANCE TERRITORIALE des chantiers, pas sur une distance.
// Deux géométries, deux contrôles, un seul référentiel de zones :
//   • `checkRetourPiliers` — RETOUR, règle des piliers D7 (depuis le 2026-09-15) : au moins un pilier
//                            tient, « maison » ou « au loin ». C'est LE contrôle G1 du moteur.
//   • `checkMutuZones`     — les deux chargements se collectent dans LA MÊME zone.
//   • `checkRetourZones`   — l'ANCIENNE règle du retour (« 4 points », croisement complet). Ce n'est
//                            plus un garde-fou : elle ne sert plus qu'à DÉCRIRE un retour qui relie
//                            deux zones dans les deux sens (libellé « Ouest ↔ PACA ») et à mesurer
//                            l'ancienne règle dans les scripts d'analyse.
// G1 est désormais le SEUL garde-fou géographique des deux scénarios : les deux seuils de
// proximité qui le doublaient (`seuilProxRetourKm` au retour, `seuilProxMutuKm` en mutu) ont
// été retirés de la formation des boucles le 2026-08-19. Ce qui borne le reste est
// kilométrique et vit ailleurs : G2 (budget de détour) et G5 (rendement), dans
// `engine/gardesBoucle.js`.
//
// Pourquoi pas un rayon autour du dépôt : sur le cas fondateur (CHT-158193 / CHT-003327),
// le dépôt est à Guer (56) ; Marseille — la destination LÉGITIME — est à 784 km, Paris —
// celle qu'on veut refuser — à 348 km. Tout rayon qui accepte Marseille accepte Paris.
// La règle n'est pas métrique, elle est topologique : il faut nommer les zones.
//
// Une zone = { code, label, coeur: [depts], peripherie: [depts] }.
// Cœur et périphérie sont stockés SÉPARÉMENT (la distinction servira plus tard pour définir
// les départements traités en vente par chaque agence) mais le moteur en prend l'UNION :
// pour la zone de chalandise, un département périphérique vaut un département cœur.
//
// Liste VIDE (`zonesRetour: []`) ⇒ règle INACTIVE, comportement d'avant l'arbitrage.

// Département d'un code postal français.
// Tolère un CP à 4 chiffres (zéro de tête perdu par un export Excel : "4000" → "04000").
// DOM (97x/98x) sur 3 chiffres. Corse : "20" (2A/2B non distinguables depuis le seul CP).
export function departementOf(cp) {
  const s = String(cp ?? "").trim();
  if (!/^\d{4,5}$/.test(s)) return null;
  const p = s.padStart(5, "0");
  return (p.startsWith("97") || p.startsWith("98")) ? p.slice(0, 3) : p.slice(0, 2);
}

// Tous les départements d'une zone, cœur + périphérie confondus.
export function departementsDeZone(zone) {
  return [...(zone?.coeur || []), ...(zone?.peripherie || [])];
}

// Code de la zone contenant ce CP, ou null si le CP n'appartient à aucune zone déclarée.
export function zoneOf(cp, zones = []) {
  const dep = departementOf(cp);
  if (!dep) return null;
  const z = (zones || []).find(z => departementsDeZone(z).includes(dep));
  return z ? z.code : null;
}

// Libellé lisible d'une zone (pour les messages de rejet), repli sur le code.
export function labelZone(code, zones = []) {
  return (zones || []).find(z => z.code === code)?.label || code;
}

// ── LE CROISEMENT COMPLET D'UN RETOUR (« 4 points ») — PLUS UN GARDE-FOU ─────
// ⚠️ Depuis le 2026-09-15, le moteur juge le territoire d'un retour avec `checkRetourPiliers`
// (plus bas). Cette fonction exige les DEUX piliers à la fois ; elle reste exportée pour DÉCRIRE un
// retour « Z1 ↔ Z2 » à l'écran et pour mesurer l'ancienne règle dans les scripts d'analyse. Ne pas
// la rebrancher comme barrière : elle refuserait les retours à un seul pilier, que D7 admet.
//
// Géométrie attendue (niveau « croisement », arbitrage Louis 2026-07-28) :
//   chg ancre  ∈ Z1   ·   liv ancre  ∈ Z2
//   chg accroché ∈ Z2   ·   liv accroché ∈ Z1        avec Z1 ≠ Z2
// C'est la définition métier d'un retour : le camion part de sa zone chargé, livre dans
// l'autre zone, y recharge, et rentre chargé. Le niveau faible (« les 4 points sont dans
// une zone déclarée, peu importe le sens ») laisserait passer un faux retour Z2→Z2, qui
// n'est qu'un déménagement local de l'agence d'en face.
//
// ⚠ Ne s'applique qu'au RETOUR — la mutualisation a sa propre géométrie et son propre
// contrôle, `checkMutuZones` (plus bas). La mention « les 2 dossiers partent forcément de la
// même zone » qui figurait ici n'était vraie que TANT QUE les 80 km de `seuilProxMutuKm`
// l'imposaient : ce seuil retiré (2026-08-19), c'est `checkMutuZones` qui l'exige désormais.
//
// Retourne { ok: true, zoneAller, zoneRetour } ou { ok: false, raison } — `raison` est
// destinée aux logs moteur et à la fiche de diagnostic, elle doit rester lisible.
export function checkRetourZones({ chgAncre, livAncre, chgAccroche, livAccroche }, zones = []) {
  if (!zones || zones.length === 0) return { ok: true, inactif: true };

  const z = {
    chgAncre: zoneOf(chgAncre, zones),
    livAncre: zoneOf(livAncre, zones),
    chgAccroche: zoneOf(chgAccroche, zones),
    livAccroche: zoneOf(livAccroche, zones),
  };

  // 1. Appartenance — tout point hors zones déclarées disqualifie la boucle.
  const LIB = {
    chgAncre: "chargement ancre", livAncre: "livraison ancre",
    chgAccroche: "chargement accroché", livAccroche: "livraison accroché",
  };
  const cps = { chgAncre, livAncre, chgAccroche, livAccroche };
  const hors = Object.keys(LIB).filter(k => !z[k]).map(k => `${LIB[k]} (${cps[k]})`);
  if (hors.length > 0) return { ok: false, raison: `hors zones de chalandise : ${hors.join(", ")}` };

  // 2. Croisement — l'aller doit relier deux zones DIFFÉRENTES.
  if (z.chgAncre === z.livAncre) {
    return { ok: false, raison: `aller interne à la zone ${labelZone(z.chgAncre, zones)} — ce n'est pas un retour` };
  }
  // 3. L'accroché doit repartir de la zone où l'ancre vient de livrer…
  if (z.chgAccroche !== z.livAncre) {
    return { ok: false, raison: `chargement accroché en ${labelZone(z.chgAccroche, zones)}, or l'ancre livre en ${labelZone(z.livAncre, zones)}` };
  }
  // 4. …et ramener la marchandise dans la zone de départ de l'ancre.
  if (z.livAccroche !== z.chgAncre) {
    return { ok: false, raison: `livraison accroché en ${labelZone(z.livAccroche, zones)}, or l'ancre est parti de ${labelZone(z.chgAncre, zones)}` };
  }

  return { ok: true, zoneAller: z.chgAncre, zoneRetour: z.livAncre };
}

// ── G1 AU RETOUR — LA RÈGLE DES PILIERS (D7) ────────────────────────────────
// Tranchée en doctrine (`docs/boucles/boucles-etat-a-date.md` § 2.2, D6 + D7), CODÉE le 2026-09-15.
// Elle remplace `checkRetourZones` comme garde-fou : le croisement complet exigeait les deux
// piliers à la fois, la doctrine n'en demande qu'UN. Valable pour N zones, sans comptage de points.
//
//   pilier MAISON  — chg ANC ∈ zone du DÉPÔT  et  liv ACC ∈ zone du DÉPÔT
//                    → le camion part de chez lui et rentre chargé.
//   pilier AU LOIN — liv ANC et chg ACC dans une MÊME zone, AUTRE que celle du dépôt
//                    → le camion recharge là où il vient de décharger.
//
// 🔑 D6 — le vrai pilier n'est pas le chargement de l'ancre, c'est le DÉPÔT. `depot` est le CP du
// dépôt du CAMION qui porte la boucle (celui où il rentre). Dépôt inconnu ou hors zones : le pilier
// maison ne peut pas tenir, le pilier au loin reste possible (toute zone est « autre »).
// 🔑 P8 — sur une ancre qui est une PAIRE, `chgAncre`/`livAncre` sont les points de l'ANCRE DE LA
// PAIRE (identité), jamais la dernière livraison physique de la tournée.
//
// ⚠️ CE QUE LE PILIER NE DIT PAS : si c'est sur la route (G2, le détour) ni combien ça rapporte (km
// évités, G5). Un pilier seul laisse passer des destinations hors zone — c'est voulu, le détour les
// borne. Exemple : l'ancre descend Rennes → Marseille, l'accroché recharge à Sanary et livre Paris ;
// le camion recharge là où il a déchargé (au loin ✅), Paris est sur le chemin du retour en
// Bretagne, et c'est G2 qui juge le détour. Sous l'ancienne règle, ce cas était refusé.
//
// Liste VIDE ⇒ règle INACTIVE (`inactif: true`), comme les autres contrôles de zone : D4 reformulé
// (« pas de zone ⇒ aucune proposition ») reste À VALIDER et n'est pas appliqué.
//
// Retourne { ok: true, pilier, maison, auLoin, zoneDepot, zoneLoin } ou { ok: false, raison, … }.
// `pilier` vaut "maison", "au loin" ou "maison + au loin" — libellé prêt pour l'écran.
export function checkRetourPiliers({ depot, chgAncre, livAncre, chgAccroche, livAccroche }, zones = []) {
  if (!zones || zones.length === 0) return { ok: true, inactif: true };

  const zD = zoneOf(depot, zones);
  const zChgAnc = zoneOf(chgAncre, zones), zLivAnc = zoneOf(livAncre, zones);
  const zChgAcc = zoneOf(chgAccroche, zones), zLivAcc = zoneOf(livAccroche, zones);

  const maison = !!zD && zChgAnc === zD && zLivAcc === zD;
  const auLoin = !!zLivAnc && zLivAnc === zChgAcc && zLivAnc !== zD;
  const base = { maison, auLoin, zoneDepot: zD, zoneLoin: auLoin ? zLivAnc : null };
  if (maison || auLoin) {
    return { ok: true, ...base, pilier: maison && auLoin ? "maison + au loin" : maison ? "maison" : "au loin" };
  }

  // Aucun pilier : dire POURQUOI chacun tombe, en clair — la raison part dans le journal du moteur
  // et dans le diagnostic d'un lot.
  const lib = (code) => (code ? labelZone(code, zones) : "hors zones");
  const pourquoiMaison = !zD
    ? `dépôt (${depot || "inconnu"}) hors zones déclarées`
    : `chargement ancre en ${lib(zChgAnc)} et livraison accroché en ${lib(zLivAcc)}, dépôt en ${lib(zD)}`;
  const pourquoiLoin = !zLivAnc
    ? `livraison ancre (${livAncre}) hors zones déclarées`
    : zLivAnc === zD
      ? `l'ancre livre dans la zone du dépôt (${lib(zD)})`
      : `l'ancre livre en ${lib(zLivAnc)} mais l'accroché charge en ${lib(zChgAcc)}`;
  return { ok: false, ...base, raison: `aucun pilier — maison : ${pourquoiMaison} · au loin : ${pourquoiLoin}` };
}

// ── CONTRÔLE D'UNE MUTUALISATION ────────────────────────────────────────────
// Arbitrage Louis 2026-08-19. G1 (territoire) ne couvrait QUE le retour ; la mutualisation
// n'avait pour tout garde-fou géographique que `seuilProxMutuKm` (80 km entre les deux
// chargements). Ce seuil est RETIRÉ, et c'est G1 qui prend sa place — même doctrine que le
// retour : la règle n'est pas métrique, elle est topologique.
//
// Ce que la règle demande, et rien de plus :
//   chg ancre ∈ Z   ·   chg accroché ∈ Z        — LA MÊME zone déclarée
//
// Pourquoi seulement les CHARGEMENTS. Une mutualisation est une COLLECTE commune : le camion
// prend deux dossiers puis les livre. C'est le détour de collecte que les 80 km bornaient, et
// c'est donc lui que G1 doit borner. Les LIVRAISONS restent libres — l'arbitrage du 2026-07-28
// le disait déjà (« prendre un dossier dont la livraison est ailleurs reste acceptable »), et
// ce qu'elles coûtent est mesuré par G2 (budget de détour) puis par G5 (rendement), qui voient
// la géométrie complète. Ajouter une contrainte de zone sur les livraisons refuserait le cas
// le plus rentable de la mutualisation : deux dossiers chargés côte à côte pour deux
// destinations proches l'une de l'autre mais hors zone déclarée.
//
// ⚠️ ÉCART DE SÉVÉRITÉ ASSUMÉ. Deux chargements d'une même zone peuvent être à 300 km l'un de
// l'autre (l'Ouest va du Finistère à la Sarthe) : la règle est donc BEAUCOUP plus large que les
// 80 km qu'elle remplace. C'est le sens de l'arbitrage — ce qui borne désormais le détour de
// collecte, c'est G2, en kilomètres et sur la géométrie réelle, pas un rayon fixé à l'avance.
//
// Retourne { ok: true, zone } ou { ok: false, raison }.
export function checkMutuZones({ chgAncre, chgAccroche }, zones = []) {
  if (!zones || zones.length === 0) return { ok: true, inactif: true };

  const zAnc = zoneOf(chgAncre, zones);
  const zAcc = zoneOf(chgAccroche, zones);

  // 1. Appartenance — un chargement hors zones déclarées disqualifie la mutualisation.
  const hors = [];
  if (!zAnc) hors.push(`chargement ancre (${chgAncre})`);
  if (!zAcc) hors.push(`chargement accroché (${chgAccroche})`);
  if (hors.length > 0) return { ok: false, raison: `hors zones de chalandise : ${hors.join(", ")}` };

  // 2. Même zone — c'est une collecte commune, pas un croisement (contrairement au retour).
  if (zAnc !== zAcc) {
    return { ok: false, raison: `chargements en ${labelZone(zAnc, zones)} et ${labelZone(zAcc, zones)} — une mutualisation collecte dans UNE zone` };
  }

  return { ok: true, zone: zAnc };
}
