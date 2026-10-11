import {
  BUDGETAR, TECKEN, VARDE_GRANS, VARDE_GRANS_OSAKER, antalRatt, normaliseraLasning, optimera, sammanfattning,
} from "./optimizer.js?v=20261011t";
import { backtesta, franAr, rattFordelning } from "./backtest.js?v=20261011t";

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
  historik: null,      // historik.json, laddas först när backtestet öppnas
  btBudget: null,      // vald budget i backtestet
  senaste: null,       // senaste.json – förra omgången, för rättning
  rBudget: null,       // vald budget i rättningen
  rOppna: new Set(),   // utfällda matcher i rättningen
  kalla: "modell",     // "modell" eller "tips" – vilket förslag som visas
  formRang: [],        // tipsarnas form (kupong.json → tipsare_form), bäst först
  statAr: "alla",      // valt startår i "Så har modellen träffat"
  btAr: "alla",        // valt startår i backtestet
};

/** Rullgardin för startår: "Alla" först, sedan senaste året överst. */
function arsknappar(ar, valt, vid) {
  const ordning = ["alla", ...ar.filter((a) => a !== "alla").sort().reverse()];
  const val = el("select", { class: "arsval-lista", "aria-label": "Visa från år" },
    ...ordning.map((a) => {
      const o = el("option", { value: a, text: a === "alla" ? "Alla år" : `Från ${a}` });
      o.selected = a === valt;
      return o;
    }));
  val.addEventListener("change", () => vid(val.value));
  return el("label", { class: "arsval" }, el("span", { text: "Visa" }), val);
}

/** Matcherna enligt valt förslag: med "tips" används tips-v1:s chans och värde där de finns. */
function matcherEnligtKalla(kupong, kalla = state.kalla) {
  if (kalla !== "tips") return kupong.matcher;
  return kupong.matcher.map((m) => (m.chans_tips
    ? { ...m, chans: m.chans_tips, varde: m.varde_tips, chans_modell: m.chans, varde_modell: m.varde } : m));
}
const harTips = (kupong) => kupong.matcher.some((m) => m.chans_tips);

// ---------- lagring (localStorage kan saknas eller kasta, t.ex. i privat läge) ----------

function lasLagring() {
  try { return JSON.parse(localStorage.getItem(LAGRING)) || {}; } catch { return {}; }
}
function sparaLagring() {
  try {
    const d = lasLagring();
    d.budget = state.budget;
    d.kalla = state.kalla;
    d.lasningar = d.lasningar || {};
    const id = state.kupong.omgang.id;
    if (Object.keys(state.lasningar).length) d.lasningar[id] = state.lasningar;
    else delete d.lasningar[id];
    d.budgetar = d.budgetar || {};
    d.budgetar[id] = state.budget;           // så att rättningen kan visa det system du hade
    for (const k of Object.keys(d.budgetar)) if (Number(k) < id - 5) delete d.budgetar[k];
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
  initMeny();
  window.addEventListener("hashchange", visaVy);
  visaVy();
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
  state.formRang = state.kupong.tipsare_form || [];
  const lagrat = lasLagring();
  if (BUDGETAR.includes(lagrat.budget)) state.budget = lagrat.budget;
  if (lagrat.kalla === "tips" && harTips(state.kupong)) state.kalla = "tips";
  for (const b of document.querySelectorAll(".forslag button")) {
    b.disabled = b.dataset.kalla === "tips" && !harTips(state.kupong);
    b.addEventListener("click", () => {
      state.kalla = b.dataset.kalla;
      if (state.senaste) renderaRattning();
      uppdatera();
      if (state.historik) renderaBacktest();
    });
  }
  state.lasningar = (lagrat.lasningar || {})[state.kupong.omgang.id] || {};

  byggBudgetknappar();
  $("matcher").addEventListener("click", klickMatch);
  $("rensa").addEventListener("click", () => { state.lasningar = {}; uppdatera(); });
  uppdatera();
  setInterval(renderaTopp, 60_000);   // håll nedräkningen till spelstopp aktuell
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
  $("underrubrik").textContent = `${datum.charAt(0).toUpperCase() + datum.slice(1)} · Omgång ${omgang.id}`;

  const statusText = state.exempel ? "Exempel" : { oppen: "Öppen", stangd: "Stängd", avgjord: "Avgjord", installd: "Inställd" }[omgang.status];
  const status = $("status");
  status.textContent = statusText || "";
  status.className = `status ${omgang.status === "oppen" && !state.exempel ? "oppen" : ""}`;
  status.hidden = !statusText;

  const ned = $("nedrakning");
  const kvar = stopp - Date.now();
  const dag = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, weekday: "long", day: "numeric", month: "short" })
    .format(stopp).replace(".", "");
  let nedText = `Spelstopp ${dag} ${tidFmt.format(stopp)}`;
  if (omgang.status === "oppen" && !state.exempel && kvar > 0) {
    const min = Math.floor(kvar / 60000), dagar = Math.floor(min / 1440), tim = Math.floor((min % 1440) / 60);
    nedText += ` · om ${dagar ? `${dagar} d ${tim} h` : tim ? `${tim} h ${min % 60} min` : `${min % 60} min`}`;
  }
  ned.textContent = `⏱ ${nedText}`;
  ned.hidden = false;
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
  ritaMatcher($("matcher"), { ...state.kupong, matcher: matcherEnligtKalla(state.kupong) },
    state.resultat, state.lasningar, state.oppna, true, state.skillnad);
}

/** Det andra förslaget (Oddsen ↔ Med experter) med samma budget och låsningar: matcher med andra tecken. */
function skillnadMotAndra(kupong, resultat, budget, lasningar) {
  if (!resultat?.ok || !harTips(kupong)) return null;
  const andra = state.kalla === "tips" ? "modell" : "tips";
  const r = optimera(matcherEnligtKalla(kupong, andra), budget, lasningar);
  if (!r.ok) return null;
  const skiljer = {};
  r.val.forEach((v, i) => { if (v.tecken !== resultat.val[i].tecken) skiljer[v.nr] = v.tecken; });
  return { namn: andra === "tips" ? "Med experter" : "Oddsen", skiljer };
}

