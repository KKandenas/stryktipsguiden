// Körs med: node --test tests/js/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUDGETAR, allaRader, antalRatt, faktorisera, normaliseraLasning, optimera, sammanfattning, skrallchanser,
  skrallKrav, skrallUnderlag, skrallarForBudget,
} from "../../docs/optimizer.js";

const exempel = JSON.parse(readFileSync(new URL("../../docs/exempel-kupong.json", import.meta.url), "utf8"));

function match(nr, c1, cx, c2, s1, sx, s2) {
  return { nr, chans: { 1: c1, X: cx, 2: c2 }, streck: { 1: s1, X: sx, 2: s2 } };
}

test("faktorisera alla budgetar", () => {
  assert.deepEqual(faktorisera(1), { halv: 0, hel: 0 });
  assert.deepEqual(faktorisera(32), { halv: 5, hel: 0 });
  assert.deepEqual(faktorisera(64), { halv: 6, hel: 0 });
  assert.deepEqual(faktorisera(96), { halv: 5, hel: 1 });
  assert.deepEqual(faktorisera(128), { halv: 7, hel: 0 });
  assert.deepEqual(faktorisera(192), { halv: 6, hel: 1 });
  assert.deepEqual(faktorisera(256), { halv: 8, hel: 0 });
  assert.deepEqual(faktorisera(16), { halv: 4, hel: 0 });
  assert.deepEqual(faktorisera(48), { halv: 4, hel: 1 });
  assert.deepEqual(faktorisera(144), { halv: 4, hel: 2 });
  assert.deepEqual(faktorisera(384), { halv: 7, hel: 1 });
  assert.deepEqual(faktorisera(576), { halv: 6, hel: 2 });
  assert.deepEqual(faktorisera(432), { halv: 4, hel: 3 });   // går fortfarande att bygga, men är inte ett val i appen
  assert.equal(faktorisera(100), null);
  assert.equal(faktorisera(0), null);
});

test("varje budget ger rätt antal garderingar och rader", () => {
  for (const b of BUDGETAR) {
    const r = optimera(exempel.matcher, b);
    assert.ok(r.ok, `budget ${b}`);
    const { halv, hel } = faktorisera(b);
    assert.equal(r.val.filter((v) => v.typ === "HALV").length, halv);
    assert.equal(r.val.filter((v) => v.typ === "HEL").length, hel);
    assert.equal(r.val.filter((v) => v.typ === "SPIK").length, 13 - halv - hel);
    assert.equal(allaRader(r.val).length, b);
  }
});

test("helgarderar den jämnaste matchen och spikar den säkraste", () => {
  const ms = [];
  for (let i = 1; i <= 13; i++) ms.push(match(i, 0.6, 0.22, 0.18, 60, 22, 18));
  ms[4] = match(5, 0.34, 0.33, 0.33, 34, 33, 33);   // jämnast
  ms[8] = match(9, 0.85, 0.10, 0.05, 85, 10, 5);    // säkrast
  const r = optimera(ms, 96);
  assert.equal(r.val[4].typ, "HEL");
  assert.equal(r.val[8].tecken, "1");
});

test("värde avgör vilka två tecken en halvgardering får", () => {
  const ms = [];
  for (let i = 1; i <= 13; i++) ms.push(match(i, 0.6, 0.22, 0.18, 60, 22, 18));
  // Lika chans på X och 2, men 2 är kraftigt understreckat → halvgardering 12 framför 1X
  ms[0] = match(1, 0.5, 0.25, 0.25, 70, 25, 5);
  const r = optimera(ms, 2 ** 1, {});   // 2 rader går inte i appen men visar principen
  assert.equal(r.val[0].tecken, "12");
});

test("låsningar respekteras och resten räknas om", () => {
  const r = optimera(exempel.matcher, 96, { 1: "X", 2: "x2" });
  assert.ok(r.ok);
  assert.equal(r.val[0].tecken, "X");
  assert.equal(r.val[0].last, true);
  assert.equal(r.val[1].tecken, "X2");
  assert.equal(r.val.filter((v) => v.typ === "HALV").length, 5);
});

test("omöjliga låsningar ger ett begripligt fel", () => {
  const r = optimera(exempel.matcher, 96, { 1: "1X2", 2: "1X2" });
  assert.equal(r.ok, false);
  assert.match(r.fel, /2 helgarderingar/);
  const r2 = optimera(exempel.matcher, 64, { 3: "1X2" });   // 64 rader har inga helgarderingar
  assert.equal(r2.ok, false);
});

test("normaliseraLasning", () => {
  assert.equal(normaliseraLasning("x2"), "X2");
  assert.equal(normaliseraLasning("21"), "12");
  assert.equal(normaliseraLasning(""), null);
  assert.equal(normaliseraLasning(undefined), null);
});

test("sammanfattning", () => {
  assert.equal(sammanfattning({ rader: 96, hel: 1, halv: 5, spik: 7 }), "96 rader · 96 kr — 1 hel · 5 halv · 7 spik");
  assert.equal(sammanfattning({ rader: 1, hel: 0, halv: 0, spik: 13 }), "1 rad · 1 kr — 13 spik");
});


