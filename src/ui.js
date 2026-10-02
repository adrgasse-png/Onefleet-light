/* Interface « Retours à vide ». Le calcul est dans analyse.js (moteur v2 de OneFleet). */
import { Boucles } from "./analyse.js";
import BD from "./carte.json";

/* ---------- utilitaires ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MOIS_UP = ["JANVIER", "FEVRIER", "MARS", "AVRIL", "MAI", "JUIN", "JUILLET", "AOUT", "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DECEMBRE"];
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const mois = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const fd = s => { const d = new Date(s + "T12:00"); return d.getDate() + " " + mois[d.getMonth()]; };
const nf = n => Math.round(n).toLocaleString("fr-FR");
const f1 = n => (Math.round(n * 10) / 10).toLocaleString("fr-FR");
const up = Boucles.up;
const normP = s => up(s).replace(/^PLANNING\s+/, "").replace(/\s+V\d+$/, "").replace(/\s+20\d\d$/, "").replace(/\s+V\d+$/, "").trim();
const { minx, miny, S, C } = BD.proj;
const proj = ([lat, lon]) => [+(((lon + 5.5) * C - minx) * S + 10).toFixed(1), +(((51.3 - lat) - miny) * S + 10).toFixed(1)];
const CENT = {}; Object.entries(BD.dep).forEach(([k, v]) => CENT[k] = [v[0], v[1]]);
const depName = d => BD.dep[d] ? BD.dep[d][2] : d;
const hav = (a, b) => { const R = 6371, t = Math.PI / 180, dl = (b[0] - a[0]) * t, dn = (b[1] - a[1]) * t, x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
function nearestDept(lat, lon) { let best = null, bd = 1e9; for (const k in CENT) { const x = hav([lat, lon], CENT[k]); if (x < bd) { bd = x; best = k; } } return best; }
const PKEY = "boucles-params-v6";
const PDEF = { minEmpty: 200, minLoaded: 150, detMax: 500, rend: 300, gapMax: 3, flexB: 0, sameDayVol: 0, m3PerDay: 20, we150: 150 };
let params = { ...PDEF };
try { const s = JSON.parse(localStorage.getItem(PKEY) || "null"); if (s) params = { ...params, ...s }; } catch (e) { /* stockage indisponible */ }

/* ---------- dépôt de chaque camion ---------- */
function baseOf(t) {
  const p = normP(t.planning), a = up(t.agency);
  const rows = BD.ref.filter(r => normP(r[0]) === p);
  let r = rows.find(r => up(r[1]) === a && a) || BD.ref.find(r => a && (up(r[1]) === a || up(r[2]) === a || up(r[3]) === a));
  let how = "agence";
  if (!r && rows.length === 1) { r = rows[0]; how = "planning"; }
  if (r && r[6] !== "" && r[7] !== "") { const d = nearestDept(+r[6], +r[7]); return { key: p + "|" + up(r[1] || r[2]), dept: d, pos: CENT[d], cp: Boucles.cpProche(+r[6], +r[7]), label: r[2], how }; }
  if (rows.length) {
    const pl = rows.filter(r => r[6] !== ""), lat = pl.reduce((s, r) => s + +r[6], 0) / pl.length, lon = pl.reduce((s, r) => s + +r[7], 0) / pl.length;
    if (pl.length) { const d = nearestDept(lat, lon); return { key: p + "|" + a, dept: d, pos: CENT[d], cp: Boucles.cpProche(lat, lon), label: t.agency || p, how: "planning (centre)" }; }
  }
  const f = {}; t.days.forEach(x => { if (x.lot && typeof x.lot.c === "string" && CENT[x.lot.c]) f[x.lot.c] = (f[x.lot.c] || 0) + 1; });
  const d = Object.entries(f).sort((a, b) => b[1] - a[1])[0];
  return d ? { key: p + "|" + a, dept: d[0], pos: CENT[d[0]], cp: Boucles.cpProche(CENT[d[0]][0], CENT[d[0]][1]), label: t.agency || p, how: "déduit des chargements" } : null;
}

/* ---------- état et stockage (la dernière importation est conservée dans le navigateur) ---------- */
let TRUCKS = [], RES = null, REPORT = [], META = null, lastFiles = null, tab = "opp", sel = null, agFilter = "", ROUTE = null, rsel = null;
const DB = {
  db: null,
  open() { return new Promise(r => { try { const q = indexedDB.open("retours-vide", 1); q.onupgradeneeded = () => q.result.createObjectStore("kv"); q.onsuccess = () => { this.db = q.result; r(true); }; q.onerror = () => r(false); } catch (e) { r(false); } }); },
  op(m, f) { return new Promise((r, j) => { if (!this.db) return r(null); const q = f(this.db.transaction("kv", m).objectStore("kv")); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); }); },
  get(k) { return this.op("readonly", s => s.get(k)); }, put(k, v) { return this.op("readwrite", s => s.put(v, k)); }, clear() { return this.op("readwrite", s => s.clear()); },
};

