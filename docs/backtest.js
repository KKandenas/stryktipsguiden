// Backtest: "vad hade hänt om man spelat X rader varje vecka?" Ren logik utan DOM.
//
// Varje historisk omgång körs genom exakt samma optimerare som appen använder (optimizer.js),
// utan låsningar. Vinsten räknas med Svenska Spels faktiska utdelning per rad för 13–10 rätt.
// Antagande: våra rader hade inte påverkat potten (vi är en droppe i omsättningen).

import { allaRader, optimera } from "./optimizer.js?v=20261011r";

/** Matcher i optimerarens format. kalla "modell": modellens chans och folkets streck.
 *  kalla "tips": den tipsviktade chansen (fält 8) där den finns, annars modellens.
 *  kalla "folket": strecken används som chans – då väljs rent efter vad folket tror. */
export function matcherFor(omgang, kalla = "modell") {
  return omgang.matcher.map((m, i) => {
    const streck = { 1: m[3], X: m[4], 2: m[5] };
    const summa = m[3] + m[4] + m[5] || 1;
    let chans = { 1: m[0], X: m[1], 2: m[2] };
    if (kalla === "folket") chans = { 1: m[3] / summa, X: m[4] / summa, 2: m[5] / summa };
    else if (kalla === "tips" && m[7]) chans = { 1: m[7][0], X: m[7][1], 2: m[7][2] };
    return { nr: i + 1, chans, streck };
  });
}

/** Historiken från och med ett startår ("alla" = allt). */
export function franAr(historik, ar) {
  return ar === "alla" ? historik : { ...historik, omgangar: historik.omgangar.filter((o) => o.datum >= `${ar}-01-01`) };
}

/** Antal rader i systemet med k rätt, k = 0..13 (utan att räkna upp alla rader). */
export function rattFordelning(val, facit) {
  let poly = [1];
  val.forEach((v, i) => {
    const traff = v.tecken.includes(facit[i]) ? 1 : 0;
    const miss = v.tecken.length - traff;
    const ny = new Array(poly.length + 1).fill(0);
    poly.forEach((n, k) => { ny[k] += n * miss; ny[k + 1] += n * traff; });
    poly = ny;
  });
  return poly;
}

/**
 * @param historik  innehållet i historik.json
 * @param rader     budget per vecka, t.ex. 64
 * @param kalla     "modell" eller "folket"
 * @returns {omgangar: [{id, datum, insats, vinst, basta, antal}], insats, vinst, antal: {13,12,11,10}}
 */
export function backtesta(historik, rader, kalla = "modell") {
  const ut = { omgangar: [], insats: 0, vinst: 0, antal: { 13: 0, 12: 0, 11: 0, 10: 0 } };
  for (const o of historik.omgangar) {
    const res = optimera(matcherFor(o, kalla), rader);
    if (!res.ok) continue;
    const facit = o.matcher.map((m) => m[6]);
    const fordelning = rattFordelning(res.val, facit);
    const antal = {};
    let vinst = 0;
    [13, 12, 11, 10].forEach((k, i) => {
      antal[k] = fordelning[k] || 0;
      vinst += antal[k] * (o.utdelning[i] || 0);
      ut.antal[k] += antal[k];
    });
    const basta = fordelning.reduce((b, n, k) => (n > 0 ? k : b), 0);
    ut.omgangar.push({ id: o.id, datum: o.datum, insats: rader, vinst, basta, antal });
    ut.insats += rader;
    ut.vinst += vinst;
  }
  return ut;
}

/** Kontroll i tester: räkna samma sak genom att faktiskt rätta varje rad. */
export function rattaRader(val, facit) {
  return allaRader(val).map((rad) => rad.reduce((n, t, i) => n + (t === facit[i] ? 1 : 0), 0));
}