/** Ritar kupongens matcher. interaktiv=false (rättningen): tecknen går inte att låsa. */
function ritaMatcher(lista, kupong, resultat, lasningar, oppna, interaktiv, skillnad = null) {
  lista.replaceChildren();
  const val = resultat?.ok ? Object.fromEntries(resultat.val.map((v) => [v.nr, v])) : {};

  for (const m of kupong.matcher) {
    const v = val[m.nr];
    const last = normaliseraLasning(lasningar[m.nr]) || "";
    const oppen = oppna.has(m.nr);
    const slut = m.resultat ? ` · Slut ${m.mal ? m.mal.replace("-", "–") : m.resultat}` : "";

    // Tips som går emot förslaget (inget av tipsets tecken finns i systemet) markeras på raden
    const emot = v ? (m.tips || []).filter((t) => t.tecken && ![...t.tecken].some((x) => v.tecken.includes(x))).length : 0;
    const huvud = el("button", { type: "button", class: "match-huvud", "data-nr": m.nr, "aria-expanded": String(oppen),
      "aria-label": `Match ${m.nr}: ${m.hemmalag} mot ${m.bortalag}. ${oppen ? "Dölj" : "Visa"} detaljer.` },
      el("span", { class: "nr", text: String(m.nr) }),
      el("span", { class: "lagblock" },
        el("span", { class: "lag", text: m.hemmalag }),
        el("span", { class: "lag", text: m.bortalag }),
        // Viktigast först (typ, osäkerhet, tips emot) – tid och liga får klippas på smala skärmar
        el("span", { class: "liga" },
          v ? el("span", { class: `typ ${v.typ}`, text: v.typ }) : null,
          m.osaker ? el("span", { class: "osaker", title: "Osäkrare: bara Svenska Spels odds", "aria-label": "osäkrare bedömning", text: " ⚠︎" }) : null,
          emot ? el("span", { class: "emot-mark", text: ` · ${emot} tips emot` }) : null,
          skillnad?.skiljer[m.nr] ? el("span", { class: "annat-forslag", text: ` · ${skillnad.namn}: ${skillnad.skiljer[m.nr]}` }) : null,
          `${v ? " · " : ""}${m.resultat ? slut.replace(" · ", "") + " · " : ""}${[!m.resultat && m.avspark && kortFmt.format(new Date(m.avspark)), m.liga].filter(Boolean).join(" · ")}`),
      ),
    );

    const rutor = el("div", { class: "rutor" });
    for (const t of TECKEN) {
      const chans = m.chans ? procent(m.chans[t]) : null;
      const streck = m.streck ? Math.round(m.streck[t]) : null;
      const harVarde = m.varde && m.varde[t] >= (m.osaker ? VARDE_GRANS_OSAKER : VARDE_GRANS);
      const vald = v && v.tecken.includes(t);
      const arLast = last.includes(t);
      const klasser = ["ruta", vald && "vald", arLast && "last", m.resultat === t && "utfall"].filter(Boolean).join(" ");
      const etikett = `${t}: chans ${chans ?? "okänd"} procent, streck ${streck ?? "okänt"} procent` +
        `${harVarde ? ", understreckat" : ""}${vald ? ", valt" : ""}${arLast ? ", låst" : ""}`;
      const attr = interaktiv
        ? { type: "button", class: klasser, "data-nr": m.nr, "data-tecken": t, "aria-pressed": String(arLast), "aria-label": etikett }
        : { class: klasser, role: "img", "aria-label": etikett + (m.resultat === t ? ", rätt tecken" : "") };
      rutor.append(el(interaktiv ? "button" : "div", attr,
        arLast ? el("span", { class: "las", text: "🔒", "aria-hidden": "true" }) : null,
        el("span", { class: "tecken", text: t }),
        el("span", { class: "siffror", text: `${chans ?? "–"} · ${streck ?? "–"}` }),
        harVarde ? el("i", { class: "prick", "aria-hidden": "true" }) : null,
      ));
    }

    const traff = m.resultat && v ? (v.tecken.includes(m.resultat) ? "traff" : "miss") : "";
    const li = el("li", { class: `match ${traff}${oppen ? " oppen" : ""}` }, huvud, rutor);
    if (oppen) li.append(detaljer(m, v));
    lista.append(li);
  }
}

const KORTNAMN = { "Tio tidningars tips": "Tidningar", "speltips.se": "speltips", "hurbra.se": "hurbra",
  "bettingstugan.se": "Bettingstugan", "tippat.se": "Tippat", "gamblingcabin.se": "Gamblingcabin",
  "sportsgambler.com": "sportsgambler", "sportsmole.co.uk": "Sports Mole", "footballpredictions.com": "FootballPredictions" };
for (const [k, v] of Object.entries({ ...KORTNAMN })) if (k !== "Tio tidningars tips") KORTNAMN[`${k} (system)`] = `${v} (system)`;

/** Små etiketter med varje källas tips. "emot" = inget av tipsets tecken finns i systemet. */
function tipsetiketter(m, v) {
  const tips = (m.tips || []).filter((t) => t.tecken || t.system);
  if (!tips.length) return null;
  const rad = el("div", { class: "tipsetiketter", "aria-label": "Tips från analyser" });
  for (const t of tips) {
    const namn = KORTNAMN[t.kalla] || t.kalla;
    const huvud = t.tecken || t.system;
    const raknat = t.kalla === "Tio tidningars tips" && /^\d+-\d+-\d+/.test(t.text || "") ? t.text.split(" ")[0] : huvud;
    const emot = v && ![...huvud].some((x) => v.tecken.includes(x));
    const satt = m.resultat ? huvud.includes(m.resultat) : null;
    const sys = t.system && t.tecken && t.system !== t.tecken ? t.system : null;
    const etikett = `${t.kalla} tippar ${huvud}` + (sys ? `, systemet har ${sys}` : "") + (emot ? ", går emot förslaget" : "") +
      (satt === true ? ", tipset satt" : satt === false ? ", tipset satt inte" : "");
    rad.append(el("span", { class: `tipsetikett${emot ? " emot" : ""}${satt === true ? " satt" : ""}`,
      title: t.text || "", "aria-label": etikett },
      el("span", { class: "kalla", text: namn }), el("b", { text: raknat }),
      sys ? el("span", { class: "sys", text: `sys ${sys}` }) : null,
      satt === true ? el("span", { class: "bock", text: "✓", "aria-hidden": "true" }) : null));
  }
  return rad;
}

