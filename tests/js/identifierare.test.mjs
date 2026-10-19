// Körs med: node --test tests/js/*.test.mjs
// Statisk kontroll: alla namn som används i docs/*.js ska vara deklarerade, importerade eller globala.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { odefinierade } from "./identifierare.mjs";

const DOCS = new URL("../../docs/", import.meta.url);
const filer = readdirSync(DOCS).filter((f) => f.endsWith(".js"));

for (const fil of filer) {
  test(`${fil}: inga odefinierade namn`, () => {
    const fel = odefinierade(readFileSync(new URL(fil, DOCS), "utf8"));
    assert.deepEqual(fel.map((f) => `${f.namn} (rad ${f.rad})`), []);
  });
}

const namn = (kod) => odefinierade(kod).map((f) => f.namn);

test("kontrollen hittar ett namn som aldrig definierats (som fryst efter spelstopp)", () => {
  const kod = `
    const kortFmt = new Intl.DateTimeFormat("sv-SE");
    function renderaTopp(omgang) {
      return \`Spelstopp har passerat. \${fryst(omgang)}\`.trim();
    }`;
  assert.deepEqual(namn(kod), ["fryst"]);
});

test("kontrollen hittar odefinierade namn i vanliga lägen", () => {
  assert.deepEqual(namn("saknas();"), ["saknas"]);
  assert.deepEqual(namn("const a = { b: saknas };"), ["saknas"]);
  assert.deepEqual(namn("const a = { saknas };"), ["saknas"]);
  assert.deepEqual(namn("const f = (x) => x + saknas;"), ["saknas"]);
  assert.deepEqual(namn("if (x > 1) saknas.y = 2; let x = 0;"), ["saknas"]);
  assert.deepEqual(namn("const t = `a ${`b ${saknas}`}`;"), ["saknas"]);
  assert.deepEqual(namn("process.exit(1);"), ["process"]);   // finns i Node men inte i webbläsaren
});

test("kontrollen larmar inte för deklarerade, importerade och globala namn", () => {
  const kod = `
    import { a, b as c } from "./x.js";
    import * as konto from "./konto.js";
    const { d, e: f, g = a } = c, [h, ...i] = [];
    let j = 0, k = 1;
    function l(m, { n } = {}, o = 2) { return m + n + o; }
    class P { metod(q) { return q; } get r() { return 1; } static s(t) { return t; } }
    const u = async (v) => { try { await v; } catch (w) { return w; } };
    const x = y => y * 2;
    const z = { nyckel: 1, metod(aa) { return aa; }, [j]: k };
    for (const bb of [1]) console.log(bb, z.nyckel, konto.inloggad?.());
    const cc = /[/]x/g.test("a") ? 1 / 2 : 3;
    document.getElementById("rubrik").textContent = \`\${d}\${f}\${g}\${h}\${i}\${l}\${P}\${u}\${x}\${cc}\`;
    window.addEventListener("hashchange", () => location.reload());
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());`;
  assert.deepEqual(namn(kod), []);
});
