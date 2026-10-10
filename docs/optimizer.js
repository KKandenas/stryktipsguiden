// Radoptimering för Stryktipset. Ren logik utan DOM – körs både i webbläsaren och i `node --test`.
//
// Ett system med R rader består av h halvgarderingar och f helgarderingar där 2^h · 3^f = R.
// För varje budget finns exakt en sådan uppdelning, så det som optimeras är VILKA matcher som
// får vilken gardering och VILKA tecken som väljs.
//
// Poäng per match med tecknen S (summeras som logaritmer över matcherna):
//   (1 − λ) · log(Σ chans)          → sannolikheten att matchen sitter
// +      λ · log(Σ chans / streck)  → förväntad utdelning: understreckade tecken betalar mer
// Produkten över matcherna är (träffchans)^(1−λ) · (förväntad utdelning)^λ, och dynamisk
// programmering över (match, antal halv, antal hel) hittar den exakt bästa kombinationen.

export const BUDGETAR = [1, 32, 64, 96, 128, 192, 432];
export const LAMBDA = 0.3;          // risknivå: 0 = bara träffchans, 1 = bara utdelning. 0,3 valt efter backtest, se README
export const VARDE_GRANS = 0.03;    // orange prick från 3 procentenheter understreckat
export const TECKEN = ["1", "X", "2"];

const MIN_STRECK = 0.01;            // skydd mot division med ~0 för nästan ostreckade tecken
const ALLA_VAL = ["1", "X", "2", "1X", "12", "X2", "1X2"];

/** 96 → {halv: 5, hel: 1}. Null om antalet inte går att bygga av halv- och helgarderingar. */
export function faktorisera(rader) {
  if (!Number.isInteger(rader) || rader < 1) return null;
  let n = rader, halv = 0, hel = 0;
  while (n % 3 === 0) { n /= 3; hel++; }
  while (n % 2 === 0) { n /= 2; halv++; }
  return n === 1 && halv + hel <= 13 ? { halv, hel } : null;
}

export function typ(tecken) {
  return tecken.length === 3 ? "HEL" : tecken.length === 2 ? "HALV" : "SPIK";
}

/** Chans och streck som andelar för en match. Saknas streck antas de vara lika med chansen. */
function sannolikheter(match) {
  const c = match.chans || { 1: 1 / 3, X: 1 / 3, 2: 1 / 3 };
  const chans = TECKEN.map((t) => Math.max(c[t], 1e-6));
  let streck;
  if (match.streck) {
    const s = TECKEN.map((t) => match.streck[t]);
    const summa = s.reduce((a, b) => a + b, 0) || 1;
    streck = s.map((x) => Math.max(x / summa, MIN_STRECK));
  } else {
    streck = chans.slice();
  }
  return { chans, streck };
}

export function poang(match, tecken, lambda = LAMBDA) {
  const { chans, streck } = sannolikheter(match);
  let p = 0, v = 0;
  for (const t of tecken) {
    const i = TECKEN.indexOf(t);
    p += chans[i];
    v += chans[i] / streck[i];
  }
  return (1 - lambda) * Math.log(p) + lambda * Math.log(v);
}

/** Normalisera en låsning ("x2" → "X2") eller returnera null om den är ogiltig. */
export function normaliseraLasning(s) {
  if (!s) return null;
  const t = TECKEN.filter((x) => s.toUpperCase().includes(x)).join("");
  return t || null;
}

/**
 * @param matcher   13 matcher från kupong.json ({nr, chans, streck})
 * @param rader     budget, t.ex. 96
 * @param lasningar {matchnr: "1X"} – tecken som användaren låst
 * @returns {ok: true, val: [{nr, tecken, typ, last}], halv, hel, spik, rader}
 *        | {ok: false, fel: "text"}
 */
