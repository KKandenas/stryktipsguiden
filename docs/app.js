import {
  BUDGETAR, TECKEN, VARDE_GRANS, antalRatt, normaliseraLasning, optimera, raderTillFil, sammanfattning,
} from "./optimizer.js";

const $ = (id) => document.getElementById(id);
const LAGRING = "stryktipshjalpen";
const TZ = "Europe/Stockholm";

const state = {
  kupong: null,
  exempel: false,
  budget: 96,
  lasningar: {},       // {matchnr: "1X"} för aktuell omgång
  oppna: new Set(),    // matcher med utfälld kommentar
  resultat: null,      // senaste optimeringen
};

// ---------- lagring (localStorage kan saknas eller kasta, t.ex. i privat läge) ----------

function lasLagring() {
  try { return JSON.parse(localStorage.getItem(LAGRING)) || {}; } catch { return {}; }
}
function sparaLagring() {
  try {
    const d = lasLagring();
    d.budget = state.budget;
    d.lasningar = d.lasningar || {};
    const id = state.kupong.omgang.id;
    if (Object.keys(state.lasningar).length) d.lasningar[id] = state.lasningar;
    else delete d.lasningar[id];
    // Behåll bara de senaste omgångarnas låsningar
    for (const k of Object.keys(d.lasningar)) if (Number(k) < id - 5) delete d.lasningar[k];
    localStorage.setItem(LAGRING, JSON.stringify(d));
  } catch { /* låsningar sparas bara för den här sessionen */ }
}

// ---------- hämtning ----------

