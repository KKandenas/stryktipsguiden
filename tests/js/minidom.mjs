// En liten DOM för att köra docs/app.js i Node utan beroenden (används av app.test.mjs).
//
// Den räcker för det appen gör: läsa in index.html, bygga element, sätta attribut/text, söka med enkla
// CSS-selektorer och skicka händelser. Inget ritas och ingen layout räknas ut. Saknas något som appen
// börjar använda kastar det i testet (t.ex. "x is not a function") – lägg då till det här.

const TOMMA = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAATEXT = new Set(["script", "style", "textarea", "title"]);
const ENTITETER = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", shy: "­", ndash: "–",
  mdash: "—", hellip: "…", rarr: "→", larr: "←", times: "×", middot: "·", copy: "©" };
const BOOL_ATTR = ["hidden", "disabled", "checked", "selected", "open", "required", "readOnly", "multiple", "autofocus"];
const STR_ATTR = ["type", "href", "src", "alt", "title", "name", "placeholder", "role", "lang", "target", "rel",
  "autocomplete", "inputMode", "pattern", "min", "max", "step", "download", "htmlFor", "colSpan"];
const attrNamn = (p) => ({ htmlFor: "for", readOnly: "readonly", inputMode: "inputmode", colSpan: "colspan" }[p] || p);

const avkoda = (s) => s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (hel, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITETER[e] ?? hel;
});
const koda = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- händelser ----------

export class Event {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.detail = init.detail ?? null;
    Object.assign(this, init);
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this._stopp = false;
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._stopp = true; }
  stopImmediatePropagation() { this._stopp = true; this._direkt = true; }
}
export class CustomEvent extends Event {}

export class EventTarget {
  constructor() { this._lyssnare = new Map(); }
  addEventListener(typ, fn, opt) {
    if (!fn) return;
    if (!this._lyssnare.has(typ)) this._lyssnare.set(typ, []);
    const lista = this._lyssnare.get(typ);
    if (!lista.some((l) => l.fn === fn)) lista.push({ fn, once: typeof opt === "object" && opt?.once });
  }
  removeEventListener(typ, fn) {
    const lista = this._lyssnare.get(typ);
    if (lista) this._lyssnare.set(typ, lista.filter((l) => l.fn !== fn));
  }
  _kor(ev) {
    ev.currentTarget = this;
    for (const l of [...(this._lyssnare.get(ev.type) || [])]) {
      if (l.once) this.removeEventListener(ev.type, l.fn);
      try {
        typeof l.fn === "function" ? l.fn.call(this, ev) : l.fn.handleEvent(ev);
      } catch (e) {
        globalThis.__domfel?.(e);     // som i webbläsaren: felet rapporteras men händelsen fortsätter
      }
      if (ev._direkt) break;
    }
  }
  dispatchEvent(ev) {
    ev.target = this;
    const vag = [];
    for (let n = this; n; n = n.parentNode || (n.nodeType === 9 ? n.defaultView : null)) vag.push(n);
    for (const n of vag) {
      n._kor(ev);
      if (!ev.bubbles || ev._stopp) break;
    }
    return !ev.defaultPrevented;
  }
}

// ---------- noder ----------

