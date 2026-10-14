import {
  BUDGETAR, TECKEN, VARDE_GRANS, VARDE_GRANS_OSAKER, antalRatt, normaliseraLasning, optimera, sammanfattning, skrallchanser,
  skrallKrav,
} from "./optimizer.js?v=20261014e";
import * as konto from "./konto.js?v=20261014e";
import { MAX_MEDLEMMAR, POSTTYPER, SPELFORMER, farBokfora, farSpara, rakna, turFor, valideraPost } from "./spelbolag.js?v=20261014e";
import { andraTecken, normaliseraEpost, sammanstall, skapaSpel, valideraSpel, MAX_DELNINGAR } from "./minaspel.js?v=20261014e";
import { PREMIAR, backtesta, franAr, medLagkoll, rattFordelning } from "./backtest.js?v=20261014e";

const $ = (id) => document.getElementById(id);
const LAGRING = "stryktipshjalpen";
const TZ = "Europe/Stockholm";

const state = {
  kupong: null,
  exempel: false,
  budget: 96,
  lasningar: {},       // {matchnr: "1X"} för aktuell omgång
  oppna: new Set(),    // matcher med utfälld kommentar
  oddsOppna: new Set(), // matcher där alla bolags odds är utfällda
  resultat: null,      // senaste optimeringen
  historik: null,      // historik.json, laddas först när backtestet öppnas
  btBudget: null,      // vald budget i backtestet
  senaste: null,       // senaste.json – förra omgången, för rättning
  rBudget: null,       // vald budget i rättningen
  rOppna: new Set(),   // utfällda matcher i rättningen
  kalla: "modell",     // vilket förslag som visas, se FORSLAG
  formRang: [],        // tipsarnas form (kupong.json → tipsare_form), bäst först
  statAr: "alla",      // valt startår i "Så har modellen träffat"
  btAr: "alla",        // valt startår i backtestet
};

/** Rullgardin för startår: "Alla" först, sedan "Sedan premiären" (om med) och senaste året överst. */
function arsknappar(ar, valt, vid) {
  const ordning = ["alla", ...(ar.includes("premiar") ? ["premiar"] : []),
    ...ar.filter((a) => a !== "alla" && a !== "premiar").sort().reverse()];
  const val = el("select", { class: "arsval-lista", "aria-label": "Visa från år" },
    ...ordning.map((a) => {
      const o = el("option", { value: a, text: a === "alla" ? "Alla år" : a === "premiar" ? "Sedan premiären" : `Från ${a}` });
      o.selected = a === valt;
      return o;
    }));
  val.addEventListener("change", () => vid(val.value));
  return el("label", { class: "arsval" }, el("span", { text: "Visa" }), val);
}

// Förslagen man kan välja mellan. Skrällchans = Oddsens chans, men raderna måste ha med omgångens bästa
// skrällar (1 på små system, 2 på stora – se optimizer.skrallKrav). Lagkoll är en skuggmodell under test.
const FORSLAG = {
  modell: { namn: "Oddsen", under: "Spelbolagens bedömning" },
  tips: { namn: "Med experter", under: "Odds + tipsare" },
  lagkoll: { namn: "Lagkoll", under: "Odds + lagnyheter · test" },
  skrall: { namn: "Skrällchans", under: "Oddsen + 1–2 skrällar" },
};

const vardeMot = (chans, streck) => {
  if (!chans || !streck) return null;
  const summa = TECKEN.reduce((a, t) => a + streck[t], 0) || 1;
  return Object.fromEntries(TECKEN.map((t) => [t, chans[t] - streck[t] / summa]));
};

/** Matcherna enligt valt förslag: "tips" och "lagkoll" byter chans och värde där de finns. */
function matcherEnligtKalla(kupong, kalla = state.kalla) {
  if (kalla === "tips") {
    return kupong.matcher.map((m) => (m.chans_tips
      ? { ...m, chans: m.chans_tips, varde: m.varde_tips, chans_modell: m.chans, varde_modell: m.varde } : m));
  }
  if (kalla === "lagkoll") {
    return kupong.matcher.map((m) => (m.lagkoll
      ? { ...m, chans: m.lagkoll.chans, varde: vardeMot(m.lagkoll.chans, m.streck), chans_modell: m.chans, varde_modell: m.varde }
      : m));
  }
  return kupong.matcher;
}
const harTips = (kupong) => kupong.matcher.some((m) => m.chans_tips);

/** Optimera enligt ett förslag (med skrällkrav för "skrall"). */
function optimeraForslag(kupong, kalla, budget, lasningar) {
  const matcher = matcherEnligtKalla(kupong, kalla);
  return optimera(matcher, budget, lasningar, undefined, kalla === "skrall" ? skrallKrav(matcher, budget, lasningar) : {});
}

/** Kort förklaring under sammanfattningen för förslag som bara delvis skiljer sig från Oddsen. */
function forslagInfo(kupong, kalla, resultat) {
  if (kalla === "lagkoll") {
    const n = kupong.matcher.filter((m) => m.lagkoll).length;
    return n ? `Lagkoll har analyserat ${n} av 13 matcher – övriga följer Oddsen.`
      : "Lagkoll har inte analyserat omgången än (görs fredag kväll och lördag) – förslaget är samma som Oddsen.";
  }
  if (kalla === "skrall" && resultat?.ok) {
    const s = resultat.val.filter((v) => v.skrall);
    return s.length ? `Skrällar i raderna: ${s.map((v) => `${v.skrall} på match ${v.nr}`).join(" och ")}.`
      : "Inga skrällchanser i omgången just nu – förslaget är samma som Oddsen.";
  }
  return "";
}

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
  if (document.body.dataset.vy === "tabeller") visaTabeller();
  if (document.body.dataset.vy === "nyheter") renderaNyheter();
  state.formRang = state.kupong.tipsare_form || [];
  const lagrat = lasLagring();
  if (BUDGETAR.includes(lagrat.budget)) state.budget = lagrat.budget;
  if (FORSLAG[lagrat.kalla] && (lagrat.kalla !== "tips" || harTips(state.kupong))) state.kalla = lagrat.kalla;
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
  initKonto();
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
    text = `Spelstopp har passerat. Resultaten kommer efter att matcherna spelats. ${fryst(omgang)}`.trim();
  } else if (omgang.status === "installd") {
    text = "Omgången är inställd av Svenska Spel.";
  } else if (omgang.status === "avgjord" && state.resultat?.ok) {
    const facit = Object.fromEntries(state.kupong.matcher.map((m) => [m.nr, m.resultat]));
    const n = antalRatt(state.resultat.val, facit);
    const utd = omgang.utdelning?.[String(n)];
    text = `Omgången är avgjord. Ditt system hade ${n} rätt` +
      (utd ? ` – utdelning ${Math.round(utd).toLocaleString("sv-SE")} kr.` : ".") + (omgang.frusen ? ` ${fryst(omgang)}` : "");
  }
  banner.hidden = !text;
  banner.textContent = text || "";
}

function renderaMatcher() {
  ritaMatcher($("matcher"), { ...state.kupong, matcher: matcherEnligtKalla(state.kupong) },
    state.resultat, state.lasningar, state.oppna, true, state.skillnad);
}

/** Jämförelseförslaget med samma budget och låsningar: matcher med andra tecken. Oddsen jämförs med
 *  Med experter, alla andra förslag med Oddsen. */
function skillnadMotAndra(kupong, resultat, budget, lasningar) {
  const andra = state.kalla === "modell" ? "tips" : "modell";
  if (!resultat?.ok || (andra === "tips" && !harTips(kupong))) return null;
  const r = optimeraForslag(kupong, andra, budget, lasningar);
  if (!r.ok) return null;
  const skiljer = {};
  r.val.forEach((v, i) => { if (v.tecken !== resultat.val[i].tecken) skiljer[v.nr] = v.tecken; });
  return { namn: FORSLAG[andra].namn, skiljer };
}