/* ---------- import ---------- */
function startValue() { return $("mStart").value; }
function targets() { const [y, m] = startValue().split("-").map(Number), n = +$("mCount").value; return Array.from({ length: n }, (_, k) => ({ y: y + Math.floor((m - 1 + k) / 12), m: (m - 1 + k) % 12 })); }
function initSelects() {
  const s = $("mStart"), now = new Date(); let h = "";
  for (let k = -12; k <= 6; k++) { const d = new Date(now.getFullYear(), now.getMonth() + k, 1); const v = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); h += `<option value="${v}"${k === 0 ? " selected" : ""}>${MOIS_FR[d.getMonth()]} ${d.getFullYear()}</option>`; }
  s.innerHTML = h; const re = () => { if (lastFiles) importFiles(lastFiles); }; s.addEventListener("change", re); $("mCount").addEventListener("change", re);
  // liste des agences pour la recherche : département | CP du dépôt | clé
  const ags = [...new Map(BD.ref.filter(r => r[6] !== "" && r[7] !== "").map(r => [r[2], r])).values()].sort((a, b) => a[2].localeCompare(b[2], "fr"));
  $("agTpl").innerHTML = `<option value="">Non précisée</option>` + ags.map(r => `<option value="${esc(nearestDept(+r[6], +r[7]))}|${esc(Boucles.cpProche(+r[6], +r[7]))}|${esc(normP(r[0]) + "|" + up(r[1] || r[2]))}">${esc(r[2])}</option>`).join("");
}
async function expandFiles(list) {
  const out = [];
  for (const f of list) {
    if (/\.zip$/i.test(f.name)) {
      const z = await JSZip.loadAsync(f);
      z.forEach((p, e) => { const b = p.split("/").pop(); if (!e.dir && /\.(xlsb|xlsx|xlsm|xls)$/i.test(b) && !b.startsWith("~$") && !p.startsWith("__MACOSX")) out.push({ name: b, mtime: e.date ? e.date.getTime() : 0, get: () => e.async("arraybuffer") }); });
    } else out.push({ name: f.name, mtime: f.lastModified || 0, get: () => f.arrayBuffer() });
  }
  return out;
}
const tick = () => new Promise(r => setTimeout(r, 0));
function say(h, k) { const m = $("msg"); m.className = k || ""; m.innerHTML = h; }
async function importFiles(list) {
  lastFiles = list; const T = targets(), wanted = new Set(T.map(t => MOIS_UP[t.m])); const t0 = performance.now();
  let files; try { files = await expandFiles(list); } catch (e) { say("Import refusé : " + esc(e.message || e), "err"); return; }
  if (!files.length) { say("Aucun classeur Excel trouvé.", "err"); return; }
  const trucks = new Map(); const report = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i], planning = f.name.replace(/\.(xlsb|xlsx|xlsm|xls)$/i, "");
    say(`<b>Lecture ${i + 1} / ${files.length}</b> : ${esc(f.name)}<div class="prog"><i style="width:${(i / files.length * 100).toFixed(0)}%"></i></div>`); await tick();
    const rep = { planning, tabs: [], trucks: 0, lots: 0, err: "" }; report.push(rep);
    try {
      const buf = await f.get(); const names = XLSX.read(buf, { type: "array", bookSheets: true }).SheetNames;
      const cand = names.filter(n => { const u = up(n); return [...wanted].some(m => u === m || u.startsWith(m + " ")); });
      if (!cand.length) { rep.err = "aucun onglet du mois"; continue; }
      await tick(); const wb = XLSX.read(buf, { type: "array", sheets: cand, cellDates: true });
      cand.forEach(n => {
        const ws = wb.Sheets[n]; if (!ws) return; const r = Boucles.parseTrucksSheet(XLSX, ws, planning);
        if (!r) { rep.tabs.push(n + " : grille camions non reconnue"); return; }
        const ds = r.dates.slice().sort(), md = new Date(ds[Math.floor(ds.length / 2)] + "T12:00");
        if (!T.some(t => t.y === md.getFullYear() && t.m === md.getMonth())) return;
        rep.tabs.push(`${n} : ${r.trucks.length} camions`);
        r.trucks.forEach(tr => { const k = normP(planning) + "|" + (tr.plate || ("col" + tr.col + "|" + tr.agency)); const ex = trucks.get(k); if (ex) ex.days.push(...tr.days); else trucks.set(k, tr); });
      });
    } catch (e) { rep.err = "fichier illisible : " + (e.message || e); }
  }
  TRUCKS = [...trucks.values()];
  report.forEach(r => { const ts = TRUCKS.filter(t => t.planning === r.planning); r.trucks = ts.length; r.lots = ts.reduce((s, t) => s + t.days.filter(d => d.lot).length, 0); });
  REPORT = report; const mt = Math.max(0, ...files.map(f => f.mtime || 0));
  META = { source: list.length === 1 ? list[0].name : `${list.length} fichiers`, day: new Date(mt || Date.now()).toISOString().slice(0, 10), at: new Date().toISOString(), months: T.map(t => MOIS_FR[t.m] + " " + t.y) };
  try { await DB.put("last", { trucks: TRUCKS.map(t => ({ planning: t.planning, col: t.col, plate: t.plate, agency: t.agency, cap: t.cap, days: t.days.map(d => ({ d: d.d, lot: d.lot, active: d.active, retour: d.retour })) })), report: REPORT, meta: META }); } catch (e) { /* stockage indisponible */ }
  say(`<b>Calcul des retours par le moteur…</b>`); await tick();
  run();
  const sec = ((performance.now() - t0) / 1000).toFixed(0), bad = REPORT.filter(r => r.err || !r.lots);
  say(`<b>${files.length} fichier${files.length > 1 ? "s" : ""} lu${files.length > 1 ? "s" : ""} en ${sec} s</b> : ${TRUCKS.length} camions, ${RES.kpi.lots} chantiers, ${META.months.join(", ")} ; ${nf(RES.evals)} tournées soumises au moteur. Données conservées pour les recherches suivantes.` +
    (bad.length ? `<ul>${bad.map(r => `<li>⚠ <b>${esc(r.planning)}</b> : ${esc(r.err || "aucun chantier lu")}</li>`).join("")}</ul>` : "") +
    (RES.plannings < 2 ? `<p style="margin:6px 0 0">Un seul planning chargé : les retours à vide sont mesurés, mais les accrochés des autres régions demandent le zip complet.</p>` : ""), bad.length ? "err" : "ok");
}
function run() {
  const bases = new Map(); TRUCKS.forEach(t => { if (t.cap === undefined) t.cap = Boucles.capacityOf(t.plate); t.days.forEach(d => { delete d.dup; delete d.lotRef; }); bases.set(t, baseOf(t)); });
  const usable = TRUCKS.filter(t => bases.get(t) && bases.get(t).cp);
  RES = Boucles.analyse(usable, { centroids: CENT, baseOf: t => bases.get(t), params });
  RES.trucks = usable; RES.plannings = new Set(usable.map(t => normP(t.planning))).size; RES.noBase = TRUCKS.filter(t => !usable.includes(t));
  sel = RES.matches.find(m => m.keep) || null; ROUTE = null; rsel = null; header(); render();
}
function header() {
  $("src").innerHTML = META ? `Données du <b>${fd(META.day)} ${META.day.slice(0, 4)}</b> (${esc(META.source)}) : ${esc(META.months.join(", "))}.` : "Aucune donnée : choisissez la période, puis importez le zip des plannings.";
}

/* ---------- la fiche d'une proposition : vocabulaire OneFleet (ANC / ACC, CHG / LIV) ---------- */
const JW = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const fdw = s => s ? `${JW[Boucles.wd(s)]} ${fd(s)}` : "—";
const ROLE = { ANC: "anc", ACC: "acc" };
const pastille = r => `<span class="pa ${ROLE[r]}">${r}</span>`;
/* premier et dernier jour où un lot est manipulé (une livraison peut déborder sur le lendemain) */
function bornesLot(r, lot) {
  const js = (r.jours || []).filter(j => (j.activites || []).some(a => (a.genre === "CHG" || a.genre === "LIV") && a.lot === lot)).map(j => j.date);
  return js.length ? [js[0], js[js.length - 1]] : null;
}
/* Les segments du camion, à l'heure près : `tDebut` / `tFin` du moteur, sur l'axe des demi-journées
   (jour ouvré j = [2j, 2j + 2[, soit 7 h → 18 h). Une livraison qui déborde sur le lendemain matin figure
   dans `jours[]` aux deux dates : on la dédoublonne et on ne dessine que son créneau réel. Le reste de la
   journée est de la route, chargée ou à vide selon ce qui est à bord à ce moment-là. */
