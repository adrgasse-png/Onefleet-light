# Retours à vide — OneFleet light

Outil autonome (un seul fichier HTML, sans serveur) qui lit les plannings Excel des agences, repère les
camions qui rentrent à vide, et cherche les chantiers d'autres agences qui pourraient remplir ce retour.

**Depuis la v5, chaque piste est jugée par le moteur v2 de OneFleet** (`moteur/engine/jour`,
`evaluerTournee` et `evaluerPlanning`), et non plus par le calcul maison du POC v4 (`poc/`).

## Utiliser

Ouvrir `dist/retours-a-vide.html` dans un navigateur, choisir la période, importer le zip des plannings.
Rien ne sort du poste : les données restent dans le navigateur.

## Construire, tester

```bash
npm install          # esbuild, seule dépendance (construction)
npm test             # tests du cœur d'analyse sous Node (moteur réel, cas fictifs)
npm run build        # → dist/retours-a-vide.html
node test/fabriquer-plannings.cjs && node test/navigateur.cjs   # essai dans Chromium (Playwright)
```

## Organisation

| Chemin | Rôle |
|---|---|
| `moteur/` | **copie à l'identique** de `v2/src` de l'extrait `onefleet-moteur-boucles` du 02/10/2026 (version dans `moteur/VERSION.txt`). Ne pas modifier : voir `CLAUDE.md` |
| `src/analyse.js` | lecture des plannings, trajets, retours à vide (repris du POC) ; **adaptateur vers le moteur** : décrit chaque piste comme une tournée, lit le verdict |
| `src/ui.js`, `src/styles.css`, `src/index.html` | l'interface, au vocabulaire et à la charte OneFleet (`moteur/styles/tokens.js`, `docs/regles-metier.md` § « rôles ») : **ANC** (ancre, le camion qui rentre à vide) et **ACC** (accroché, le chantier repris), arrêts CHG / LIV, Gantt à barres client, liste des propositions à gauche (↑ ↓) et fiche à droite |
| `src/carte.json` | fond de carte, centres de départements, référentiel des dépôts (repris du POC) |
| `vendor/` | SheetJS et JSZip, tels qu'embarqués dans le POC |
| `docs/` | `regles-metier.md` (règles du moteur en production) et `moteur-CLAUDE.md` (mode d'emploi de l'extrait) |
| `poc/` | le POC v4, pour comparaison |

## Ce que le moteur apporte par rapport au POC

| | POC v4 | v5 (moteur v2) |
|---|---|---|
| Calendrier | simulation maison heure par heure | passe du moteur en demi-journées, livraison qui déborde sur le lendemain matin |
| Marge | une seule lecture | deux comptes : **au large** (600 km/j, manutention + 15 %) et **au juste** (630 km/j) ; « Serré » quand seul le juste tient |
| Week-end et fériés | règle maison | règle d'or du moteur (11 fériés nationaux), coupure chargée et règle des 150 km du moteur |
| Km évités | formule géométrique entre centres de départements × 1,25 | lots faits seuls − tournée, même passe, retours dépôt du week-end compris, entre codes postaux |
| Détour, rendement | formule maison | garde-fous G2 / G5 du moteur, greffe par greffe |
| Camion déjà pris | jour de planning occupé | `evaluerPlanning` contre le chantier suivant du camion |
| Messages | codes courts | phrases du moteur (signaux), affichées telles quelles |

## Abaques

Les abaques du moteur extrait (10 m³ par heure et par déménageur, journée de 11 h, 770 km/j) sont
**anciennes**. L'outil applique celles transmises le 02/10/2026, **sans modifier le moteur**, par ses
réglages et ses entrées :

| | Valeur | Comment elle arrive au moteur |
|---|---|---|
| Manutention | m³ par personne et par journée de 9 h : Access 24, Access + 22, Standing 20, Standing + 16, Optimum 16 ; livraison = chargement + 20 % | `dureeH` de chaque opération (CHG et LIV séparément), calculée dans `src/analyse.js` (`durees`) ; prestation lue dans le planning, sinon celle des réglages |
| Journée | 9 h | `heuresJour: 9` |
| Conduite | 9 h, 70 km/h, 630 km/j, départ vers 7 h 30 | compte juste `kmParJour: 630` ; le compte large reste à 600 km/j + 15 % (défaut du moteur, « à confirmer ») |

## Points à trancher

1. 🔴 **Anomalie du moteur à remonter à OneFleet : la rallonge du rendement (G5) ignore les durées passées.**
   `g2g5Tournee` (`moteur/engine/jour/gardes.js`, l. 139) calcule `rallongeJ = (détour / 70 + manutAccroche(lot)) / HEURES_JOUR` :
   la manutention est recalculée avec l'ancienne abaque du moteur (`manutHeures` : 10 m³/h par ETP, plancher 2 h)
   au lieu de lire `dureeH`, et la journée est la constante 11 h au lieu de `reglages.heuresJour`. Vérifié : 5, 15 et
   60 m³ → 0,412 j ; 41 m³ → 0,775 j (au-delà de 50 m³ l'équipe supposée passe à 3, la rallonge baisse). G5 est
   donc trop permissif sur les gros volumes et ne suit pas les abaques. Fiche détaillée partagée avec l'équipe
   OneFleet (reproduction, cause, correction proposée). Non corrigé ici (le moteur n'est pas modifié).
2. **Rendement minimum 300 km/j** (OneFleet : 750). Choix du POC, calé sur les retours de Metz 2025 avec
   l'ancienne manutention terrain (20 m³ par personne et par jour, toutes prestations) : à revoir avec les
   nouvelles abaques, et une fois G5 corrigé.
3. **Compte large** : 600 km/j + 15 % de marge, défaut du moteur, désormais proche du compte juste (630).
   Une valeur cohérente avec les nouvelles abaques reste à arbitrer.
4. **Rechargement le jour de la livraison de l'ancre.** Le réglage `deuxOpsParJour: "jamais"` du moteur compte
   aussi le débordement d'une livraison sur le lendemain matin. L'outil garde donc la règle du POC (pas de
   CHG ACC le jour où la LIV ANC *commence*), en filtre.
5. **Dates de l'ancre.** Ce sont celles du planning. Si le moteur ne les tient pas, l'outil relâche le
   chargement de l'ancre, puis sa livraison, et l'écrit dans la fiche.
6. **Territoire (G1) non appliqué** : les plannings ne donnent pas les zones de chalandise des agences.

Le moteur v2 n'est **pas en production** (maquette gelée le 01/10/2026). Les chiffres sont ceux que
donnerait la v2 dans cet état, sur des distances à vol d'oiseau corrigées (environ 25 % sous la route).
