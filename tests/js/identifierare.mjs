// Liten kontroll av odefinierade namn i appens JavaScript, utan beroenden (ungefär eslints no-undef).
//
// Koden delas upp i tokens (kommentarer, strängar, mallsträngar och reguljära uttryck hanteras), och sedan
// jämförs alla namn som används med alla namn som deklareras någonstans i filen: import, function, class,
// const/let/var (även destrukturering), parametrar, catch och metoder – plus webbläsarens globala namn.
// Kontrollen bryr sig inte om räckvidd: ett namn räknas som definierat om det deklareras var som helst i
// filen. Den missar alltså vissa fel, men larmar inte i onödan – och den fångar namn som aldrig har
// definierats alls (som fryst i renderaTopp, 18 oktober 2026).

const NYCKELORD = new Set(`break case catch class const continue debugger default delete do else export extends
  finally for function if import in instanceof let new return super switch this throw try typeof var void while
  with yield await true false null of async from as get set static`.split(/\s+/));

// Efter dessa kan ett "/" bara vara början på ett reguljärt uttryck, inte division
const FORE_REGEX = new Set(["return", "typeof", "case", "in", "of", "new", "delete", "void", "throw", "instanceof",
  "yield", "await", "else", "do"]);

// Webbläsarens globala namn som inte finns i Node. Språkets egna (Math, Promise, Intl …) tas från globalThis.
const WEBBLASARE = `window document location navigator localStorage sessionStorage history fetch URL URLSearchParams
  console setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame
  requestIdleCallback IntersectionObserver ResizeObserver MutationObserver matchMedia getComputedStyle scrollTo
  scrollBy alert confirm prompt open Image FileReader Blob File FormData HTMLElement Element Node Event CustomEvent
  KeyboardEvent PointerEvent devicePixelRatio innerWidth innerHeight screen CSS DOMParser Notification crypto
  performance caches indexedDB self top parent getSelection createImageBitmap OffscreenCanvas structuredClone
  queueMicrotask atob btoa TextEncoder TextDecoder AbortController Response Request Headers WebSocket Worker
  BroadcastChannel visualViewport undefined NaN Infinity globalThis`.split(/\s+/);
// Node-specifika globala namn: skulle krascha i webbläsaren och räknas därför inte som definierade
const BARA_NODE = new Set(["process", "Buffer", "global", "require", "module", "exports", "__dirname", "__filename",
  "setImmediate", "clearImmediate"]);
export const GLOBALA = new Set([...WEBBLASARE,
  ...Object.getOwnPropertyNames(globalThis).filter((n) => !BARA_NODE.has(n))]);

