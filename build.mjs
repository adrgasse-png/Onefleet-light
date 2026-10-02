// Construit dist/retours-a-vide.html : un seul fichier autonome (comme le POC), à ouvrir dans un navigateur.
//   npm install && npm run build
import fs from "node:fs";
import { build } from "esbuild";

const lire = p => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const r = await build({
  entryPoints: [new URL("./src/ui.js", import.meta.url).pathname],
  bundle: true, format: "iife", target: "es2020", minify: true, write: false, charset: "utf8",
  loader: { ".json": "json" }, legalComments: "none",
});
const app = r.outputFiles[0].text;
// `</script>` dans une chaîne casserait la page : on l'échappe.
const sur = s => s.replace(/<\/script/gi, "<\\/script");
let html = lire("./src/index.html");
const remplacer = (marque, contenu) => { const i = html.indexOf(marque); if (i < 0) throw new Error("marque absente : " + marque); html = html.slice(0, i) + contenu + html.slice(i + marque.length); };
remplacer("/*STYLES*/", lire("./src/styles.css"));
remplacer("/*XLSX*/", sur(lire("./vendor/xlsx.full.min.js")));
remplacer("/*JSZIP*/", sur(lire("./vendor/jszip.min.js")));
remplacer("/*APP*/", sur(app));
fs.mkdirSync(new URL("./dist/", import.meta.url), { recursive: true });
const out = new URL("./dist/retours-a-vide.html", import.meta.url);
fs.writeFileSync(out, html);
console.log(`dist/retours-a-vide.html : ${(html.length / 1024 / 1024).toFixed(2)} Mo (application ${(app.length / 1024).toFixed(0)} ko)`);
