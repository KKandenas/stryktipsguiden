// Körs med: node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { backtesta, matcherFor, medLagkoll, rattFordelning, rattaRader } from "../../docs/backtest.js";
import { optimera } from "../../docs/optimizer.js";

// Syntetisk omgång: [chans1, chansX, chans2, streck1, streckX, streck2, resultat]
function omgang(id, resultat, utdelning = [100000, 1000, 100, 10]) {
  const matcher = resultat.map((r, i) => (i % 3 === 0
    ? [0.6, 0.25, 0.15, 70, 20, 10, r]
    : i % 3 === 1 ? [0.36, 0.30, 0.34, 40, 30, 30, r] : [0.2, 0.25, 0.55, 15, 20, 65, r]));
  return { id, datum: `2025-01-${String(id % 28 + 1).padStart(2, "0")}`, utdelning, matcher };
}

test("snabb rätt-fördelning stämmer med att rätta varje rad", () => {
  const o = omgang(1, ["1", "X", "2", "X", "1", "1", "2", "2", "X", "1", "2", "1", "X"]);
  const res = optimera(matcherFor(o), 432);
  const facit = o.matcher.map((m) => m[6]);
  const fordelning = rattFordelning(res.val, facit);
  const raknat = new Array(14).fill(0);
  for (const n of rattaRader(res.val, facit)) raknat[n]++;
  assert.deepEqual(fordelning, raknat);
  assert.equal(fordelning.reduce((a, b) => a + b, 0), 432);
});

test("vinst räknas med utdelningen per rad", () => {
  // Alla favoriter går in → spiken på varje match sitter
  const o = omgang(2, Array.from({ length: 13 }, (_, i) => (i % 3 === 0 ? "1" : i % 3 === 1 ? "1" : "2")));
  const h = { omgangar: [o] };
  const r = backtesta(h, 1, "folket");
  assert.equal(r.insats, 1);
  // Folkets enkelrad = mest streckat tecken på varje match = facit → 13 rätt
  assert.equal(r.omgangar[0].basta, 13);
  assert.equal(r.antal[13], 1);
  assert.equal(r.vinst, 100000);
});

test("modell och folket kan välja olika och totalsummor stämmer", () => {
  const h = { omgangar: [1, 2, 3, 4].map((id) => omgang(id, Array.from({ length: 13 }, (_, i) => "1X2"[(i + id) % 3]))) };
  for (const kalla of ["modell", "folket"]) {
    const r = backtesta(h, 64, kalla);
    assert.equal(r.omgangar.length, 4);
    assert.equal(r.insats, 4 * 64);
    assert.equal(r.vinst, r.omgangar.reduce((a, o) => a + o.vinst, 0));
    for (const o of r.omgangar) assert.ok(o.basta >= 0 && o.basta <= 13);
  }
});

test("matcherFor: folket använder strecken som chans", () => {
  const o = omgang(5, Array(13).fill("1"));
  const m = matcherFor(o, "folket")[0];
  assert.ok(Math.abs(m.chans[1] - 0.7) < 1e-9);
  assert.deepEqual(m.streck, { 1: 70, X: 20, 2: 10 });
  assert.equal(matcherFor(o, "modell")[0].chans[1], 0.6);
});


test("backtest av Skrällchans och Lagkoll", () => {
  const facit = ["1", "X", "2", "1", "1", "2", "X", "1", "2", "1", "X", "2", "1"];
  const o = omgang(1, facit);
  // Match 2: understreckat kryss → skrällchans
  o.matcher[1] = [0.5, 0.28, 0.22, 66, 20, 14, "X"];
  const h = { omgangar: [o] };
  const skrall = backtesta(h, 32, "skrall");
  assert.equal(skrall.omgangar.length, 1);
  // Lagkoll: inga analyser → inga omgångar; med analys används fält 9
  assert.equal(medLagkoll(h).omgangar.length, 0);
  o.matcher[0] = [...o.matcher[0].slice(0, 7), null, [0.2, 0.3, 0.5]];
  assert.equal(medLagkoll(h).omgangar.length, 1);
  assert.deepEqual(matcherFor(o, "lagkoll")[0].chans, { 1: 0.2, X: 0.3, 2: 0.5 });
  assert.deepEqual(matcherFor(o, "lagkoll")[1].chans, { 1: 0.5, X: 0.28, 2: 0.22 });
  assert.equal(skrall.omgangar[0].insats, 32);
});
