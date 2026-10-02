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
| Calendrier | simulation maison heure par heure | passe du moteur à la journée, temps continu, livraison qui déborde sur le lendemain matin |
| Marge | une seule lecture | deux comptes : **au large** (600 km/j, manutention + 15 %) et **au juste** (770 km/j) ; « Serré » quand seul le juste tient |
| Week-end et fériés | règle maison | règle d'or du moteur (11 fériés nationaux), coupure chargée et règle des 150 km du moteur |
| Km évités | formule géométrique entre centres de départements × 1,25 | lots faits seuls − tournée, même passe, retours dépôt du week-end compris, entre codes postaux |
| Détour, rendement | formule maison | garde-fous G2 / G5 du moteur, greffe par greffe |
| Camion déjà pris | jour de planning occupé | `evaluerPlanning` contre le chantier suivant du camion |
| Messages | codes courts | phrases du moteur (signaux), affichées telles quelles |

## Points à trancher (les chiffres en dépendent)

1. **Manutention : 20 m³ par déménageur et par jour (terrain) contre 10 m³ par heure (moteur), soit 5,5 fois
   plus lent.** L'outil passe la cadence terrain au moteur (`manutHeures`, réglage `manutRatio`). Avec elle,
   beaucoup de tournées ne tiennent qu'« au juste » : elles sortent **Serré**. C'est l'écart le plus
   important entre l'outil et OneFleet, à remonter à l'équipe OneFleet.
2. **Rendement minimum 300 km/j** (OneFleet : 750). Choix du POC, justifié par les retours réels de Metz
   2025. Passé au moteur comme réglage ; le moteur lui-même n'est pas modifié.
3. **Rechargement le jour de la livraison A.** Le réglage `deuxOpsParJour: "jamais"` du moteur compte aussi
   le débordement d'une livraison sur le lendemain matin, ce qui écartait presque tout. L'outil garde donc
   la règle du POC (pas de chargement B le jour où la livraison A *commence*), en filtre.
4. **Dates du chantier A.** Ce sont celles du planning. Si le moteur ne les tient pas (avec la manutention
   terrain), l'outil relâche le chargement de A, puis sa livraison, et l'écrit dans la fiche.
5. **Territoire (G1) non appliqué** : les plannings ne donnent pas les zones de chalandise des agences.

Le moteur v2 n'est **pas en production** (maquette gelée le 01/10/2026). Les chiffres sont ceux que
donnerait la v2 dans cet état, sur des distances à vol d'oiseau corrigées (environ 25 % sous la route).
