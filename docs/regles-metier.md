# Règles métier — OneFleet

> 🟢 **Document vivant** — fait foi sur : les règles métier (constantes, statuts, boucles, chaînage, déplacements, rôles).
>
> Document **canonique** des règles métier. À lire avant toute tâche touchant le moteur ou les règles,
> et à mettre à jour après tout changement de règle.
> Les **constantes** vivent dans `src/data/referentiels.js` (`RULES_DEFAULTS`) ; la **logique** dans
> `src/engine/` (`boucleEngine.js`, `chainBuilder.js`). Les cas de tests métier sont rejoués par
> `src/test/engine/businessCases.juin26.test.js`.

Dernière révision : **2026-09-16 nuit** — §4 **la recherche de boucle lit l'ancre telle qu'elle est posée** et valide chaque proposition en rejouant la pose (diag CHT-933597). Précédent : **2026-09-16 soir** — §4 **signal « camion chargé immobile » : le vendredi après-midi ne compte plus** quand l'attente passe le week-end (le camion rentre au dépôt). Précédent : **2026-09-16** — §4 **placement sans boucle : camions de toute la région** (agence vendeuse d'abord, puis sa région ; masqués si « vendeuse seulement » ; dates alternatives seulement si toute la région est saturée). Précédent : **2026-09-15** — 🔴 **§3, LA RÈGLE DES PILIERS (D7) EST DANS LE MOTEUR** : au retour, le territoire exige désormais **au moins un pilier** — *maison* (chg ANC et liv ACC dans la zone du dépôt du camion) ou *au loin* (liv ANC et chg ACC dans une même autre zone) — au lieu des quatre points croisés (`checkRetourPiliers`, `utils/zones.js`, appliqué dans `findBoucleCandidates` **et** `detectBoucles`). ⚠️ Le cas fondateur CHT-158193 / CHT-003327 (retour livré à Paris) **passe** désormais le territoire par le pilier au loin : c'est le détour (G2) qui le juge. **Aussi, §4 Q17** : une paire mutualisée suivie d'un troisième lot gardait mal sa coupure du vendredi à la pose (le camion dormait chargé chez le client) — corrigé, comme le lot simple l'avait été le 2026-07-24 (CHT-003327). Et **C3** reçoit une garde explicite : l'accroché d'un retour n'ancre aucune greffe. Et **§4, nuit entre deux chantiers** : l'écart qui décide si le camion rentre au dépôt se mesure désormais depuis la livraison **réellement posée** (une paire livre souvent un jour après la `dateL` de son ancre) — Q17 prime toujours. Et 🔴 **§4 Q17, trou fermé** : la garde week-end vaut désormais sur **tout** chantier, y compris enchaîné (camion resté à la livraison précédente). Un tel chantier n'a droit qu'aux remèdes qui ramènent le camion au dépôt (coupure, livraison avancée) ; sinon le camion **rentre au dépôt avant lui**. `detectBoucles` refuse tout rechaînage qui laisserait le camion dehors le week-end. Et **§4, liaison immédiate** (arbitrage Louis) : un camion resté sur place après une livraison **part aussitôt** vers le chargement suivant (il roule le soir et dort près du client), le chargement restant tenu à sa date ; **Q13 ne vaut que pour l'approche depuis le dépôt**, posée le jour du chargement.