const BOLAGSNAMN = {
  pinnacle: "Pinnacle", svenskaspel: "Svenska Spel", svenskaspel_start: "Svenska Spel (start)", unibet_eu: "Unibet",
  unibet_uk: "Unibet", betsson: "Betsson", nordicbet: "NordicBet", bet365: "Bet365", betfair_ex_eu: "Betfair",
  betfair_ex_uk: "Betfair", williamhill: "William Hill", coolbet: "Coolbet", betclic: "Betclic", marathonbet: "Marathonbet",
  sport888: "888sport", matchbook: "Matchbook", onexbet: "1xBet", paddypower: "Paddy Power", betvictor: "BetVictor",
};
const decOdds = (x) => x.toFixed(2).replace(".", ",");

/** Utfälld match: kommentar och en tabell "Spelstatistik inför match" med kolumnerna 1 · X · 2. */
function detaljer(m, v) {
  const d = el("div", { class: "detaljer" });
  if (m.kommentar) d.append(el("p", { class: "kommentar", text: m.kommentar }));
  const tipsrad = tipsetiketter(m, v);
  if (tipsrad) d.append(tipsrad);

  const tabell = el("table", { class: "detaljtabell" });
  tabell.append(el("thead", {}, el("tr", {}, el("th", { text: "Inför match" }),
    ...TECKEN.map((t) => el("th", { class: "tal", text: t })))));
  const kropp = el("tbody");
  const rubrik = (text) => kropp.append(el("tr", { class: "grupp" }, el("th", { colspan: 4, text })));
  const rad = (namn, varden, klass = "", under = null) => kropp.append(el("tr", { class: klass },
    el("td", {}, namn, under ? el("span", { class: "under", text: under }) : null),
    ...TECKEN.map((t, i) => el("td", { class: "tal" }, varden[i] ?? "–"))));
  const proc = (c) => TECKEN.map((t) => (c ? `${procent(c[t])} %` : null));

  const modell = m.chans_modell || (m.chans_kalla === "modell" ? m.chans : null);
  if (modell) rad("Oddsen", proc(modell), state.kalla === "modell" ? "markerad" : "", "chans enligt spelbolagen");
  if (m.chans_tips) rad("Med experter", proc(m.chans_tips), state.kalla === "tips" ? "markerad" : "", "odds + tipsare");
  if (m.streck) rad("Svenska folket", TECKEN.map((t) => `${Math.round(m.streck[t])} %`), "", "streck");
  if (m.varde) {
    rad("Värde", TECKEN.map((t) => {
      const p = Math.round(m.varde[t] * 100);
      return el("span", { class: p >= VARDE_GRANS * 100 ? "plus" : p < 0 ? "minus" : "", text: (p > 0 ? "+" : p < 0 ? "−" : "±") + Math.abs(p) });
    }), "", "procentenheter");
  }
  if (m.chans_kalla === "streck") rad("Odds saknas", [null, null, null], "", "chansen bygger på strecken");
  if (m.osaker && m.chans_kalla !== "streck") {
    d.append(el("p", { class: "osaker-not", text:
      "Osäkrare bedömning: här finns bara Svenska Spels odds, som har högre marginal och uppdateras mer sällan " +
      "än de stora bolagens. Värdeprick visas först när chansen är minst 5 procentenheter över strecken." }));
  }

  if (m.odds?.bolag?.length) {
    rubrik("Odds");
    for (const b of m.odds.bolag) rad(BOLAGSNAMN[b.bolag] || b.bolag, TECKEN.map((t) => decOdds(b[t])));
    if (m.odds.antal_bolag > m.odds.bolag.length) {
      rad(`Snitt av ${m.odds.antal_bolag} bolag`, TECKEN.map((t) => decOdds(m.odds.snitt[t])), "dampad-rad");
    }
  }

  // Experter: de tre som träffat bäst senaste tiden bland dem som tippat matchen – i första hand
  // på matcher från samma land (England/Sverige/Övrigt), annars över alla ligor.
  const form = state.formRang || [];
  const grupp = m.land === "England" || m.land === "Sverige" ? m.land : "Övrigt";
  const formFor = (namn) => {
    const egen = form.find((x) => x.namn === namn && x.grupp === grupp);
    if (egen && egen.antal >= 10) return { ...egen, i: grupp === "Övrigt" ? "övriga ligor" : `${grupp === "England" ? "engelska" : "svenska"} matcher` };
    const alla = form.find((x) => x.namn === namn && (x.grupp === "alla" || x.grupp === undefined));
    return alla && alla.antal >= 10 ? { ...alla, i: "alla ligor" } : null;
  };
  const tips = (m.tips || []).filter((t) => t.tecken || t.system)
    .map((t) => ({ ...t, tecken: t.tecken || t.system, f: formFor(t.kalla) }))
    .sort((a, b) => (b.f ? b.f.poang : -1) - (a.f ? a.f.poang : -1));
  const topp = tips.slice(0, 3);
  if (topp.length) {
    rubrik(tips.length > 3 ? "Experter – de tre bästa senaste tiden (● tips, ○ bara i systemet)" : "Experter (● tips, ○ bara i systemet)");
    for (const t of topp) {
      const under = t.f
        ? `${Math.round(t.f.poang * 100)} % träff, ${t.f.i}${t.f.period === "8v" ? " senaste 8 v." : ""} (${t.f.antal})`
        : "för lite historik ännu";
      const sys = t.system && t.system !== t.tecken ? t.system : null;
      rad(KORTNAMN[t.kalla] || t.kalla, TECKEN.map((x) => (t.tecken.includes(x)
        ? el("span", { class: `tipsmark${m.resultat === x ? " satt" : ""}`, "aria-label": `tippar ${x}`, text: "●" })
        : sys && sys.includes(x)
          ? el("span", { class: `tipsmark system${m.resultat === x ? " satt" : ""}`, "aria-label": `${x} i systemet`, text: "○" })
          : "")),
        "", under + (t.system ? ` · system ${t.system}${t.system_rader ? ` (${t.system_rader} r.)` : ""}` : ""));
    }
  }
  tabell.append(kropp);
  d.append(tabell);

  for (const t of topp.filter((t) => t.text)) {
    d.append(el("p", { class: "motivering" }, el("b", { text: `${KORTNAMN[t.kalla] || t.kalla}: ` }), t.text));
  }
  if (tips.length > 3) {
    d.append(el("p", { class: "dampad liten", text: `Även tippat: ${tips.slice(3).map((t) => `${KORTNAMN[t.kalla] || t.kalla} ${t.tecken}`).join(" · ")}` }));
  }
  return d;
}