const HJ = 11, H0 = 7;
const heure = t => { const h = H0 + (t - 2 * Math.floor(t / 2)) / 2 * HJ, hh = Math.floor(h + 1e-6), mm = Math.round((h - hh) * 60); return `${hh} h ${String(mm === 60 ? 0 : mm).padStart(2, "0")}`; };
function segmentsDe(jours) {
  const vus = new Map(), pleins = [];
  (jours || []).forEach(j => (j.activites || []).forEach(a => {
    if (a.tDebut == null || a.tFin == null) { if (a.genre === "DEPOT" || a.genre === "VIDE") pleins.push({ date: j.date, a, aBord: j.aBord }); return; }
    const k = `${a.genre}|${a.lot || ""}|${a.vers || ""}|${a.tDebut}`;
    if (!vus.has(k)) vus.set(k, { ...a });
  }));
  const segs = [...vus.values()].sort((x, y) => x.tDebut - y.tDebut || x.tFin - y.tFin);
  // à bord : un lot monte à la fin de son CHG, descend au début de sa LIV
  const bord = new Set();
  segs.forEach(s => {
    if (s.genre === "ROUTE" || s.genre === "DEPOT") s.charge = bord.size > 0;
    if (s.genre === "CHG") bord.add(s.lot);
    if (s.genre === "LIV") bord.delete(s.lot);
  });
  return { segs, pleins };
}
function casesJours(jours) {
  const { segs, pleins } = segmentsDe(jours), cells = {};
  (jours || []).forEach(j => {
    const jo = Boucles.jourOuvre(j.date); if (jo == null) return;
    const t0 = 2 * jo, t1 = t0 + 2, morceaux = [];
    segs.forEach(s => {
      const a = Math.max(s.tDebut, t0), z = Math.min(s.tFin, t1);
      if (z - a < 1e-6) return;
      const l = (a - t0) / 2 * 100, w = (z - a) / 2 * 100;
      const suite = s.tDebut < t0 - 1e-6, continue_ = s.tFin > t1 + 1e-6;
      let cls, txt, tip;
      if (s.genre === "CHG" || s.genre === "LIV") {
        cls = "op " + (ROLE[s.lot] || ""); txt = `${s.genre} ${s.lot}`;
        tip = `${s.genre} ${s.lot} : ${heure(s.tDebut)} → ${heure(s.tFin)}${suite || continue_ ? " (sur deux journées)" : ""}`;
      } else if (s.genre === "ROUTE") {
        cls = s.charge ? "pl" : "vd"; txt = s.km ? `${nf(s.km)} km` : "";
        tip = `${s.charge ? "Trajet chargé" : "Trajet à vide"} vers ${s.vers || "?"} · ${nf(s.km || 0)} km · ${heure(s.tDebut)} → ${heure(s.tFin)}`;
      } else if (s.genre === "DEPOT") { cls = "dp" + (s.charge ? " ch" : ""); txt = s.charge ? "Dépôt · chargé" : "Dépôt"; tip = `Au dépôt dès ${heure(s.tDebut)}${s.charge ? ", chargé : repart livrer ensuite (règle des 150 km)" : ""}`; }
      else return;
      morceaux.push({ l, w, cls: cls + (suite ? " suite" : "") + (continue_ ? " cont" : ""), txt, tip });
    });
    const p = pleins.find(x => x.date === j.date);
    if (!morceaux.length && p) morceaux.push({ l: 0, w: 100, cls: "dp" + (p.aBord > 0 ? " ch" : ""), txt: p.aBord > 0 ? "Dépôt · chargé" : "Dépôt", tip: p.aBord > 0 ? `Au dépôt, ${nf(p.aBord)} m³ à bord` : "Au dépôt" });
    if (!morceaux.length) morceaux.push({ l: 0, w: 100, cls: "at", txt: "Attente", tip: "Jour sans activité dans la tournée" });
    cells[j.date] = { seg: morceaux };
  });
  return cells;
}
/* Gantt : une ligne par camion, la barre client au-dessus de ses arrêts */
function gantt(rows, from, to) {
  const days = []; for (let d = from; d && d <= to && days.length < 15; d = Boucles.addD(d, 1)) days.push(d);
  if (!days.length) return "";
  const col = d => days.indexOf(d) + 2;
  const off = d => Boucles.isOff(d);
  const head = `<div class="g-row g-head"><div class="g-lab"></div>${days.map(d => { const fe = Boucles.nomFerie(d); return `<div class="g-d${off(d) ? " ferme" : ""}"${fe ? ` title="${esc(fe)}"` : ""}>${JW[Boucles.wd(d)]}<b>${new Date(d + "T12:00").getDate()}</b>${fe ? "<i>férié</i>" : ""}</div>`; }).join("")}</div>`;
  const ligne = r => {
    const bands = (r.bandes || []).map(b => {
      const a = b.du < days[0] ? days[0] : b.du, z = b.au > days[days.length - 1] ? days[days.length - 1] : b.au;
      if (a > z || col(a) < 2) return "";
      return `<div class="g-band ${b.boucle ? "bcl" : ""}" style="grid-row:1;grid-column:${col(a)}/${col(z) + 1}" title="${esc(b.titre)}">${pastille(b.role)}<span>${esc(b.nom)}</span></div>`;
    }).join("");
    const cells = days.map((d, i) => {
      const c = r.cells[d], pos = `grid-row:2;grid-column:${i + 2}`;
      if (c && c.seg) return `<div class="g-c tl${off(d) ? " ferme" : ""}" style="${pos}">${c.seg.map(x => `<i class="sg ${x.cls}${x.w < 30 ? " court" : ""}" style="left:${x.l.toFixed(1)}%;width:${x.w.toFixed(1)}%" title="${esc(x.tip)}">${x.w >= 30 ? esc(x.txt) : ""}</i>`).join("")}</div>`;
      return `<div class="g-c${off(d) ? " ferme" : ""}${c ? " " + c.cls : ""}" style="${pos}"${c && c.tip ? ` title="${esc(c.tip)}"` : ""}>${c ? c.html : ""}</div>`;
    }).join("");
    return `<div class="g-row g-truck${r.attenue ? " attenue" : ""}"><div class="g-lab" style="grid-row:1/3"><b>${r.label}</b><span>${r.sub}</span></div>${bands}${cells}</div>`;
  };
  return `<div class="gantt" style="--n:${days.length}">${head}${rows.map(ligne).join("")}</div>
   <div class="g-key"><span><i class="k op anc"></i>arrêt ANC</span><span><i class="k op acc"></i>arrêt ACC</span><span><i class="k pl"></i>trajet chargé</span><span><i class="k vd"></i>trajet à vide</span><span><i class="k dp"></i>dépôt</span><span class="mut">une case = 7 h → 18 h ; survol : heures du moteur</span><span><i class="k ferme"></i>week-end, férié</span></div>`;
}
function bandesDe(r, f, boucle) {
  return ["ANC", "ACC"].map(role => { const b = bornesLot(r, role); if (!b) return null; return { role, du: b[0], au: b[1], nom: f[role].client, titre: `${role} · ${f[role].client} · ${f[role].c}→${f[role].l}`, boucle }; }).filter(Boolean);
}
function ganttDe(m, f) {
  const rows = [
    { label: `Camion ${esc(f.ANC.agence)}`, sub: "avec l'accroché", cells: casesJours(m.r.jours), bandes: bandesDe(m.r, f, true) },
    { label: `Camion ${esc(f.ANC.agence)}`, sub: "sans l'accroché", cells: casesJours(m.base.jours), bandes: bandesDe(m.base, f, false), attenue: true },
  ];
  if (m.chgAcc && f.camionAcc) {
    const c = {}; for (let d = m.chgAcc; d <= (m.livAcc || m.chgAcc); d = Boucles.addD(d, 1)) if (!Boucles.isOff(d)) c[d] = { html: f.accSeul ? "Libéré" : "Sa tournée", cls: "lib" };
    rows.push({ label: f.camionAcc, sub: f.accSeul ? "n'a plus l'accroché" : "garde sa tournée", cells: c, attenue: true });
  }
  const from = m.livAnc || (bornesLot(m.r, "ANC") || [])[1];
  const to = [m.retour, m.retourSeul, m.livAcc].filter(Boolean).sort().pop();
  return gantt(rows, from, to);
}