async function hamta(fil) {
  const r = await fetch(fil, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${fil}: ${r.status}`);
  const k = await r.json();
  if (!k.matcher || k.matcher.length !== 13) throw new Error(`${fil}: väntade 13 matcher`);
  return k;
}

async function start() {
  const tvingaExempel = new URLSearchParams(location.search).has("exempel");
  try {
    if (tvingaExempel) throw new Error("exempel begärt");
    state.kupong = await hamta("kupong.json");
  } catch (e) {
    try {
      state.kupong = await hamta("exempel-kupong.json");
      state.exempel = true;
    } catch (e2) {
      $("rubrik").textContent = "Kunde inte ladda kupongen";
      $("underrubrik").textContent = "Försök igen om en stund.";
      console.error(e, e2);
      return;
    }
  }
  const lagrat = lasLagring();
  if (BUDGETAR.includes(lagrat.budget)) state.budget = lagrat.budget;
  state.lasningar = (lagrat.lasningar || {})[state.kupong.omgang.id] || {};

  byggBudgetknappar();
  $("matcher").addEventListener("click", klickMatch);
  $("ladda-ner").addEventListener("click", laddaNer);
  $("rensa").addEventListener("click", () => { state.lasningar = {}; uppdatera(); });
  try { if (!localStorage.getItem(LAGRING)) $("forklaring").open = true; } catch { $("forklaring").open = true; }
  uppdatera();
}

// ---------- formatering ----------

const procent = (x) => Math.round(x * 100);
const datumFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const tidFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const kortFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit" });

function vecka(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dag = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dag);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

function el(tag, attrs = {}, ...barn) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const b of barn) if (b != null) e.append(b);
  return e;
}

// ---------- rendering ----------

function byggBudgetknappar() {
  const box = $("budgetknappar");
  for (const b of BUDGETAR) {
    const knapp = el("button", { type: "button", role: "radio", "data-budget": b, text: String(b) });
    knapp.addEventListener("click", () => { state.budget = b; uppdatera(); });
    box.append(knapp);
  }
}

function renderaTopp() {
  const { omgang, modell } = state.kupong;
  const stopp = new Date(omgang.spelstopp);
  $("rubrik").textContent = `Stryktipset v. ${vecka(stopp)}`;
  const datum = datumFmt.format(stopp);
  $("underrubrik").textContent =
    `${datum.charAt(0).toUpperCase() + datum.slice(1)} · Spelstopp ${tidFmt.format(stopp)} · Omgång ${omgang.id}`;
  $("modellinfo").textContent = `Modell ${modell.version}: ${modell.beskrivning}. Uppdaterad ${
    new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date(state.kupong.genererad))}.`;

  const banner = $("banner");
  let text = null;
  if (state.exempel) {
    text = "Exempeldata: ingen riktig kupong finns ännu, så en tidigare omgång visas som om den vore öppen.";
  } else if (omgang.status === "stangd") {
    text = "Spelstopp har passerat. Resultaten kommer efter att matcherna spelats.";
  } else if (omgang.status === "installd") {
    text = "Omgången är inställd av Svenska Spel.";
  } else if (omgang.status === "avgjord" && state.resultat?.ok) {
    const facit = Object.fromEntries(state.kupong.matcher.map((m) => [m.nr, m.resultat]));
    const n = antalRatt(state.resultat.val, facit);
    const utd = omgang.utdelning?.[String(n)];
    text = `Omgången är avgjord. Ditt system hade ${n} rätt` +
      (utd ? ` – utdelning ${Math.round(utd).toLocaleString("sv-SE")} kr.` : ".");
  }
  banner.hidden = !text;
  banner.textContent = text || "";
}

function renderaMatcher() {
  const lista = $("matcher");
  lista.replaceChildren();
  const val = state.resultat?.ok ? Object.fromEntries(state.resultat.val.map((v) => [v.nr, v])) : {};

  for (const m of state.kupong.matcher) {
    const v = val[m.nr];
    const last = normaliseraLasning(state.lasningar[m.nr]) || "";
    const oppen = state.oppna.has(m.nr);

    const huvud = el("button", { type: "button", class: "match-huvud", "data-nr": m.nr, "aria-expanded": String(oppen) },
      el("span", { class: "nr", text: String(m.nr) }),
      el("span", {},
        el("span", { class: "lag", text: `${m.hemmalag} – ${m.bortalag}` }),
        el("span", { class: "liga", text: `${[m.liga, m.avspark && kortFmt.format(new Date(m.avspark))].filter(Boolean).join(" · ")}` }),
      ),
      v ? el("span", { class: `etikett ${v.typ}`, text: v.typ }) : null,
    );

    const rutor = el("div", { class: "rutor" });
    for (const t of TECKEN) {
      const chans = m.chans ? procent(m.chans[t]) : null;
      const streck = m.streck ? Math.round(m.streck[t]) : null;
      const harVarde = m.varde && m.varde[t] >= VARDE_GRANS;
      const vald = v && v.tecken.includes(t);
      const arLast = last.includes(t);
      const klasser = ["ruta", vald && "vald", arLast && "last", m.resultat === t && "utfall"].filter(Boolean).join(" ");
      const etikett = `${t}: chans ${chans ?? "okänd"} procent, streck ${streck ?? "okänt"} procent` +
        `${harVarde ? ", understreckat" : ""}${vald ? ", valt" : ""}${arLast ? ", låst" : ""}`;
      rutor.append(el("button", { type: "button", class: klasser, "data-nr": m.nr, "data-tecken": t,
        "aria-pressed": String(arLast), "aria-label": etikett },
        arLast ? el("span", { class: "las", text: "🔒", "aria-hidden": "true" }) : null,
        el("span", { class: "tecken", text: t }),
        el("span", { class: "siffror", text: `${chans ?? "–"} · ${streck ?? "–"}` }),
        harVarde ? el("i", { class: "prick", "aria-hidden": "true" }) : null,
      ));
    }

    const li = el("li", { class: "match" }, huvud, rutor);
    if (oppen) li.append(detaljer(m));
    lista.append(li);
  }
}

function detaljer(m) {
  const d = el("div", { class: "detaljer" });
  d.append(el("p", { class: "kommentar", text: m.kommentar || "Ingen AI-kommentar för den här matchen ännu." }));
  if (m.chans_kalla === "streck") d.append(el("p", { class: "dampad", text: "Odds saknas – chansen bygger på strecken." }));
  if (m.odds) {
    const s = m.odds.snitt;
    const fmt = (x) => x.toFixed(2).replace(".", ",");
    d.append(el("p", { class: "dampad",
      text: `Odds ${fmt(s["1"])} / ${fmt(s.X)} / ${fmt(s["2"])} (snitt av ${m.odds.antal_bolag} bolag)` }));
  }
  if (m.varde) {
    const fmt = (x) => { const p = Math.round(x * 100); return (p > 0 ? "+" : p < 0 ? "−" : "±") + Math.abs(p); };
    d.append(el("p", { class: "dampad", text: `Värde: 1 ${fmt(m.varde["1"])} · X ${fmt(m.varde.X)} · 2 ${fmt(m.varde["2"])} procentenheter` }));
  }
  for (const t of m.tips || []) {
    d.append(el("p", { class: "dampad", text: `${t.kalla}: ${t.tecken}${t.text ? ` (${t.text})` : ""}` }));
  }
  if (m.resultat) d.append(el("p", { text: `Resultat: ${m.mal ? m.mal + " – " : ""}${m.resultat}` }));
  return d;
}

function uppdatera() {
  state.resultat = optimera(state.kupong.matcher, state.budget, state.lasningar);

  for (const b of $("budgetknappar").children) b.setAttribute("aria-checked", String(Number(b.dataset.budget) === state.budget));
  const fel = $("fel");
  if (state.resultat.ok) {
    $("sammanfattning").textContent = sammanfattning(state.resultat, state.kupong.omgang.radpris || 1);
    fel.hidden = true;
  } else {
    $("sammanfattning").textContent = "";
    fel.textContent = state.resultat.fel;
    fel.hidden = false;
  }
  $("ladda-ner").disabled = !state.resultat.ok;
  $("rensa").hidden = Object.keys(state.lasningar).length === 0;

  renderaTopp();
  renderaMatcher();
  sparaLagring();
}

// ---------- interaktion ----------

function klickMatch(e) {
  const ruta = e.target.closest(".ruta");
  if (ruta) {
    const nr = Number(ruta.dataset.nr), t = ruta.dataset.tecken;
    const nu = new Set(normaliseraLasning(state.lasningar[nr]) || "");
    nu.has(t) ? nu.delete(t) : nu.add(t);
    const ny = normaliseraLasning([...nu].join(""));
    if (ny) state.lasningar[nr] = ny; else delete state.lasningar[nr];
    uppdatera();
    document.querySelector(`.ruta[data-nr="${nr}"][data-tecken="${t}"]`)?.focus();
    return;
  }
  const huvud = e.target.closest(".match-huvud");
  if (huvud) {
    const nr = Number(huvud.dataset.nr);
    state.oppna.has(nr) ? state.oppna.delete(nr) : state.oppna.add(nr);
    renderaMatcher();
    document.querySelector(`.match-huvud[data-nr="${nr}"]`)?.focus();
  }
}

function laddaNer() {
  if (!state.resultat?.ok) return;
  const text = raderTillFil(state.resultat.val);
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = el("a", { href: url, download: `stryktipset-${state.kupong.omgang.id}-${state.budget}rader.txt` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

start();
