// Körs med: node --test tests/js/*.test.mjs
// Röktest av Mina spel och Spelbolag med den lokala låtsasdatabasen (?demo-konto). Egen fil, eftersom
// konto.js bara läser adressen när modulen laddas och node --test kör varje fil i en egen process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { $, felText, kupong, laddaApp } from "./appmiljo.mjs";

const vy = (miljo, namn) => miljo.document.querySelector(`main > .vy[data-vy="${namn}"]`);
const knapp = (miljo, text) => miljo.document.querySelectorAll("button").find((b) => b.textContent === text);

test("Mina spel och Spelbolag fungerar i demoläget (?demo-konto)", async () => {
  const miljo = await laddaApp(kupong("oppen"), "?demo-konto");
  try {
    assert.equal(felText(miljo), "");

    // Utloggad: Mina spel ber en logga in
    await miljo.navigera("#minaspel");
    assert.match(vy(miljo, "minaspel").textContent, /Logga in/);

    // Logga in (demokontot) och spara kupongens rader
    knapp(miljo, "Logga in med Google").click();
    await miljo.vanta();
    assert.equal(felText(miljo), "");
    await miljo.navigera("#kupong");
    $(miljo, "spara-spel").click();
    await miljo.vanta();
    knapp(miljo, "Jag själv")?.click();
    await miljo.vanta();
    assert.equal(felText(miljo), "");

    for (const namn of ["minaspel", "spelbolag", "gamed-demokod", "kupong"]) {
      await miljo.navigera(`#${namn}`);
      assert.equal(felText(miljo), "", `vyn #${namn}`);
    }
    await miljo.navigera("#minaspel");
    assert.doesNotMatch(vy(miljo, "minaspel").textContent, /kunde inte/i);
    assert.match(vy(miljo, "minaspel").textContent, /Omgång 4974|v\. 41/);
    await miljo.navigera("#spelbolag");
    assert.match(vy(miljo, "spelbolag").textContent, /Exempelgänget/);
    await miljo.navigera("#kupong");
    assert.match($(miljo, "rubrik").textContent, /^Stryktipset v\. \d+$/);
  } finally {
    miljo.avsluta();
  }
});