test("alla rader i systemet är unika", () => {
  const r = optimera(exempel.matcher, 32);
  const rader = allaRader(r.val).map((x) => x.join(""));
  assert.equal(rader.length, 32);
  assert.equal(new Set(rader).size, 32);
});

test("antal rätt", () => {
  const val = [{ nr: 1, tecken: "1X" }, { nr: 2, tecken: "2" }, { nr: 3, tecken: "1X2" }];
  assert.equal(antalRatt(val, { 1: "X", 2: "1", 3: "2" }), 2);
});


test("skrällchanser: understreckade icke-favoriter med minst 20 % chans och kvot 1,25–1,5, högst tre", () => {
  const m = (nr, chans, streck) => ({ nr, chans: { 1: chans[0], X: chans[1], 2: chans[2] }, streck: { 1: streck[0], X: streck[1], 2: streck[2] } });
  const matcher = [
    m(1, [0.5, 0.25, 0.25], [70, 15, 15]),    // kvot 1,67 – för extremt, räknas inte
    m(2, [0.6, 0.25, 0.15], [60, 25, 15]),    // inget understreckat
    m(3, [0.45, 0.3, 0.25], [38, 21, 41]),    // X: kvot 1,43
    m(4, [0.7, 0.19, 0.11], [85, 5, 10]),     // X under 20 % chans – räknas inte
    m(5, [0.4, 0.3, 0.3], [30, 22, 48]),      // X: kvot 1,36
    m(6, [0.4, 0.28, 0.32], [33, 24, 43]),    // X: kvot 1,17 – under gränsen
    m(7, [0.5, 0.26, 0.24], [62, 18, 20]),    // X: 1,44
    m(8, [0.5, 0.26, 0.24], [60, 20, 20]),    // X: 1,30
  ];
  const s = skrallchanser(matcher);
  assert.deepEqual(Object.keys(s).map(Number).sort((a, b) => a - b), [3, 5, 7]);
  assert.equal(s[3].tecken, "X");
  assert.ok(Math.abs(s[3].kvot - 0.3 / 0.21) < 1e-9);
  assert.ok(!skrallchanser([m(1, [0.5, 0.25, 0.25], [70, 15, 15])])[1]);
});

test("förslaget Skrällchans: 1 skräll upp till 64 rader, 2 däröver, och raderna innehåller dem", () => {
  assert.equal(skrallarForBudget(1), 1);
  assert.equal(skrallarForBudget(64), 1);
  assert.equal(skrallarForBudget(96), 2);
  // Gör två matcher i exemplet till tydliga skrällchanser
  const matcher = exempel.matcher.map((m) => ({ ...m }));
  matcher[0] = { ...matcher[0], chans: { 1: 0.5, X: 0.25, 2: 0.25 }, streck: { 1: 68, X: 18, 2: 14 } };   // X 1,39
  matcher[5] = { ...matcher[5], chans: { 1: 0.55, X: 0.24, 2: 0.21 }, streck: { 1: 70, X: 15, 2: 15 } };   // 2 1,40
  const ett = skrallKrav(matcher, 32);
  assert.equal(Object.keys(ett).length, 1);
  const tva = skrallKrav(matcher, 192);
  assert.equal(Object.keys(tva).length, 2);
  for (const [budget, krav] of [[1, ett], [32, ett], [192, tva]]) {
    const r = optimera(matcher, budget, {}, undefined, krav);
    assert.ok(r.ok);
    for (const [nr, t] of Object.entries(krav)) {
      const v = r.val.find((x) => x.nr === Number(nr));
      assert.ok(v.tecken.includes(t), `match ${nr} ska innehålla ${t} vid ${budget} rader`);
      assert.equal(v.skrall, t);
    }
  }
  // En låst match får inget skrällkrav – låsningen gäller
  const nr = Number(Object.keys(ett)[0]);
  assert.ok(!skrallKrav(matcher, 32, { [nr]: "1" })[nr]);
});


test("skrällarna väljs ur Med experters chans där den finns", () => {
  const m = (nr, chans, streck, tips) => ({ nr, chans: { 1: chans[0], X: chans[1], 2: chans[2] },
    streck: { 1: streck[0], X: streck[1], 2: streck[2] }, chans_tips: tips ? { 1: tips[0], X: tips[1], 2: tips[2] } : null });
  // Enligt oddsen är X ingen skräll (kvot 1,1), men experterna tror mer på krysset (kvot 1,4)
  const matcher = [m(1, [0.5, 0.22, 0.28], [55, 20, 25], [0.45, 0.28, 0.27]),
    ...Array.from({ length: 12 }, (_, i) => m(i + 2, [0.7, 0.2, 0.1], [70, 20, 10]))];
  assert.deepEqual(skrallchanser(matcher), {});
  const underlag = skrallUnderlag(matcher);
  assert.equal(underlag[0].chans.X, 0.28);
  assert.equal(underlag[1], matcher[1]);                       // utan experter: oförändrad
  const krav = skrallKrav(matcher, 32, {}, underlag);
  assert.deepEqual(krav, { 1: "X" });
  const r = optimera(matcher, 32, {}, undefined, krav);
  assert.ok(r.val[0].tecken.includes("X"));
});