export class Node extends EventTarget {
  constructor(doc) {
    super();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
  }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] ?? null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] ?? null; }
  _syskon(steg, element) {
    const s = this.parentNode?.childNodes;
    if (!s) return null;
    for (let i = s.indexOf(this) + steg; i >= 0 && i < s.length; i += steg) if (!element || s[i].nodeType === 1) return s[i];
    return null;
  }
  get nextSibling() { return this._syskon(1, false); }
  get previousSibling() { return this._syskon(-1, false); }
  get nextElementSibling() { return this._syskon(1, true); }
  get previousElementSibling() { return this._syskon(-1, true); }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.nodeType === 9; }

  get textContent() { return this.childNodes.map((n) => (n.nodeType === 8 ? "" : n.textContent)).join(""); }
  set textContent(v) { this.replaceChildren(); if (v != null && v !== "") this.appendChild(this.ownerDocument.createTextNode(String(v))); }

  _nod(x) { return x instanceof Node ? x : this.ownerDocument.createTextNode(String(x)); }
  insertBefore(nod, fore) {
    if (nod.nodeType === 11) { for (const b of [...nod.childNodes]) this.insertBefore(b, fore); return nod; }
    for (let n = this; n; n = n.parentNode) if (n === nod) throw new Error("HierarchyRequestError: kan inte lägga in en nod i sig själv");
    nod.parentNode?.removeChild(nod);
    const i = fore ? this.childNodes.indexOf(fore) : -1;
    if (fore && i < 0) throw new Error("NotFoundError: referensnoden är inte ett barn");
    if (i < 0) this.childNodes.push(nod); else this.childNodes.splice(i, 0, nod);
    nod.parentNode = this;
    return nod;
  }
  appendChild(nod) { return this.insertBefore(nod, null); }
  removeChild(nod) {
    const i = this.childNodes.indexOf(nod);
    if (i < 0) throw new Error("NotFoundError: noden är inte ett barn");
    this.childNodes.splice(i, 1);
    nod.parentNode = null;
    return nod;
  }
  replaceChild(ny, gammal) { this.insertBefore(ny, gammal); return this.removeChild(gammal); }
  append(...x) { for (const n of x) this.appendChild(this._nod(n)); }
  prepend(...x) { const f = this.firstChild; for (const n of x) this.insertBefore(this._nod(n), f); }
  replaceChildren(...x) { for (const n of [...this.childNodes]) this.removeChild(n); this.append(...x); }
  remove() { this.parentNode?.removeChild(this); }
  before(...x) { for (const n of x) this.parentNode.insertBefore(this._nod(n), this); }
  after(...x) { const nasta = this.nextSibling; for (const n of x) this.parentNode.insertBefore(this._nod(n), nasta); }
  replaceWith(...x) { const p = this.parentNode; if (!p) return; this.before(...x); p.removeChild(this); }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  hasChildNodes() { return this.childNodes.length > 0; }

  querySelectorAll(sel) {
    const s = tolkaSelektor(sel);
    const ut = [];
    const gå = (n) => { for (const b of n.children) { if (matcharLista(b, s, this)) ut.push(b); gå(b); } };
    gå(this);
    return ut;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  getElementsByTagName(t) { return this.querySelectorAll(t); }
  getElementsByClassName(k) { return this.querySelectorAll(k.trim().split(/\s+/).map((c) => `.${c}`).join("")); }
}

