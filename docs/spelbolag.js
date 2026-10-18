// Spelbolag: ren logik utan DOM och utan Firebase – turordning, saldon och kassabok.
//
// Ett spelbolag:
//   { id, namn, spelform: "kassa" | "tur", skapare: uid, kassor: uid | null,
//     medlemmar: { uid: { namn } }, medlem_uids: [uid], turordning: [id], tur_start: omgång, kod,
//     gaster: { gid: { namn, borttagen? } }, kopplingar: { gid: uid } }
// Medlemmar utan konto (gaster) läggs in av skaparen och räknas som alla andra: de delar på insatser och
// vinster, har saldo och kan stå i turordningen. Får gästen ett konto senare kopplas gäst-id:t till kontot
// (kopplingar), så att historiken följer med. Överallt där ett medlems-id används går det genom losId.
// Bolagets spel är vanliga sparade spel (se minaspel.js) med sparad_av och deltagare (medlemmarna när spelet
// sparades). Kassaboken är poster som skaparen eller kassören lägger in för hand:
//   { typ: "inbetalning" | "utbetalning" | "vinst" | "insats", belopp, text, uid, datum, deltagare, spelare? }
//   - inbetalning: medlemmen (uid) har betalat in till kassan/kassören
//   - utbetalning: medlemmen (uid) har fått pengar ur kassan
//   - vinst: en vinst utanför appen som delas lika; uid = den som har pengarna (null = kassan)
//   - insats: ett spel utanför appen som delas lika; uid = den som betalade (null = kassan)
//   spelare (vinst/insats): vem som spelade – räknas in i topplistan
// Ett sparat spel har spelare = den som spelade (kan vara en gäst); saknas fältet är det den som sparade.
//
// Allt delas lika mellan deltagarna. Saldot per medlem är:
//   betalat − mottaget − andel av insatserna + andel av vinsterna
// Positivt saldo = medlemmen har pengar att få; negativt = medlemmen är skyldig. I kassamodellen betalar och
// tar kassan emot spelens insatser och vinster. I turordning betalar veckans spelare insatsen och får vinsten
// utbetald av Svenska Spel – det bokförs som att hen betalat respektive tagit emot.

import { ratta } from "./minaspel.js?v=20261018a";

export const SPELFORMER = { kassa: "Kassa", tur: "Turordning" };
export const POSTTYPER = { inbetalning: "Inbetalning", utbetalning: "Utbetalning", vinst: "Vinst utanför appen", insats: "Spel utanför appen" };
export const MAX_MEDLEMMAR = 20;

export const MAX_GASTER = 20;

/** Ett gäst-id som kopplats till ett konto ersätts med kontots uid. */
export const losId = (grupp, id) => (id && grupp.kopplingar?.[id]) || id;

/** Alla som delar på bolagets spel nu: medlemmar med konto och gäster som varken kopplats eller tagits bort. */
export const deltagarIds = (grupp) => [...(grupp.medlem_uids || []),
  ...Object.entries(grupp.gaster || {}).filter(([id, g]) => !g.borttagen && !grupp.kopplingar?.[id]).map(([id]) => id)];

/** Namnet på en medlem eller gäst; null om id:t är okänt. */
export const namnPa = (grupp, id) => {
  const r = losId(grupp, id);
  return grupp.medlemmar?.[r]?.namn || grupp.gaster?.[r]?.namn || null;
};

export const arGast = (grupp, id) => Boolean(grupp.gaster?.[losId(grupp, id)]);

/** Kontrollera ett nytt gästnamn. Returnerar en felbeskrivning eller null. */
export function valideraGast(namn, grupp) {
  const n = String(namn || "").trim();
  if (!n) return "Skriv ett namn.";
  if (n.length > 60) return "Namnet är för långt.";
  if (Object.values(grupp.gaster || {}).filter((g) => !g.borttagen).length >= MAX_GASTER) return `Högst ${MAX_GASTER} medlemmar utan konto.`;
  if (deltagarIds(grupp).some((id) => namnPa(grupp, id)?.toLowerCase() === n.toLowerCase())) return "Det finns redan en medlem med det namnet.";
  return null;
}

/** Vems tur det är en viss omgång (turordning). null för kassamodellen eller om listan är tom. */
export function turFor(grupp, omgangId) {
  if (grupp.spelform !== "tur" || !grupp.turordning?.length) return null;
  const n = grupp.turordning.length;
  const steg = ((omgangId - (grupp.tur_start || omgangId)) % n + n) % n;
  return grupp.turordning[steg];
}

/** Får den här användaren spara bolagets spel för omgången? (Appens vägledning; reglerna tillåter alla medlemmar.) */
export function farSpara(grupp, uid, omgangId) {
  if (!grupp.medlem_uids?.includes(uid)) return false;
  if (uid === grupp.skapare) return true;
  if (grupp.spelform === "kassa") return uid === (grupp.kassor || grupp.skapare);
  const tur = losId(grupp, turFor(grupp, omgangId));
  return uid === tur || (arGast(grupp, tur) && farBokfora(grupp, uid));   // en gästs vecka sparas av skaparen
}

/** Får användaren skriva i kassaboken? */
export const farBokfora = (grupp, uid) => uid === grupp.skapare || (grupp.kassor && uid === grupp.kassor);

/** Slumpad inbjudningskod (bokstäver och siffror, 20 tecken). */
export function nyKod(slump = () => Math.random()) {
  const tecken = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let ut = "";
  if (typeof crypto !== "undefined" && crypto.getRandomValues && slump === Math.random) {
    for (const b of crypto.getRandomValues(new Uint8Array(20))) ut += tecken[b % tecken.length];
    return ut;
  }
  for (let i = 0; i < 20; i++) ut += tecken[Math.floor(slump() * tecken.length)];
  return ut;
}

