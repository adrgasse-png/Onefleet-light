# OneFleet light — consignes pour un agent

- 🔴 **Ne modifie aucun fichier de `moteur/`.** C'est une copie à l'identique du moteur v2 de OneFleet
  (`moteur/VERSION.txt`) ; un moteur retouché n'est plus le leur. Une règle qui paraît fausse se décrit à
  l'utilisateur (lots, dates, attendu, obtenu) pour remonter à l'équipe OneFleet.
- 🔴 **Ne réimplémente aucune règle du moteur dans `src/`.** Pour juger une piste : décrire la tournée et
  appeler `evaluerTournee` / `evaluerPlanning` (`moteur/engine/jour/README.md`, contrat § 4 à § 6). Les
  seuils passent en **réglages partiels** (second argument), jamais en éditant `reglages.js`.
- Ce qui est propre à l'outil (lecture des plannings, trajets, filtres d'affichage) est dans
  `src/analyse.js`, au-dessus de l'adaptateur ; le dire quand on y touche.
- Mettre à jour le moteur : remplacer `moteur/` par le `v2/src` d'un nouvel extrait, recopier son
  `VERSION.txt`, puis `npm test` et `node test/navigateur.cjs`.
- Après tout changement : `npm test`, `npm run build`, et committer `dist/retours-a-vide.html` (c'est
  le fichier que les agences ouvrent).
- Langue : français, dans le code comme dans l'interface.