export class Text extends Node {
  constructor(doc, data) { super(doc); this.data = data; }
  get nodeType() { return 3; }
  get nodeName() { return "#text"; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  get nodeValue() { return this.data; }
  cloneNode() { return new Text(this.ownerDocument, this.data); }
}
export class Comment extends Text {
  get nodeType() { return 8; }
  get nodeName() { return "#comment"; }
  cloneNode() { return new Comment(this.ownerDocument, this.data); }
}
export class DocumentFragment extends Node {
  get nodeType() { return 11; }
  cloneNode(djup) { const f = new DocumentFragment(this.ownerDocument); if (djup) for (const b of this.childNodes) f.appendChild(b.cloneNode(true)); return f; }
}

class ClassList {
  constructor(el) { this.el = el; }
  _lista() { return (this.el.getAttribute("class") || "").split(/\s+/).filter(Boolean); }
  _satt(l) { this.el.setAttribute("class", [...new Set(l)].join(" ")); }
  get length() { return this._lista().length; }
  get value() { return this.el.getAttribute("class") || ""; }
  contains(c) { return this._lista().includes(c); }
  add(...c) { this._satt([...this._lista(), ...c]); }
  remove(...c) { this._satt(this._lista().filter((x) => !c.includes(x))); }
  toggle(c, tvinga) {
    const pa = tvinga === undefined ? !this.contains(c) : Boolean(tvinga);
    pa ? this.add(c) : this.remove(c);
    return pa;
  }
  replace(a, b) { if (!this.contains(a)) return false; this._satt(this._lista().map((x) => (x === a ? b : x))); return true; }
  item(i) { return this._lista()[i] ?? null; }
  [Symbol.iterator]() { return this._lista()[Symbol.iterator](); }
  toString() { return this.value; }
}

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const kamel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function skapaStil() {
  const stil = {
    setProperty(k, v) { stil[k] = String(v); },
    removeProperty(k) { const v = stil[k]; delete stil[k]; return v ?? ""; },
    getPropertyValue(k) { return stil[k] ?? ""; },
  };
  return stil;
}

export class Element extends Node {
  constructor(doc, tag, ns = null) {
    super(doc);
    this.localName = ns ? tag : tag.toLowerCase();
    this.namespaceURI = ns;
    this._attr = new Map();
    this.style = skapaStil();
    this.classList = new ClassList(this);
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === "string" ? this.getAttribute(`data-${kebab(k)}`) ?? undefined : undefined),
      set: (_, k, v) => { this.setAttribute(`data-${kebab(k)}`, v); return true; },
      deleteProperty: (_, k) => { this.removeAttribute(`data-${kebab(k)}`); return true; },
      has: (_, k) => this.hasAttribute(`data-${kebab(k)}`),
      ownKeys: () => [...this._attr.keys()].filter((a) => a.startsWith("data-")).map((a) => kamel(a.slice(5))),
      getOwnPropertyDescriptor: (_, k) => (this.hasAttribute(`data-${kebab(k)}`)
        ? { value: this.getAttribute(`data-${kebab(k)}`), enumerable: true, configurable: true } : undefined),
    });
    this.scrollTop = 0;
    this.scrollLeft = 0;
  }
  get nodeType() { return 1; }
  get tagName() { return this.namespaceURI ? this.localName : this.localName.toUpperCase(); }
  get nodeName() { return this.tagName; }

  getAttribute(n) { return this._attr.has(n.toLowerCase()) ? this._attr.get(n.toLowerCase()) : null; }
  setAttribute(n, v) { this._attr.set(n.toLowerCase(), String(v)); }
  removeAttribute(n) { this._attr.delete(n.toLowerCase()); }
  hasAttribute(n) { return this._attr.has(n.toLowerCase()); }
  toggleAttribute(n, tvinga) {
    const pa = tvinga === undefined ? !this.hasAttribute(n) : Boolean(tvinga);
    pa ? this.setAttribute(n, "") : this.removeAttribute(n);
    return pa;
  }
  getAttributeNames() { return [...this._attr.keys()]; }
  get attributes() { return [...this._attr].map(([name, value]) => ({ name, value })); }

  get id() { return this.getAttribute("id") ?? ""; }
  set id(v) { this.setAttribute("id", v); }
  get className() { return this.getAttribute("class") ?? ""; }
  set className(v) { this.setAttribute("class", v); }

  get value() {
    if (this.localName === "select") {
      const o = this.querySelectorAll("option");
      const v = o.find((x) => x.selected) || o[0];
      return v ? v.value : "";
    }
    if (this.localName === "option") return this.getAttribute("value") ?? this.textContent;
    if (this.localName === "textarea") return this._varde ?? this.textContent;
    return this._varde ?? this.getAttribute("value") ?? "";
  }
  set value(v) {
    if (this.localName === "select") { for (const o of this.querySelectorAll("option")) o.selected = o.value === String(v); return; }
    if (this.localName === "option") { this.setAttribute("value", v); return; }
    this._varde = String(v);
  }
  get selected() { return this._vald ?? this.hasAttribute("selected"); }
  set selected(v) {
    if (v && this.localName === "option") for (const o of this.closest("select")?.querySelectorAll("option") || []) o._vald = false;
    this._vald = Boolean(v);
  }
  get selectedIndex() { return this.querySelectorAll("option").findIndex((o) => o.selected); }
  get options() { return this.querySelectorAll("option"); }
  get checked() { return this._ikryssad ?? this.hasAttribute("checked"); }
  set checked(v) { this._ikryssad = Boolean(v); }
  get tabIndex() { return Number(this.getAttribute("tabindex") ?? -1); }
  set tabIndex(v) { this.setAttribute("tabindex", v); }

  get innerHTML() { return this.childNodes.map(serialisera).join(""); }
  set innerHTML(html) { this.replaceChildren(); for (const n of tolkaHtml(html, this.ownerDocument, this.namespaceURI)) this.appendChild(n); }
  get outerHTML() { return serialisera(this); }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  insertAdjacentHTML(plats, html) { const f = this.ownerDocument.createDocumentFragment(); f.innerHTML = html; this.insertAdjacentElement(plats, f); }
  insertAdjacentElement(plats, el) {
    ({ beforebegin: () => this.before(el), afterbegin: () => this.prepend(el), beforeend: () => this.append(el),
      afterend: () => this.after(el) })[plats.toLowerCase()]();
    return el;
  }
  cloneNode(djup) {
    const k = new Element(this.ownerDocument, this.localName, this.namespaceURI);
    for (const [a, v] of this._attr) k._attr.set(a, v);
    if (djup) for (const b of this.childNodes) k.appendChild(b.cloneNode(true));
    return k;
  }

  matches(sel) { return matcharLista(this, tolkaSelektor(sel), null); }
  closest(sel) {
    const s = tolkaSelektor(sel);
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matcharLista(n, s, null)) return n;
    return null;
  }

  click() { if (!this.disabled) this.dispatchEvent(new Event("click", { bubbles: true, cancelable: true })); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  select() {}
  scrollIntoView() {}
  scrollTo() {}
  scrollBy() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  animate() { return { finished: Promise.resolve(), cancel() {}, onfinish: null }; }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  getClientRects() { return []; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  get clientWidth() { return 0; }
  get clientHeight() { return 0; }
  get scrollWidth() { return 0; }
  get scrollHeight() { return 0; }
  showModal() { this.open = true; }
  show() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event("close")); }
  submit() { this.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }
  requestSubmit() { this.submit(); }
  reset() {}
  checkValidity() { return true; }
  reportValidity() { return true; }
  setCustomValidity() {}
  get form() { return this.closest("form"); }
  get files() { return []; }
  getContext() { return null; }
}
for (const p of BOOL_ATTR) {
  if (Object.getOwnPropertyDescriptor(Element.prototype, p)) continue;
  Object.defineProperty(Element.prototype, p, {
    get() { return this.hasAttribute(attrNamn(p)); },
    set(v) { this.toggleAttribute(attrNamn(p), Boolean(v)); },
  });
}
for (const p of STR_ATTR) {
  Object.defineProperty(Element.prototype, p, {
    get() { return this.getAttribute(attrNamn(p)) ?? ""; },
    set(v) { this.setAttribute(attrNamn(p), v); },
  });
}

