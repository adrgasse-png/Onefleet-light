# `engine/jour` — le calcul à la journée « à jours imposés »

> Contrat écrit le 2026-09-21 (cadrage Louis : module propre dans la branche `v2/tournee-editable`,
> partagé par le **banc de cas réels** et la **maquette à options**). Graine du moteur de l'étape 2.
> Le moteur existant (`boucleEngine.js`, `chainBuilder.js`…) n'est **pas modifié** : on l'importe.

## 1. Le principe : séparer le calcul de la décision

Le prototype des essais (`/home/dev/essais-v2/essai-2/lib/evaluateur-jour.mjs`) pose tout « au plus
tôt » : il **choisit** les jours. Ici c'est l'inverse : le module **reçoit** une tournée — un camion,
des lots, un ordre d'arrêts, et pour chaque opération une date **imposée** ou **libre** — et rend
**un verdict et des chiffres**. Il ne déplace jamais une date imposée. Il remplit les dates libres,
et c'est tout ce qu'il « décide ».

Trois usages, une seule fonction :
- la **proposition** : toutes les dates libres → le module propose ;
- la **retouche** (écran de proposition, fiche du lot) : quelques dates épinglées, le reste se recalcule autour ;
- le **planning posé** : toutes les dates imposées → pur contrôle.

« Proposé = posé » tient par construction : le même appel sert à l'écran et à la pose.

## 2. Contraintes techniques

- JavaScript pur, modules ES, **imports relatifs avec extension `.js`** : le module doit tourner à
  l'identique sous `node` nu (banc, dans un conteneur), sous Vite (maquette) et sous vitest.
  Pas d'alias `@/`, pas d'API Node, pas d'accès réseau, pas d'horloge (`Date.now`) dans le calcul.
