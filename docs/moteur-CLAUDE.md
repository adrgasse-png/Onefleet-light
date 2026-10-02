# OneFleet — moteurs de recherche de boucles (extrait autonome)

Ce dossier contient les **moteurs de boucles de OneFleet**, l'outil de planification des camions de
déménagement du groupe, et de quoi les faire tourner sur un **vivier de lots** (un export CSV) pour
mesurer les boucles qu'ils savent former.

Il y en a **deux**, et il ne faut jamais les confondre dans un compte rendu :

| | Où | État |
|---|---|---|
| **Le moteur en production** | la racine du dossier (`src/`, `scripts/`) | celui qui tourne aujourd'hui dans l'application |
| **Le moteur v2**, « la tournée éditable » | le sous-dossier `v2/` | **pas en production** : portage en cours, règles et réglages encore mobiles |

Tu es l'agent d'une personne qui veut **tester des boucles sur des données réelles**. Ce fichier te
dit ce que tu as entre les mains, comment le lancer, comment lire ce qui sort, et ce qu'il ne faut
pas faire. Lis-le en entier avant de lancer quoi que ce soit. Sauf demande contraire, **commence par
le moteur en production** : c'est lui qui dit ce que l'outil propose aujourd'hui.

## 1. Ce que c'est, et ce que ce n'est pas

- **Un extrait, pas l'application.** Pas d'écran, pas de base de données, pas de serveur. Du
  JavaScript pur, lancé avec Node. Rien n'est écrit nulle part, aucune connexion n'est ouverte :
  tout est en lecture seule, tu peux lancer sans demander.
- **Les moteurs sont à l'identique du dépôt** (versions exactes dans `VERSION.txt` et
  `v2/VERSION.txt`). C'est ce qui donne leur valeur aux chiffres.
- 🔴 **Ne modifie aucun fichier de `src/` ni de `v2/src/`.** Un moteur retouché n'est plus « notre
  moteur », et rien ne signalera que les chiffres ont cessé d'être comparables. Si une règle te
  paraît fausse ou si tu trouves une anomalie, **décris-la à ton utilisateur** (lot, dates, ce que
  tu attendais, ce qui sort) pour qu'elle remonte à l'équipe OneFleet. Ne corrige pas.
- 🔴 **Ne réimplémente aucune règle.** Pour tester une idée, on appelle le moteur et on filtre ses
  propositions ; on ne recode pas « à peu près » une de ses règles dans un script à côté (§ 8).
- **Tu mesures, tu ne décides pas.** Un changement de règle est un arbitrage métier. Ton rapport
  chiffre et explique.

## 2. Ce que contient le dossier