export class Document extends Node {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.defaultView = null;
    this.activeElement = null;
    this.visibilityState = "visible";
    this.hidden = false;
    this.readyState = "complete";
    this.cookie = "";
  }
  get nodeType() { return 9; }
  get documentElement() { return this.children[0] ?? null; }
  get head() { return this.documentElement?.querySelector("head") ?? null; }
  get body() { return this.documentElement?.querySelector("body") ?? null; }
  get title() { return this.head?.querySelector("title")?.textContent ?? ""; }
  set title(v) {
    let t = this.head.querySelector("title");
    if (!t) t = this.head.appendChild(this.createElement("title"));
    t.textContent = v;
  }
  createElement(t) { return new Element(this, t); }
  createElementNS(ns, t) { return new Element(this, t, ns === "http://www.w3.org/1999/xhtml" ? null : ns); }
  createTextNode(s) { return new Text(this, s); }
  createComment(s) { return new Comment(this, s); }
  createDocumentFragment() {
    const f = new DocumentFragment(this);
    Object.defineProperty(f, "innerHTML", { set: (h) => { f.replaceChildren(...tolkaHtml(h, this)); } });
    return f;
  }
  getElementById(id) {
    const leta = (n) => { for (const b of n.children) { if (b.getAttribute("id") === id) return b; const r = leta(b); if (r) return r; } return null; };
    return leta(this);
  }
  hasFocus() { return true; }
  getSelection() { return { removeAllRanges() {}, addRange() {}, toString: () => "" }; }
  execCommand() { return false; }
}

// ---------- HTML ----------

function serialisera(n) {
  if (n.nodeType === 3) return koda(n.data);
  if (n.nodeType === 8) return `<!--${n.data}-->`;
  const attr = [...n._attr].map(([a, v]) => ` ${a}="${v.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`).join("");
  if (TOMMA.has(n.localName)) return `<${n.localName}${attr}>`;
  return `<${n.localName}${attr}>${n.childNodes.map(serialisera).join("")}</${n.localName}>`;
}