const ID_START = /[\p{L}$_]/u;
const ID_DEL = /[\p{L}\p{N}$_‌‍]/u;
const PUNKT = ["...", "?.", "=>", "===", "!==", "**=", "<<=", ">>=", ">>>=", "&&=", "||=", "??=", "==", "!=", "<=",
  ">=", "&&", "||", "??", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>>", ">>"]
  .sort((a, b) => b.length - a.length);

/**
 * Delar upp källkoden i tokens: {typ: "id"|"num"|"str"|"re"|"p", v, rad}. Uttrycken i mallsträngar
 * (`…${x}…`) läggs som egna tokenlistor i `inre`, så att även de kontrolleras.
 */
export function tokenisera(kod) {
  let i = 0, rad = 1;
  const inre = [];

  function lista(stoppVidKlammer) {
    const ut = [];
    let djup = 0;
    const sista = () => ut[ut.length - 1];
    const varde = () => {   // slutar förra token ett värde? Då är "/" division
      const s = sista();
      if (!s) return false;
      if (s.typ === "p") return s.v === ")" || s.v === "]" || s.v === "}";
      if (s.typ === "id") return !FORE_REGEX.has(s.v);
      return true;
    };
    while (i < kod.length) {
      const c = kod[i];
      if (c === "\n") { rad++; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (c === "/" && kod[i + 1] === "/") { while (i < kod.length && kod[i] !== "\n") i++; continue; }
      if (c === "/" && kod[i + 1] === "*") {
        const slut = kod.indexOf("*/", i + 2);
        if (slut < 0) throw new SyntaxError(`rad ${rad}: oavslutad kommentar`);
        rad += (kod.slice(i, slut).match(/\n/g) || []).length;
        i = slut + 2;
        continue;
      }
      if (c === "'" || c === '"') {
        const start = rad;
        i++;
        while (i < kod.length && kod[i] !== c) { if (kod[i] === "\\") i++; else if (kod[i] === "\n") rad++; i++; }
        if (i >= kod.length) throw new SyntaxError(`rad ${start}: oavslutad sträng`);
        i++;
        ut.push({ typ: "str", rad: start });
        continue;
      }
      if (c === "`") {
        const start = rad;
        i++;
        while (i < kod.length && kod[i] !== "`") {
          if (kod[i] === "\\") i += 2;
          else if (kod[i] === "$" && kod[i + 1] === "{") { i += 2; inre.push(lista(true)); }
          else { if (kod[i] === "\n") rad++; i++; }
        }
        if (i >= kod.length) throw new SyntaxError(`rad ${start}: oavslutad mallsträng`);
        i++;
        ut.push({ typ: "str", rad: start });
        continue;
      }
      if (c === "/" && !varde()) {
        const start = rad;
        let klass = false;
        i++;
        while (i < kod.length && (klass || kod[i] !== "/")) {
          if (kod[i] === "\n") throw new SyntaxError(`rad ${start}: oavslutat reguljärt uttryck`);
          if (kod[i] === "\\") i++;
          else if (kod[i] === "[") klass = true;
          else if (kod[i] === "]") klass = false;
          i++;
        }
        i++;
        while (i < kod.length && /[a-z]/.test(kod[i])) i++;
        ut.push({ typ: "re", rad: start });
        continue;
      }
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(kod[i + 1]))) {
        const s = i;
        while (i < kod.length && /[\w.]/.test(kod[i])) {
          if (/[eE]/.test(kod[i]) && /[+-]/.test(kod[i + 1]) && !/^0[xX]/.test(kod.slice(s, i))) i++;
          i++;
        }
        ut.push({ typ: "num", rad });
        continue;
      }
      if (ID_START.test(c) || c === "#" || c === "\\") {
        const privat = c === "#";
        let j = privat ? i + 1 : i;
        while (j < kod.length && ID_DEL.test(kod[j])) j++;
        ut.push({ typ: privat ? "priv" : "id", v: kod.slice(i, j), rad });
        i = j;
        continue;
      }
      if (c === "{") djup++;
      if (c === "}") {
        if (stoppVidKlammer && djup === 0) { i++; return ut; }
        djup--;
      }
      const p = PUNKT.find((x) => kod.startsWith(x, i)) || c;
      ut.push({ typ: "p", v: p, rad });
      i += p.length;
    }
    if (stoppVidKlammer) throw new SyntaxError("oavslutat ${ … } i mallsträng");
    return ut;
  }

  const huvud = lista(false);
  return [huvud, ...inre];
}

const ar = (t, v) => t && t.typ === "p" && t.v === v;
const id = (t) => t && t.typ === "id";

/** Index för den parentes/klammer som stänger den som öppnas på index i. */
function stangande(tok, i) {
  const par = { "(": ")", "[": "]", "{": "}" }[tok[i].v];
  let djup = 0;
  for (let j = i; j < tok.length; j++) {
    if (ar(tok[j], tok[i].v)) djup++;
    else if (ar(tok[j], par) && --djup === 0) return j;
  }
  return tok.length - 1;
}

/** Alla namn (id-tokens) mellan index a och b. */
const namnMellan = (tok, a, b) => tok.slice(a, b + 1).filter(id).map((t) => t.v);