Révision précédente : **2026-08-19** — 🔴 **§1 et §3, LES SEUILS DE PROXIMITÉ NE FORMENT PLUS DE
BOUCLES, G1 COUVRE LA MUTUALISATION, ET G2 PASSE À 500 KM** (arbitrage Louis, sur la campagne « fil
de l'eau vs big bang » du 18/08). ① `seuilProxRetourKm` **plafonnait le détour avant que G2 le
mesure** — la liaison à vide est le premier terme du détour, donc G2 n'a jamais pu juger un couple
que ce seuil avait déjà écarté (liaison médiane 109 km, **maximum 298** contre un plafond à 300 : la
population était plaquée contre la borne). ② `seuilProxMutuKm` (80 km) est **SUPPRIMÉ** : il n'était
serré que parce qu'il était **seul**, et **G1 couvre désormais la mutualisation** — `checkMutuZones`,
les deux **chargements** dans la même zone déclarée, livraisons libres. ③ **G2 : 400 → 500 km**
(+26 634 km évités, +17 boucles, contre +8 boucles douteuses sur 740 — **arbitrage assumé**, la
mesure ne désigne pas 500). ⚠️ **Ce que plus rien ne facture** : le roulage **à vide** en tant que
tel. ⚠️ **Ce qui reste ouvert** : le **rechaînage physique**, seul usage survivant de
`seuilProxRetourKm` → **Q21**, à trancher avec **Q20**. Précédente : **2026-08-13** — **§3, trois anomalies du moteur de pose corrigées** : ① **une
paire mutualisée est INSÉCABLE** — `detectBoucles` raisonne désormais en *unités de tournée* et ne
rebâtit plus un membre de paire tout seul (α) ; ② **le retour dépôt ne se réinvente pas à la
détection** — on relit ce que la pose a décidé au lieu de re-trancher (β) ; ③ γ est tombée avec α.
Au passage : `buildMutuChain` étiquetait son premier trajet « approche depuis le dépôt » même quand
la paire partait du chantier précédent. Et **la rallonge s'affiche** sur la proposition
(`engine/mesuresBoucle.js`, UI-RAL — elle n'écarte aucun candidat). Précédente : **2026-08-04** —
**quatre arbitrages Louis, §4, tous côté réglages du dossier** :
① **un bloc du Gantt ne se retouche plus à la main** (`EditBlockModal` **supprimée** ; clic sur un
bloc chargement/livraison → **fiche détail du chantier**, et le verrouillage des dates y déménage) ;
② **en mutualisation, la plage horaire s'écrit des DEUX côtés** (`utils/plagesMutu.js`, point
d'application unique) — la règle d'intersection est saine, c'est l'interface qui laissait régler un
seul dossier et neutralisait le réglage en silence ; ③ **la journée de trop se cherche aux deux
bouts** (`utils/debordement.js`, sens *amont* / *aval*, garde-fou anti-bruit à l'amont) ; ④ **équipe
et durées de manutention redeviennent modifiables sur un chantier posé**, depuis la fiche
(`LigneManutention`, mécanique partagée avec la modale de débordement). Précédent :
**2026-08-03 (soir)** — **trois corrections**, §4 : ① **exemption « chargement du
vendredi »** sur le signal « camion chargé immobile » (charger le vendredi pour partir le lundi est
un choix, pas un gaspillage — ni constat ni consigne) ; ② **la plage horaire passe du DOSSIER à la
JOURNÉE** (`plagesParDate`, résolveur `plagesDuLot`/`plageAt`, aucune migration) et **l'heure réglée
vaut pour la première activité du jour**, approche comprise (`reflowVehicle` ne code plus `DAY_START`
en dur) ; ③ **boucles écartées faute de camion** — le bandeau s'ouvre de lui-même et le cas « aucun
camion possible », jusqu'ici totalement invisible, est enfin émis (§3). Précédent : **2026-08-01** —
**remède 1 bis « livrer plus tôt »** (§ « Règle week-end » :
sur une tournée qui viole Q17, la livraison peut être avancée de 1 à 4 j ouvrés pour ramener le PL
au dépôt ; quatre garde-fous, dont « jamais pire ») et **dérogation associée** à la règle
« livraison à date » (§4). Précédent : **2026-07-31 (soir, lot 2)** — **plage horaire élargie dossier par dossier**
(§1 `reliquatMaxH` · §4 : départ dès 5h / fin jusqu'à 21h, activée à la POSE uniquement, garde-fou
« jamais pire » qui rend Q17 invérifiable-par-le-raisonnement mais VÉRIFIÉE à l'exécution) et
**alerte « ce chantier déborde d'une journée »** qui remplace l'alerte « nuit dehors ».
Même jour : **recadrage des alertes « hors dépôt la nuit »** (§4 :
l'alerte au placement est supprimée, `alerteNuitsMin` retiré ; le signal 🌙 passe du premier bloc à
**chaque soirée concernée** et devient dérivé ; le message « dates à resserrer » compte les nuits et
ne s'affiche que sur un dossier **resserrable**). Même jour : **Q15 étendue à la POSE (4ᵉ chemin)** et
**date SOUHAITÉE par le client séparée de la date planifiée** (§4 : `reflowVehicle` replace l'accroché
dans sa flex ou abandonne la mutualisation ; nouvelle colonne `requested_date`, qui ancre la flex).
Précédent : **2026-07-31 (matin)** — **Q15 « chargement vendu intouchable » passe de PRÉFÉRENCE à
CONTRAINTE DURE** (§4 : prédicat unique `chgVenduTenu` appliqué à la mutualisation, au retour **et**
à `detectBoucles` ; une boucle qui déplacerait le chargement de l'ancre n'est plus proposée du tout).
Précédent : **2026-07-29 (soir)** — **diagnostic multi-camion** (« boucles écartées », §3 :
la réaffectation du dossier partenaire est désormais **proposée**, toujours validée par un humain —
révision de l'arbitrage « information seule » du matin même), **alerte nuits hors dépôt en semaine** (§4 : signal, pas
contrainte — à ne pas confondre avec Q17), point de départ affiché d'une route aligné sur le terrain,
**auto-placement d'ouverture** (§4 : la passe attend les données · consulter ne modifie plus rien).
Précédent : **2026-07-29** — score d'une boucle en **pourcentage du trajet évité** (l'échelle
en km absolus est supprimée), parcours réel attaché à la proposition (`_chaineSimulee`).
Précédent : **2026-07-28 (soir)** — garde week-end Q17 (le segment se clôt sur le jour
d'ARRIVÉE au dépôt), asymétrie ancre/accroché du chargement vendu, balayage de la fenêtre de flex de l'accroché en
mutualisation, `kmEco` mesuré sur les km réellement roulés. Précédent : **arbitrages du 2026-07-19**
(suite audit `OLD/2026-07-19-audit-moteurs.md` :
Q12 capacité/type au placement, Q13 approche jour J confirmée, Q14 faisabilité vs planning réel,
Q15 chargements verrouillés ; corrections B1–B6 et I1–I6 appliquées). Précédents : arbitrages du
2026-06-10 (`docs/OLD/audit-2026-06-10.md`).

---

## 1. Constantes (`RULES_DEFAULTS`)

| Clé | Valeur | Sens |
|---|---|---|
| `dayStart` / `dayEnd` | 7 / 18 | Amplitude ouvrée (11 h utiles/jour), Lun–Ven |
| `vitessePL` | 70 km/h | Vitesse poids lourd |
| `manutRatio` / `manutMin` | 10 m³/h / **2 h** | Manutention (chargement/livraison) — minimum **2 h** (arbitrage 2026-06-10, appliqué partout) |
| `seuilRoute` | 15 km | En deçà, pas de bloc route généré |
| `seuilProxRetourKm` | **300 km** | ⚠️ **NE FORME PLUS AUCUNE BOUCLE depuis le 2026-08-19.** Ne sert plus qu'au **RECHAÎNAGE PHYSIQUE** : entre deux chantiers d'un même camion, en deçà de cette liaison le PL enchaîne en direct, au-delà il rentre au dépôt (`detectBoucles`, cf. §4 « Nuit entre deux chantiers »). Ce n'est pas un garde-fou de boucle — il vaut décision ou pas, et ne dit pas si une boucle est bonne mais **où l'équipage dort**. Son sort est **à statuer** → **Q21** |
| ~~`seuilProxMutuKm`~~ | **supprimée** *(valait 80 km)* | **RETIRÉE le 2026-08-19.** Le détour de collecte entre les deux chargements n'est plus borné par un rayon : **G1 le borne par le territoire** (les deux chargements dans la même zone de chalandise, `checkMutuZones`), et **G2** par le budget de détour |
| `seuilResterSurPlaceKm` | **80 km** | **DEUX RÈGLES** *(la seconde depuis le 2026-08-19)*. ① **NUIT ENTRE 2 CHANTIERS** — distance au **prochain chargement** en deçà de laquelle le PL a le droit de dormir sur place au lieu de rentrer au dépôt (il est déjà à pied d'œuvre). Au-delà, il rentre. Garde-fou non paramétrable : si le dépôt est **plus près** que ce prochain chargement, il rentre quoi qu'il arrive. ② **NUIT À L'INTÉRIEUR D'UNE CHAÎNE** — distance au **dépôt** en deçà de laquelle le PL rentre y dormir plutôt que d'attendre sur place (km comptés, aucun bloc décalé). Ne concerne **jamais** un week-end (Q17 prime) |
| `minKmEco` | 50 km | km économisés minimum pour proposer une boucle |
| `zonesRetour` | **Ouest** (29 56 35 44 · 22 50 53 72 49 85) · **PACA** (13 83 84 30 · 04 05 06 34) | **G1, le garde-fou géographique des DEUX scénarios depuis le 2026-08-19.** RETOUR : la boucle relie **deux** zones, dans le bon sens (4 extrémités contrôlées). MUTUALISATION : les **deux chargements** dans **la même** zone, livraisons libres. **Liste vide = règle inactive**, et alors **plus aucun garde-fou géographique** nulle part. ⚠️ La clé garde son nom `zonesRetour` bien qu'elle serve les deux — elle est persistée, la renommer demanderait une migration. Voir §3 « F3bis » |
| `flexLivraisonJours` | 4 | Tolérance livraison « plus tard » en boucle. Borne aussi, **hors boucle**, l'avance autorisée par le **remède 1 bis** de la règle week-end (§ « Règle week-end ») — sans confirmation client depuis le 2026-08-01. `dateLivImposee` ramène la tolérance à 0 dans les deux cas |
| `ecartMaxH` | 5,5 h | Attente non-productive max entre 2 lots d'une boucle — **appliquée** par `findBoucleCandidates` depuis 2026-06-10 au **retour** (heures ouvrées entre fin liv ANC et début chg ACC, route de liaison déduite) et depuis le **2026-08-14 en mutualisation** (attente de **collecte**, entre les deux chargements). Valeur jamais mesurée (11 ÷ 2) — voir §3 « Filtres » |
| `scoreExcellentPct` / `scoreBonPct` / `scorePossiblePct` | 30 / 15 / 5 | Seuils du score qualitatif d'une proposition, en **% du trajet évité** (arbitrage Louis 2026-07-29 — voir §3 « Score d'une boucle »). Réglables dans l'onglet Admin. **Remplacent** `scoreExcellentKm`/`scoreBonKm`/`scorePossibleKm` (500/200/50 km), supprimés |
| `diagBouclePLMax` / `diagBoucleSimMax` | 4 / 24 | Plafonds de calcul du **diagnostic multi-camion** (§3) : camions alternatifs essayés par lot partenaire rejeté · simulations totales par recherche. `0` sur l'un ou l'autre = diagnostic désactivé |
| `reliquatMaxH` | 3 h | Reliquat de travail (route et retour dépôt **compris**) au-dessous duquel un dernier jour de mission est jugé « de trop » : la modale « ce chantier déborde d'une journée » propose alors de le résorber (§4). Calé sur la fin de journée réglable jusqu'à **21h**, soit +3 h — un reliquat de 3 h est exactement ce qu'un dépassement du soir peut absorber. `0` = désactivé |
| `deadlineVerrouillageJours` | 15 | Deadline des todos de confirmation/verrouillage |

**Capacité & type de véhicule au placement (arbitrage Q12, 2026-07-19)** : un lot ne peut être
placé que sur un véhicule **porteur** (`NON_PORTEUR_TYPES` = remorque, VL, caisse mobile exclus)
de **capacité ≥ volume** du lot. Appliqué à l'auto-placement, au placement local (`FlowLocal`),
à la finalisation (`FlowLocking`) et à `findAvailablePLs`. **Override manuel possible** dans
`FlowLocal` (véhicules incompatibles listés avec la raison, plaçables après confirmation
explicite). Capacité ou volume inconnus (données legacy) → pas de blocage capacité, type seul.

**Abaque manutention à la saisie (arbitrage 2026-07-21)** — `ABAQUE_MANUT` + `suggestManut()`
(`data/referentiels.js`) : à la saisie du **volume**, le formulaire *propose* automatiquement
l'**équipe** et la **durée** du chargement **et** de la livraison.

| Paramètre | Valeur | Sens |
|---|---|---|
| `m3ParHeureParEtp` | 10 m³/h **par ETP** | Cadence de manutention retenue pour la proposition |
| `etpBase` / `etpRenfort` | 2 / 3 ETP | 2 ETP par défaut, **3 au-delà de 50 m³** |
| `seuilRenfortM3` | 50 m³ | Seuil de bascule (50 inclus = 2 ETP) |

Durée proposée = `volume / (10 × ETP)`, **arrondie au palier `DUREE_OPTIONS` supérieur** (on ne
sous-estime jamais le temps sur site), plancher ¼J = 2 h (cohérent avec `manutMin`).
*Ex.* 42 m³ → 2 ETP, 2,1 h → **½J** ; 60 m³ → 3 ETP, 2 h → **¼J** ; 150 m³ → 3 ETP, 5 h → **¾J**.

> ✅ **Moteur aligné (2026-07-21)** : `manutRatio` s'entend désormais **par ETP** partout.
> Le repli du moteur — utilisé quand un lot n'a **aucune durée saisie** — passe par la même
> fonction `manutHeures(vol, fte, rules)` que le formulaire, avec l'équipe **réellement saisie
> sur le lot** (`fteC` au chargement, `fteL` à la livraison), à défaut celle de l'abaque.
> Avant, ce repli appliquait 10 m³/h **globalement** (`ceil(vol / 10)`, sans ETP, hors grille ¼J),
> ce qui produisait des durées incohérentes avec celles proposées à la saisie.
> Branché sur les 4 points de repli : `buildChain`, `buildMutuChain`, `joursMinLot` (×2).
> En pratique la durée étant **obligatoire** dans le formulaire, ce repli ne concerne que des
> lots legacy ou importés.

> La proposition est **toujours modifiable** : dès que le planificateur touche une durée ou un ETP,
> le champ est marqué manuel (`_manutManuel`) et l'abaque ne l'écrase plus, même si le volume change.

**Libellé d'affichage d'une agence** — `agLabel(ag)` (`utils/agencyLabel.js`) = `nom — ville`,
**dérivé des champs vivants** saisis dans l'écran Admin. L'ancien champ figé `longName` (fabriqué
une seule fois à l'import Excel) n'est plus ni écrit ni lu : un renommage en Admin se répercute
désormais partout (sélecteur d'agence en haut à droite, séparateurs d'agence du Gantt).

> ⚙️ Depuis 2026-06-10, ces règles sont **injectées dans les planificateurs** (`buildChain`/`buildMutuChain`
> via `opts.rules`) : un réglage admin (vitesse, seuil route, manutention) agit sur les **placements**,
> plus seulement sur les contrôles de boucle.

> ### 🔴 LES SEUILS DE PROXIMITÉ NE FORMENT PLUS DE BOUCLES (arbitrage Louis 2026-08-19)
>
> **C'est l'état en vigueur. Le § suivant, « Pourquoi DEUX seuils… », raconte l'étape précédente et
> reste là pour expliquer d'où l'on vient — il ne décrit plus le moteur.**
>
> Les deux seuils bornaient une **distance brute**, chacun de son côté, avant que le moindre
> garde-fou n'ait vu la géométrie complète. Ils sont retirés de la formation des boucles, pour deux
> raisons différentes.
>
> **RETOUR — il plafonnait le détour avant que G2 le mesure.** La liaison à vide est le **premier
> terme** du détour (`détour = liaison + trajet accroché + sortie − trajet remplacé`) : G2 n'a donc
> jamais pu juger un couple que ce seuil avait déjà écarté. La campagne « fil de l'eau vs big bang »
> (2026-08-18) le montre par la distribution elle-même — sur l'univers des couples formés, la
> liaison a une **médiane de 109 km et un maximum de 298** : la population était *plaquée contre la
> borne*. Or G2 juge mieux, parce qu'il pèse la liaison contre le **trajet remplacé** : une liaison
> de 350 km alignée sur la route du porteur ne coûte presque rien, une liaison de 100 km à
> contresens coûte cher. Un seuil sur la distance brute ne sait pas faire cette différence.
> Restent **G1** (zones) et **G2** (budget de détour), qui le doublaient déjà.
>
> **MUTUALISATION — il n'est plus seul, donc il n'a plus lieu d'être.** Les 80 km étaient l'unique
> garde-fou géographique, faute de zones applicables ; c'est cette solitude, et rien d'autre, qui
> les avait maintenus serrés le 2026-08-03 quand le retour passait à 300. **G1 couvre désormais la
> mutualisation** : `checkMutuZones` exige que les **deux chargements** se collectent dans **la même
> zone déclarée**. La clé `seuilProxMutuKm` est **supprimée**.
>
> ⚠️ **Écart de sévérité assumé.** Deux chargements d'une même zone peuvent être à **300 km** l'un
> de l'autre (l'Ouest va du Finistère à la Sarthe), là où 80 km s'imposaient. C'est le sens de
> l'arbitrage : la règle devient **topologique**, et ce qui reste kilométrique — le détour de
> collecte — est jugé par **G2**, sur la géométrie réelle, pas par un rayon fixé à l'avance.
>
> **Pourquoi seulement les CHARGEMENTS en mutualisation.** Une mutualisation est une *collecte
> commune* : c'est le détour de collecte que les 80 km bornaient, c'est donc lui que G1 borne.
> Contraindre aussi les **livraisons** écarterait le cas le plus rentable — deux dossiers chargés
> côte à côte pour deux destinations proches l'une de l'autre mais hors zone déclarée. Ce que les
> livraisons coûtent est mesuré ensuite par G2 puis G5, qui voient la géométrie complète.
> *(Le revers est suivi : **question ouverte Q3**, « faut-il un filtre explicite sur les
> destinations ? », ravivée par cet arbitrage.)*
>
> 🔴 **CE QUE PLUS RIEN NE FACTURE : le roulage à VIDE en tant que tel.** G2 mesure un détour
> **net**, G5 des km par jour ; ni l'un ni l'autre ne voit le vide. La seule mesure qui le voyait —
> M2 (G3) — a été retirée comme barrière le 2026-08-14 et ne sert plus qu'à l'affichage. C'est un
> choix assumé, pas un oubli : le rattrapage existe, codé et livré désactivé, c'est le garde-fou ⑦
> (`gardePlancherAbsurdite`, « jamais un détour supérieur au trajet qu'il remplace »).
>
> **CE QUI SURVIT DE `seuilProxRetourKm`, et c'est un tout autre métier.** La clé reste, parce
> qu'elle porte aussi le **rechaînage physique** : dans `detectBoucles`, elle décide si le PL
> enchaîne en direct entre deux chantiers ou rentre au dépôt. Ce n'est pas un garde-fou de boucle —
> il vaut **décision ou pas**, puisqu'il ne dit pas si une boucle est bonne mais **où l'équipage
> dort**. Il est conservé tel quel, et son sort est **à statuer** → **question ouverte Q21**, à
> trancher avec **Q20** qui porte sur le même conflit (80 km « à pied d'œuvre » contre 300 km de
> rechaînage).
>
> ### Pourquoi DEUX seuils de proximité et non un seul (arbitrage Louis 2026-08-03) — ⚫ HISTORIQUE
>
> ⚠️ **Étape intermédiaire, dépassée le 2026-08-19** (§ ci-dessus). Conservée parce qu'elle explique
> pourquoi les deux seuils ont divergé avant de disparaître — et parce que la mécanique de
> compatibilité ascendante qu'elle décrit (`normaliserSeuilsProx`) est **toujours en service** pour
> le seuil de rechaînage.
>
> Jusqu'au 2026-08-03, un réglage unique — `seuilProxKm` = 80 km — bornait les deux scénarios de
> boucle. Il a été **scindé en deux**, parce qu'il ne mesurait pas la même chose des deux côtés :
>
> | | **RETOUR** — `seuilProxRetourKm` = 300 km | **MUTUALISATION** — `seuilProxMutuKm` = 80 km |
> |---|---|---|
> | Distance mesurée | livraison de l'ancre → chargement de l'accroché | chargement de l'ancre → chargement de l'accroché |
> | Ce que fait le camion | il **repositionne à vide**, après avoir déchargé | il fait un **détour pour aller chercher un 2ᵉ chargement**, avant d'avoir chargé |
> | Autre garde-fou géographique | **oui** — la règle des zones de chalandise (`zonesRetour`) borne déjà les 4 extrémités | **aucun** — les zones ne s'appliquent **jamais** en mutualisation |
>
> **Côté retour, le seuil de 80 km faisait double emploi.** Il datait des specs de juin 26 et était
> alors le seul garde-fou ; les zones de chalandise sont arrivées **un mois après lui** et disent
> déjà *où* une boucle a le droit de se former. Sur les 72 dossiers réels de septembre 2026, le
> maintenir coûtait **3 boucles / 5 521 km évités** sans rien protéger
> (cf. `boucles/conclusions-analyse-retours-septembre.md`).
>
> **Côté mutualisation, il est le seul rempart** : le porter à 300 km ferait passer les propositions
> de **38 à 112**, avec un écart médian entre les deux chargements montant de 27 km à 113 km (max
> 281 km), et rien pour compenser. Il **ne bouge pas**.
>
> **Pourquoi 300 km et pas « aucun seuil ».** À l'analyse, 300 km et « sans seuil » donnent
> exactement le **même plan** — la règle de zone est ce qui tranche réellement. On garde malgré tout
> un plafond, parce que `zonesRetour: []` **désactive** la règle de zone : le jour où quelqu'un vide
> les zones (migration, base neuve, essai en admin), 300 km reste un filet de sécurité, là où
> l'absence de seuil ouvrirait la France entière.
>
> **Compatibilité ascendante.** Les règles sont persistées en base ; une base d'avant le 2026-08-03
> ne contient que `seuilProxKm`. Deux lecteurs uniques portent le repli — `seuilProxRetour(rules)` et
> `seuilProxMutu(rules)` dans `src/data/referentiels.js`, utilisés par le moteur, l'écran
> d'administration **et** les scripts d'analyse :
> `seuilProxRetourKm ?? seuilProxKm ?? 300` et `seuilProxMutuKm ?? seuilProxKm ?? 80`.
>
> ⚠️ **Un repli ne suffisait pas.** Le chargement fait `{ ...RULES_DEFAULTS, ...règles de la base }`
> — cet étalement seul **annulait** le repli : sur une base d'avant la scission, les deux nouvelles
> clés arrivaient des **défauts** (300 / 80) et le `?? seuilProxKm` n'était jamais atteint, donc le
> réglage de l'utilisateur était ignoré en silence. Une traduction, `normaliserSeuilsProx`, est donc
> appliquée **avant** la fusion : elle recopie l'ancienne clé sur les deux nouvelles, et ne fait
> rien dès que la base en connaît au moins une (base migrée, ou seuil réglé en admin).
>
> Conséquence assumée : sur une base existante, **le retour reste à l'ancienne valeur** tant que
> l'admin n'a pas explicitement élargi — l'élargissement est un choix à poser, pas un effet de bord
> d'une mise à jour. **Pour bénéficier des 300 km en production, il faut donc régler le seuil retour
> dans l'onglet Admin** (ou repartir d'une base neuve, dont le seed porte déjà les deux clés).
> (Question ouverte Q1 « 80 ou 120 km ? » : **close** de fait — la question ne se posait que tant
> qu'un seul seuil servait deux usages.)

**Flexibilité chargement** (recherche de boucle, saisie au form) : chips `0` (strict) / `5` (1 sem) /
`10` (2 sem) jours ouvrés — défaut **5**. (C'est la fenêtre `datesAround(dateC, flexC)` dans laquelle le
chargement de l'accroché peut glisser.)

---

## 2. Statuts des lots (valeurs canoniques)

- `placed_locked` — placé, dates figées.
- `placed_unlocked` — placé, dates flexibles (ne peut PAS être `locked`, sinon exclu du moteur).
- `pending_agency` — en attente d'acceptation de l'agence opératrice.
- `callback` — déclenché **uniquement** sur capacité zéro, jamais par le planificateur.

---

## 3. Boucles

### Vocabulaire — les deux lots d'une boucle (arbitrage Louis 2026-07-31)

Les lettres **A / B sont abandonnées**. Les deux dossiers d'une boucle portent un **rôle nommé**, le
même partout : doc, code, interface, et nos échanges.

| Rôle | Code | Ex-lettre | Ce que c'est | Ce qui peut bouger |
|---|---|---|---|---|
| **ANCRE** | `ANC` | ex-« B », ex-« porteur » | Le dossier **vendu, déjà posé**, dont la tournée existe : c'est lui qui fixe les dates et le camion (donc le dépôt de référence). | Sa date de **chargement est intouchable** (Q15). Seule sa **livraison** peut glisser dans sa flex. |
| **ACCROCHÉ** | `ACC` | ex-« A » | Le dossier qu'on **greffe** sur le voyage de l'ancre — en cours de vente, c'est le lot en cours de placement. | **Mobile dans sa fenêtre de flex** : c'est exactement ce que le commercial a négocié. |

**Pourquoi A/B a été abandonné** — trois défauts, tous constatés dans le code :
1. **L'ordre alphabétique contredisait la chronologie** : la séquence retour est `Dépôt ANC → Chg ANC
   → Liv ANC → Chg ACC → Liv ACC → Dépôt ANC`. La lettre A désignait le lot qui roule en **second**.
2. **Les lettres ne portaient pas le rôle**, alors que toute l'asymétrie du métier (vendu/intouchable
   vs en vente/mobile) tient là-dedans.
3. **`detectBoucles` utilisait A/B à l'ENVERS** de `findBoucleCandidates` : `lotA` y désignait le
   premier lot chronologique, c'est-à-dire l'**ancre**. Deux moteurs, deux conventions opposées,
   aucune alerte. C'est le vrai coût de la lettre — et la raison n°1 du renommage.

⚠️ **Trois « porteur » à ne jamais confondre.** Le mot est resté à deux endroits où il ne désigne
**pas** l'ancre :
- **véhicule porteur** — un **type de camion** (`NON_PORTEUR_TYPES` = remorque, VL, caisse mobile) ;
- **`_boucleRole: "porteur"`** — un rôle d'**agence** (« je suis propriétaire du dossier, une autre
  agence l'exécute », badge *↗ Sous-traité*). Ce marqueur est posé sur l'**ACCROCHÉ**, jamais sur
  l'ancre. Valeur **persistée** (`lots.extra` → `shred.py`) : pas renommable sans migration.
- Le **lot ancre** n'est plus jamais appelé « porteur » nulle part.

**Conventions de nommage dans le code** : `lotAnc`/`lotAcc`, `chgAnc`/`chgAcc`, `livAnc`/`livAcc`,
`chaineAncre`/`chaineAccroche`, `depotAncre`. Dans l'UI : pastilles **ACC** (verte) et **ANC**
(bleue), `COUL_ROLE.ACC`/`.ANC`, parcours affiché en « CHG ACC » / « LIV ANC ».

- **RETOUR** = agence de l'ancre ≠ agence de l'accroché (l'accroché, « retour », est confié au PL de
  l'ancre, déjà sorti).
- **MUTUALISATION** = **même agence _ou_ deux agences d'une même `region_code` non vide**
  (arbitrage Louis 2026-07-29), **et les deux chargements dans la MÊME ZONE DE CHALANDISE**
  (`checkMutuZones`, arbitrage Louis 2026-08-19 — remplace l'ancien seuil de 80 km entre chargements).
  ⚠️ **Deux conditions distinctes, toutes deux nécessaires** : la région dit *qui a le droit* de
  mutualiser, la zone dit *où*. Une région administrative n'est pas une zone de chalandise, et deux
  agences d'une même région peuvent très bien charger dans deux zones différentes.
  Il n'y a **pas de filtre dédié sur les destinations** : leur cohérence est assurée indirectement par le
  critère km économisés (`minKmEco`), puis par G2 et G5 — deux destinations divergentes ne dégagent
  pas d'économie et alourdissent le détour. *(Ce choix est délibéré mais désormais sans filet amont :
  **question ouverte Q3**.)*
  - **Acceptation IMPLICITE** entre agences d'une même région : la cible d'organisation est
    « 1 région = 1 planificateur », donc c'est la même personne qui monte la boucle des deux côtés.
    Aucun circuit de validation, **pas de `pending_agency`, pas de `_pendingBoucle`, pas de todo,
    pas de notification** — la pose est immédiate et verrouillée, comme une mutualisation interne.
  - **Une région vide ou nulle n'est JAMAIS « la même région ».** `agencies.region_code` est nullable
    depuis la migration 0005 et `agLookup` retombe sur `region: ""` pour une agence inconnue : sans
    garde, un `"" === ""` ouvrirait la mutualisation nationale. Helper unique :
    `memePerimetreMutu(socA, socB, agencesData)` dans `engine/chainBuilder.js`.
  - **`vendeuseSeulement` interdit la mutualisation inter-agences** (le dossier ne part pas sur le
    camion d'une autre agence) mais laisse la mutualisation interne possible.
  - Le lot accroché porte alors `_operatingAgency` = agence du **camion** ; il apparaît en « croisé »
    des deux côtés. Effacé à toute désolidarisation, comme les autres marqueurs de boucle.
- Le moteur (`findBoucleCandidates`) cherche parmi les lots déjà dans `placements`, **pas** dans `lots[]`.
- `findBoucleCandidates` = point d'entrée futur OR-Tools (signature fixe, remplaçable par appel HTTP).

### Retour et mutualisation sur un même couple (2026-07-29)
Tant que la mutualisation était réservée à une seule agence, les deux scénarios s'excluaient
(`soc ≠ soc` ⇒ retour, `soc === soc` ⇒ mutu). Depuis l'ouverture régionale, **un même couple de
dossiers peut relever des deux** : ils sont donc **évalués tous les deux** et peuvent donner
**deux propositions** concurrentes (dédupe par `partnerLot × type`).

Techniquement, `evaluerScenarios` a été **scindée en `evaluerRetour` / `evaluerMutu`**, deux closures
sœurs appelées l'une après l'autre avec chacune son slot de `bilan`. Avant, les deux corps
partageaient une closure truffée de `return;` secs : un rejet du retour (zones, week-end, PL occupé)
aurait **silencieusement annulé** l'évaluation de la mutualisation. La séparation rend l'indépendance
structurelle — un `return;` ne peut plus sortir que de son propre scénario.

> **Ordre des propositions (révisé 2026-07-30)** — clé **unique** : `kmEco` **décroissant**
> (`boucleEngine.js`, tri final). **La meilleure boucle est celle qui évite le plus de kilomètres,
> point.** Le décalage de la livraison du partenaire (`impactPartnerDates`) **n'entre plus dans le
> classement** : il ne sert plus que de départage à `kmEco` strictement égal.
> *Ce qui ne change pas* : l'impact est toujours affiché sur la carte de proposition
> (⚡ « Livraison décalée ») et garde tout son circuit de confirmation client (todo
> `impact_dates_client` / `mutu_impact_dates`) — c'est le planificateur qui arbitre, pas le tri.
> *Avant* : clé primaire `impactPartnerDates`, puis `kmEco` — une boucle sans impact passait devant
> une boucle nettement plus économique. Règle exposée dans **Admin → Règles métier**, encart
> « Gouvernance ».
> ⚠️ **Révisé de nouveau le 2026-08-14** : le tri n'est plus `kmEco` seul — un **score** intègre
> désormais la rallonge et le décalage (`score = km évités − 750 × rallonge − 400 × jours de
> retard − 200 × jours d'avance`, cf. `boucles/couplage-synthese.md`, annexe B). ⚠️ **Coefficient porté
> de 200 à 400 le 2026-08-18**, et **scindé retard/avance** (l'avance coûte moitié moins) — sur
> mesure de septembre 2026, cf. `boucles/campagnes/mesure-mu-plancher-A5-2026-08-18.md` et
> `boucles/boucles-etat-a-date.md` § 3. Ce qui reste vrai : le circuit de confirmation client sur
> l'impact des dates n'a pas changé, lui.

### Gouvernance RETOUR
- Séquence unique **ancre-d'abord** : `Dépôt ANC → ChgB → LivB → ChgA → LivA → Dépôt ANC`.
- L'agence vendeuse de l'accroché ne s'approprie jamais le voyage déjà calé de l'ancre.

### « Proposé = posé »
- La proposition calcule ses dates avec les **vrais planificateurs** (`buildChain` pour le retour,
  `buildMutuChain` pour la mutu), pas avec un estimateur séparé. La date annoncée dans la carte de
  suggestion est **exactement** celle qui sera posée sur le Gantt (pas de divergence d'un jour).
- **Étendu au PARCOURS (2026-07-29)** : le candidat porte désormais `_chaineSimulee`, les blocs de sa
  propre simulation. Le panneau affiche donc l'itinéraire réel du camion — dépôt compris, trajets à
  vide compris — au lieu de re-déduire des distances à vol d'oiseau depuis les codes postaux. En
  retour, la chaîne est `chaîne ANC (sans son retour dépôt) + chaîne ACC` : l'ancre ne rentre pas, elle
  enchaîne sur le chargement de l'accroché — **même périmètre que le calcul des km évités**, pour que
  le trajet montré et le gain annoncé parlent des mêmes kilomètres.

### Score d'une boucle — en pourcentage (arbitrage Louis 2026-07-29)
- `pctGain = kmEco / (trajet accroché seul + trajet ancre seule)`, arrondi à l'entier. Les trois termes viennent
  de la **même source** : réels si les chaînes sont calculables, géométriques en repli — jamais un
  mélange des deux (un `kmEco` réel divisé par un total géométrique produisait des pourcentages
  aberrants, au-delà de 100 %).
- Seuils `scoreExcellentPct` / `scoreBonPct` / `scorePossiblePct` (§1), **strictement décroissants**.
  En dessous du dernier : `neutre`.
- **Pourquoi la proportion et non les kilomètres** : 200 km évités ne racontent pas la même chose sur
  un aller-retour de 500 km que sur un de 3 000. L'ancienne échelle en km absolus classait « neutre »
  une boucle locale supprimant 40 % du trajet, et « bon » une longue distance n'en économisant que 5 %.
- **Une seule échelle** dans tout l'outil : l'échelle en km est supprimée, pas doublée. Le nombre de
  km évités reste affiché à côté du pourcentage, mais ne décide plus de la couleur.

### Diagnostic multi-camion — « boucles écartées » (arbitrage Louis 2026-07-29)

Le moteur n'évalue une boucle que sur **un seul camion** : celui où le lot partenaire est **déjà
posé**. C'est voulu — l'agence vendeuse ne s'approprie pas le voyage déjà calé de l'ancre (cf. « Gouvernance
RETOUR »). Mais quand ce camion-là est **la seule cause du rejet** (capacité trop juste, PL occupé),
la boucle disparaissait **sans laisser de trace** : ni le planificateur ni le diag ne pouvaient savoir
qu'elle aurait été possible ailleurs.

- **Ce qui a été retenu : PROPOSER la réaffectation du dossier partenaire, jamais l'appliquer seul.**
  ⚠️ Révision, le 2026-07-29, d'un arbitrage pris le matin même (« signaler, sans jamais
  réaffecter ») : le diagnostic seul obligeait le planificateur à **ressaisir les deux dossiers à la
  main** pour récupérer la boucle.
- **Comment** : après un rejet du scénario sur le camion de l'ancre, une **seconde passe en lecture seule**
  rejoue la même simulation sur les autres camions compatibles du dépôt (`findAvailablePLs`). Si l'une
  aboutit **et** que le camion d'accueil est libre sur **toute la mission** (`isPLAvailableInRange` —
  `findAvailablePLs` ne teste que la date de chargement, insuffisant pour engager un mouvement), elle
  produit un objet `_bloque` portant :
  - `reaffectation` — le mouvement à opérer : quel dossier, de quel camion vers quel camion ;
  - `candidat` — la boucle prête à proposer, dont le `partnerPlId` est **le camion d'accueil**.
- **Ce qui reste intouché** : `results` ne reçoit **jamais** de candidat supplémentaire. Une boucle
  qui n'exige de déplacer personne l'emporte donc toujours sur une boucle qui bouscule un dossier
  déjà affecté — les secondes restent hors de la liste des propositions.
- **Où ça s'affiche** : section « ⚑ N boucles écartées — récupérable en changeant de camion » sous les
  propositions, **dépliée par défaut dès qu'un cas est actionnable** (arbitrage Louis 2026-08-03 :
  repliée, elle n'était jamais vue, donc le bouton n'existait que pour qui pensait à cliquer ; un
  repli explicite de l'utilisateur, lui, est respecté). Le mouvement est annoncé en clair avant
  d'être proposé (*« CHT-041285 changerait de camion : PL-007 → PL-014 — dates du dossier
  inchangées »*), avec un bouton « ↩⇄ Proposer la boucle avec réaffectation ».
- **Le cas « aucun camion possible »** (arbitrage Louis 2026-08-03) : quand *aucun* alternatif ne
  convient — liste vide, capacité insuffisante, ou tous occupés sur la période — la boucle écartée
  était jusqu'ici **purement et simplement perdue**, l'émission se faisant à l'intérieur de la boucle
  sur les camions candidats. Le seul cas totalement invisible était donc précisément celui que le
  planificateur appelle « écarté faute de camion ». Il est désormais émis avec le champ `sansCamion`
  (la raison en clair) et **sans** `plAlternatif`, `kmEcoPotentiel`, `reaffectation` ni `candidat` :
  il n'y a pas de solution à décrire, donc pas de bouton.
  ⚠️ **Sauf budget de simulation épuisé** : dans ce cas on n'a pas fini de chercher, affirmer
  « aucun camion » serait faux — rien n'est émis.

  **🔴 GABARIT ou DISPONIBILITÉ — deux causes à ne jamais confondre** (2026-08-03, soir).
  `findAvailablePLs` applique « assez grand » **et** « libre ce jour-là » en un seul passage : sur
  liste vide, on ne savait plus lequel des deux filtres avait mordu, et le message partait du plus
  optimiste (« n'est **libre** »). Il laissait donc croire à un problème de **date** — comme si un
  autre jour passerait — alors que le camion **n'existe pas**. Sur septembre 2026, les **41** cas
  étaient tous du second type. Le diagnostic distingue désormais, via `sansCamionCause` :
  - **`"gabarit"`** — *« aucun camion de l'agence ne peut charger 122 m³ — le plus grand fait
    100 m³ »*. Contrainte de **FLOTTE**, rien à retenter : c'est un signal de **dimensionnement**,
    et le seul moyen de chiffrer ce que coûte le plafond de capacité (31 couples sur septembre) ;
  - **`"occupe"`** — *« les 3 camions assez grands de l'agence sont déjà pris le 10/09 »*, ou
    *« … occupés sur la période de la mission »*. Changer de date peut débloquer.

  **Le gabarit est relu à part, et ne décide de rien** : `alternatifs` reste issu de
  `findAvailablePLs`, seule source de vérité sur qui peut porter la boucle. La relecture ne sert
  qu'à **écrire la phrase**.
  ⚠️ La plus grande caisse annoncée se calcule sur les **PORTEURS seulement**
  (`isVehicleCompatible(v, 0)` — un volume nul court-circuite le test de capacité et ne laisse que
  le test de type) : annoncer une remorque de 200 m³ enverrait le planificateur chercher un camion
  incapable de prendre la mission. Même prédicat que le filtre de gabarit, donc aucune liste de
  types recopiée qui pourrait dériver.
  Compteurs `boucle_bloquees_hors_gabarit` et `boucle_bloquees_sans_camion` (onglet Monitoring,
  deux lignes distinctes).
  ⚠️ **Ne pas lire la cause dans le texte** : `sansCamionCause` existe précisément pour que
  l'interface et le Monitoring n'aient pas à analyser la phrase — un simple reformulage casserait
  ce couplage.
- **Qui valide — jamais l'outil** :
  - **retour** : l'**agence opératrice** (celle dont la flotte bouge) reçoit une notification dédiée
    `boucle_retour_recue_reaffectation` et accepte ou refuse ;
  - **mutualisation** : pas de notification (acceptation implicite de l'agence voisine), mais une
    **confirmation explicite** avant toute écriture — un dossier affecté ne change pas de camion en
    silence.
- **Quand le mouvement a lieu** : à l'**acceptation** seulement. Tant que la réponse n'est pas venue,
  la flotte n'a pas bougé d'un bloc — un refus n'a donc rien à défaire. À l'acceptation, les deux
  mouvements (retrait du camion d'origine, pose des deux dossiers sur le camion d'accueil) sont
  écrits **en une seule fois** : un état intermédiaire serait un planning faux, qui partirait tel quel
  sur le réseau si la sauvegarde tombait entre les deux.
- **Ce qui ne change jamais** : les **dates du dossier déplacé** (Q15 — c'est le ancre, un dossier
  vendu). Seul le camion qui le porte change.
- **Coût borné** : la passe ne tourne que sur les scénarios **rejetés**, sous les plafonds
  `diagBouclePLMax` / `diagBoucleSimMax` (§1). Mettre l'un des deux à `0` la désactive.

### Filtres
- **F3 fenêtre** (arbitrage 2026-06-10) : fenêtre **métier**, indépendante de la semaine affichée à
  l'écran — l'ancre est candidat si sa plage `[dateC..dateL]` chevauche
  `[dateC_A − flexC − 3 j ouvrés ; dateL_A + flexL + 3 j ouvrés]`. Résultat déterministe et
  reproductible (requis pour le futur backend/OR-Tools).
- **F3bis zones de chalandise — G1, LES DEUX SCÉNARIOS** (arbitrage Louis 2026-07-28, **étendu à la
  mutualisation le 2026-08-19**). Un seul référentiel de zones, deux contrôles, tous deux dans
  `utils/zones.js` :
  - **RETOUR** (`checkRetourPiliers`, **règle des piliers D7 depuis le 2026-09-15**) — **au moins un
    pilier** doit tenir ; voir le détail juste en dessous.
  - **MUTUALISATION** (`checkMutuZones`) — les **deux chargements** doivent tomber dans **la même**
    zone déclarée ; les **livraisons restent libres**. Ce contrôle **remplace** l'ancien
    `seuilProxMutuKm` (80 km entre chargements), supprimé. ⚠️ Il est **beaucoup plus large** : deux
    chargements d'une même zone peuvent être à 300 km l'un de l'autre. C'est voulu — la règle est
    topologique, et le kilométrage est jugé par G2. Pourquoi seulement les chargements : cf. §1,
    « Les seuils de proximité ne forment plus de boucles », et **question ouverte Q3**.

  Le détail du contrôle RETOUR — **la règle des piliers (D7)**, codée le 2026-09-15 *(doctrine :
  `boucles/boucles-etat-a-date.md` § 2.2)*. Au moins un des deux piliers :
  - **maison** — `chg ancre` **et** `liv accroché` dans la zone du **dépôt du camion** : le camion part
    de chez lui et rentre chargé *(D6 : le vrai pilier est le dépôt, pas le chargement de l'ancre)* ;
  - **au loin** — `liv ancre` **et** `chg accroché` dans une **même autre** zone : le camion recharge
    là où il vient de décharger.
  Le pilier dit **où** on a le droit d'opérer ; le détour (G2) dit **si** c'est sur la route. Sur une
  ancre qui est une paire, ce sont les points de **l'ancre de la paire** (P8). La proposition porte
  le pilier retenu (`territoire: { pilier, zoneDepot, zoneLoin }`) : l'écran l'affiche sans recalculer.
  ⚠️ **Conséquences à connaître** : un retour dont **les deux piliers** tiennent correspond à l'ancienne
  règle *(« 4 points » : `chg ancre ∈ Z1 · liv ancre ∈ Z2 · chg accroché ∈ Z2 · liv accroché ∈ Z1`,
  toujours exportée sous le nom `checkRetourZones`, mais qui **ne refuse plus rien**)* ; un seul pilier
  suffit désormais — une livraison **hors zone** de l'accroché passe si le camion a rechargé là où il
  avait livré, et une boucle **entière dans la zone du dépôt** passe par le pilier maison. Mesuré sur
  le vivier du 2026-09-14 : big bang **24 390 → 34 980 km**, fil de l'eau **13 701 → 17 471 km**. Une zone = liste de **départements** (`coeur` + `peripherie`, comptés
  à l'identique par le moteur ; la distinction servira à définir les départements traités en vente).
  Paramètre `zonesRetour` — **liste vide ⇒ règle inactive**. Implémentation : `utils/zones.js`.
  ⚠️ **Le contrôle de croisement ci-dessus ne vaut QUE pour le retour** : une mutualisation n'est
  pas un croisement, c'est une collecte commune — d'où un contrôle distinct (`checkMutuZones`,
  ci-dessus). Jusqu'au 2026-08-19, la mutualisation n'était **pas** contrôlée du tout par les zones,
  et sa géographie ne tenait qu'aux 80 km de `seuilProxMutuKm` ; ce seuil supprimé, elle serait
  restée sans aucun garde-fou géographique — d'où l'extension.
  Appliqué **avant F4** (filtre le plus
  discriminant, aucune géométrie) et **aussi dans `detectBoucles`** pour que le badge ★ du Gantt et le
  KPI « km économisés » ne récompensent pas une boucle que le moteur aurait refusé de proposer.
  *Cas fondateur CHT-158193 / CHT-003327* : ancre Rennes (35) → Marseille (13), accroché Sanary (83)
  → **Paris (75)**. La liaison Marseille↔Sanary ne fait que 37 km, F4 laissait donc passer : aucun
  seuil ne regardait la livraison de l'accroché. 🔵 **Depuis la règle des piliers (2026-09-15), ce cas
  passe le territoire** (pilier au loin) : Paris est sur la route du retour vers Guer, et c'est G2 qui
  en juge. Un rayon autour du dépôt ne pouvait pas régler ça —
  depuis Guer (56), Marseille (destination légitime) est à 784 km et Paris (à refuser) à 348 km.
- ~~**F4 proximité**~~ — 🔴 **SUPPRIMÉE le 2026-08-19**, dans les deux scénarios. Les deux distances
  (liaison à vide `chgAcc↔livAnc` au retour, détour de collecte `chgAcc↔chgAnc` en mutualisation)
  sont **toujours mesurées, tracées et affichées** (`distRepo` sur la proposition, journal moteur),
  mais elles ne refusent plus rien : au retour parce que la liaison plafonnait le détour **avant**
  que G2 le mesure, en mutualisation parce que G1 a pris la place. Détail et chiffres : §1.
- **F5 capacité** : retour → volume ACC ≤ capacité PL ; mutu → volume ACC + volume ANC ≤ capacité PL (égalité OK).
- **Écart dates** : 0–3 jours ouvrés entre les opérations.
- **Attente non-productive** ≤ `ecartMaxH` (5,5 h ouvrées) — **les deux géométries depuis le 2026-08-14** :
  - *retour* : entre fin liv ANC et début chg ACC, liaison déduite ;
  - *mutualisation* : l'**attente de collecte**, entre la fin du chargement du 1ᵉʳ dossier et le début
    de celui du 2ᵉ (`attenteMaxCollecte`, `chainBuilder.js`, lue par `evalMutuSeq`).

  > ### Pourquoi la mutualisation ne mesure que la COLLECTE (2026-08-14)
  >
  > La mutualisation n'avait **aucun** contrôle de temps, ni géométrique ni calendaire — alors que sa
  > géométrie en fabrique par construction : chaque chargement est ancré à **sa** date vendue, donc
  > deux chargements à deux dates laissent le camion **chargé, à l'arrêt**, entre les deux.
  >
  > La fenêtre est le point délicat. Mesurer *toute la tournée* (1ᵉʳ chargement → dernière livraison)
  > donne des chiffres énormes — **51 h sur un cas d'essai** — mais ces heures-là viennent presque
  > toutes d'une **date de livraison tardive voulue par le client** : le camion attend parce qu'on
  > livre le mardi suivant, pas parce qu'on a mutualisé. Une barrière posée là refuserait des paires
  > saines pour un temps mort qui existerait de toute façon (et que le signal `_inactivite` couvre
  > déjà). La règle du retour ne fait pas cette erreur : elle borne la **jonction entre les deux
  > dossiers**, jamais l'intérieur d'une mission. La collecte en est la transposition exacte.
  >
  > **Même seuil qu'au retour**, volontairement : c'est la même règle métier, et **aucune des deux
  > valeurs n'a jamais été mesurée** (5,5 h = 11 ÷ 2, un chiffre rond). Le balayage en **fil de l'eau**
  > reste à faire — le big bang ne peut pas le porter, la règle exigeant une tournée posée.
  >
  > **Un rejet n'est pas définitif** : le balayage de la flex de l'accroché et l'autre séquence
  > (S1/S2) sont réessayés — l'équivalent de la passe 2 du retour.
  >
  > L'**exemption « chargement du vendredi »** (charger le vendredi pour partir le lundi, arbitrage
  > 2026-08-03) est **partagée** avec le signal `_inactivite`, écriture unique
  > `estChargementDuVendredi`. Au passage, la liaison de **collecte** entre deux chargements ne
  > compte plus comme un départ de route chargée — le texte de la règle le disait déjà, le code ne
  > le faisait pas (elle est typée `trs` comme les autres ; on la reconnaît désormais à sa
  > destination `_to.etape`).
- **km économisés** ≥ `minKmEco`.
- **Faisabilité PL (arbitrage Q14, 2026-07-19)** : le PL de l'ancre doit être **libre de tout autre lot**
  (et bloc manuel) sur toute la période de la mission combinée (du 1ᵉʳ chargement à la dernière
  livraison, retour et mutu). Sinon la proposition serait infaisable — le reflow sérialiserait et
  décalerait des dates en silence. Contrôle : `plBusyInRange` dans `findBoucleCandidates`.
- **Retour base avant week-end à l'heure près** (2026-07-19, I5) : les contrôles « le PL peut-il
  rentrer à sa base avant le week-end » utilisent la **fin réelle** des opérations simulées
  (`checkRetourBaseAbs`), plus un décompte à la journée (qui rejetait tout retour depuis une
  opération du vendredi).
- **CP reconnu** : un lot dont un CP est inconnu du référentiel (position approximée au centre de la
  France) est **exclu des propositions automatiques** et porte un badge « ⚠ CP non reconnu » sur sa
  carte. Il reste planifiable manuellement (arbitrage 2026-06-10 : signal, pas blocage).

### Ajustement des dates (RETOUR) — compaction de la tournée (arbitrage Louis 2026-07-24)

> **Ordre de mobilité** (du plus mobile au figé) : **LIV ACC** (le levier — livrer A au plus tôt
> libère le PL) › **LIV ANC = CHG ACC** (suivent le couplage : l'accroché charge dès que l'ancre a livré, ils bougent
> souvent ensemble) › **CHG ANC** (chargement de l'ancre — **ne bouge jamais**, verrouillé à la vente, Q15).

- **Passe 1** : l'ancre **garde sa date de livraison demandée** ; l'accroché vient s'accrocher derrière.
- **Passe 2** (interdite si l'ancre **verrouillé** → sa livraison reste figée) : l'ancre est **avancé au plus
  tôt dans sa fenêtre** (`impactPartnerDates: true` → todo de confirmation côté ancre). Jouée dans
  **deux** cas :
  - **fallback** — la passe 1 ne permet pas d'accrocher l'accroché (chgAcc hors flex, attente > `ecartMaxH`,
    week-end) ;
  - **compaction** *(nouveau 2026-07-24)* — même quand la passe 1 réussit, on **préfère** la passe 2
    dès qu'elle **serre la tournée**, càd rapproche une opération de sa date au plus tôt. **Trois
    leviers, un seul suffit** :
    - **CHG ACC plus tôt** — charger A au plus tôt est un objectif en soi ;
    - **LIV ACC plus tôt** — livrer A plus tôt libère le PL plus tôt (tampon week-end) ;
    - **LIV ANC plus tôt** — supprime une **plage d'improductivité** : l'ancre est arrivé mais patientait
      *chargé* pour livrer à sa date « demandée » plus tardive (ex. arrive mardi, livrait mercredi).
    La passe 2 étant « au plus tôt » partout, elle ne rend **jamais** une date plus tardive :
    compacter ne fait que **rapprocher** (client ravi), jamais reculer. Ancre verrouillée ⇒ pas de
    compaction. CHG ANC (chargement de l'aller) ne bouge jamais.

### Dates de chargement = verrouillées (arbitrage Q15, 2026-07-19 — **durci le 2026-07-31**)

> 🔴 **CONTRAINTE DURE, au même rang que Q17.** Aucune boucle — mutualisation, retour, ou boucle
> reformée sur le Gantt — ne peut déplacer la date de chargement d'un dossier **vendu** (l'ancre
> l'ancre). Quand tenir cette date est incompatible avec la garde week-end, **la boucle n'existe pas** :
> pas de proposition, pas d'avertissement, pas de version « dégradée ». Deux règles absolues qui se
> contredisent ne s'arbitrent pas au cas par cas — elles suppriment la solution.

**Ce qui a changé le 2026-07-31 (diagnostic CHT-463530 / CHT-400887).** La règle était énoncée
partout mais **appliquée nulle part de façon ferme** :

| Chemin | Avant | Après |
|---|---|---|
| Mutualisation (`evalMutuSeq`) | simple **critère de tri** (`chgBTenu`) : si aucune séquence ne tenait la date, la boucle passait quand même — **en annonçant `partnerNewDateC = null`**, donc en affirmant que la date de l'ancre était intacte pendant qu'elle la déplaçait | la séquence est **rejetée** ; plus aucun candidat ⇒ aucune proposition |
| Retour (`trySim`) | **aucun contrôle** — le bloc `chg` de l'ancre était calculé pour ses heures, sa **date jamais relue** | **rejet définitif** (la passe 2 n'assouplit que la *livraison* de l'ancre, jamais son chargement) |
| `detectBoucles` | **aucun contrôle** — on faisait confiance à l'option `waitDateC` | la boucle **ne se forme pas**, les blocs posés restent intacts |
| **`reflowVehicle` (la POSE)** — *ajouté le 2026-07-31, même jour* | **aucun contrôle** : rejouait une paire déjà acceptée en l'ancrant sur la `dateC` **persistée** de l'accroché | l'accroché est **replacé dans sa flex** pour tenir la date de l'ancre ; à défaut, mutualisation **abandonnée**, repose séparée et **signalée** (2026-08-01) |

**Le 4ᵉ chemin — la pose (2026-07-31, second diagnostic du même jour).** Une fois les trois premiers
corrigés, le cas fondateur **s'est reproduit à l'identique** (CHT-547538 recréé, accroché au même
CHT-400887) : proposition saine, pose fautive. Les trois gardes ne protègent que la **proposition** ;
`reflowVehicle` repose une paire **déjà acceptée** et n'y repassait jamais. Or la date retenue par la
proposition (l'accroché chargé dans sa flex, ici le lundi) **n'est pas persistée** — le lot garde sa
date convenue (vendredi). La paire repartait donc du vendredi, la garde week-end (Q17) décalait toute
la tournée au lundi, et le chargement vendu de l'ancre partait avec elle. **Sans aucune alerte** :
la proposition, elle, n'avait rien décalé (`partnerNewDateC: null`), donc rien ne signalait l'écart au
planificateur. C'est exactement là que l'invariant « proposé = posé » se rompait.

Remède, dans cet ordre :
1. **Replacement de l'accroché** — `reflowVehicle` rejoue la date de chargement de l'accroché dans sa fenêtre
   de flex (même balayage et même ordre de préférence qu'`evalMutuSeq`) et retient la première qui
   tient la date vendue de l'ancre ; la date actuelle reste essayée **en premier** (le groupage déjà
   accepté est préféré). Flex nulle ⇒ aucune alternative à essayer.
   *(La clause « accroché verrouillé ⇒ aucune alternative » qui figurait ici a été **corrigée le
   2026-08-01** : elle portait sur la mauvaise date — cf. § « Ancrage ≠ atterrissage » ci-dessous.)*
2. **Filet** — si aucune date ne convient, la mutualisation **n'existe pas** : les deux lots sont
   reposés **séparément**, chacun en mission autonome depuis le dépôt. L'ordre de passage n'est pas
   neutre (le premier lot mobilise le camion) : les deux ordres sont essayés et **celui qui tient la
   date de l'ancre est retenu**, sinon l'ordre chronologique (§4 : l'ancre ne bouge qu'en dernier recours). Le
   décalage qui subsiste porte alors sur l'accroché et reste **signalé** par l'alerte « chargement décalé ».

**La cause en amont : la date retenue n'était pas conservée (corrigé le 2026-07-31).** Le remède
ci-dessus rend la pose robuste, mais il compensait une perte d'information plus haut. Quand une
boucle est acceptée, la proposition a **choisi** une date de chargement pour l'accroché (celle qui
roule le moins tout en tenant la date vendue de l'ancre). Cette date n'était écrite que sur le
chemin **« lot nouveau »** (`buildLotFromForm`). Un lot **existant** recalé sur une boucle gardait sa
date demandée — sur les **deux** types de boucle :

| Chemin | Lot nouveau | Lot existant (avant) |
|---|---|---|
| Mutualisation acceptée (`handleSuggestionPlace`) | date retenue écrite ✅ | date demandée conservée ❌ |
| Retour accepté par l'agence partenaire (`handleTodoAction`) | date retenue écrite ✅ | date demandée conservée ❌ |

Le lot partait donc en base avec une date que la boucle n'avait **jamais** retenue, et chaque repose
réancrait la tournée dessus. Point unique d'application désormais :
**`datesBoucleRetenues(chosen, base)`** (`utils/datesBoucle.js`), appelé par les trois chemins.

#### Ancrage ≠ atterrissage (2026-08-01, diagnostic CHT-968158 / CHT-435739)

> 🔑 **Deux dates que le moteur confondait.** L'**ancrage** est le point de départ donné à
> `buildMutuChain` — une variable de recherche interne, **promise à personne**. L'**atterrissage**
> est le jour où le camion charge vraiment : c'est lui qui est annoncé au client, affiché sur la
> fiche et contrôlé par Q15. Les deux diffèrent couramment : ancrer sur **mardi 15/09** fait
> atterrir le chargement de l'accroché sur **vendredi 18/09**, juste après celui de l'ancre.

`evalMutuSeq` renvoie l'**atterrissage** (`chgAcc.date`), que `datesBoucleRetenues` persiste — et
c'est correct. Mais `reflowVehicle` le réinjectait comme **ancrage**, ce qui reconstruit une chaîne
**différente** : ancrée sur le vendredi, la garde week-end (Q17) décalait toute la tournée au lundi
et emportait le chargement vendu de l'ancre → Q15 rejetait → mutualisation abandonnée. Le 18/09 était
la **seule** date de la fenêtre de flex à casser la chaîne, et c'était précisément celle qu'on
réinjectait.

Conséquences, et la règle qui en découle :

- Le balayage des dates d'ancrage est mené **quel que soit le verrou de l'accroché**. Ce qui est
  confirmé au client, c'est l'**atterrissage** ; l'ancrage ne l'est pas. Quand l'accroché est
  **verrouillé**, seules sont retenues les chaînes qui reposent son chargement sur sa date
  **exacte** (même prédicat unique `chgVenduTenu`, appliqué cette fois à l'accroché). **Aucune date
  client ne bouge.**
- Refuser de balayer ne protégeait **rien** : le verrou bloquait un ajustement de 3 jours *dans* la
  flex négociée, puis le filet décalait le même dossier de **7 jours** *hors* de cette flex.
- **L'invariant « proposé = posé » tient par le bout de la POSE, pas par un filtre en amont.**
  Question posée en séance : « ne pas proposer ce qui ne peut pas être posé ? ». La boucle était
  **parfaitement posable** — la rejeter à la proposition aurait jeté 1236 km de gain réel à cause
  d'un défaut de relecture. La pose balaye la même fenêtre que la proposition, avec le même helper
  (`dateChgSouhaitee`) et le même tri : l'ancrage gagnant de la proposition est donc **toujours**
  dans l'ensemble exploré par la pose. Un test parcourt la séquence complète
  proposition → persistance → verrouillage → pose.
- **La recherche lit l'ancre telle qu'elle est POSÉE** (2026-09-16, arbitrage Louis, diag CHT-933597).
  La recherche prend le Gantt tel qu'il est posé. La simulation ne sert qu'aux hypothèses. Quand l'ancre
  garde sa date de livraison, sa tournée est relue sur les blocs posés. Elle n'est recalculée que si la
  pose est incomplète ou ne tient pas ses chargements vendus. Quand il faut simuler une paire, c'est avec
  **la même règle que la pose** : mêmes dates d'ancrage essayées (`datesAncragePaire`) et même critère de
  retenue (`paireTenueALaPose`). Enfin, avant d'émettre un retour ou une mutualisation, le moteur **rejoue
  la pose** qui suivrait l'acceptation. La proposition est rejetée (`boucle_rejets_pose_divergente`) si
  l'accroché n'y atterrit pas aux dates annoncées, si un chargement vendu bouge ou si la paire mutualisée
  n'est pas tenue. Ainsi, « proposé = posé » est garanti par construction, et non plus seulement par la
  pose.

#### Approche au plus tard (2026-08-01, CHT-050731)

L'approche initiale d'une mutualisation est **reculée pour se terminer juste avant** le 1ᵉʳ
chargement, au lieu d'être posée au démarrage de la chaîne. Sans cela, tout écart entre le début de
la chaîne et la date du 1ᵉʳ chargement devenait du **temps mort** : sur le cas fondateur, le camion
montait chez le client le mardi et y restait garé jusqu'au vendredi (2 journées, 3 nuits dehors à
vide — donc invisibles du signal « camion chargé immobile », qui ne regarde qu'un camion **chargé**).

⚠️ **Ne pas confondre avec un gaspillage** : le départ anticipé lui-même est **nécessaire**. Le
vendredi de ce cas fait 11 h pile (2 chargements + liaison + retour dépôt) ; y ajouter l'heure
d'approche ferait rentrer le camion à 19h, donc dehors le week-end — Q17 violée, et toute la tournée
basculerait au lundi en emportant le chargement vendu de l'ancre. **Sortir cette heure du vendredi
est ce qui rend la boucle possible.** Seul le MOMENT du départ était mal choisi.

Implémentation : `reculerHeuresOuvrees` (`engine/chainBuilder.js`), symétrique de
`snapToWorkingHours` — nuits et week-ends ne consomment rien. La règle vendredi s'applique **après**
le recul, de sorte que reculer ne peut jamais faire partir un camion le vendredi pour une opération
du lundi.

#### Piège de champ : `flexC` (formulaire) vs `_flexC` (lot enregistré) — 2026-08-01

> ⚠️ **La flexibilité de chargement porte DEUX noms selon l'objet.** Un lot du state — donc tout ce
> que reçoit `reflowVehicle` — porte **`_flexC`**. Un objet **formulaire** (`buildLotFromForm`,
> `formDraft`), qui alimente `findBoucleCandidates`, porte **`flexC`** : les appelants traduisent à
> la main. La reconstitution côté API **retire** `flexC` du lot (`extra.__omit__`).

Conséquence, découverte sur **CHT-528539** : `reflowVehicle` lisant `lot.flexC` obtenait toujours
`0`, et le balayage de la fenêtre de flex était **du code mort en production** — alors qu'il passait
tous ses tests, dont les fixtures écrivaient `flexC`. Lecture unique désormais :
**`flexChgJours(lot)`** (`utils/datesBoucle.js`), qui accepte les deux formes.

**Règle de test qui en découle** : une fixture de lot **posé** doit avoir la forme du **state**
(`_flexC`), jamais celle du formulaire — sinon elle valide une situation qui n'existe pas.

#### Mutualisation non tenue à la pose : on signale (2026-08-01)

Quand le filet ci-dessus se déclenche, la boucle reste **`accepted`** en base — le moteur ne défait
pas une décision de planificateur dans son dos — mais les deux dossiers roulent séparément. La fiche
affichait donc « ⇌ Mutualisation, −X km » au-dessus d'un Gantt posant deux allers-retours complets.

**On signale, on ne modélise pas** (même Option A que les alertes hors dépôt) :

- prédicat unique **`mutuTenueALaPose(blocks, lotId, partnerId)`** (`engine/boucleEngine.js`), qui
  se prononce sur les **blocs réellement posés** — une paire mutualisée a ses missions
  **imbriquées** (chacun chargé avant que l'autre ne soit livré). Aucun champ nouveau à persister :
  la mutualisation est un **fait observable** du planning. Renvoie `null` sur une pose absente ou
  incomplète (on ne crie pas au loup sur une donnée manquante) ;
- alerte ⚠ *« Mutualisation non tenue — les 2 dossiers roulent séparément »* sur les chargements des
  **deux** dossiers, via `_warning` — donc Gantt, détail de bloc **et `diag.sh`** (persisté en
  `placement_segments.warning_code`). Elle **s'ajoute** à un avertissement existant ;
- bandeau explicatif dans la fiche détail. **Réservé à la mutualisation** : une boucle retour n'est
  pas imbriquée par nature (l'accroché charge *après* la livraison de l'ancre).

Le KPI « km économisés » était déjà juste : il somme les `_kmEvites` portés par les blocs, et le
filet n'en attache aucun.

### Date SOUHAITÉE ≠ date PLANIFIÉE (arbitrage Louis 2026-07-31)

Corollaire immédiat de ce qui précède : puisque accepter une boucle **écrit** la date retenue sur le
lot, `dateC` ne peut plus porter à lui seul les deux notions qu'il confondait — ce que le client a
demandé, et ce que le planning a retenu.

| Champ front | Colonne | Rôle |
|---|---|---|
| `dateCSouhaitee` / `dateLSouhaitee` | `lot_stops.requested_date` (migration **0006**) | **La demande du client.** Figée à la création, **jamais** réécrite par le moteur. |
| `dateC` / `dateL` | `lot_stops.agreed_date` | **La date planifiée.** Déplaçable dans la fenêtre de flex, par une boucle uniquement. |

Deux usages, et deux seulement (helpers `dateChgSouhaitee` / `dateLivSouhaitee`, `utils/datesBoucle.js`) :

1. **Ancrer la fenêtre de flex.** Ancrée sur `dateC`, elle se recentrait sur chaque date retenue : un
   dossier demandé au 18/09 puis placé au 21/09 devenait déplaçable jusqu'au 28/09, puis au-delà — la
   souplesse promise au client **dérivait d'acceptation en acceptation**. Elle est désormais ancrée
   sur la demande, donc fixe. Vaut pour `findBoucleCandidates`, `reflowVehicle` et le sélecteur de
   date de repli (`FlowLocking`).
2. **Juger le badge « ✓ Date souhaitée par le client »** des cartes de suggestion. Il comparait la
   date proposée à `dateC` — donc, dès la première boucle acceptée, **à elle-même** : toujours vrai,
   donc faux.

*Dossiers antérieurs à la migration* : la demande d'origine n'a jamais été stockée. Le backfill
l'aligne sur `agreed_date` (pour l'immense majorité, aucune boucle ne les a déplacés, donc les deux
coïncident). Côté front, les helpers se replient sur la date planifiée quand le champ est absent.

Point unique d'application : **`chgVenduTenu(blocks, lot)`** (`engine/boucleEngine.js`) — relit la
chaîne **posée** (jamais une estimation), égalité **stricte** sur la 1ʳᵉ part du chargement (charger
un dossier vendu plus tôt est aussi impossible que plus tard : le client n'est pas prêt). Un
chargement introuvable ou en débordement d'axe ⇒ non tenu. Métrique : `boucle_rejets_chg_vendu`.

*Cas fondateur* : mutualisation CHT-463530 (accroché) + CHT-400887 (ancre). Chargement de l'ancre
repoussé du **vendredi 18/09 au lundi 21/09** — alors que, posé seul, ce dossier tenait sa date
grâce à la coupure dépôt du vendredi midi. Empiler les deux chargements le vendredi laissait un
retour dépôt de 94 km (≈ 2 h) après un chargement finissant à 17 h : la coupure échouait et le
remède 2 emportait la date vendue.

*Conséquence à connaître* : le contrôle compare à la **date vendue**, pas à la pose existante. Si le
l'ancre a une **approche si longue** que `buildChain` ne peut pas poser son chargement à cette date
(dépôt à ~1 000 km du lieu de chargement), la boucle est refusée bien que la date fût déjà rompue
**avant** la boucle. Conforme à l'arbitrage, à surveiller sur les longues distances.

- **La date de chargement d'un lot placé ne bouge JAMAIS** — elle est verrouillée à la vente.
  Seule la **livraison** peut glisser (passe 2 retour, livraison au plus tôt en mutu).
  `partnerNewDateC` reste donc toujours `null` : c'est voulu, pas un oubli. En mutualisation, la
  seule date de groupage évaluée est `dateC` de l'ancre. (La fenêtre `flexC` d'un lot **en cours de
  négociation** — le draft accroché — reste utilisable : elle est négociée client avant placement.)

**Asymétrie ancre / accroché — reformulation opérationnelle (arbitrage Louis 2026-07-28)** :

| | rôle | date de chargement |
|---|---|---|
| **ANCRE** (`ANC`) | dossier **vendu**, déjà placé | **INTOUCHABLE**. Seule sa livraison peut être avancée (`partnerNewDateL` + todo de confirmation). `partnerNewDateC` **toujours `null`**. |
| **ACCROCHÉ** (`ACC`) | dossier **en cours de vente** | **mobile dans sa fenêtre `flexC`** — c'est exactement ce que le commercial a négocié. |

- **BALAYAGE DE LA FENÊTRE DE FLEX DE L'ACCROCHÉ (mutualisation, 2026-07-28)** — il n'était pas seulement
  contraint : il était **épinglé** sur `lotB.dateC` (`aMutuSim.dateC = lotB.dateC`), sa propre
  fenêtre ne servant que de filtre d'acceptation *a posteriori*. `findBoucleCandidates` balaye
  désormais les dates de chargement possibles **pour l'accroché seul**, et retient la meilleure au sens des
  **km réellement roulés**. Garde-fou restant : pas de balayage si l'accroché est verrouillé ou si
  `flexC = 0`.
  🔴 **`gainMinDecalageChgKm` (300 km) est RETIRÉ depuis le 2026-09-03** *(arbitrage Louis)*. Il
  exigeait qu'une autre date fasse gagner au moins 300 km pour l'emporter sur le groupage serré sur
  l'ancre. Motif du retrait, dans ses mots : « les meilleures boucles apparaîtront au planif, et si
  elle est sans intérêt il ne la sélectionnera pas » — on cesse d'empiler des règles de départage
  par-dessus les garde-fous. Le balayage retient désormais **la chaîne qui roule le moins**, la date
  demandée par le client ne servant plus que de départage **à km égaux** (puis la plus précoce).
  ⚠️ Ce seuil ne protégeait de toute façon la date promise que lorsque le groupage serré était
  PLANIFIABLE : quand il ne l'était pas — cas fréquent, la garde week-end refusant souvent le
  chargement groupé — le code prenait déjà la meilleure alternative au kilomètre brut, sans rien
  exiger. Une base existante peut encore porter la clé dans ses `rules` : elle n'est plus lue.
  ⚠️ **Limite connue, non traitée** : le balayage réduit la fenêtre de flex à **UNE seule date par
  partenaire** avant le classement. Le planificateur arbitre donc entre des *partenaires*, jamais
  entre plusieurs *dates* du même partenaire — le « il ne la sélectionnera pas » ne s'applique pas
  au choix de la date.
  *(Depuis le 2026-07-31, « tenir le chargement vendu de l'ancre » n'est plus un critère de départage :
  c'est une **contrainte dure** évaluée en amont — les dates qui ne la tiennent pas ne parviennent
  plus jusqu'au classement. Cf. § « Dates de chargement = verrouillées » ci-dessus.)*
- **Le RETOUR n'a pas besoin du balayage** : le chargement de l'accroché y est déjà posé au plus tôt après la
  livraison de l'ancre (plancher = 1ᵉʳ jour de flex de l'accroché), et toute date plus tardive est structurellement
  rejetée — attente non-productive > `ecartMaxH`, ou week-end intercalé qui casse la boucle.
- **Attention au remède 2** (`buildChain`/`buildMutuChain`, décalage de la tournée au lundi) : il ne
  réécrit pas le dossier de l'ancre, mais il **pose** son chargement plus tard. C'est un **signal
  d'infaisabilité** (warning « Chargement décalé »), jamais une optimisation. **Depuis le
  2026-07-31, une chaîne de boucle qui déclenche ce remède sur le chargement de l'ancre est écartée** :
  le planificateur (`buildMutuChain`) a toujours le droit de la produire, le moteur de proposition
  (`findBoucleCandidates`) n'a plus le droit de la retenir.

### Rôles en mutualisation (`_mutuRole`, 2026-07-19 — fix B2)
- À l'acceptation d'une mutu, les lots sont marqués `_mutuRole: "initiateur"` (le lot dont la
  création a déclenché la proposition, l'**accroché**) et `"partenaire"` (l'**ancre**, déjà placée). Le reflow
  s'en sert pour rejouer la séquence S1/S2 **dans le bon sens** — sans ce marqueur, les rôles
  étaient devinés à l'envers et l'ordre posé était l'inverse de l'ordre proposé.
  Effacé (avec `_sequence`, `_boucleWith`…) à toute désolidarisation.
- **`_operatingAgency` (mutualisation régionale, 2026-07-29)** — posé sur l'**accroché** quand le
  camion appartient à une autre agence de la région, et lu depuis le **véhicule** (`partnerVeh.ag`),
  pas depuis `chosen.partnerAgence` : c'est le camion qui définit l'agence opératrice, et c'est lui
  que le serveur traduit en `operating_agency_code`. Laissé **indéfini** en mutualisation interne
  (le serveur retombe alors sur l'agence vendeuse). Le ancre, lui, ne reçoit rien : il reste
  chez lui. **Effacé à toute désolidarisation** — sans quoi un lot désolidarisé resterait rattaché
  au camion du voisin (mauvais Gantt, mauvais périmètre, écriture refusée par le serveur).
  Il pilote la partition `myLots` / `crossLots` via `opereParUneAutreAgence` (`utils/statusHelpers.js`),
  dont le test ne regarde **que** l'agence opératrice — jamais le type de boucle.

### Règle week-end

> 🔒 **RÈGLE ABSOLUE (Q17, arbitrage Louis 2026-07-21)** — **un PL ne reste JAMAIS loin de son
> dépôt pendant un week-end**, qu'il soit **chargé ou à vide**. Aucune exception : ni pour sauver
> une boucle, ni pour gagner des km. C'est la contrainte qui prime sur l'optimisation.

Points d'application (tous vérifiés le 2026-07-21) :

| Où | Contrôle | État |
|---|---|---|
| `findBoucleCandidates` — retour | `LivB→ChgA` : rejet **inconditionnel** si un week-end s'intercale | existant |
| `findBoucleCandidates` — retour | `ChgB→LivB` et `ChgA→LivA` : le PL doit pouvoir rentrer **à son dépôt** avant la coupure, depuis le lieu de chargement **ou** depuis la zone de livraison (`peutRentrerAvantWeekend`) | **corrigé 2026-07-21** |
| `buildChain` — approche | approche + chargement doivent tenir avant vendredi `DAY_END`, sinon approche décalée au lundi | **ajouté 2026-07-21** |
| `buildChain` — route | route + livraison doivent tenir avant vendredi `DAY_END` (`enforceFridayRuleRoute`) | existant |
| `buildMutuChain` — approche + route | idem | existant |
| `reflowVehicle` — entre 2 lots | retour dépôt forcé dès que l'enchaînement n'est **pas continu** (`enchainementContinu` : week-end intercalé **ou** écart > `seuilEnchainementJours`, défaut 1 j ouvré) — le PL ne reste jamais à attendre sur place | élargi **2026-07-23** (avant : week-end seul) |
| `reflowVehicle` — **nuit entre 2 chantiers** | dès qu'une **nuit** s'intercale, l'enchaînement direct exige en plus que le PL soit **à pied d'œuvre** : prochain chargement ≤ `seuilResterSurPlaceKm` (80 km) **et** dépôt pas plus près que lui. Sinon retour dépôt — sauf s'il ne tient pas avant la fin de journée (repli) | **ajouté 2026-08-03** (CHT-829278) |
| `reflowVehicle` — **sortie de mutu** | même critère que pour un lot simple : retour dépôt entre la paire et le chantier suivant hors enchaînement continu ; garde week-end armée sur toute mission mutu **dépôt → dépôt** (plus seulement quand la paire est seule sur le PL) | **corrigé 2026-07-23** (CHT-147829/CHT-702532) |
| `buildChain` — **retour dépôt** | aucun week-end ne doit s'intercaler entre le départ et la fin du retour dépôt (`chaineTraverseWeekend`, par segments dépôt → dépôt) ; sinon **coupure au dépôt après le chargement** ou **livraison avancée dans la flex**, à défaut décalage de la tournée au lundi | **ajouté 2026-07-22**, remède 1 bis **2026-08-01** |
| `buildMutuChain` — **retour dépôt** | idem, garde active à la **simulation** (`evalMutuSeq`) comme à la **pose** (`detectBoucles`) pour préserver « proposé = posé » ; remède **coupure au dépôt** ajouté (tient les dates de chargement des deux clients) | **ajouté 2026-07-22**, coupure **2026-07-23** |
| `buildMutuChain` — **mutu inter-agences** | le dépôt de référence est celui du **CAMION** (agence porteuse), jamais celui de l'agence vendeuse de l'accroché : le PL part de chez lui et y revient. Vrai **par construction** (`agLookup(vehicule.ag)`), `chainBuilder.js` ne lit aucun `.soc` | vérifié **2026-07-29** |
| `findBoucleCandidates` — retour | `LivA → retour dépôt` : depuis la fin de livraison de l'accroché, le PL doit pouvoir rejoindre **son** dépôt avant la coupure | **ajouté 2026-07-22** |
| `findBoucleCandidates` — retour | **remaniement avant rejet** : sur violation week-end, la simulation est rejouée avec la livraison de l'ancre avancée au plus tôt ; rejet seulement si ça ne suffit pas | **ajouté 2026-07-22** |

**Troisième défaut corrigé — le retour dépôt (2026-07-22, dossier CHT-974192)** : les contrôles
ci-dessus regardaient l'aller (approche + chargement, route + livraison) mais **jamais le trajet de
retour**. Sur un long courrier (Var → Finistère, ~19 h de route dans chaque sens), la route et la
livraison « tenaient » avant vendredi 18 h → aucun décalage ; la livraison tombait vendredi matin ;
le retour de 19 h ne tenait plus dans les 9 h restantes et `enforceFridayRule` le **repoussait au
lundi** — produisant exactement la situation interdite (PL immobilisé le week-end à 1 260 km de sa
base). `enforceFridayRule` sait seulement *décaler*, pas *empêcher*.
→ `buildChain` raisonne désormais sur la tournée **complète, dépôt → dépôt** : si un vendredi
s'intercale entre le premier bloc et la fin du retour, la tournée est corrigée — voir les **deux
remèdes** ci-dessous.

**Les trois remèdes, dans l'ordre (arbitrage Louis 2026-07-22, dossiers CHT-308024 / CHT-241946 /
CHT-587683 ; remède 1 bis ajouté le 2026-08-01, dossier CHT-221011)** — *la date de chargement
promise au client prime sur l'optimisation du camion.*

1. **Coupure au dépôt après le chargement** (préféré). Le chargement **reste à sa date** ; le PL
   rentre **chargé** au dépôt, y passe le week-end, et la route + la livraison repartent le lundi.
   C'est la **pratique courante en déménagement** : on charge en fin de semaine, on route et on livre
   la semaine suivante. Conséquence physique modélisée : le trajet vers la livraison part alors **du
   dépôt** et non du lieu de chargement (`kmRoute` recalculé). Le bloc de rentrée porte
   `_weekendDepot: true`. Sur les trois dossiers réels, ce remède tient **les deux dates promises**
   (chargement *et* livraison).
1 bis. **Livraison avancée dans la fenêtre de flex** (`chercherLivraisonAvancee`). Le chargement
   reste à sa date **lui aussi**, mais on livre **1 à 4 jours ouvrés AVANT** la date demandée, pour
   que le PL soit rentré au dépôt avant la coupure. Retenu **à la place** de la coupure quand il
   rapproche la livraison de la promesse client. Voir « Sixième défaut corrigé » ci-dessous.
2. **Décalage de la tournée entière au lundi** (repli). La date de chargement n'est alors plus tenue
   et le bloc `chg` porte le warning « Chargement décalé ». C'était l'unique remède avant le
   2026-07-22 : il faisait perdre jusqu'à 5 jours au client sur sa date de chargement.

*Corollaire sur la détection* — `chaineTraverseWeekend` raisonne par **segments dépôt → dépôt** (la
chaîne est découpée à chaque retour dépôt) : un week-end passé **au dépôt** est légitime, seul compte
un vendredi qui s'intercale **avant** que le PL ne soit rentré.

**Quatrième défaut corrigé — la garde validait ses propres violations (2026-07-28, dossiers
CHT-092958 / CHT-961457)** : `chaineTraverseWeekend` clôturait un segment sur le `day` du **premier
morceau** du bloc `vid`. Or `splitByDay` découpe un retour de plus d'une journée en plusieurs blocs :
sur un retour Rennes → 83500 posé **vendredi 12 h → lundi 16 h**, la garde voyait « le PL part
vendredi vers le dépôt » et concluait « rentré ». Le PL était en réalité encore à ~600 km de sa base
le samedi. Conséquence : le **remède 1 (coupure au dépôt) était accepté alors qu'il violait Q17**, et
le moteur posait un aller-retour dépôt parasite de **+1 978 km** (4 621 km au lieu de 2 643 km) au
lieu de constater l'infaisabilité.
→ Le segment se clôt désormais sur le **jour d'ARRIVÉE** au dépôt (`fromAbs(b.endAbs).day`), pas sur
le jour de départ. Effet : sur une mission qui ne rentre pas dans la semaine, le moteur retient le
remède 2 et **dit la vérité** (chargement reporté + warning) au lieu de fabriquer un faux remède.

**Cinquième défaut corrigé — curseur non avancé après la coupure (2026-07-28)** : après avoir posé le
retour dépôt, `buildChainInterne` et `buildMutuChainInterne` remettaient le curseur au lundi 7 h sans
tenir compte de l'heure d'**arrivée** réelle. Un retour débordant sur le lundi produisait donc deux
blocs **simultanés** sur le même camion (retour dépôt 7 h-16 h *et* route 7 h-18 h). Corrigé par
`cursor = Math.max(lundi, finRentree)` des deux côtés.

**Sixième défaut corrigé — le moteur ne savait que retarder, jamais avancer (2026-08-01, dossier
CHT-221011)** : Aix-en-Provence → Paris, chargement mer. 23/09, livraison demandée ven. 25/09.
Paris ↔ dépôt Marseille = **827 km ≈ 12 h de conduite, soit plus qu'une journée ouvrée (11 h)** :
livrer un **vendredi** rend le retour au dépôt **mathématiquement impossible** avant la coupure,
quelle que soit l'heure de la livraison. La chaîne brute laissait donc le PL à Paris tout le
week-end, et le remède 1 repoussait la livraison au **mardi suivant** — 2 jours ouvrés de retard,
plus **29 h de camion chargé immobile** au dépôt. Or livrer le **jeudi**, un jour **en avance**,
ramenait le PL à sa base le vendredi à 14 h : mission bouclée dans la semaine, Q17 tenue, date de
chargement tenue. La règle « livraison à date » ne savait que **retarder** le départ (boucle
« départ au plus tard »), jamais **avancer** la livraison.
→ **Remède 1 bis** (`chercherLivraisonAvancee`), sous quatre conditions strictes — *arbitrage Louis
2026-08-01 : avancer une livraison ne demande pas de confirmation client, dans la limite de 4 jours* :

| Garde-fou | Effet |
|---|---|
| **Dernier recours** | tenté uniquement sur une chaîne qui viole **déjà** Q17 — un placement qui passe tel quel n'est jamais touché, la date demandée reste la date posée |
| **Borné** | `flexLivraisonJours` (4 j ouvrés), et **coupé net si `dateLivImposee`** — même sémantique que la fenêtre du moteur de boucles |
| **Avance minimale** | on essaie J−1, puis J−2… et on retient le **premier** jour qui rend la tournée conforme, pas le meilleur en km |
| **« Jamais pire »** | retenu seulement s'il **rapproche** la livraison de la promesse client par rapport au remède déjà en main (écart **non signé**, en jours ouvrés). C'est cette garde qui rend le remède sans effet de bord sur les dossiers déjà correctement placés |

Le bloc `liv` porte `_livAvancee: { demandee, posee, jours }` et le warning « Livraison avancée de
N j ». **La `dateL` du dossier n'est pas réécrite en base** : seul le bloc posé bouge, l'écart reste
donc visible (warning + anomalie ④ de `diag.sh`). C'est **voulu** — le planificateur doit voir que la
date posée n'est pas celle qui a été demandée.

> ⚠️ **Invariant pour tout futur correctif** : un remède qui « répare » un week-end hors dépôt en en
> créant un autre est un **bug**, pas un compromis. Toute évolution de la garde doit préserver Q17,
> et un chiffrage en km n'est **jamais** un argument contre — comparer les km n'a de sens qu'**entre
> chaînes déjà conformes**.

#### Quand aucun remède ne marche — le dernier recours *(2026-08-18)*

Les trois remèdes supposent tous que la mission **tient dans une semaine ouvrée**. Quand elle n'y
tient pas, le moteur rendait jusqu'ici la chaîne d'origine — celle qui viole Q17 — **sans compteur,
sans journal et sans marque**. Invisible au planificateur comme au diagnostic. Une règle d'or violée
en silence est le pire des deux mondes : on croit la règle tenue partout, et on ne sait même pas
combien de fois elle ne l'est pas.

**Ce qui a été retenu** : on continue de **poser** la chaîne, et on la **signale**. Refuser de la
poser ferait disparaître le dossier du planning, ce qui est pire — l'invariant « jamais de
suppression silencieuse » vaut aussi contre soi-même. Un dossier signalé se traite ; un dossier
absent ne se voit pas.

> ⚠️ **Ceci n'assouplit pas Q17.** La règle interdit de **proposer** une option non conforme quand
> une conforme existe. Dans ces cas-là aucune n'existe : la pose n'est pas un choix entre options,
> c'est le seul état atteignable. Le signal sert à **compter** ces dossiers pour décider quoi en
> faire — refus à la vente, découpage, affrètement. C'est une décision de direction, pas de moteur.

Deux causes, **deux gestes différents**, d'où deux messages et deux compteurs :

| Cause | Compteur | Ce que ça veut dire | Le geste |
|---|---|---|---|
| **Hors axe** | `weekend_hors_depot_hors_axe` | La semaine suivante n'est pas **affichée**, le décalage au lundi n'est pas représentable | Élargir la période. Ce n'est **pas** une impasse métier — rarissime en production (axe ~130 jours) |
| **Trop long** | `weekend_hors_depot_trop_long` | La mission déborde la semaine ouvrée **même reprise d'un lundi frais** | Vraie impasse. Aucune fenêtre plus large n'y changera rien |

Le total est porté par `weekend_hors_depot_sans_remede`. ⚠️ **Ordre de grandeur, pas décompte
exact** : `avecGardeJamaisPire` construit la chaîne deux fois sur les dossiers à plage horaire
élargie, qui peuvent donc compter double.

À l'écran, le bloc porte `_warningFriday` — le canal **rouge** (🚨) d'`AtomBlock`, qui n'avait
jusqu'ici aucun émetteur.

**Ce qui n'est pas démontré, et qu'il faut savoir** : la cause « trop long » n'a **aucun test**, et
ce n'est pas un oubli. Aucun dossier plausible fabriqué pour l'occasion ne l'atteint — distances
françaises maximales, volumes jusqu'à 10 000 m³, manutentions jusqu'à six jours : le moteur trouve
toujours un remède. Bonne nouvelle, mais elle ne prouve rien sur les dossiers réels, seulement sur
ceux qu'on a su imaginer. Le compteur existe pour répondre par la **mesure** : à zéro sur une saison
entière, la cause est théorique et on pourra le dire ; s'il monte, on saura de combien de dossiers
on parle. Tests : `src/test/engine/weekendSansRemede.q17.test.js`.

*Portée délibérée* — la garde est **opt-in** (`opts.gardeWeekendRetour`), activée par `reflowVehicle`
sur **tout lot formant une tournée complète dépôt → dépôt** : il **part du dépôt** (`prevLivGps ===
agGps` — premier lot du PL, ou lot précédent rentré au dépôt) **et y revient** (`!skipDepot`), quelle
que soit sa **position** dans la file. *(Élargi le 2026-07-23, dossiers CHT-092958 / CHT-164258 : la
garde ne visait que le premier lot ; le **dernier lot** d'un PL — sans « lot suivant » pour déclencher
`hasWeekendBetween` — voyait sa propre tournée enjamber le week-end sans correction.)* Elle reste
inactive dans les **simulations de boucle** (elles ont leur propre garde `peutRentrerAvantWeekend` ;
décaler leurs chaînes fausserait le scoring) et sur les **maillons enchaînés en continu**
(`skipDepot` : curseur hérité, `hasWeekendBetween` y décide déjà du retour dépôt).

*Repli* — si même un départ le lundi ne suffit pas (tournée intrinsèquement > 1 semaine), la chaîne
d'origine est conservée : décaler ne ferait que retarder le client sans résoudre le week-end.

**Quatrième défaut corrigé — `LivA → retour dépôt` en boucle retour (2026-07-22, CHT-570751)**

`findBoucleCandidates` contrôlait le week-end sur trois segments (`ChgB→LivB`, `LivB→ChgA`,
`ChgA→LivA`) mais **pas sur le trajet de retour**. Une boucle était donc proposée puis acceptée
alors que le PL finissait sa livraison le vendredi et ne pouvait plus rentrer : CHT-570751, livré
vendredi 04/09 dans le Var à 968 km de son dépôt (56380), rentrait lundi et mardi.

⚠️ Les gardes ajoutées le même jour sur `buildChain` / `buildMutuChain` **ne couvraient pas ce cas** :
elles ne sont actives que sur une tournée complète dépôt → dépôt (à l'époque le seul premier lot du
PL ; depuis le 2026-07-23, tout lot dépôt → dépôt — mais en boucle retour l'accroché reste un **maillon
enchaîné en continu**, `skipDepot`, donc hors garde de toute façon). C'est le moteur de
**proposition** qu'il fallait corriger, pas le planificateur — les deux sont des endroits distincts
du code.

→ 4ᵉ contrôle ajouté, avec `peutRentrerAvantWeekend` depuis la fin de livraison de l'accroché vers le dépôt
du **PL de l'ancre** (agence de l'ancre). Pas de garde `hasWeekendBetween` : le retour est la dernière étape,
il n'y a pas d'opération suivante à comparer — `peutRentrerAvantWeekend` renvoie `Infinity` (donc
« pas de contrainte ») quand aucun vendredi n'est en vue.

### Remaniement des dates avant rejet (arbitrage Louis, 2026-07-22)

> **Un rejet week-end n'est définitif qu'une fois la flex disponible exploitée.**

Le moteur simule en deux passes : passe 1 = l'ancre garde sa date de livraison promise ; passe 2 = l'ancre est
avancé au plus tôt dans sa fenêtre (interdite si l'ancre est `placed_locked`). La passe 2 n'était jouée
que sur échec des **contrôles de faisabilité**, jamais sur **violation week-end** — CHT-570751 a
donc été accepté sans qu'on ait tenté de compresser la mission. Le moteur retente désormais.

C'est le **seul levier disponible**, et il faut le savoir avant d'en chercher d'autres :

| Date | Mobile ? |
|---|---|
| Chargement de l'ancre | **non, jamais** — verrouillée à la vente (Q15). Depuis le 2026-07-31 c'est vérifié sur la chaîne posée (`chgVenduTenu`) : une simulation qui le déplacerait est rejetée, pas classée dernière |
| Livraison de l'ancre | **oui**, dans sa fenêtre, sauf si l'ancre est verrouillé ← *le levier* |
| Chargement de l'accroché | non choisi — conséquence : l'accroché charge dès que le PL est libre après l'ancre |
| Livraison de l'accroché | non choisie — conséquence, plafonnée par la flex livraison de l'accroché |

Décaler l'accroché à la semaine suivante n'est **pas** un levier : le contrôle `LivAnc→ChgAcc` casse la boucle
dès qu'un week-end les sépare (le PL devrait rentrer puis redescendre, ce qui annule le bénéfice).

*Conséquence mesurée* — **T08 et T09 du CSV juin 26 redeviennent des boucles ACCEPTÉES**, après
avoir été requalifiées en « refus » le 2026-07-21. L'attendu d'origine est donc **rétabli**, mais
sans violer Q17 : le remaniement avance la livraison de l'ancre au mercredi, la mission se compresse, l'accroché
est livré à Nantes le vendredi — c'est-à-dire **au dépôt**. Le PL est chez lui pour le week-end,
soit l'inverse exact du schéma interdit. Le prix est explicite dans la proposition
(`impactPartnerDates` + `partnerNewDateL` : la date promise à l'ancre avance, à confirmer avec ce client).

**Les deux défauts corrigés** (ils laissaient un PL passer le week-end loin de sa base) :
1. **Mauvais dépôt de référence** — le contrôle `ChgA→LivA` mesurait le retour vers le dépôt de
   l'agence **vendeuse de l'accroché**. Or en boucle retour, l'accroché est chargé chez son client mais porté par le
   **PL de l'agence opératrice (celle de l'ancre)**. Le dépôt de l'accroché étant souvent à deux pas du chargement, le
   contrôle répondait toujours « OK ». → on utilise désormais le dépôt du **véhicule** (`gpsDepotPL`).
2. **Mauvais vendredi de référence** — l'échappatoire « le PL peut rentrer depuis la livraison »
   partait de la **fin de livraison**, située *après* le week-end franchi : elle mesurait la
   coupure suivante et laissait donc toujours passer. → on part désormais de la fin du
   **chargement** et on ajoute la route au trajet de retour.

*Conséquence assumée* : l'attendu du CSV de tests juin 26 est **supersédé** pour T08/T09/T11 —
ces 3 cas produisaient tous le même schéma (ancre livrée vendredi à Marseille, accroché chargé dans la foulée,
PL de Nantes immobilisé chargé à ~1000 km tout le week-end). Ils sont désormais **refusés**.

- Un **week-end intercalé entre la livraison de l'ancre et le chargement de l'accroché casse la boucle** : le PL ne peut
  pas rester immobilisé loin de son dépôt ; la règle vendredi imposerait un retour dépôt → boucle non continue.
- Appliquée par `findBoucleCandidates` **et**, depuis le 2026-07-19 (fix B1), par `detectBoucles` :
  la détection sur le Gantt ne défait plus le retour dépôt posé par le reflow quand un week-end
  sépare les deux lots.
- l'accroché ne peut pas charger **avant le 1er jour de sa fenêtre de flex** négociée.

### Badge « ★ Boucle » (`detectBoucles`) — définition précisée (2026-07-19, I1)

#### 🔴 Préalable ABSOLU : la qualification suit la DÉCISION, pas l'adjacence (arbitrage Louis 2026-08-03)

**Le badge ★ et les « km évités » ne sont attribués QUE si la boucle a été DÉCIDÉE** par le
planificateur — c'est-à-dire si les deux dossiers portent le couple `_boucleType` (`"retour"` ou
`"mutualisation"`) / `_boucleWith` se désignant l'un l'autre, posé à l'acceptation d'une
proposition du moteur. Prédicat unique : `boucleDecidee` (`engine/boucleEngine.js`).

**Pourquoi** : jusqu'ici la qualification était **automatique**. Deux dossiers simplement posés
l'un derrière l'autre — par glisser-déposer, ou par le seul hasard du planning — décrochaient
l'étoile et créditaient des kilomètres qu'aucun planificateur n'avait arbitrés. Le KPI
« km économisés » comptait donc des économies fictives. Cas fondateur : **CHT-735480 → CHT-254940**
(deux dossiers JAUFFRET voisins sur GQ-156-KL, « ★ Boucle détectée −500 km » affiché sans qu'aucune
boucle n'existe en base : `is_loop = false`, aucun `_boucleType`). Sur la photo de septembre 2026,
c'était **le seul** cas — 3 blocs et 500 km sur 85 blocs et 13 269 km : les 82 autres venaient tous
de mutualisations réellement acceptées.

⚠️ **La règle porte sur la QUALIFICATION, jamais sur le CHAÎNAGE.** `detectBoucles` ne fait pas que
décorer : il **restructure** la tournée (il retire le retour dépôt final de l'ancre et rechaîne
l'accroché depuis le point de livraison via `buildChain`). Cette restructuration est **inchangée** :
deux dossiers voisins s'enchaînent exactement comme avant, le bloc de repositionnement et ses
kilomètres réels restent posés, le camion roule pareil. Seule la décoration disparaît. Mesuré sur
les 72 dossiers réels : **0 bloc déplacé sur 29 camions et 402 blocs**, 3 qualifications retirées.
Les critères géométriques ci-dessous restent appliqués **en plus** de la décision (une boucle
décidée dont la géographie sort des zones ne badge toujours pas).

- Le badge marque un **enchaînement physique** de deux lots consécutifs sur un même PL :
  écart 0–3 jours ouvrés, **pas de week-end intercalé**, et — **pour un rechaînage opportuniste
  seulement** — liaison ≤ `seuilProxRetourKm` (une boucle DÉCIDÉE n'y est plus soumise depuis le
  2026-08-19, cf. §1).
  C'est bien le seuil **retour** qui s'applique : la distance mesurée est `livAnc→chgAcc`, la
  géométrie d'un retour. Le badge ne détecte que des enchaînements **consécutifs dans le temps**,
  jamais deux lots chargés ensemble (la forme d'une mutualisation). ⚠️ Ce contrôle n'est **pas**
  restreint aux paires inter-agences — seul le filtre de zone, juste après, l'est.
- Il n'applique **pas** les filtres économiques des propositions (`minKmEco`, `ecartMaxH`,
  capacité) : un enchaînement badgé n'aurait pas forcément été **proposé** par le moteur.
  (L'ancienne formule « badge = boucle qui aurait pu être proposée » était inexacte.)
- Ne distingue pas les agences (`soc`) : deux lots séquentiels d'une même agence peuvent être
  badgés — le concept est « le PL enchaîne sans rentrer à vide », pas la gouvernance RETOUR.
  ⚠️ C'est précisément ce point qui laissait passer CHT-735480 → CHT-254940 : même agence (JAU),
  donc **jamais soumis au filtre de zones**, qui ne vaut qu'entre agences différentes. Le filet est
  désormais la décision, en amont de tout critère géographique.
- **Mutualisation décidée** : son marquage ne passe **pas** par `detectBoucles` mais par
  `buildMutuChain` (`_boucle` sur les blocs chg/liv) et par `reflowVehicle`, qui recopie les km
  **retenus à la décision** (`_boucleKmEco`, persisté sur le lot) sur le 1er chargement de la paire.
  Ce chemin part déjà d'une décision (`reflowVehicle` n'apparie que sur `_boucleType:
  "mutualisation"` croisé) : il est **inchangé** par l'arbitrage 2026-08-03.
- **Effet sur l'existant** : les drapeaux `_boucle`/`_kmEvites` sont **persistés** dans
  `placements` (`is_loop`, `extra`). Retirer la règle du code ne nettoie donc pas les badges déjà
  en base : ils disparaissent au prochain reflow / recalcul (↻) du camion concerné.
- **Exception depuis 2026-07-28** : quand les deux lots sont d'agences **différentes** (donc un
  RETOUR), le badge applique en plus le filtre **zones de chalandise** (F3bis). Sans ça, une boucle
  assemblée à la main en glisser-déposer garderait son ★ et alimenterait le KPI « km économisés »
  alors que le moteur aurait refusé de la proposer. Deux lots de la **même** agence relèvent de la
  mutualisation : la règle ne s'y applique pas.
- Le rechaînage du lot aval passe par **`buildChain`** (fix B3/B4 : liaison `repo` générée si
  > `seuilRoute`, règle vendredi, règle chargement même jour, `dateC`/`dateL` respectées).
  Liaison < `seuilRoute` → pas de bloc repo fictif ; les « km évités » sont portés par le
  chargement de l'ancre (KPI conservé).
- **« Km évités » = formule de décision unifiée** (2026-07-23, helper `kmEcoBoucleRetour`). La
  pastille Gantt / le KPI et la carte de suggestion affichent **la même valeur** : celle qui décide
  la boucle, soit `(ancre seule + accroché seul) − trajet combiné`, où « seul » = aller-retour
  depuis le **dépôt de l'agence vendeuse** du lot, et le trajet combiné rentre au dépôt de l'ancre.
  Avant, `detectBoucles` ne comptait que le retour à vide de l'ancre (~2× trop petit). CP non résolu
  → aucune valeur affichée (pas de chiffre fantaisiste). Valeur persistée dans `lot_loops.km_eco`.
- **« Km évités » mesurés sur les km RÉELLEMENT roulés (arbitrage Louis 2026-07-28,
  helper `kmEcoBoucleRetourReel`)**. La formule ci-dessus compare des circuits **géométriques** —
  dépôt→chg→liv→dépôt à vol d'oiseau, **sans calendrier**. Or ce sont les horaires, les week-ends et
  le retour dépôt du vendredi (Q17) qui créent les kilomètres : la pose peut insérer des trajets que
  le circuit idéal ignore. Le planificateur voyait donc un gain sans rapport avec le gain réel.
  On compare désormais **les chaînes posées** : *(chaîne de l'ancre seul + chaîne de l'accroché seul) − chaîne
  combinée*. Subtilité : dans une boucle l'ancre **ne rentre pas** au dépôt (le PL enchaîne sur
  l'accroché) → son **retour final** est exclu du combiné, mais sa **coupure du vendredi**
  (`_weekendDepot`) est conservée, c'est un retour *interne*. Branché sur `findBoucleCandidates`
  (retour **et** mutualisation) et sur `detectBoucles` (badge ★ + KPI), avec **repli automatique sur
  la géométrie** si une chaîne est vide ou déborde de l'axe. Sur les missions courtes les deux
  valeurs coïncident ; elles divergent exactement quand le calendrier ajoute des kilomètres.
- **De quel dépôt part « chaque lot tout seul » (corrigé 2026-07-29)** — du dépôt de **l'agence
  vendeuse de CE lot**, pas de celui du camion. C'est le contrefactuel honnête : sans mutualisation,
  l'agence de l'accroché aurait sorti un camion depuis chez elle. Le **circuit combiné**, lui, part et revient
  bien au dépôt du **camion** (celui de l'ancre) — c'est le seul trajet réellement roulé.
  La branche retour appliquait déjà cette distinction (`chaineSeuleRetour`, `{ ...vehB, ag: lot.soc }`) ;
  la branche mutualisation faisait partir les **deux** lots du dépôt de l'ancre. Sans effet tant que
  la mutualisation était intra-agence (un seul dépôt), **faux dès que les agences diffèrent** — et
  c'est ce `kmEco` qui départage les propositions concurrentes.

#### 🔑 Une PAIRE MUTUALISÉE est INSÉCABLE — l'unité de tournée (correctif α, 2026-08-13)

`detectBoucles` parcourt les dossiers d'un camion **deux par deux**. Il ignorait qu'une paire
mutualisée forme un bloc : sur un camion portant `X` puis la paire `(P, Q)`, il prenait le couple
`(X, P)` et rebâtissait **`P` tout seul** avec `buildChain` — le planificateur d'**un seul dossier**
— en abandonnant `Q` sur place. Quatre blocs de transport au lieu de deux, deux livraisons dans le
même créneau, et un kilométrage qui explosait *(1 493 km posés pour 1 051 réellement roulés)*.

Il raisonne désormais en **UNITÉS** — un dossier seul, ou une paire dont les deux membres comptent
pour un. La lecture des paires passe par le point unique `pairesMutu` (`utils/boucleLiens.js`), le
**même** que celui de `reflowVehicle` : la pose et la détection ne peuvent plus diverger.

| Situation | Ce qui se passe |
|---|---|
| unité simple → unité simple | **inchangé** — tout le comportement historique |
| l'ancre est une **paire** | l'accroché est chaîné depuis la **dernière livraison de la paire** *(en S2 c'est l'accroché de la paire qui est livré en dernier — chaîner depuis l'autre ferait repartir le camion **encore chargé**)*, et le retour dépôt est cherché sur l'unité entière |
| l'accroché est une **paire** | **pas de rechaînage** : c'est le COUPLAGE (Q-F), qui exige `buildMutuChain`. La pose est conservée telle quelle, avec une cause nommée (`boucle_rejets_accroche_en_paire`) — plus jamais un rejet muet |

⚠️ **Une tournée à trois n'est ni étoilée ni créditée.** Les « km évités » compareraient la chaîne
d'**un** membre à la mission qu'il aurait faite seul : un chiffre faux, et faux vers le haut. Le
modèle de données ne sait pas encore attacher une économie à une tournée de trois dossiers
(**M3P** — architecture tranchée, cf. ADR 0010). **Le chaînage physique, lui, se fait normalement** :
c'est le partage « chaînage / qualification » du préalable ci-dessus.

#### ✅ P8 — le territoire d'une paire se juge sur SON ancre (arbitrage Louis 2026-08-13)

Quand l'ancre est une paire, elle a **deux** chargements et **deux** livraisons. Lesquels sont les
extrémités de la règle des zones ?

> **« C'est l'ancre de l'ancre qui définit les extrémités : c'est donc le `chg ANC` qui initie la
> mutualisation, et la `liv ANC` qui la termine. »**

Une paire se présente au territoire par les deux points de **son** ancre — le dossier vendu qui porte
la mission. L'accroché de la paire s'insère **dans** cette mission, il ne la redéfinit pas. C'est
cohérent avec la définition du segment porteur d'une mutualisation (`chg ANC → liv ANC`) et avec
l'invariant « le camion part du dépôt de l'ancre et y revient ».

🔑 **Deux questions à ne jamais confondre** — le code les distingue explicitement
(`lotAnc` vs `lotAncTerritoire`) :

| La question | La réponse | Nature |
|---|---|---|
| *où est le camion quand il repart ?* | la **dernière livraison** de l'unité | **physique** — c'est là qu'est le camion |
| *quel territoire l'unité occupe-t-elle ?* | les points de **son ancre** | **identité** — c'est la mission qui porte |

⚠️ **En séquence S2, ce n'est pas le même dossier** : la paire livre son accroché en dernier. Le
camion repart donc de chez lui, mais le territoire se juge ailleurs. Une paire dont le dossier livré
en dernier n'appartient à **aucune** zone forme désormais sa boucle si son ancre, elle, est bien à
cheval sur deux zones déclarées.

#### Le retour dépôt ne se réinvente pas à la détection (correctif β, 2026-08-13)

`buildChain` termine **toujours** par une rentrée au dépôt, sauf si on lui passe `skipRetourDepot` —
et `detectBoucles` ne le lui passait **jamais**. La chaîne rebâtie de l'accroché repartait donc avec
une rentrée que `reflowVehicle` venait délibérément de supprimer. Elle n'était retirée que si le lien
**suivant** se qualifiait à son tour ; sinon elle restait et **percutait le chargement du chantier
d'après** — deux dossiers dans le même créneau, sur le même camion.

**Le trou est structurel** : la POSE décide la rentrée avec `enchainementContinu` *(écart ≤ 1 jour
ouvré ET camion à pied d'œuvre)*, la DÉTECTION avec ses propres critères *(écart ≤ 3 jours, zones,
`seuilProxRetourKm` pour le seul rechaînage opportuniste depuis le 2026-08-19, Q15)*. Les deux ne coïncident pas, et **toute règle connue d'un seul des deux
rouvre le même trou**.

👉 **On ne re-tranche donc pas : on RELIT ce que la pose a décidé.** Si les blocs posés de l'accroché
ne portaient pas de retour final *(hors coupure du vendredi `_weekendDepot`, qui est un retour
**interne**)*, la chaîne est rebâtie avec `skipRetourDepot`.

### 🔴 DOUBLE COUPLAGE — les règles C1 → C7 (arbitrage Louis 2026-09-02)

Une tournée qui porte **une mutualisation ET un retour** — **trois lots**. Cadrage complet et
argumentaire : `docs/boucles/couplage-synthese.md` ; plan de marche : `docs/boucles/plan-dev-couplage.md` § 4.
✅ **Ces règles sont ARBITRÉES ET CODÉES** — Lot 4, tranches 4.0 → 4F, **livrées le 2026-09-07**
*(la mention « pas encore codées » datait du 2026-09-02 ; corrigée le 2026-09-10)*. Elles sont
tenues par `src/test/engine/tourneeATrois.4B4C.test.js`, `reglesTournee.4D.test.js`,
`acceptationDeuxTemps.4E.test.js`, `survieTournee.4E.test.js` et le harnais de compositions.
🔴 **Mais elles ne sont PAS EN PRODUCTION** : le travail vit sur la branche
`refonte/shadcn-tailwind`, poussée et jamais fusionnée — et **aucun œil n'a encore vu ces écrans
tourner**. En production tourne la version du 20/08/2026, qui ne connaît que les couplages à deux.

📛 **Vocabulaire** : le mot retenu est **LOT** — « dossier » et « chantier » sont abandonnés dans
l'interface, le code et la doc *(point U9)*.

**🔑 À trois lots, on construit un RETOUR.** Le segment porteur est le **retour à vide** ; la seule
différence avec un retour ordinaire est que **l'aller est une mutualisation**. Ce sont donc les
règles du **retour** qui gouvernent la greffe — gouvernance, territoire, budget de détour. Aucune
géométrie nouvelle : une tournée couplée, ce sont **deux greffes successives**, jugées emboîtées.

| # | Règle | Décision |
|---|---|---|
| **C1** | Taille maximale d'une tournée | **TROIS lots.** La forme à quatre est **hors périmètre** et rien ne doit la préparer — le refus de greffer une **paire derrière une mission** reste en place |
| **C2** | Comment une tournée se propose | **En deux temps** : la mutualisation est construite, **puis** le retour — ou l'inverse. Jamais les deux d'un même geste. **Les deux ordres sont ouverts** et mis en concurrence, le moteur retient la meilleure orientation |
| **C2 bis** | 🔑 Ce qu'on place | **On place TOUJOURS un lot seul.** Un lot en cours de placement ne peut pas être mutualisé : l'**accroché est toujours simple**, seule l'**ancre** peut être une paire. ✅ **Codée depuis le 2026-09-04** (`engine/boucleEngine.js`, ~ligne 1048 : un lot déjà relié rend un tableau vide de candidats) et tenue par quatre fichiers de tests. *(Ce commentaire disait « ni écrite ni contrôlée » ; corrigé le 2026-09-10.)* L'écran, lui, **désarme le bouton et dit pourquoi** plutôt que de laisser cliquer pour rien |
| **C3** | Qui accepte, et qui exécute | Chaque maillon **garde son régime** *(retour = accord explicite de l'agence · mutualisation régionale = implicite)*, et **le refus d'un maillon ne défait jamais le précédent**. 🔑 **Le 3ᵉ lot est donné à l'agence qui détient déjà l'ancre vendue — on ne donne jamais deux lots à une autre agence.** La tournée est exécutée par l'agence de la paire ; le propriétaire du 3ᵉ lot sous-traite (`_boucleRole: "porteur"`, badge *↗ Sous-traité*) |
| **C4** | Ce qui est tenu | **Q15 s'applique à chaque membre déjà vendu** de la paire, et la greffe **n'ouvre jamais la paire** : elle y entre en bloc, ou n'y entre pas. ⚠️ **Insécable ≠ figée** : les **dates de LIVRAISON de la paire ancre restent modifiables**, si elles ne sont pas verrouillées et **au sein de la fenêtre de flex** |
| **C5** | Retirer un membre | **On ne casse que ses propres liens** — jamais ceux des autres — **et la tournée est rejouée pour rapprocher ce qui reste**. Pas de trou laissé à la place du lot retiré. Le geste s'appelle « retirer un membre d'une tournée », plus « casser un lien » |
| **C6** | Capacité | Le plafond se vérifie **par segment chargé**, jamais sur le total des lots de la tournée. C'est déjà le comportement du code |
| **C7** | Week-end | **Q17 inchangée, absolue.** Aucun assouplissement pour un couplage. Mesuré : 100 % des tournées couplées traversent un week-end, **aucune à la jonction** *(échantillon de 2 cas)* |

**Garde-fous et classement — rien ne change de niveau** *(même arbitrage)* :
- **Pas de budget de détour de TOURNÉE.** Chaque greffe garde son budget (500 km) ; le cumul des deux
  greffes n'est pas plafonné. À revoir si les tournées à trois deviennent courantes.
- **Rendement par greffe**, comme aujourd'hui.
- **Le score n'est pas étendu** : on compare toujours un **accroché** à une **ancre**, que cette ancre
  soit un lot simple ou une paire. ⚠️ C'est délibéré — étendre le score rouvrirait le débat sur ses
  coefficients, qui était le principal risque du chantier.
- **Territoire** : la paire se présente par les deux points de **son** ancre (déjà codé, cf. P8).
- 🟠 **Ouvert** : le budget de détour de la **mutualisation** (500 km partagés, la mesure du 14/08
  disait 300) — question inscrite au registre, sans mesure engagée.

---

---

## 4. Chaînage & planification (`chainBuilder.js`)

- **Horaires** : 7 h–18 h, Lun–Ven. **Retour dépôt obligatoire le vendredi soir** (règle vendredi : tout
  bloc route qui ne tient pas avant vendredi 18 h est décalé au lundi).
- **RÈGLE LIVRAISON À DATE** (arbitrage 2026-06-10, remplace l'ancienne « livraison au plus tôt ») :
  - **Hors boucle, `dateL` est RESPECTÉE** : la livraison est posée **le jour demandé**. Le PL part
    **au plus tard** (juste-à-temps : il reste au dépôt entre le chargement et le départ de la route,
    disponible et conforme à la règle vendredi). Si `dateL` dépasse la fenêtre affichée → marqueur
    « (sem. suiv.) », jamais une livraison avancée sur la semaine courante.
  - **UNIQUE dérogation, hors boucle** (2026-08-01) : si — et seulement si — la tournée viole la règle
    week-end (Q17), la livraison peut être **avancée de 1 à 4 jours ouvrés** pour ramener le PL au
    dépôt avant la coupure. C'est le **remède 1 bis** de la § « Règle week-end », avec ses quatre
    garde-fous (dernier recours, borné, avance minimale, « jamais pire »). Un placement qui passe tel
    quel n'est **jamais** avancé.
  - **En boucle** (`opts.ignoreDateL`, simulations de `findBoucleCandidates`) : on optimise le trajet,
    livraison **au plus tôt dans la fenêtre** ; toute livraison anticipée est signalée
    (`_livraisonAnticipee`) et à confirmer client. Plus tard = borné par `dateL + flexLivraisonJours`.
  - `dateL` absente → livraison dès la fin de la route (same-day, fix B2).
  - Le warning « Arrivée tardive » ne s'affiche que si la livraison tombe réellement **après** la date
    demandée (comparaison de dates, plus d'index de fenêtre).
- **Chargement même jour** : un chargement qui tient en une journée n'est posé le jour même que si sa
  durée est **inférieure** aux heures ouvrées restantes ; sinon reporté au matin ouvré suivant.
  (Ex. livraison de l'ancre finit à 15 h → reste 3 h ; chargement de l'accroché = 3 h → l'accroché charge le lendemain.)
  Depuis le 2026-07-19 : appliquée aussi par `buildMutuChain` et par le rechaînage de
  `detectBoucles` (avant, un chargement pouvait être coupé sur 2 jours dans ces chemins).
- **Warning « Chargement décalé »** (2026-07-19, fix B6) : si la chaîne amont déborde et que le
  chargement démarre **après** `dateC` (la date promise au client), le bloc porte un warning ⚠ —
  symétrique du warning « Arrivée tardive » des livraisons. Rien ne glisse plus en silence.
- **Signal « camion chargé immobile »** (arbitrage Louis 2026-08-01, cas fondateur CHT-435739) —
  **remplace** l'alerte « camion chargé en attente hors dépôt avant départ » décrite juste en
  dessous, conservée ici pour la généalogie. Celle-ci testait un **lieu** (« le camion est-il loin
  de sa base ? ») et ne regardait qu'un seul trou, entre le chargement et le départ de la route.
  Deux gaspillages lui échappaient : ① le camion rentré **chargé** au dépôt pour le week-end
  (coupure Q17), exclu par construction alors que l'immobilisation est réelle et souvent évitable ;
  ② le camion **arrivé près du lieu de livraison** qui attend le jour promis — CHT-435739, route
  finie mardi 10h, livraison mercredi 7h, **8 h ouvrées** invisibles.
  - **Le critère mesure la chose qui COÛTE, pas la position** : le temps **ouvré** pendant lequel le
    camion, **chargé**, ne fait rien. Indifférent au lieu, il rend inutiles les anciennes exclusions
    (coupure dépôt, gap traversant un week-end) — un samedi ne compte pas parce qu'il n'est pas
    ouvré, non parce qu'on l'a exclu.
  - **Seuil : 4 h ouvrées** (`SEUIL_INACTIVITE_H`). La journée fait 11 h (7h-18h) : un bloc qui finit
    à 14h laisse exactement 4 h. « Plus de 4 h » se lit « le camion a fini avant 14h et n'est pas
    reparti », ce qui écarte de lui-même le résidu de fin de journée.
  - **Périmètre** : entre la fin du chargement et le début de la livraison. Un camion **vide** qui
    attend n'est pas immobilisé — il reste disponible pour autre chose.
  - **Dérivé de la chaîne RETENUE** (`marquerInactivite`, appelée depuis `buildChain`), et non
    calculé en cours de construction : il doit voir les temps morts nés **après** ce point (attente
    avant livraison, remède week-end appliqué plus tard).
  - **Constat / consigne** (distinction du 2026-07-31, conservée) : `_inactivite { heures,
    resserrable }` sur **chaque** temps mort dépassant le seuil (matière de diagnostic, gratuite) ;
    la consigne visible `_warning` *« Camion chargé immobile Xh — dates à resserrer »* seulement si
    le dossier est **resserrable** (`utils/resserrage.js`) **et** seulement sur le **plus gros** temps
    mort de la chaîne. Le signal est accroché au bloc qui **précède** le trou. **Pur signal** : aucun
    bloc, km ni date modifié.
  - **🔴 EXEMPTION — LE CHARGEMENT DU VENDREDI** (arbitrage Louis 2026-08-03). Charger le vendredi
    pour partir le lundi n'est **pas** un gaspillage : c'est un **choix** du planificateur — le
    client déménage le vendredi, la route se fait la semaine suivante. Compter les heures ouvrées du
    vendredi revenait à afficher « dates à resserrer » sur une pratique qu'il ne faut justement pas
    resserrer. Ce temps mort n'alimente donc **ni le constat, ni la consigne** : la situation est
    délibérée, elle n'a pas à peupler le diagnostic non plus.
    **Trois conditions, ensemble** : ① le trou commence à la fin d'un **chargement** ; ② un
    **vendredi** ; ③ il **traverse le week-end**, la route chargée (`trs`/`bou`) n'ayant pas encore
    commencé. Le `vid` de collecte entre deux chargements mutualisés ne compte pas comme un départ
    de route — les deux dossiers sont chargés le vendredi, le camion part le lundi, même pratique.

    | Situation | Verdict |
    |---|---|
    | Chg vendredi 8h→12h · route lundi 7h | **exempté** — c'est la pratique voulue |
    | Retour dépôt (`vid`, coupure Q17) fini vendredi 13h · route lundi 7h | ~~signalé~~ → **plus signalé** depuis le 2026-09-16 (cf. ci-dessous) |
    | Retour dépôt fini vendredi · route **mardi** | **signalé** — le **lundi seul** est compté, jamais le vendredi après-midi |
    | Route finie vendredi 10h · livraison lundi 7h | **signalé** (la route a commencé) |
    | Route finie jeudi 10h · livraison lundi 7h | **signalé**, jeudi **et** vendredi comptés |

    - **🔁 RENVERSÉ le 2026-09-16 (arbitrage Louis : « retirer le message si on est le vendredi : il
      rentre au dépôt »)** — un temps mort qui **commence un vendredi** et **passe le week-end**, route
      chargée non commencée, ne compte plus son vendredi après-midi : seules les heures ouvrées
      **après** le week-end entrent dans le calcul. Cas qui déclenchaient à tort : CHT-056466 (11/09) et
      CHT-513380 (23/10) — chargement puis retour dépôt le vendredi, route le lundi. **Signal
      seulement** : la barrière `ecartMaxH` de la mutualisation (`attenteMaxCollecte`, qui partage
      l'exemption du chargement) n'est **pas** modifiée.
    *(Côté API, la règle ⑥ de `scripts/diag.sql` cherchait encore `'%attente hors dépôt%'`, libellé
    que le moteur n'écrit plus depuis le renommage du 2026-08-01 : elle ne matchait donc jamais.
    Recalée sur `'%immobile%'` le 2026-08-03.)*
- ~~**Alerte « camion chargé en attente hors dépôt avant départ »**~~ (Option A, arbitrage Louis
  2026-07-23, cas CHT-245530) : conséquence directe du « départ au plus tard » ci-dessus. Hors boucle,
  quand la route est repoussée d'une ou plusieurs **nuits de semaine** après la fin du chargement, le
  PL reste **chargé, immobile, encore près de sa base** (le moteur « téléporte » entre chg et route).
  Le bloc route porte alors un warning ⚠ *« Camion chargé en attente N nuits hors dépôt — dates à
  resserrer »*. **On signale, on ne modélise pas** : option B (retour dépôt + re-départ) écartée pour
  ne pas gonfler les km ni risquer une régression sur `buildChain` ; le vrai correctif viendra de
  l'optimisation des dates (OR-Tools). **Aucun changement de km, de dates ni de blocs.** À ne PAS
  confondre avec la **coupure week-end** (`_weekendDepot`) : ici nuit de semaine, PL hors dépôt ; là
  le PL rentre chargé à sa base pour le week-end. Les gaps traversant un week-end sont exclus (déjà
  couverts par la garde week-end). Remonte aussi en **section 4 du diag** (règle ⑥).

  **Recadrage 2026-07-31 (arbitrage Louis) — le message n'apparaît que s'il est actionnable.**
  Deux défauts de la première version : le texte était identique pour 1 nuit et pour 5 (or c'est la
  durée de l'immobilisation qui décide s'il faut agir), et il réclamait de « resserrer les dates »
  y compris sur un dossier **verrouillé**, dont le chargement est intouchable (Q15). Une consigne
  qu'on ne peut pas suivre use l'attention pour rien. Désormais :
  - le bloc route porte toujours un **constat** structuré — utile au diagnostic même quand rien
    n'est affiché ;
  - la **consigne visible** (`_warning`) n'est émise que si le dossier est **resserrable** :
    déverrouillé **et** disposant encore de flex vers le tard. Sinon : aucun message.
  - « Resserrable » se calcule dans `utils/resserrage.js` (`margeChgVersTard`). Piège à connaître :
    la fenêtre de flex est ancrée sur la date **souhaitée** par le client (`dateCSouhaitee`), pas
    sur la date planifiée — un dossier déjà poussé au bout de sa fenêtre a bien `_flexC > 0` mais
    **plus un jour de marge réelle**.
- **Signal « nuits hors dépôt en semaine »** (arbitrage Louis 2026-07-29, **refondu le 2026-07-31**)
  — `nuitsHorsDepot()` / `datesNuitHorsDepot()`, fonctions **sœurs** de `chaineTraverseWeekend` :
  même découpage de la chaîne en segments **dépôt → dépôt**, mais on compte cette fois les **nuits
  de semaine** passées loin de la base avant le retour.
  ⚠️ **Ce n'est PAS une contrainte, contrairement à Q17.** Une nuit dehors en semaine est légitime sur
  longue distance (Rennes → Marseille ne rentre pas dans la journée) : **rien n'est jamais bloqué**,
  c'est un **signal** que le planificateur juge. Le passage vendredi → lundi n'est **jamais** compté :
  il relève de Q17, qui l'interdit déjà.

  **Ce qui a changé le 2026-07-31 :**
  - **L'alerte au placement est SUPPRIMÉE.** La modale s'ouvrait dès la 1ʳᵉ nuit dehors, à chaque
    pose. Sur longue distance cette nuit est **physiquement inévitable** : l'interruption
    n'apprenait rien et coûtait un clic. Le réglage `alerteNuitsMin` est retiré des règles.
    *(Le composant est repris le jour même sous le nom `DebordementModal` pour le cas inverse —
    cf. « Plage horaire élargie » ci-dessous.)*
  - **L'affichage passe du bloc à la soirée.** Le badge agrégé « X nuits hors dépôt » posé sur le
    **premier bloc** du segment est remplacé par une ligne **« 🌙 nuit hors dépôt » au bas de chaque
    journée concernée** (`PlanningCell`, classe `of-cell-nuit`). Deux raisons : le badge s'affichait
    là où le camion est encore **à sa base**, et surtout un badge accroché à un bloc **ne peut rien
    dire des journées sans bloc** — or un camion chargé le lundi dont la route ne part que le jeudi
    n'a aucun bloc mardi et mercredi. Les deux nuits les plus coûteuses étaient les seules invisibles.
  - **Le signal n'est plus gravé dans les blocs**, il est **dérivé à l'affichage**
    (`datesNuitHorsDepot` rend un ensemble de dates de soirée). Un signal persisté dans
    `placements` survivait à la tournée qui l'avait produit, et restait affiché après un reflow qui
    l'avait rendu caduc.
  - **Aucune todo.** L'idée d'un rappel « resserrer les dates » a été **écartée** (ni enregistrée,
    ni recalculée) : le besoin n'entre dans aucune des deux formes de todo existantes. Conservé
    comme piste dans `specs/todos-et-notifications.md` § 5, en vue de la refonte des todos.
- **PLAGE HORAIRE ÉLARGIE, JOURNÉE PAR JOURNÉE** (arbitrage Louis 2026-07-31, lot 2 ; **portée
  ramenée à la JOURNÉE le 2026-08-03**). La journée ouvrée 7h-18h reste la norme. Une journée peut
  exceptionnellement l'élargir — **départ dès 5h, fin jusqu'à 21h** — pour éviter de perdre une
  journée entière sur un reliquat de 2-3 h. Réglé dans la fiche dossier ; champs absents = journée
  standard.

  **Ce que « élargir » veut dire, exactement** : toute la journée concernée, **manutention chez le
  client comprise** (arbitrage explicite : le planificateur active ce réglage et en voit le résultat
  sur le Gantt). En **mutualisation**, la plage retenue est l'**INTERSECTION** des deux dossiers,
  **prise jour par jour** — l'autorisation d'un client ne doit pas imposer un horaire élargi à
  l'autre.

  **🔴 EN MUTUALISATION, LE RÉGLAGE S'ÉCRIT DES DEUX CÔTÉS** (arbitrage Louis 2026-08-04, cas
  fondateur CHT-435739 ⇌ CHT-604970). La règle d'intersection ci-dessus est saine et **ne bouge
  pas** ; ce qui ne l'était pas, c'est que l'**interface** laissait régler **un seul** des deux
  dossiers. Le réglage partait bien en base, puis l'intersection le ramenait silencieusement à
  7h-18h : enregistré, puis neutralisé, sans le moindre message. Sur le cas réel, « dès 6h » suivi
  de « ↻ Recalculer » ne produisait **rien** — impasse totale, le dossier partenaire étant de
  surcroît verrouillé (la fiche masquait alors tout le bloc « plage horaire », voir ci-dessous).
  - **Point d'application unique `utils/plagesMutu.js`** — tout chemin qui écrit une table
    `plagesParDate` passe par `appliquerPlagesMutu` / `propagerPlagesMutu` (fiche dossier, modale de
    débordement, simulation, pose), de sorte qu'aucun ne puisse rediverger. Même motif que
    `utils/datesBoucle.js`.
  - **Réservé à la MUTUALISATION DÉCIDÉE** (`partenaireMutu` : `_boucleType === "mutualisation"` +
    `boucleDecidee`). Deux dossiers simplement posés à la suite sur un camion ne partagent aucune
    journée par contrat. Une boucle **RETOUR** n'est pas concernée non plus : l'accroché charge
    **après** la livraison de l'ancre, les deux ne se partagent donc pas une journée de travail.
  - **Dit avant d'être fait** : la fiche et la modale de débordement **nomment le client partenaire**
    et annoncent que l'élargissement vaudra pour les deux dossiers ; la fiche liste en outre les
    journées **réglées d'un seul côté** (`journeesSansEffet`, lues sur l'état **réel** des deux
    tables et non sur un drapeau posé à l'écriture) — tant qu'elles subsistent, l'élargissement
    affiché ne produit rien sur le Gantt.
  - ⚠️ **Le verrou du dossier ne ferme pas ce réglage** : le verrou porte sur les **dates promises**
    au client, pas sur l'amplitude horaire. Masquer le bloc sur un dossier verrouillé rendait le
    réglage inatteignable dès que le partenaire était figé — c'est-à-dire dans le cas où l'écriture
    à deux est justement nécessaire. Rien n'est perdu pour autant : enregistrer relance le recalcul,
    qui demande confirmation si une date de chargement promise ne peut plus être tenue.

  **🔴 UNE PLAGE PAR DATE, PAS PAR DOSSIER** (2026-08-03). Le réglage était porté par le dossier
  entier : autoriser un dépassement pour absorber le reliquat d'**une seule** journée élargissait du
  même coup **toutes** les autres, y compris celles qui n'en avaient aucun besoin. Le dossier porte
  désormais `lot.plagesParDate = { "AAAA-MM-JJ": { debut, fin } }`.
  - **Cascade de repli** : date réglée → sa plage ; date non réglée → `plageDebut`/`plageFin` du
    dossier ; sinon `PLAGE_STD`. `plageDebut`/`plageFin` sont **conservés** : les dossiers déjà en
    base fonctionnent à l'identique.
  - **Aucune migration SQL** — comme `plageDebut`/`plageFin`, le champ n'a pas de colonne et transite
    par le résidu JSONB `lots.extra` (mécanisme `_self_check`, `onefleet-api/app/domain/shred.py`),
    verrouillé par un test de round-trip côté API.
  - **Implémentation** : résolveur `plagesDuLot(lot)` / `plagesCommunes(acc, anc)`, lu par
    l'adaptateur unique **`plageAt(plage, day, weekDays)`**. Le résolveur **se lit comme une plage
    plate** (spread de l'enveloppe), ce qui permet à toute signature publique — et à tout appel
    externe passant une plage plate — de continuer à fonctionner. Les primitives qui itèrent jour par
    jour (`snapToWorkingHours`, `reculerHeuresOuvrees`, `scheduleBlock`, `splitByDay`,
    `heuresOuvreesEntre`) résolvent **dans** leur boucle, jamais avant.
  - ⚠️ **`plageEstStandard` regarde l'enveloppe ET la table.** Un dossier resté en 7h-18h mais dont
    une seule journée est élargie doit passer par la garde « jamais pire » (ci-dessous) — un simple
    test `debut === 7 && fin === 18` sur l'enveloppe la ferait **sauter**.
  - **Convention d'écriture** : une journée revenue à 7h-18h est **retirée** de la table, jamais
    enregistrée en dur ; table vide ⇒ champ supprimé. Un dossier ordinaire ne doit pas traîner de
    réglage qui le ferait passer pour une exception.
  - **Dates orphelines** : si la mission glisse, une entrée porte une date qui n'est plus dans la
    tournée. Elle est **inerte** (le résolveur ne la trouve jamais). La fiche les liste **à part, en
    grisé**, avec un bouton pour les retirer — on ne supprime pas en silence un réglage saisi par un
    humain.
  - **Reprise des anciens dossiers** : à l'ouverture de la fiche, un dossier portant `plageDebut`/
    `plageFin` voit ce réglage **repris journée par journée** dans les lignes affichées (sinon la
    fiche annoncerait « dès 7h » pendant que le moteur ouvre à 5h). « Appliquer » convertit le
    dossier sur le réglage par date **sans rien changer au planning**, et solde l'ancien champ.

  **🔴 LA RÈGLE STRUCTURANTE — le moteur de boucles ne voit JAMAIS l'élargissement.** Une boucle ne
  doit pas exister *parce qu'*un dépassement du soir a été autorisé sur un dossier. Concrètement :
  la plage n'est lue que si l'appelant passe `opts.appliquerPlageLot`, et **seule la POSE** le fait
  (`reflowVehicle`, plus le wrapper d'auto-placement). `findBoucleCandidates` et `detectBoucles`
  appellent les planificateurs en direct et raisonnent donc toujours en 7h-18h, tout comme les
  contrôles dérivés (`workHoursBetween` / `ecartMaxH`, `joursMinLot`, `checkRetourBase`).
  ⚠️ **Ne jamais mettre ces valeurs dans `rules`** : `joursMinLot` et `checkRetourBase` lisent
  `rules.dayStart`/`dayEnd`, ce qui contaminerait le scoring des boucles sans rien casser de
  visible.

  **🔴 GARDE-FOU « JAMAIS PIRE » — Q17 reste inviolable.** En principe, élargir la journée ne peut
  que RACCOURCIR une mission, donc `chaineTraverseWeekend` ne peut passer que de vrai à faux. Ce
  raisonnement a une faille étroite : la boucle « route au plus tard » cherche le *dernier* jour de
  départ possible, et des journées plus longues peuvent rendre un départ plus tardif acceptable —
  d'où un retour au dépôt qui glisserait d'un jour. Plutôt que de démontrer l'invariant, **on le
  vérifie à l'exécution** : `buildChain`/`buildMutuChain` construisent les DEUX chaînes (standard et
  élargie) et ne retiennent l'élargie que si elle ne dégrade ni le week-end ni l'heure de fin.
  Coût : une construction de plus, uniquement sur les dossiers élargis. **Ne pas « simplifier »
  cette garde** — c'est elle qui empêche un dépassement autorisé de laisser un PL dehors le
  week-end.
  Les valeurs aberrantes retombent sur la journée standard (`normaliserPlage`) ; la fin est
  **plafonnée à 23h**, parce que `fromAbs` déduit le jour d'une division par 24 et qu'une fin à 24h
  ferait basculer les blocs au lendemain en silence.

  **Visible, jamais silencieux** : tout bloc qui déborde de 7h-18h porte `_horsPlageStd` et affiche
  « ⏱ hors 7h-18h » sur le Gantt. **L'heure de démarrage ne se retouche plus bloc par bloc**
  (arbitrage Louis 2026-08-04) : `EditBlockModal` — la modale qui s'ouvrait au clic sur un bloc —
  est **supprimée**, son sélecteur d'heure faisait doublon avec le réglage de plage horaire du
  chantier, en pire (une retouche du **résultat** du calcul, écrasée sans prévenir au recalcul
  suivant, là où la plage du dossier est une **règle** relue par le moteur). Le clic sur un bloc
  chargement / livraison ouvre désormais la **fiche détail du chantier**, seul endroit où la plage
  se règle — journée par journée. ⚠️ Cette modale portait aussi le **verrouillage des dates**
  (« 🔒 Enregistrer & verrouiller livraison ») — le **seul** geste du produit permettant de figer un
  chantier depuis le planning. Il déménage dans la fiche (`onLockLot`), avec le reste des réglages
  du dossier ; le supprimer avec la modale aurait retiré une capacité métier au passage.
  *(Historique : la liste d'heures de cette modale était bornée à
  7h-17h30 en dur et **ramenait un bloc du soir à 7h à l'enregistrement**, sans rien signaler ;
  corrigée le 2026-07-31, puis alignée sur la plage de la journée le 2026-08-03.)*

  **🔴 L'HEURE DE DÉBUT DE JOURNÉE EST CELLE DE LA PREMIÈRE ACTIVITÉ** (arbitrage Louis 2026-08-03),
  quelle qu'elle soit — approche, route ou chargement. `reflowVehicle` construisait son curseur de
  départ avec `DAY_START` (7) **codé en dur** ; comme `buildChainInterne` privilégie
  `opts.startCursorAbs`, la branche qui lit la plage n'était **jamais empruntée depuis la pose**.
  Seul l'auto-placement en bénéficiait : un dossier réglé « départ dès 5h » voyait donc son
  **approche** partir quand même à 7h alors que les journées suivantes démarraient bien à 5h — d'où
  le constat terrain « ça se règle sur le chargement mais pas sur l'approche ».
  ⚠️ Ce n'est **pas** une avance de départ destinée à faire tomber le chargement à 7h : l'arbitrage
  **Q13** (« l'approche est posée le jour du chargement ») reste **NON**. On honore l'heure réglée,
  rien de plus.
- **Alerte « ce chantier déborde d'une journée »** (`DebordementModal`, 2026-07-31). Se déclenche à
  la pose quand la mission du dossier occupe **au moins deux jours** et que son **dernier jour** ne
  porte qu'un reliquat ≤ `reliquatMaxH` (3 h, **route et retour dépôt compris**). C'est le seul cas
  où le planificateur dispose d'un levier immédiat — et donc la seule alerte de placement restante
  depuis le retrait de l'alerte « nuit dehors ».
  **Trois leviers au même endroit** : équipe (ETP), durées de manutention, et plage horaire. Quand
  les deux durées sont **déjà au minimum** (`manutMin`, 2 h), les réglages d'équipe sont **masqués** —
  proposer une marge inexistante fait perdre du temps ; seul l'élargissement reste. Si **aucun**
  levier ne subsiste (manutention au plancher ET journée déjà à 5h-21h), l'alerte **ne s'ouvre pas du
  tout**. Jamais bloquante : « Placer quand même » est toujours offert.
  **La journée élargie est NOMMÉE** (2026-08-03) : la modale disait « élargir la journée » sans
  jamais préciser laquelle, et le réglage portait sur le dossier entier. Elle cible désormais **la
  dernière journée PLEINE** (`jourACibler` = l'avant-dernière de la mission) — c'est son
  élargissement qui absorbe le reliquat ; élargir la journée *de trop* ne servirait à rien, c'est
  justement celle qu'on veut supprimer. Un `<select>` des journées de la mission permet d'en changer
  si le premier recalcul ne suffit pas, et les journées déjà réglées sont conservées.
  ⚠️ `plageAuMaximum` (le test « plus aucun levier ») s'apprécie sur **la journée ciblée**, pas sur
  le dossier — sinon la modale refuserait de s'ouvrir alors qu'il reste tout le levier sur cette
  journée-là.

  **🔴 LA JOURNÉE DE TROP SE CHERCHE AUX DEUX BOUTS** (arbitrage Louis 2026-08-04, cas fondateur
  CHT-435739). La détection ne regardait que la **dernière** journée. Sur ce dossier elle ne disait
  donc rien : la dernière journée porte 5 h de retour à vide, et la journée de trop est en **amont**
  — une heure d'approche le jeudi soir pour charger le vendredi matin. La règle est désormais
  symétrique, et la décision vit dans un module pur, `utils/debordement.js` :
  - **AVAL** *(cas d'origine)* — dernière journée réduite à un reliquat ⇒ élargir l'**avant-dernière**
    (la dernière journée pleine), par la **fin**.
  - **AMONT** — première journée réduite à un reliquat ⇒ élargir la **suivante**, et par le **DÉBUT**
    (le sélecteur de fin de journée n'a rien à y faire, la modale ne l'affiche pas).
  - **L'aval passe en premier** quand les deux se présentent : c'est le comportement historique, et
    rien ne justifie de le changer au passage.
  - ⚠️ **GARDE-FOU ANTI-BRUIT, réservé à l'amont** : partir la veille est fréquent, et c'est
    souvent le **bon** choix. La modale ne s'ouvre donc que si l'élargissement **maximal** offert par
    l'interface (5h) fait **réellement** disparaître la journée en trop — re-mesuré avec le même
    estimateur que la pose (`mesurerElargi`), jamais avec un second calcul. **Pas de gain démontré,
    pas de modale.** Le cas aval garde son comportement d'origine : sa journée de trop est en fin de
    mission, où le seul fait de la signaler a déjà de la valeur.
  - **C'est une PROPOSITION D'OPTIMISATION**, jamais un avertissement, jamais un blocage — le
    vocabulaire de la modale le dit (« Proposition — ce placement reste tout à fait valable »,
    « À toi de voir : partir la veille reste un choix parfaitement valable »).
  - En **mutualisation**, la modale nomme le client partenaire et prévient que l'élargissement vaudra
    pour les deux dossiers (cf. § plage horaire, « le réglage s'écrit des deux côtés »).
- **ÉQUIPE (ETP) ET DURÉES DE MANUTENTION, MODIFIABLES DEPUIS LA FICHE** (arbitrage Louis
  2026-08-04). Ces deux réglages n'étaient plus modifiables **nulle part** sur un chantier déjà
  posé : la modale de débordement ne s'ouvre qu'**au moment du placement**, et seulement en cas de
  débordement. Ils reviennent dans la fiche du dossier, à leur place — c'est une donnée d'**entrée**
  relue par le moteur à chaque calcul, pas une retouche du résultat posé (à l'inverse exact de
  l'ex-`EditBlockModal`). Chargement et livraison s'enregistrent **d'un seul geste**, donc un seul
  recalcul de la tournée. Le **verrou ne ferme pas ce réglage** (il porte sur les dates).
  ⚠️ **L'ÉQUIPE PILOTE LA DURÉE** — mécanique commune aux deux endroits, extraite dans
  `components/LigneManutention.jsx` pour qu'elles ne divergent pas : le moteur n'utilise l'équipe
  **que** si aucune durée n'est saisie (`parseDur(lot.dureC) || manutFallback(...)`). Renforcer
  l'équipe sans toucher la durée n'aurait donc **aucun effet** sur le calendrier — le levier serait
  un leurre. On répercute l'équipe sur la durée, comme le formulaire de saisie le fait à la
  création ; la durée reste ensuite modifiable à la main, et c'est elle qui fait foi. Une durée
  vide vaut « Auto » et est **retirée** du dossier plutôt qu'enregistrée en `""` — une chaîne vide
  en base laisserait croire à une durée saisie.
- **Le point de départ affiché d'une route décrit le TERRAIN, pas l'état interne du moteur**
  (retour terrain 2026-07-29, cas CHT-85865). Quand le chargement est à portée du dépôt
  (≤ `seuilRoute`), la coupure week-end est créditée **sans bloc `vid`** — le camion ne roule rien.
  Le bloc route annonçait pourtant « départ : Dépôt X », et le parcours affichait un arrêt dépôt
  fantôme juste après le chargement. `_from` ne bascule désormais sur le dépôt que dans la branche
  où la rentrée est **effectivement roulée** (`ptRouteDepart`). Le **calcul** des km reste inchangé
  (départ dépôt) : l'écart est borné par `seuilRoute` (15 km) et y toucher ferait bouger les
  kilomètres évités de toutes les boucles. **Règle générale** : `_from`/`_to` décrivent le
  déplacement réel, jamais une écriture du planificateur.
- **Approche posée le jour du chargement** (arbitrage Q13, 2026-07-19 : **confirmé, pas de
  changement**) : le PL part de son dépôt à 7 h le jour de `dateC` ; l'approche consomme les
  premières heures de la journée de chargement. Pas de départ anticipé la veille.
- **Ajustement dates en boucle** : ordre de mobilité **LIV ACC › LIV ANC = CHG ACC › CHG ANC (jamais)** ;
  compaction de la tournée si l'ancre non verrouillé et gain réel sur LIV ACC (cf. « Ajustement des dates
  (RETOUR) — compaction de la tournée », plus haut).
- **Reflow d'un PL** (`reflowVehicle`) : reconstruit toute la chaîne du PL puis applique `detectBoucles`.
  Entre deux lots, le **retour dépôt n'est sauté** (repositionnement direct) **que s'il n'y a pas de
  week-end** entre la livraison du 1er et le chargement du 2ᵉ. Sinon le PL **rentre au dépôt** et le lot
  suivant **repart du dépôt**. **Limite connue** (2026-07-19, I2) : pas d'heuristique « dépôt sur
  le chemin » — en semaine, le PL enchaîne toujours en direct, même si son dépôt est sur la route.
- **Un placement adjacent (hors boucle) ne décale jamais un chantier voisin** (arbitrage Louis,
  2026-07-23, cas CHT-245530 / CHT-338559). Comme le reflow **trie les lots du PL par `dateC`**, ajouter
  un dossier peut repousser le chargement d'un chantier **déjà posé** dont la date est postérieure (cas
  réel : CHT-245530 chargé le 1ᵉʳ décalé 09-07 → 09-08 par l'ajout de CHT-338559, chg 09-04). Or
  `findAvailablePLs` propose un PL dès qu'il est libre **le seul jour de chargement** du nouveau lot
  (`isPLAvailableOnDate`) et ne voit pas ce décalage. **Règle : seule la construction d'une boucle**
  (retour / mutualisation) a le droit de déplacer un autre CHT — un placement simple qui décalerait un
  voisin **est refusé** (le PL n'aurait pas dû être proposé). Contrôle : `simulateShiftsOtherLot`
  (`OneFleet.jsx`) rejoue le reflow avec le lot ajouté, compare le chargement **avant / après** de
  chaque voisin, et **refuse** (toast rouge) dans `handleLocalAssign`, `handleFinalize` **et le
  drag-drop manuel inter-PL** (`handleMoveLotToPL`) si un voisin recule. Seuls les flux boucle
  (`handleSuggestionPlace`, mutualisation) gardent le droit de décaler un autre CHT.
- **JAMAIS DE SUPPRESSION SILENCIEUSE** (arbitrage 2026-06-10, fix « lots disparus ») : un reflow ne
  fait **jamais disparaître un lot** du PL. Un lot dont la date est hors de l'axe de calcul n'est pas
  rechaîné : ses blocs existants sont **conservés tels quels** (leurs dates ISO restent justes ; le
  rendu est indexé par date). ➡️ **Règle à reprendre telle quelle dans le futur backend** : tout
  recalcul de segments doit préserver l'ensemble des lots affectés ; un débord de fenêtre se signale
  (marqueur/flag overflow), il ne se supprime pas.
- **Distances** : haversine + facteur correctif. Cohérence interne OK, sous-estime ~25–30 % vs Google Maps
  (affecte l'affichage, pas le scoring). OSRM prévu en V1.2+.

### Nuit entre deux chantiers — le PL rentre dormir au dépôt (arbitrage Louis 2026-08-03)

**Règle** : quand une **nuit** s'intercale entre la fin d'un chantier et le départ du suivant, le PL
**rentre au dépôt** — sauf s'il est **déjà à pied d'œuvre**, c'est-à-dire à moins de
`seuilResterSurPlaceKm` (80 km) de son prochain chargement. Deux garde-fous complètent la règle :

1. **Le dépôt plus près l'emporte** — si le dépôt est plus proche du point de livraison que ne l'est
   le prochain chargement, le PL rentre quand même : rentrer ne coûte presque rien et l'équipage
   dort chez lui. Non paramétrable.
2. **Faisabilité** — le retour doit tenir avant la fin de la journée. Un PL qui ne rentrerait que le
   lendemain matin resterait sur place : il aurait cumulé la nuit dehors *et* la matinée perdue.

**Ce qui était faux (diag CHT-829278)** : `enchainementContinu` ne regardait que le **calendrier**.
« Livré mercredi, rechargé jeudi » suffisait à conclure « enchaînement continu » et à supprimer le
retour dépôt. Le camion, **vide**, passait la nuit à 82 km de sa base pour repartir le lendemain
vers un chantier situé à 494 km — alors que le dépôt était **sur la route** : l'enchaînement direct
coûtait **62 km de plus** (494 contre 82 + 432) et une nuit dehors. « Continu » doit vouloir dire
« il repart dans la foulée », pas « il attend 17 h sur place ».

Un écart de **0 jour** (deux chantiers le même jour) reste un enchaînement inconditionnel : sans
nuit intercalée, il n'y a rien à arbitrer. **Q17 reste au-dessus de tout** : un week-end intercalé
impose le retour dépôt, quelle que soit la proximité du chantier suivant.

**L'écart se mesure depuis la livraison RÉELLEMENT POSÉE, pas depuis la date prévue (correctif
2026-09-15).** `reflowVehicle` jugeait l'écart sur la `dateL` du lot qui termine l'unité. Or la chaîne
construite livre parfois plus tard : en **mutualisation**, la livraison de l'ancre glisse d'un jour
pour laisser passer celle de l'accroché (accepté, non persisté) ; sur un **lot seul**, quand un voisin
le fait arriver en retard. L'écart paraissait de deux jours au lieu d'un : pas de retour du soir, donc
pas de repli « reste sur place », le camion rentrait au dépôt et repartait charger le lot suivant
plusieurs jours après sa date vendue. Cas fondateur (vivier SharePoint oct.-nov.) : paire
L0005+L0112 livrée le 07/10 (prévu 06/10), retour L0126 décidé le 08/10 **posé le 09/10** — tournée à
trois « décidée non tenue ». La pose relit donc sa chaîne, comme la proposition le fait déjà
(`findBoucleCandidates` accroche le lot suivant à la dernière livraison simulée) : décision nominale
d'abord, puis **reconstruction** si la fin réelle change la décision, retenue seulement si elle est
**stable**. 🔴 **Q17 prime** : si la fin réelle laisserait le camion sur place alors que la date
prévue le faisait rentrer, le lot suivant est rejoué depuis la livraison, et la rentrée est
**conservée** dès qu'il passerait un week-end hors dépôt (un lot qui ne part pas du dépôt est posé sans
garde week-end). Point d'application unique : `poserSurFinReelle` (`engine/boucleEngine.js`).

> ✅ **Q20 — tranchée à titre PROVISOIRE (Louis, 2026-08-18) : « fais primer les 80 km ».** La
> question reste **ouverte** dans `docs/decisions/questions-ouvertes.md` — ce n'est pas une clôture
> définitive, le réglage est pensé pour être facilement réversible. Avant cet arbitrage,
> `reflowVehicle` se terminait par `detectBoucles`, qui **rechaînait** deux chantiers distants de
> moins de `seuilProxRetourKm` (300 km — ⚠️ ce seuil ne forme plus de boucles depuis le 2026-08-19,
> il ne pilote plus QUE ce rechaînage, et sa valeur reste à statuer, **Q21**) — retour dépôt supprimé, chantier suivant repris depuis la
> livraison — et ce **qu'une boucle soit décidée ou non** (§3, « le chaînage est inchangé, décision
> ou pas »). Entre **80 et 300 km**, c'était donc ce rechaînage qui décidait et le PL dormait dehors,
> alors que — contrairement au cas CHT-829278 — il y gagnait de vrais kilomètres (le dépôt n'est
> plus sur la route). **Depuis le 2026-08-18**, `detectBoucles` refuse ce rechaînage dès qu'une nuit
> s'intercale et que le PL n'est pas à pied d'œuvre pour l'accroché — **dans les deux cas, boucle
> décidée ou rechaînage opportuniste** : le code sépare explicitement chaînage (physique,
> indépendant de la décision) et qualification (badge ★ / km évités, réservée à la décision), donc
> un rechaînage décidé fait rouler le camion à vide exactement comme un rechaînage opportuniste —
> rien ne distingue les deux du point de vue d'où dort l'équipage, ce qui est la preuve retenue pour
> appliquer la primauté des 80 km dans les deux cas plutôt que dans un seul. Piloté par
> `seuilResterSurPlaceKm` seul (aucune clé de réglage ajoutée) — pour revenir en arrière, retirer le
> bloc commenté « Q20 » dans `detectBoucles` (`src/engine/boucleEngine.js`). Comportement verrouillé
> par test (`nuitEntreChantiers.test.js`, dernier cas, **basculé** le 2026-08-18) et par les trois
> régimes (sous 80 km / 80-300 km / au-delà de 300 km). Ce changement **fait perdre des kilomètres
> dans certains cas** (Rennes 142 km, Brest 259 km) — assumé, c'est un arbitrage social autant
> qu'économique.

### Nuit à portée du dépôt, À L'INTÉRIEUR d'une chaîne (arbitrage Louis 2026-08-19)

**Règle** : dès qu'une **nuit d'inactivité** s'intercale dans la chaîne d'un chantier et que le PL
se trouve alors à **≤ `seuilResterSurPlaceKm` (80 km)** de son dépôt, il **rentre y dormir**. La nuit
n'est plus comptée « hors dépôt », et les kilomètres de l'aller-retour sont ajoutés à la tournée.

**Ce qui était faux (diag CHT-774981)** : la règle « à pied d'œuvre » ci-dessus ne joue qu'**ENTRE
deux chantiers** (`enchainementContinu`). À l'**INTÉRIEUR** d'une chaîne, rien ne regardait la
position du camion : `buildChain` n'insère un passage au dépôt que pour la **coupure du week-end**
(Q17). Un PL qui terminait sa route à Nantes (44000) le mercredi à 17h pour livrer le jeudi à 7h
passait donc la nuit dehors **à 9 km de sa base**, et le signal « nuit hors dépôt » l'affichait comme
tel. Aucun planificateur ne ferait ça.

**Portée** — TOUTES les nuits d'inactivité de la chaîne, pas seulement celle qui suit la route :
approche → chargement, chargement → départ de la route (attente « juste-à-temps », qui peut durer
plusieurs jours), arrivée de la route → livraison, livraison → retour. En revanche une nuit passée
**au milieu d'un trajet** n'en est pas une : le camion roule encore, il est réellement dehors.

**Modélisation — « km comptés, aucun bloc décalé »** : le trajet du soir et celui du matin se font
**hors plage de travail**, ce qui est la réalité d'un équipage qui rentre chez lui. Le moteur ne crée
donc **aucun bloc** et ne touche à **aucun horaire** : la nuit est créditée au dépôt (marqueur
`_nuitDepot`) et les km de l'aller-retour sont portés par le bloc qui clôt la journée, lus par le KPI
via `kmNuitsAuDepot`. Conséquence **voulue** : aucune date ne peut bouger, donc la garde
« jamais pire » n'a rien à arbitrer et **Q17 est hors d'atteinte**.

> ⚠️ `chaineTraverseWeekend` ne lit **délibérément pas** `_nuitDepot` : la garde week-end garde ses
> propres remèdes, on ne l'assouplit pas par ce biais. Verrouillé par test
> (`nuitAuDepot.test.js`, section « Q17 reste intacte »).

Implémentation : post-passe `marquerNuitsAuDepot` (`src/engine/chainBuilder.js`), appelée par
`buildChain` **et** `buildMutuChain` sur la chaîne finalement retenue. Référentiel GPS incomplet ⇒
aucun crédit (dans le doute le camion est réputé dehors — même choix prudent que
`resteSurPlacePourLeSuivant`). Aucune clé de réglage ajoutée : la règle réutilise
`seuilResterSurPlaceKm`.

### Auto-placement d'ouverture — deux garanties (2026-07-29)

Règle métier de référence : **tout lot qualifié est posé sur le Gantt immédiatement**. Deux défauts
mesurés l'empêchaient de tenir sur la semaine ouverte à l'écran.

- **La passe attend les données du serveur.** L'écran s'affiche avant que le serveur ait répondu : la
  passe tournait donc sur un planning vide, ne plaçait rien, et **marquait quand même la semaine
  traitée**. À l'arrivée des dossiers, le verrou anti-boucle court-circuitait — un lot qualifié non
  posé restait **non placé** jusqu'à ce qu'on change de semaine. Un témoin `donneesRecues`, allumé au
  **premier instantané reçu quel qu'en soit le contenu**, garde maintenant l'entrée de la passe.
  Il porte sur « le serveur a répondu », **pas** sur « il y a des données » : un planning
  légitimement vide ne doit pas rester en attente perpétuelle. Le verrou `placedWeeks` — seul rempart
  contre une boucle d'effet — est **intouché** : on ajoute une condition *devant* lui.
- **Consulter une semaine ne modifie plus rien.** La passe rechaînait **tous** les PL du planning
  (`Object.keys(newPlacements)`), pas seulement ceux qu'elle venait de toucher : ouvrir une semaine
  réécrivait les blocs des semaines précédentes. Le recalcul était **juste** (les wrappers moteur sont
  window-independent, cf. `engineAxisFor`) mais **hors sujet**, avec deux effets de bord réels — une
  écriture serveur non sollicitée (contention entre planificateurs) et des blocs qui bougent sous les
  yeux d'un autre poste sans action de personne. Le reflow est restreint aux **PL réellement
  touchés**.
  ⚠️ **Conséquence assumée** : un planning ancien jamais normalisé ne l'est plus par simple
  navigation. La normalisation devient une **action explicite** — le bouton ↻ d'un camion
  (`handleRecalcPL`).

### Placement sans boucle — camions de toute la région (arbitrage Louis 2026-09-16)

- Au placement d'un lot **sans boucle** (écran local, finalisation nationale sans boucle retenue), on
  propose d'abord les camions de l'**agence vendeuse**, puis ceux des **autres agences de sa région**
  (triées par nom), présentés de la même façon (compatibles / occupés / incompatibles / forçage).
- **Région** = celle de `regionDe` / `memePerimetreMutu` (`engine/chainBuilder.js`) ; une région
  **vide** n'est jamais comparable → aucune autre agence. Helper : `utils/agencesDeLaRegion.js`.
- Même région = **acceptation implicite** : pose directe, **aucune notification** à l'agence du camion.
- Lot **« agence vendeuse uniquement »** → les autres agences sont **masquées**.
- **Saturation** : on liste d'abord les camions libres de la région **à la date demandée** ; les dates
  alternatives (flex) et « client à rappeler » ne sont proposées que si **aucun** camion compatible
  n'est libre dans **toute la région**.
- Une boucle retenue impose son camion : rien ne change dans ce cas.

---

## 5. Changement de dates (UI)

> ⚠️ **Il n'y a plus de « déplacement de bloc »** (2026-08-04). `EditBlockModal` est supprimée : un
> bloc du Gantt ne se retouche plus à la main, et un clic sur un bloc chargement/livraison ouvre la
> **fiche détail du chantier**. Les garde-fous ci-dessous portent tous sur le **seul** chemin
> restant, `handleSaveLotDates` (cf. §4, « Visible, jamais silencieux »).

- Déplacer un **chargement hors de la fenêtre de flex** → **modale de confirmation** avant d'appliquer
  (`handleSaveLotDates`).
- Déplacer un **lot mutualisé** hors de la date commune avec son partenaire → **confirmation**, puis
  **désolidarisation** : les marqueurs (`_boucleType`/`_boucleWith`/`_sequence`) sont effacés sur les
  2 lots, qui redeviennent des trajets indépendants.
- La **fiche détail** d'un lot borne déjà ses champs de date au `min`/`max` de la fenêtre de flex.
- Déplacer une livraison qui forcerait une route le week-end → la **règle vendredi** décale
  automatiquement la route au lundi (la règle ne peut pas être violée).
- Déplacer un bloc d'une boucle posée → `detectBoucles` ré-évalue **depuis zéro** : la boucle est
  conservée si l'écart reste ∈ [0,3] jours ouvrés **et — pour un rechaînage OPPORTUNISTE seulement — la liaison ≤ `seuilProxRetourKm` (300 km)** ; une boucle **DÉCIDÉE** n'est plus soumise à ce seuil depuis le 2026-08-19 (sans quoi le moteur proposerait des boucles que la détection refuserait d'honorer, « proposé = posé » étant faux en silence), cassée sinon
  (les lots redeviennent indépendants, avec retour dépôt recalé).
- ⚠️ Depuis le 2026-08-03, **un glisser-déposer ne fabrique plus de boucle** : rapprocher deux
  dossiers sur un camion les enchaîne (le camion se repositionne, la liaison s'affiche avec ses
  kilomètres) mais **ne décroche ni le badge ★ ni les km évités** — seule l'acceptation d'une
  proposition du moteur qualifie une boucle. Cf. §3, « Préalable ABSOLU ».
- **Blocs manuels sans lot : fonctionnalité ABANDONNÉE** (arbitrage 2026-06-10). Plus de création à la
  main ; les blocs manuels existants restent affichés et préservés par les reflows. Le besoin « camion
  indisponible » sera couvert par `vehicle_unavailabilities` (schéma V3).

---

## 6. Rôles utilisateur

- `admin` — accès complet, vue nationale.
- `planif` — restreint aux agences assignées (`agences` sur l'utilisateur).
- Email inconnu ou absent → fallback **`planif` sans agences** (moindre privilège — durci J4
  phase 3 ; l'ancien fallback `admin` « mode dev » est aboli). Les autorisations qui font foi
  sont côté serveur (`onefleet-api/app/authz.py`).

---

## 7. Points d'intégration futurs

- **OR-Tools** : remplacement de `findBoucleCandidates` par appel HTTP vers un service Python/FastAPI (signature fixe).
- **OSRM** (V1.2+) : remplace haversine — ne pas coupler le code à haversine.
- **Migration Firebase → Postgres/FastAPI** : phases 1–3 faites (API JSONB déployée, front basculé,
  Firebase retiré le 2026-07-05) ; reste J4 (normalisation, schéma V3). État : `exploitation/migration-tableau-de-bord.md`.
  Supabase exclu (ADR 0005).