/** Ritar kupongens matcher. interaktiv=false (rättningen): tecknen går inte att låsa. */
function ritaMatcher(lista, kupong, resultat, lasningar, oppna, interaktiv, skillnad = null) {
  lista.replaceChildren();
  const val = resultat?.ok ? Object.fromEntries(resultat.val.map((v) => [v.nr, v])) : {};
  const skrallar = skrallchanser(kupong.matcher);

  for (const m of kupong.matcher) {
    const skrall = skrallar[m.nr];
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
          skrall ? el("span", { class: "skrall-mark", text: ` · Skrällchans ${skrall.tecken}` }) : null,
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
    if (oppen) li.append(detaljer(m, v, skrall));
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
function detaljer(m, v, skrall = null) {
  const d = el("div", { class: "detaljer" });
  if (m.kommentar) d.append(el("p", { class: "kommentar", text: m.kommentar }));
  if (skrall) {
    d.append(el("p", { class: "skrall-text" }, el("b", { text: `Skrällchans ${skrall.tecken}: ` }),
      `${procent(skrall.chans)} % chans men bara ${Math.round(skrall.streck * 100)} % streck. ` +
      `Går den in betalar den ovanligt bra – men den är fortfarande mindre trolig än favoriten.`));
  }
  const tipsrad = tipsetiketter(m, v);
  if (tipsrad) d.append(tipsrad);
  if (m.tabell) d.append(tabellBlock(m));

  const tabell = el("table", { class: "detaljtabell" });
  tabell.append(el("thead", {}, el("tr", {}, el("th", { text: "Inför match" }),
    ...TECKEN.map((t) => el("th", { class: "tal", text: t })))));
  const kropp = el("tbody");
  const rubrik = (text) => kropp.append(el("tr", { class: "grupp" }, el("th", { colspan: 4, text })));
  const rad = (namn, varden, klass = "", under = null) => {
    const tr = el("tr", { class: klass },
      el("td", {}, namn, under ? el("span", { class: "under", text: under }) : null),
      ...TECKEN.map((t, i) => el("td", { class: "tal" }, varden[i] ?? "–")));
    kropp.append(tr);
    return tr;
  };
  const proc = (c) => TECKEN.map((t) => (c ? `${procent(c[t])} %` : null));

  const modell = m.chans_modell || (m.chans_kalla === "modell" ? m.chans : null);
  if (modell) rad("Oddsen", proc(modell), ["modell", "skrall"].includes(state.kalla) ? "markerad" : "", "chans enligt spelbolagen");
  if (m.chans_tips) rad("Med experter", proc(m.chans_tips), state.kalla === "tips" ? "markerad" : "", "odds + tipsare");
  if (m.lagkoll) rad("Lagkoll", proc(m.lagkoll.chans), state.kalla === "lagkoll" ? "markerad" : "skugga-rad", "odds + lagnyheter · test");
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
    if (m.odds.antal_bolag > 1) {
      // Snittet syns direkt; de enskilda bolagen fälls ut på begäran (sparar plats i mobilen)
      rad(`Snitt av ${m.odds.antal_bolag} bolag`, TECKEN.map((t) => decOdds(m.odds.snitt[t])));
      const bolagsrader = m.odds.bolag.map((b) => {
        const tr = rad(BOLAGSNAMN[b.bolag] || b.bolag, TECKEN.map((t) => decOdds(b[t])), "bolagsrad");
        tr.hidden = !state.oddsOppna.has(m.nr);
        return tr;
      });
      const fler = m.odds.antal_bolag > m.odds.bolag.length ? ` (de ${m.odds.bolag.length} största)` : "";
      const knapp = el("button", { type: "button", class: "visa-bolag", "aria-expanded": String(state.oddsOppna.has(m.nr)) });
      const etikett = () => { knapp.textContent = state.oddsOppna.has(m.nr) ? "Dölj bolagen" : `Visa bolagen${fler}`; };
      etikett();
      knapp.addEventListener("click", (e) => {
        e.stopPropagation();
        state.oddsOppna.has(m.nr) ? state.oddsOppna.delete(m.nr) : state.oddsOppna.add(m.nr);
        for (const tr of bolagsrader) tr.hidden = !state.oddsOppna.has(m.nr);
        knapp.setAttribute("aria-expanded", String(state.oddsOppna.has(m.nr)));
        etikett();
      });
      kropp.insertBefore(el("tr", { class: "visa-bolag-rad" }, el("td", { colspan: 4 }, knapp)), bolagsrader[0]);
    } else {
      for (const b of m.odds.bolag) rad(BOLAGSNAMN[b.bolag] || b.bolag, TECKEN.map((t) => decOdds(b[t])));
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
  if (m.lagkoll) d.append(lagkollPanel(m));
  const serie = serietabell(m.land, m.liga);
  if (serie) d.append(el("p", { class: "tabellank" }, extern(serie.url, `Serietabell: ${serie.namn}`)));
  return d;
}

// ---------- tabell och form ----------

const ordningstal = (n) => `${n}:${[1, 2].includes(n % 10) && ![11, 12].includes(n % 100) ? "a" : "e"}`;

/** Formrutor, äldst till vänster och senaste matchen längst till höger. form = "WWLDW" (senaste först). */
function formrutor(form, antal = 5) {
  const f = [...form.slice(0, antal)].reverse();
  return el("span", { class: "form", role: "img",
    "aria-label": `Senaste ${f.length} matcherna, äldst först: ${f.map((c) => FORMTEXT[c]).join(", ")}` },
    ...f.map((c) => el("span", { class: `formruta f${c}`, "aria-hidden": "true", text: c === "W" ? "V" : c === "D" ? "O" : "F" })));
}

function tabellBlock(m) {
  const t = m.tabell;
  const lag = (namn, r) => el("div", { class: "tabell-lag" },
    el("b", { text: namn }),
    r ? el("p", { text: `${ordningstal(r.plats)} av ${r.antal_lag} · ${r.poang} p på ${r.spelade}` }) : el("p", { class: "dampad", text: "Finns inte i tabellen" }),
    r?.form ? formrutor(r.form) : null);
  return el("section", { class: "tabellblock", "aria-label": "Tabell och form" },
    el("div", { class: "tabellblock-lagen" }, lag(m.hemmalag, t.hemma), lag(m.bortalag, t.borta)),
    el("p", { class: "dampad liten", text: `Tabell${t.hemma?.form || t.borta?.form ? " och form (senaste matchen längst till höger)" : ""}: ${t.kalla}.` }));
}

// ---------- konto och Mina spel ----------

const KONTO_FLAGGA = "stryktipsguiden-inloggad";
const ms = { anvandare: null, spel: null, delade: null, profil: null, oppna: new Set(), utkast: {}, raderaSteg: false,
  taBort: null, fel: "" };

function initKonto() {
  const knapp = $("spara-spel");
  if (!konto.aktiverat()) return;
  knapp.hidden = false;
  knapp.addEventListener("click", sparaAktuelltSpel);
  initKontoknapp();
  konto.nar((u) => {
    ms.anvandare = u;
    renderaKontoknapp();
    try { u ? localStorage.setItem(KONTO_FLAGGA, "1") : localStorage.removeItem(KONTO_FLAGGA); } catch { /* privat läge */ }
    ms.spel = ms.delade = ms.profil = null;
    sb.grupper = null; sb.data = {};
    if (document.body.dataset.vy === "minaspel") oppnaMinaSpel();
    if (document.body.dataset.vy === "spelbolag") oppnaSpelbolag();
    if (u) laddaGrupper().then(renderaTurInfo).catch(() => {}); else renderaTurInfo();
  });
  // Starta Firebase direkt bara om man var inloggad förra gången eller kommer från en inloggningslänk
  let flagga = false;
  try { flagga = localStorage.getItem(KONTO_FLAGGA) === "1"; } catch { /* privat läge */ }
  if (flagga || /[?&]oobCode=/.test(location.href) || location.hash.startsWith("#gamed-")) {
    konto.starta().then(() => konto.slutforLank(fragaEpostForLank)).catch((e) => { ms.fel = e.message; });
  }
}

// ---------- kontoknappen uppe till höger ----------

const PERSON_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';

function initialer(namn) {
  return (namn || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((d) => d[0].toUpperCase()).join("");
}

function avatar(u, klass = "avatar") {
  const a = el("span", { class: klass, "aria-hidden": "true" });
  if (u?.bild) a.append(el("img", { src: u.bild, alt: "", referrerpolicy: "no-referrer" }));
  else if (u) a.textContent = initialer(u.namn);
  else a.innerHTML = PERSON_SVG;
  return a;
}

function initKontoknapp() {
  $("konto-val").hidden = false;
  const knapp = $("konto-knapp"), meny = $("konto-meny");
  const stang = () => { meny.hidden = true; knapp.setAttribute("aria-expanded", "false"); };
  knapp.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!ms.anvandare) { location.hash = "#minaspel"; return; }
    const oppna = meny.hidden;
    $("meny-lista").hidden = true;            // bara en meny öppen åt gången
    $("meny-knapp").setAttribute("aria-expanded", "false");
    if (oppna) renderaKontomeny();
    meny.hidden = !oppna;
    knapp.setAttribute("aria-expanded", String(oppna));
  });
  meny.addEventListener("click", (e) => { if (e.target.closest("a")) stang(); e.stopPropagation(); });
  // pointerdown i stället för click: Safari på iPhone skickar inte click från ytor som inte är klickbara
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".konto-val")) stang(); });
  window.addEventListener("hashchange", stang);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !meny.hidden) { stang(); knapp.focus(); } });
  $("meny-knapp").addEventListener("click", stang);
  renderaKontoknapp();
}

function renderaKontoknapp() {
  const u = ms.anvandare;
  $("konto-avatar").replaceWith(Object.assign(avatar(u), { id: "konto-avatar" }));
  $("konto-knapp").setAttribute("aria-label", u ? `Konto: ${u.namn}` : "Logga in");
  $("konto-knapp").classList.toggle("inloggad", Boolean(u));
  if (!u) $("konto-meny").hidden = true;
}