| Chemin | Rôle |
|---|---|
| `potentiel.mjs` | **le lanceur du moteur en production** (§ 3) |
| `v2/potentiel-v2.mjs` | **le lanceur du moteur v2** (§ 7) |
| `referentiels.json` | copie figée de la base : **règles** réglées par l'administrateur, **agences** (dépôts, régions), **flotte** (camions par agence). Sa date est dans le fichier (`_figeLe`). Sert aux deux moteurs |
| `exemples/modele-vivier.csv` | six lots **fictifs** au bon format |
| `exemples/referentiels-fictifs.json` | cinq agences et dix camions **inventés**, pour vérifier l'installation. 🔴 Jamais pour un vrai vivier |
| `exemples/rapport-attendu.txt`, `exemples/rapport-v2-attendu.txt` | ce que le modèle doit produire, à l'identique, avec les référentiels fictifs |
| `docs/regles-metier.md` | **la doc de référence des règles du moteur en production** (1 800 lignes). Ses liens vers d'autres documents du dépôt ne mènent nulle part ici |
| `scripts/analyse-potentiel-boucles.mjs` | le rapport (son en-tête explique chaque hypothèse) |
| `scripts/lib/csv-lots.mjs` | lecture du CSV : colonnes, sociétés reconnues, motifs de rejet |
| `scripts/lib/depots.mjs` | code postal du dépôt de chaque société |
| `scripts/lib/fil-eau.mjs` | le simulateur « fil de l'eau » : pose les lots un par un, comme l'application |
| `scripts/lib/tournees.mjs` | le « big bang » : meilleur assortiment possible, tournées à trois lots |
| `scripts/lib/diagnostic-retours.mjs` | « pourquoi si peu de retours » : couloirs, entonnoir des rejets |
| `scripts/lib/gardefous.mjs` | prédicats de mesure (contre-épreuve de la règle des piliers) |
| `src/engine/` | **le moteur en production** : `boucleEngine.js` (recherche de boucles, pose), `chainBuilder.js` (horaires d'une tournée), `gardesBoucle.js` (les refus), `mesuresBoucle.js` (détour, rallonge) |
| `src/data/`, `src/utils/` | ce dont le moteur dépend : coordonnées des codes postaux (`gps.js`), réglages par défaut (`referentiels.js`), dates et jours ouvrés, zones, liens de boucle |
| `vendor/javascript-lp-solver/` | solveur exact du big bang, embarqué : aucun `npm install` à faire |
| `v2/` | **le moteur v2**, dans son arbre à lui (§ 7) |

`scripts/` n'appartient pas au moteur : ce sont des outils de mesure qui l'importent.

Si `referentiels.json` manque, les lanceurs s'arrêtent et le disent. Il faut le demander à l'équipe
OneFleet : sans lui il n'y a ni camions ni réglages réels, et les chiffres ne voudraient rien dire.

## 3. Lancer le moteur en production

Il faut **Node 20 ou plus récent**. Rien d'autre : ni Docker, ni réseau, ni installation.

```bash
# vérifier l'installation (quelques secondes) : les sorties doivent être identiques aux rapports attendus
node potentiel.mjs --csv exemples/modele-vivier.csv --blob exemples/referentiels-fictifs.json > essai.txt
diff essai.txt exemples/rapport-attendu.txt && echo "moteur en production : installation conforme"
node v2/potentiel-v2.mjs --csv exemples/modele-vivier.csv --blob exemples/referentiels-fictifs.json > essai-v2.txt
diff essai-v2.txt exemples/rapport-v2-attendu.txt && echo "moteur v2 : installation conforme"

# un vrai vivier (référentiels réels : c'est le défaut, pas de --blob)
node --max-old-space-size=2500 potentiel.mjs --csv "mon-vivier.csv" --flex 0,5 > rapport.txt 2> progression.txt
```

Le **rapport** sort sur la sortie standard, la **progression** sur la sortie d'erreur. Environ
80 lots, deux règles, flex 0 et 5 : un peu plus de deux minutes. `[debug.inc] métrique inconnue`
sur la sortie d'erreur est du bruit sans conséquence.

| Option | Effet |
|---|---|
| `--flex 0,5` *(défaut)* | flexibilité de **chargement** du lot qu'on accroche, en jours ouvrés (± N) ; une passe par valeur |
| `--regles "4 points,piliers"` *(défaut)* | règles de territoire mesurées (§ 5) ; ajouter `piliers-filtre` pour la contre-épreuve |
| `--exclure code1,code2` | codes de lots retirés du vivier **sur décision** (§ 4) |
| `--du 2026-09-20 --au 2026-10-31`, `--mois 2026-10` | ne garder que les chargements de la période |
| `--sans-big-bang` · `--sans-diagnostic` | raccourcis pour aller plus vite |
| `--avec-doublons` | garder les doublons exacts (retirés par défaut) |
| `--blob autre.json` | utiliser d'autres référentiels que `referentiels.json` |

## 4. Préparer un vivier

Un fichier CSV, séparateur **`;`**, dates en **jj/mm/aaaa**, une ligne par lot, avec exactement ces
colonnes (celles de l'export commercial) :

```
Société;Code dossier;Volume;CP chargement;Ville chargement;Date chargement;CP livraison;Ville livraison;Date livraison;Distance;Date de confirmation
```

- **Société** : la raison sociale, telle que le chargeur la connaît (`AGENCE_PAR_RAISON` dans
  `scripts/lib/csv-lots.mjs`, 46 sociétés). Une société inconnue est écartée et comptée (« agence
  inconnue »). Une société sans dépôt français connu aussi (« sans dépôt »).
- **Date de confirmation** : c'est elle qui donne l'**ordre d'arrivée** des lots au fil de l'eau.
- **Volume** en m³, **Distance** en km.

**Contrôles à faire AVANT de lancer, et à soumettre à ton utilisateur — ne tranche pas seul :**

| Contrôle | Pourquoi |
|---|---|
| Code postal vide, ou à 4 chiffres (`6500`) | illisible, ou zéro initial perdu par Excel |
| 🔴 **Code postal étranger** (Suisse `1228`, Italie `60020`…) | **le moteur ne l'écarte pas** : il le place sur le département français de même préfixe. Les km sont faux **en silence** → `--exclure` |
| Doublons entre sociétés (même trajet, mêmes dates, même volume) | mutualisation « parfaite » fictive |
| Chargement avant la confirmation, livraison très lointaine | faute de frappe probable |
| **Date un samedi ou un dimanche** | le moteur ne sait pas planifier ce lot |

L'en-tête du rapport ré-affiche les codes postaux approximatifs et les dates de week-end, et donne
le décompte : lots lus, rejetés par motif, retenus. **Lis ce décompte avant tout chiffre** : un
vivier amputé de la moitié de ses lignes donne un rapport qui a l'air normal.

Trois limites du chargeur à connaître (elles valent pour les deux moteurs, qui partagent le
même chargeur) :

- 🔴 **Fenêtre de dates codée en dur** : chargements du **2026-06-01 au 2026-12-31** (constantes
  `FENETRE_CHG_MIN` / `FENETRE_CHG_MAX` de `scripts/lib/csv-lots.mjs`, et sa copie
  `v2/scripts/lib/csv-lots.mjs`). Hors de là, un lot est rejeté « hors fenêtre ». Si le vivier de
  ton utilisateur sort de cette période, c'est le seul endroit qu'il est légitime d'ajuster (c'est
  un outil de mesure, pas le moteur) — dis-le dans ton compte rendu.
- **Toutes les sociétés n'ont pas de camions.** Seules les agences qui utilisent l'application ont
  une fiche et une flotte dans `referentiels.json` (neuf à l'écriture du chargeur ; le compte du
  jour se lit dans le fichier). Les autres sont connues du chargeur, mais sans flotte : au fil de
  l'eau « flotte réelle », leurs lots sortent « sans camion » ; le lanceur v2 les écarte d'emblée.
- Ces mêmes sociétés sans fiche d'agence **ne mutualisent qu'avec elles-mêmes** (le droit de
  mutualiser se lit sur la région de l'agence, et elles n'en ont pas).

## 5. Le métier, en bref (moteur en production)

**Une boucle** : deux ou trois lots portés par le même camion pour éviter de rouler à vide.

| Mot | Sens |
|---|---|
| **lot** | un déménagement à transporter : un chargement, une livraison, un volume |
| **ancre** (ANC) | le lot **déjà vendu et déjà posé** sur un camion. Il fixe les dates, le camion, le dépôt |
| **accroché** (ACC) | le lot qu'on **greffe** sur le voyage de l'ancre. C'est toujours un lot **seul** |
| **retour** | les deux lots viennent d'**agences différentes** : l'accroché remplit le retour à vide de l'ancre. `Dépôt → Chg ANC → Liv ANC → Chg ACC → Liv ACC → Dépôt` |
| **mutualisation** | même agence (ou deux agences d'une même région) : deux lots chargés dans la même zone partent ensemble |
| **tournée à trois** | une paire mutualisée qui reçoit un retour. **Jamais quatre lots** |
| **fil de l'eau** | les lots arrivent un par un, dans l'ordre de confirmation ; une décision ne se reprend pas. C'est ainsi que l'application travaille |
| **big bang** | tout le vivier d'un coup, meilleur assortiment possible. Un **plafond théorique** |

**Les règles qui refusent une boucle** (valeurs effectives : première ligne du rapport) :

- **G1 — territoire.** Les zones de chalandise sont des listes de départements (livrées : *Ouest*
  et *PACA*). Au **retour**, règle des **piliers** : il faut au moins un pilier — *maison*
  (chargement de l'ancre et livraison de l'accroché dans la zone du dépôt du camion) ou *au loin*
  (livraison de l'ancre et chargement de l'accroché dans une même autre zone). En **mutualisation** :
  les deux chargements dans la même zone, livraisons libres. L'ancienne règle « 4 points » (les
  deux piliers à la fois) n'est plus appliquée ; le rapport la mesure encore, pour comparaison.
- **G2 — détour** : au plus 500 km, en kilomètres absolus.
- **G5 — rendement** : au moins 750 km par jour de camion.
- **Chargement vendu intouchable** : la date de chargement de l'ancre ne bouge **jamais**. Seul
  l'accroché bouge, dans sa fenêtre de flex ; les livraisons peuvent glisser de quelques jours.
- 🔴 **Règle d'or : un camion n'est JAMAIS hors de son dépôt le week-end.** Chargé ou à vide,
  quelle que soit la distance, quel que soit le gain. Ce n'est pas un réglage et ce n'est pas un
  arbitrage : ne propose jamais, même « pour comparaison », une boucle qui laisse un camion dehors
  le week-end, et ne présente jamais un gain en km comme un argument contre cette règle.

**Le classement** des propositions : `score = km évités − 750 × jours de camion en plus − 400 ×
jours de retard − 200 × jours d'avance`. ⚠️ Deux champs à ne pas confondre dans une proposition :
`score` est une étiquette (`"excellent"`, `"bon"`, `"possible"`), `scoreClassement` est le nombre
qui classe.

**Constantes de calcul** : journée 7 h – 18 h du lundi au vendredi, 70 km/h, manutention 10 m³/h
(2 h minimum). Les distances sont à vol d'oiseau corrigées : cohérentes entre elles, mais
**inférieures de 25 à 30 % à un itinéraire routier**. Ne compare donc pas les km du rapport à ceux
d'un calculateur d'itinéraire ; compare-les entre eux.

**Pour le détail d'une règle** : `docs/regles-metier.md` (texte de référence, avec la date et le
cas fondateur de chaque règle), puis le code de `src/`, très commenté. Pour comprendre un refus,
lis-les plutôt que de supposer.