const MODELLNAMN = { "odds-v2": "Oddsen", "odds-v1": "Odds, oviktat snitt", "ensemble-v1": "Sammanvägd modell",
  "tips-v1": "Med experter" };
const pct = (x) => `${Math.round(x * 100)} %`;
const dec = (x) => x.toFixed(3).replace(".", ",");

/** Aktuella siffror på sidan "Så funkar Stryktipsguiden" (resten av texten är fast). */
function renderaOm() {
  const k = state.kupong;
  if (!k) return;
  const satt = (namn, text) => { const e = document.querySelector(`[data-om="${namn}"]`); if (e && text) e.textContent = text; };
  const st = k.statistik;
  if (st?.modeller?.length) {
    const odds = st.modeller.find((m) => m.version === "odds-v2") || st.modeller[0];
    const folket = st.kallor?.find((x) => x.namn === "Svenska folket");
    const ttt = st.kallor?.find((x) => x.namn === "Tio tidningars tips");
    satt("brier", `Brier ${dec(odds.brier)} för oddsen mot ${folket ? dec(folket.brier) : "–"} för folket` +
      (ttt ? ` och ${dec(ttt.brier)} för Tio tidningars tips` : "") + `, mätt på ${odds.antal.toLocaleString("sv-SE")} matcher`);
    satt("aktiv", `i dag används ${MODELLNAMN[st.aktiv_modell]?.toLowerCase() || st.aktiv_modell}`);
  }
  satt("uppdaterad", `Senast uppdaterad ${new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, dateStyle: "long", timeStyle: "short" })
    .format(new Date(k.genererad))}.`);
}