/** Beskär bilden till en kvadrat och förminska till 160×160 JPEG (några kB), i telefonen. */
async function forminskaBild(fil) {
  const bild = await createImageBitmap(fil);
  const sida = Math.min(bild.width, bild.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 160;
  canvas.getContext("2d").drawImage(bild, (bild.width - sida) / 2, (bild.height - sida) / 2, sida, sida, 0, 0, 160, 160);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function renderaKontomeny() {
  const u = ms.anvandare, meny = $("konto-meny");
  const status = el("p", { class: "konto-status", "aria-live": "polite" });
  const fil = el("input", { type: "file", id: "profilbild", accept: "image/*", class: "sr-only" });
  fil.addEventListener("change", async () => {
    if (!fil.files[0]) return;
    status.textContent = "Sparar bilden …";
    try {
      await konto.sparaBild(await forminskaBild(fil.files[0]));
      meny.hidden = true;
      $("konto-knapp").setAttribute("aria-expanded", "false");
    } catch (e) { status.textContent = `Bilden kunde inte sparas: ${e.message}`; }
  });
  const delar = [
    el("div", { class: "konto-meny-huvud" }, avatar(u, "avatar stor"),
      el("div", {}, el("b", { text: u.namn }), el("span", { text: u.epost }))),
    el("a", { href: "#minaspel", text: "Mina spel" }),
    el("a", { href: "#spelbolag", text: "Spelbolag" }),
    el("label", { for: "profilbild", class: "konto-meny-rad", text: u.egenBild ? "Byt profilbild" : "Lägg till profilbild" }), fil,
  ];
  if (u.egenBild) {
    const ta = el("button", { type: "button", class: "konto-meny-rad", text: u.googleBild ? "Använd Google-bilden" : "Ta bort profilbilden" });
    ta.addEventListener("click", async () => {
      try {
        await konto.sparaBild(null);
        meny.hidden = true;
        $("konto-knapp").setAttribute("aria-expanded", "false");
      } catch (e) { status.textContent = e.message; }
    });
    delar.push(ta);
  }
  const ut = el("button", { type: "button", class: "konto-meny-rad", text: "Logga ut" });
  ut.addEventListener("click", async () => { meny.hidden = true; await konto.loggaUt(); });
  delar.push(ut, status);
  meny.replaceChildren(...delar);
}

function fragaEpostForLank() {
  return new Promise((klar) => {
    location.hash = "#minaspel";
    const box = $("minaspel-innehall");
    const falt = el("input", { type: "email", id: "lank-epost", autocomplete: "email", required: true, placeholder: "namn@exempel.se" });
    const form = el("form", { class: "konto-form" }, el("label", { for: "lank-epost", text: "Vilken e-postadress skickades länken till?" }),
      falt, el("button", { type: "submit", class: "knapp primar", text: "Logga in" }));
    form.addEventListener("submit", (e) => { e.preventDefault(); klar(normaliseraEpost(falt.value)); });
    box.replaceChildren(el("section", { class: "kort" }, el("h2", { text: "Slutför inloggningen" }),
      el("p", { text: "Du öppnade länken på en annan enhet eller webbläsare än där du bad om den." }), form));
  });
}

async function sparaAktuelltSpel() {
  const status = $("spara-status"), val = $("spara-val");
  status.hidden = false;
  if (!ms.anvandare) {
    status.textContent = "Logga in under Mina spel för att spara dina rader.";
    status.append(" ", el("a", { href: "#minaspel", text: "Logga in" }));
    return;
  }
  if (!state.resultat?.ok) { status.textContent = "Det finns inga rader att spara."; return; }
  // Med spelbolag: fråga om raderna spelades själv eller för ett bolag
  const grupper = sb.grupper || [];
  if (grupper.length && val.hidden) {
    const omg = state.kupong.omgang.id;
    const knapp = (text, fn, aktiv = true, not = "") => {
      const b = el("button", { type: "button", class: "knapp", text, disabled: !aktiv });
      b.addEventListener("click", fn);
      return el("div", { class: "spara-alternativ" }, b, not ? el("span", { class: "dampad liten", text: not }) : null);
    };
    val.replaceChildren(el("p", { class: "liten", text: "Vem spelade raderna?" }),
      knapp("Jag själv", () => sparaSom(null)),
      ...grupper.map((g) => {
        const ok = farSpara(g, ms.anvandare.uid, omg);
        const tur = turFor(g, omg);
        return knapp(`För ${g.namn}`, () => sparaSom(g), ok,
          ok ? "" : g.spelform === "tur" ? `Det är ${g.medlemmar[tur] ? `${g.medlemmar[tur].namn}s` : "någon annans"} tur den här veckan.`
            : "Det är kassören som lämnar in.");
      }));
    val.hidden = false;
    status.hidden = true;
    return;
  }
  await sparaSom(null);
}

async function sparaSom(grupp) {
  const status = $("spara-status");
  $("spara-val").hidden = true;
  status.hidden = false;
  const spel = skapaSpel({ kupong: state.kupong, forslag: state.kalla, resultat: state.resultat,
    forslagResultat: optimeraForslag(state.kupong, state.kalla, state.budget, {}) });
  const fel = valideraSpel(spel);
  if (fel) { status.textContent = fel; return; }
  status.textContent = "Sparar …";
  try {
    if (grupp) {
      await konto.sparaGruppSpel(grupp, spel);
      delete sb.data[grupp.id];
      status.textContent = `Sparat för ${grupp.namn}: ${FORSLAG[spel.forslag].namn}, ${spel.rader} rader. ` +
        "Sparar du igen ersätts bolagets rader för den här omgången.";
    } else {
      await konto.sparaSpel(spel);
      ms.spel = null;
      status.textContent = `Sparat i Mina spel: ${FORSLAG[spel.forslag].namn}, ${spel.rader} rader. ` +
        "Sparar du igen ersätts raderna för den här omgången.";
    }
  } catch (e) {
    status.textContent = `Kunde inte spara: ${e.message}`;
  }
}

async function laddaHistorik() {
  if (state.historik) return state.historik;
  const r = await fetch("historik.json", { cache: "no-cache" });
  if (!r.ok) throw new Error(String(r.status));
  state.historik = await r.json();
  return state.historik;
}

async function oppnaMinaSpel() {
  const box = $("minaspel-innehall");
  if (!konto.aktiverat()) {
    box.replaceChildren(el("section", { class: "kort" }, el("p", { text:
      "Inloggning och Mina spel är inte aktiverade än. När de är det kan du spara de rader du lämnar in och följa hur de går." })));
    return;
  }
  try {
    await konto.starta();
  } catch (e) {
    box.replaceChildren(el("p", { class: "fel", text: `Inloggningen kunde inte laddas: ${e.message}` }));
    return;
  }
  if (!ms.anvandare) { renderaInloggning(box); return; }
  try {
    [ms.spel, ms.delade, ms.profil] = await Promise.all([
      ms.spel || konto.minaSpel(), ms.delade || konto.deladeSpel(), ms.profil || konto.profil(), laddaHistorik()]);
  } catch (e) {
    box.replaceChildren(el("p", { class: "fel", text: `Dina spel kunde inte hämtas: ${e.message}` }));
    return;
  }
  renderaMinaSpel(box);
}

function renderaInloggning(box) {
  const status = el("p", { class: "konto-status", "aria-live": "polite", text: ms.fel });
  const google = el("button", { type: "button", class: "knapp primar", text: "Logga in med Google" });
  google.addEventListener("click", async () => {
    status.textContent = "";
    try { await konto.loggaInGoogle(); } catch (e) { status.textContent = `Inloggningen avbröts: ${e.message}`; }
  });
  const falt = el("input", { type: "email", id: "konto-epost", autocomplete: "email", required: true, placeholder: "namn@exempel.se" });
  const form = el("form", { class: "konto-form" },
    el("label", { for: "konto-epost", text: "Eller få en inloggningslänk till din e-post" }), falt,
    el("button", { type: "submit", class: "knapp", text: "Skicka länk" }));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const epost = normaliseraEpost(falt.value);
    if (!epost) { status.textContent = "Skriv en giltig e-postadress."; return; }
    try {
      await konto.skickaLank(epost);
      status.textContent = `Länken är skickad till ${epost}. Öppna den på den här enheten för att logga in.`;
    } catch (e) { status.textContent = `Länken kunde inte skickas: ${e.message}`; }
  });
  box.replaceChildren(el("section", { class: "kort" },
    el("h2", { text: "Logga in" }),
    el("p", { text: "Med ett konto kan du spara raderna du lämnar in, se hur de gick över tid och dela dem med vänner." }),
    google, form, status,
    el("p", { class: "dampad liten", text: "Vi sparar bara ditt namn, din e-postadress och de spel du själv sparar. " +
      "Du kan radera allt när du vill under Mina spel." })));
}

function spelkort(spel, r, { egen }) {
  const d = new Date(spel.datum + "T12:00:00Z").toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" });
  const kort = el("article", { class: "spelkort" });
  kort.append(el("div", { class: "spelkort-huvud" },
    el("div", {}, el("b", { text: `Omgång ${spel.omgang_id}` }), el("span", { class: "dampad liten", text: ` · ${d}` }),
      el("p", { class: "dampad liten", text: `${FORSLAG[spel.forslag]?.namn || spel.forslag} · ${spel.rader} rader · ${kr(spel.insats)}` })),
    r ? el("div", { class: "spelkort-res" }, el("b", { text: `${r.basta} rätt` }), el("span", { text: kr(r.vinst) }))
      : el("div", { class: "spelkort-res vantar" }, el("span", { text: "Inte avgjord" }))));
  if (r && r.andrade.length) {
    const diff = r.vinst - r.forslag.vinst;
    kort.append(el("p", { class: "liten", text:
      `Du ändrade ${r.andrade.length} ${r.andrade.length === 1 ? "match" : "matcher"}. Utan ändringarna: ${r.forslag.basta} rätt, ` +
      `${kr(r.forslag.vinst)}${diff ? ` (${diff > 0 ? "dina ändringar gav" : "dina ändringar kostade"} ${kr(Math.abs(diff))})` : ""}.` +
      (r.lyckade.length ? ` Rätt ändrat: match ${r.lyckade.map((i) => i + 1).join(", ")}.` : "") +
      (r.missade.length ? ` Fel ändrat: match ${r.missade.map((i) => i + 1).join(", ")}.` : "") }));
  } else if (!r && spel.tecken.some((t, i) => t !== spel.forslag_tecken[i])) {
    kort.append(el("p", { class: "dampad liten", text: `Egna ändringar på ${spel.tecken.filter((t, i) => t !== spel.forslag_tecken[i]).length} matcher.` }));
  }
  const nyckel = `${spel.agare}_${spel.omgang_id}`;
  const visa = el("button", { type: "button", class: "visa-bolag", "aria-expanded": String(ms.oppna.has(nyckel)),
    text: ms.oppna.has(nyckel) ? "Dölj raderna" : egen && !r ? "Visa och ändra raderna" : "Visa raderna" });
  visa.addEventListener("click", () => { ms.oppna.has(nyckel) ? ms.oppna.delete(nyckel) : ms.oppna.add(nyckel); renderaMinaSpel($("minaspel-innehall")); });
  const knappar = el("div", { class: "spelkort-knappar" }, visa);
  if (egen) knappar.append(...taBortKnappar(spel));
  kort.append(knappar);
  if (ms.oppna.has(nyckel)) kort.append(spelrader(spel, r, egen && !r));
  return kort;
}

/** "Ta bort" med bekräftelse i två steg (appen kan inte visa confirm-dialoger). */
function taBortKnappar(spel) {
  const rita = () => renderaMinaSpel($("minaspel-innehall"));
  if (ms.taBort !== spel.omgang_id) {
    const b = el("button", { type: "button", class: "visa-bolag fara-text", text: "Ta bort",
      "aria-label": `Ta bort spelet för omgång ${spel.omgang_id}` });
    b.addEventListener("click", () => { ms.taBort = spel.omgang_id; rita(); });
    return [b];
  }
  const ja = el("button", { type: "button", class: "visa-bolag fara-text", text: "Ja, ta bort spelet" });
  ja.addEventListener("click", async () => {
    try {
      await konto.taBortSpel(spel.omgang_id);
      ms.taBort = null;
      delete ms.utkast[spel.omgang_id];
      ms.spel = null;
      oppnaMinaSpel();
    } catch (e) {
      ja.textContent = `Gick inte: ${e.message}`;
    }
  });
  const nej = el("button", { type: "button", class: "visa-bolag", text: "Avbryt" });
  nej.addEventListener("click", () => { ms.taBort = null; rita(); });
  return [ja, nej];
}

function spelrader(spel, r, redigerbar) {
  const utkast = ms.utkast[spel.omgang_id] || spel;
  const lista = el("ol", { class: "spelrader" });
  utkast.tecken.forEach((t, i) => {
    const andrad = t !== spel.forslag_tecken[i];
    const rutor = el("span", { class: "spelrutor" }, ...["1", "X", "2"].map((x) => {
      const vald = t.includes(x);
      const b = el(redigerbar ? "button" : "span", { class: `spelruta${vald ? " vald" : ""}${r?.facit[i] === x ? " utfall" : ""}`,
        text: x, ...(redigerbar ? { type: "button", "aria-pressed": String(vald), "aria-label": `Match ${i + 1}: ${x}` } : {}) });
      if (redigerbar) {
        b.addEventListener("click", () => {
          const ny = vald ? t.replace(x, "") : ["1", "X", "2"].filter((y) => t.includes(y) || y === x).join("");
          if (!ny) return;
          ms.utkast[spel.omgang_id] = andraTecken(utkast, i, ny);
          renderaMinaSpel($("minaspel-innehall"));
        });
      }
      return b;
    }));
    lista.append(el("li", { class: andrad ? "andrad" : "" },
      el("span", { class: "spelmatch", text: spel.matcher[i] }), rutor));
  });
  const del = [lista, el("p", { class: "dampad liten", text: "Markerade matcher skiljer sig från förslaget." +
    (r ? " Gul ram = rätt tecken." : "") })];
  if (redigerbar && ms.utkast[spel.omgang_id]) {
    const spara = el("button", { type: "button", class: "knapp primar", text: `Spara ändringar (${utkast.rader} rader)` });
    spara.addEventListener("click", async () => {
      await konto.sparaSpel(utkast);
      delete ms.utkast[spel.omgang_id];
      ms.spel = null;
      oppnaMinaSpel();
    });
    const angra = el("button", { type: "button", class: "knapp", text: "Ångra" });
    angra.addEventListener("click", () => { delete ms.utkast[spel.omgang_id]; renderaMinaSpel($("minaspel-innehall")); });
    del.push(el("div", { class: "knapprad" }, spara, angra));
  }
  return el("div", {}, ...del);
}