- Aucune valeur métier en dur : tout passe par `reglages.js`.
- Déterministe : même entrée, même sortie. Pas d'aléa, pas d'ordre d'itération d'objet dont dépend un résultat.
- La **règle d'or (Q17)** — un poids lourd n'est jamais hors de son dépôt le week-end — n'est PAS un
  réglage. Aucune option ne la relâche, même « pour comparer ». **Depuis le 2026-09-27, elle vaut
  aussi pour les 11 jours fériés nationaux** (décision de Louis : « comme un week-end, pour
  l'affichage ET pour le moteur ») — § 12.

## 3. Fichiers

| Fichier | Rôle |
|---|---|
| `calendrier.js` | Axe des jours ouvrés : `jourOuvre(iso)`, `isoDeJour(i)`, `decalerJours(iso,n)`, `jourOuvreOuSuivant(iso)`, `jourOuvreOuPrecedent(iso)`, `estWeekEnd(iso)`. Port de l'essai 2. Depuis le 27/09 : les cases FERMÉES (fériés) et les bornes de BLOC — `estFerme(j)`, `estJourFerme(iso)`, `ecartOuvre`, `decalerOuvres`, `fermesEntre`, `finDeBloc`, `debutBlocSuivant`, `debutDeBloc` (§ 12). |
| `feries.js` | Les 11 fériés nationaux : `estFerie(iso)`, `nomFerie(iso)`, `feriesDeLAnnee(an)`. Contrat partagé avec les écrans (commit `133d44d`) ; ne fait que DIRE quels jours sont fériés. |
| `transbo.js` | Le transbordement coché par le planificateur : `blocTransbo({ vl, dureeVLH, type }, reglages)` (le bloc du camion, 28/09), `fenetreTransbo(vl, type, reglages, dureeVLH)`, `transborderLot(lot, { chg, liv }, reglages)`, `lieuxDuLot`, `bornesDuBloc`, `extrasArretBloc`, `dureeBlocH`. Seule source de la règle, lue par la maquette, l'adaptateur (donc la recherche v2), le calcul et le banc (§ 13, § 14). |
| `reglages.js` | `REGLAGES_DEFAUT`, `fusionnerReglages(partiel)`. Chaque valeur porte en commentaire son statut : arbitrée / hypothèse d'analyste / à caler. |
| `passe.js` | La passe avant en demi-journées (`contexte`, `etatInitial`, `pas`, `cloturer`, `evaluerSequence`). **Port fidèle** de l'essai 2 ; seuls ajouts permis : la distance injectable (`ctx.km`), une trace des segments (route / arrêt / dépôt) pour l'affichage jour par jour, les réglages C5 / C6 ci-dessous, l'approche du matin (§ 11), les fériés (§ 12) et les bornes fines d'un arrêt `tMin` / `tFinMax` / `sansMarge` (§ 14) — tous neutres en leur absence. |
| `tournee.js` | `evaluerTournee(entree, reglages)` — le cœur. `proposerDecalage(entree, depuis, reglages)`. |
| `gardes.js` | Détour (G2) et rendement (G5) greffe par greffe, territoire (G1) — reprise de `essai-2/lib/gardes.mjs`, fonctions du moteur existant importées, jamais réécrites. |
| `planning.js` | `evaluerPlanning({ tournees }, reglages)` — contrôles entre tournées (camion déjà pris). |
| `geste.js` | `controlerGeste({ avant, apres, mesAgences }, reglages)` — ce qu'un geste a le droit de toucher. |
| `index.js` | Ré-exporte l'API publique. |

## 4. `evaluerTournee(entree, reglages)`

### Entrée

```js
{
  camion: { id, agence, depotCp, capacite },          // capacite en m³, null = non contrôlée
  lots: [{
    id, nom, agence,            // agence = agence VENDEUSE
    depotCp,                    // dépôt de l'agence vendeuse (sert au « fait seul »)
    cpC, cpL, volume,
    chg: { dureeH, souhaite, flex: [isoMin, isoMax], date, confirme, prefere, vl?, transbo? },
    liv: { dureeH, souhaite, flex: [isoMin, isoMax], date, confirme, prefere, vl?, transbo? },
  }],
  ordre: [{ lot: id, type: "CHG" | "LIV" }, …],        // l'ordre des arrêts de la tournée
}
```

- `date` : iso = **imposée** (épingle, date posée, date confirmée) · `null` = **libre**.
- `confirme: true` exige une `date`. Le calcul la traite comme imposée ; l'interdiction de la bouger relève de `geste.js`.
- `prefere` (facultatif) : la date vers laquelle tirer une opération libre (sa date précédente) ; à défaut `souhaite`.
- `vl` (facultatif, contrat K1 du 28/09) : la date VL d'une opération transbordée (la navette chez le client) ; absente → `souhaite`. `transbo` n'est jamais écrit à la main : c'est `transborderLot` qui le pose (§ 14).
- `routeForcee` (facultatif, 29/09 soir — « Forcer la route », Louis) : `{ depuis: "LOT|TYPE" | "DEPOT", dateDepuis: iso | null, date: iso }`,
  une exception LOCALE du planificateur sur le tronçon « arrêt précédent à sa date → cette opération à sa date ». Elle
  vaut si et seulement si la date de l'opération est imposée et vaut `date`, que l'arrêt qui la précède dans `ordre` est
  `depuis` (`"DEPOT"` pour le premier arrêt) et, sinon, que la date imposée de ce précédent vaut `dateDepuis` ; autrement
  elle est ignorée, sans signal (un lot inséré entre les deux, une date qui bouge, « Résoudre les dates » qui libère
  l'arrêt : les tronçons se recalculent normalement). Valide, elle ne sert que si la route, comptée normalement, fait
  manquer le jour : la route est alors comptée dans le temps disponible (ajout ⑨ de `passe.js`), km inchangés, aux DEUX
  comptes. Jamais relâchés : Q17 (le retour avant le week-end ou le férié), la capacité, l'ordre, le temps qui ne recule
  pas (un arrêt précédent qui finit après le jour forcé). Le module ne connaît pas le motif : l'écran le garde.
- Une tournée peut n'avoir **qu'un lot** (lot posé seul) : km évités = 0, aucun garde-fou de boucle.

### Sortie

```js
{
  verdict: "ok" | "info" | "orange" | "rouge" | "refus",   // le pire niveau présent
  signaux: [{ niveau, code, lot, type, message, detail }], // message = une phrase en français, pour l'écran
  arrets:  [{ lot, type, date, libre, horsFlex, ecartSouhaiteJ, demiDebut, demiFin }],
  jours:   [{ date, aBord, activites: [{ genre: "CHG"|"LIV"|"ROUTE"|"DEPOT"|"VIDE", lot?, vers?, km?, tDebut?, tFin? }] }],
           // tDebut / tFin (29/09) : bornes du segment sur l'axe des demi-journées (jour j = [2j, 2j + 2[,
           // matin = [2j, 2j + 1[) — absentes sur un jour VIDE / DEPOT de remplissage
  chiffres: { km, kmSeuls, kmEvites, joursCamion, joursVides, volumeMaxABord,
              coupuresDepot, depart, retour, partiels },
  comptes: { large: { tient, motif }, juste: { tient, motif } },
  sorties: [[isoDepart, isoRetour], …],                   // périodes hors dépôt (Q17, affichage)
  sortiesFines: [[tDepart, tRetour], …],                  // les mêmes, en instants (axe des demi-journées)
  occupations: [[isoDebut, isoFin], …],                   // camion PRIS : sorties prolongées à travers
  occupationsFines: [[tDebut, tFin], …],                  //   une coupure CHARGÉE (pour `planning.js`)
  greffes: [{ lot, lien: "mutu"|"retour", detourKm, kmEvites, rallongeJ, g2, g5 }],
}
```

### Les deux comptes (tolérance)

Chaque tournée est comptée deux fois : **au large** et **au juste** (valeurs dans `reglages.comptes`,
alignées sur la définition de l'analyse A — `/home/dev/essais-v2/analyse-A-jour-heure/` ; le large
est passé de 650 à 600 km/j le 2026-09-24, choix de Louis, réglage à confirmer).
Tient au large → aucun signal. Tient au juste seulement → orange `SERRE`. Ne tient à aucun → refus.
Les dates libres se remplissent au large si possible, sinon au juste.

### Remplir les dates libres — `reglages.remplissage`

- `"au_plus_tot"` : comportement du prototype (fenêtre = flex, première date possible). **Avec toutes
  les dates libres, ce mode doit rendre exactement ce que rend `evaluerJour` de l'essai 2** : c'est
  l'épreuve différentielle du module.
- `"pres_du_prefere"` (défaut) : opération par opération dans l'ordre de la tournée, on essaie les
  jours de la flex par distance croissante à `prefere ?? souhaite` (à égalité : le plus tôt) et on
  garde le premier pour lequel la tournée entière reste faisable, les libres suivantes étant
  évaluées au plus tôt. Une opération libre ne sort jamais de sa flex.

### Codes de signaux (tournée seule)

| Niveau | Code | Cas |
|---|---|---|
| refus | `Q17` | Le camion serait hors dépôt un week-end ou un jour férié (semaine insuffisante, retour impossible) |
| refus | `COUPURE_CHARGEE_LOIN` | *(01/10, « la règle des 150 km », Louis)* Un arrêt ne passe pas avant le week-end ou le jour férié, et le camion devrait rentrer CHARGÉ au dépôt pour repartir ensuite au loin : admis seulement si le dépôt est « sur le chemin » : l'arrêt qui suit la coupure est à `reglages.coupureChargeeMaxKm` du dépôt au plus, OU le détour par le dépôt ne dépasse pas ce seuil (arbitré le 01/10), OU (🟠) l'arrêt qui précède est à ce seuil du dépôt au plus — ajout ⑩ de `passe.js`. Refus « dans tous les cas » : une date libre n'y est jamais posée (la recherche ne le propose pas, le remplissage avance la tournée), une date IMPOSÉE après le week-end est refusée. Une date imposée DANS la semaine qui déborderait reste un `DATES_INCOMPATIBLES` (orange, forçable), dont la phrase dit que le report est exclu (`detail.coupureLoin`), sans « au mieux le … ». `detail: { kmApres, kmAvant, detour, max, aBord, apresFermeture }`. Muet quand le réglage vaut `null`. |
| refus | `CAPACITE` | Volume à bord > capacité, un jour donné (`reglages.niveaux.capacite` : `"forcable"` par défaut depuis le 24/09 = refus levable par `entree.forcerCapacite`, qui le dégrade en orange ; `"refus"` = sans appel) |
| refus | `ORDRE_INVALIDE` | Une livraison avant son chargement, lot incomplet, doublon |
| refus | `DATES_INCOMPATIBLES` | Dates imposées entre lesquelles la route ne tient pas, même au juste (niveau réglable : `reglages.niveaux.suiteInfaisable`, voir § 5). `detail: { imposee, calculee, tenue, forcable }` — `forcable` *(30/09)* : forcer la route jusqu'à cet arrêt (`routeForcee` depuis l'arrêt précédent posé) le rendrait-il tenu, sans refus ? `false` quand c'est Q17, un arrêt précédent qui finit trop tard, une date libre de part et d'autre ou une exception déjà posée qui ne suffit pas — l'écran ne propose alors pas « Forcer la route » (une évaluation de plus par arrêt en défaut, jamais récursive) |
| refus | `DATE_NON_OUVREE` | Date imposée un samedi, un dimanche **ou un jour férié** (27/09 ; pour un férié, `detail.ferie` porte son nom et le message le dit) |
| refus | `FLEX_INTENABLE` | Une opération libre ne trouve aucun jour dans sa flex |
| refus | `KM_EVITES_NEGATIFS` | Tournée ≥ 2 lots qui coûte plus que les lots faits seuls |
| orange | `SERRE` | Tient au juste, pas au large |
| orange | `HORS_FLEX` | Date imposée hors de la flex vendue (« rappel client nécessaire ») — `reglages.niveaux.horsFlex` : `"orange"` (tranché) ou `"refus"`. Sur une opération transbordée, c'est la **date VL** qui est jugée (celle que voit le client), pas le jour du camion (28/09, `detail.vl`) |
| refus | `TRANSBO_ORDRE` | Le bloc transbordé du mauvais côté de la navette : chargement au dépôt IMPOSÉ avant la fin de la collecte, livraison au dépôt imposée le jour de la livraison VL ou après, ou qui ne peut pas être finie avant elle (`detail.route`) — « jamais » (Louis, 28/09) ; pas un réglage (§ 14) |
| orange | `TRANSBO_QUAI` | Le bloc du camion au-delà de l'attente à quai (`transbo.attenteQuaiJours`) — niveau de `niveaux.horsFlex` (§ 14) |
| orange | `DETOUR` / `RENDEMENT` | Garde-fou dépassé après retouche — `reglages.niveaux.gardes` : `"orange"` ou `"refus"` (la **recherche**, elle, refuse toujours) |
| ~~info~~ | ~~`ECART_SOUHAITE`~~ | **Plus émis depuis le 28/09** (retour de Louis : dans la fenêtre vendue, rien à signaler — la date est déjà affichée), dans les deux sens. La donnée reste : `arrets[].ecartSouhaiteJ` (lue par le banc). |
| info | `JOURS_VIDES` | Jours de tempo dans la tournée — **jamais plus qu'une info** (arbitrage du 17/09) |
| info | `ROUTE_FORCEE` | *(29/09 soir)* Une `routeForcee` valide a SERVI : sans elle, l'arrêt manquait son jour. Remplace le `DATES_INCOMPATIBLES` de cet arrêt (et le `SERRE` quand c'est ce tronçon qui rendait la tournée serrée — `detail.tenaitAuJuste`). `detail: { depuis, heuresGagnees, km, tenaitAuJuste }` — les heures sont celles du compte serré quand il avait lui aussi besoin du forçage. L'activité ROUTE compressée de `jours[]` porte `forcee: true`. |
| orange | `SANS_GAIN` | Tournée ≥ 2 lots dont les km évités tombent à **zéro** : telle qu'elle est datée, elle n'économise plus rien — le camion repasse par le dépôt entre les lots. `KM_EVITES_NEGATIFS` reste le refus pour un gain *négatif*. *(ajout du 2026-09-21 : le cas se produisait en silence)* |
| refus | `CP_INCONNU` | Un code postal (arrêt, dépôt du camion, dépôt de l'agence d'un lot) inconnu du référentiel (`cpConnu` de `data/gps.js`) : `gc()` le placerait au centre de la France et les distances seraient fausses. Niveau réglable : `reglages.niveaux.cpInconnu` (`"refus"` par défaut). Le calcul continue, pour garder des chiffres — non fiables. `detail: { cp, ou: "arret" \| "depot_camion" \| "depot_lot" }`. *(ajout T0, défaut D3 ; `gc` inchangée)* |
| orange | `TERRITOIRE` | G1 : un lien de la tournée ne tient pas la règle des piliers (retour) ou la zone commune (mutualisation) — même niveau que `DETOUR`/`RENDEMENT` (`reglages.niveaux.gardes`). **Muet tant que `reglages.zones` est vide, ce qui est le défaut.** *(ajout de l'implémentation : le contrat confiait G1 à `gardes.js` sans lui donner de code de signal)* |

Quand une date imposée est intenable, le calcul **continue** (mode diagnostic, § 9 point 6) pour
relever les autres signaux et donner des chiffres marqués `partiels: true` : le camion repasse par
le dépôt s'il peut ainsi tenir la date (`tenue: true`), sinon l'opération **glisse sur place**, au
plus tôt après l'arrêt précédent (`tenue: false`, « au mieux le … ») — le dépôt n'y est plus qu'un
dernier recours *(29/09)*.

### Km évités

`kmEvites = Σ km(lot fait seul, depuis le dépôt de SON agence, ses retours dépôt du week-end compris)
− km(tournée, retours dépôt du week-end compris)`. Les deux termes sortent de la **même passe**
(`reglages.kmGardes = "reels"`, défaut). `"geometriques"` garde l'ancienne mesure (`kmSequence`) pour
que le banc puisse rejouer l'écart de 15 % relevé par l'analyse A.

## 5. Réglages ouverts, exposés à la maquette

**D9, tranché le 2026-09-24 : trois niveaux de gravité par défaut — refus, orange, info.** Aucun
défaut ne rend plus de « rouge » ; le rouge (accepté en brouillon, bloque la confirmation) reste
atteignable par réglage (`suiteInfaisable: "rouge"`, `camionDejaPris: "rouge_si_brouillon"` ou
`"rouge"`, `cpInconnu: "rouge"`), et le code qui le gère est conservé.

| Réglage | Valeurs | Point de la spec |
|---|---|---|
| `comptes.large` / `comptes.juste` | km par jour, marge de manutention — **600** / 770 km/j par défaut depuis le 2026-09-24 (650 / 770 avant ; choix de Louis du 23/09 sur la maquette, ZON, **à confirmer avec les planificateurs**) | C4, zone orange |
| `deuxOpsParJour` | `"toujours"` (défaut) · `{ volumeMax: n }` · `"jamais"` | C5 |
| `weekendCharge` | `true` (défaut : le camion rentre chargé) · `false` (à vide seulement → refus `Q17`) | C6 |
| `coupureChargeeMaxKm` | un nombre de km (150 : arbitrage de Louis du 01/10, destiné à l'Admin « règles métier ») · `null` (aucune limite : le comportement d'avant le 01/10) | la règle des 150 km — le camion ne rentre chargé pour le week-end que si le dépôt est sur le chemin (arrêt d'après ou, 🟠, arrêt d'avant à ce nombre de km du dépôt au plus, ou détour par le dépôt sous ce seuil) ; sinon, refus `COUPURE_CHARGEE_LOIN`. Mesuré le 01/10 sur les 76 tournées réelles : aucune refusée à 150 km (`essais-v2/mesure-abaques-01-10/`). |
| `niveaux.horsFlex` | `"orange"` · `"refus"` | C7 / P2 |
| `niveaux.gardes` | `"orange"` · `"refus"` | P3 |
| `niveaux.suiteInfaisable` | `"orange"` (défaut depuis le 2026-09-24, D9) · `"rouge"` · `"refus"` | C2 |
| `niveaux.camionDejaPris` | `"refus"` (défaut depuis le 2026-09-24, D9 : un camion ne porte jamais deux tournées qui se chevauchent) · `"rouge_si_brouillon"` (rouge, refus si l'autre tournée a une opération confirmée — défaut avant D9) · `"orange_si_brouillon"` (orange, refus si l'autre est confirmée — *ajout T0*) · `"rouge"` | arbitrage produit |
| `niveaux.capacite` | `"forcable"` (défaut depuis le 2026-09-24 : choix de Louis du 23/09 sur la maquette, « refus avec Forcer ») · `"refus"` | arbitrage produit — en v2, `forcerCapacite` vient de `capaciteForcee` porté par TOUS les lots de la tournée (écrit par `ecriture.js` : bouton « Forcer la capacité » du bandeau et de la fiche) |
| `niveaux.cpInconnu` | `"refus"` (défaut) · `"rouge"` · `"orange"` · `"info"` | *ajout T0 (D3)* — hypothèse d'analyste |
| `detourMaxKm`, `rendementMinKmJ`, `vitessePL` | 500 · 750 · 70 | G2 / G5 |
| `arrondi` | `"fin"` (défaut depuis le 2026-09-21) · `"demi_journee"` (= prototype) | **tranché par le banc**, voir § 10 |
| `resteMinPourCommencerH` | 1 h | reste de journée pour engager une LIVRAISON, § 10 |
| `approcheMemeJour` | `"journee"` (défaut, 24/09) · `"matinee"` · `"veille"` (= prototype) | approche d'un CHARGEMENT le matin même, § 11 |
| `contactJour` | `"demi_journee"` (défaut, 24/09) · `"fin"` · `"aucun"` (bornes incluses, avant le 24/09) | jour de contact entre deux tournées d'un camion, § 11 |
| `remplissage`, `kmGardes` | voir § 4 | — |
| `distance` | `null` (défaut : haversine × facteur, mémoïsée) · une fonction `(cpA, cpB) → km` | *ajout T0 (D2)* — la prise d'une matrice d'itinéraires réels (OSRM). Elle sert **partout** : passes des deux comptes, lot fait seul (`kmSeuls`, `kmEvites`), mode `"geometriques"`, détour de greffe G2/G5. Déterministe exigé ; elle traverse `evaluerPlanning` et `proposerDecalage` avec les réglages. |
| `transbo.attenteQuaiJours` | 10 (défaut) | *ajout du 27/09* — jours ouvrés d'attente à quai d'une opération transbordée (§ 13). Hypothèse de la maquette, ❓ question 6 aux planificateurs. |
| `transbo.dureeBlocH` | `null` (défaut : une demi-journée du module, `heuresJour / 2`) · un nombre d'heures | *ajout du 28/09* — la durée du bloc du camion au dépôt, sans marge de manutention (§ 14) |

`proposerDecalage(entree, depuis, reglages)` : rend une **proposition** d'entrée où les opérations
non confirmées situées après l'arrêt `depuis` sont libérées puis re-remplies. Il ne modifie rien :
c'est le bouton « Décaler la suite ».

## 6. `evaluerPlanning({ tournees }, reglages)`

`tournees` : liste d'entrées de `evaluerTournee`, chacune avec un `id`. Rend
`{ parTournee: { id: resultat }, signaux: [...] }`. Signal croisé : `CAMION_DEJA_PRIS` quand deux
tournées du même camion ont des `occupations` qui se chevauchent (à la journée) — sauf un seul jour
commun où la première a rendu le camion avant que la seconde le prenne (`reglages.contactJour`,
§ 11). *(Avant le 24/09 : les `sorties`, bornes incluses, sans exception.)*

*(Ajout T0, 2026-09-23, défaut D1.)* Troisième argument facultatif :
`evaluerPlanning({ tournees }, reglages, { touchee: id | [ids] })` — la tournée que le geste vient de
toucher. Sous `"rouge_si_brouillon"` / `"orange_si_brouillon"`, le niveau de `CAMION_DEJA_PRIS` se
juge alors sur **l'autre** tournée du couple : rouge (ou orange) si elle est en brouillon, refus si
elle porte une opération confirmée (sous le défaut `"refus"`, c'est refus dans tous les cas) ; `detail.touchee` dit laquelle a été touchée. **Sans cette option, le jugement d'avant est
inchangé** (engagée si l'une *ou* l'autre porte une confirmation), et de même pour un couple dont
aucune — ou les deux — tournées ne sont touchées.

## 7. `controlerGeste({ avant, apres, mesAgences }, reglages)`

Compare deux états de planning. Rend `{ ok, signaux }`.
- `DATE_CONFIRMEE` (refus) : une opération confirmée dans `avant` a changé de date, de camion, ou a disparu. Il faut déconfirmer d'abord.
- `LOT_AUTRE_AGENCE` (refus, `demande: true`) : le geste bouge un lot dont l'agence n'est pas dans `mesAgences`, **sauf** s'il roule sur un camion de `mesAgences`. « On donne ses lots, on n'en prend jamais. »

*(Précisions T0, 2026-09-23, défauts D4, D5, D6 — le contrat ci-dessus reste, il est borné.)*
« Il roule sur un camion de `mesAgences` » se lit **avant le geste** : c'est ce qui fait un lot
**sous-traité** chez moi. Le prendre sur le camion d'une autre agence (ou l'ajouter au planning sur
le mien) n'en fait pas un lot sous-traité : `LOT_AUTRE_AGENCE`. Un lot sous-traité, je peux :
- le **garder** sur mes camions et le recaler **dans sa fenêtre seulement** (sa `flex`) ; au-delà :
  `SOUS_TRAITE_HORS_FENETRE` (refus, `demande: true`, par opération). Sans `flex` dans l'entrée, le
  module ne juge pas la fenêtre (même règle que `mesAgences` vide) ;
- le **rendre** : retiré du planning, ou posé sur un camion de son agence vendeuse ;
- mais pas le **donner** au camion d'une troisième agence : `LOT_AUTRE_AGENCE` (`detail.sousTraite: true`).

Et **mon** lot : j'en fais ce que je veux sur les camions de `mesAgences`. Sur la tournée d'une
**autre région** (camion dont l'agence n'est pas dans `mesAgences`), le reprendre défait leur
tournée et le leur mettre est une proposition : `CAMION_AUTRE_REGION` (refus, `demande: true`,
`detail.sens: "reprendre" | "donner"`) — synthèse § 2.5 et § 3.3. Un camion sans `agence` n'est pas jugé.
`aplatir` lit désormais aussi la `flex` des opérations.

## 8. Tests exigés

1. Port des tests de `essai-2/lib/evaluateur-jour.test.mjs` et `gardes.test.mjs`.
2. **Épreuve différentielle** : un jeu figé de séquences (`fixtures/`) produit par l'ORIGINAL de
   l'essai 2, rejoué par `passe.js` et par `evaluerTournee` en mode `"au_plus_tot"` toutes dates
   libres : égalité champ par champ.
3. Dates imposées : épingle tenable, intenable, hors flex, week-end ; confirmé ; remplissage autour d'une épingle ; stabilité (`prefere`).
4. Q17 en masse : sur toutes les tournées faisables du jeu différentiel, aucune `sortie` ne contient un samedi ou un dimanche.
5. Cas réel nommé : BLAVIER (Quimper → Toulon, 63 m³) + DUREL (Vannes → Toulon, 24 m³).

## 9. Précisions apportées par l'implémentation (2026-09-21)

Le contrat ci-dessus fait foi. Neuf points ont dû être tranchés pour l'écrire en code ; ils sont
listés ici plutôt que fondus dans le texte, pour qu'on voie ce qui a été DÉCIDÉ et non spécifié.

1. **Borne haute d'une flex** — `jourOuvreOuPrecedent` est ajouté à `calendrier.js`. Une flex qui se
   termine un dimanche recule au vendredi ; l'arrondir au lundi suivant l'élargirait d'un jour
   ouvré au détriment du client.
2. **`reglages.zones` / `reglages.agencesData`** — G1 a besoin des zones de chalandise et de
   l'annuaire des agences ; ils n'apparaissaient nulle part dans le contrat. Listes **vides par
   défaut** ⇒ G1 inactif, comme dans le moteur. `reglages.heuresJour` (11) est également exposé.
3. **`kmGardes` ne porte que sur les chiffres de TOURNÉE** (`km`, `kmSeuls`, `kmEvites`). Le détour
   d'une greffe reste GÉOMÉTRIQUE en toutes circonstances : c'est la seule mesure que le métier ait
   arbitrée (les 500 km de G2 sont calibrés dessus) et la seule qui soit identique à
   `engine/mesuresBoucle.js` — identité vérifiée à N = 2 par `src/test/engine-jour/gardes.test.js`.
4. **Le lot « fait seul » se compte dans sa fenêtre COMMERCIALE** (sa flex), jamais aux dates que la
   tournée vient d'épingler. Sinon reposer une proposition changerait la baseline des km évités,
   donc le verdict — et « proposé = posé » tomberait. *(Défaut trouvé par le test de propriété.)*
5. **Les deux comptes, une règle et une seule** *(réécrit le 2026-09-21, défaut n° 2 du banc)* :
   le compte large **tient** (finit sans aucune rupture) ⇒ tout le résultat vient du large, aucun
   signal. **Sinon, tout le résultat vient du compte JUSTE** — dates, signaux, chiffres, `jours[]` —
   avec `SERRE` si le juste tient, et les signaux d'intenabilité du juste sinon. Sans exception,
   y compris quand le juste ne tient pas non plus : la version précédente ne basculait que si le
   juste tenait ENTIÈREMENT et gardait sinon le large, **qui honore parfois une date imposée de
   moins**. Sur le planning réel, 4 des 10 tournées à date incompatible se voyaient annoncer un
   rendez-vous manqué qui, à la lecture serrée, était tenu. Annoncer au planificateur qu'une date ne
   tient pas alors qu'elle tient est la pire erreur que ce module puisse faire : il rappelle un
   client pour rien.
6. **Mode diagnostic** *(réécrit le 29/09, scénario 1 de la maquette)* — quand une date imposée est
   hors de portée, trois essais, dans cet ordre :
   1. **tenir la date par le dépôt** : le camion rentre au dépôt (retour toujours réalisable dans la
      semaine en cours, donc **Q17 reste intacte**) et en repart calé pour arriver pile au jour
      imposé. Le signal porte `tenue: true` (« le camion doit repasser par le dépôt pour être au
      rendez-vous du … ») ;
   2. sinon, **glisser sur place** : l'opération GLISSE depuis l'endroit où est le camion, au plus
      tôt après l'arrêt précédent, sans aller-retour au dépôt — un `pas` ordinaire, qui rentre au
      dépôt pour le week-end ou le férié comme toute la passe (Q17 intacte). Aucun segment `DEPOT` de
      diagnostic ;
   3. **le dépôt en dernier recours** : glisser depuis le dépôt, seulement si la passe refuse de
      glisser sur place (la règle d'or, typiquement).

   Dans les cas 2 et 3, le signal porte `detail: { imposee, calculee, tenue: false }` (« … ne peut
   pas être tenu(e) au …, même au compte serré : au mieux le … ») — le module ne *choisit* jamais de
   déplacer une épingle, il dit qu'elle ne peut pas être honorée. `chiffres.partiels: true` signale
   que les kilomètres ne sont **pas** ceux d'une tournée tenue.
   *Pourquoi l'ordre 2 → 3 (avant le 29/09, le glissement partait toujours du dépôt) :* quand le jour
   imposé est déjà passé au moment où le camion est prêt, rentrer au dépôt ne rattrape rien (on ne
   remonte pas le temps) — le camion faisait l'aller-retour pour rien. Cas de la maquette : livraison
   de DUREL imposée au 22/10, camion à Toulon le 27/10 → Toulon → Guer → Toulon, 2 500 km de plus,
   livraison au 03/11, 0 km évités ; désormais livrée à Toulon le 27/10, 2 181 km évités. Glisser sur
   place donne une date au moins aussi tôt, avec moins de km (inégalité triangulaire).
7. **`arrets[].demiDebut` / `demiFin`** sont des index de demi-journée ABSOLUS sur l'axe du module
   (`t = 2 × jourOuvré + 0|1`), pas 0/1 dans la journée : l'appelant lit le matin/après-midi avec
   `% 2` et la durée avec la différence.
8. **`proposerDecalage` rend `{ entree, resultat }`** — la proposition d'entrée demandée par le
   contrat, plus son évaluation, pour éviter un second appel à l'écran. Il ne modifie rien.
   **`depuis` désigne un arrêt qu'on garde EN PLACE, et le geste libère ce qui le SUIT.** D'où une
   chausse-trappe signalée par la maquette : quand c'est la DERNIÈRE livraison qui coince, la
   désigner ne libère rien. `inclure: true` la supprime — `{ lot, type, inclure: true }` ou
   `{ index: n, inclure: true }` libère aussi l'arrêt désigné, **jamais s'il est confirmé**. Les
   formes `nombre` et `{ lot, type }` gardent leur sens d'origine.
9. **`confirme: true` sans `date`** est une entrée malformée : refus `ORDRE_INVALIDE` avec un
   message explicite, plutôt qu'une date devinée.

### Formes d'entrée de `planning.js` et `geste.js`
- `evaluerPlanning({ tournees }, reglages)` : `tournees` = liste d'entrées de `evaluerTournee`,
  chacune portant un `id`. Le chevauchement se juge **bornes incluses** (un camion rentré le mardi
  ne repart pas le mardi : c'est la même journée de travail, et la maille du module est la journée).
  *Assoupli le 2026-09-24 (§ 11) : un jour commun est toléré s'il est un contact, jugé à la
  demi-journée.*
- `controlerGeste({ avant, apres, mesAgences }, reglages)` : `avant`/`apres` ont la forme
  `{ tournees: [...] }`, et le camion d'une tournée porte son `agence` (c'est elle qui décide de la
  sous-traitance). Périmètre vide ⇒ `LOT_AUTRE_AGENCE` ne juge rien.

### Ce que la fixture différentielle couvre
`src/test/engine-jour/fixtures/differentiel.json` — 3 200 séquences, codes postaux réels des deux
viviers, 2/3/4 lots à parts égales, 962 faisables (dont 960 avec coupure dépôt de week-end) et
2 238 infaisables sur trois motifs (`fenetre_depassee`, `q17_semaine_insuffisante`, `capacite`).
Les deux motifs restants (`q17_retour_impossible`, `sequence_invalide`) sont couverts par les tests
portés du prototype (`passe.test.js`, cas 10 et 16). Régénération :
`/home/dev/essais-v2/banc/outillage-module/fixture-differentielle.mjs`.

## 10. `arrondi` — la troisième marge, tranchée par le banc (2026-09-21)

Le prototype arrondissait **chaque segment** à la demi-journée supérieure, avec un plancher d'une
demi-journée par arrêt. Sur une longue distance c'est anodin. Sur un petit saut, c'est énorme :

> BLAVIER + DUREL, chargement de BLAVIER épinglé au **jeudi 22/10**. Le vendredi, le camion doit
> faire Quimper → Vannes (138 km, **1 h 58**), charger 24 m³ (**2 h 24**), rentrer à Guer (72 km,
> **1 h 02**) : **5 h 24 de travail réel**, qui tiennent dans une demi-journée. Le modèle facturait
> **trois demi-journées, 16 h 30**. Le vendredi débordait, Q17 renvoyait tout au lundi, et la
> mutualisation disparaissait — 4 591 km pour 0 km évité.

C'était une **troisième marge**, cumulée à `kmParJour` (650 au lieu de 770) et à `margeDuree`
(+15 %), et la seule que personne n'avait décidée : elle n'était dans aucun réglage, mais dans la
forme du calcul.

### ✅ Le défaut est passé à `"fin"`

**Le banc de cas réels a tranché** (`essais-v2/banc/RAPPORT.md` § 1) : les 76 tournées RÉELLEMENT
posées en production, rendues au module à dates imposées.

| | `demi_journee` | `fin` |
|---|---:|---:|
| **tournées posées REFUSÉES** | **15 / 76** (19,7 %) | **1 / 76** (1,3 %) |
| « la date ne tient pas » (signaux) | 86 | 17 |
| « hors de la fenêtre vendue » | 23 | 3 |
| jours de camion mobilisés | 513 | **356** (−30,6 %) |
| écart moyen à la date souhaitée | 1,54 j | **0,62 j** |

Ces tournées roulent : un modèle qui en refuse 15 se trompe 15 fois. `REGLAGES_DEFAUT.arrondi` vaut
donc **`"fin"`**, et `"demi_journee"` se demande désormais explicitement — ce que fait l'épreuve
différentielle, qui reste verte au champ près.

⚠️ **Deux défauts différents, et c'est voulu** : `reglages.js` porte le défaut PRODUIT (`"fin"`),
`contexte()` de `passe.js` garde le comportement du PROTOTYPE (`"demi_journee"`), parce que
l'épreuve différentielle l'appelle en direct. Un test fixe les deux pour que personne ne les
« harmonise ».

⚠️ **Ce que le banc ne dit PAS** : `"fin"` rend 39 % à 72 % de tournées possibles en plus sur les
viviers, et aucune n'a été confrontée à un planificateur. Il dit qu'elles ne sont pas refusées par
le calendrier, pas qu'elles sont bonnes.

### La règle de début : un chargement ne se coupe pas, une livraison si

`CLAUDE.md` dit « Chargement même jour » — et **sur les chargements seulement**. On ne commence pas
à vider une maison à 17 h pour la finir le lendemain ; à la livraison, le camion est là, chargé, et
l'équipe décharge ce qu'elle peut. Le planning réel le fait **14 fois sur 204 manutentions**
(15 h → 18 h puis 7 h → 8 h le lendemain), et appliquer la règle aux deux était la **première cause
de désaccord du module avec la production : 10 des 18 signaux négatifs restants**.

- **CHARGEMENT** — s'il tient en une journée mais pas dans ce qu'il en reste, il attend le lendemain
  matin. Plus long qu'une journée, il démarre à l'arrivée dès qu'il reste une demi-journée.
- **LIVRAISON** — elle démarre dès qu'il reste `resteMinPourCommencerH` (1 h par défaut, hypothèse
  d'analyste) et **déborde sur le lendemain matin**. Sa `date` reste le jour où elle COMMENCE, et
  `jours[]` la montre sur ses **deux** journées.

En mode `"fin"`, `demiDebut` / `demiFin` sont **fractionnaires** — toujours sur le même axe
(`t = 2 × jourOuvré + fraction`), et `isoDeJour(⌊demiDebut / 2⌋)` vaut toujours la `date` de
l'arrêt. `jours[]`, `joursVides` et `sorties` gardent exactement le même sens.

**Q17, la coupure dépôt, la capacité et les fenêtres sont INCHANGÉES** : mêmes comparaisons, en
flottants, à `EPS = 1e-9` près.

### Monotonie : stricte

| compte | faisables `"demi_journee"` | `"fin"` | deviennent faisables | cessent de l'être |
|---|---:|---:|---:|---:|
| large (650 km/j, +15 %) | 1 213 | **1 517** | 304 | **0** |
| juste (770 km/j, 0) | 1 407 | **1 655** | 248 | **0** |

Sur les 3 200 séquences de la fixture, **toute séquence faisable en demi-journées l'est aussi en
continu**, aux deux comptes. Elle ne l'était pas avant de réserver la règle de début aux
chargements : le cas 3007 y perdait sa fenêtre d'un jour parce qu'une manutention de 5 h 54 était
renvoyée au lendemain matin. Ce contre-exemple a disparu avec la correction.

### Garantie sur `sorties`

Les périodes hors dépôt sont **triées, disjointes et sans week-end**, y compris en mode diagnostic —
c'est ce sur quoi `planning.js` s'appuie pour dire si un camion est déjà dehors. Deux verrous : le
redémarrage diagnostic par le dépôt (essais 1 et 3 du § 6 ; le glissement sur place est une passe
ordinaire) **ne remonte jamais le temps** (`Math.max(…, tRetour)` dans `etatAuDepot`),
et `normaliserSorties` fusionne ce qui se recouvrirait encore — jamais au-delà d'une semaine.

### Messages

Toute phrase destinée à l'écran s'accorde en genre (« **la** livraison … ne peut pas être **tenue** »,
« **le** chargement … est **fixé** ») via la table `OPS` de `tournee.js` et son miroir dans
`geste.js`, et toute date s'écrit **« lun. 19/10 »** — jour abrégé, jour/mois, sans année. Le jour de
la semaine se calcule à partir de l'ISO seul : aucune horloge n'entre dans le module.

## 11. Le jour de contact entre deux tournées d'un camion (décision de Louis, 2026-09-24)

Sur l'instantané du 21/09, `evaluerPlanning` refusait au repos trois paires de tournées réelles que
le Gantt sépare (EY-412-VY #1/#2 le 16/09, GA-832-RW #4/#5 le 15/10, GL-896-CK #1/#2 le 16/09 —
`RAPPORT-D9.md` § 5). Deux artefacts de la maille journée, deux corrections, toutes deux voulues :

**(a) L'approche d'un chargement part le matin même** — `reglages.approcheMemeJour`, ajout ⑥ de
`passe.js`. La passe d'origine calait l'arrivée au premier arrêt sur le DÉBUT de sa journée : toute
approche, même de 10 km (GA-832-RW #5), tombait la veille et y ouvrait une sortie.
- `"journee"` (défaut) : le camion part le matin même dès que le chargement COMMENCE encore ce jour-là
  (règle de début inchangée : un chargement qui ne tient plus dans le reste de la journée ne se coupe
  pas) et que le retour avant le week-end tient. C'est ce que fait le Gantt : GL-896-CK #2 roule de
  7 h à 14 h (380 km) et charge l'après-midi — sous `"matinee"` (approche ≤ une demi-journée, 325 km
  au large) elle partirait encore la veille.
- **Jamais au prix de la tournée** : une lecture (passe diagnostic) qui ne tient pas avec l'approche du
  matin est relue avec celle de la veille, et la plus permissive l'emporte (même règle que les deux
  comptes). Sans ce repli, BLAVIER + DUREL (fixture T8) passait en `SERRE` et un chargement libre
  glissait d'un week-end. Le lot fait seul (`kmSeuls`) suit le même repli.
- Seulement l'approche d'un **chargement** (camion vide) : un camion qui repart CHARGÉ vers une
  livraison, après une coupure, garde la veille — la partir le matin même ne faisait que déplacer le
  jour creux et rentrer le camion plus tard (GQ-156-KL #4).
- **Le symétrique au retour n'est pas pertinent** : le retour se compte au fil du temps depuis la
  fin de la dernière opération ; rien ne le cale sur une borne de journée. Quand le module rentre un
  jour plus tard que le bloc « vid » du Gantt (EY-412-VY #1, GA-832-RW #4), c'est la vitesse
  (650 km/j au large contre 70 km/h en plage élargie au Gantt), pas le placement.
- `contexte()` garde `"veille"` : l'épreuve différentielle compare au prototype.
- **Q17 intacte** : le départ ne recule que dans la même journée ouvrée, et le retour avant le
  week-end est revérifié avant d'y consentir.

**(b) Un jour de contact n'est pas un chevauchement** — `reglages.contactJour`, `planning.js`.
Deux tournées du même camion qui partagent UN jour sont admises si la première a rendu le camion
avant que la seconde le prenne : `"demi_journee"` (défaut) — dans une demi-journée antérieure
(rentrée le matin, repartie l'après-midi) ; `"fin"` — au fil du temps ; `"aucun"` — bornes incluses
(avant le 24/09). Deux jours communs, ou une vraie superposition : `CAMION_DEJA_PRIS`, au niveau de
`niveaux.camionDejaPris` (refus, D9, inchangé). Les instants viennent de `sortiesFines` /
`occupationsFines`.

**(c) L'occupation** *(ajout de l'implémentation)*. Avec (a), une tournée dont le camion rentre
CHARGÉ au dépôt au milieu de la semaine (attente d'une livraison à date imposée) laissait ses jours
d'attente « libres » : la maquette posait une autre tournée sur le camion, meubles à bord (s7,
« quitter la tournée » de HAMONIC). Le contrôle juge donc l'**occupation** : les sorties, fusionnées
à travers chaque coupure chargée. Une coupure à vide libère le camion, comme avant.

Sur l'instantané du 21/09 (réglages v2) : **0 `CAMION_DEJA_PRIS`** au repos (3 avant) ; les verdicts
des 76 tournées ne changent pas, sauf EY-412-VY #4 (info → ok : un jour de tempo en moins) ; les
jours de camion mobilisés passent de 337 à 293 (le jour d'approche disparaît). Test :
`src/test/engine-jour/contact-jour.test.js`.

## 12. Les jours fériés, « comme un week-end » (décision de Louis, 2026-09-27)

**La règle.** Un jour férié se traite comme un week-end, pour l'affichage ET pour le moteur : aucune
opération (chargement, livraison) ce jour-là, et **le camion est au dépôt**. La règle d'or s'étend
aux 11 fériés nationaux (`feries.js`), avec la même absoluité — **ce n'est pas un réglage**, aucune
option ne l'éteint. Le camion peut rentrer CHARGÉ pour un férié exactement comme pour un week-end
(C6, `weekendCharge`, défaut vrai ; à `false`, la coupure chargée d'un férié est refusée `Q17`).
❓ Alsace-Moselle (Vendredi saint, 26/12) non traités.

**Le choix : le férié reste une case de l'axe, mais une case FERMÉE.** L'arithmétique
`t = 2 × (5 × semaine + jour)` ne bouge pas : toutes les dates de la maquette, du banc et de la
recherche gardent leur index, `jourOuvre("2026-11-11")` rend toujours un nombre. Ce qui change :
- **La « semaine » de Q17 devient le BLOC** de jours ouverts consécutifs (`calendrier.js`). Une
  sortie tient dans son bloc : `finDeBloc(j)` (le début du premier férié qui suit, sinon le lundi),
  `debutBlocSuivant(j)` (le lendemain du férié — le mardi après un lundi de Pâques), `debutDeBloc(j)`
  (le plus tôt qu'on puisse partir pour un arrêt du jour `j`). **Sans férié dans la semaine, chaque
  borne est la borne d'origine au bit près** (test « ⑤ » de `feries.test.js`).
- **La passe (`passe.js`, ajout ⑦)** remplace `finDeSemaine` par ces bornes, aux quatre endroits où
  elle parlait de la semaine : départ (`etatInitial`), limite de retour, attente au dépôt, coupure.
  Une opération ne COMMENCE jamais sur une case fermée (garde explicite pour le cas dégénéré d'un
  arrêt au dépôt de durée nulle ; sinon la limite de bloc l'exclut déjà). Un bloc écourté par un
  férié trop court pour la mission n'est plus un refus « semaine insuffisante » : on attend le bloc
  suivant (le refus reste quand le bloc testé est une semaine entière, ou que la mission dépasse
  même une semaine). La garde de boucle accorde un tour de plus par bloc écourté (au plus 8).
- **Un férié n'est ni un jour de camion, ni de l'attente, ni un jour de tempo** — pas plus qu'un
  samedi : `joursMobilises` et `joursAttente` (`cloturer`), `attenteCourante` (élagage de
  l'énumération, qui reste exact : la quantité stagne pendant le férié) et `jours[]` (`tracerJours` :
  pas de ligne pour le férié, pas de `JOURS_VIDES`) le retirent.
- **Dates (`tournee.js`)** : une date IMPOSÉE un férié est refusée comme un samedi — même code
  (`DATE_NON_OUVREE`), même niveau (refus), `detail.ferie` et le nom du férié dans le message. Une
  date LIBRE ne tombe jamais un férié (candidats de `remplir` sans case fermée) ; les bornes de flex
  s'arrondissent comme un samedi (`jourOuvreOuSuivant` vers l'avant pour la borne basse,
  `jourOuvreOuPrecedent` vers l'arrière pour la haute — ces deux fonctions sautent désormais les
  fériés). Les distances « au jour près » se comptent en jours OUVERTS (`ecartOuvre`) : l'écart à la
  date souhaitée (`ecartSouhaiteJ` ; le message `ECART_SOUHAITE` n'est plus émis depuis le 28/09) et l'ordre des candidats du remplissage
  (du mardi au jeudi d'une semaine au mercredi férié : un jour).
- **La recherche v2 et l'énumération** utilisent la même passe (« proposé = posé » tient, test
  `engine-v2/transbo-feries.test.js`) ; la recherche compte son préfiltre et sa borne de balayage en
  jours ouverts (`ecartOuvre`, `decalerOuvres` : un férié ne doit pas écarter une candidate que
  l'énumération aurait retenue), refuse une date posée un férié (`DATE_NON_OUVREE`) et n'essaie pas
  de départ un jour férié.

**Ce qui ne change pas** : `decalerJours(iso, n)` reste l'arithmétique de l'axe (il compte un férié
comme une case) — les fenêtres de la maquette (`flexAutour`) et des viviers du banc (`tableArrets`)
sont donc inchangées ; c'est la passe et le remplissage qui évitent le férié à l'intérieur.

**Le moteur de PRODUCTION ne connaît pas les fériés** (`chainBuilder.js`, `boucleEngine.js` :
non modifiés — la prod n'est pas utilisée d'ici la v2).

**L'épreuve différentielle** compare au prototype, qui ignore les fériés. La fixture (15/09/2026 →
12/02/2027) traverse le 11/11, Noël et le 1ᵉʳ janvier : chaque séquence est donc TRANSLATÉE d'un
nombre entier de semaines vers la période sans férié du 20/07 au 10/11/2026 (le prototype est
invariant par une telle translation), et la neutralité de la translation est elle-même vérifiée
(D3). Même chose pour la mesure de monotonie d'`arrondi.test.js` (304 / 248), qui est aussi
vérifiée en place, fériés compris.

**Au banc** (`essais-v2/banc/sortie/r27-avant-133d44d/` contre `r27-apres/`, rapport
`briefs/v2-retours-27-09/RAPPORT-MOTEUR.md`) : aucun écart qui ne touche un férié en semaine ou le
lot transbordé. Planning réel en mode retenu : inchangé par les fériés (l'instantané s'arrête au
5/11). Vivier-78 (22/09 → 31/10) : identique. Vivier-103 (jusqu'au 27/11) : les tournées qui
livraient le 11/11 ou roulaient à travers disparaissent (9 au compte juste, en `fin`), le fil de
l'eau perd 844 km évités (−1,8 %). Panel : les boucles de juillet (14/07, un mardi) et de Noël.

## 13. Le transbordement coché par le planificateur (2026-09-27)

Décision de Louis : le transbordement COCHÉ (cases « Transbordement » au chargement et à la
livraison) est en v2 ; seule la recherche qui PROPOSE d'elle-même un transbordement reste en v3.
Une navette collecte chez le client à la date vendue, la marchandise attend au dépôt de l'agence
VENDEUSE, le poids lourd l'y charge un autre jour (symétrique à la livraison).

**Une seule règle** : `transbo.js`. `transborderLot(lot, { chg, liv }, reglages)` rend le lot du
module avec, pour chaque opération transbordée, l'arrêt du camion au dépôt de l'agence vendeuse
(`lot.depotCp`) et la fenêtre du quai `fenetreTransbo(vendue, type)` : au chargement
[date vendue, + `transbo.attenteQuaiJours` jours ouverts] (le camion ne charge pas avant la
collecte), à la livraison [date vendue − N, date vendue]. La date vendue reste la date SOUHAITÉE
(celle de la navette, montrée en carte fantôme) : l'écart du camion à cette date n'est pas un signal.
**Depuis le 28/09, la fenêtre et le moment du camion suivent la règle du bloc (§ 14)** : le jour
même de la collecte n'est permis que l'après-midi, et à la livraison la fenêtre s'arrête la veille.
La lisent : la maquette (`bac-a-sable/moteur.js`, `lotPourModule` et `opTransbordee`, qui ne
l'écrivent plus), l'adaptateur de l'application (`engine/v2/adaptateur.js`, `lotPourModule` — les
cases `transboC` / `transboL` du lot), la recherche v2 pour son énumération (adresse et fenêtre de
l'arrêt, et les garde-fous G1/G2/G5 sur les adresses du camion), et le banc
(`scripts/banc/lib/planning-reel.mjs`, `lotDuBlob`) — l'écart adaptateur ↔ banc reste nul.

Avant le 27/09, l'adaptateur ignorait les cases : la recherche cherchait chez le client et la
maquette posait au dépôt (scénario 11 : 810 km évités annoncés, 742 posés). Le test
`bac-a-sable/propose-pose.test.js` n'exclut plus le transbordement.

**Le garde-meubles** (complément du 27/09) : fait du dossier, pas un levier (tranché le 18/09) — la
case ne change QUE l'adresse de l'opération. Le format de l'outil l'écrit déjà dans `cpC` / `cpL`
(l'adaptateur n'a rien à faire) ; la maquette la garde à part (`gmC` / `gmL`) et la traduit par
`lieuxDuLot(lot, { gmC, gmL, transboChg, transboLiv })` — garde-meubles d'abord, transbordement
ensuite — dans `bac-a-sable/moteur.js` (planning) ET `propositionEntree.js` (écran de proposition),
qui l'oubliaient (la recherche calculait au garde-meubles, le planning livrait chez le client).
**Garde-meubles + transbordement sur la même opération : le transbordement l'emporte pour le
camion** (dépôt de l'agence vendeuse, fenêtre du quai ; la navette va au garde-meubles) — même
ordre que la chaîne de l'outil ; avec le garde-meubles par défaut (le dépôt de mon agence), c'est
le même lieu.

⚠️ Sur l'instantané de production, le seul lot transbordé (CHT-836276, agence de Guer, client à
Carcassonne → Vannes) montre la limite de la règle « dépôt de l'agence vendeuse » : le camion
chargerait à Guer, la navette ferait ~800 km. Question posée à Louis (rapport du 27/09).

## 14. Le bloc du transbordement : après la navette, avant la navette (Louis, 2026-09-28)

**La règle** (« à inscrire ») : un transbo au CHG est **toujours après** le CHG, un transbo à la LIV
**toujours avant** la LIV. Le camion au dépôt est un **bloc d'une demi-journée** ; il se place
« juste après le CHG VL quand c'est possible, sinon après si ça permet une boucle » (symétrique à la
livraison). Seule source : `transbo.js` (`blocTransbo`), lue par la maquette, l'adaptateur, la
recherche v2 (son énumération) et le banc. ❓ À confirmer avec les planificateurs (synthèse) ;
l'option « le transbo comme arrêt numéroté » est notée, pas codée.

- **La date VL** (contrat K1) : `op.vl`, le jour où la navette charge chez le client (livre à la
  LIV) ; absente → `souhaite` (tous les lots existants, et l'application : aucun champ en base).
  `souhaite` / `flex` restent ceux du client, `date` est le jour du camion.
- **Au CHG** : la collecte commence le matin du jour VL et dure `dureeH` de l'opération ; le bloc
  commence au plus tôt au début de la demi-journée qui suit (l'après-midi même si elle finit à midi,
  sinon le lendemain ouvré au matin — jours fermés sautés), au plus tard VL + N jours ouvrés.
- **À la LIV** : le bloc est fini au plus tard la veille ouvrée au soir (la navette part le matin du
  jour VL), au plus tôt VL − N.
- **La durée** : `transbo.dureeBlocH` (défaut : une demi-journée du module), **sans** la marge de
  manutention du compte large — c'est un créneau, pas une estimation (5 h 30 majorées de 15 %
  déborderaient la demi-journée, et l'après-midi « juste après » ne tiendrait qu'au compte serré).
- **La passe** (`passe.js`, ajout ⑧) : trois champs facultatifs d'un arrêt, `tMin` (début au plus
  tôt), `tFinMax` (fin au plus tard — un dépassement est un échec immédiat, le temps ne recule pas)
  et `sansMarge`. Absents : la passe d'avant, au bit près (épreuve différentielle).
- **La préférence** : la préférée d'un bloc libre est le bord de sa fenêtre (la plus tôt au CHG, la
  plus tard à la LIV), **imposée par `tournee.js`** quelle que soit celle de l'appelant (une retouche
  qui libère une date en gardant l'ancienne en préférence ne doit pas éloigner le bloc de la
  navette). Le remplissage ne s'en écarte que si la tournée ne tient pas ; la recherche énumère la
  fenêtre et garde la meilleure boucle — son classement (km évités) ne pénalise pas un bloc décalé.
- **Les signaux** : une date de camion IMPOSÉE du mauvais côté de la navette est un refus
  `TRANSBO_ORDRE` (comme un jour non ouvré : la marchandise n'est pas au dépôt) ; au-delà de
  l'attente à quai, un orange `TRANSBO_QUAI`. `HORS_FLEX` et `ecartSouhaiteJ` portent sur la date
  VL (ce que voit le client). **Q17 n'est pas touchée** : le bloc est un arrêt comme un autre pour la
  passe ; test de masse `r28-moteur-transbo.test.js` (768 lots, chaque jour ouvert d'octobre à
  décembre 2026, fériés compris).
