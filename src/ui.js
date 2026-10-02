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

/* ---------- calendrier d'une tournée : lu dans `jours[]` du moteur ---------- */
const JW = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const fdw = s => s ? `${JW[Boucles.wd(s)]} ${fd(s)}` : "—";
/* une case par jour : la manutention d'abord (rôle du lot), sinon la route (chargée ou à vide), sinon le dépôt */
function cellsFromJours(jours, roles) {
  const cells = {};
  (jours || []).forEach(j => {
    const acts = j.activites || [];
    const ops = acts.filter(a => a.genre === "CHG" || a.genre === "LIV");
    const routes = acts.filter(a => a.genre === "ROUTE");
    const depot = acts.find(a => a.genre === "DEPOT");
    const kmJ = routes.reduce((s, a) => s + (a.km || 0), 0);
    if (ops.length) {
      const txt = ops.map(a => `${a.genre === "CHG" ? "Charg." : "Livr."} ${roles[a.lot]?.court || a.lot}`).filter((v, i, t) => t.indexOf(v) === i).join(" · ");
      const last = ops[ops.length - 1];
      cells[j.date] = { txt, cls: "op " + (roles[last.lot]?.cls || ""), tip: txt + (kmJ ? ` · route ${nf(kmJ)} km` : "") };
    } else if (routes.length) {
      const charge = j.aBord > 0;
      cells[j.date] = { txt: charge ? "Route" : "À vide", cls: charge ? "rt" : "vd", tip: `${charge ? "Route chargée" : "Route à vide"} · ${nf(kmJ)} km${depot ? " · dépôt" : ""}` };
    } else if (depot) {
      cells[j.date] = { txt: j.aBord > 0 ? "Dépôt, chargé" : "Dépôt", cls: j.aBord > 0 ? "dp ch" : "dp", tip: j.aBord > 0 ? `Au dépôt avec ${nf(j.aBord)} m³ à bord` : "Au dépôt" };
    } else cells[j.date] = { txt: "Attente", cls: "at", tip: "Jour sans activité dans la tournée" };
    if (depot && cells[j.date].cls !== "dp" && !cells[j.date].cls.startsWith("dp")) cells[j.date].fin = true;
  });
  return cells;
}
function timeline(rows, from, to) {
  const days = []; for (let d = from; d && d <= to && days.length < 15; d = Boucles.addD(d, 1)) days.push(d);
  const off = d => Boucles.isOff(d);
  const head = `<div class="tl-row tl-head"><div class="tl-lab"></div>${days.map(d => { const fe = Boucles.nomFerie(d); return `<div class="tl-d${off(d) ? " we" : ""}"${fe ? ` title="${esc(fe)}"` : ""}>${JW[Boucles.wd(d)]}<b>${new Date(d + "T12:00").getDate()}</b>${fe ? "<i>férié</i>" : ""}</div>`; }).join("")}</div>`;
  return `<div class="tl" style="--n:${days.length}">${head}${rows.map(r => `<div class="tl-row"><div class="tl-lab">${r.label}</div>${days.map(d => { const c = r.cells[d]; return `<div class="tl-c${off(d) ? " we" : ""}${c ? " " + c.cls : ""}${c && c.fin ? " fin" : ""}"${c && c.tip ? ` title="${esc(c.tip)}"` : ""}>${c ? esc(c.txt) : ""}</div>`; }).join("")}</div>`).join("")}</div>
   <div class="tl-key"><span><i class="k op anc"></i>chantier A</span><span><i class="k op acc"></i>chantier B</span><span><i class="k rt"></i>route chargée</span><span><i class="k vd"></i>à vide</span><span><i class="k dp"></i>dépôt</span><span><i class="k we"></i>week-end, férié</span></div>`;
}
function loopRows({ agA, m, agB, bSolo, roles, mine }) {
  const rows = [
    { label: `<b>Camion ${esc(agA)}</b><span>avec le retour</span>`, cells: cellsFromJours(m.r.jours, roles) },
    { label: `<b>Camion ${esc(agA)}</b><span>sans le retour</span>`, cells: cellsFromJours(m.base.jours, roles) },
  ];
  if (agB && m.cDate) {
    const c = {}; for (let d = m.cDate; d <= (m.livB || m.cDate); d = Boucles.addD(d, 1)) if (!Boucles.isOff(d)) c[d] = { txt: bSolo ? "Libéré" : "Sa tournée", cls: "lib" };
    rows.push({ label: `<b>Camion ${esc(agB)}</b><span>${bSolo ? "n'a plus ce chantier" : "garde sa tournée"}</span>`, cells: c });
  }
  if (mine && m.cDate) { const c = {}; c[m.cDate] = { txt: "Libéré", cls: "lib" }; rows.push({ label: `<b>Votre camion</b><span>n'est pas mobilisé</span>`, cells: c }); }
  const from = m.livA || m.r.chiffres?.depart || m.cDate;
  const to = [m.retour, m.retourSeul, m.livB].filter(Boolean).sort().pop();
  return timeline(rows, from, to);
}