function renderaMinaSpel(box) {
  const s = sammanstall(ms.spel || [], state.historik);
  const ut = [];
  const loggaUt = el("button", { type: "button", class: "visa-bolag", text: "Logga ut" });
  loggaUt.addEventListener("click", () => konto.loggaUt());
  ut.push(el("p", { class: "konto-rad" }, `Inloggad som ${ms.anvandare.namn}`, " · ", loggaUt));

  if (!s.antal) {
    ut.push(el("section", { class: "kort" }, el("h2", { text: "Inga sparade spel än" }),
      el("p", { text: "Välj förslag och antal rader på kupongen och tryck på ”Jag lämnade in de här raderna” när du har spelat. " +
        "Har du ändrat något kan du justera raderna här efteråt." })));
  } else {
    const netto = s.netto;
    ut.push(el("section", { class: "kort ms-summa" },
      el("div", {}, el("span", { text: "Spel" }), el("b", { text: String(s.antal) })),
      el("div", {}, el("span", { text: "Insats" }), el("b", { text: kr(s.insats) })),
      el("div", {}, el("span", { text: "Tillbaka" }), el("b", { text: kr(s.vinst) })),
      el("div", {}, el("span", { text: "Netto" }), el("b", { class: netto >= 0 ? "plus" : "minus", text: plusKr(netto) })),
      el("p", { class: "dampad liten", text: s.rattade
        ? `${s.rattade} av ${s.antal} spel är rättade. Förslagen utan dina ändringar hade gett ${kr(s.forslagVinst)}. Bästa resultat: ${s.basta} rätt.`
        : "Inget spel är rättat än – resultaten kommer på söndagen." })));
    ut.push(el("h2", { class: "ms-rubrik", text: "Dina spel" }));
    for (const { spel, resultat } of s.rader) ut.push(spelkort(spel, resultat, { egen: true }));
  }

  if (ms.delade?.length) {
    ut.push(el("h2", { class: "ms-rubrik", text: "Delat med dig" }));
    const perAgare = new Map();
    for (const sp of ms.delade) (perAgare.get(sp.agare_namn) || perAgare.set(sp.agare_namn, []).get(sp.agare_namn)).push(sp);
    for (const [namn, lista] of perAgare) {
      const sa = sammanstall(lista, state.historik);
      ut.push(el("p", { class: "liten" }, el("b", { text: namn }), ` · ${sa.antal} spel · netto ${plusKr(sa.netto)}`));
      for (const { spel, resultat } of sa.rader.slice(0, 5)) ut.push(spelkort(spel, resultat, { egen: false }));
    }
  }

  ut.push(delningsruta());
  ut.push(raderingsruta());
  box.replaceChildren(...ut);
}

function delningsruta() {
  const lista = ms.profil?.delad_med || [];
  const status = el("p", { class: "konto-status", "aria-live": "polite" });
  const falt = el("input", { type: "email", id: "dela-epost", autocomplete: "off", placeholder: "van@exempel.se" });
  const form = el("form", { class: "konto-form rad" }, el("label", { for: "dela-epost", class: "sr-only", text: "E-postadress att dela med" }),
    falt, el("button", { type: "submit", class: "knapp", text: "Dela" }));
  const spara = async (ny) => {
    try { await konto.satDelning(ny); ms.profil = { ...ms.profil, delad_med: ny }; renderaMinaSpel($("minaspel-innehall")); }
    catch (e) { status.textContent = `Det gick inte att spara: ${e.message}`; }
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const epost = normaliseraEpost(falt.value);
    if (!epost) { status.textContent = "Skriv en giltig e-postadress."; return; }
    if (epost === ms.anvandare.epost) { status.textContent = "Det är din egen adress."; return; }
    if (lista.includes(epost)) { status.textContent = "Den adressen har redan tillgång."; return; }
    if (lista.length >= MAX_DELNINGAR) { status.textContent = `Du kan dela med högst ${MAX_DELNINGAR} personer.`; return; }
    spara([...lista, epost]);
  });
  return el("section", { class: "kort" }, el("h2", { text: "Dela dina spel" }),
    el("p", { class: "liten", text: "Den du delar med ser dina sparade spel och resultat när hen loggar in med den e-postadressen. " +
      "Hen kan inte ändra något." }),
    form, status,
    lista.length ? el("ul", { class: "delningar" }, ...lista.map((e) => {
      const ta = el("button", { type: "button", class: "visa-bolag", text: "Ta bort", "aria-label": `Sluta dela med ${e}` });
      ta.addEventListener("click", () => spara(lista.filter((x) => x !== e)));
      return el("li", {}, el("span", { text: e }), ta);
    })) : el("p", { class: "dampad liten", text: "Du delar inte med någon." }));
}

function raderingsruta() {
  const status = el("p", { class: "konto-status", "aria-live": "polite" });
  const knapp = el("button", { type: "button", class: "knapp fara", text: ms.raderaSteg ? "Ja, radera allt" : "Radera mitt konto" });
  knapp.addEventListener("click", async () => {
    if (!ms.raderaSteg) { ms.raderaSteg = true; renderaMinaSpel($("minaspel-innehall")); return; }
    try { await konto.raderaKonto(); ms.raderaSteg = false; status.textContent = "Ditt konto och dina spel är raderade."; }
    catch (e) { status.textContent = e.message; }
  });
  const delar = [el("h2", { text: "Radera konto" }),
    el("p", { class: "liten", text: ms.raderaSteg
      ? "Alla dina sparade spel, delningar och själva kontot tas bort. Det går inte att ångra."
      : "Tar bort alla dina sparade spel och ditt konto." }), knapp];
  if (ms.raderaSteg) {
    const avbryt = el("button", { type: "button", class: "knapp", text: "Avbryt" });
    avbryt.addEventListener("click", () => { ms.raderaSteg = false; renderaMinaSpel($("minaspel-innehall")); });
    delar.push(avbryt);
  }
  delar.push(status);
  return el("section", { class: "kort radera" }, ...delar);
}

// ---------- spelbolag ----------

const sb = { grupper: null, vald: null, data: {}, anslutKod: null, skapa: false, radera: false, taBortPost: null, fel: "" };
const kort = (...barn) => el("section", { class: "kort" }, ...barn);

async function laddaGrupper() {
  sb.grupper = await konto.minaGrupper();
  if (!sb.grupper.some((g) => g.id === sb.vald)) sb.vald = sb.grupper[0]?.id || null;
  return sb.grupper;
}

/** Rad på kupongen: vems tur det är i spelbolag med turordning. */
function renderaTurInfo() {
  const rad = $("tur-info");
  if (!rad) return;
  const omg = state.kupong?.omgang.id;
  const delar = (ms.anvandare && omg ? sb.grupper || [] : []).filter((g) => g.spelform === "tur").map((g) => {
    const tur = turFor(g, omg);
    return tur === ms.anvandare.uid ? `Din tur att spela i ${g.namn} den här veckan.` : `${g.medlemmar[tur]?.namn || "Någon"}s tur i ${g.namn}.`;
  });
  rad.hidden = !delar.length;
  rad.textContent = delar.join(" ");
}

async function oppnaSpelbolag() {
  const box = $("spelbolag-innehall");
  if (!konto.aktiverat()) { box.replaceChildren(kort(el("p", { text: "Inloggningen är inte aktiverad." }))); return; }
  try { await konto.starta(); } catch (e) { box.replaceChildren(el("p", { class: "fel", text: e.message })); return; }
  if (!ms.anvandare) {
    renderaInloggning(box);
    if (sb.anslutKod) box.prepend(el("p", { class: "premiar-not", text: "Logga in för att gå med i spelbolaget du blivit inbjuden till." }));
    return;
  }
  try {
    if (sb.anslutKod) { await visaInbjudan(box); return; }
    if (!sb.grupper) { await laddaGrupper(); renderaTurInfo(); }
    const g = sb.grupper.find((x) => x.id === sb.vald);
    if (g && !sb.data[g.id]) {
      const [spel, bok] = await Promise.all([konto.gruppSpel(g.id), konto.kassabok(g.id), laddaHistorik()]);
      sb.data[g.id] = { spel, bok };
    }
  } catch (e) {
    box.replaceChildren(el("p", { class: "fel", text: `Spelbolagen kunde inte hämtas: ${e.message}` }));
    return;
  }
  renderaSpelbolag(box);
}

async function visaInbjudan(box) {
  const kod = sb.anslutKod;
  const inb = await konto.inbjudan(kod);
  const avbryt = () => { sb.anslutKod = null; location.hash = "#spelbolag"; };
  if (!inb) {
    box.replaceChildren(kort(el("h2", { text: "Inbjudan gäller inte längre" }),
      el("p", { text: "Länken har bytts ut eller bolaget finns inte. Be den som bjöd in dig om en ny länk." })));
    sb.anslutKod = null;
    return;
  }
  if (!sb.grupper) await laddaGrupper();
  if (sb.grupper.some((g) => g.id === inb.gid)) { sb.vald = inb.gid; avbryt(); return; }
  const status = el("p", { class: "konto-status", "aria-live": "polite" });
  const ja = el("button", { type: "button", class: "knapp primar", text: `Gå med i ${inb.namn}` });
  ja.addEventListener("click", async () => {
    try {
      sb.vald = await konto.anslut(kod);
      sb.grupper = null;
      avbryt();
    } catch (e) { status.textContent = `Det gick inte att gå med: ${e.message}`; }
  });
  const nej = el("button", { type: "button", class: "knapp", text: "Nej tack" });
  nej.addEventListener("click", avbryt);
  box.replaceChildren(kort(el("h2", { text: `Du är inbjuden till ${inb.namn}` }),
    el("p", { text: "Som medlem ser du bolagets spel, kassabok och allas saldon. Insatser och vinster delas lika mellan medlemmarna." }),
    el("div", { class: "knapprad" }, ja, nej), status));
}