function renderaStatistik() {
  const st = state.kupong.statistik;
  const box = $("statistik-innehall");
  box.replaceChildren();
  if (!st || !st.modeller?.length) {
    box.append(el("p", { class: "dampad", text: "Statistiken räknas fram när det finns avgjorda omgångar." }));
    return;
  }
  const arLista = st.per_ar ? ["alla", ...Object.keys(st.per_ar).filter((a) => a !== "alla").sort()] : ["alla"];
  if (!arLista.includes(state.statAr)) state.statAr = "alla";
  const blk = st.per_ar?.[state.statAr] || { modeller: st.modeller, kallor: st.kallor, ligor: st.ligor };
  if (arLista.length > 1) box.append(arsknappar(arLista, state.statAr, (a) => { state.statAr = a; renderaStatistik(); }));
  const aktiv = blk.modeller.find((m) => m.version === st.aktiv_modell) || blk.modeller[0];
  const folket = blk.kallor.find((k) => k.namn === "Svenska folket");

  box.append(el("p", { text:
    `Mätt på ${aktiv.antal.toLocaleString("sv-SE")} avgjorda matcher. Oddsens mest sannolika tecken gick in i ${pct(aktiv.traff)}` +
    (folket ? ` av matcherna, folkets i ${pct(folket.traff)}.` : ".") +
    " Det viktiga är att sannolikheterna stämmer – det är dem värdet bygger på." }));

  box.append(el("h3", { text: "Träffsäkerhet" }));
  const tabell = el("table", { class: "stat-tabell" },
    el("thead", {}, el("tr", {}, el("th", { text: "Källa" }), el("th", { class: "tal", text: "Träff" }),
      el("th", { class: "tal", text: "Brier" }))));
  const kropp = el("tbody");
  for (const m of blk.modeller) {
    const namn = el("td", {}, MODELLNAMN[m.version] || m.version,
      m.version === st.aktiv_modell ? el("span", { class: "markor", text: "används" }) : null);
    kropp.append(el("tr", { class: m.version === st.aktiv_modell ? "aktiv" : "" },
      namn, el("td", { class: "tal", text: pct(m.traff) }), el("td", { class: "tal", text: dec(m.brier) })));
  }
  for (const k of blk.kallor) {
    kropp.append(el("tr", {}, el("td", { text: k.namn }),
      el("td", { class: "tal", text: k.traff != null ? pct(k.traff) : "–" }), el("td", { class: "tal", text: dec(k.brier) })));
  }
  tabell.append(kropp);
  box.append(tabell);

  if (st.tipsare?.length) {
    box.append(el("h3", { text: "Tipsarnas vikt i förslaget Med experter" }));
    const t = el("table", { class: "stat-tabell" },
      el("thead", {}, el("tr", {}, el("th", { text: "Tipsare" }), el("th", { class: "tal", text: "Träff" }),
        el("th", { class: "tal", text: "Matcher" }), el("th", { class: "tal", text: "Vikt" }))));
    const b = el("tbody");
    b.append(el("tr", {}, el("td", { text: "Bookmakerodds" }), el("td", { class: "tal", text: "–" }),
      el("td", { class: "tal", text: "–" }), el("td", { class: "tal", text: dec(st.tips_oddsvikt ?? 1) })));
    for (const tp of st.tipsare) {
      b.append(el("tr", {}, el("td", {}, tp.namn, tp.skattad ? null : el("span", { class: "dampad", text: " (startvikt)" })),
        el("td", { class: "tal", text: tp.traff != null ? pct(tp.traff) : "–" }),
        el("td", { class: "tal", text: tp.antal.toLocaleString("sv-SE") }),
        el("td", { class: "tal", text: dec(tp.vikt) })));
    }
    t.append(b);
    box.append(t);
    box.append(el("p", { class: "forklaring-stat", text:
      "Vikten visar hur mycket tipsaren flyttar sannolikheterna jämfört med oddsen (0 = ingen påverkan). " +
      "Nya tipsare börjar på en liten startvikt och får en egen, inlärd vikt när de har minst 30 avgjorda matcher. " +
      "Vikterna lärs om varje söndag – tipsare som ofta har rätt där oddsen har fel får mer att säga till om." }));
  }

  if (blk.ligor?.length) {
    box.append(el("h3", { text: "Per liga (oddsen)" }));
    const t = el("table", { class: "stat-tabell" });
    const b = el("tbody");
    for (const l of blk.ligor) {
      b.append(el("tr", {}, el("td", { text: `${l.liga} (${l.antal})` }), el("td", { class: "tal", text: pct(l.traff) }),
        el("td", { class: "tal", text: dec(l.brier) })));
    }
    t.append(b);
    box.append(t);
  }

  if (st.senaste?.length) {
    box.append(el("h3", { text: "Senaste omgångarna – en rad med favorittecknet på alla 13" }));
    const snitt = (f) => (st.senaste.reduce((a, o) => a + o[f], 0) / st.senaste.length).toFixed(1).replace(".", ",");
    box.append(el("p", { class: "omg-sammanfattning" },
      el("span", {}, el("i", { class: "nyckel s1", "aria-hidden": "true" }), ` Oddsen ${snitt("modell_ratt")} rätt i snitt`),
      el("span", {}, el("i", { class: "nyckel s2", "aria-hidden": "true" }), ` Folket ${snitt("folket_ratt")} rätt i snitt`)));
    const stapel = (n, klass) => el("div", { class: "omg-stapel" },
      el("span", { class: "omg-spar", "aria-hidden": "true" }, el("i", { class: klass, style: `width:${(n / 13) * 100}%` })),
      el("b", { text: String(n) }));
    const t = el("table", { class: "omg-tabell" },
      el("thead", {}, el("tr", {}, el("th", { text: "Omgång" }), el("th", { text: "Oddsen" }), el("th", { text: "Folket" }),
        el("th", { class: "tal", text: "" }))));
    const b = el("tbody");
    for (const o of st.senaste) {
      const d = new Date(o.datum + "T12:00:00Z");
      const diff = o.modell_ratt - o.folket_ratt;
      b.append(el("tr", { "aria-label": `Vecka ${vecka(d)}: oddsen ${o.modell_ratt} rätt, folket ${o.folket_ratt} rätt` },
        el("td", { class: "omg-namn" }, el("b", { text: `v. ${vecka(d)}` }), el("span", { text: `${d.getUTCDate()}/${d.getUTCMonth() + 1}` })),
        el("td", {}, stapel(o.modell_ratt, "s1")),
        el("td", {}, stapel(o.folket_ratt, "s2")),
        el("td", { class: `tal omg-diff ${diff > 0 ? "plus" : diff < 0 ? "minus" : ""}`,
          text: diff > 0 ? `+${diff}` : diff < 0 ? `−${-diff}` : "lika" })));
    }
    t.append(b);
    box.append(t);
    box.append(el("p", { class: "forklaring-stat", text:
      "Staplarna visar antal rätt av 13 om man spelat en enda rad med det mest sannolika tecknet (oddsen) " +
      "respektive det mest streckade (folket). Kolumnen längst till höger är oddsens antal rätt minus folkets." }));
  }

  box.append(el("p", { class: "forklaring-stat", text:
    "Träff = andel matcher där det mest sannolika tecknet gick in. Brier mäter hur väl sannolikheterna stämmer: " +
    "0 är perfekt och 0,667 är att gissa en tredjedel på allt – lägre är bättre. Tipsens tecken räknas om till " +
    "sannolikheter, vilket straffar säkra tips som slår fel. Den sammanvägda modellen tas i bruk automatiskt först " +
    "när den träffat bättre än oddsen på de senaste cirka 40 omgångarna." }));
  box.append(el("p", {}, el("a", { class: "knapp primar", href: "#backtest", text: "Se vad det hade gett i kronor" })));
}

// ---------- meny och vyer ----------

const VYER = { kupong: "Kupongen", rattning: "Förra omgången", statistik: "Träffsäkerhet", backtest: "Spela varje vecka", hjalp: "Hjälp",
  om: "Om guiden" };

function initMeny() {
  const knapp = $("meny-knapp"), lista = $("meny-lista");
  const stang = () => { lista.hidden = true; knapp.setAttribute("aria-expanded", "false"); };
  knapp.addEventListener("click", (e) => {
    e.stopPropagation();
    const oppen = lista.hidden;
    lista.hidden = !oppen;
    knapp.setAttribute("aria-expanded", String(oppen));
    if (oppen) lista.querySelector('[aria-current="page"]')?.focus();
  });
  lista.addEventListener("click", (e) => { if (e.target.closest("a")) stang(); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".meny-val")) stang(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !lista.hidden) { stang(); knapp.focus(); } });
}