export function optimera(matcher, rader, lasningar = {}, lambda = LAMBDA) {
  const mal = faktorisera(rader);
  if (!mal) return { ok: false, fel: `${rader} rader går inte att bygga med halv- och helgarderingar.` };
  if (matcher.length !== 13) return { ok: false, fel: `Kupongen har ${matcher.length} matcher, väntade 13.` };

  const H = mal.halv, F = mal.hel;
  const NEG = -Infinity;
  // basta[h][f] = bästa poäng hittills med h halv och f hel
  let basta = Array.from({ length: H + 1 }, () => new Array(F + 1).fill(NEG));
  basta[0][0] = 0;
  const spar = []; // spar[i][h][f] = {val, fh, ff} för att kunna gå baklänges

  matcher.forEach((m) => {
    const last = normaliseraLasning(lasningar[m.nr]);
    const alternativ = (last ? [last] : ALLA_VAL).map((t) => ({
      t, dh: t.length === 2 ? 1 : 0, df: t.length === 3 ? 1 : 0, p: poang(m, t, lambda),
    }));
    const ny = Array.from({ length: H + 1 }, () => new Array(F + 1).fill(NEG));
    const steg = Array.from({ length: H + 1 }, () => new Array(F + 1).fill(null));
    for (let h = 0; h <= H; h++) {
      for (let f = 0; f <= F; f++) {
        if (basta[h][f] === NEG) continue;
        for (const a of alternativ) {
          const nh = h + a.dh, nf = f + a.df;
          if (nh > H || nf > F) continue;
          const v = basta[h][f] + a.p;
          if (v > ny[nh][nf]) { ny[nh][nf] = v; steg[nh][nf] = { t: a.t, fh: h, ff: f }; }
        }
      }
    }
    spar.push(steg);
    basta = ny;
  });

  if (basta[H][F] === NEG) return { ok: false, fel: lasningsfel(matcher, lasningar, H, F) };

  const val = new Array(matcher.length);
  let h = H, f = F;
  for (let i = matcher.length - 1; i >= 0; i--) {
    const s = spar[i][h][f];
    const m = matcher[i];
    val[i] = { nr: m.nr, tecken: s.t, typ: typ(s.t), last: Boolean(normaliseraLasning(lasningar[m.nr])) };
    h = s.fh; f = s.ff;
  }
  return { ok: true, val, halv: H, hel: F, spik: 13 - H - F, rader };
}

function lasningsfel(matcher, lasningar, H, F) {
  let halv = 0, hel = 0;
  for (const m of matcher) {
    const t = normaliseraLasning(lasningar[m.nr]);
    if (t && t.length === 2) halv++;
    if (t && t.length === 3) hel++;
  }
  const delar = [];
  if (hel > F) delar.push(`${hel} helgarderingar (budgeten har ${F})`);
  if (halv > H) delar.push(`${halv} halvgarderingar (budgeten har ${H})`);
  return delar.length
    ? `Dina låsningar kräver ${delar.join(" och ")}. Välj fler rader eller lås upp något.`
    : "Dina låsningar går inte ihop med den här budgeten. Välj en annan budget eller lås upp något.";
}

/** "96 rader · 96 kr — 1 hel · 5 halv · 7 spik" */
export function sammanfattning(res, radpris = 1) {
  const delar = [];
  if (res.hel) delar.push(`${res.hel} hel`);
  if (res.halv) delar.push(`${res.halv} halv`);
  if (res.spik) delar.push(`${res.spik} spik`);
  const ord = res.rader === 1 ? "rad" : "rader";
  return `${res.rader} ${ord} · ${res.rader * radpris} kr — ${delar.join(" · ")}`;
}

/** Alla enkelrader i systemet, t.ex. [["1","X",...], ...]. */
export function allaRader(val) {
  let rader = [[]];
  for (const v of val) {
    const nya = [];
    for (const r of rader) for (const t of v.tecken) nya.push([...r, t]);
    rader = nya;
  }
  return rader;
}

/**
 * Textfil för uppladdning som "egna rader" hos Svenska Spel: produktnamn på första raden,
 * sedan en enkelrad per rad som "E,1,X,2,..." (13 tecken). Radslut CRLF.
 */
export function raderTillFil(val, produkt = "Stryktipset") {
  const rader = allaRader(val).map((r) => "E," + r.join(","));
  return [produkt, ...rader].join("\r\n") + "\r\n";
}

/** Antal rätt för den bästa raden i systemet (matcher där utfallet finns bland valda tecken). */
export function antalRatt(val, resultat) {
  let n = 0;
  for (const v of val) if (resultat[v.nr] && v.tecken.includes(resultat[v.nr])) n++;
  return n;
}