function skapaForm() {
  const namn = el("input", { type: "text", id: "sb-namn", maxlength: 60, required: true, placeholder: "t.ex. Fredagsgänget" });
  const form = el("select", { id: "sb-form" }, el("option", { value: "kassa", text: "Kassa – en kassör spelar för allas pengar" }),
    el("option", { value: "tur", text: "Turordning – en medlem spelar per vecka" }));
  const status = el("p", { class: "konto-status", "aria-live": "polite" });
  const f = el("form", { class: "konto-form" }, el("label", { for: "sb-namn", text: "Namn" }), namn,
    el("label", { for: "sb-form", text: "Spelform" }), form,
    el("button", { type: "submit", class: "knapp primar", text: "Skapa spelbolaget" }), status);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = namn.value.trim();
    if (!n) { status.textContent = "Ge bolaget ett namn."; return; }
    try {
      sb.vald = await konto.skapaGrupp(n, form.value, state.kupong?.omgang.id || 0);
      sb.grupper = null; sb.skapa = false;
      oppnaSpelbolag();
    } catch (err) { status.textContent = `Det gick inte att skapa bolaget: ${err.message}`; }
  });
  return kort(el("h2", { text: "Nytt spelbolag" }), f,
    el("p", { class: "dampad liten", text: "Du bjuder in de andra med en länk när bolaget är skapat. Appen bokför bara – den hanterar inga pengar." }));
}

function renderaSpelbolag(box) {
  const ut = [];
  const grupper = sb.grupper || [];
  if (!grupper.length) {
    ut.push(kort(el("h2", { text: "Spela tillsammans" }),
      el("p", { text: "Ett spelbolag samlar era gemensamma spel, en kassabok och vad var och en har betalat och ska ha. " +
        "Antingen spelar en kassör för allas pengar, eller så spelar ni en vecka var." })));
    ut.push(skapaForm());
    box.replaceChildren(...ut);
    return;
  }
  // Välj bolag
  const valj = el("select", { id: "sb-valj", class: "arsval-lista", "aria-label": "Välj spelbolag" },
    ...grupper.map((g) => { const o = el("option", { value: g.id, text: g.namn }); o.selected = g.id === sb.vald; return o; }),
    el("option", { value: "__ny", text: "+ Nytt spelbolag" }));
  valj.addEventListener("change", () => {
    if (valj.value === "__ny") { sb.skapa = true; renderaSpelbolag(box); return; }
    sb.vald = valj.value; sb.skapa = false; sb.radera = false; oppnaSpelbolag();
  });
  ut.push(el("label", { class: "arsval sb-valj" }, el("span", { text: "Bolag" }), valj));
  if (sb.skapa) { ut.push(skapaForm()); box.replaceChildren(...ut); return; }

  const g = grupper.find((x) => x.id === sb.vald);
  const d = sb.data[g.id] || { spel: [], bok: [] };
  const me = ms.anvandare.uid;
  const r = rakna(g, d.spel, d.bok, state.historik);
  const omg = state.kupong?.omgang.id;

  // Översikt
  ut.push(el("section", { class: "kort ms-summa" },
    el("div", {}, el("span", { text: "Spelform" }), el("b", { text: SPELFORMER[g.spelform] })),
    el("div", {}, el("span", { text: "Insatser" }), el("b", { text: kr(r.insats) })),
    el("div", {}, el("span", { text: "Vinster" }), el("b", { text: kr(r.vinst) })),
    el("div", {}, el("span", { text: "Netto" }), el("b", { class: r.netto >= 0 ? "plus" : "minus", text: plusKr(r.netto) })),
    el("p", { class: "dampad liten", text: `${g.medlem_uids.length} ${g.medlem_uids.length === 1 ? "medlem" : "medlemmar"}.` +
      (g.spelform === "kassa" ? ` Kassör: ${g.medlemmar[g.kassor || g.skapare]?.namn}. I kassan: ${kr(r.kassa)}.` : "") })));

  // Den här veckan
  if (omg) {
    const veckans = d.spel.find((s) => s.omgang_id === omg);
    const spelare = g.spelform === "tur" ? turFor(g, omg) : g.kassor || g.skapare;
    const vem = spelare === me ? "Du" : g.medlemmar[spelare]?.namn || "—";
    ut.push(kort(el("h2", { text: `Den här veckan · omgång ${omg}` }),
      el("p", { text: `${vem} ${g.spelform === "tur" ? "spelar" : "lämnar in"} den här veckan. ` +
        (veckans ? `Inlämnat av ${veckans.sparad_av_namn}: ${FORSLAG[veckans.forslag]?.namn || veckans.forslag}, ${veckans.rader} rader (${kr(veckans.insats)}).`
          : "Inget inlämnat än.") }),
      !veckans && farSpara(g, me, omg) ? el("p", { class: "liten" }, "Välj rader på ", el("a", { href: "#kupong", text: "kupongen" }),
        ` och tryck på ”Jag lämnade in de här raderna” → ”För ${g.namn}”.`) : null));
  }

  // Medlemmar och saldon
  ut.push(el("h2", { class: "ms-rubrik", text: "Medlemmar och saldon" }));
  const lista = el("ul", { class: "saldolista" });
  for (const uid of g.medlem_uids) {
    const m = r.medlemmar[uid];
    lista.append(el("li", {},
      el("div", {}, el("b", { text: `${m.namn}${uid === me ? " (du)" : ""}` }),
        el("p", { class: "dampad liten", text: `Betalat ${kr(m.betalat)} · fått ${kr(m.mottaget)} · andel insatser ${kr(m.insats)} · andel vinster ${kr(m.vinst)}` })),
      el("b", { class: `saldo ${m.saldo > 0.5 ? "plus" : m.saldo < -0.5 ? "minus" : ""}`, text: plusKr(m.saldo) })));
  }
  ut.push(lista, el("p", { class: "forklaring-stat", text: g.spelform === "tur"
    ? "Plus = har pengar att få av de andra. Minus = ska betala till de andra (t.ex. dela ut en vinst man tagit emot)."
    : "Saldot är din del av kassan: det du betalat in minus din andel av insatserna plus din andel av vinsterna." }));

  // Spelen
  ut.push(el("h2", { class: "ms-rubrik", text: "Bolagets spel" }));
  if (!r.spel.length) ut.push(el("p", { class: "dampad", text: "Inga spel än." }));
  for (const { spel, resultat } of r.spel.slice(0, 12)) {
    const k = spelkort({ ...spel, agare: `g-${g.id}` }, resultat, { egen: false });
    k.querySelector(".spelkort-huvud p")?.append(` · ${spel.sparad_av_namn}`);
    if (spel.sparad_av === me || farBokfora(g, me)) {
      const b = el("button", { type: "button", class: "visa-bolag fara-text", text: "Ta bort" });
      b.addEventListener("click", async () => {
        if (b.dataset.steg !== "2") { b.dataset.steg = "2"; b.textContent = "Ja, ta bort bolagets spel"; return; }
        await konto.taBortGruppSpel(g.id, spel.omgang_id); delete sb.data[g.id]; oppnaSpelbolag();
      });
      k.querySelector(".spelkort-knappar")?.append(b);
    }
    ut.push(k);
  }

  ut.push(kassabokRuta(g, d.bok));
  ut.push(installningar(g));
  box.replaceChildren(...ut);
}

function kassabokRuta(g, bok) {
  const me = ms.anvandare.uid;
  const delar = [el("h2", { text: "Kassabok" })];
  if (farBokfora(g, me)) {
    const typ = el("select", { id: "kb-typ" }, ...Object.entries(POSTTYPER).map(([k, v]) => el("option", { value: k, text: v })));
    const vem = el("select", { id: "kb-vem" }, el("option", { value: "", text: g.spelform === "kassa" ? "Kassan" : "Ingen särskild" }),
      ...g.medlem_uids.map((u) => el("option", { value: u, text: g.medlemmar[u]?.namn })));
    const belopp = el("input", { type: "number", id: "kb-belopp", min: 1, step: 1, inputmode: "numeric", placeholder: "kr" });
    const text = el("input", { type: "text", id: "kb-text", maxlength: 80, placeholder: "t.ex. Swish oktober" });
    const datum = el("input", { type: "date", id: "kb-datum", value: new Date().toISOString().slice(0, 10) });
    const status = el("p", { class: "konto-status", "aria-live": "polite" });
    const hjalp = el("p", { class: "dampad liten" });
    const uppdateraHjalp = () => {
      hjalp.textContent = {
        inbetalning: "Medlemmen har betalat in till kassan eller kassören.",
        utbetalning: "Medlemmen har fått pengar utbetalda.",
        vinst: "En vinst utanför appen som delas lika. Välj vem som har pengarna, eller kassan.",
        insats: "Ett spel utanför appen som delas lika. Välj vem som betalade, eller kassan.",
      }[typ.value];
    };
    typ.addEventListener("change", uppdateraHjalp);
    uppdateraHjalp();
    const f = el("form", { class: "konto-form kb-form" },
      el("label", { for: "kb-typ", text: "Typ" }), typ, hjalp,
      el("label", { for: "kb-vem", text: "Medlem" }), vem,
      el("label", { for: "kb-belopp", text: "Belopp" }), belopp,
      el("label", { for: "kb-text", text: "Kommentar" }), text,
      el("label", { for: "kb-datum", text: "Datum" }), datum,
      el("button", { type: "submit", class: "knapp primar", text: "Lägg till" }), status);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const post = { typ: typ.value, uid: vem.value || null, belopp: Math.round(Number(belopp.value) * 100) / 100,
        text: text.value.trim(), datum: datum.value };
      const fel = valideraPost(post, g);
      if (fel) { status.textContent = fel; return; }
      try { await konto.laggTillPost(g, post); delete sb.data[g.id]; oppnaSpelbolag(); }
      catch (err) { status.textContent = `Det gick inte att spara: ${err.message}`; }
    });
    delar.push(f);
  } else {
    delar.push(el("p", { class: "dampad liten", text: "Skaparen och kassören för kassaboken. Vinster från appens spel räknas in automatiskt." }));
  }
  if (bok.length) {
    const lista = el("ul", { class: "kassabok" });
    for (const p of bok) {
      const rad = el("li", {},
        el("div", {}, el("b", { text: `${POSTTYPER[p.typ]}${p.uid ? ` · ${g.medlemmar[p.uid]?.namn || "tidigare medlem"}` : ""}` }),
          el("p", { class: "dampad liten", text: [p.datum, p.text].filter(Boolean).join(" · ") })),
        el("b", { class: "tal", text: kr(p.belopp) }));
      if (farBokfora(g, me)) {
        const b = el("button", { type: "button", class: "visa-bolag fara-text", text: sb.taBortPost === p.id ? "Ja, ta bort" : "Ta bort" });
        b.addEventListener("click", async () => {
          if (sb.taBortPost !== p.id) { sb.taBortPost = p.id; renderaSpelbolag($("spelbolag-innehall")); return; }
          sb.taBortPost = null;
          await konto.taBortPost(g.id, p.id); delete sb.data[g.id]; oppnaSpelbolag();
        });
        rad.append(b);
      }
      lista.append(rad);
    }
    delar.push(lista);
  } else {
    delar.push(el("p", { class: "dampad liten", text: "Inga poster än." }));
  }
  return kort(...delar);
}

