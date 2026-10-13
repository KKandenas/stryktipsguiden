// Körs med: node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  andraTecken, antalRader, normaliseraEpost, normaliseraTecken, ratta, sammanstall, skapaSpel, valideraSpel,
} from "../../docs/minaspel.js";

const facit = ["1", "X", "2", "1", "1", "2", "X", "1", "2", "1", "X", "2", "1"];
const omgang = { id: 100, datum: "2026-10-17", utdelning: [100000, 1000, 100, 10],
  matcher: facit.map((r) => [0.4, 0.3, 0.3, 40, 30, 30, r]) };

function spel(tecken, forslag = tecken) {
  return { omgang_id: 100, datum: "2026-10-17", forslag: "modell", rader: antalRader(tecken), insats: antalRader(tecken),
    tecken, forslag_tecken: forslag, matcher: facit.map((_, i) => `Lag ${i} – Lag ${i + 13}`) };
}

test("antal rader och validering", () => {
  assert.equal(antalRader(["1X", "1X2", ...Array(11).fill("1")]), 6);
  assert.equal(valideraSpel(spel(facit.slice())), null);
  assert.match(valideraSpel(spel(facit.slice(0, 12))), /13 matcher/);
  assert.match(valideraSpel(spel([...facit.slice(0, 12), ""])), /minst ett tecken/);
  assert.equal(normaliseraTecken("x2"), "X2");
  assert.equal(normaliseraTecken("2x1"), "1X2");
  assert.equal(normaliseraTecken(""), null);
});

test("skapa spel från appens resultat", () => {
  const kupong = { omgang: { id: 100, datum: "2026-10-17", spelstopp: "x", radpris: 1 },
    matcher: facit.map((_, i) => ({ hemmalag: `A${i}`, bortalag: `B${i}` })) };
  const val = facit.map((t) => ({ tecken: t }));
  val[0] = { tecken: "1X" };
  const s = skapaSpel({ kupong, forslag: "skrall", resultat: { ok: true, val }, forslagResultat: { ok: true, val: facit.map((t) => ({ tecken: t })) } });
  assert.equal(s.rader, 2);
  assert.equal(s.insats, 2);
  assert.equal(s.forslag_tecken[0], "1");
  assert.equal(s.matcher[0], "A0 – B0");
  assert.equal(s.grupp_id, null);
});

test("rättning: egna ändringar jämförs med förslaget", () => {
  const forslag = facit.slice();
  forslag[1] = "1";               // förslaget hade fel på match 2
  forslag[2] = "2";
  const egna = forslag.slice();
  egna[1] = "X";                  // egen ändring som gick in
  egna[2] = "1";                  // egen ändring som missade
  const r = ratta(spel(egna, forslag), omgang);
  assert.equal(r.basta, 12);
  assert.equal(r.forslag.basta, 12);
  assert.deepEqual(r.lyckade, [1]);
  assert.deepEqual(r.missade, [2]);
  assert.deepEqual(r.andrade, [1, 2]);
  assert.equal(r.vinst, 1000);
  assert.equal(ratta(spel(egna, forslag), null), null);
});

test("sammanställning och ändring i efterhand", () => {
  const ett = spel(facit.slice());
  const tva = { ...spel(facit.map(() => "1")), omgang_id: 101 };   // inte avgjord
  const s = sammanstall([tva, ett], { omgangar: [omgang] });
  assert.equal(s.antal, 2);
  assert.equal(s.rattade, 1);
  assert.equal(s.vinst, 100000);
  assert.equal(s.insats, 2);
  assert.equal(s.netto, 99998);
  assert.equal(s.rader[0].spel.omgang_id, 101);                     // nyast först
  const andrat = andraTecken(ett, 0, "1x2");
  assert.equal(andrat.tecken[0], "1X2");
  assert.equal(andrat.rader, 3);
  assert.equal(andrat.insats, 3);
  assert.equal(andraTecken(ett, 0, "").tecken[0], "1");             // ogiltigt → oförändrat
});

test("e-post för delning", () => {
  assert.equal(normaliseraEpost("  Van@Exempel.SE "), "van@exempel.se");
  assert.equal(normaliseraEpost("inte en adress"), null);
});