## 6. Lire le rapport du moteur en production

**Trois régimes**, pour séparer les effets :

| Régime | Ce qu'il dit |
|---|---|
| **A.** fil de l'eau · flotte réelle | ce que l'application proposerait, avec les vrais camions |
| **B.** fil de l'eau · un camion par lot | même ordre d'arrivée, la disponibilité des camions ne compte plus. **A → B = ce que coûtent les camions** |
| **C.** big bang · un camion par lot | plus d'ordre : le meilleur assortiment. **B → C = ce que coûte l'ordre d'arrivée** |

**Sections** : 1. synthèse par règle (boucles, retours, mutualisations, tournées à trois, greffes
retour, lots servis, km évités) · 2. pourquoi si peu de retours (2a couloirs, 2b entonnoir des
rejets couple par couple, 2c retours sans mutualisation, 2d profil des mutualisations) · 3. détail
boucle par boucle · 4. lecture.

**Comment interpréter :**

1. **Les chiffres à annoncer : boucles et km évités.** « Greffes retour » pour parler des retours
   (un retour porté par une tournée à trois y est compté).
2. **Le big bang est un plafond, le fil de l'eau un majorant** — jamais une promesse. Le planning
   part vide, le planificateur accepte toujours la meilleure proposition, l'agence d'en face dit
   toujours oui. Dis-le chaque fois que tu donnes un chiffre.