function installningar(g) {
  const me = ms.anvandare.uid;
  const skapare = g.skapare === me;
  const delar = [el("h2", { text: "Inställningar" })];
  const status = el("p", { class: "konto-status", "aria-live": "polite" });
  const spara = async (falt) => {
    try { await konto.uppdateraGrupp(g.id, falt); Object.assign(g, falt); renderaSpelbolag($("spelbolag-innehall")); renderaTurInfo(); }
    catch (e) { status.textContent = `Det gick inte att spara: ${e.message}`; }
  };

  // Inbjudningslänk (alla medlemmar kan dela den; bara skaparen kan byta)
  const lank = `${location.origin}${location.pathname}#gamed-${g.kod}`;
  const kopiera = el("button", { type: "button", class: "knapp", text: "Kopiera länken" });
  kopiera.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(lank); kopiera.textContent = "Kopierad"; }
    catch { falt.select(); kopiera.textContent = "Markerad – kopiera själv"; }
  });
  const falt = el("input", { type: "text", id: "sb-lank", readonly: true, value: lank });
  delar.push(el("label", { for: "sb-lank", class: "sb-etikett", text: "Inbjudningslänk" }), falt,
    el("div", { class: "knapprad" }, kopiera, ...(skapare ? [(() => {
      const b = el("button", { type: "button", class: "knapp", text: "Byt länk" });
      b.addEventListener("click", async () => { try { g.kod = await konto.bytKod(g); renderaSpelbolag($("spelbolag-innehall")); } catch (e) { status.textContent = e.message; } });
      return b;
    })()] : [])),
    el("p", { class: "dampad liten", text: `Den som öppnar länken och loggar in kan gå med (högst ${MAX_MEDLEMMAR} medlemmar). ` +
      (skapare ? "Byt länk om den hamnat fel – den gamla slutar då fungera." : "") }));

  if (skapare) {
    const namn = el("input", { type: "text", id: "sb-nytt-namn", value: g.namn, maxlength: 60 });
    namn.addEventListener("change", () => namn.value.trim() && spara({ namn: namn.value.trim() }));
    const form = el("select", { id: "sb-ny-form" }, ...Object.entries(SPELFORMER).map(([k, v]) => {
      const o = el("option", { value: k, text: v }); o.selected = k === g.spelform; return o;
    }));
    form.addEventListener("change", () => spara({ spelform: form.value, kassor: form.value === "kassa" ? (g.kassor || me) : g.kassor }));
    delar.push(el("label", { for: "sb-nytt-namn", class: "sb-etikett", text: "Namn" }), namn,
      el("label", { for: "sb-ny-form", class: "sb-etikett", text: "Spelform" }), form);
    if (g.spelform === "kassa") {
      const kassor = el("select", { id: "sb-kassor" }, ...g.medlem_uids.map((u) => {
        const o = el("option", { value: u, text: g.medlemmar[u]?.namn }); o.selected = u === (g.kassor || g.skapare); return o;
      }));
      kassor.addEventListener("change", () => spara({ kassor: kassor.value }));
      delar.push(el("label", { for: "sb-kassor", class: "sb-etikett", text: "Kassör" }), kassor);
    } else {
      const omg = state.kupong?.omgang.id || g.tur_start;
      const ordning = el("ol", { class: "turordning" });
      g.turordning.forEach((u, i) => {
        const flytta = (steg) => {
          const ny = g.turordning.slice();
          [ny[i], ny[i + steg]] = [ny[i + steg], ny[i]];
          // Behåll vems tur det är den här veckan genom att räkna om startomgången
          const nu = turFor(g, omg);
          const index = ny.indexOf(nu);
          spara({ turordning: ny, tur_start: omg - index });
        };
        const upp = el("button", { type: "button", class: "visa-bolag", text: "↑", "aria-label": `Flytta upp ${g.medlemmar[u]?.namn}`, disabled: i === 0 });
        const ner = el("button", { type: "button", class: "visa-bolag", text: "↓", "aria-label": `Flytta ner ${g.medlemmar[u]?.namn}`, disabled: i === g.turordning.length - 1 });
        upp.addEventListener("click", () => flytta(-1));
        ner.addEventListener("click", () => flytta(1));
        const tur = turFor(g, omg) === u;
        ordning.append(el("li", {}, el("span", { text: `${g.medlemmar[u]?.namn}${tur ? " – spelar den här veckan" : ""}` }),
          el("span", {}, upp, ner)));
      });
      const borjar = el("button", { type: "button", class: "knapp", text: "Låt första i listan spela den här veckan" });
      borjar.addEventListener("click", () => spara({ tur_start: omg }));
      delar.push(el("p", { class: "sb-etikett", text: "Turordning" }), ordning, borjar);
    }
    // Ta bort medlemmar
    const andra = g.medlem_uids.filter((u) => u !== me);
    if (andra.length) {
      const lista = el("ul", { class: "delningar" }, ...andra.map((u) => {
        const b = el("button", { type: "button", class: "visa-bolag fara-text", text: "Ta bort" });
        b.addEventListener("click", async () => {
          if (b.dataset.steg !== "2") { b.dataset.steg = "2"; b.textContent = `Ja, ta bort ${g.medlemmar[u]?.namn}`; return; }
          try { await konto.taBortMedlem(g, u); sb.grupper = null; oppnaSpelbolag(); } catch (e) { status.textContent = e.message; }
        });
        return el("li", {}, el("span", { text: g.medlemmar[u]?.namn }), b);
      }));
      delar.push(el("p", { class: "sb-etikett", text: "Medlemmar" }), lista,
        el("p", { class: "dampad liten", text: "Den som tas bort finns kvar i kassabokens historik men slutar dela på nya spel." }));
    }
    const radera = el("button", { type: "button", class: "knapp fara", text: sb.radera ? "Ja, radera spelbolaget" : "Radera spelbolaget" });
    radera.addEventListener("click", async () => {
      if (!sb.radera) { sb.radera = true; renderaSpelbolag($("spelbolag-innehall")); return; }
      try { await konto.raderaGrupp(g); sb.radera = false; sb.grupper = null; sb.vald = null; oppnaSpelbolag(); }
      catch (e) { status.textContent = e.message; }
    });
    delar.push(el("div", { class: "knapprad" }, radera, ...(sb.radera ? [(() => {
      const b = el("button", { type: "button", class: "knapp", text: "Avbryt" });
      b.addEventListener("click", () => { sb.radera = false; renderaSpelbolag($("spelbolag-innehall")); });
      return b;
    })()] : [])),
      el("p", { class: "dampad liten", text: sb.radera ? "Alla bolagets spel och hela kassaboken tas bort för alla medlemmar. Det går inte att ångra." : "" }));
  } else {
    const lamna = el("button", { type: "button", class: "knapp fara", text: "Lämna spelbolaget" });
    lamna.addEventListener("click", async () => {
      if (lamna.dataset.steg !== "2") { lamna.dataset.steg = "2"; lamna.textContent = "Ja, lämna"; return; }
      try { await konto.lamnaGrupp(g); sb.grupper = null; sb.vald = null; oppnaSpelbolag(); renderaTurInfo(); }
      catch (e) { status.textContent = e.message; }
    });
    delar.push(el("div", { class: "knapprad" }, lamna));
  }
  delar.push(status);
  return kort(...delar);
}

// ---------- Lagnyheter ----------

function renderaNyheter() {
  const box = $("nyheter-innehall");
  if (!box) return;
  const k = state.kupong;
  if (!k) return;
  const matcher = k.matcher;
  const med = matcher.filter((m) => m.lagnytt).length;
  const delar = [el("p", { class: "nyheter-sammanfattning", text: med
    ? `Nyheter för ${med} av 13 matcher.`
    : "Inga lagnyheter än. De flesta förhandsartiklar publiceras torsdag–lördag." })];

  const fakta = (lag, n) => {
    const kol = el("div", { class: "nyhet-lag" }, el("b", { text: lag }));
    for (const x of n?.franvaro || []) {
      kol.append(el("p", { class: `franvaro ${x.status}` },
        `${x.status === "borta" ? "Saknas" : "Osäker"}: `, el(x.nyckelspelare ? "b" : "span", { text: x.spelare }),
        x.orsak ? el("span", { class: "dampad", text: ` (${x.orsak})` }) : null,
        el("span", { class: "kalla-tid", text: ` · ${KORTNAMN[x.kalla] || x.kalla}` })));
    }
    for (const x of n?.sammanhang || []) {
      kol.append(el("p", {}, x.text, el("span", { class: "kalla-tid", text: ` · ${KORTNAMN[x.kalla] || x.kalla}` })));
    }
    if (n?.tranarbyte) {
      kol.append(el("p", { text: `Ny tränare: ${n.tranarbyte.tilltradande} (${n.tranarbyte.tilltradde}), efter ${n.tranarbyte.avgaende}` }));
    }
    if (kol.children.length === 1) kol.append(el("p", { class: "dampad", text: "Inget nytt" }));
    return kol;
  };

  // Matcher med nyheter först, i kupongens ordning; resten samlas längst ner
  for (const m of [...matcher.filter((x) => x.lagnytt), ...matcher.filter((x) => !x.lagnytt)]) {
    const tid = m.avspark ? kortFmt.format(new Date(m.avspark)) : "";
    const kort = el("article", { class: `nyhet${m.lagnytt ? "" : " tom"}` },
      el("div", { class: "nyhet-huvud" },
        el("span", { class: "nr", text: String(m.nr) }),
        el("div", {}, el("h2", { text: `${m.hemmalag} – ${m.bortalag}` }),
          el("p", { class: "dampad liten", text: [m.liga, tid].filter(Boolean).join(" · ") }))));
    if (m.lagnytt) {
      kort.append(el("div", { class: "nyhet-lagen" }, fakta(m.hemmalag, m.lagnytt.hemma), fakta(m.bortalag, m.lagnytt.borta)));
    }
    if (m.tabell) kort.append(tabellBlock(m));
    if (m.lagkoll?.motivering) {
      kort.append(el("p", { class: "nyhet-lagkoll" }, el("b", { text: "Lagkoll: " }), m.lagkoll.motivering));
    }
    delar.push(kort);
  }
  box.replaceChildren(...delar);
}

