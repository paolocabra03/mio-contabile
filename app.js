(() => {
"use strict";
const CFG = window.MC_CONFIG || {};
// Il foglio e il nome non sono nel codice: si inseriscono al primo avvio e restano sul telefono.
const sheetId = () => store.get("mc-sheet");
const nome = () => store.get("mc-nome") || "";
const API = () => "https://sheets.googleapis.com/v4/spreadsheets/" + sheetId();
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const MESI = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
const MESI_B = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"];

/* ---------- utilità ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Separatore delle migliaia sempre presente (l'italiano di serie non lo mette sotto 10.000).
const group = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const fmt2 = n => { const [i, d] = Math.abs(n).toFixed(2).split("."); return group(i) + "," + d; };
const eur = n => (n < 0 ? "−" : "") + "€ " + fmt2(n);
const eur0 = n => (n < 0 ? "−" : "") + "€ " + group(String(Math.abs(Math.round(n))));
const eurK = n => n >= 1000 ? "€ " + Math.round(n / 1000).toLocaleString("it-IT") + "k" : eur0(n);
const isHidden = () => !store.get("mc-show");
const M = n => isHidden() ? "€ ••••" : eur(n);
const M0 = n => isHidden() ? "€ ••••" : eur0(n);
const MK = n => isHidden() ? "€ ••••" : eurK(n);
const axisK = v => v >= 1000 ? (v / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 }) + "k" : String(Math.round(v));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const num = v => {
  if (typeof v === "number") return v;
  let s = String(v ?? "").replace(/[^\d,.\-]/g, "");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
};
// Accetta "12,50", "12.5", "1.500" (= millecinquecento) e "1.500,25"; testo con lettere o simboli strani no.
const parseInputAmount = (s, dec = 2) => {
  let t = String(s || "").trim().replace(/[\s€]/g, "");
  if (!/^\d[\d.,]*$/.test(t)) return NaN;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  const k = Math.pow(10, dec);
  return Math.round(parseFloat(t) * k) / k;
};
// Le quote non sono mai a migliaia: il punto è sempre un decimale ("1.164" = 1,164). Fino a 6 decimali; NaN se non è un numero.
const parseQuote = s => {
  let t = String(s || "").trim().replace(/\s/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  return /^\d+(\.\d+)?$/.test(t) ? Math.round(parseFloat(t) * 1e6) / 1e6 : NaN;
};
const toDate = v => {
  if (typeof v === "number") { const d = new Date(1899, 11, 30); d.setDate(d.getDate() + Math.floor(v)); return d; }
  const m = String(v || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
};
const sheetDate = d => String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
const isoDate = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const fromIso = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const monthStart = d => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const sameMonth = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
const dayLabel = d => { const s = d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }); return s.charAt(0).toUpperCase() + s.slice(1); };
const shortDay = d => d.getDate() + " " + MESI_B[d.getMonth()];

/* ---------- stato ---------- */
const S = {
  tab: "home", loading: false, loadedAt: null, error: null,
  mov: [], conti: [], pac: [],
  set: { spesa: [], entrata: [], conti: [], categorie: ["Bisogno", "Desiderio"], etf: [], giorno: 15, contoDa: "", contoInv: "" },
  movMonth: monthStart(new Date()), movFilter: "tutti", movQuery: "",
  chartMonth: monthStart(new Date()),
  pacForm: false, valForm: false,
};

/* ---------- accesso Google ---------- */
class AuthError extends Error {}
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, "");
function token() {
  const t = store.get("mc-token");
  return t && t.exp > Date.now() + 30000 ? t.value : null;
}
function login(silent) {
  if (!CFG.clientId || CFG.clientId.startsWith("INCOLLA")) { S.error = { code: "config" }; render(); return; }
  if (!sheetId()) { render(); return; }
  if (!navigator.onLine) { S.error = { code: "offline" }; render(); return; }
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  store.set("mc-oauth-state", { state, silent: !!silent, at: Date.now() });
  const p = new URLSearchParams({
    client_id: CFG.clientId, redirect_uri: redirectUri(), response_type: "token",
    scope: SCOPE, include_granted_scopes: "true", state,
  });
  if (silent) p.set("prompt", "none");
  location.replace("https://accounts.google.com/o/oauth2/v2/auth?" + p.toString());
}
function handleRedirect() {
  if (!location.hash || location.hash.length < 2) return null;
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has("access_token") && !h.has("error")) return null;
  history.replaceState(null, "", location.pathname + location.search);
  const saved = store.get("mc-oauth-state");
  store.del("mc-oauth-state");
  if (!saved || saved.state !== h.get("state")) return { error: "state" };
  if (h.get("error")) return { error: h.get("error"), silent: saved.silent };
  const scopes = (h.get("scope") || "").split(" ");
  if (!scopes.includes(SCOPE)) return { error: "scope" };
  store.set("mc-token", { value: h.get("access_token"), exp: Date.now() + (parseInt(h.get("expires_in"), 10) || 3600) * 1000 });
  return { ok: true };
}
function logout() {
  const t = store.get("mc-token");
  store.del("mc-token"); store.del("mc-cache"); store.del("mc-known");
  if (t) fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(t.value), { method: "POST" }).catch(() => {});
  S.mov = []; S.conti = []; S.pac = []; S.loadedAt = null;
  render();
}