/** Tolkar välformad HTML (som index.html) till en lista noder. */
export function tolkaHtml(html, doc, ns = null) {
  const rot = doc.createDocumentFragment();
  const stack = [rot];
  const topp = () => stack[stack.length - 1];
  const SVG = "http://www.w3.org/2000/svg";
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const slut = html.indexOf("-->", i + 4);
      topp().appendChild(doc.createComment(html.slice(i + 4, slut)));
      i = slut + 3;
    } else if (html.startsWith("<!", i)) {
      i = html.indexOf(">", i) + 1;
    } else if (html.startsWith("</", i)) {
      const slut = html.indexOf(">", i);
      const tag = html.slice(i + 2, slut).trim().toLowerCase();
      const j = stack.findLastIndex((n) => n.localName?.toLowerCase() === tag);
      if (j > 0) stack.length = j;
      i = slut + 1;
    } else if (html[i] === "<" && /[a-zA-Z]/.test(html[i + 1] || "")) {
      const m = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(i));
      const tag = m[1];
      i += m[0].length;
      const attr = [];
      const re = /\s*([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?|\s*(\/?)>/y;
      for (;;) {
        re.lastIndex = i;
        const a = re.exec(html);
        if (!a) throw new SyntaxError(`Kunde inte tolka taggen <${tag}> vid tecken ${i}`);
        i = re.lastIndex;
        if (a[0].trim().endsWith(">") && a[1] === undefined) { attr.sjalvstangd = a[5] === "/"; break; }
        attr.push([a[1], avkoda(a[2] ?? a[3] ?? a[4] ?? "")]);
      }
      const forelder = topp();
      const elNs = tag.toLowerCase() === "svg" ? SVG : (forelder.namespaceURI ?? ns);
      const el = elNs ? new Element(doc, tag, elNs) : doc.createElement(tag);
      for (const [a, v] of attr) el.setAttribute(a, v);
      forelder.appendChild(el);
      const namn = tag.toLowerCase();
      if (RAATEXT.has(namn) && !elNs) {
        const slut = html.toLowerCase().indexOf(`</${namn}`, i);
        const text = html.slice(i, slut);
        if (text) el.appendChild(doc.createTextNode(namn === "script" || namn === "style" ? text : avkoda(text)));
        i = html.indexOf(">", slut) + 1;
      } else if (!TOMMA.has(namn) && !attr.sjalvstangd) {
        stack.push(el);
      }
    } else {
      const slut = html.indexOf("<", i + 1);
      const text = html.slice(i, slut < 0 ? html.length : slut);
      topp().appendChild(doc.createTextNode(avkoda(text)));
      i = slut < 0 ? html.length : slut;
    }
  }
  return [...rot.childNodes];
}

// ---------- selektorer ----------

const selektorCache = new Map();

/** Tolkar en selektorlista till [[{komb, delar}]]. Stöder tagg, #id, .klass, [attr], [attr="v"] (=, ~=, ^=, $=, *=),
 *  :scope, :not(), :first-child, :last-child, :checked, :disabled och kombinatorerna mellanslag, >, + och ~. */