3. **Peu de retours n'est pas un bug.** Lis 2a d'abord (combien de lots dans chaque sens entre deux
   zones : le plus petit flux plafonne), puis 2b (à quelle marche les couples tombent).
4. **Tournées à trois : big bang très supérieur au fil de l'eau, c'est attendu.** Au fil de l'eau
   le lot qui arrive est toujours l'accroché : l'ancre d'une tournée doit être le premier confirmé
   des trois, et un lot qui a accepté une proposition ne peut plus ancrer la tournée qui l'attendait.
5. **« décidée non tenue à la pose » différent de zéro** : une boucle proposée que la pose n'a pas
   honorée. C'est un symptôme du moteur, pas du bruit. À signaler à l'équipe OneFleet avec le
   détail, avant de publier le moindre chiffre.
6. **Lot « sans camion » en A** : aucun camion de l'agence ne peut le prendre sans faire reculer un
   voisin (ou l'agence n'a pas de flotte, § 4).

## 7. Le moteur v2 — « la tournée éditable »

🟠 **Pas en production.** La maquette a été gelée le 2026-10-01 et le portage dans l'application
est en cours. Tout chiffre v2 se présente comme « ce que donnerait la v2 dans son état du
2026-10-01 », jamais comme le comportement de l'outil.

### Ce qui change de fond