function visaVy() {
  const namn = location.hash.slice(1);
  const vy = VYER[namn] ? namn : "kupong";
  document.body.dataset.vy = vy;
  for (const s of document.querySelectorAll("main > .vy")) s.hidden = s.dataset.vy !== vy;
  for (const a of document.querySelectorAll("#meny-lista a")) {
    if (a.dataset.vy === vy) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  $("meny-aktuell").textContent = VYER[vy];
  if (vy === "backtest") oppnaBacktest();
  if (vy === "rattning") oppnaRattning();
  if (vy !== "kupong" || namn) window.scrollTo(0, 0);
}

// ---------- förra omgången (rättning) ----------

async function oppnaRattning() {
  if (state.senaste) return;
  try {
    const r = await fetch("senaste.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(String(r.status));
    state.senaste = await r.json();
    const lagrat = lasLagring();
    const id = state.senaste.omgang.id;
    const sparad = (lagrat.budgetar || {})[id];
    state.rBudget = BUDGETAR.includes(sparad) ? sparad : state.budget;
    $("r-budgetknappar").replaceChildren(...BUDGETAR.map((b) => {
      const k = el("button", { type: "button", role: "radio", "data-budget": b, text: String(b) });
      k.addEventListener("click", () => { state.rBudget = b; renderaRattning(); });
      return k;
    }));
    $("r-matcher").addEventListener("click", (e) => {
      const huvud = e.target.closest(".match-huvud");
      if (!huvud) return;
      const nr = Number(huvud.dataset.nr);
      state.rOppna.has(nr) ? state.rOppna.delete(nr) : state.rOppna.add(nr);
      renderaRattning();
      document.querySelector(`#r-matcher .match-huvud[data-nr="${nr}"]`)?.focus();
    });
    renderaRattning();
  } catch (e) {
    $("r-resultat").replaceChildren(el("p", { class: "fel", text: "Förra omgången kunde inte laddas." }));
    console.error(e);
  }
}

function renderaRattning() {
  const k = state.senaste;
  const { omgang } = k;
  const stopp = new Date(omgang.spelstopp);
  const datum = datumFmt.format(stopp);
  $("r-rubrik").textContent = `Stryktipset v. ${vecka(stopp)}`;
  $("r-underrubrik").textContent = `${datum.charAt(0).toUpperCase() + datum.slice(1)} · Omgång ${omgang.id}`;
  const status = $("r-status");
  status.textContent = { avgjord: "Rättad", stangd: "Spelas", installd: "Inställd", oppen: "Öppen" }[omgang.status] || "";
  status.hidden = !status.textContent;

  for (const b of $("r-budgetknappar").children) b.setAttribute("aria-checked", String(Number(b.dataset.budget) === state.rBudget));
  const lasningar = (lasLagring().lasningar || {})[omgang.id] || {};
  const rMatcher = matcherEnligtKalla(k);
  const res = optimera(rMatcher, state.rBudget, lasningar);
  const box = $("r-resultat");
  box.replaceChildren();

  if (!res.ok) {
    box.append(el("p", { class: "fel", text: res.fel }));
  } else {
    const facit = k.matcher.map((m) => m.resultat);
    const klara = facit.filter(Boolean).length;
    const fordelning = rattFordelning(res.val, facit.map((r) => r || "?"));
    const basta = fordelning.reduce((b, n, i) => (n > 0 ? i : b), 0);
    const utd = omgang.utdelning || {};
    const vinst = [13, 12, 11, 10].reduce((sum, n) => sum + (fordelning[n] || 0) * (utd[String(n)] || 0), 0);
    const avgjord = omgang.status === "avgjord";

    box.append(el("div", { class: "r-stort" },
      el("div", {}, el("b", { text: `${basta} rätt` }), el("span", { text: avgjord ? "bästa raden" : `av ${klara} spelade matcher` })),
      el("div", {}, el("b", { text: avgjord ? kr(vinst) : "–" }), el("span", { text: `vinst · insats ${kr(state.rBudget * (omgang.radpris || 1))}` }))));
    const rader = [13, 12, 11, 10].filter((n) => fordelning[n]).map((n) =>
      `${n} rätt: ${fordelning[n]} ${fordelning[n] === 1 ? "rad" : "rader"}${avgjord && utd[String(n)] ? ` à ${kr(utd[String(n)])}` : ""}`);
    box.append(el("p", { class: "dampad", text: rader.length ? rader.join(" · ") : "Ingen rad nådde 10 rätt." }));
    box.append(el("p", { class: "dampad liten", text: (state.kalla === "tips" ? "Förslaget Med experter. " : "") +
      (Object.keys(lasningar).length ? "Med dina låsningar. " : "") +
      "Rättningen gäller systemet som appen föreslog – vi vet inte vad du faktiskt lämnade in." }));
  }
  renderaUtdelning(omgang, res.ok ? rattFordelning(res.val, k.matcher.map((m) => m.resultat || "?")) : null);
  ritaMatcher($("r-matcher"), { ...k, matcher: rMatcher }, res, lasningar, state.rOppna, false,
    skillnadMotAndra(k, res, state.rBudget, lasningar));
}

/** Utdelningstabell för en avgjord omgång: kr per rad, antal vinnare och vad systemet vann per nivå. */
function renderaUtdelning(omgang, fordelning) {
  const sektion = $("r-utdelning");
  const utd = omgang.utdelning;
  sektion.hidden = !utd;
  if (!utd) return;
  const vinn = omgang.vinnare || {};
  const t = el("table", { class: "stat-tabell utdelningstabell" },
    el("thead", {}, el("tr", {}, el("th", { text: "Rätt" }), el("th", { class: "tal", text: "Per rad" }),
      el("th", { class: "tal", text: "Vinnare" }), el("th", { class: "tal", text: "Ditt system" }))));
  const b = el("tbody");
  let tot = 0;
  for (const n of ["13", "12", "11", "10"]) {
    const rader = fordelning ? fordelning[Number(n)] || 0 : 0;
    const vinst = rader * (utd[n] || 0);
    tot += vinst;
    b.append(el("tr", { class: rader ? "har-vinst" : "" },
      el("td", { text: `${n} rätt` }),
      el("td", { class: "tal", text: utd[n] ? kr(utd[n]) : (n === "13" ? "ingen vinnare" : "ingen utdelning") }),
      el("td", { class: "tal", text: vinn[n] != null ? Number(vinn[n]).toLocaleString("sv-SE") : "–" }),
      el("td", { class: "tal", text: rader ? `${rader} st · ${kr(vinst)}` : "–" })));
  }
  t.append(b);
  const box = $("r-utdelning-innehall");
  box.replaceChildren(t, el("p", { class: "dampad liten", text:
    `Omsättning ${kr(omgang.omsattning || 0)}. Under 15 kr per rad betalas ingen utdelning ut.` +
    (tot ? ` Ditt system vann totalt ${kr(tot)}.` : "") }));
}

// ---------- backtest ----------

const kr = (x) => `${Math.round(x).toLocaleString("sv-SE")} kr`;
const plusKr = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + kr(Math.abs(x));

async function oppnaBacktest() {
  if (state.historik) return;
  try {
    const r = await fetch("historik.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(String(r.status));
    state.historik = await r.json();
    state.btBudget = state.btBudget || 64;
    renderaBacktest();
  } catch (e) {
    $("backtest-innehall").replaceChildren(el("p", { class: "fel", text: "Historiken kunde inte laddas." }));
    console.error(e);
  }
}

function renderaBacktest() {
  const h = state.historik;
  const box = $("backtest-innehall");
  box.replaceChildren();
  if (!h?.omgangar?.length) { box.append(el("p", { class: "dampad", text: "Ingen historik ännu." })); return; }

  const arLista = ["alla", ...[...new Set(h.omgangar.map((o) => o.datum.slice(0, 4)))]
    .filter((a) => h.omgangar.filter((o) => o.datum.startsWith(a)).length >= 10).slice(1)];
  if (!arLista.includes(state.btAr)) state.btAr = "alla";
  const urval = franAr(h, state.btAr);
  const harTipsHist = urval.omgangar.some((o) => o.matcher.some((m) => m[7]));

  const vaxel = el("div", { class: "forslag", role: "radiogroup", "aria-label": "Vilket förslag i backtestet" });
  for (const [k, namn, under] of [["modell", "Oddsen", "Spelbolagens bedömning"], ["tips", "Med experter", "Odds + tipsare"]]) {
    const b = el("button", { type: "button", role: "radio", "data-kalla": k, "aria-checked": String(state.kalla === k),
      disabled: k === "tips" && !harTipsHist }, el("b", { text: namn }), el("span", { text: under }));
    b.addEventListener("click", () => {
      state.kalla = k;
      for (const x of document.querySelectorAll(".forslag button")) x.setAttribute("aria-checked", String(x.dataset.kalla === k));
      if (state.kupong) uppdatera();
      renderaBacktest();
    });
    vaxel.append(b);
  }
  box.append(vaxel);
  box.append(arsknappar(arLista, state.btAr, (a) => { state.btAr = a; renderaBacktest(); }));

  const forsta = urval.omgangar[0].datum, sista = urval.omgangar.at(-1).datum;
  box.append(el("p", { class: "dampad", text:
    `${state.kalla === "tips" ? "Förslaget Med experter" : "Oddsförslaget"} spelat varje vecka i ${urval.omgangar.length} omgångar ` +
    `(${forsta} – ${sista}), jämfört med att spela samma antal rader efter folkets streck. Riktig utdelning för 13–10 rätt.` }));

  const knappar = el("div", { class: "budgetknappar", role: "radiogroup", "aria-label": "Rader per vecka" });
  for (const b of BUDGETAR) {
    const k = el("button", { type: "button", role: "radio", "aria-checked": String(b === state.btBudget), text: String(b) });
    k.addEventListener("click", () => { state.btBudget = b; renderaBacktest(); });
    knappar.append(k);
  }
  box.append(knappar);

  const serier = [
    { namn: state.kalla === "tips" ? "Med experter" : "Oddsen", klass: "s1", farg: "var(--serie-1)",
      res: backtesta(urval, state.btBudget, state.kalla === "tips" ? "tips" : "modell") },
    { namn: "Folket", klass: "s2", farg: "var(--serie-2)", res: backtesta(urval, state.btBudget, "folket") },
  ];

  const kort = el("div", { class: "bt-kort" });
  for (const s of serier) {
    const { insats, vinst, antal } = s.res;
    kort.append(el("div", { class: "bt-ruta" },
      el("span", { class: "namn" }, el("i", { class: `nyckel ${s.klass}`, "aria-hidden": "true" }), s.namn),
      el("div", { class: "netto", text: plusKr(vinst - insats) }),
      el("p", { text: `Insats ${kr(insats)}` }),
      el("p", { text: `Tillbaka ${kr(vinst)} (${Math.round((100 * vinst) / insats)} %)` }),
      el("p", { text: `13 rätt: ${antal[13]} · 12: ${antal[12]} · 11: ${antal[11]} · 10: ${antal[10]}` })));
  }
  box.append(kort);
  box.append(diagram(serier));
  box.append(arstabell(serier));

  const storsta = serier[0].res.omgangar.filter((o) => o.vinst > 0).sort((a, b) => b.vinst - a.vinst).slice(0, 3);
  if (storsta.length) {
    box.append(el("h3", { text: `Största vinsterna (${serier[0].namn})` }));
    for (const o of storsta) {
      box.append(el("p", { text: `${o.datum} · ${o.basta} rätt · ${kr(o.vinst)}` }));
    }
  }
  box.append(el("p", { class: "bt-not", text:
    "Historiken bygger på Svenska Spels öppningsodds, som är mindre träffsäkra än odds nära spelstopp. " +
    "Vissa veckor ger 10 eller 11 rätt ingen utdelning alls, när väldigt många har det. " +
    "Resultatet styrs mycket av enstaka 13-rättare och säger lite om framtiden. Svenska Spel behåller ungefär " +
    "en tredjedel av insatserna, så de flesta förlorar på sikt." }));
}

function diagram(serier) {
  const W = 320, H = 180, V = 44, HO = 8, T = 8, B = 22;
  const n = serier[0].res.omgangar.length;
  const saldon = serier.map((s) => {
    let sum = 0;
    return s.res.omgangar.map((o) => (sum += o.vinst - o.insats));
  });
  const alla = saldon.flat().concat(0);
  let min = Math.min(...alla), max = Math.max(...alla);
  const steg = (() => { const r = (max - min) / 4; const p = 10 ** Math.floor(Math.log10(r || 1)); return [1, 2, 5, 10].map((m) => m * p).find((x) => x >= r); })();
  min = Math.floor(min / steg) * steg; max = Math.ceil(max / steg) * steg;
  const x = (i) => V + (i / Math.max(n - 1, 1)) * (W - V - HO);
  const y = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  const NS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

  const rot = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": `Saldo vecka för vecka. ${serier.map((s, i) => `${s.namn}: ${plusKr(saldon[i].at(-1))}`).join(", ")}.` });
  for (let v = min; v <= max + 1e-9; v += steg) {
    rot.append(svg("line", { class: v === 0 ? "noll" : "grid", x1: V, x2: W - HO, y1: y(v), y2: y(v) }));
    const t = svg("text", { class: "axel", x: V - 4, y: y(v) + 3, "text-anchor": "end" });
    t.textContent = Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("sv-SE")} tkr` : `${v}`;
    rot.append(t);
  }
  let senasteAr = null, senasteX = -Infinity;
  serier[0].res.omgangar.forEach((o, i) => {
    const ar = o.datum.slice(0, 4);
    if (ar !== senasteAr) {
      senasteAr = ar;
      const iAret = serier[0].res.omgangar.filter((q) => q.datum.startsWith(ar)).length;
      if (iAret < 5 || x(i) - senasteX < 30) return;   // brutet år eller för nära förra etiketten
      senasteX = x(i);
      const t = svg("text", { class: "axel", x: x(i), y: H - 6, "text-anchor": "middle" });
      t.textContent = ar;
      rot.append(t);
    }
  });
  serier.forEach((s, si) => {
    rot.append(svg("polyline", { class: "linje", stroke: s.farg,
      points: saldon[si].map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ") }));
  });
  const hair = svg("line", { class: "hair", y1: T, y2: H - B, visibility: "hidden" });
  rot.append(hair);
  const prickar = serier.map((s) => { const c = svg("circle", { r: 4, fill: s.farg, stroke: "var(--yta)", "stroke-width": 2, visibility: "hidden" }); rot.append(c); return c; });

  const ram = el("div", { class: "bt-diagram" });
  // Avläsning ovanför diagrammet: visar senaste veckan, eller den vecka pekaren/fingret är på.
  const tips = el("div", { class: "bt-avlasning", "aria-live": "polite" });
  const avlas = (i, aktiv) => {
    const o = serier[0].res.omgangar[i];
    tips.replaceChildren(el("div", { class: "dampad", text: aktiv ? `${o.datum} · omgång ${o.id}` : `Saldo efter ${o.datum}` }),
      ...serier.map((s, si) => el("div", { class: "rad" }, el("i", { class: `nyckel ${s.klass}`, "aria-hidden": "true" }),
        el("b", { text: plusKr(saldon[si][i]) }), el("span", { class: "dampad",
          text: aktiv ? `${s.namn}: ${s.res.omgangar[i].basta} rätt, vann ${kr(s.res.omgangar[i].vinst)}` : s.namn }))));
  };
  const visa = (i) => {
    hair.setAttribute("x1", x(i)); hair.setAttribute("x2", x(i)); hair.setAttribute("visibility", "visible");
    prickar.forEach((c, si) => { c.setAttribute("cx", x(i)); c.setAttribute("cy", y(saldon[si][i])); c.setAttribute("visibility", "visible"); });
    avlas(i, true);
  };
  const dolj = () => { avlas(n - 1, false); hair.setAttribute("visibility", "hidden"); prickar.forEach((c) => c.setAttribute("visibility", "hidden")); };
  dolj();
  rot.addEventListener("pointermove", (e) => {
    const r = rot.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    visa(Math.round(Math.min(Math.max((vx - V) / (W - V - HO), 0), 1) * (n - 1)));
  });
  rot.addEventListener("pointerleave", dolj);
  ram.append(tips, rot);
  return ram;
}

function arstabell(serier) {
  const ar = {};
  serier.forEach((s, si) => s.res.omgangar.forEach((o) => {
    const a = (ar[o.datum.slice(0, 4)] ||= { insats: 0, vinst: [0, 0] });
    if (si === 0) a.insats += o.insats;
    a.vinst[si] += o.vinst;
  }));
  const t = el("table", { class: "stat-tabell" },
    el("thead", {}, el("tr", {}, el("th", { text: "År" }), el("th", { class: "tal", text: "Insats" }),
      ...serier.map((s) => el("th", { class: "tal", text: s.namn })))));
  const b = el("tbody");
  for (const [a, v] of Object.entries(ar)) {
    b.append(el("tr", {}, el("td", { text: a }), el("td", { class: "tal", text: kr(v.insats) }),
      ...v.vinst.map((w) => el("td", { class: "tal", text: kr(w) }))));
  }
  t.append(b);
  return el("div", {}, el("h3", { text: "Tillbaka per år" }), t);
}

function uppdatera() {
  state.resultat = optimera(matcherEnligtKalla(state.kupong), state.budget, state.lasningar);
  state.skillnad = skillnadMotAndra(state.kupong, state.resultat, state.budget, state.lasningar);
  const sk = state.skillnad, skRad = $("skillnad");
  const nr = sk ? Object.keys(sk.skiljer) : [];
  skRad.hidden = !sk;
  skRad.textContent = !sk ? "" : nr.length
    ? `${sk.namn} skiljer sig på ${nr.length} ${nr.length === 1 ? "match" : "matcher"} (${nr.join(", ")}) – markerat på raderna.`
    : `${sk.namn} ger samma rader.`;
  for (const b of document.querySelectorAll(".forslag button")) b.setAttribute("aria-checked", String(b.dataset.kalla === state.kalla));

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
  $("rensa").hidden = Object.keys(state.lasningar).length === 0;

  renderaTopp();
  renderaMatcher();
  renderaStatistik();
  renderaOm();
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


start().catch((e) => {
  console.error(e);
  $("rubrik").textContent = "Något gick fel";
  $("underrubrik").replaceChildren("Prova att ladda om sidan. ",
    el("button", { type: "button", class: "knapp", text: "Ladda om" }));
  $("underrubrik").querySelector("button").addEventListener("click", () => location.reload());
});