/* ---------- verdict, contrôles et signaux du moteur ---------- */
const NIV = { refus: "ko", rouge: "ko", orange: "wa", info: "na", ok: "ok" };
function verdictPill(m) {
  if (!m.ok) return `<span class="vp ko">${esc(WHY[m.why[0]] || m.why[0])}</span>`;
  return m.serre ? `<span class="vp wa" title="Ne passe qu'au compte serré : 770 km/j, sans marge de manutention">Serré</span>` : `<span class="vp ok" title="Passe avec la marge d'exploitation : 600 km/j, manutention + 15 %">OK</span>`;
}
function checks(m, vol, cap) {
  const P = params;
  const extra = m.retourSeul && m.retour ? Boucles.dayDiff(m.retourSeul, m.retour) : 0;
  const sig = m.signaux.filter(s => s.code !== "SERRE").map(s => `<li class="${NIV[s.niveau] || "na"}">${esc(s.message)}</li>`).join("");
  return `<ul class="checks">
    <li class="ok">Au dépôt chaque week-end et jour férié${m.retour ? ` · rentre ${fdw(m.retour)}` : ""}</li>
    ${m.coupure ? `<li class="ok">Rentre chargé au dépôt avant la coupure, repart ensuite : dépôt sur le chemin (règle des ${P.we150} km)</li>` : ""}
    ${vol == null || cap == null ? `<li class="na">Volume à vérifier${vol != null ? ` (${vol} m³, capacité inconnue)` : cap != null ? ` (capacité ${cap} m³, volume non renseigné)` : ""}</li>` : `<li class="ok">ACC ${vol} m³ pour ${cap} m³ de capacité</li>`}
    ${m.det != null ? `<li class="ok">Détour ${nf(m.det)} km (≤ ${nf(P.detMax)})</li>` : ""}
    ${m.rallJ != null ? `<li class="ok">Rendement : ${nf(m.eco)} km évités pour ${f1(m.rallJ)} jour de camion ajouté (minimum ${nf(m.rendMin)})</li>` : ""}
    ${m.serre ? `<li class="wa">Serré : passe au compte juste (770 km/j, sans marge), pas avec la marge d'exploitation</li>` : ""}
    ${extra > 0 ? `<li class="na">Camion au dépôt ${extra} jour${extra > 1 ? "s" : ""} plus tard que sans l'accroché (${fdw(m.retourSeul)})</li>` : ""}
    ${m.ajusteAnc ? `<li class="na">Dates de l'ancre relâchées (${m.ajusteAnc}) : celles du planning ne passent pas pour le moteur avec ${P.m3PerDay} m³ par déménageur et par jour</li>` : ""}
    ${sig}</ul>`;
}
const WHY = {
  "même jour": "rechargement le jour de la LIV ANC", "week-end": "dehors un week-end ou un férié", "150 km": "rentrerait chargé loin du dépôt (150 km)",
  "date": "dates intenables", "jour fermé": "date un jour fermé", "attente": `attente > ${params.gapMax} j ouvrés`, "camion pris": "camion déjà pris",
  "volume": "volume > capacité", "détour": "détour", "rendement": "rendement", "gain": "gain trop faible", "CP inconnu": "code postal inconnu", "territoire": "territoire",
};
const badge = (ok, yes, no, na) => ok === null || ok === undefined ? `<span class="bdg na">${na}</span>` : ok ? "" : `<span class="bdg ko">${no}</span>`;
const decal = s => s ? `<span class="bdg ko" title="Chargement de l'accroché déplacé : client à prévenir">CHG ACC ${s > 0 ? "+" : "−"}${Math.abs(s)} j</span>` : "";

/* le parcours, dans l'ordre du camion : Dépôt → CHG ANC → LIV ANC → CHG ACC → LIV ACC → Dépôt */
function parcours(m, f) {
  const at = (lot, type) => ((m.r.arrets || []).find(a => a.lot === lot && a.type === type) || {}).date;
  const arret = (n, role, type, lieu, extra) => `<li class="ar ${ROLE[role]}"><span class="pt ${ROLE[role]}">${n}</span><div><b>${type} ${role}</b> ${esc(lieu)}${extra ? ` · ${extra}` : ""}</div><time>${fdw(at(role, type))}</time></li>`;
  const troncon = (cls, txt) => `<li class="tr ${cls}"><span></span><div>${txt}</div></li>`;
  const A = f.ANC, B = f.ACC;
  return `<ol class="parc">
    <li class="dp"><span class="pt dp"></span><div><b>Dépôt</b> ${esc(A.agence)}</div></li>
    ${arret(1, "ANC", "CHG", `${depName(A.c)} (${A.c})`, `${esc(A.client)}${A.vol != null ? `, ${A.vol} m³` : ""}`)}
    ${troncon("pl", `${nf(A.km || 0)} km chargé`)}
    ${arret(2, "ANC", "LIV", `${depName(A.l)} (${A.l})`)}
    ${troncon("vd", m.repo ? `${nf(m.repo)} km à vide, au lieu de ${nf(m.empty)} km pour rentrer` : `sur place, au lieu de ${nf(m.empty)} km à vide pour rentrer`)}
    ${arret(3, "ACC", "CHG", `${depName(B.c)} (${B.c})`, `${esc(B.client)}${B.vol != null ? `, ${B.vol} m³` : ""}${m.shift ? ` · <b class="warn">${m.shift > 0 ? "+" : "−"}${Math.abs(m.shift)} j sur la date prévue (${fdw(B.d)}) : client à prévenir</b>` : ""}`)}
    ${troncon("pl", `${nf(m.loaded)} km chargé`)}
    ${arret(4, "ACC", "LIV", `${depName(B.l)} (${B.l})`)}
    ${troncon("vd", `${nf(m.after)} km à vide`)}
    <li class="dp"><span class="pt dp"></span><div><b>Dépôt</b> ${esc(A.agence)}</div><time>${fdw(m.retour)}</time></li>
    ${f.ownLegs ? `<li class="tr lib"><span></span><div>Votre camion évite l'aller-retour depuis votre agence : ${nf(f.ownLegs)} km à vide.</div></li>` : ""}</ol>`;
}
/* la fiche complète : en-tête, carte + contrôles, Gantt, parcours */
function fiche(m, f, carte) {
  return `<div class="f-head">
     <div class="f-km"><b>${nf(m.eco)} km</b><span>évités</span></div>
     <div class="f-roles">
       <div>${pastille("ANC")} <b>${esc(f.ANC.agence)}</b> · ${esc(f.ANC.client)} <span class="mut">${f.ANC.c}→${f.ANC.l} · ${esc(f.ANC.plaque || "")}${f.cap ? ` · ${f.cap} m³` : ""}</span></div>
       <div>${pastille("ACC")} <b>${esc(f.ACC.agence)}</b> · ${esc(f.ACC.client)} <span class="mut">${f.ACC.c}→${f.ACC.l}${f.ACC.vol != null ? ` · ${f.ACC.vol} m³` : ""}</span></div>
     </div>
     <div class="f-v">${verdictPill(m)}${m.near ? `<span class="bdg na">piste proche</span>` : ""}</div></div>
   ${ganttDe(m, f)}
   <div class="f-grid"><div class="map mini"><svg viewBox="${BD.vb.join(" ")}">${carte}</svg>
     <div class="legend"><span><i class="lg anc"></i>trajet ANC</span><span><i class="lg acc"></i>trajet ACC</span><span><i class="lg vd"></i>à vide</span><span><i class="lg evite"></i>vide évité</span></div></div>
     <div>${checks(m, f.ACC.vol, f.cap)}${parcours(m, f)}</div></div>
   <p class="meta">Calcul : moteur v2 de OneFleet (<code>evaluerTournee</code>), état du 01/10/2026, pas en production. Km évités = lots faits seuls depuis leur dépôt − tournée${f.accSeul === false ? ` (le camion de l'accroché garde sa tournée : son trajet n'est pas compté comme évité)` : ""}. Distances à vol d'oiseau × 1,25 à 1,4, entre codes postaux.${f.note ? " " + f.note : ""}</p>`;
}