- **La tournée devient l'objet que le planificateur ajuste à la main, à la maille de la journée.**
  Le moteur ne décide plus des dates : il **propose** et il **contrôle**. On lui décrit une tournée
  (un camion, des lots, l'ordre des arrêts, et pour chaque opération une date *imposée* ou
  *libre*) ; il rend un **verdict** (`ok`, `info`, `orange`, `refus`), des **signaux** en français
  et des **chiffres**. Il ne déplace jamais une date imposée ; il remplit les dates libres.
- **Le moteur en production n'est pas modifié** : la v2 l'importe (ses quatre fichiers sont
  identiques dans `src/engine/` et `v2/src/engine/`) et ajoute deux modules — `v2/src/engine/jour/`
  (le calcul à la journée) et `v2/src/engine/v2/` (la recherche de boucle v2).
- **Deux comptes** : chaque tournée est comptée *au large* et *au juste* (km par jour, marge de
  manutention). Tient au large : rien à signaler. Au juste seulement : orange « serré ». À aucun :
  refus. 🟠 Les valeurs ne sont pas figées (600 / 770 km par jour par défaut dans le module ; le
  lanceur de vivier garde les 650 / 770 du banc, écrits dans `jeu-viviers.mjs`).
- **« On donne ses lots, on n'en prend jamais »** : un planificateur place un lot vendu par son
  agence sur un camion, le sien ou celui d'une autre agence ; il ne va jamais chercher le lot d'une
  autre agence pour remplir ses camions. Dans une simulation sans geste humain, le camion d'une
  tournée est celui de l'agence du **premier lot chargé**.
- **La règle d'or s'étend aux 11 jours fériés nationaux** : aucun arrêt ce jour-là, et le camion
  est au dépôt. Toujours pas un réglage.
- **La règle des 150 km** (`coupureChargeeMaxKm`) : un camion ne rentre **chargé** au dépôt pour le
  week-end que si le dépôt est sur son chemin (arrêt d'avant ou d'après à 150 km du dépôt au plus,
  ou détour par le dépôt de 150 km au plus). Sinon refus `COUPURE_CHARGEE_LOIN`.
- **Le transbordement** (`transbo.js`) : de petits véhicules collectent chez le client, le poids
  lourd prend la marchandise au dépôt un autre jour ; l'arrêt du camion passe au dépôt de l'agence
  vendeuse. C'est le planificateur qui le coche. **Le garde-meubles** ne change que l'adresse.
- **La recherche ne défait rien** : elle ne casse jamais une tournée posée pour en former une
  meilleure. La réorganisation (« remix ») n'est pas dans la v2.
- **Tous les chargements sont libres dans leur flex** (± jours ouvrés autour de la date du CSV).
  C'est une différence de fond avec le moteur en production, où le chargement d'un lot vendu ne
  bouge pas. 🟠 La largeur de cette flex (± 5 jours) est une hypothèse d'analyse, pas une valeur
  arbitrée : c'est le réglage auquel les résultats sont le plus sensibles.

### Ce que contient `v2/`

