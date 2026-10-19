// Körs med: node --test tests/js/*.test.mjs
// Röktest: laddar docs/index.html och docs/app.js i en liten DOM (minidom.mjs) med kupongen i omgångens
// alla lägen och kontrollerar att sidan ritas utan fel – även när man byter vy, låser tecken, öppnar
// matcher och byter förslag och budget. Fångar t.ex. att en hjälpfunktion saknas efter spelstopp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { $, felText, kupong, laddaApp } from "./appmiljo.mjs";

const VYER = ["kupong", "rattning", "statistik", "backtest", "hjalp", "tabeller", "nyheter", "minaspel", "spelbolag",
  "mer", "om", "gamed-okand", "finnsinte"];

const FALL = [
  { status: "oppen", statusText: "Öppen", banner: null },
  { status: "stangd", statusText: "Stängd", banner: /Spelstopp har passerat\..*Förslagen visas som de såg ut .*före spelstopp\./ },
  { status: "avgjord", statusText: "Avgjord", banner: /Omgången är avgjord\. Ditt system hade \d+ rätt.*Förslagen visas som/ },
  { status: "installd", statusText: "Inställd", banner: /inställd/ },
];

/** Klickar runt i kupongen: förslag, budgetar, låsningar och matchdetaljer. */
async function klickaRunt(miljo) {
  const d = miljo.document;
  for (const b of d.querySelectorAll(".forslag button")) if (!b.disabled) b.click();
  for (const b of d.querySelectorAll("#budgetknappar button")) b.click();
  d.querySelector('.forslag button[data-kalla="modell"]').click();
  d.querySelector(".ruta")?.click();          // lås ett tecken …
  d.querySelector(".ruta")?.click();          // … och lås upp igen
  for (const h of d.querySelectorAll("#matcher .match-huvud")) h.click();   // öppna alla matcher
  for (const flik of d.querySelectorAll("#matcher [role=tab], #matcher .flik, #matcher button[data-flik]")) flik.click();
  d.querySelector("#matcher .match-huvud")?.click();                      // stäng en igen
  $(miljo, "rensa").click();
  for (const { fn } of miljo.intervall) fn();                             // nedräkningen som körs varje minut
  await miljo.vanta();
}

for (const fall of FALL) {
  test(`appen ritas utan fel när omgången är ${fall.status}`, async () => {
    const miljo = await laddaApp(kupong(fall.status));
    try {
      assert.equal(felText(miljo), "");
      assert.match($(miljo, "rubrik").textContent, /^Stryktipset v\. \d+$/);
      assert.match($(miljo, "underrubrik").textContent, /Omgång 4974$/);
      assert.equal($(miljo, "status").textContent, fall.statusText);
      const banner = $(miljo, "banner");
      if (fall.banner) {
        assert.equal(banner.hidden, false);
        assert.match(banner.textContent, fall.banner);
      } else {
        assert.equal(banner.hidden, true);
      }
      assert.equal(miljo.document.querySelectorAll("#matcher .match-huvud").length, 13);

      await klickaRunt(miljo);
      assert.equal(felText(miljo), "");
      assert.match($(miljo, "rubrik").textContent, /^Stryktipset v\. \d+$/);

      for (const vy of VYER) {
        await miljo.navigera(`#${vy}`);
        assert.equal(felText(miljo), "", `vyn #${vy}`);
      }
      await miljo.navigera("#kupong");
      assert.equal(felText(miljo), "");
      assert.match($(miljo, "rubrik").textContent, /^Stryktipset v\. \d+$/);
    } finally {
      miljo.avsluta();
    }
  });
}

test("vald flik i matchdetaljen gäller alla matcher och är förval för nya", async () => {
  const miljo = await laddaApp(kupong("oppen"));
  try {
    const d = miljo.document;
    const huvud = (nr) => d.querySelector(`#matcher .match-huvud[data-nr="${nr}"]`);
    const valdFlik = (nr) => huvud(nr).closest(".match").querySelector('.detaljflikar [aria-selected="true"]')?.textContent;
    const flik = (nr, namn) => huvud(nr).closest(".match").querySelectorAll(".detaljflikar [role=tab]")
      .find((b) => b.textContent === namn);

    huvud(1).click();
    huvud(2).click();
    assert.equal(valdFlik(1), "Översikt");
    assert.equal(valdFlik(2), "Översikt");

    flik(1, "Lagen").click();                  // byte i en match …
    assert.equal(valdFlik(1), "Lagen");
    assert.equal(valdFlik(2), "Lagen");        // … slår igenom på de andra utfällda

    huvud(3).click();                          // ny match öppnas med samma flik
    assert.equal(valdFlik(3), "Lagen");

    flik(3, "Odds").click();
    assert.deepEqual([1, 2, 3].map(valdFlik), ["Odds", "Odds", "Odds"]);
    assert.equal(JSON.parse(localStorage.getItem("stryktipshjalpen")).detaljFlik, "odds");   // sparas till nästa besök
    assert.equal(felText(miljo), "");
  } finally {
    miljo.avsluta();
  }
});

test("appen faller tillbaka på exempelkupongen när kupong.json saknas", async () => {
  const miljo = await laddaApp(undefined);
  try {
    // Saknad kupong.json loggas med console.error först om även exemplet saknas – här ska inget fel finnas
    assert.equal(felText(miljo), "");
    assert.equal($(miljo, "status").textContent, "Exempel");
    assert.match($(miljo, "banner").textContent, /^Exempeldata/);
  } finally {
    miljo.avsluta();
  }
});
