// Körs med: node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deltagarIds, farBokfora, farSpara, namnPa, nyKod, rakna, topplista, turFor, valideraGast, valideraPost,
} from "../../docs/spelbolag.js";

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

test("medlemmar utan konto delar som alla andra och kan ha turen", () => {
  const g = grupp("tur", { gaster: { gx: { namn: "Dan" }, gy: { namn: "Eva", borttagen: true } },
    turordning: ["a", "b", "c", "gx"] });
  assert.deepEqual(deltagarIds(g), ["a", "b", "c", "gx"]);
  assert.equal(namnPa(g, "gx"), "Dan");
  assert.equal(namnPa(g, "gy"), "Eva");                 // borttagen men finns kvar i historiken
  assert.equal(turFor(g, 103), "gx");
  assert.ok(farSpara(g, "a", 103));                     // skaparen sparar gästens vecka
  assert.ok(!farSpara(g, "b", 103));
  // Dan spelade (Anna sparade): Dan betalar insatsen och tar emot vinsten, fyra delar lika
  const s = { ...spel("a"), spelare: "gx", deltagare: deltagarIds(g) };
  const r = rakna(g, [s], [], historik);
  assert.equal(r.medlemmar.gx.betalat, 90);
  assert.equal(r.medlemmar.gx.mottaget, 900);
  assert.equal(r.medlemmar.b.insats, 22.5);
  assert.equal(r.spel[0].spelare, "gx");
  assert.ok(r.medlemmar.gx.gast);
  assert.equal(valideraPost({ typ: "inbetalning", uid: "gx", belopp: 50 }, g), null);
  assert.match(valideraPost({ typ: "vinst", belopp: 5, spelare: "zz" }, g), /spelade/);
  assert.match(valideraGast("dan", g), /redan/);
  assert.match(valideraGast(" ", g), /namn/);
  assert.equal(valideraGast("Fia", g), null);
});

test("en gäst som kopplas till ett konto tar med sig historiken", () => {
  const g = grupp("tur", { gaster: { gx: { namn: "Dan" } }, kopplingar: { gx: "c" } });
  assert.deepEqual(deltagarIds(g), ["a", "b", "c"]);
  const s = { ...spel("a"), spelare: "gx", deltagare: ["a", "b", "c", "gx"] };
  const r = rakna(g, [s], [], historik);
  assert.equal(r.medlemmar.gx, undefined);
  assert.equal(r.medlemmar.c.betalat, 90);
  assert.equal(r.medlemmar.a.insats, 30);               // gx och c är samma person – tre delar
  assert.equal(topplista(g, [s], [], historik)[0].id, "c");
});

test("topplistan räknar spelade veckor, insats, vinst och bästa resultat per spelare", () => {
  const g = grupp("tur", { gaster: { gx: { namn: "Dan" } } });
  const vinnare = { ...spel("a"), spelare: "b" };                       // 12 rätt, 900 kr
  const forlorare = { ...spel("a", 101), spelare: "a" };               // omgång 101 är inte avgjord
  const bok = [{ typ: "insats", belopp: 64, spelare: "gx" }, { typ: "vinst", belopp: 50, spelare: "gx" },
    { typ: "vinst", belopp: 1000 }];                                    // utan spelare: inte med i topplistan
  const t = topplista(g, [vinnare, forlorare], bok, historik);
  assert.deepEqual(t.map((x) => x.id), ["b", "gx", "a", "c"]);
  assert.deepEqual([t[0].veckor, t[0].insats, t[0].vinst, t[0].netto, t[0].basta], [1, 90, 900, 810, 12]);
  assert.deepEqual([t[1].veckor, t[1].insats, t[1].vinst, t[1].basta], [1, 64, 50, null]);
  assert.deepEqual([t[2].veckor, t[2].vinst, t[2].basta], [1, 0, null]);
  assert.equal(t[3].veckor, 0);
  // Utan spelare-fält räknas den som sparade
  assert.equal(topplista(grupp("kassa"), [spel("b")], [], historik)[0].id, "b");
});
