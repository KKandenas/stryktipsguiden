// Mina spel: ren logik utan DOM och utan Firebase – rättning, sammanställning och validering av sparade spel.
//
// Ett sparat spel är en ögonblicksbild av raderna man lämnade in:
//   { omgang_id, datum, spelstopp, forslag, rader, insats, tecken: [13 × "1"/"1X"/…], forslag_tecken: [13 × …],
//     matcher: [13 × "Hemma – Borta"], sparad, andrad }
// forslag_tecken är förslaget utan egna låsningar, så att man kan se vad ens egna ändringar gav.
// Resultatet räknas fram ur historik.json (facit och utdelning), så inget resultat behöver sparas.

import { rattFordelning } from "./backtest.js?v=20261014g";

export const TECKEN_GILTIGA = ["1", "X", "2", "1X", "12", "X2", "1X2"];
export const MAX_DELNINGAR = 20;

/** Normalisera ett tecken ("x2" → "X2"); null om ogiltigt. */
export function normaliseraTecken(t) {
  const n = ["1", "X", "2"].filter((x) => String(t || "").toUpperCase().includes(x)).join("");
  return TECKEN_GILTIGA.includes(n) ? n : null;
}

/** Antal rader för en uppsättning tecken. */
export const antalRader = (tecken) => tecken.reduce((p, t) => p * t.length, 1);

/** Kontrollera ett spel innan det sparas. Returnerar en felbeskrivning eller null. */
export function valideraSpel(spel) {
  if (!Number.isInteger(spel.omgang_id)) return "Omgången saknas.";
  if (!Array.isArray(spel.tecken) || spel.tecken.length !== 13) return "Spelet måste ha 13 matcher.";
  if (spel.tecken.some((t) => !TECKEN_GILTIGA.includes(t))) return "Varje match måste ha minst ett tecken.";
  if (antalRader(spel.tecken) > 20000) return "För många rader.";
  return null;
}

/** Skapa ett spel ur appens resultat (optimera) och förslaget utan låsningar. */
export function skapaSpel({ kupong, forslag, resultat, forslagResultat, nu = new Date().toISOString() }) {
  const tecken = resultat.val.map((v) => v.tecken);
  return {
    omgang_id: kupong.omgang.id,
    datum: kupong.omgang.datum,
    spelstopp: kupong.omgang.spelstopp,
    forslag,
    rader: antalRader(tecken),
    insats: antalRader(tecken) * (kupong.omgang.radpris || 1),
    tecken,
    forslag_tecken: forslagResultat?.ok ? forslagResultat.val.map((v) => v.tecken) : tecken,
    matcher: kupong.matcher.map((m) => `${m.hemmalag} – ${m.bortalag}`),
    sparad: nu,
    andrad: nu,
    grupp_id: null,   // förberett för spelbolag
  };
}

/** Byt tecken på en match och räkna om rader och insats. */
export function andraTecken(spel, index, tecken, nu = new Date().toISOString()) {
  const t = normaliseraTecken(tecken);
  if (!t) return spel;
  const ny = spel.tecken.slice();
  ny[index] = t;
  return { ...spel, tecken: ny, rader: antalRader(ny), insats: antalRader(ny) * (spel.insats / spel.rader || 1), andrad: nu };
}

/** Rätta ett spel mot en avgjord omgång i historiken. null om omgången inte är avgjord än. */
export function ratta(spel, omgang) {
  if (!omgang) return null;
  const facit = omgang.matcher.map((m) => m[6]);
  const utfall = (tecken) => {
    const f = rattFordelning(tecken.map((t) => ({ tecken: t })), facit);
    const vinst = [13, 12, 11, 10].reduce((s, k, i) => s + (f[k] || 0) * (omgang.utdelning[i] || 0), 0);
    return { basta: f.reduce((b, n, k) => (n > 0 ? k : b), 0), vinst, antal: { 13: f[13] || 0, 12: f[12] || 0, 11: f[11] || 0, 10: f[10] || 0 } };
  };
  const eget = utfall(spel.tecken);
  const forslag = utfall(spel.forslag_tecken || spel.tecken);
  const andrade = spel.tecken.map((t, i) => (t !== (spel.forslag_tecken || spel.tecken)[i] ? i : -1)).filter((i) => i >= 0);
  // Vilka egna ändringar som gick in: matcher där facit fanns i egna tecken men inte i förslagets
  const lyckade = andrade.filter((i) => spel.tecken[i].includes(facit[i]) && !(spel.forslag_tecken[i] || "").includes(facit[i]));
  const missade = andrade.filter((i) => !spel.tecken[i].includes(facit[i]) && (spel.forslag_tecken[i] || "").includes(facit[i]));
  return { ...eget, forslag, andrade, lyckade, missade, facit };
}

/** Summera en lista spel: insats, vinst, netto och hur förslaget utan ändringar hade gått. */
export function sammanstall(spelLista, historik) {
  const perId = new Map((historik?.omgangar || []).map((o) => [o.id, o]));
  const ut = { antal: 0, rattade: 0, insats: 0, vinst: 0, forslagVinst: 0, basta: 0, rader: [] };
  for (const spel of [...spelLista].sort((a, b) => b.omgang_id - a.omgang_id)) {
    const r = ratta(spel, perId.get(spel.omgang_id));
    ut.antal++;
    ut.insats += spel.insats;
    if (r) {
      ut.rattade++;
      ut.vinst += r.vinst;
      ut.forslagVinst += r.forslag.vinst;
      ut.basta = Math.max(ut.basta, r.basta);
    }
    ut.rader.push({ spel, resultat: r });
  }
  ut.netto = ut.vinst - ut.insats;
  return ut;
}

/** Rensa och kontrollera en e-postadress för delning. */
export function normaliseraEpost(e) {
  const s = String(e || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}