| Chemin | Rôle |
|---|---|
| `v2/potentiel-v2.mjs` | le lanceur sur un vivier. Écrit pour ce paquet : il ne contient aucune règle, il enchaîne trois fonctions du banc |
| `v2/exemples/evaluer-une-tournee.mjs` | modèle pour juger **une** tournée décrite à la main (lots fictifs). Écrit pour ce paquet |
| `v2/src/engine/jour/README.md` | **le contrat du module** : forme de l'entrée et de la sortie, tous les codes de signaux, tous les réglages et leur statut (arbitré, hypothèse, à caler). À lire avant d'écrire un script v2 |
| `v2/src/engine/jour/` | `tournee.js` (`evaluerTournee`, `proposerDecalage`), `passe.js` (le calcul), `gardes.js` (G1, G2, G5), `planning.js` (`evaluerPlanning` : un camion, plusieurs tournées), `geste.js` (`controlerGeste` : ce qu'un geste a le droit de toucher), `calendrier.js`, `feries.js`, `transbo.js`, `reglages.js` |
| `v2/src/engine/v2/` | `enumeration.js` (toutes les tournées possibles d'un ensemble de lots), `recherche.js` (`rechercherBoucle` : ce que l'application propose à la saisie d'un lot), `adaptateur.js` (lecture d'un planning) |
| `v2/scripts/banc/lib/` | les modules du banc de cas réels utilisés par le lanceur (`vivier`, `jeu-viviers`, `jeu-recherche`, `interdits`, `reglages-banc`…) |

Les chemins `/home/dev/…` et `/essais/…` cités dans les commentaires et dans le contrat sont ceux
du serveur de l'équipe OneFleet : ils n'existent pas ici. De même, `reglages-banc.mjs` nomme des
viviers et des fichiers par défaut que le paquet ne contient pas ; le lanceur ne s'en sert pas.

### Lancer

```bash
node v2/potentiel-v2.mjs --csv "mon-vivier.csv" > rapport-v2.txt 2> progression-v2.txt
node v2/exemples/evaluer-une-tournee.mjs          # juger une tournée décrite à la main
```

| Option | Effet |
|---|---|
| `--flex 5` *(défaut)* | flex de chargement de **tous** les lots, ± jours ouvrés. Une seule valeur par passe |
| `--exclure code1,code2` | codes de lots retirés sur décision |
| `--reglages fichier.json` | réglages : `{ "module": { … }, "banc": { … } }`. `module` part tel quel dans le calcul (clés : contrat § 5) ; `banc` règle la simulation (clés et défauts : `v2/scripts/banc/lib/reglages-banc.mjs`). Ex. `{ "module": { "rendementMinKmJ": 550 } }` |
| `--sans-recherche` | ne pas rejouer le fil de l'eau par la recherche de boucle (plus rapide) |
| `--json resultat.json` | écrire aussi le détail complet, pour l'exploiter par script |
| `--blob autre.json` | d'autres référentiels que `referentiels.json` |

### Lire le rapport v2

1. **Le périmètre** : lots lus, retenus, écartés par motif. Les lots d'une agence sans camion sont
   écartés d'emblée.
2. **Les tournées possibles** : toutes les combinaisons de 2 et 3 lots que le module juge
   faisables. C'est un **univers**, pas un plan : un même lot figure dans plusieurs tournées. La
   *forme* dit la structure : sans « + » c'est une mutualisation (`2` = deux lots ensemble), avec
   « + » un retour (`1+1`, `2+1` = deux lots à l'aller et un au retour). Les refus sont comptés
   par motif (calendrier, G2, G5…).
3. **Au fil de l'eau** : les lots arrivent dans l'ordre de confirmation, chacun rejoint la
   meilleure tournée possible sans en défaire aucune.
4. **Au fil de l'eau rejoué par la recherche v2** : même principe, mais chaque lot est cherché par
   la recherche de l'application. C'est la lecture la plus proche de ce que la v2 proposerait. Les
   **interdits** y sont vérifiés sur chaque proposition (règle d'or, capacité, date confirmée, « on
   n'en prend jamais », « la recherche ne défait rien ») : **une violation est une anomalie du
   moteur**, à signaler à l'équipe OneFleet avant tout chiffre.

Ces chiffres sont des **majorants**, comme ceux du § 6. Le rapport v2 n'a ni régime « flotte
réelle » camion par camion (la flotte est tenue par comptage), ni big bang (dans le dépôt, il passe
par un solveur Python qui n'est pas embarqué). **Ne compare pas ligne à ligne un rapport v2 et un
rapport du moteur en production** : les conventions de dates diffèrent (dernier point du § « Ce qui
change »). Compare les ordres de grandeur, et dis pourquoi ils diffèrent.

**Ce que le lanceur de vivier n'exerce pas** : le transbordement, le garde-meubles, les dates
confirmées ou épinglées, la capacité forcée, la route forcée — le CSV n'a pas de colonne pour eux.
Pour les tester, décrire la tournée à la main et appeler `evaluerTournee`
(`v2/exemples/evaluer-une-tournee.mjs`, contrat § 4, § 13 et § 14 pour le transbordement).

## 8. Aller plus loin que les rapports

Pour une autre question (pourquoi ces deux lots-là ne bouclent pas, que donnerait un autre
réglage), écris un **petit script à côté** qui importe les mêmes briques.

### Avec le moteur en production

Modèle à suivre : `scripts/analyse-potentiel-boucles.mjs`. Écrire le script dans `scripts/`.

```js
import fs from "node:fs";
import { chargerLotsCsv } from "./lib/csv-lots.mjs";
import { simuler, creerPlanning, poserSeul, axePour } from "./lib/fil-eau.mjs";
import { findBoucleCandidates } from "../src/engine/boucleEngine.js";
import { RULES_DEFAULTS, normaliserSeuilsProx } from "../src/data/referentiels.js";

const blob = JSON.parse(fs.readFileSync("referentiels.json", "utf8"));
// Les règles se fusionnent TOUJOURS ainsi : c'est ce que fait l'application.
const rules = { ...RULES_DEFAULTS, ...normaliserSeuilsProx(blob.rules || {}) };
const { agencesData = [], vehicles = [] } = blob;
const { lots, qual } = chargerLotsCsv({ csvPath, flex: 5, agencesData, dedoublonner: true });
```

- **`simuler({ lots, rules, vehicles, agencesData, debut, zonesMoteur, avecMutu, parScore, … })`**
  (`lib/fil-eau.mjs`) — rejoue tout le vivier au fil de l'eau. Rend `boucles`, `mutus`,
  `propositions` (toutes, admises ou non), `sansCamionIds`, `poses`, `placements`. Les options sont
  documentées au-dessus de la fonction. Pour une mesure neuve : `avecMutu: true, parScore: true,
  avecReaffectation: true, choixCamion: "libre"`.
- **`findBoucleCandidates(lot, lotsDejaPoses, placements, axe, rules, vehicles, agencesData)`**
  (`src/engine/boucleEngine.js`) — le cœur : pour un lot à placer, les boucles possibles avec les
  lots **déjà posés sur un camion**. Rend un tableau de propositions (`type`, `partnerLot`,
  `partnerPlId`, `kmEco`, `scoreClassement`, `_mesures`…). Pour tester un couple précis : poser
  l'ancre avec `creerPlanning` + `poserSeul`, puis appeler le moteur pour l'accroché.
- **`entonnoirRetours`** (`lib/diagnostic-retours.mjs`) — soumet chaque couple au moteur et lit le
  **motif de rejet** dans son journal. C'est le modèle à reprendre pour répondre à « pourquoi pas ».

**Pièges déjà payés — à relire avant d'écrire un script :**

- 🔴 **`zonesMoteur` vaut `[]` par défaut dans `simuler`, ce qui supprime toute contrainte de
  territoire.** Pour mesurer le moteur tel qu'il tourne, passer `zonesMoteur: rules.zonesRetour`.
- **Les boucles écartées** (faute de camion, par exemple) sont dans `resultat._bloques`, une
  propriété **non énumérable** : elle se lit sur le tableau rendu par le moteur, jamais sur un
  `.filter()` ou une copie.
- **Le moteur cherche parmi les lots posés**, pas dans la liste des lots : un lot qui n'est sur
  aucun camion ne sera jamais ancre.
- **Les liens de boucle s'écrivent par `ecrireLien`** (`src/utils/boucleLiens.js`), jamais à la
  main : sinon greffer un retour derrière une paire mutualisée écrase le lien de la paire.
- **Le moteur n'affiche que 3 propositions** par lot : c'est un plafond d'écran. Dès qu'on filtre
  les propositions après coup, il faut le lever, sinon des propositions refusées masquent les
  bonnes (voir `reglesG1` dans `lib/diagnostic-retours.mjs`, qui le fait pour mesurer « 4 points »).
- **Changer un réglage pour voir** se fait sur la copie des règles passée au moteur
  (`{ ...rules, gardeDetourRetourKm: 400 }`), jamais dans `src/data/referentiels.js` ni dans
  `referentiels.json`. Et le compte rendu dit quel réglage a été changé.
- Dans le moteur, les dates sont au format `aaaa-mm-jj` ; dans le CSV, `jj/mm/aaaa`.

### Avec le moteur v2

- **Juger une tournée** : `evaluerTournee(entree, reglages)` — partir de
  `v2/exemples/evaluer-une-tournee.mjs`. Les réglages se passent **en second argument, partiels**
  (`{ rendementMinKmJ: 550 }`), jamais en modifiant `reglages.js`.
- **Toutes les tournées possibles d'un vivier, lot par lot** : `univers` puis
  `U.comptes.juste.tournees` (`v2/scripts/banc/lib/jeu-viviers.mjs`) — chaque tournée porte ses
  `membres`, sa `forme`, sa séquence `seq`, ses jours et ses km évités. C'est là qu'on répond à
  « ces lots-là peuvent-ils rouler ensemble, et sinon pourquoi » (`refus`, `motifsCal`).
- **Ce que la recherche propose pour un lot** : `rechercherBoucle` (`v2/src/engine/v2/recherche.js`),
  appelée comme dans `filDeLeauRecherche` (`v2/scripts/banc/lib/jeu-recherche.mjs`). Elle rend les
  `propositions` **et** les `ecartees` avec leur motif.
- 🔴 **Les zones de territoire sont muettes par défaut dans `evaluerTournee`** (`reglages.zones`
  vide) : G1 n'y juge rien tant qu'on ne lui passe pas les zones et l'annuaire des agences
  (`{ zones: rules.zonesRetour, agencesData }`). Le lanceur de vivier, lui, les passe.

## 9. Ce que ce paquet ne contient pas

À dire quand on te demande « est-ce que l'outil ferait ça » :

- **Le planning réel.** Les simulations partent d'un planning vide : aucun lot déjà posé n'occupe
  les camions, aucune boucle n'existe déjà.
- **Les décisions humaines.** Le refus d'une boucle par une agence, les dates confirmées au client,
  les verrous posés par les planificateurs : ici, tout le monde dit oui, et tout de suite.
- **Les écrans et les droits.** Qui voit quoi, qui a le droit de poser quoi : rien de cela n'est
  dans le moteur.
- **Un calculateur d'itinéraires.** Toutes les distances sont à vol d'oiseau corrigées (§ 5).
- **Le meilleur assortiment en v2** (§ 7), et tout ce que la v2 repousse à plus tard :
  réorganisation de tournées existantes, « compléter ma boucle », fusion de deux boucles.

## 10. Ce que ton compte rendu doit toujours dire

1. **Quel moteur** : en production, ou v2 (et alors : « pas en production »).
2. Le **vivier** : nom du fichier, lots lus, lots retenus, lots écartés et pourquoi.
3. Les **réglages** : les premières lignes du rapport (zones, détour, rendement, flex), et tout ce
   que tu as changé par rapport à `referentiels.json` et aux défauts.
4. La **version** du moteur (`VERSION.txt` ou `v2/VERSION.txt`) et la date des référentiels.
5. Pour chaque chiffre, son **régime** et sa **flex**. Un chiffre de big bang présenté sans le mot
   « plafond » sera pris pour une promesse.
6. Ce que tu n'as **pas** pu vérifier.
