// Körs med: node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { farBokfora, farSpara, nyKod, rakna, turFor, valideraPost } from "../../docs/spelbolag.js";

const facit = ["1", "X", "2", "1", "1", "2", "X", "1", "2", "1", "X", "2", "1"];
const historik = { omgangar: [{ id: 100, utdelning: [100000, 900, 90, 30], matcher: facit.map((r) => [0, 0, 0, 0, 0, 0, r]) }] };

const grupp = (spelform, extra = {}) => ({
  id: "g", namn: "Fredagsgänget", spelform, skapare: "a", kassor: spelform === "kassa" ? "b" : null,
  medlemmar: { a: { namn: "Anna" }, b: { namn: "Bo" }, c: { namn: "Cia" } }, medlem_uids: ["a", "b", "c"],
  turordning: ["a", "b", "c"], tur_start: 100, ...extra,
});

// Spel med 12 rätt (sista matchen fel) = 900 kr, insats 90 kr
const spel = (sparad_av, omgang_id = 100) => {
  const tecken = facit.slice();
  tecken[12] = "2";
  return { omgang_id, rader: 90, insats: 90, tecken, forslag_tecken: tecken, sparad_av, deltagare: ["a", "b", "c"] };
};

test("turordning roterar per omgång, även bakåt", () => {
  const g = grupp("tur");
  assert.equal(turFor(g, 100), "a");
  assert.equal(turFor(g, 101), "b");
  assert.equal(turFor(g, 103), "a");
  assert.equal(turFor(g, 99), "c");
  assert.equal(turFor(grupp("kassa"), 100), null);
});

test("vem får spara och bokföra", () => {
  const t = grupp("tur");
  assert.ok(farSpara(t, "b", 101));
  assert.ok(!farSpara(t, "c", 101));
  assert.ok(farSpara(t, "a", 101));            // skaparen får alltid
  assert.ok(!farSpara(t, "x", 100));           // inte medlem
  const k = grupp("kassa");
  assert.ok(farSpara(k, "b", 100) && !farSpara(k, "c", 100));
  assert.ok(farBokfora(k, "a") && farBokfora(k, "b") && !farBokfora(k, "c"));
  assert.ok(!farBokfora(t, "b"));
});

test("kassamodell: inbetalningar, spel och vinst ger saldon som summerar till kassan", () => {
  const g = grupp("kassa");
  const bok = ["a", "b", "c"].map((uid) => ({ typ: "inbetalning", uid, belopp: 100 }));
  const r = rakna(g, [spel("b")], bok, historik);
  assert.equal(r.insats, 90);
  assert.equal(r.vinst, 900);
  assert.equal(r.netto, 810);
  assert.equal(r.kassa, 300 - 90 + 900);
  for (const uid of ["a", "b", "c"]) assert.equal(r.medlemmar[uid].saldo, 100 - 30 + 300);
  const summa = Object.values(r.medlemmar).reduce((s, m) => s + m.saldo, 0);
  assert.equal(Math.round(summa), r.kassa);
  // Utbetalning till Anna minskar hennes saldo och kassan lika mycket
  const r2 = rakna(g, [spel("b")], [...bok, { typ: "utbetalning", uid: "a", belopp: 370 }], historik);
  assert.equal(r2.medlemmar.a.saldo, 0);
  assert.equal(r2.kassa, 1110 - 370);
});

test("turordning: spelaren betalar insatsen och får vinsten – de andra är skyldiga sin del", () => {
  const g = grupp("tur");
  const r = rakna(g, [spel("a")], [], historik);
  assert.equal(r.kassa, 0);
  assert.equal(Math.round(r.medlemmar.a.saldo), 90 - 900 - 30 + 300);    // −540: Anna har 540 kr att dela ut
  assert.equal(Math.round(r.medlemmar.b.saldo), -30 + 300);              // +270
  const summa = Object.values(r.medlemmar).reduce((s, m) => s + m.saldo, 0);
  assert.equal(Math.round(summa), 0);
});

test("poster utanför appen och medlemmar som tillkom senare", () => {
  const g = grupp("tur");
  const bok = [{ typ: "vinst", uid: "c", belopp: 300, deltagare: ["b", "c"] },
    { typ: "insats", uid: null, belopp: 60, deltagare: ["a", "b", "c"] }];
  const r = rakna(g, [], bok, historik);
  assert.equal(r.medlemmar.a.vinst, 0);
  assert.equal(r.medlemmar.b.vinst, 150);
  assert.equal(r.medlemmar.c.mottaget, 300);
  assert.equal(r.medlemmar.a.insats, 20);
  assert.equal(r.insats, 60);
});

test("validering av poster och inbjudningskod", () => {
  const g = grupp("kassa");
  assert.equal(valideraPost({ typ: "inbetalning", uid: "a", belopp: 50 }, g), null);
  assert.match(valideraPost({ typ: "inbetalning", uid: null, belopp: 50 }, g), /medlem/);
  assert.match(valideraPost({ typ: "vinst", belopp: 0 }, g), /större än 0/);
  assert.match(valideraPost({ typ: "okänd", belopp: 5 }, g), /typ/);
  const k = nyKod();
  assert.match(k, /^[A-Za-z0-9]{20}$/);
  assert.notEqual(k, nyKod());
});