// ---------- Lagkoll (skuggmodell) ----------

const RISKTEXT = { "låg": "Låg skrällrisk", medel: "Viss skrällrisk", "hög": "Hög skrällrisk" };
const FORMTEXT = { W: "vinst", D: "oavgjort", L: "förlust" };

function lagkollPanel(m) {
  const lk = m.lagkoll;
  const panel = el("section", { class: "lagkoll", "aria-label": "Lagkoll" });
  panel.append(el("div", { class: "lagkoll-huvud" },
    el("b", { text: "Lagkoll" }),
    el("span", { class: "lagkoll-etikett", text: "test · styr bara förslaget Lagkoll" })));
  panel.append(el("p", { class: `lagkoll-risk risk-${lk.skrallrisk === "hög" ? "hog" : lk.skrallrisk === "medel" ? "medel" : "lag"}` },
    el("span", { class: "jamf-markor", "aria-hidden": "true" }), RISKTEXT[lk.skrallrisk] || lk.skrallrisk));
  if (lk.motivering) panel.append(el("p", { class: "lagkoll-text", text: lk.motivering }));
  if (lk.faktorer?.length) panel.append(el("ul", { class: "lagkoll-faktorer" }, ...lk.faktorer.map((f) => el("li", { text: f }))));

  const lag = (namn, p) => {
    const kol = el("div", { class: "lagkoll-lag" }, el("b", { text: namn }));
    for (const x of p.franvaro || []) {
      kol.append(el("p", { class: `franvaro ${x.status}` },
        `${x.status === "borta" ? "Saknas" : "Osäker"}: `, el(x.nyckelspelare ? "b" : "span", { text: x.spelare }),
        x.orsak ? el("span", { class: "dampad", text: ` (${x.orsak})` }) : null));
    }
    if (p.tranarbyte) kol.append(el("p", { text: `Ny tränare: ${p.tranarbyte.tilltradande} (${p.tranarbyte.tilltradde})` }));
    if (kol.children.length === 1) kol.append(el("p", { class: "dampad", text: "Inga lagnyheter" }));
    return kol;
  };
  panel.append(el("div", { class: "lagkoll-lagen" }, lag(m.hemmalag, lk.hemma), lag(m.bortalag, lk.borta)));
  const kallor = [...new Set([...(lk.hemma.kallor || []), ...(lk.borta.kallor || [])])];
  panel.append(el("p", { class: "dampad liten", text:
    `Analyserad ${kortFmt.format(new Date(lk.tid))}${kallor.length ? ` · källor: ${kallor.join(", ")}` : ""}. ` +
    "Lagkoll utgår från oddsen och justerar efter lagnyheterna. Den mäts mot Oddsen på statistiksidan." }));
  return panel;
}

// ---------- serietabeller (externa länkar, öppnas i nytt fönster) ----------

const BBC = (slug) => `https://www.bbc.com/sport/football/${slug}/table`;
const SERIETABELLER = [
  // [land, ligor som Svenska Spel kan skriva dem, visningsnamn, url]
  ["England", ["Premier League"], "Premier League", BBC("premier-league")],
  ["England", ["Championship"], "Championship", BBC("championship")],
  ["England", ["League One"], "League One", BBC("league-one")],
  ["England", ["League Two"], "League Two", BBC("league-two")],
  ["Sverige", ["Allsvenskan"], "Allsvenskan", "https://allsvenskan.se/tabell"],
  ["Sverige", ["Superettan"], "Superettan", "https://superettan.se/tabell"],
  ["Norge", ["Eliteserien"], "Eliteserien", "https://www.eliteserien.no/tabell"],
  ["Skottland", ["Premiership"], "Skotska Premiership", BBC("scottish-premiership")],
  ["Tyskland", ["Bundesliga"], "Bundesliga", BBC("german-bundesliga")],
  ["Spanien", ["La Liga", "LaLiga"], "La Liga", BBC("spanish-la-liga")],
  ["Italien", ["Serie A"], "Serie A", BBC("italian-serie-a")],
  ["Frankrike", ["Ligue 1"], "Ligue 1", BBC("french-ligue-one")],
  ["Nederländerna", ["Eredivisie"], "Eredivisie", BBC("dutch-eredivisie")],
  ["Portugal", ["Primeira Liga"], "Primeira Liga", BBC("portuguese-primeira-liga")],
  ["Danmark", ["Superligan", "Superligaen"], "Superligaen", BBC("danish-superliga")],
  ["Belgien", ["Pro League"], "Pro League", BBC("belgian-pro-league")],
  ["USA", ["MLS"], "MLS", BBC("us-major-league")],
].map(([land, ligor, namn, url]) => ({ land, ligor: ligor.map((l) => l.toLowerCase()), namn, url }));

/** Tabellänk för en liga, eller null (cuper, landskamper och ligor vi saknar länk till). */
export function serietabell(land, liga) {
  const l = (liga || "").toLowerCase();
  return SERIETABELLER.find((t) => t.land === land && t.ligor.includes(l)) || null;
}

function extern(url, text) {
  return el("a", { href: url, target: "_blank", rel: "noopener noreferrer", class: "extern" }, text,
    el("span", { class: "sr-only", text: " (öppnas i nytt fönster)" }), el("span", { "aria-hidden": "true", text: " ↗" }));
}

function visaTabeller() {
  const box = $("tabeller-innehall");
  const veckans = [];
  for (const m of state.kupong?.matcher || []) {
    const t = serietabell(m.land, m.liga);
    if (t && !veckans.includes(t)) veckans.push(t);
  }
  const lista = (tabeller) => el("ul", { class: "tabellista" }, ...tabeller.map((t) => el("li", {}, extern(t.url, t.namn))));
  box.replaceChildren(
    ...(veckans.length ? [el("h2", { text: "Ligor på veckans kupong" }), lista(veckans)] : []),
    el("h2", { text: veckans.length ? "Övriga ligor" : "Ligor" }),
    lista(SERIETABELLER.filter((t) => !veckans.includes(t))),
  );
}

const MODELLNAMN = { "odds-v2": "Oddsen", "odds-v1": "Odds, oviktat snitt", "ensemble-v1": "Sammanvägd modell",
  "tips-v1": "Med experter" };
const pct = (x) => `${Math.round(x * 100)}\u00a0%`;
const dec = (x) => x.toFixed(3).replace(".", ",");

const ROLLNAMN = { alternativ: "eget förslag", skugga: "skuggmodell", referens: "jämförelse", arkiv: "äldre version" };
const procent2 = (x) => `${(x * 100).toFixed(2).replace(".", ",").replace("-", "−")}\u00a0%`;

/** Varje modell mot Oddsen, match för match (export.parvis). */
function renderaJamforelse(box, rader) {
  box.append(el("h3", { text: "Modellerna mot Oddsen" }));
  box.append(el("p", { class: "forklaring-stat", text:
    "Varje modell jämförs med Oddsen på exakt samma matcher. Måttet är hur väl sannolikheterna stämde " +
    "(log loss) – det är dem förslagen bygger på, inte bara om favoriten vann. En skillnad räknas först " +
    "när den är större än felmarginalen; annars kan den lika gärna vara slump." }));
  const lista = el("ul", { class: "jamforelse" });
  for (const r of rader) {
    const text = r.slutsats === "bättre" ? "Bättre än Oddsen" : r.slutsats === "sämre" ? "Sämre än Oddsen"
      : r.antal === 0 ? "Inga avgjorda matcher än" : r.slutsats === "för lite data" ? `För lite data än (${r.antal} av 100 matcher)`
        : "Ingen säker skillnad";
    const tal = r.slutsats === "för lite data" || r.felmarginal == null ? ""
      : ` · ${r.skillnad > 0 ? "+" : ""}${procent2(r.skillnad)} ± ${procent2(r.felmarginal)}`;
    lista.append(el("li", { class: `jamf ${r.slutsats.replaceAll(" ", "-")}` },
      el("div", { class: "jamf-huvud" }, el("b", { text: r.namn }),
        el("span", { class: "jamf-roll", text: ROLLNAMN[r.roll] || r.roll })),
      el("p", { class: "jamf-slutsats" }, el("span", { class: "jamf-markor", "aria-hidden": "true" }), text,
        el("span", { class: "dampad", text: tal })),
      el("p", { class: "dampad liten", text: r.antal === 0
        ? "Mäts automatiskt när matcherna den analyserat är spelade. Räkna med ett halvår innan det säger något."
        : `${r.antal.toLocaleString("sv-SE")} matcher${r.framat ? " sedan start" : ""} · favoriten rätt ${pct(r.traff)} ` +
          `(Oddsen ${pct(r.traff_odds)}) · Brier ${dec(r.brier)} (Oddsen ${dec(r.brier_odds)})` })));
  }
  box.append(lista);
}

const driftFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const timmarSedan = (iso) => (Date.now() - new Date(iso).getTime()) / 3_600_000;