export function tolkaSelektor(sel) {
  if (selektorCache.has(sel)) return selektorCache.get(sel);
  const lista = [];
  let i = 0;
  const s = sel.trim();
  const fel = () => new SyntaxError(`Selektorn stöds inte av minidom: ${sel}`);
  let komplex = [], komb = " ", delar = [];
  const avsluta = () => {
    if (!delar.length) throw fel();
    komplex.push({ komb, delar });
    delar = [];
  };
  while (i < s.length) {
    const c = s[i];
    if (c === ",") { avsluta(); lista.push(komplex); komplex = []; komb = " "; i++; while (s[i] === " ") i++; continue; }
    if (/\s|>|\+|~/.test(c)) {
      let k = " ";
      while (i < s.length && /\s|>|\+|~/.test(s[i])) { if (s[i] !== " ") k = s[i]; i++; }
      if (s[i] === ",") continue;
      avsluta();
      komb = k;
      continue;
    }
    let m;
    if ((m = /^\*|^[a-zA-Z][\w-]*/.exec(s.slice(i)))) { delar.push({ typ: "tagg", v: m[0].toLowerCase() }); i += m[0].length; continue; }
    if ((m = /^#([\w-]+)/.exec(s.slice(i)))) { delar.push({ typ: "id", v: m[1] }); i += m[0].length; continue; }
    if ((m = /^\.([\w-]+)/.exec(s.slice(i)))) { delar.push({ typ: "klass", v: m[1] }); i += m[0].length; continue; }
    if ((m = /^\[\s*([\w-]+)\s*(?:([~^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/.exec(s.slice(i)))) {
      delar.push({ typ: "attr", namn: m[1], op: m[2], v: m[3] ?? m[4] ?? m[5] });
      i += m[0].length;
      continue;
    }
    if ((m = /^:not\(([^)]*)\)/.exec(s.slice(i)))) { delar.push({ typ: "not", lista: tolkaSelektor(m[1]) }); i += m[0].length; continue; }
    if ((m = /^:(scope|first-child|last-child|checked|disabled)/.exec(s.slice(i)))) { delar.push({ typ: m[1] }); i += m[0].length; continue; }
    throw fel();
  }
  avsluta();
  lista.push(komplex);
  selektorCache.set(sel, lista);
  return lista;
}

function matcharDelar(el, delar, scope) {
  for (const d of delar) {
    if (d.typ === "tagg") { if (d.v !== "*" && el.localName.toLowerCase() !== d.v) return false; }
    else if (d.typ === "id") { if (el.getAttribute("id") !== d.v) return false; }
    else if (d.typ === "klass") { if (!el.classList.contains(d.v)) return false; }
    else if (d.typ === "attr") {
      const v = el.getAttribute(d.namn);
      if (v === null) return false;
      if (d.op === "=" && v !== d.v) return false;
      if (d.op === "~=" && !v.split(/\s+/).includes(d.v)) return false;
      if (d.op === "^=" && !v.startsWith(d.v)) return false;
      if (d.op === "$=" && !v.endsWith(d.v)) return false;
      if (d.op === "*=" && !v.includes(d.v)) return false;
    }
    else if (d.typ === "not") { if (matcharLista(el, d.lista, scope)) return false; }
    else if (d.typ === "scope") { if (el !== scope) return false; }
    else if (d.typ === "first-child") { if (el.previousElementSibling) return false; }
    else if (d.typ === "last-child") { if (el.nextElementSibling) return false; }
    else if (d.typ === "checked") { if (!el.checked && !el.selected) return false; }
    else if (d.typ === "disabled") { if (!el.disabled) return false; }
  }
  return true;
}

function matcharKomplex(el, komplex, k, scope) {
  if (!el || el.nodeType !== 1 || !matcharDelar(el, komplex[k].delar, scope)) return false;
  if (k === 0) return true;
  const komb = komplex[k].komb;
  if (komb === ">") return matcharKomplex(el.parentNode, komplex, k - 1, scope);
  if (komb === "+") return matcharKomplex(el.previousElementSibling, komplex, k - 1, scope);
  if (komb === "~") {
    for (let n = el.previousElementSibling; n; n = n.previousElementSibling) if (matcharKomplex(n, komplex, k - 1, scope)) return true;
    return false;
  }
  for (let n = el.parentNode; n && n.nodeType === 1; n = n.parentNode) if (matcharKomplex(n, komplex, k - 1, scope)) return true;
  return false;
}

const matcharLista = (el, lista, scope) => lista.some((k) => matcharKomplex(el, k, k.length - 1, scope));

// ---------- webbläsarmiljön ----------

class Lagring {
  constructor() { this._d = new Map(); }
  get length() { return this._d.size; }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
  clear() { this._d.clear(); }
  key(i) { return [...this._d.keys()][i] ?? null; }
}

/**
 * Installerar en webbläsarmiljö på globalThis med html som sidan och filer ({namn: innehåll}) som det
 * fetch kan hämta. Returnerar {document, fel, navigera(hash), vanta()}; fel samlar fel som kastats i
 * händelsehanterare, console.error-anrop och ohanterade promise-fel.
 */
export function installera({ html, filer = {}, url = "https://exempel.test/" }) {
  const fel = [];
  const doc = new Document();
  for (const n of tolkaHtml(html, doc)) doc.appendChild(n);
  doc.activeElement = doc.body;

  const fonster = new EventTarget();
  doc.defaultView = fonster;
  let adress = new URL(url);
  const location = {
    get href() { return adress.href; },
    set href(v) { location.assign(v); },
    get origin() { return adress.origin; },
    get protocol() { return adress.protocol; },
    get host() { return adress.host; },
    get hostname() { return adress.hostname; },
    get pathname() { return adress.pathname; },
    get search() { return adress.search; },
    get hash() { return adress.hash; },
    set hash(v) {
      const ny = new URL(adress);
      ny.hash = v;
      const andrad = ny.hash !== adress.hash;
      adress = ny;
      if (andrad) setTimeout(() => fonster.dispatchEvent(new Event("hashchange")), 0);
    },
    assign(v) { location.hash = new URL(v, adress).hash; },
    replace(v) { location.assign(v); },
    reload() { location.omladdningar++; },
    omladdningar: 0,
    toString() { return adress.href; },
  };
  const historik = {
    length: 1, state: null,
    pushState(s, _, u) { this.state = s; if (u != null) adress = new URL(u, adress); },
    replaceState(s, _, u) { this.state = s; if (u != null) adress = new URL(u, adress); },
    back() {}, forward() {}, go() {},
  };

  async function hamta(resurs) {
    const namn = new URL(String(resurs), adress).pathname.replace(/^\//, "");
    if (!(namn in filer)) return new Response("saknas", { status: 404 });
    const v = filer[namn];
    return new Response(typeof v === "string" ? v : JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  }

  const intervall = [];
  class Observerare { constructor(fn) { this.fn = fn; } observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  const media = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

  const g = {
    window: globalThis, self: globalThis, document: doc, location, history: historik,
    localStorage: new Lagring(), sessionStorage: new Lagring(),
    navigator: { userAgent: "minidom", language: "sv-SE", languages: ["sv-SE"], onLine: true,
      clipboard: { writeText: async () => {} }, share: undefined, serviceWorker: undefined, maxTouchPoints: 0 },
    fetch: hamta,
    Event, CustomEvent, KeyboardEvent: Event, MouseEvent: Event, PointerEvent: Event, FocusEvent: Event, InputEvent: Event,
    Node, Element, HTMLElement: Element, Text, DocumentFragment,
    IntersectionObserver: Observerare, ResizeObserver: Observerare, MutationObserver: Observerare,
    matchMedia: media,
    getComputedStyle: (el) => el.style,
    requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    requestIdleCallback: (fn) => setTimeout(() => fn({ timeRemaining: () => 50, didTimeout: false }), 0),
    // Intervall körs inte (de skulle hålla igång testet), men sparas så att testet kan köra dem en gång
    setInterval: (fn, ms) => { intervall.push({ fn, ms }); return intervall.length; },
    clearInterval: () => {},
    scrollTo() {}, scrollBy() {}, alert() {}, confirm: () => false, prompt: () => null, open: () => null,
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 2, scrollX: 0, scrollY: 0, pageYOffset: 0,
    screen: { width: 390, height: 844 },
    addEventListener: fonster.addEventListener.bind(fonster),
    removeEventListener: fonster.removeEventListener.bind(fonster),
    dispatchEvent: fonster.dispatchEvent.bind(fonster),
  };
  for (const [k, v] of Object.entries(g)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });

  const konsolFel = console.error;
  console.error = (...a) => { fel.push(a.map((x) => (x instanceof Error ? x.stack : String(x))).join(" ")); };
  const ohanterat = (e) => fel.push(`Ohanterat promise-fel: ${e?.stack || e}`);
  process.on("unhandledRejection", ohanterat);
  globalThis.__domfel = (e) => fel.push(`Fel i händelsehanterare: ${e?.stack || e}`);

  /** Låter väntande promises, fetch och setTimeout(0) bli klara. */
  async function vanta(varv = 30) {
    for (let k = 0; k < varv; k++) await new Promise((r) => setTimeout(r, 0));
  }

  return {
    document: doc, fel, location, intervall, vanta,
    async navigera(hash) { location.hash = hash; await vanta(); },
    avsluta() { console.error = konsolFel; process.off("unhandledRejection", ohanterat); },
  };
}
