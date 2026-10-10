// Körs med: node --test tests/js/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUDGETAR, allaRader, antalRatt, faktorisera, normaliseraLasning, optimera, raderTillFil, sammanfattning,
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
  assert.deepEqual(faktorisera(432), { halv: 4, hel: 3 });
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

test("filformat för egna rader", () => {
  const r = optimera(exempel.matcher, 32);
  const fil = raderTillFil(r.val);
  const rader = fil.split("\r\n");
  assert.equal(rader[0], "Stryktipset");
  assert.equal(rader.at(-1), "");                 // avslutande radbrytning
  assert.equal(rader.length, 1 + 32 + 1);
  for (const rad of rader.slice(1, -1)) assert.match(rad, /^E(,[1X2]){13}$/);
  assert.equal(new Set(rader.slice(1, -1)).size, 32); // inga dubbletter
});

test("antal rätt", () => {
  const val = [{ nr: 1, tecken: "1X" }, { nr: 2, tecken: "2" }, { nr: 3, tecken: "1X2" }];
  assert.equal(antalRatt(val, { 1: "X", 2: "1", 3: "2" }), 2);
});