/** Driftstatus på Om-sidan: en rad per del av pipelinen, med ✓ / ⚠ / ✕ och text (aldrig bara färg). */
function renderaDrift(k) {
  const lista = $("drift");
  if (!lista) return;
  const rader = [];
  const rad = (niva, rubrik, text) => rader.push(el("li", { class: `drift-${niva}` },
    el("span", { class: "drift-ikon", "aria-hidden": "true", text: { ok: "✓", varning: "!", fel: "✕", info: "–" }[niva] }),
    el("div", {}, el("b", { text: rubrik }), el("span", { class: "sr-only", text: { ok: " (fungerar)", varning: " (varning)", fel: " (fel)", info: "" }[niva] }),
      el("p", { text }))));
  const nar = (iso) => driftFmt.format(new Date(iso));

  // Senaste körning: schemat har som längst ~57 h mellan körningarna (måndag → onsdag)
  const h = timmarSedan(k.genererad);
  rad(h > 60 ? "fel" : "ok", "Senaste uppdatering", `${nar(k.genererad)}${h > 60 ? " – längre sedan än schemat säger. Pipelinen kan ha stannat." : ""}`);

  const o = k.drift?.odds;
  if (o) {
    const niva = o.kvar < 30 ? "fel" : o.kvar < 100 ? "varning" : "ok";
    rad(niva, "Odds från spelbolagen", `${o.kvar} av 500 krediter kvar den här månaden (${nar(o.tid)}).` +
      (o.kvar < 30 ? " Hämtningen är pausad till månadsskiftet – förslagen bygger då på Svenska Spels odds." : ""));
  } else {
    rad("info", "Odds från spelbolagen", "Ingen uppgift än.");
  }

  const ai = k.drift?.ai;
  if (!ai) {
    rad("info", "AI (tips, kommentarer, Lagkoll)", "Ingen körning med AI registrerad än.");
  } else if (!ai.konfigurerad) {
    rad("fel", "AI (tips, kommentarer, Lagkoll)", `Inte igång: ${ai.orsak}.`);
  } else {
    const tot = ai.lyckade + ai.misslyckade;
    const modeller = Object.entries(ai.modeller || {}).map(([m, n]) => `${m} ${n}`).join(", ");
    const niva = ai.lyckade === 0 ? "fel" : ai.misslyckade || ai.stoppad ? "varning" : "ok";
    rad(niva, "AI (tips, kommentarer, Lagkoll)",
      `${ai.lyckade} av ${tot} anrop lyckades ${nar(ai.tid)}${modeller ? ` (${modeller})` : ""}.` +
      (ai.stoppad ? ` Avbröts: ${ai.stoppad} – resten tas vid nästa körning.` : "") +
      (ai.lyckade === 0 ? " Googles AI svarade inte – försöker igen vid nästa körning." : ""));
  }

  const m = k.matcher || [];
  const tips = m.flatMap((x) => (x.tips || []).filter((t) => t.kalla !== "Tio tidningars tips"));
  const kallor = new Set(tips.map((t) => t.kalla));
  rad(tips.length ? "ok" : "info", "Tips från tipssajter",
    tips.length ? `${tips.length} tips från ${kallor.size} ${kallor.size === 1 ? "sajt" : "sajter"} på veckans kupong.`
      : "Inga än – de flesta sajter publicerar torsdag–lördag.");

  const komm = m.filter((x) => x.kommentar).length;
  rad(komm === 13 ? "ok" : komm ? "varning" : "info", "AI-kommentarer", `${komm} av 13 matcher har en kommentar.`);

  const lk = m.filter((x) => x.lagkoll).length;
  const timmarKvar = (new Date(k.omgang.spelstopp).getTime() - Date.now()) / 3_600_000;
  rad(lk ? "ok" : "info", "Lagkoll", lk ? `Har analyserat ${lk} av 13 matcher.`
    : timmarKvar > 36 ? "Analyserar från fredag kväll, när lagnyheterna kommit." : "Inga analyser än – det saknas lagnyheter i artiklarna.");

  const tab = m.filter((x) => x.tabell).length;
  rad(tab ? "ok" : "info", "Tabeller och form", `${tab} av 13 matcher har tabell${tab < 13 ? " (cuper och vissa ligor saknas)" : ""}.`);

  lista.replaceChildren(...rader);
}

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
  renderaDrift(k);
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

  if (blk.jamforelse?.length) renderaJamforelse(box, blk.jamforelse);
  if (blk.skrall) {
    const sk = blk.skrall;
    box.append(el("h3", { text: "Skrällchanserna" }));
    box.append(el("p", { text:
      `${sk.antal.toLocaleString("sv-SE")} skrällchanser i ${sk.omgangar} omgångar. De gick in i ${pct(sk.traff)} av fallen – ` +
      `oddsen sa ${pct(sk.chans)} och folket trodde bara ${pct(sk.folket)}. Därför betalar de bra när de går in.` }));
    box.append(el("p", { class: "forklaring-stat", text:
      "Skrällchans = ett tecken som inte är favorit, har minst 20 % chans och är understreckat (chansen 1,25–1,5 " +
      "gånger strecken). Högst tre per omgång. Förslaget Skrällchans tar med 1 av dem på system upp till 64 rader " +
      "och 2 på större – backtestet under Om du spelat varje vecka visar hur det hade gått." }));
  }

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
  tabeller: "Serietabeller", nyheter: "Lagnyheter", minaspel: "Mina spel", spelbolag: "Spelbolag", om: "Om guiden" };

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
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".meny-val")) stang(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !lista.hidden) { stang(); knapp.focus(); } });
}

function visaVy() {
  let namn = location.hash.slice(1);
  if (namn.startsWith("gamed-")) {         // inbjudningslänk till ett spelbolag
    sb.anslutKod = namn.slice(6);
    namn = "spelbolag";
  }
  const vy = VYER[namn] ? namn : "kupong";
  document.body.dataset.vy = vy;
  for (const s of document.querySelectorAll("main > .vy")) s.hidden = s.dataset.vy !== vy;
  for (const a of document.querySelectorAll("#meny-lista a")) {
    if (a.dataset.vy === vy) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  $("meny-aktuell").textContent = VYER[vy];
  if (vy === "backtest") oppnaBacktest();
  if (vy === "rattning") oppnaRattning();
  if (vy === "tabeller") visaTabeller();
  if (vy === "nyheter") renderaNyheter();
  if (vy === "minaspel") oppnaMinaSpel();
  if (vy === "spelbolag") oppnaSpelbolag();
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
  const res = optimeraForslag(k, state.kalla, state.rBudget, lasningar);
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
    box.append(el("p", { class: "dampad liten", text: (state.kalla !== "modell" ? `Förslaget ${FORSLAG[state.kalla].namn}. ` : "") +
      (Object.keys(lasningar).length ? "Med dina låsningar. " : "") +
      "Rättningen gäller systemet som appen föreslog – vi vet inte vad du faktiskt lämnade in." +
      (omgang.frusen ? ` ${fryst(omgang)}` : "") }));
  }
  renderaUtdelning(omgang, res.ok ? rattFordelning(res.val, k.matcher.map((m) => m.resultat || "?")) : null);
  ritaMatcher($("r-matcher"), { ...k, matcher: matcherEnligtKalla(k) }, res, lasningar, state.rOppna, false,
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
  try {
    // Historiken kan redan vara laddad av Mina spel eller Spelbolag – rita då direkt
    await laddaHistorik();
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
    .filter((a) => h.omgangar.filter((o) => o.datum.startsWith(a)).length >= 10).slice(1), "premiar"];
  if (!arLista.includes(state.btAr)) state.btAr = "alla";
  const allaAr = franAr(h, state.btAr);
  const harTipsHist = allaAr.omgangar.some((o) => o.matcher.some((m) => m[7]));
  // Lagkoll: bara omgångar där Lagkoll faktiskt analyserat något – annars vore det samma som Oddsen
  const urval = state.kalla === "lagkoll" ? medLagkoll(allaAr) : allaAr;

  const vaxel = el("div", { class: "forslag", role: "radiogroup", "aria-label": "Vilket förslag i backtestet" });
  for (const [k, { namn, under }] of Object.entries(FORSLAG)) {
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
  const premiarText = `Premiären var ${new Date(PREMIAR + "T12:00:00Z").toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric" })}. ` +
    "Från den dagen är det inte en simulering, utan förslagen som faktiskt visades före spelstopp.";
  if (!urval.omgangar.length) {
    box.append(el("p", { class: "dampad", text: state.kalla === "lagkoll" && allaAr.omgangar.length
      ? "Lagkoll har inga avgjorda omgångar än. Den analyserar från fredagen före spelstopp, och backtestet fylls på " +
        "vecka för vecka när resultaten kommer in."
      : `Inga avgjorda omgångar sedan premiären än. ${premiarText}` }));
    return;
  }
  if (state.btAr === "premiar") {
    box.append(el("p", { class: "premiar-not", text: premiarText +
      (urval.omgangar.length < 20 ? ` Med ${urval.omgangar.length} ${urval.omgangar.length === 1 ? "omgång" : "omgångar"} säger siffrorna ännu inget om hur bra förslagen är.` : "") }));
  }

  const forsta = urval.omgangar[0].datum, sista = urval.omgangar.at(-1).datum;
  box.append(el("p", { class: "dampad", text:
    `Förslaget ${FORSLAG[state.kalla].namn} spelat varje vecka i ${urval.omgangar.length} omgångar ` +
    `(${forsta} – ${sista}), jämfört med att spela samma antal rader efter folkets streck. Riktig utdelning för 13–10 rätt.` }));

  const knappar = el("div", { class: "budgetknappar", role: "radiogroup", "aria-label": "Rader per vecka" });
  for (const b of BUDGETAR) {
    const k = el("button", { type: "button", role: "radio", "aria-checked": String(b === state.btBudget), text: String(b) });
    k.addEventListener("click", () => { state.btBudget = b; renderaBacktest(); });
    knappar.append(k);
  }
  box.append(knappar);

  const serier = [
    { namn: FORSLAG[state.kalla].namn, klass: "s1", farg: "var(--serie-1)",
      res: backtesta(urval, state.btBudget, state.kalla) },
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
  box.append(storlekstabell(urval));

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

/** Samma förslag och period, alla systemstorlekar sida vid sida. */
function storlekstabell(urval) {
  const t = el("table", { class: "stat-tabell storlekar" },
    el("thead", {}, el("tr", {}, el("th", { text: "Rader" }), el("th", { class: "tal", text: "Insats" }),
      el("th", { class: "tal", text: "Tillbaka" }), el("th", { class: "tal", text: "13" }), el("th", { class: "tal", text: "12" }),
      el("th", { class: "tal", text: "11" }), el("th", { class: "tal", text: "10" }))));
  const b = el("tbody");
  for (const rader of BUDGETAR) {
    const r = backtesta(urval, rader, state.kalla);
    if (!r.insats) continue;
    b.append(el("tr", { class: rader === state.btBudget ? "aktiv" : "" },
      el("td", { text: String(rader) }), el("td", { class: "tal", text: kr(r.insats) }),
      el("td", { class: "tal", text: `${Math.round((100 * r.vinst) / r.insats)}\u00a0%` }),
      ...[13, 12, 11, 10].map((n) => el("td", { class: "tal", text: String(r.antal[n]) }))));
  }
  t.append(b);
  return el("div", {}, el("h3", { text: `Per systemstorlek (${FORSLAG[state.kalla].namn})` }),
    el("div", { class: "tabell-scroll" }, t),
    el("p", { class: "forklaring-stat", text: "Samma förslag och period med olika antal rader. Tillbaka = utdelning i procent " +
      "av insatsen. Kolumnerna 13–10 är antal rader med så många rätt. Enstaka 12- och 13-rättare styr mycket, så jämför " +
      "hellre storlekar med varandra än att läsa ut ett exakt facit." }));
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
  state.resultat = optimeraForslag(state.kupong, state.kalla, state.budget, state.lasningar);
  const info = forslagInfo(state.kupong, state.kalla, state.resultat);
  $("forslag-info").hidden = !info;
  $("forslag-info").textContent = info;
  state.skillnad = skillnadMotAndra(state.kupong, state.resultat, state.budget, state.lasningar);
  const sk = state.skillnad, skRad = $("skillnad");
  const nr = sk ? Object.keys(sk.skiljer) : [];
  skRad.hidden = !sk || (Boolean(info) && !nr.length);   // "samma som Oddsen" står redan i infon
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
