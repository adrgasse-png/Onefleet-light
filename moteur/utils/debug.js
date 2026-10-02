export const DEBUG_STORE = {
  logs: [],
  enabled: false,
  listeners: new Set(),
  metrics: {
    sessionStart: Date.now(),
    // Moteur de boucle
    boucle_recherches: 0,              // nb d'appels à findBoucleCandidates
    boucle_candidats_proposes: 0,      // nb total de candidats émis (retour + mutu)
    boucle_compactees: 0,              // retour compacté : livraison de B avancée pour livrer A + tôt (règle §4)
    boucle_balayages_flex: 0,          // mutu regroupée à une autre date de la fenêtre de flex (chaîne + courte)
    boucle_sauvees_par_remaniement: 0, // retour rejeté week-end puis sauvé en avançant la livraison de B dans sa flex
    boucle_rejets_pas_cp: 0,
    boucle_rejets_deja_boucle: 0,
    boucle_rejets_hors_fenetre: 0,
    boucle_rejets_pas_place: 0,
    boucle_rejets_F4_distance: 0,      // rejet F4 (distance hors seuil proximité)
    boucle_rejets_F5_capacite: 0,
    boucle_rejets_dates: 0,            // rejet plage dates / flex hors range
    boucle_rejets_weekend: 0,          // rejet v7 : weekend-traversal sur trajet inter-op
    boucle_rejets_pose_divergente: 0,  // la pose rejouée (reflowVehicle) ne tiendrait pas la proposition — dates annoncées, Q15 ou paire (2026-09-16)
    boucle_rejets_kmEco: 0,            // kmEco < minKmEco
    boucle_rejets_attente: 0,          // attente > ecartMaxH — RETOUR : entre liv ANCRE et chg ACCROCHÉ ;
                                       // MUTU (2026-08-14) : collecte, entre les deux chargements
    boucle_rejets_cp_inconnu: 0,       // CP hors référentiel gps.js → exclu des propositions
    boucle_rejets_zone: 0,             // G1 territoire (utils/zones.js) : retour sans aucun pilier (D7, `checkRetourPiliers`), ou mutualisation dont les deux chargements ne sont pas dans la même zone (`checkMutuZones`)
    boucle_rejets_chg_vendu: 0,        // Q15 : la chaîne posée déplacerait le chargement VENDU de B → boucle supprimée
    boucle_rejets_pied_oeuvre: 0,      // Q20 (2026-08-18, provisoire) : rechaînage refusé dans detectBoucles — nuit intercalée et PL pas à pied d'œuvre (> seuilResterSurPlaceKm) pour l'accroché ; la règle des 80 km prime, décision ou pas
    boucle_rejets_pl_occupe: 0,        // Q14 : le PL de B porte déjà un autre chantier sur la plage de la boucle
    boucle_rejets_non_decidee: 0,      // 2 lots voisins sur le camion mais AUCUNE boucle acceptée → ni badge ★ ni km évités (l'enchaînement, lui, reste posé)
    // ── TRANCHE 4B — LA GREFFE SUR UNE UNITÉ (2026-09-04) ───────────────────────────────────────
    boucle_rejets_accroche_deja_lie: 0,     // C2 bis : le lot en cours de placement porte DÉJÀ un lien. On ne greffe qu'un lot SEUL — c'est cette dissymétrie qui borne la tournée à trois. ⚠️ Ce rejet FERME un chemin qui était ouvert : le verrou historique ne regardait que l'ancre, et la pose ne savait de toute façon pas honorer un accroché en paire.
    boucle_rejets_tournee_pleine: 0,        // C1 : la tournée de l'ancre compte déjà trois lots. Borne dure, elle ne se négocie pas.
    boucle_rejets_maillon_en_vol: 0,        // C2 : une greffe est déjà proposée sur cette tournée et attend sa réponse — une paire, PUIS l'autre.
    boucle_rejets_accroche_de_retour: 0,    // C3 (garde explicite, 2026-09-15) : l'ancre envisagée est l'ACCROCHÉ d'un retour — elle roule sur le camion d'une autre agence, lui greffer un lot en confierait deux à cette agence.
    boucle_rejets_retour_sur_retour: 0,     // un retour derrière un retour : autre sujet, ni mesuré ni arbitré (le camion repartirait d'un troisième point sans jamais rentrer).
    boucle_rejets_mutu_sur_mutu: 0,         // trois lots dans le camion en même temps : ce n'est plus le double couplage arbitré.
    boucle_rejets_tournee_non_chiffrable: 0,// ancre = paire mutualisée dont une chaîne n'est pas exploitable : le repli géométrique ne sait décrire qu'UN dossier ancre, donc AUCUNE proposition. Jamais un mauvais chiffre plutôt qu'un trou.
    boucle_rejets_accroche_ne_suit_plus: 0, // 4C, orientation n°2 : mutualiser devant l'ancre allonge le voyage, et AUCUNE date de la flex ne laisse le retour déjà accroché tenir derrière (chargement vendu déplacé, ou plage physique rompue).
    boucle_rejets_accroche_en_paire: 0, // l'accroché est une paire MUTUALISÉE : la rechaîner reviendrait à la casser (anomalie α). C'est le COUPLAGE — cf. Q-F. La pose est conservée telle quelle.
    weekend_hors_depot_sans_remede: 0, // 🔴 Q17 NON TENUE (2026-08-18) : aucun des trois remèdes ne s'applique — mission plus longue qu'une semaine ouvrée, le camion est dehors le week-end. La chaîne est posée quand même (ne jamais faire disparaître un dossier en silence) mais elle est comptée, journalisée et marquée à l'écran. ⚠️ ordre de grandeur, pas un décompte exact : un dossier à plage élargie peut compter double.
    weekend_hors_depot_hors_axe: 0,    // ↳ cause « la semaine suivante n'est pas affichée » : le décalage au lundi n'est pas représentable sur la fenêtre en cours. PAS une impasse métier — le geste est d'élargir la période. Rarissime en production (axe ~130 jours).
    weekend_hors_depot_hors_depot: 0,  // ↳ cause « chantier enchaîné sans être rentré au dépôt » (2026-09-15) : coupure et livraison avancée impossibles, décalage au lundi interdit (le camion attendrait sur place). `reflowVehicle` fait alors rentrer le camion avant le chantier ; ce compteur ne doit rester non nul que sur les chaînes d'essai écartées.
    enchainements_refuses_q17: 0,      // 🔴 Q17 à la pose (2026-09-15) : le camion devait rester sur place pour le chantier suivant, mais ce chantier aurait passé un week-end hors dépôt → rentrée au dépôt forcée entre les deux.
    weekend_hors_depot_trop_long: 0,   // ↳ cause « la mission déborde la semaine ouvrée » même reprise d'un lundi frais. VRAIE impasse : aucune fenêtre plus large n'y changera rien. C'est ce compteur-là qu'il faut regarder.
    boucle_non_chiffrable_tournee: 0,  // Lot 1 (2026-08-18) : boucle DÉCIDÉE et rechaînée, mais son gain n'a pas pu être chiffré — l'unité ancre est une tournée mutualisée dont une des chaînes n'est pas exploitable, et le repli géométrique ne sait pas décrire une paire. Ce n'est PAS un rejet : le badge reste, seul le chiffre manque.
    boucle_bloquees_diagnostiquees: 0, // boucle écartée faute de camion mais faisable sur un autre PL du dépôt
    boucle_bloquees_sans_camion: 0,    // boucle écartée : des camions au gabarit existent, mais aucun n'est libre — décaler la date peut débloquer
    boucle_bloquees_hors_gabarit: 0,   // boucle écartée : AUCUN camion de l'agence ne peut charger ce volume — contrainte de FLOTTE, rien à retenter
    boucle_retours_acceptes: 0,        // stat : retour accepté par B
    boucle_retours_refuses: 0,         // stat : retour refusé par B
    // Règle vendredi-route
    friday_decalages_buildchain: 0,    // nb de décalages trs → lundi dans buildChain (lot local/retour)
    friday_decalages_approche: 0,      // nb de décalages approche → lundi (Q17 : PL jamais loin du dépôt le week-end)
    friday_decalages_mutu: 0,          // idem dans buildMutuChain
    friday_decalages_rebuild: 0,       // idem dans addRebuildBlock (boucle retour)
    // Garde week-end retour (Q17 étendu au retour dépôt)
    weekend_coupures_depot: 0,         // coupure au dépôt après chargement (buildChain)
    weekend_livraisons_avancees: 0,    // livraison avancée dans la flex pour rentrer avant le week-end (buildChain)
    weekend_decalages_retour: 0,       // repli : tournée décalée au lundi (buildChain)
    weekend_coupures_depot_mutu: 0,    // coupure au dépôt après chargement (buildMutuChain)
    weekend_decalages_retour_mutu: 0,  // repli : tournée décalée au lundi (buildMutuChain)
    // Signal « camion chargé immobile » (> 4 h ouvrées d'inactivité, lot resserrable)
    inactivite_signalee: 0,
    // Nuit d'inactivité créditée au dépôt : le PL est à ≤ seuilResterSurPlaceKm de sa base
    // (2026-08-19, diag CHT-774981 — cf. chainBuilder.marquerNuitsAuDepot)
    nuits_au_depot: 0,
    // Placement
    placements_local: 0,
    placements_callback_auto: 0,       // bascule automatique callback (pas de PL dispo)
    placements_unlocked: 0,
    placements_locked: 0,
  },
  log(cat, msg, data) {
    if (!this.enabled) return;
    this.logs.push({ t: Date.now(), cat, msg, data });
    if (this.logs.length > 500) this.logs.shift();
    this.listeners.forEach(fn => fn());
  },
  inc(metric, n = 1) {
    if (typeof this.metrics[metric] !== "number") {
      console.warn("[debug.inc] métrique inconnue :", metric);
      return;
    }
    this.metrics[metric] += n;
    this.listeners.forEach(fn => fn());
  },
  resetMetrics() {
    Object.keys(this.metrics).forEach(k => {
      if (k !== "sessionStart") this.metrics[k] = 0;
    });
    this.metrics.sessionStart = Date.now();
    this.listeners.forEach(fn => fn());
  },
  clear() { this.logs = []; this.listeners.forEach(fn => fn()); },
  setEnabled(v) { this.enabled = v; this.listeners.forEach(fn => fn()); },
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
};
export const debug = DEBUG_STORE;