/* ---------- Sheets ---------- */
async function api(path, opts = {}) {
  const t = token();
  if (!t) throw new AuthError("no token");
  let res;
  try {
    res = await fetch(API() + path, { ...opts, headers: { "Authorization": "Bearer " + t, "Content-Type": "application/json", ...(opts.headers || {}) } });
  } catch (e) { const err = new Error("rete"); err.code = "offline"; throw err; }
  if (res.status === 401) { store.del("mc-token"); throw new AuthError("expired"); }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error.message; } catch {}
    const err = new Error(msg); err.code = res.status === 403 ? "forbidden" : res.status === 404 ? "notfound" : "http"; throw err;
  }
  return res.json();
}
let reloadAfter = false;
async function loadAll() {
  if (!sheetId()) return;
  // Se un caricamento è già in corso, ne faccio ripartire uno appena finisce: i dati appena scritti non vanno persi.
  if (S.loading) { reloadAfter = true; return; }
  if (!navigator.onLine) { S.error = { code: "offline" }; render(); return; }
  if (!token()) { login(true); return; }
  S.loading = true; spin(true);
  try {
    await flush();
    if (!token()) return;
    const ranges = ["Movimenti!A2:G", "Conti!A2:E8", "Impostazioni!A1:J40", "PAC!A2:F"].map(r => "ranges=" + encodeURIComponent(r)).join("&");
    const p = await api("/values:batchGet?" + ranges + "&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER");
    const [mov, conti, imp, pac] = p.valueRanges.map(v => v.values || []);
    const raw = { mov, conti, imp, pac };
    apply(raw);
    S.error = null; S.loadedAt = Date.now();
    store.set("mc-cache", { raw, at: S.loadedAt });
  } catch (e) {
    if (e instanceof AuthError) { S.loading = false; spin(false); login(true); return; }
    S.error = e;
  } finally {
    S.loading = false; spin(false); render();
    if (reloadAfter) { reloadAfter = false; loadAll(); }
  }
}
function apply({ mov, conti, imp, pac }) {
  S.mov = mov.map((r, i) => ({ row: i + 2, d: toDate(r[0]), tipo: r[1] || "", tip: r[2] || "", imp: num(r[3]), cat: r[4] || "", conto: r[5] || "", desc: r[6] || "" }))
    .filter(m => m.d && m.imp);
  S.conti = conti.filter(r => r[0] && r[0] !== "Totale").map(r => ({ nome: r[0], saldo: num(r[4]) }));
  const col = i => imp.slice(1).map(r => r[i]).filter(v => v !== undefined && v !== "");
  if (imp.length) {
    S.set.spesa = col(0); S.set.entrata = col(1); S.set.conti = col(2);
    if (col(3).length) S.set.categorie = col(3);
    S.set.etf = imp.slice(1, 3).filter(r => r[5]).map(r => ({ nome: r[5], isin: r[6] || "", mensile: num(r[7]), valore: r[8] === undefined || r[8] === "" ? null : num(r[8]), agg: r[9] ? toDate(r[9]) : null }));
    if (parseInt(imp[5]?.[7], 10)) S.set.giorno = parseInt(imp[5][7], 10);
    if (imp[6]?.[7]) S.set.contoDa = imp[6][7];
    if (imp[7]?.[7]) S.set.contoInv = imp[7][7];
    // Righe 9 e 10 di Impostazioni: quote possedute (le scrivi tu) e prezzo per quota (formula Google Finance).
    const q = imp[8]?.[7], pr = imp[9]?.[7];
    S.set.quote = q === undefined || q === "" ? null : num(q);
    S.set.prezzo = pr === undefined || pr === "" || typeof pr === "string" && pr.startsWith("#") ? null : num(pr);
  }
  if (!S.set.conti.length) S.set.conti = S.conti.map(c => c.nome);
  S.pac = pac.map(r => ({ d: toDate(r[0]), etf: r[1] || "", imp: num(r[2]), quote: r[3] === "" || r[3] === undefined ? null : num(r[3]) })).filter(p => p.d && p.imp);
}
const append = (range, values) => api("/values/" + encodeURIComponent(range) + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", { method: "POST", body: JSON.stringify({ values }) });

/* ---------- coda offline ----------
   Senza rete (o con l'accesso Google scaduto) un movimento finisce qui, salvato sul telefono,
   e parte appena possibile. Ogni elemento ha una o più scritture (ops); "done" ricorda quante
   sono già arrivate al foglio, così un versamento PAC non viene scritto due volte. */
const Q = {
  all() { return store.get("mc-queue") || []; },
  save(q) { store.set("mc-queue", q); },
  add(it) { const q = Q.all(); q.push(it); Q.save(q); },
  put(it) { Q.save(Q.all().map(x => x.id === it.id ? it : x)); },
  remove(id) { Q.save(Q.all().filter(x => x.id !== id)); },
};
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
let flushing = false;
async function flush() {
  const q = Q.all();
  if (flushing || !q.length || !navigator.onLine) return 0;
  if (!token()) { login(true); return 0; }
  flushing = true;
  let sent = 0;
  try {
    for (const it of q) {
      try {
        for (let k = it.done || 0; k < it.ops.length; k++) {
          await append(it.ops[k].range, it.ops[k].rows);
          it.done = k + 1; delete it.error; Q.put(it);
        }
        Q.remove(it.id); sent++;
      } catch (e) {
        if (e instanceof AuthError) { flushing = false; login(true); return sent; }
        if (e.code !== "offline") { it.error = e.message; Q.put(it); }
        break;
      }
    }
  } finally { flushing = false; }
  if (sent) toast(sent === 1 ? "1 movimento in attesa inviato al foglio" : sent + " movimenti in attesa inviati al foglio");
  return sent;
}
// I movimenti in coda compaiono nelle liste, segnati "in attesa"; saldi e totali arrivano dal foglio dopo l'invio.
function pendingMov() {
  const out = [];
  Q.all().forEach((it, i) => it.ops.forEach((op, j) => {
    if (!op.range.startsWith("Movimenti") || j < (it.done || 0)) return;
    op.rows.forEach((r, k) => out.push({ pending: true, qid: it.id, row: 1e9 + i * 10 + k, d: toDate(r[0]), tipo: r[1], tip: r[2], imp: num(r[3]), cat: r[4], conto: r[5], desc: r[6] }));
  }));
  return out.filter(m => m.d);
}
function pendingBanner() {
  const q = Q.all(); if (!q.length) return "";
  const err = q.find(x => x.error);
  const n = q.length === 1 ? "1 movimento in attesa di invio" : q.length + " movimenti in attesa di invio";
  const msg = err ? "Il foglio ha rifiutato l'invio: " + esc(err.error) + ". Controlla il foglio e riprova."
    : navigator.onLine ? "Sono salvati sul telefono. Li invio adesso." : "Sono salvati sul telefono e partono appena torna la rete. Saldi e totali si aggiornano dopo l'invio.";
  return `<div class="card" style="gap:8px;border-color:var(--s2)"><b style="font-weight:600">${n}</b><span class="sub">${msg}</span>${navigator.onLine ? `<button class="btn ghost" id="flushBtn">Invia ora</button>` : ""}${err ? `<button class="btn ghost" id="discardBtn" data-id="${esc(err.id)}">Scarta il movimento rifiutato</button>` : ""}</div>`;
}

// Se sul conto del PAC c'è meno della rata mensile, il prossimo versamento non può partire: avviso di ricaricare.
function pacWarn() {
  const plan = S.set.etf.reduce((a, e) => a + e.mensile, 0), da = S.set.contoDa;
  const c = S.conti.find(x => x.nome === da);
  if (!plan || !c || c.saldo >= plan) return "";
  const np = nextPac(), hide = isHidden();
  const msg = hide ? `Il saldo non basta per il versamento del ${np.d.getDate()} ${MESI[np.d.getMonth()]}.`
    : `Ci sono ${eur(c.saldo)}, ma il versamento del ${np.d.getDate()} ${MESI[np.d.getMonth()]} ne preleva ${eur(plan)}. Aggiungi almeno ${eur(plan - c.saldo)}.`;
  return `<div class="card" role="alert" style="gap:6px;border-color:var(--s2)"><b style="font-weight:600">Ricarica ${esc(da)}</b><span class="sub">${msg}</span></div>`;
}

/* ---------- calcoli ---------- */
const isTr = m => m.tip === "Trasferimenti";
// Una spesa che copre più mesi (es. abbonamento trimestrale) ha nella descrizione "[3 mesi]".
// Solo i grafici la dividono tra i mesi; saldi e patrimonio restano con l'importo intero nel giorno pagato.
const SPREAD_RE = /\s*\[(\d{1,2}) mesi\]/i;
const spreadOf = m => { const r = SPREAD_RE.exec(m.desc || ""); const n = r ? +r[1] : 1; return n > 1 && n <= 24 ? n : 1; };
// Il marcatore vale solo se è tra 2 e 24; altrimenti resta nel testo e non lo tocco.
const cleanDesc = d => String(d || "").replace(SPREAD_RE, (t, n) => +n > 1 && +n <= 24 ? "" : t).trim();
function stats(month, spread) {
  const part = m => {
    const n = spread && m.tipo === "Spesa" ? spreadOf(m) : 1;
    const k = (month.getFullYear() - m.d.getFullYear()) * 12 + month.getMonth() - m.d.getMonth();
    return k >= 0 && k < n ? m.imp / n : 0;
  };
  const ms = S.mov.filter(m => !isTr(m)).map(m => ({ ...m, imp: part(m) })).filter(m => m.imp);
  const sp = ms.filter(m => m.tipo === "Spesa");
  const ent = ms.filter(m => m.tipo === "Entrata").reduce((a, m) => a + m.imp, 0);
  const usc = sp.reduce((a, m) => a + m.imp, 0);
  const bis = sp.filter(m => m.cat === "Bisogno").reduce((a, m) => a + m.imp, 0);
  const des = sp.filter(m => m.cat === "Desiderio").reduce((a, m) => a + m.imp, 0);
  const group = list => { const by = {}; list.forEach(m => by[m.tip] = (by[m.tip] || 0) + m.imp); return Object.entries(by).sort((a, b) => b[1] - a[1]); };
  return { ent, usc, net: ent - usc, bis, des, byTip: group(sp), byEnt: group(ms.filter(m => m.tipo === "Entrata")) };
}
// Un trasferimento è salvato come due righe (uscita dal conto A, entrata sul conto B): in lista le mostro come una.
function pairTransfers(list) {
  const used = new Set(), out = [];
  list.forEach((m, i) => {
    if (used.has(i)) return;
    if (isTr(m)) {
      // Più trasferimenti uguali nello stesso giorno: scelgo la riga attaccata (l'app le scrive in coppia) e, a parità, quella con "Verso/Da" coerente.
      let j = -1, best = -1;
      list.forEach((o, k) => {
        if (k === i || used.has(k) || !isTr(o) || o.tipo === m.tipo || o.imp !== m.imp || o.d.getTime() !== m.d.getTime()) return;
        const [u, e] = m.tipo === "Spesa" ? [m, o] : [o, m];
        const score = (Math.abs(o.row - m.row) === 1 ? 2 : 0) + (/^verso /i.test(u.desc) ? /^verso (.*)$/i.exec(u.desc)[1] === e.conto : /^da /i.test(e.desc) && e.desc.slice(3) === u.conto) * 1;
        if (score > best) { best = score; j = k; }
      });
      if (j >= 0) {
        used.add(i); used.add(j);
        const out1 = m.tipo === "Spesa" ? m : list[j], in1 = m.tipo === "Spesa" ? list[j] : m;
        out.push({ kind: "tr", d: m.d, imp: m.imp, da: out1.conto, a: in1.conto, desc: out1.desc && !/^verso /i.test(out1.desc) ? out1.desc : "", row: Math.max(m.row, list[j].row), pending: m.pending || list[j].pending, parts: [out1, in1] });
        return;
      }
    }
    used.add(i); out.push(m);
  });
  return out;
}
const byDateDesc = arr => arr.slice().sort((a, b) => b.d - a.d || b.row - a.row);

/* ---------- pezzi di interfaccia ---------- */
const ICON = {
  refresh: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  prev: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
  search: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  eye: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.5M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>',
  swap: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h14l-3-3M20 16H6l3 3"/></svg>',
  google: '<svg aria-hidden="true" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>',
};
const catDot = m => m.tipo === "Spesa" && !isTr(m) && m.cat ? `<span class="dot" style="background:var(${m.cat === "Desiderio" ? "--s2" : "--s1"})" aria-label="${esc(m.cat)}"></span>` : "";
const pendTag = m => m.pending ? `<span class="pend">in attesa</span>` : "";
// Ogni riga mostrata è un pulsante: toccandola si apre il dettaglio. VIEW ricorda quale movimento c'è dietro.
const VIEW = new Map();
function rowHtml(m, withDate) {
  const v = (m.kind === "tr" ? "t" : "r") + m.row;
  VIEW.set(v, m);
  if (m.kind === "tr") {
    return `<button class="mv" data-view="${v}"><span class="badge">${ICON.swap}</span>
      <span class="t"><b>Trasferimento${pendTag(m)}</b><span>${esc(m.da)} → ${esc(m.a)}${m.desc ? " · " + esc(m.desc) : ""}${withDate ? " · " + shortDay(m.d) : ""}</span></span>
      <span class="a tr">${M(m.imp)}</span></button>`;
  }
  const inc = m.tipo === "Entrata";
  const n = spreadOf(m);
  const sub = [m.conto, withDate ? shortDay(m.d) : "", n > 1 ? "su " + n + " mesi" : "", cleanDesc(m.desc)].filter(Boolean).join(" · ");
  return `<button class="mv" data-view="${v}"><span class="badge ${inc ? "in" : ""}" aria-hidden="true">${esc((m.tip || "?").slice(0, 2))}</span>
    <span class="t"><b>${esc(isTr(m) ? "Trasferimento" : m.tip)}${catDot(m)}${pendTag(m)}</b><span>${esc(sub)}</span></span>
    <span class="a ${inc && !isTr(m) ? "pos" : ""}">${inc ? "+" : "−"}${M(m.imp)}</span></button>`;
}
function grouped(items) {
  if (!items.length) return `<div class="empty">Nessun movimento.</div>`;
  let out = "", last = "", open = false;
  items.forEach(m => {
    const k = m.d.toDateString();
    if (k !== last) { if (open) out += "</div>"; out += `<div class="day">${dayLabel(m.d)}</div><div class="list">`; open = true; last = k; }
    out += rowHtml(m, false);
  });
  return out + (open ? "</div>" : "");
}
function banner() {
  const e = S.error; if (!e) return "";
  let msg, action = "";
  if (e.code === "reauth") {
    return `<div class="banner" role="alert"><span>L'accesso a Google è scaduto. Accedi di nuovo per vedere i dati aggiornati.</span><button class="gbtn" id="loginBtn">${ICON.google}Accedi con Google</button></div>`;
  }
  if (e.code === "config") msg = "Manca il Client ID di Google in config.js. Segui la guida per crearlo e incollalo nel file.";
  else if (e.code === "offline") msg = S.mov.length ? "Sei offline: vedi gli ultimi dati scaricati." : "Sei offline e non ho ancora dati salvati sul telefono.";
  else if (e.code === "forbidden") msg = "Google non permette a questo account di aprire il foglio. Accedi con l'account proprietario del foglio.";
  else if (e.code === "notfound") {
    return `<div class="banner" role="alert"><span>Non trovo il foglio collegato. Controlla di aver incollato il link giusto.</span><button class="btn ghost" id="changeSheet">Cambia foglio</button></div>`;
  }
  else if (e.code === "access_denied") msg = "Non hai dato il permesso di usare il foglio. Senza, l'app non può leggere i dati.";
  else msg = "Il foglio non ha risposto: " + esc(e.message || "errore sconosciuto") + ".";
  if (e.code !== "config") action = `<button class="btn ghost" id="retry">Riprova</button>`;
  return `<div class="banner" role="alert"><span>${msg}</span>${action}</div>`;
}

/* ---------- schermate ---------- */
function vWelcome() {
  const setup = !sheetId();
  return `<section class="welcome">
    <img class="logo" src="icons/icon-192.png" alt="">
    <div class="stack" style="gap:8px"><h1 class="h1" style="font-size:32px">Mio Contabile</h1>
      <span class="sub" style="font-size:15px">Spese, entrate, conti e PAC, salvati nel tuo foglio Google.</span></div>
    ${S.error && S.error.code !== "reauth" ? banner() : ""}
    ${setup ? `<form id="setupForm" class="stack" style="gap:14px" novalidate>
      <div class="field"><label for="sheetUrl">Link del tuo foglio Google</label>
        <input class="inp" id="sheetUrl" placeholder="https://docs.google.com/spreadsheets/d/…" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url"></div>
      <div class="field"><label for="nomeIn">Come ti chiami? (facoltativo)</label>
        <input class="inp" id="nomeIn" autocomplete="given-name"></div>
      <span class="err" id="setupErr" role="alert"></span>
      <button class="gbtn" type="submit">${ICON.google}Continua con Google</button>
    </form>
    <span class="sub">Link e nome restano salvati solo su questo telefono. Il link lo copi dal foglio con Condividi → Copia link.</span>`
    : `<button class="gbtn" id="loginBtn">${ICON.google}Accedi con Google</button>
    <span class="sub">L'app chiede solo il permesso di leggere e modificare i tuoi fogli Google. I dati restano nel tuo account.</span>`}
  </section>`;
}
function parseSheet(v) {
  const s = String(v || "").trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/) || s.match(/^([a-zA-Z0-9_-]{30,})$/);
  return m ? m[1] : null;
}
function submitSetup(ev) {
  ev.preventDefault();
  const id = parseSheet($("#sheetUrl").value);
  if (!id) { $("#setupErr").textContent = "Non riconosco il link: deve iniziare con docs.google.com/spreadsheets/d/…"; return; }
  store.set("mc-sheet", id);
  const n = $("#nomeIn").value.trim(); if (n) store.set("mc-nome", n); else store.del("mc-nome");
  S.error = null;
  login(false);
}
function changeSheet() {
  if (Q.all().length) { toast("Prima invia i movimenti in attesa, poi cambia foglio."); return; }
  store.del("mc-sheet"); store.del("mc-cache"); store.del("mc-known");
  S.mov = []; S.conti = []; S.pac = []; S.loadedAt = null; S.error = null;
  render();
}
function vHome() {
  const now = new Date();
  // Il conto investimenti (ETF) non entra nel patrimonio e non compare in Home: si vede nella schermata PAC.
  const inv = S.set.contoInv;
  const liquid = S.conti.filter(c => c.nome !== inv);
  const tot = liquid.reduce((a, c) => a + c.saldo, 0);
  const st = stats(now);
  const spT = st.bis + st.des, pb = spT ? st.bis / spT * 100 : 0;
  const recent = byDateDesc(pairTransfers(byDateDesc(S.mov.concat(pendingMov())).slice(0, 12))).slice(0, 4);
  const time = S.loadedAt ? new Date(S.loadedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "";
  // Occhio: nasconde le cifre del patrimonio quando mostri l'app a qualcuno. La scelta resta salvata sul telefono.
  const hide = isHidden();
  const money = M;
  return `
  <div class="top">
    <div class="stack"><span class="eyebrow">${MESI[now.getMonth()]} ${now.getFullYear()}</span><h1 class="h1">${nome() ? "Ciao " + esc(nome()) : "Ciao"}</h1></div>
    <button class="round-btn ${S.loading ? "spin" : ""}" id="refresh" aria-label="Aggiorna dal foglio">${ICON.refresh}</button>
  </div>
  ${banner()}
  ${pendingBanner()}
  ${pacWarn()}
  <section class="hero" aria-label="Patrimonio">
    <div class="top" style="align-items:flex-start"><div class="stack"><span class="eyebrow">Patrimonio</span>
      <span class="big">${liquid.length ? money(tot) : "—"}</span>
      <span class="sub">su ${liquid.length} conti${time ? " · aggiornato alle " + time : ""}</span></div>
      <button class="eye" id="toggleHide" aria-pressed="${hide}" aria-label="${hide ? "Mostra le cifre" : "Nascondi le cifre"}">${hide ? ICON.eyeOff : ICON.eye}</button></div>
    <div class="tiles">${liquid.slice().sort((a, b) => b.saldo - a.saldo).map(c => `<div class="tile"><span>${esc(c.nome)}</span><b>${money(c.saldo)}</b></div>`).join("")}</div>
  </section>
  <section class="card">
    <div class="row"><span class="eyebrow">Questo mese</span><span class="sub" style="font-size:12px">trasferimenti esclusi</span></div>
    <div class="trio">
      <div class="stack"><span class="sub">Entrate</span><b>${M(st.ent)}</b></div>
      <div class="stack"><span class="sub">Uscite</span><b>${M(st.usc)}</b></div>
      <div class="stack"><span class="sub">Netto</span><b class="${hide ? "" : st.net >= 0 ? "pos" : "neg"}">${hide ? "" : st.net >= 0 ? "+" : ""}${M(st.net)}</b></div>
    </div>
    ${spT ? `<div class="split" role="img" aria-label="Bisogno ${Math.round(pb)}%, desiderio ${Math.round(100 - pb)}%">${st.bis ? `<i style="width:${pb}%;background:var(--s1)"></i>` : ""}${st.des ? `<i style="width:${100 - pb}%;background:var(--s2)"></i>` : ""}</div>
    <div class="legend"><span><i class="sw" style="background:var(--s1)"></i>Bisogno ${M0(st.bis)} · ${Math.round(pb)}%</span><span><i class="sw" style="background:var(--s2)"></i>Desiderio ${M0(st.des)} · ${Math.round(100 - pb)}%</span></div>`
      : `<span class="empty">Nessuna spesa questo mese. Tocca + per aggiungerne una.</span>`}
  </section>
  <section class="card" style="padding-bottom:8px;gap:4px">
    <div class="row"><span class="eyebrow">Ultimi movimenti</span><button class="link" data-goto="mov">Vedi tutti</button></div>
    ${recent.length ? `<div class="list">${recent.map(m => rowHtml(m, true)).join("")}</div>` : `<span class="empty">Ancora nessun movimento.</span>`}
  </section>`;
}
function vMov() {
  const q = S.movQuery.trim().toLowerCase();
  let ms = S.mov.concat(pendingMov()).filter(m => sameMonth(m.d, S.movMonth));
  if (S.movFilter === "spese") ms = ms.filter(m => m.tipo === "Spesa" && !isTr(m));
  if (S.movFilter === "entrate") ms = ms.filter(m => m.tipo === "Entrata" && !isTr(m));
  if (S.movFilter === "trasf") ms = ms.filter(isTr);
  if (q) ms = ms.filter(m => [m.tip, m.desc, m.conto, m.cat].join(" ").toLowerCase().includes(q));
  const items = byDateDesc(pairTransfers(byDateDesc(ms)));
  const chip = (id, l) => `<button class="chip" data-filter="${id}" aria-pressed="${S.movFilter === id}">${l}</button>`;
  return `
  <div class="monthbar">
    <button class="round-btn" id="prevM" aria-label="Mese precedente">${ICON.prev}</button>
    <span class="label">${MESI[S.movMonth.getMonth()]} ${S.movMonth.getFullYear()}</span>
    <button class="round-btn" id="nextM" aria-label="Mese successivo">${ICON.next}</button>
  </div>
  ${banner()}
  ${pendingBanner()}
  <label class="search">${ICON.search}<input id="q" type="search" placeholder="Cerca descrizione, tipologia, conto" value="${esc(S.movQuery)}" aria-label="Cerca movimenti" autocomplete="off"></label>
  <div class="chips">${chip("tutti", "Tutti")}${chip("spese", "Spese")}${chip("entrate", "Entrate")}${chip("trasf", "Trasferimenti")}</div>
  <section class="card" style="padding-top:6px;padding-bottom:6px;gap:0">${grouped(items)}</section>
  <span class="sub">Tocca un movimento per leggerlo tutto, modificarlo o eliminarlo.</span>`;
}
function barsChart(rows, pick) {
  const max = (() => { const v = Math.max(1, ...rows.map(r => Math.max(r.a, r.b))); const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10) * p; })();
  const H = 110;
  const cols = rows.map((r, i) => {
    const ha = r.a / max * H, hb = r.b / max * H;
    return `<button class="col" data-cm="${isoDate(r.m)}" aria-pressed="${i === pick}" aria-label="${MESI[r.m.getMonth()]}"><i class="bar" style="width:12px;height:${ha.toFixed(1)}px;background:var(--s1)"></i><i class="bar" style="width:12px;height:${hb.toFixed(1)}px;background:var(--s2)"></i></button>`;
  }).join("");
  return `<div class="chart"><div class="yax"><span>${isHidden() ? "" : axisK(max)}</span><span>${isHidden() ? "" : axisK(max / 2)}</span><span>${isHidden() ? "" : "0"}</span></div>
    <div class="plot"><span class="g" style="top:0"></span><span class="g" style="top:${H / 2}px"></span><span class="base"></span>${cols}</div></div>
    <div class="xax">${rows.map((x, i) => `<span class="${i === pick ? "on" : ""}">${MESI_B[x.m.getMonth()]}</span>`).join("")}</div>`;
}
function hbars(list, color, emptyMsg) {
  const max = list[0]?.[1] || 1;
  return list.length ? list.map(([k, v]) => `<div class="hbar"><span class="nm">${esc(k)}</span><span class="tr"><i style="width:${Math.max(2, v / max * 100)}%;background:var(${color})"></i></span><span>${M(v)}</span></div>`).join("") : `<span class="empty">${emptyMsg}</span>`;
}
function vCharts() {
  const now = monthStart(new Date());
  const months = [5, 4, 3, 2, 1, 0].map(i => addMonths(now, -i));
  const all = months.map(m => ({ m, ...stats(m, true) }));
  const avg = all.reduce((a, s) => a + s.usc, 0) / all.length;
  // Si può andare avanti fino all'ultimo mese coperto da una spesa divisa su più mesi.
  const last = S.mov.reduce((a, m) => { const n = m.tipo === "Spesa" ? spreadOf(m) : 1; const e = addMonths(monthStart(m.d), n - 1); return e > a ? e : a; }, now);
  // Un solo mese scelto per tutta la schermata: si cambia con le frecce o toccando una colonna del grafico.
  const sel = S.chartMonth, st = stats(sel, true), name = MESI[sel.getMonth()];
  const pick = months.findIndex(m => sameMonth(m, sel));
  return `
  <div class="top"><div class="stack"><span class="eyebrow">${MESI[months[0].getMonth()]} – ${MESI[now.getMonth()]} ${now.getFullYear()}</span><h1 class="h1">Grafici</h1></div></div>
  ${banner()}
  <section class="card">
    <div class="row"><span class="eyebrow">Entrate e uscite</span><span class="sub">uscite medie ${M0(avg)}</span></div>
    ${barsChart(all.map(s => ({ m: s.m, a: s.ent, b: s.usc })), pick)}
    <div class="legend"><span><i class="sw" style="background:var(--s1)"></i>Entrate</span><span><i class="sw" style="background:var(--s2)"></i>Uscite</span></div>
  </section>
  <div class="monthbar">
    <button class="round-btn" id="prevC" aria-label="Mese precedente">${ICON.prev}</button>
    <span class="label">${name} ${sel.getFullYear()}</span>
    <button class="round-btn" id="nextC" aria-label="Mese successivo" ${sel >= last ? "disabled" : ""}>${ICON.next}</button>
  </div>
  <section class="card">
    <div class="row"><span class="eyebrow">Spese per tipologia</span><b style="font-weight:600">${M(st.usc)}</b></div>
    ${hbars(st.byTip, "--s2", "Nessuna spesa a " + name + ".")}
  </section>
  <section class="card">
    <div class="row"><span class="eyebrow">Entrate per tipologia</span><b style="font-weight:600">${M(st.ent)}</b></div>
    ${hbars(st.byEnt, "--s1", "Nessuna entrata a " + name + ".")}
  </section>
  <span class="sub">Trasferimenti tra conti esclusi. Le spese che coprono più mesi sono divise tra quei mesi.</span>`;
}
function nextPac() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  let d = new Date(t.getFullYear(), t.getMonth(), S.set.giorno);
  if (d < t) d = new Date(t.getFullYear(), t.getMonth() + 1, S.set.giorno);
  return { d, days: Math.round((d - t) / 864e5) };
}
function vPac() {
  const etf = S.set.etf, plan = etf.reduce((a, e) => a + e.mensile, 0);
  const vers = n => S.pac.filter(p => p.etf === n).reduce((a, p) => a + p.imp, 0);
  const totV = S.pac.reduce((a, p) => a + p.imp, 0);
  const hasVal = etf.some(e => e.valore != null);
  const totVal = etf.reduce((a, e) => a + (e.valore != null ? e.valore : vers(e.nome)), 0);
  const np = nextPac();
  const bal = n => S.conti.find(c => c.nome === n)?.saldo;
  const colors = ["--s1", "--s2"];
  const labels = ["Azioni", "Obbligazioni"];
  const hist = byDateDesc(S.pac.map((p, i) => ({ ...p, row: i }))).slice(0, 12);
  return `
  <div class="top"><div class="stack"><span class="eyebrow">Piano di accumulo · ${esc(S.set.contoDa)}</span><h1 class="h1">PAC</h1></div></div>
  ${banner()}
  ${pacWarn()}
  <section class="hero" aria-label="Prossimo versamento">
    <div class="stack"><span class="eyebrow">Prossimo versamento</span>
      <span class="big" style="font-size:34px;line-height:1.1">${np.d.getDate()} ${MESI[np.d.getMonth()]}</span>
      <span class="sub">${np.days === 0 ? "oggi" : np.days === 1 ? "domani" : "tra " + np.days + " giorni"} · ${M(plan)} da ${esc(S.set.contoDa)}</span></div>
    <div class="tiles two">
      <div class="tile"><span>${hasVal ? "Valore attuale" : "Conto " + esc(S.set.contoInv)}</span><b>${hasVal ? M(totVal) : (bal(S.set.contoInv) != null ? M(bal(S.set.contoInv)) : "—")}</b></div>
      <div class="tile"><span>${hasVal ? "Versato" : "Liquidità " + esc(S.set.contoDa)}</span><b>${hasVal ? M(totV) : (bal(S.set.contoDa) != null ? M(bal(S.set.contoDa)) : "—")}</b></div>
    </div>
  </section>
  <section class="card">
    <span class="eyebrow">I tuoi ETF</span>
    ${etf.map((e, i) => { const v = vers(e.nome); return `<div class="etf">
      <div class="row"><span class="nm">${esc(e.nome)}</span><b style="white-space:nowrap">${M0(e.mensile)}/mese</b></div>
      <div class="row sub"><span>${esc(e.isin || "")}${e.isin ? " · " : ""}versato ${M(v)}</span><span>${plan ? Math.round(e.mensile / plan * 100) : 0}%</span></div>
      ${e.valore != null ? `<div class="row sub"><span>valore ${M(e.valore)}</span><span class="${e.valore - v >= 0 ? "pos" : "neg"}">${e.valore - v >= 0 ? "+" : ""}${M(e.valore - v)}</span></div>` : ""}
      ${i === 0 && S.set.quote != null ? `<div class="row sub"><span>${S.set.quote.toLocaleString("it-IT", { maximumFractionDigits: 6 })} quote${S.set.prezzo != null ? " · " + M(S.set.prezzo) + " a quota (Google Finance)" : ""}</span></div>` : ""}
    </div>`; }).join("") || `<span class="empty">Aggiungi gli ETF nel foglio Impostazioni.</span>`}
    ${etf.length ? `<div class="split">${etf.map((e, i) => `<i style="width:${plan ? e.mensile / plan * 100 : 0}%;background:var(${colors[i] || "--muted"})"></i>`).join("")}</div>
    <div class="legend">${etf.map((e, i) => `<span><i class="sw" style="background:var(${colors[i] || "--muted"})"></i>${labels[i] || esc(e.nome)}</span>`).join("")}</div>` : ""}
    <button class="btn ghost" id="toggleVal">${S.valForm ? "Chiudi" : "Aggiorna quote possedute"}</button>
    ${S.valForm ? `<form id="valForm" class="stack" style="gap:12px">
      <div class="field"><label for="quoteIn">Quote totali che vedi su ${esc(S.set.contoDa || "il broker")}</label><input class="inp" id="quoteIn" inputmode="decimal" placeholder="es. 1,164669" value="${S.set.quote != null ? S.set.quote.toLocaleString("it-IT", { maximumFractionDigits: 6 }) : ""}"></div>
      <span class="sub" style="font-size:12.5px">Il valore si calcola da solo: quote × prezzo di oggi.</span>
      <span class="err" id="valErr" role="alert"></span>
      <button class="btn" type="submit" id="valSave">Salva quote</button></form>` : ""}
  </section>
  <section class="card">
    <div class="row"><span class="eyebrow">Versamenti</span><span class="sub">${S.pac.length} registrati</span></div>
    ${hist.length ? `<div class="list">${hist.map(p => `<div class="mv"><span class="badge in" aria-hidden="true">${esc((p.etf.split(" ")[2] || "ET").slice(0, 2))}</span>
      <div class="t"><b>${esc(p.etf)}</b><span>${p.d.getDate()} ${MESI[p.d.getMonth()]} ${p.d.getFullYear()}${p.quote ? " · " + p.quote.toLocaleString("it-IT", { maximumFractionDigits: 4 }) + " quote" : ""}</span></div>
      <span class="a">${M(p.imp)}</span></div>`).join("")}</div>` : `<span class="sub" style="font-size:14px">Il primo arriva il ${np.d.getDate()} ${MESI[np.d.getMonth()]}. Registralo qui quando il broker lo esegue.</span>`}
    <button class="btn ghost" id="togglePac">${S.pacForm ? "Chiudi" : "Registra versamento"}</button>
    ${S.pacForm ? `<form id="pacForm" class="stack" style="gap:12px">
      <div class="field"><label for="pacDate">Data</label><input class="inp" type="date" id="pacDate" value="${isoDate(new Date())}"></div>
      ${etf.map((e, i) => `<div class="field"><span class="lab">${esc(e.nome)}</span><div class="pair" style="grid-template-columns:1fr 1fr">
        <input class="inp" id="pacAmt${i}" inputmode="decimal" value="${fmt2(e.mensile)}" aria-label="Importo ${esc(e.nome)}">
        <input class="inp" id="pacQ${i}" inputmode="decimal" placeholder="quote, se le sai" aria-label="Quote ${esc(e.nome)}"></div></div>`).join("")}
      <label class="check"><input type="checkbox" id="pacTr" checked><span>Registra anche il trasferimento ${esc(S.set.contoDa)} → ${esc(S.set.contoInv)}, così i saldi dei conti restano giusti</span></label>
      <span class="err" id="pacErr" role="alert"></span>
      <button class="btn" type="submit" id="pacSave">Salva versamento</button></form>` : ""}
  </section>
  <section class="card">
    <span class="eyebrow">Versato se continui</span>
    <div class="kv4">${[5, 10, 20, 40].map(y => `<div><span class="sub" style="font-size:12px">${y} anni</span><b>${MK(plan * 12 * y)}</b></div>`).join("")}</div>
    <span class="sub" style="font-size:12px">Solo la somma dei versamenti, senza rendimento.</span>
  </section>
  <div class="row" style="justify-content:center;gap:24px">
    <button class="link" id="changeSheet" style="color:var(--muted)">Cambia foglio</button>
    <button class="link" id="logout" style="color:var(--muted)">Esci dall'account Google</button>
  </div>`;
}

/* ---------- render ---------- */
function render() {
  const authed = !!sheetId() && (!!token() || S.mov.length > 0);
  const app = $("#app");
  if (!authed) { $("#nav").hidden = true; app.innerHTML = vWelcome(); bind(); return; }
  $("#nav").hidden = false;
  VIEW.clear();
  // Quello che hai scritto nei moduli PAC non si perde se la schermata si ridisegna (aggiornamento in background).
  const typed = {};
  $$("#pacForm input, #valForm input").forEach(i => { if (i.id) typed[i.id] = i.type === "checkbox" ? i.checked : i.value; });
  $$(".tab").forEach(t => t.setAttribute("aria-current", t.dataset.tab === S.tab ? "page" : "false"));
  app.innerHTML = S.tab === "home" ? vHome() : S.tab === "mov" ? vMov() : S.tab === "charts" ? vCharts() : vPac();
  bind();
  Object.entries(typed).forEach(([id, v]) => { const el = document.getElementById(id); if (!el) return; if (el.type === "checkbox") el.checked = v; else el.value = v; });
}
function spin(on) { const b = $("#refresh"); if (b) b.classList.toggle("spin", on); }
function bind() {
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
  on("#loginBtn", "click", () => login(false));
  on("#retry", "click", () => { S.error = null; loadAll(); });
  on("#refresh", "click", () => loadAll());
  on("#toggleHide", "click", () => { if (store.get("mc-show")) store.del("mc-show"); else store.set("mc-show", true); render(); });
  on("#prevM", "click", () => { S.movMonth = addMonths(S.movMonth, -1); render(); });
  on("#nextM", "click", () => { S.movMonth = addMonths(S.movMonth, 1); render(); });
  on("#q", "input", e => { S.movQuery = e.target.value; const pos = e.target.selectionStart; render(); const n = $("#q"); n.focus(); try { n.setSelectionRange(pos, pos); } catch {} });
  $$("[data-filter]").forEach(b => b.addEventListener("click", () => { S.movFilter = b.dataset.filter; render(); }));
  $$("[data-goto]").forEach(b => b.addEventListener("click", () => go(b.dataset.goto)));
  $$("[data-view]").forEach(b => b.addEventListener("click", () => openDetail(VIEW.get(b.dataset.view))));
  $$("[data-cm]").forEach(b => b.addEventListener("click", () => { S.chartMonth = fromIso(b.dataset.cm); render(); }));
  on("#prevC", "click", () => { S.chartMonth = addMonths(S.chartMonth, -1); render(); });
  on("#nextC", "click", () => { S.chartMonth = addMonths(S.chartMonth, 1); render(); });
  on("#togglePac", "click", () => { S.pacForm = !S.pacForm; render(); });
  on("#toggleVal", "click", () => { S.valForm = !S.valForm; render(); });
  on("#pacForm", "submit", savePac);
  on("#valForm", "submit", saveVal);
  on("#logout", "click", logout);
  $$("#changeSheet").forEach(b => b.addEventListener("click", changeSheet)); // in PAC può comparirne due (avviso e fondo pagina)
  on("#setupForm", "submit", submitSetup);
  on("#flushBtn", "click", () => { flush().then(() => loadAll()); });
  const dis = $("#discardBtn");
  if (dis) {
    // Come Elimina: primo tocco chiede conferma, secondo (dopo mezzo secondo) scarta; la conferma scade dopo 4 secondi.
    const part = (Q.all().find(x => x.id === dis.dataset.id) || {}).done > 0;
    let armedAt = 0;
    dis.addEventListener("click", () => {
      if (!dis.classList.contains("armed")) {
        dis.classList.add("armed"); armedAt = Date.now();
        dis.textContent = part ? "Una parte è già nel foglio. Tocca di nuovo per scartare il resto" : "Tocca di nuovo per scartarlo";
        setTimeout(() => { if (dis.isConnected) { dis.classList.remove("armed"); dis.textContent = "Scarta il movimento rifiutato"; } }, 4000);
        return;
      }
      if (Date.now() - armedAt < 600) return;
      Q.remove(dis.dataset.id); render(); toast("Movimento rifiutato scartato"); loadAll();
    });
  }
}
function go(tab) { S.tab = tab; render(); window.scrollTo(0, 0); }

/* ---------- avvisi ---------- */
let toastT;
function toast(msg, action) {
  const h = $("#toastHost");
  h.innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span>${action ? `<button id="tAct">${esc(action.label)}</button>` : ""}</div>`;
  if (action) $("#tAct").onclick = () => { h.innerHTML = ""; action.run(); };
  clearTimeout(toastT); toastT = setTimeout(() => h.innerHTML = "", action ? 9000 : 3500);
}

/* ---------- nuovo movimento ---------- */
const A = { tipo: "Spesa", tip: "", cat: "Bisogno", conto: "", da: "", a: "", mesi: "1" };
function openAdd(draft) {
  const last = store.get("mc-last") || {};
  Object.assign(A, { tipo: "Spesa", tip: "", cat: "Bisogno", conto: last.Spesa || "", da: last.da || "", a: last.a || "", mesi: "1" }, draft ? draft.A : {});
  EDIT = draft?.edit || null;
  // In modifica un trasferimento resta trasferimento (sono due righe) e una spesa o entrata resta una riga sola.
  const tipi = !EDIT ? ["Spesa", "Entrata", "Trasferimento"] : EDIT.kind === "tr" ? [] : ["Spesa", "Entrata"];
  $("#overlay").innerHTML = `<div class="scrim" id="scrim"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="addT"><div class="sheet-in">
    <div class="grab" aria-hidden="true"></div>
    <div class="row" style="align-items:center"><h2 class="h1" id="addT" style="font-size:22px">${EDIT ? "Modifica " + (EDIT.kind === "tr" ? "trasferimento" : "movimento") : "Nuovo movimento"}</h2><button class="link" id="closeAdd" style="font-size:15px">Annulla</button></div>
    ${tipi.length ? `<div class="seg ${tipi.length === 2 ? "two" : ""}" id="segTipo">${tipi.map(t => `<button type="button" data-tipo="${t}" aria-pressed="${A.tipo === t}">${t}</button>`).join("")}</div>` : ""}
    <label class="amount"><span>€</span><input id="amt" inputmode="decimal" placeholder="0,00" autocomplete="off" aria-label="Importo" value="${esc(draft?.amt || "")}"></label>
    <div id="addFields" class="stack" style="gap:16px"></div>
    <div class="pair">
      <div class="field"><label for="addDate">Data</label><input class="inp" type="date" id="addDate" value="${esc(draft?.date || isoDate(new Date()))}"></div>
      <div class="field"><label for="addDesc">Descrizione</label><input class="inp" id="addDesc" placeholder="facoltativa" autocomplete="off" value="${esc(draft?.desc || "")}"></div>
    </div>
    <span class="err" id="addErr" role="alert"></span>
    <button class="btn" id="saveAdd">${EDIT ? "Salva modifiche" : "Salva nel foglio"}</button>
  </div></div>`;
  document.body.style.overflow = "hidden";
  $("#scrim").onclick = closeAdd; $("#closeAdd").onclick = closeAdd;
  $$("#segTipo button").forEach(b => b.onclick = () => {
    A.tipo = b.dataset.tipo; A.tip = ""; A.conto = (store.get("mc-last") || {})[A.tipo] || "";
    $$("#segTipo button").forEach(x => x.setAttribute("aria-pressed", x === b)); fields();
  });
  $("#saveAdd").onclick = saveAdd;
  fields();
  if (!draft) setTimeout(() => $("#amt")?.focus(), 80);
}
function chips(list, cur, key) {
  // Un valore già nel foglio ma non tra le scelte (es. "Trasferimenti" in una spesa Eng:) resta visibile e selezionato.
  if (cur && !list.includes(cur)) list = list.concat(cur);
  return `<div class="chips">${list.map(v => `<button type="button" class="chip" data-k="${key}" data-v="${esc(v)}" aria-pressed="${v === cur}">${esc(v)}</button>`).join("")}</div>`;
}
function fields() {
  const conti = S.set.conti.length ? S.set.conti : S.conti.map(c => c.nome);
  let h = "";
  if (A.tipo === "Spesa") {
    h += `<div class="field"><span class="lab">Tipologia</span>${chips(S.set.spesa, A.tip, "tip")}</div>`;
    h += `<div class="field"><span class="lab">Bisogno o desiderio?</span><div class="seg two">${S.set.categorie.slice(0, 2).map((c, i) => `<button type="button" data-k="cat" data-v="${esc(c)}" aria-pressed="${A.cat === c}"><i class="sw" style="width:9px;height:9px;background:var(${i ? "--s2" : "--s1"})"></i>${esc(c)}</button>`).join("")}</div></div>`;
    h += `<div class="field"><span class="lab">Pagato con</span>${chips(conti, A.conto, "conto")}</div>`;
    h += `<div class="field"><span class="lab">Quanti mesi copre? (solo per i grafici)</span><div class="seg five">${(["1", "2", "3", "6", "12"].includes(A.mesi) ? ["1", "2", "3", "6", "12"] : ["1", "2", "3", "6", "12", A.mesi]).map(n => `<button type="button" data-k="mesi" data-v="${n}" aria-pressed="${A.mesi === n}">${n}</button>`).join("")}</div></div>`;
  } else if (A.tipo === "Entrata") {
    h += `<div class="field"><span class="lab">Da chi</span>${chips(S.set.entrata, A.tip, "tip")}</div>`;
    h += `<div class="field"><span class="lab">Arrivato su</span>${chips(conti, A.conto, "conto")}</div>`;
  } else {
    h += `<div class="field"><span class="lab">Da</span>${chips(conti, A.da, "da")}</div>`;
    h += `<div class="field"><span class="lab">A</span>${chips(conti, A.a, "a")}</div>`;
  }
  $("#addFields").innerHTML = h;
  $$("#addFields [data-k]").forEach(b => b.onclick = () => { A[b.dataset.k] = b.dataset.v; fields(); });
}
function closeAdd() { $("#overlay").innerHTML = ""; document.body.style.overflow = ""; EDIT = null; }
async function saveAdd() {
  const err = $("#addErr"); err.textContent = "";
  const amtRaw = $("#amt").value, imp = parseInputAmount(amtRaw);
  const dRaw = $("#addDate").value, d = fromIso(dRaw || isoDate(new Date()));
  const desc = $("#addDesc").value.trim();
  if (!(imp > 0)) { err.textContent = "Scrivi un importo maggiore di zero."; return; }
  const ds = sheetDate(d);
  let rows;
  if (A.tipo === "Trasferimento") {
    if (!A.da || !A.a) { err.textContent = "Scegli il conto di partenza e quello di arrivo."; return; }
    if (A.da === A.a) { err.textContent = "I due conti devono essere diversi."; return; }
    rows = [[ds, "Spesa", "Trasferimenti", imp, "Bisogno", A.da, desc || "Verso " + A.a], [ds, "Entrata", "Trasferimenti", imp, "", A.a, desc || "Da " + A.da]];
  } else {
    if (!A.tip) { err.textContent = A.tipo === "Spesa" ? "Scegli una tipologia." : "Scegli da chi arriva."; return; }
    if (!A.conto) { err.textContent = "Scegli il conto."; return; }
    const mesi = A.tipo === "Spesa" && +A.mesi > 1 ? " [" + A.mesi + " mesi]" : "";
    rows = [[ds, A.tipo, A.tip, imp, A.tipo === "Spesa" ? A.cat : "", A.conto, (desc + mesi).trim()]];
  }
  if (EDIT) return saveEdit(EDIT, rows);
  const last = store.get("mc-last") || {};
  if (A.tipo === "Trasferimento") { last.da = A.da; last.a = A.a; } else last[A.tipo] = A.conto;
  store.set("mc-last", last);
  const ops = [{ range: "Movimenti!A:G", rows }];
  // Senza rete o senza accesso valido: in coda sul telefono, parte da sola appena possibile.
  if (!navigator.onLine || !token()) { closeAdd(); queueSave(ops); return; }
  const btn = $("#saveAdd"); btn.disabled = true; btn.textContent = "Salvo…";
  try {
    const p = await append("Movimenti!A:G", rows);
    closeAdd();
    const m = (p?.updates?.updatedRange || "").match(/![A-Z]+(\d+):[A-Z]+(\d+)/);
    const what = A.tipo === "Trasferimento" ? "Trasferimento di " + eur(imp) + " salvato" : A.tipo + " di " + eur(imp) + " salvata";
    const written = rows.map((r, i) => ({ row: +m?.[1] + i, d, tipo: r[1], tip: r[2], imp: r[3], cat: r[4], conto: r[5], desc: r[6] }));
    toast(what, m ? { label: "Annulla", run: () => undo(+m[1], +m[2], written) } : null);
    loadAll();
  } catch (e) {
    if (e instanceof AuthError || e.code === "offline") { closeAdd(); queueSave(ops); return; }
    btn.disabled = false; btn.textContent = "Salva nel foglio";
    err.textContent = "Il foglio ha rifiutato il salvataggio: " + e.message;
  }
}
function queueSave(ops) {
  const it = { id: newId(), ops, done: 0, at: Date.now() };
  Q.add(it);
  render();
  if (navigator.onLine) { toast("Salvato sul telefono: rinnovo l'accesso a Google e lo invio"); setTimeout(() => login(true), 1200); }
  else toast("Sei offline: salvato sul telefono, lo invio appena torna la rete", { label: "Annulla", run: () => { Q.remove(it.id); render(); toast("Movimento tolto dalla coda"); } });
}
async function undo(r1, r2, written) {
  try {
    // Come per Elimina: prima controllo che quelle righe siano ancora il movimento appena scritto.
    await checkRows(written);
    await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: CFG.movimentiSheetId, dimension: "ROWS", startIndex: r1 - 1, endIndex: r2 } } }] }) });
    toast("Movimento eliminato dal foglio");
  } catch (e) { toast(e.code === "changed" ? "Il foglio è cambiato nel frattempo: non ho toccato niente, eliminalo dal foglio." : "Non sono riuscito ad annullare: eliminalo dal foglio."); }
  loadAll();
}