/* ---------- carte : points numérotés dans l'ordre du parcours, couleur du rôle ---------- */
const truckOf = x => RES.trucks[x.truck];
const agLabel = t => t.base ? t.base.label : (t.agency || normP(t.planning));
const Pd = d => proj(CENT[d]);
const curve = (a, b, cls) => { const [x1, y1] = a, [x2, y2] = b, mx = (x1 + x2) / 2 - (y2 - y1) * .12, my = (y1 + y2) / 2 + (x2 - x1) * .12; return `<path class="${cls}" d="M${x1},${y1} Q${mx},${my} ${x2},${y2}"/>`; };
const point = (xy, n, role, lab) => `<g class="pt-c ${role}"><circle cx="${xy[0]}" cy="${xy[1]}" r="13"/><text class="n" x="${xy[0]}" y="${xy[1] + 5}">${n}</text>${lab ? `<text class="lb" x="${xy[0] + 12}" y="${xy[1] + 4}">${esc(lab)}</text>` : ""}</g>`;
const baseMark = (xy, t, cls) => `<rect class="base ${cls || ""}" x="${xy[0] - 8}" y="${xy[1] - 8}" width="16" height="16"/><text class="bl" x="${xy[0] + 12}" y="${xy[1] - 10}">${esc(t)}</text>`;
const land = () => BD.paths.map(d => `<path class="land" d="${d}"/>`).join("");
/* f : la fiche (ANC, ACC, dépôts) */
function carteFiche(f) {
  const A = f.ANC, B = f.ACC, dA = proj(f.depotAnc), out = [land()];
  if (CENT[A.c]) out.push(curve(Pd(A.c), Pd(A.l), "t-anc"));
  out.push(curve(Pd(A.l), dA, "t-evite"), curve(Pd(A.l), Pd(B.c), "t-vd"), curve(Pd(B.c), Pd(B.l), "t-acc"), curve(Pd(B.l), dA, "t-vd"));
  if (f.depotAcc && f.accSeul) out.push(curve(proj(f.depotAcc), Pd(B.c), "t-evite fin"), curve(Pd(B.l), proj(f.depotAcc), "t-evite fin"));
  out.push(baseMark(dA, A.agence));
  if (f.depotAcc) out.push(baseMark(proj(f.depotAcc), B.agence, "acc"));
  if (CENT[A.c]) out.push(point(Pd(A.c), 1, "anc"));
  if (A.l === B.c) out.push(point(Pd(A.l), "2·3", "acc"));
  else out.push(point(Pd(A.l), 2, "anc"), point(Pd(B.c), 3, "acc"));
  out.push(point(Pd(B.l), 4, "acc"));
  return out.join("");
}
function carteVue() { let out = land(); RES.trips.filter(t => t.isEmpty).forEach(t => { const tr = truckOf(t); if (CENT[t.lastL] && tr.base) out += curve(Pd(t.lastL), proj(tr.base.pos), "t-evite fin"); }); return out; }