/** Samlar deklarerade namn och använda namn ({namn, rad}) i en tokenlista. */
function analysera(tok, deklarerade, anvanda) {
  const hoppa = new Set();   // index för namn som är egenskaper, metodnamn o.d. – inte användningar
  // Destruktureringsmönster {a, b: c, d = x} eller [a, ...b] mellan index a och b. Nycklar (b:) är inga
  // användningar och standardvärden (= x) inga deklarationer.
  const monster = (a, b) => {
    for (let k = a + 1; k < b; k++) {
      if (!id(tok[k])) continue;
      if (ar(tok[k + 1], ":")) hoppa.add(k);
      else if (!ar(tok[k - 1], "=") && !ar(tok[k - 1], ".")) deklarerade.add(tok[k].v);
    }
  };
  for (let i = 0; i < tok.length; i++) {
    const t = tok[i], fore = tok[i - 1], efter = tok[i + 1];

    if (id(t) && t.v === "import" && !ar(efter, "(") && !ar(efter, ".")) {
      let j = i + 1;
      while (j < tok.length && tok[j].typ !== "str") j++;
      for (const n of namnMellan(tok, i + 1, j)) deklarerade.add(n);
      for (let k = i; k <= j; k++) hoppa.add(k);
      i = j;
      continue;
    }
    if (id(t) && (t.v === "function" || t.v === "class")) {
      let j = i + 1;
      if (ar(tok[j], "*")) j++;
      if (id(tok[j]) && !NYCKELORD.has(tok[j].v)) { deklarerade.add(tok[j].v); hoppa.add(j); j++; }
      if (t.v === "function" && ar(tok[j], "(")) for (const n of namnMellan(tok, j, stangande(tok, j))) deklarerade.add(n);
      continue;
    }
    if (id(t) && (t.v === "const" || t.v === "let" || t.v === "var")) {
      const n = tok[i + 1];
      if (id(n)) deklarerade.add(n.v);
      else if (ar(n, "{") || ar(n, "[")) monster(i + 1, stangande(tok, i + 1));
      continue;
    }
    // Destrukturering efter kommatecken eller som tilldelning: …, [a, b] = x
    if ((ar(t, "{") || ar(t, "[")) && (ar(fore, ",") || ar(fore, "("))) {
      const slut = stangande(tok, i);
      if (ar(tok[slut + 1], "=")) monster(i, slut);
    }
    // Fler deklarationer i samma sats (let a = 0, b = 0) och standardvärden för parametrar (f(a, b = 1))
    if (id(t) && (ar(fore, ",") || ar(fore, "(")) && ar(efter, "=")) deklarerade.add(t.v);
    // Parametrar: x => …, (a, {b}) => …, catch (e)
    if (id(t) && ar(efter, "=>")) deklarerade.add(t.v);
    if (ar(t, "(")) {
      const slut = stangande(tok, i);
      const pil = ar(tok[slut + 1], "=>");
      const fangst = id(fore) && fore.v === "catch";
      if (pil || fangst) for (const n of namnMellan(tok, i, slut)) deklarerade.add(n);
    }
    // Metod i klass eller objekt: namn(…) { … } – namnet är ingen användning, parametrarna är deklarationer
    if (id(t) && !NYCKELORD.has(t.v) && ar(efter, "(") && !ar(fore, ".")) {
      const slut = stangande(tok, i + 1);
      if (ar(tok[slut + 1], "{")) {
        for (const n of namnMellan(tok, i + 1, slut)) deklarerade.add(n);
        continue;
      }
    }

    if (!id(t) || NYCKELORD.has(t.v) || hoppa.has(i)) continue;
    if (ar(fore, ".") || ar(fore, "?.")) continue;                                   // egenskap: a.b
    if (ar(efter, ":") && (ar(fore, "{") || ar(fore, ","))) continue;               // nyckel: {b: 1}
    if (id(fore) && (fore.v === "break" || fore.v === "continue")) continue;        // etikett
    if (id(fore) && (fore.v === "get" || fore.v === "set" || fore.v === "static" || fore.v === "async")
      && ar(efter, "(")) continue;                                                    // get namn() { … }
    anvanda.push({ namn: t.v, rad: t.rad });
  }
}

/** Returnerar [{namn, rad}] för namn som används men aldrig deklareras, importeras eller är globala. */
export function odefinierade(kod, globala = GLOBALA) {
  const deklarerade = new Set();
  const anvanda = [];
  for (const tok of tokenisera(kod)) analysera(tok, deklarerade, anvanda);
  return anvanda.filter((a) => !deklarerade.has(a.namn) && !globala.has(a.namn));
}