/* ---------- dettaglio, modifica, eliminazione ----------
   Le righe sono indicate dal numero di riga letto all'ultimo aggiornamento. Prima di scrivere
   rileggo quelle righe dal foglio: se nel frattempo sono cambiate (es. modifiche dal computer)
   non tocco niente, così non rischio di cambiare o cancellare il movimento sbagliato. */
let EDIT = null;
const partsOf = m => m.kind === "tr" ? m.parts : [m];
function detailRows(m) {
  const n = m.kind === "tr" ? 1 : spreadOf(m);
  const desc = m.kind === "tr" ? m.desc : cleanDesc(m.desc);
  const r = [["Data", dayLabel(m.d) + " " + m.d.getFullYear()]];
  if (m.kind === "tr") r.push(["Da", m.da], ["A", m.a]);
  else {
    r.push(["Tipo", m.tipo], ["Tipologia", m.tip]);
    if (m.tipo === "Spesa" && m.cat && !isTr(m)) r.push(["Categoria", m.cat]);
    r.push([m.tipo === "Spesa" ? "Pagato con" : "Arrivato su", m.conto]);
    if (n > 1) r.push(["Nei grafici", "diviso su " + n + " mesi"]);
  }
  return r.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join("")
    + (desc ? `<div class="long"><span>Descrizione</span><p>${esc(desc)}</p></div>` : "");
}
function openDetail(m) {
  if (!m) return;
  const inc = m.kind !== "tr" && m.tipo === "Entrata";
  const title = m.kind === "tr" || isTr(m) ? "Trasferimento" : m.tip;
  $("#overlay").innerHTML = `<div class="scrim" id="scrim"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="detT"><div class="sheet-in">
    <div class="grab" aria-hidden="true"></div>
    <div class="row" style="align-items:center"><h2 class="h1" id="detT" style="font-size:22px">${esc(title)}</h2><button class="link" id="closeAdd" style="font-size:15px">Chiudi</button></div>
    <span class="big ${inc && !isTr(m) ? "pos" : ""}" style="font-size:36px">${m.kind === "tr" ? "" : inc ? "+" : "−"}${eur(m.imp)}</span>
    <div class="det">${detailRows(m)}</div>
    ${m.pending ? `<span class="sub">In attesa di invio al foglio: potrai modificarlo o eliminarlo dopo l'invio.</span>`
      : `<span class="err" id="detErr" role="alert"></span>
    <button class="btn" id="editMv">Modifica</button>
    <button class="btn danger" id="delMv">Elimina</button>`}
  </div></div>`;
  document.body.style.overflow = "hidden";
  $("#scrim").onclick = closeAdd; $("#closeAdd").onclick = closeAdd;
  if (m.pending) return;
  $("#editMv").onclick = () => {
    const f = m.kind === "tr"
      ? { A: { tipo: "Trasferimento", da: m.da, a: m.a }, desc: m.desc }
      : { A: { tipo: m.tipo, tip: m.tip, cat: m.cat || "Bisogno", conto: m.conto, mesi: String(spreadOf(m)) }, desc: cleanDesc(m.desc) };
    openAdd({ ...f, amt: fmt2(m.imp), date: isoDate(m.d), edit: m });
  };
  const del = $("#delMv");
  let armedAt = 0;
  del.onclick = () => {
    // Primo tocco: chiede conferma. Secondo tocco: elimina.
    // Un doppio tap veloce non conta: serve un secondo tocco dopo almeno mezzo secondo, e la conferma scade dopo 4 secondi.
    if (!del.classList.contains("armed")) {
      del.classList.add("armed"); del.textContent = "Tocca di nuovo per eliminare"; armedAt = Date.now();
      setTimeout(() => { if (del.isConnected && !del.disabled) { del.classList.remove("armed"); del.textContent = "Elimina"; } }, 4000);
      return;
    }
    if (Date.now() - armedAt < 600) return;
    deleteMv(m);
  };
}
async function checkRows(parts) {
  const ranges = parts.map(p => "ranges=" + encodeURIComponent("Movimenti!A" + p.row + ":G" + p.row)).join("&");
  const res = await api("/values:batchGet?" + ranges + "&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER");
  const same = res.valueRanges.every((vr, i) => {
    const r = (vr.values || [])[0] || [], p = parts[i], d = toDate(r[0]);
    // Come testo: una descrizione tipo "2024" torna dal foglio come numero.
    const s = x => String(x ?? "");
    return d && d.getTime() === p.d.getTime() && s(r[1]) === s(p.tipo) && s(r[2]) === s(p.tip) && s(r[4]) === s(p.cat) && Math.abs(num(r[3]) - p.imp) < 0.005 && s(r[5]) === s(p.conto) && s(r[6]) === s(p.desc);
  });
  if (!same) { const e = new Error("changed"); e.code = "changed"; throw e; }
}
function writeError(e) {
  if (e instanceof AuthError) return "L'accesso a Google è scaduto: chiudi, tocca aggiorna nella Home e riprova.";
  if (e.code === "offline") return "Serve la connessione per modificare il foglio.";
  if (e.code === "changed") { closeAdd(); loadAll(); toast("Il movimento nel foglio è cambiato: ho ricaricato i dati, riaprilo e riprova"); return ""; }
  return "Il foglio ha rifiutato la modifica: " + e.message;
}
async function deleteMv(m) {
  const err = $("#detErr"), del = $("#delMv"); err.textContent = "";
  if (!navigator.onLine) { err.textContent = "Serve la connessione per eliminare."; return; }
  del.disabled = true; del.textContent = "Elimino…";
  try {
    const parts = partsOf(m);
    await checkRows(parts);
    // Dalla riga più in basso, così le altre non cambiano numero.
    const requests = parts.map(p => p.row).sort((a, b) => b - a).map(r => ({ deleteDimension: { range: { sheetId: CFG.movimentiSheetId, dimension: "ROWS", startIndex: r - 1, endIndex: r } } }));
    await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
    closeAdd(); toast((m.kind === "tr" ? "Trasferimento" : "Movimento") + " eliminato"); loadAll();
  } catch (e) {
    del.disabled = false; del.classList.remove("armed"); del.textContent = "Elimina";
    err.textContent = writeError(e);
  }
}
async function saveEdit(m, rows) {
  const err = $("#addErr"), btn = $("#saveAdd");
  if (!navigator.onLine) { err.textContent = "Serve la connessione per salvare le modifiche."; return; }
  btn.disabled = true; btn.textContent = "Salvo…";
  try {
    const parts = partsOf(m);
    await checkRows(parts);
    // Trasferimento con descrizione non toccata: ogni riga tiene il suo testo originale.
    if (m.kind === "tr" && $("#addDesc").value.trim() === m.desc) rows.forEach((r, i) => r[6] = parts[i].desc);
    const data = parts.map((p, i) => ({ range: "Movimenti!A" + p.row + ":G" + p.row, values: [rows[i]] }));
    await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }) });
    closeAdd(); toast("Modifiche salvate"); loadAll();
  } catch (e) {
    btn.disabled = false; btn.textContent = "Salva modifiche";
    err.textContent = writeError(e);
  }
}

/* ---------- PAC ---------- */
async function savePac(ev) {
  ev.preventDefault();
  const err = $("#pacErr"); err.textContent = "";
  const d = $("#pacDate").value ? fromIso($("#pacDate").value) : new Date(), ds = sheetDate(d);
  const rows = [];
  let bad = "";
  S.set.etf.forEach((e, i) => {
    const aRaw = $("#pacAmt" + i).value.trim(), qRaw = $("#pacQ" + i).value.trim();
    const imp = parseInputAmount(aRaw), q = parseQuote(qRaw);
    // Un campo compilato ma non leggibile non si scarta in silenzio: si avvisa.
    if (aRaw && !(imp > 0)) bad = "Importo non valido per " + e.nome + ".";
    else if (qRaw && !(q > 0)) bad = "Quote non valide per " + e.nome + ": scrivi solo il numero, per esempio 0,5.";
    else if (imp > 0) rows.push([ds, e.nome, imp, q > 0 ? q : "", q > 0 ? Math.round(imp / q * 100) / 100 : "", ""]);
  });
  if (bad) { err.textContent = bad; return; }
  if (!rows.length) { err.textContent = "Inserisci almeno un importo."; return; }
  const tot = rows.reduce((a, r) => a + r[2], 0);
  const ops = [{ range: "PAC!A:F", rows }];
  if ($("#pacTr").checked) ops.push({ range: "Movimenti!A:G", rows: [[ds, "Spesa", "Trasferimenti", tot, "Bisogno", S.set.contoDa, "PAC verso " + S.set.contoInv], [ds, "Entrata", "Trasferimenti", tot, "", S.set.contoInv, "PAC da " + S.set.contoDa]] });
  // Lo passo sempre dalla coda: se la rete cade tra le due scritture, la seconda riparte senza ripetere la prima.
  const it = { id: newId(), ops, done: 0, at: Date.now() };
  Q.add(it);
  S.pacForm = false;
  if (!navigator.onLine || !token()) { render(); queueToast(); return; }
  const btn = $("#pacSave"); btn.disabled = true; btn.textContent = "Salvo…";
  await flush();
  if (!Q.all().some(x => x.id === it.id)) { toast("Versamento di " + eur(tot) + " registrato"); loadAll(); }
  else { render(); queueToast(); }
}
function queueToast() {
  if (navigator.onLine) { toast("Salvato sul telefono: rinnovo l'accesso a Google e lo invio"); setTimeout(() => login(true), 1200); }
  else toast("Sei offline: salvato sul telefono, lo invio appena torna la rete");
}
async function saveVal(ev) {
  ev.preventDefault();
  const err = $("#valErr"); err.textContent = "";
  const q = parseQuote($("#quoteIn").value);
  if (!(q > 0)) { err.textContent = "Scrivi il numero di quote, per esempio 1,164669."; return; }
  const btn = $("#valSave"); btn.disabled = true; btn.textContent = "Salvo…";
  try {
    await api("/values/" + encodeURIComponent("Impostazioni!H9") + "?valueInputOption=RAW", { method: "PUT", body: JSON.stringify({ values: [[q]] }) });
    S.valForm = false; toast("Quote aggiornate"); loadAll();
  } catch (e) {
    btn.disabled = false; btn.textContent = "Salva quote";
    err.textContent = e instanceof AuthError ? "L'accesso a Google è scaduto: tocca aggiorna nella Home e riprova." : "Non ho potuto salvare: " + e.message;
  }
}

/* ---------- avvio ---------- */
$$(".tab").forEach(t => t.addEventListener("click", () => go(t.dataset.tab)));
$("#openAdd").addEventListener("click", () => openAdd());
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#overlay").innerHTML) closeAdd(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (Q.all().length || (S.loadedAt && Date.now() - S.loadedAt > 5 * 60 * 1000)) loadAll();
});
window.addEventListener("online", () => { if (S.error && S.error.code === "offline") S.error = null; render(); loadAll(); });
window.addEventListener("offline", () => render());
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

const r = handleRedirect();
if (r && r.ok) store.set("mc-known", true);
const cached = store.get("mc-cache");
if (cached) { try { apply(cached.raw); S.loadedAt = cached.at; } catch {} }
if (r && r.error) {
  store.del("mc-token");
  // Rinnovo silenzioso non riuscito (sessione Google scaduta o più account): serve un accesso con un tocco.
  if (["interaction_required", "login_required", "consent_required", "account_selection_required"].includes(r.error)) S.error = { code: "reauth" };
  else S.error = { code: r.error === "access_denied" ? "access_denied" : "auth", message: "accesso non riuscito (" + r.error + ")" };
}
render();
store.del("mc-draft");
if (token()) loadAll();
else if (sheetId() && store.get("mc-known") && !(r && r.error) && navigator.onLine) login(true);
})();