/* ---------- liste des propositions (à gauche) ---------- */
function carteProp(m, i, f, attr) {
  return `<button class="pc${m.near ? " near" : ""}" ${attr}="${i}" role="option" aria-selected="false">
    <div class="pc-top"><b>${nf(m.eco)} km</b><span class="mut">évités</span>${verdictPill(m)}</div>
    <div class="pc-l">${pastille("ANC")}<span class="nm">${esc(f.ANC.agence)} · ${esc(f.ANC.client)}</span><span class="dt">LIV ${fdw(m.livAnc)}</span></div>
    <div class="pc-l">${pastille("ACC")}<span class="nm">${esc(f.ACC.agence)} · ${esc(f.ACC.client)}</span><span class="dt">CHG ${fdw(m.chgAcc)}</span></div>
    <div class="pc-b"><span class="mut">${f.ANC.l} → ${f.ACC.c} → ${f.ACC.l} · dépôt ${fdw(m.retour)}</span>${decal(m.shift)}${m.coupure ? `<span class="bdg na">week-end au dépôt, chargé</span>` : ""}${badge(m.volOk, "", "volume", "volume ?")}</div>
  </button>`;
}

/* ---------- onglet Opportunités ---------- */
function kpis() {
  const k = RES.kpi, x = k.excluded || {}; const xs = Object.entries(x).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${n} ${WHY[w] || w}`).join(", ");
  $("kpi").innerHTML = `<div><b>${nf(k.trips)}</b><span>trajets longue distance</span></div><div><b>${nf(k.emptyTrips)}</b><span>retours à vide ≥ ${params.minEmpty} km</span></div>
   <div><b>${nf(k.emptyKm)} km</b><span>roulés à vide (estimation)</span></div><div><b>${nf(k.loopsDone)}</b><span>boucles déjà faites</span></div>
   <div class="hl"><b>${nf(k.kept)}</b><span>propositions${k.serres ? `, dont ${k.serres} serrée${k.serres > 1 ? "s" : ""}` : ""}</span></div><div class="hl"><b>${nf(k.ecoTot)} km</b><span>évités, sans double compte</span></div>
   ${xs ? `<div class="xs"><strong>Pistes écartées par le moteur :</strong> ${esc(xs)}.</div>` : ""}`;
}
function filtered() { return RES.matches.filter(m => m.keep && (!agFilter || agLabel(truckOf(m.anc)) === agFilter || agLabel(truckOf(m.acc)) === agFilter)); }
/* la fiche d'une proposition du planning */
function ficheOpp(m) {
  const tA = truckOf(m.anc), tB = truckOf(m.acc), la = m.anc.lots[m.anc.lots.length - 1];
  return {
    ANC: { agence: agLabel(tA), plaque: tA.plate, client: la.client, c: la.c, l: la.l, vol: la.vol, km: la.km },
    ACC: { agence: agLabel(tB), client: m.acc.client, c: m.acc.c, l: m.acc.l, vol: m.acc.vol, d: m.acc.d },
    cap: m.cap, depotAnc: tA.base.pos, depotAcc: tB.base.pos, accSeul: m.accSeul, camionAcc: `Camion ${esc(agLabel(tB))}`,
  };
}
function detailOpp() {
  const m = sel;
  if (!m) return `<div class="vide"><h3>Aucune proposition</h3><p class="meta">${RES.plannings < 2 ? "Avec un seul planning, les accrochés possibles sont dans les autres régions : importez le zip complet." : "Aucune piste ne passe le moteur. Le détail des pistes écartées est au-dessus."}</p><div class="map mini"><svg viewBox="${BD.vb.join(" ")}">${carteVue()}</svg></div></div>`;
  const f = ficheOpp(m);
  return fiche(m, f, carteFiche(f));
}
function oppView() {
  const list = filtered(); if (sel && !list.includes(sel)) sel = list[0] || null;
  const ags = [...new Set(RES.matches.filter(m => m.keep).flatMap(m => [agLabel(truckOf(m.anc)), agLabel(truckOf(m.acc))]))].sort();
  $("pane").innerHTML = `<div class="md"><aside class="card plist"><div class="pl-h"><h2>${list.length} proposition${list.length > 1 ? "s" : ""}</h2>
     <select id="fAg" aria-label="Agence"><option value="">Toutes les agences</option>${ags.map(a => `<option${a === agFilter ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></div>
     <div class="pl-s" role="listbox" aria-label="Propositions" tabindex="-1">${list.map(m => carteProp(m, RES.matches.indexOf(m), ficheOpp(m), "data-i")).join("") || `<p class="meta pad">Aucune proposition avec ces filtres.</p>`}</div>
     <p class="pl-k">↑ ↓ pour passer d'une proposition à l'autre</p></aside>
    <section class="card pdet" id="pdet">${detailOpp()}</section></div>`;
  marquer();
}
/* sélection sans redessiner la liste : elle garde sa position de défilement */
function marquer() {
  const cur = tab === "opp" ? (sel ? RES.matches.indexOf(sel) : -1) : (rsel && ROUTE && ROUTE.list ? ROUTE.list.indexOf(rsel) : -1);
  const attr = tab === "opp" ? "data-i" : "data-r";
  document.querySelectorAll(`.pc[${attr}]`).forEach(b => { const on = +b.getAttribute(attr) === cur; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); if (on) b.scrollIntoView({ block: "nearest" }); });
}
function choisir(i, attr, focus) {
  if (attr === "data-i") { sel = RES.matches[i]; $("pdet").innerHTML = detailOpp(); }
  else { rsel = ROUTE.list[i]; $("pdet").innerHTML = detailRoute(ROUTE.q, rsel); }
  marquer();
  if (focus) { const b = document.querySelector(`.pc[${attr}="${i}"]`); if (b) b.focus({ preventScroll: true }); }
  const d = $("pdet"); if (d && d.getBoundingClientRect().top < 0) d.scrollIntoView({ block: "start" });
}

/* ---------- onglet Ouvrir une route ---------- */
function routeQuery() {
  const rawC = $("rC").value.trim(), rawL = $("rL").value.trim();
  const c = Boucles.deptOf(rawC), l = Boucles.deptOf(rawL), ag = $("rAg").value;
  if (typeof c !== "string" || !CENT[c] || typeof l !== "string" || !CENT[l]) return { err: "Saisissez un département (2 chiffres) ou un code postal valide pour le chargement et la livraison." };
  const date = $("rDate").value; if (!date) return { err: "Saisissez la date de chargement souhaitée." };
  if (Boucles.isOff(date)) return { err: `Le ${fdw(date)} est un jour fermé${Boucles.nomFerie(date) ? ` (${Boucles.nomFerie(date)})` : ""} : choisissez un jour ouvré.` };
  const [dA, cpA, ...key] = ag ? ag.split("|") : [];
  return { c, l, cpC: /^\d{5}$/.test(rawC) ? rawC : null, cpL: /^\d{5}$/.test(rawL) ? rawL : null, date, flex: Math.max(0, +$("rFlex").value || 0), baseA: dA || null, depotCp: cpA || null, excludeKey: key.length ? key.join("|") : null, vol: +$("rVol").value || null, agNom: ag ? $("rAg").selectedOptions[0].textContent : "" };
}
function ficheRoute(q, c) {
  const tr = c.truck, la = c.T.lots[c.T.lots.length - 1];
  return {
    ANC: { agence: agLabel(tr), plaque: tr.plate, client: la.client, c: la.c, l: la.l, vol: la.vol, km: la.km },
    ACC: { agence: q.agNom || "Votre agence", client: "Votre chantier", c: q.c, l: q.l, vol: q.vol || null, d: q.date },
    cap: c.cap, depotAnc: tr.base.pos, depotAcc: q.baseA ? CENT[q.baseA] : null, accSeul: !!q.baseA, camionAcc: q.baseA ? "Votre camion" : null,
    ownLegs: q.baseA ? ROUTE.ownLegs : 0, note: `À valider avec l'exploitation de ${esc(agLabel(tr))} : disponibilité réelle du camion et de l'équipe.`,
  };
}
function detailRoute(q, c) {
  if (!ROUTE || !ROUTE.list) return `<div class="vide"><h3>J'ouvre une route</h3><p class="meta">Saisissez le chantier que vous vendez : il devient l'<b>accroché</b> (ACC) d'un camion d'une autre agence qui rentre à vide, l'<b>ancre</b> (ANC). Le moteur de OneFleet juge chaque tournée : dépôt le week-end et les jours fériés, règle des 150 km, détour, rendement, capacité, camion déjà pris.</p><div class="map mini"><svg viewBox="${BD.vb.join(" ")}">${land()}</svg></div></div>`;
  if (!c) return `<div class="vide"><h3>Aucun camion compatible</h3><p class="meta">Trajet chargé ${q.c} → ${q.l} : ${nf(ROUTE.loaded)} km. Aucun camion ne rentre à vide près de ce chargement sur la période importée.</p></div>`;
  const f = ficheRoute(q, c);
  return fiche(c, f, carteFiche(f));
}
function routeView() {
  const q = ROUTE && ROUTE.q, c = rsel, L = ROUTE && ROUTE.list;
  $("pane").innerHTML = `<div class="card form"><div class="fgrid">
    <label>CHG ACC (dépt ou CP)<input id="rC" placeholder="13 ou 13100" value="${q ? (q.cpC || q.c) : ""}" inputmode="numeric"></label>
    <label>LIV ACC (dépt ou CP)<input id="rL" placeholder="57 ou 57000" value="${q ? (q.cpL || q.l) : ""}" inputmode="numeric"></label>
    <label>Date de chargement<input id="rDate" type="date" value="${q ? q.date : new Date().toISOString().slice(0, 10)}"></label>
    <label>Flexibilité ± jours ouvrés<input id="rFlex" type="number" min="0" max="10" value="${q ? q.flex : 2}"></label>
    <label>Volume (m³)<input id="rVol" type="number" min="0" placeholder="facultatif" value="${q && q.vol ? q.vol : ""}"></label>
    <label>Agence qui vend<select id="rAg"></select></label>
    <button class="btn primary" id="rGo">Chercher une ancre</button></div>
    ${ROUTE && ROUTE.err ? `<p class="ferr">${esc(ROUTE.err)}</p>` : ""}</div>
   <div class="md"><aside class="card plist"><div class="pl-h"><h2>${L ? `${L.filter(x => !x.near).length} ancre${L.filter(x => !x.near).length > 1 ? "s" : ""} possible${L.filter(x => !x.near).length > 1 ? "s" : ""}` : "Ancres possibles"}</h2></div>
     <div class="pl-s" role="listbox" aria-label="Ancres possibles" tabindex="-1">${L ? L.map((x, i) => carteProp(x, i, ficheRoute(q, x), "data-r")).join("") || `<p class="meta pad">Aucun camion ne rentre à vide près de ce chargement.</p>` : `<p class="meta pad">Lancez une recherche.</p>`}</div>
     <p class="pl-k">↑ ↓ pour passer d'une proposition à l'autre</p></aside>
    <section class="card pdet" id="pdet">${detailRoute(q, c)}</section></div>`;
  const sAg = $("rAg"), tmp = $("agTpl"); sAg.innerHTML = tmp.innerHTML; if (q && q.agVal) sAg.value = q.agVal;
  marquer();
}
function doSearch() {
  const q = routeQuery(); if (q.err) { ROUTE = { err: q.err, q: ROUTE && ROUTE.q }; rsel = null; render(); return; }
  q.agVal = $("rAg").value;
  const r = Boucles.searchRoute(RES, RES.trucks, q, CENT, params);
  if (r.err) { ROUTE = { err: r.err, q }; render(); return; }
  ROUTE = { q, list: r.list, loaded: r.loaded, ownLegs: r.ownLegs }; rsel = r.list.find(x => !x.near) || null; render();
}

/* ---------- onglets Retours à vide et Contrôle ---------- */
function emptyView() {
  const rows = RES.trips.filter(t => t.isEmpty).sort((a, b) => b.empty - a.empty);
  const byAg = {}; rows.forEach(t => { const a = agLabel(truckOf(t)); (byAg[a] = byAg[a] || { n: 0, km: 0, matched: 0 }).n++; byAg[a].km += t.empty; if (RES.matches.some(m => m.keep && m.anc === t)) byAg[a].matched++; });
  $("pane").innerHTML = `<div class="card list"><h2>Retours à vide par agence</h2><div class="hscroll"><table><thead><tr><th class="stick">Agence</th><th>Retours à vide</th><th>Km à vide</th><th>Dont avec opportunité</th></tr></thead><tbody>
    ${Object.entries(byAg).sort((a, b) => b[1].km - a[1].km).map(([a, v]) => `<tr><td class="stick"><b>${esc(a)}</b></td><td class="num">${v.n}</td><td class="num">${nf(v.km)} km</td><td class="num">${v.matched}</td></tr>`).join("")}</tbody></table></div></div>
   <div class="card list"><h2>Trajets qui rentrent à vide</h2><div class="hscroll"><table><thead><tr><th class="stick">Camion</th><th>Agence</th><th>Du</th><th>Au</th><th>Chantiers (départements)</th><th>Fin en</th><th>Retour à vide</th></tr></thead><tbody>
    ${rows.map(t => { const tr = truckOf(t); return `<tr><td class="stick">${esc(tr.plate || "—")}</td><td>${esc(agLabel(tr))}</td><td>${fd(t.start)}</td><td>${fd(t.end)}</td><td>${t.lots.map(l => `${l.c}→${l.l}`).join(", ")}</td><td>${esc(depName(t.lastL))}</td><td class="num">${nf(t.empty)} km</td></tr>`; }).join("")}</tbody></table></div></div>`;
}
function ctrlView() {
  $("pane").innerHTML = `<div class="card list"><h2>Contrôle de lecture</h2><p class="meta" style="margin:0 16px 10px">Un planning à 0 chantier lu signale une mise en page différente. Le dépôt de chaque camion vient du référentiel des agences ; à défaut, il est déduit de ses chargements. Le moteur raisonne en codes postaux : celui du dépôt est le plus proche de ses coordonnées.</p>
   <div class="hscroll"><table><thead><tr><th class="stick">Planning</th><th>Onglets lus</th><th>Camions</th><th>Chantiers lus</th><th>Remarque</th></tr></thead><tbody>
   ${REPORT.map(r => `<tr><td class="stick"><b>${esc(r.planning)}</b></td><td>${r.tabs.map(esc).join("<br>") || "—"}</td><td class="num">${r.trucks}</td><td class="num">${r.lots}</td><td>${esc(r.err)}</td></tr>`).join("")}</tbody></table></div>
   <h2 style="margin-top:18px">Dépôt retenu par camion</h2><div class="hscroll"><table><thead><tr><th class="stick">Camion</th><th>Planning</th><th>En-tête agence</th><th>Dépôt</th><th>CP moteur</th><th>Source</th></tr></thead><tbody>
   ${RES.trucks.map(t => `<tr><td class="stick">${esc(t.plate || "—")}</td><td>${esc(normP(t.planning))}</td><td>${esc(t.agency)}</td><td>${esc(t.base.label)} (${t.base.dept})</td><td>${esc(t.base.cp)}</td><td>${esc(t.base.how)}</td></tr>`).join("")}
   ${RES.noBase.map(t => `<tr><td class="stick">${esc(t.plate || "—")}</td><td>${esc(normP(t.planning))}</td><td>${esc(t.agency)}</td><td colspan="3" class="meta">dépôt introuvable : camion ignoré</td></tr>`).join("")}</tbody></table></div></div>`;
}
function render() {
  ["opp", "route", "empty", "ctrl"].forEach(t => document.querySelector(`[data-tab="${t}"]`).setAttribute("aria-pressed", tab === t));
  if (!RES) {
    $("kpi").innerHTML = ""; $("pane").innerHTML = `<div class="main"><div class="card map"><svg viewBox="${BD.vb.join(" ")}">${land()}</svg></div>
    <div class="card detail"><h3>Aucune donnée</h3><ol class="steps"><li>Choisir le <b>début</b> et la <b>durée</b> de la période. Des mois passés permettent de mesurer le gisement ; les mois à venir servent à vendre.</li><li>Cliquer sur <b>Importer</b> et déposer le zip des plannings, sans le décompresser.</li><li><b>Opportunités</b> liste les retours à vide comblables dans les plannings existants. <b>Ouvrir une route</b> vérifie si le chantier que vous vendez peut servir de retour à une autre agence.</li></ol></div></div>`; return;
  }
  kpis(); ({ opp: oppView, route: routeView, empty: emptyView, ctrl: ctrlView })[tab]();
}

/* ---------- branchements ---------- */
$("tabs").addEventListener("click", ev => { const b = ev.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; render(); } });
$("pane").addEventListener("click", ev => {
  if (ev.target.closest("#rGo")) return doSearch();
  const b = ev.target.closest(".pc"); if (!b) return;
  const attr = b.hasAttribute("data-i") ? "data-i" : "data-r"; choisir(+b.getAttribute(attr), attr);
});
/* ↑ ↓ dans la liste : proposition précédente ou suivante, sans quitter la fiche des yeux */
$("pane").addEventListener("keydown", ev => {
  const b = ev.target.closest(".pc");
  if (b && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
    ev.preventDefault();
    const all = [...document.querySelectorAll(".pl-s .pc")], i = all.indexOf(b), n = all[i + (ev.key === "ArrowDown" ? 1 : -1)];
    if (n) { const attr = n.hasAttribute("data-i") ? "data-i" : "data-r"; choisir(+n.getAttribute(attr), attr, true); }
  }
});
$("pane").addEventListener("keydown", ev => { if (ev.key === "Enter" && ev.target.closest(".form")) doSearch(); });
$("pane").addEventListener("change", ev => { if (ev.target.id === "fAg") { agFilter = ev.target.value; render(); } });
$("file").addEventListener("change", ev => { const f = ev.target.files; if (f && f.length) importFiles([...f]); ev.target.value = ""; });
function syncParams() { Object.keys(params).forEach(k => { const i = $(k); if (!i) return; if (i.type === "checkbox") i.checked = !!params[k]; else i.value = params[k]; }); }
syncParams();
let rerun = null;
Object.keys(params).forEach(k => {
  const i = $(k); if (!i) return;
  i.addEventListener(i.type === "checkbox" ? "change" : "input", () => {
    const v = i.type === "checkbox" ? i.checked : parseFloat(i.value);
    if (i.type !== "checkbox" && isNaN(v)) return;
    params[k] = v; try { localStorage.setItem(PKEY, JSON.stringify(params)); } catch (e) { /* stockage indisponible */ }
    WHY.attente = `attente > ${params.gapMax} j ouvrés`;
    if (!TRUCKS.length) return;
    clearTimeout(rerun);
    rerun = setTimeout(() => { const keep = ROUTE && ROUTE.q; run(); if (keep && tab === "route") { ROUTE = { q: keep }; setTimeout(() => { doSearch(); }, 0); } }, 300);
  });
});
let arm = null;
$("reset").addEventListener("click", async ev => {
  const b = ev.currentTarget;
  if (!arm) { b.textContent = "Confirmer : tout effacer"; b.classList.add("danger"); arm = setTimeout(() => { arm = null; b.textContent = "Réinitialiser"; b.classList.remove("danger"); }, 5000); return; }
  clearTimeout(arm); arm = null; b.textContent = "Réinitialiser"; b.classList.remove("danger");
  await DB.clear().catch(() => {}); TRUCKS = []; RES = null; REPORT = []; META = null; lastFiles = null; sel = null; ROUTE = null; rsel = null; agFilter = "";
  params = { ...PDEF }; try { localStorage.removeItem(PKEY); } catch (e) { /* stockage indisponible */ }
  syncParams(); header(); say("Tout est remis à zéro.", "ok"); render();
});
initSelects(); header(); render();
DB.open().then(async ok => { if (!ok) return; try { const s = await DB.get("last"); if (s && s.trucks && s.trucks.length) { TRUCKS = s.trucks; REPORT = s.report || []; META = s.meta; run(); } } catch (e) { /* données illisibles : on repart de zéro */ } });