/** Kontrollera en kassaboks-post. Returnerar en felbeskrivning eller null. */
export function valideraPost(post, grupp) {
  if (!POSTTYPER[post.typ]) return "Välj typ av post.";
  if (!(post.belopp > 0) || post.belopp > 1_000_000) return "Beloppet måste vara större än 0.";
  const alla = deltagarIds(grupp);
  if ((post.typ === "inbetalning" || post.typ === "utbetalning") && !alla.includes(post.uid)) {
    return "Välj vilken medlem det gäller.";
  }
  if (post.uid && !alla.includes(post.uid)) return "Medlemmen finns inte i bolaget.";
  if (post.spelare && !alla.includes(post.spelare)) return "Den som spelade finns inte i bolaget.";
  return null;
}

/**
 * Räkna fram saldon. spelLista = bolagets sparade spel, kassabok = posterna, historik = historik.json.
 * Returnerar { medlemmar: {uid: {namn, betalat, mottaget, insats, vinst, saldo}}, kassa, insats, vinst, netto,
 *              spel: [{spel, resultat, spelare}] }
 */
export function rakna(grupp, spelLista, kassabok, historik) {
  const perId = new Map((historik?.omgangar || []).map((o) => [o.id, o]));
  const m = {};
  const medlem = (id) => {
    const uid = losId(grupp, id);
    return (m[uid] ||= { namn: namnPa(grupp, uid) || "Tidigare medlem", gast: arGast(grupp, uid), betalat: 0, mottaget: 0, insats: 0, vinst: 0 });
  };
  for (const id of deltagarIds(grupp)) medlem(id);
  let kassa = 0, insatsTot = 0, vinstTot = 0;

  const dela = (belopp, deltagare, falt) => {
    const lista = [...new Set((deltagare?.length ? deltagare : deltagarIds(grupp)).map((id) => losId(grupp, id)))];
    for (const uid of lista) medlem(uid)[falt] += belopp / lista.length;
  };
  // Kassan eller en medlem betalar/tar emot
  const betala = (uid, belopp) => { if (uid) medlem(uid).betalat += belopp; else kassa -= belopp; };
  const taEmot = (uid, belopp) => { if (uid) medlem(uid).mottaget += belopp; else kassa += belopp; };

  const spel = [];
  for (const s of [...spelLista].sort((a, b) => b.omgang_id - a.omgang_id)) {
    const r = ratta(s, perId.get(s.omgang_id));
    const spelare = grupp.spelform === "tur" ? losId(grupp, s.spelare || s.sparad_av) : null;
    betala(spelare, s.insats);
    dela(s.insats, s.deltagare, "insats");
    insatsTot += s.insats;
    if (r && r.vinst) {
      taEmot(spelare, r.vinst);
      dela(r.vinst, s.deltagare, "vinst");
      vinstTot += r.vinst;
    }
    spel.push({ spel: s, resultat: r, spelare: losId(grupp, s.spelare || s.sparad_av) });
  }
  for (const p of kassabok) {
    if (p.typ === "inbetalning") { medlem(p.uid).betalat += p.belopp; kassa += p.belopp; }
    if (p.typ === "utbetalning") { medlem(p.uid).mottaget += p.belopp; kassa -= p.belopp; }
    if (p.typ === "vinst") { taEmot(p.uid || null, p.belopp); dela(p.belopp, p.deltagare, "vinst"); vinstTot += p.belopp; }
    if (p.typ === "insats") { betala(p.uid || null, p.belopp); dela(p.belopp, p.deltagare, "insats"); insatsTot += p.belopp; }
  }
  for (const v of Object.values(m)) v.saldo = v.betalat - v.mottaget - v.insats + v.vinst;
  return { medlemmar: m, kassa, insats: insatsTot, vinst: vinstTot, netto: vinstTot - insatsTot, spel };
}

/**
 * Topplistan: vad varje medlem har spelat in. Bolagets spel räknas på den som spelade (spelare, annars den
 * som sparade) och kassabokens "Spel/Vinst utanför appen" på sitt spelare-fält. Sorterad på vinst, sedan netto;
 * den som inte spelat något hamnar sist.
 * Returnerar [{ id, namn, gast, veckor, insats, vinst, netto, basta }]; basta = flest rätt (null om okänt).
 */
export function topplista(grupp, spelLista, kassabok, historik) {
  const perId = new Map((historik?.omgangar || []).map((o) => [o.id, o]));
  const t = {};
  const rad = (id) => {
    const uid = losId(grupp, id);
    return (t[uid] ||= { id: uid, namn: namnPa(grupp, uid) || "Tidigare medlem", gast: arGast(grupp, uid),
      veckor: 0, insats: 0, vinst: 0, basta: null });
  };
  for (const id of deltagarIds(grupp)) rad(id);
  for (const s of spelLista) {
    const x = rad(s.spelare || s.sparad_av);
    const r = ratta(s, perId.get(s.omgang_id));
    x.veckor++;
    x.insats += s.insats;
    if (r) { x.vinst += r.vinst; x.basta = Math.max(x.basta ?? 0, r.basta); }
  }
  for (const p of kassabok) {
    if (!p.spelare) continue;
    if (p.typ === "insats") { const x = rad(p.spelare); x.veckor++; x.insats += p.belopp; }
    if (p.typ === "vinst") rad(p.spelare).vinst += p.belopp;
  }
  return Object.values(t).map((x) => ({ ...x, netto: x.vinst - x.insats }))
    .sort((a, b) => (b.veckor > 0 || b.vinst > 0) - (a.veckor > 0 || a.vinst > 0) || b.vinst - a.vinst || b.netto - a.netto || b.veckor - a.veckor || a.namn.localeCompare(b.namn, "sv"));
}