/* ---------- verdict, contrôles et signaux du moteur ---------- */
const NIV = { refus: "ko", rouge: "ko", orange: "wa", info: "na", ok: "ok" };
function verdictPill(m) {
  if (!m.ok) return `<span class="vp ko">Écarté : ${esc(WHY[m.why[0]] || m.why[0])}</span>`;
  return m.serre ? `<span class="vp wa" title="Tient à 770 km/j sans marge, pas à 600 km/j avec 15 % de marge de manutention">Serré</span>` : `<span class="vp ok" title="Tient avec la marge d'exploitation (600 km/j, manutention + 15 %)">Tient</span>`;
}
function checks(m, vol, cap) {
  const P = params;
  const cou = m.coupure ? `<li class="ok">Rentre chargé au dépôt avant la coupure, repart ensuite : dépôt sur le chemin (règle des ${P.we150} km)</li>` : "";
  const v = vol == null || cap == null ? `<li class="na">Volume à vérifier${vol != null ? ` (${vol} m³, capacité inconnue)` : cap != null ? ` (capacité ${cap} m³, volume non renseigné)` : ""}</li>` : `<li class="ok">${vol} m³ pour ${cap} m³ de capacité</li>`;
  const extra = m.retourSeul && m.retour ? Boucles.dayDiff(m.retourSeul, m.retour) : 0;
  const sig = m.signaux.filter(s => s.code !== "SERRE").map(s => `<li class="${NIV[s.niveau] || "na"}">${esc(s.message)}</li>`).join("");
  return `<ul class="checks">
    <li class="ok">Au dépôt chaque week-end et jour férié${m.retour ? ` · rentre ${fdw(m.retour)}` : ""}</li>${cou}${v}
    ${m.det != null ? `<li class="ok">Détour ${nf(m.det)} km (≤ ${nf(P.detMax)})</li>` : ""}
    ${m.rallJ != null ? `<li class="ok">Rendement : ${nf(m.eco)} km évités pour ${f1(m.rallJ)} jour de camion ajouté (minimum ${nf(m.rendMin)})</li>` : ""}
    ${m.serre ? `<li class="wa">Serré : tient au compte juste (770 km/j, sans marge), pas avec la marge d'exploitation</li>` : ""}
    ${extra > 0 ? `<li class="na">Camion au dépôt ${extra} jour${extra > 1 ? "s" : ""} plus tard qu'en rentrant à vide (${fdw(m.retourSeul)})</li>` : ""}
    ${m.ajusteA ? `<li class="na">Dates du chantier A relâchées (${m.ajusteA}) : celles du planning ne tiennent pas pour le moteur avec ${P.m3PerDay} m³ par déménageur et par jour</li>` : ""}
    ${sig}</ul>`;
}
const WHY = {
  "même jour": "rechargement le jour de la livraison", "week-end": "dehors un week-end ou un férié", "150 km": "rentrerait chargé loin du dépôt (150 km)",
  "date": "dates intenables", "jour fermé": "date un jour fermé", "attente": `attente > ${params.gapMax} j ouvrés`, "camion pris": "camion déjà pris",
  "volume": "volume > capacité", "détour": "détour", "rendement": "rendement", "gain": "gain trop faible", "CP inconnu": "code postal inconnu", "territoire": "territoire",
};
const badge = (ok, yes, no, na) => ok === null || ok === undefined ? `<span class="bdg na">${na}</span>` : ok ? `<span class="bdg ok">${yes}</span>` : `<span class="bdg ko">${no}</span>`;

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
    (RES.plannings < 2 ? `<p style="margin:6px 0 0">Un seul planning chargé : les retours à vide sont mesurés, mais les rapprochements entre régions demandent le zip complet.</p>` : ""), bad.length ? "err" : "ok");
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

/* ---------- carte ---------- */
const truckOf = x => RES.trucks[x.truck];
const agLabel = t => t.base ? t.base.label : (t.agency || normP(t.planning));
const Pd = d => proj(CENT[d]);
const curve = (a, b, cls) => { const [x1, y1] = a, [x2, y2] = b, mx = (x1 + x2) / 2 - (y2 - y1) * .12, my = (y1 + y2) / 2 + (x2 - x1) * .12; return `<path class="${cls}" d="M${x1},${y1} Q${mx},${my} ${x2},${y2}"/>`; };
const pin = (xy, t, cls, n) => `<g class="pin ${cls}"><circle cx="${xy[0]}" cy="${xy[1]}" r="${n ? 8 : 5}"/>${n ? `<text class="n" x="${xy[0]}" y="${xy[1] + 3.5}">${n}</text>` : ""}<text x="${xy[0] + (n ? 11 : 8)}" y="${xy[1] + 4}">${esc(t)}</text></g>`;
const baseMark = (xy, t, cls) => `<rect class="base ${cls || ""}" x="${xy[0] - 6}" y="${xy[1] - 6}" width="12" height="12"/><text class="bl" x="${xy[0] + 9}" y="${xy[1] - 6}">${esc(t)}</text>`;
const land = () => BD.paths.map(d => `<path class="land" d="${d}"/>`).join("");
function mapOpp(m) {
  let out = land();
  if (!m) { RES.trips.filter(t => t.isEmpty).forEach(t => { const tr = truckOf(t); if (CENT[t.lastL] && tr.base) out += curve(Pd(t.lastL), proj(tr.base.pos), "empty thin"); }); return out; }
  const tA = truckOf(m.A), tB = truckOf(m.B), la = m.A.lots[m.A.lots.length - 1], bA = proj(tA.base.pos), bB = proj(tB.base.pos);
  if (CENT[la.c]) out += curve(Pd(la.c), Pd(la.l), "loadA");
  out += curve(Pd(la.l), bA, "empty") + curve(Pd(la.l), Pd(m.B.c), "repo") + curve(Pd(m.B.c), Pd(m.B.l), "loadB") + curve(Pd(m.B.l), bA, "after");
  if (m.bSolo) out += curve(bB, Pd(m.B.c), "emptyB") + curve(Pd(m.B.l), bB, "emptyB");
  const pins = la.l === m.B.c ? pin(Pd(la.l), `livr. A, charg. B ${la.l}`, "b", "AB") : pin(Pd(la.l), "livr. " + la.l, "a", "A") + pin(Pd(m.B.c), "charg. " + m.B.c, "b", "B");
  return out + baseMark(bA, agLabel(tA)) + baseMark(bB, agLabel(tB), "b2") + pins + pin(Pd(m.B.l), "livr. " + m.B.l, "b");
}
function mapRoute(q, c) {
  let out = land(); if (!q) return out;
  if (!c) {
    out += curve(Pd(q.c), Pd(q.l), "loadB");
    if (ROUTE && ROUTE.list) ROUTE.list.forEach(x => { if (CENT[x.T.lastL]) out += `<circle class="cand${x.near ? " near" : ""}" cx="${Pd(x.T.lastL)[0]}" cy="${Pd(x.T.lastL)[1]}" r="5"/>`; });
    return out + pin(Pd(q.c), "charg. " + q.c, "b", "B") + pin(Pd(q.l), "livr. " + q.l, "b");
  }
  const tr = c.truck, bB = proj(tr.base.pos), E = Pd(c.T.lastL);
  out += curve(E, bB, "empty") + curve(E, Pd(q.c), "repo") + curve(Pd(q.c), Pd(q.l), "loadB") + curve(Pd(q.l), bB, "after");
  if (q.baseA) { const bA = Pd(q.baseA); out += curve(bA, Pd(q.c), "emptyB") + curve(Pd(q.l), bA, "emptyB") + baseMark(bA, "mon agence", "b2"); }
  const pins = c.T.lastL === q.c ? pin(E, `fin trajet, charg. ${q.c}`, "b", "AB") : pin(E, "fin trajet " + c.T.lastL, "a", "A") + pin(Pd(q.c), "charg. " + q.c, "b", "B");
  return out + baseMark(bB, agLabel(tr)) + pins + pin(Pd(q.l), "livr. " + q.l, "b");
}
const LEG_SEL = `<span><i class="lg loadA"></i>chantier A</span><span><i class="lg empty"></i>retour à vide évité</span><span><i class="lg repo"></i>repositionnement</span><span><i class="lg loadB"></i>chantier B</span><span><i class="lg after"></i>retour au dépôt</span>`;

/* ---------- onglet Opportunités ---------- */
function kpis() {
  const k = RES.kpi, x = k.excluded || {}; const xs = Object.entries(x).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${n} ${WHY[w] || w}`).join(", ");
  $("kpi").innerHTML = `<div><b>${nf(k.trips)}</b><span>trajets longue distance</span></div><div><b>${nf(k.emptyTrips)}</b><span>retours à vide ≥ ${params.minEmpty} km</span></div>
   <div><b>${nf(k.emptyKm)} km</b><span>roulés à vide (estimation)</span></div><div><b>${nf(k.loopsDone)}</b><span>retours déjà chargés</span></div>
   <div class="hl"><b>${nf(k.kept)}</b><span>retours possibles${k.serres ? `, dont ${k.serres} serré${k.serres > 1 ? "s" : ""}` : ""}</span></div><div class="hl"><b>${nf(k.ecoTot)} km</b><span>évités, sans double compte</span></div>
   ${xs ? `<div class="xs"><strong>Pistes écartées par le moteur :</strong> ${esc(xs)}.</div>` : ""}`;
}
function filtered() { return RES.matches.filter(m => m.keep && (!agFilter || agLabel(truckOf(m.A)) === agFilter || agLabel(truckOf(m.B)) === agFilter)); }
function propHead(m, titre) {
  return `<div class="ph"><span class="tb">Retour</span>${verdictPill(m)}</div>
   <h3><span class="gain">${nf(m.eco)} km</span> évités${titre ? ` <small>${titre}</small>` : ""}</h3>`;
}
function oppDetail(m) {
  if (!m) return `<h3>Aucun retour possible</h3><p class="meta">${RES.plannings < 2 ? "Avec un seul planning, les partenaires possibles sont dans les autres régions : importez le zip complet." : "Aucun chantier ne passe le moteur. Le détail des pistes écartées est au-dessus de la carte."}</p>`;
  const tA = truckOf(m.A), tB = truckOf(m.B), la = m.A.lots[m.A.lots.length - 1];
  const roles = { A: { court: "A", cls: "anc" }, B: { court: "B", cls: "acc" } };
  return `${propHead(m)}
   <p class="lead2">Le camion <b>${esc(agLabel(tA))}</b> (${esc(tA.plate || "sans immatriculation")}) livre en ${esc(depName(la.l))} le <b>${fdw(m.livA)}</b>. Au lieu de rentrer à vide (${nf(m.empty)} km), il charge le <b>${fdw(m.cDate)}</b> le chantier de <b>${esc(agLabel(tB))}</b> en ${esc(depName(m.B.c))}, le livre en ${esc(depName(m.B.l))} le <b>${fdw(m.livB)}</b> et rentre au dépôt le <b>${fdw(m.retour)}</b>.${m.coupure ? " Il passe le week-end au dépôt, chargé, et repart ensuite." : ""}</p>
   ${loopRows({ agA: agLabel(tA), m, agB: agLabel(tB), bSolo: m.bSolo, roles })}
   ${checks(m, m.B.vol, m.cap)}
   <ol class="seq">
    <li class="anc"><span class="rl anc">A</span><div><b>Chantier A</b> · ${esc(agLabel(tA))} · ${esc(la.client)} : ${la.c}→${la.l}${la.vol != null ? `, ${la.vol} m³` : ""}. Trajet du camion : ${m.A.lots.map(l => `${l.c}→${l.l}`).join(", ")}.</div></li>
    <li class="r"><span class="rl r"></span><div><b>Repositionnement</b> ${la.l} → ${m.B.c} : ${nf(m.repo)} km.</div></li>
    <li class="acc"><span class="rl acc">B</span><div><b>Chantier B</b> · ${esc(agLabel(tB))} · ${esc(m.B.client)} : ${m.B.c}→${m.B.l} (${nf(m.loaded)} km chargé)${m.B.vol != null ? `, ${m.B.vol} m³` : ""}${m.B.etp != null ? `, ${m.B.etp} ETP` : ""}. ${m.shift ? `<b class="warn">Chargement décalé de ${m.shift > 0 ? "+" : "−"}${Math.abs(m.shift)} j par rapport à la date prévue par ${esc(agLabel(tB))} (${fdw(m.B.d)}) : client à prévenir.</b>` : `Date de chargement prévue par ${esc(agLabel(tB))} conservée : ${fdw(m.B.d)}.`}</div></li>
    <li class="x"><span class="rl x"></span><div><b>Retour</b> ${m.B.l} → dépôt ${esc(tA.base.label)} : ${nf(m.after)} km au lieu de ${nf(m.empty)}.</div></li></ol>
   <p class="meta">Calcul : moteur v2 de OneFleet (<code>evaluerTournee</code>), état du 01/10/2026, pas en production. Km évités = lots faits seuls depuis leur dépôt − tournée${m.bSolo ? "" : ` (le camion de ${esc(agLabel(tB))} garde sa tournée : son trajet n'est pas compté comme évité)`}. Distances à vol d'oiseau × 1,25 à 1,4, entre codes postaux.</p>`;
}
function oppView() {
  const list = filtered(); if (sel && !list.includes(sel)) sel = list[0] || null;
  const ags = [...new Set(RES.matches.filter(m => m.keep).flatMap(m => [agLabel(truckOf(m.A)), agLabel(truckOf(m.B))]))].sort();
  $("pane").innerHTML = `<div class="main"><div class="card map"><svg viewBox="${BD.vb.join(" ")}">${mapOpp(sel)}</svg>
    <div class="legend">${sel ? LEG_SEL : `<span><i class="lg empty"></i>retours à vide détectés</span>`}</div></div>
    <div class="card detail">${oppDetail(sel)}</div></div>
   <div class="card list"><div class="lhead"><h2>Retours possibles sur les plannings existants</h2>
     <div class="filters"><select id="fAg"><option value="">Toutes les agences</option>${ags.map(a => `<option${a === agFilter ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></div></div>
    <div class="hscroll"><table><thead><tr><th class="stick">Km évités</th><th>Verdict</th><th>Camion qui rentre à vide</th><th>Livraison A</th><th>Chantier B à reprendre</th><th>Chargement B</th><th>Livraison B</th><th>Au dépôt</th><th>Détour</th><th>Contrôles</th></tr></thead><tbody>
    ${list.map(m => { const tA = truckOf(m.A), tB = truckOf(m.B); return `<tr class="${m === sel ? "on" : ""}" data-i="${RES.matches.indexOf(m)}"><td class="stick num"><b>${nf(m.eco)} km</b></td><td>${verdictPill(m)}</td>
      <td>${esc(agLabel(tA))} · ${esc(tA.plate)}${m.cap ? ` · ${m.cap} m³` : ""}</td><td>${fdw(m.livA)} · ${m.A.lastL}</td><td>${esc(agLabel(tB))} · ${esc(m.B.client)}${m.B.vol != null ? ` · ${m.B.vol} m³` : ""}</td>
      <td>${fdw(m.cDate)} · ${m.B.c}</td><td>${fdw(m.livB)} · ${m.B.l}</td><td>${fdw(m.retour)}</td><td class="num">${m.det != null ? nf(m.det) + " km" : "—"}</td>
      <td>${m.shift ? `<span class="bdg ko">date ${m.shift > 0 ? "+" : "−"}${Math.abs(m.shift)} j</span>` : ""}${m.coupure ? `<span class="bdg na">week-end au dépôt, chargé</span>` : ""}${badge(m.volOk, "volume", "volume", "volume ?")}</td></tr>`; }).join("") || `<tr><td colspan="10" class="meta">Aucun retour possible avec ces filtres.</td></tr>`}
    </tbody></table></div></div>`;
}

/* ---------- onglet Ouvrir une route ---------- */
function routeQuery() {
  const rawC = $("rC").value.trim(), rawL = $("rL").value.trim();
  const c = Boucles.deptOf(rawC), l = Boucles.deptOf(rawL), ag = $("rAg").value;
  if (typeof c !== "string" || !CENT[c] || typeof l !== "string" || !CENT[l]) return { err: "Saisissez un département (2 chiffres) ou un code postal valide pour le chargement et la livraison." };
  const date = $("rDate").value; if (!date) return { err: "Saisissez la date de chargement souhaitée." };
  if (Boucles.isOff(date)) return { err: `Le ${fdw(date)} est un jour fermé${Boucles.nomFerie(date) ? ` (${Boucles.nomFerie(date)})` : ""} : choisissez un jour ouvré.` };
  const [dA, cpA, ...key] = ag ? ag.split("|") : [];
  return { c, l, cpC: /^\d{5}$/.test(rawC) ? rawC : null, cpL: /^\d{5}$/.test(rawL) ? rawL : null, date, flex: Math.max(0, +$("rFlex").value || 0), baseA: dA || null, depotCp: cpA || null, excludeKey: key.length ? key.join("|") : null, vol: +$("rVol").value || null };
}
function routeDetail(q, c) {
  if (!ROUTE || !ROUTE.list) return `<h3>J'ouvre une route</h3><p class="meta">Saisissez le chantier que vous êtes en train de vendre : l'outil cherche les camions d'autres agences qui seront à vide près de votre chargement, et le moteur de OneFleet juge chaque tournée (dépôt le week-end et les jours fériés, règle des 150 km, détour, rendement, capacité, camion déjà pris).</p>`;
  const nOk = ROUTE.list.filter(x => !x.near).length;
  if (!c) return `<h3>${nOk} camion${nOk > 1 ? "s" : ""} compatible${nOk > 1 ? "s" : ""}</h3><p class="meta">Trajet chargé ${q.c} → ${q.l} : ${nf(ROUTE.loaded)} km. Sélectionnez une ligne pour voir le calendrier.</p>`;
  const tr = c.truck;
  const roles = { A: { court: "A", cls: "anc" }, B: { court: "le vôtre", cls: "acc" } };
  return `${propHead(c, c.near ? "piste proche" : "")}
   <p class="lead2">Le camion <b>${esc(agLabel(tr))}</b> (${esc(tr.plate || "sans immatriculation")}) livre en ${esc(depName(c.T.lastL))} le <b>${fdw(c.livA)}</b> et devait rentrer à vide (${nf(c.empty)} km). Il charge votre chantier le <b>${fdw(c.cDate)}</b>${c.shift ? ` (${c.shift > 0 ? "+" : "−"}${Math.abs(c.shift)} j par rapport à votre date)` : ""}, le livre le <b>${fdw(c.livB)}</b> et rentre au dépôt le <b>${fdw(c.retour)}</b>.${c.coupure ? " Il passe le week-end au dépôt, chargé, et repart ensuite." : ""}</p>
   ${loopRows({ agA: agLabel(tr), m: c, roles, mine: !!q.baseA })}
   ${checks(c, q.vol || null, c.cap)}
   <ol class="seq"><li class="anc"><span class="rl anc">A</span><div><b>Son trajet</b> : ${c.T.lots.map(l => `${l.c}→${l.l}`).join(", ")}.</div></li>
    <li class="r"><span class="rl r"></span><div><b>Repositionnement</b> ${c.T.lastL} → ${q.c} : ${nf(c.repo)} km.</div></li>
    <li class="acc"><span class="rl acc">B</span><div><b>Votre chantier</b> ${q.c} → ${q.l} : ${nf(c.loaded)} km chargé${q.vol ? `, ${q.vol} m³` : ""}.</div></li>
    <li class="x"><span class="rl x"></span><div><b>Retour</b> ${q.l} → dépôt ${esc(tr.base.label)} : ${nf(c.after)} km au lieu de ${nf(c.empty)}.</div></li>
    ${q.baseA ? `<li class="g"><span class="rl g"></span><div>Votre camion évite l'aller-retour depuis votre agence : ${nf(ROUTE.ownLegs)} km à vide.</div></li>` : ""}</ol>
   <p class="meta">À valider avec l'exploitation de ${esc(agLabel(tr))} : disponibilité réelle du camion et de l'équipe.</p>`;
}
function routeView() {
  const q = ROUTE && ROUTE.q, c = rsel;
  $("pane").innerHTML = `<div class="card form"><div class="fgrid">
    <label>Chargement<input id="rC" placeholder="dépt ou CP" value="${q ? (q.cpC || q.c) : ""}" inputmode="numeric"></label>
    <label>Livraison<input id="rL" placeholder="dépt ou CP" value="${q ? (q.cpL || q.l) : ""}" inputmode="numeric"></label>
    <label>Date de chargement<input id="rDate" type="date" value="${q ? q.date : new Date().toISOString().slice(0, 10)}"></label>
    <label>Flexibilité ± jours ouvrés<input id="rFlex" type="number" min="0" max="10" value="${q ? q.flex : 2}"></label>
    <label>Volume (m³)<input id="rVol" type="number" min="0" placeholder="facultatif" value="${q && q.vol ? q.vol : ""}"></label>
    <label>Agence qui vend<select id="rAg"></select></label>
    <button class="btn primary" id="rGo">Chercher un retour</button></div>
    ${ROUTE && ROUTE.err ? `<p class="ferr">${esc(ROUTE.err)}</p>` : ""}</div>
   <div class="main"><div class="card map"><svg viewBox="${BD.vb.join(" ")}">${mapRoute(q, c)}</svg>
    <div class="legend">${c ? LEG_SEL.replace("chantier B", "votre chantier") : `<span><i class="lg loadB"></i>votre chantier</span><span><i class="dotc"></i>fins de trajet compatibles</span><span><i class="dotc near"></i>pistes proches</span>`}</div></div>
    <div class="card detail">${routeDetail(q, c)}</div></div>
   ${ROUTE && ROUTE.list ? `<div class="card list"><h2>Camions qui pourraient prendre votre chantier en retour</h2><div class="hscroll"><table><thead><tr><th class="stick">Km évités</th><th>Verdict</th><th>Camion</th><th>Fin de son trajet</th><th>Charge votre chantier</th><th>Livre</th><th>Au dépôt</th><th>Détour</th><th>Contrôles</th></tr></thead><tbody>
    ${ROUTE.list.map((x, i) => `<tr class="${x === c ? "on" : ""}${x.near ? " near" : ""}" data-r="${i}"><td class="stick num"><b>${nf(x.eco)} km</b></td><td>${verdictPill(x)}</td><td>${esc(agLabel(x.truck))} · ${esc(x.truck.plate)}${x.cap ? ` · ${x.cap} m³` : ""}</td><td>${fdw(x.livA)} · ${x.T.lastL}</td>
      <td>${x.cDate ? fdw(x.cDate) + (x.shift ? ` (${x.shift > 0 ? "+" : "−"}${Math.abs(x.shift)} j)` : "") : "—"}</td><td>${fdw(x.livB)}</td><td>${fdw(x.retour)}</td><td class="num">${x.det != null ? nf(x.det) + " km" : "—"}</td>
      <td>${x.near ? `<span class="bdg ko">${esc(x.why.map(w => WHY[w] || w).join(", "))}</span>` : (x.coupure ? `<span class="bdg na">week-end au dépôt, chargé</span>` : "") + badge(x.volOk, "volume", "volume", "volume ?")}</td></tr>`).join("") || `<tr><td colspan="9" class="meta">Aucun camion ne rentre à vide près de ce chargement sur la période importée.</td></tr>`}
    </tbody></table></div></div>` : ""}`;
  const sAg = $("rAg"), tmp = $("agTpl"); sAg.innerHTML = tmp.innerHTML; if (q && q.agVal) sAg.value = q.agVal;
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
  const byAg = {}; rows.forEach(t => { const a = agLabel(truckOf(t)); (byAg[a] = byAg[a] || { n: 0, km: 0, matched: 0 }).n++; byAg[a].km += t.empty; if (RES.matches.some(m => m.keep && m.A === t)) byAg[a].matched++; });
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
  const r = ev.target.closest("tr[data-i]"); if (r) { sel = RES.matches[+r.dataset.i]; render(); $("pane").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  const s = ev.target.closest("tr[data-r]"); if (s) { rsel = ROUTE.list[+s.dataset.r]; render(); $("pane").scrollIntoView({ behavior: "smooth", block: "start" }); }
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
