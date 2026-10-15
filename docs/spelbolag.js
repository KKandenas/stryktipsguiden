// Spelbolag: ren logik utan DOM och utan Firebase – turordning, saldon och kassabok.
//
// Ett spelbolag:
//   { id, namn, spelform: "kassa" | "tur", skapare: uid, kassor: uid | null,
//     medlemmar: { uid: { namn } }, medlem_uids: [uid], turordning: [uid], tur_start: omgång, kod }
// Bolagets spel är vanliga sparade spel (se minaspel.js) med sparad_av och deltagare (medlemmarna när spelet
// sparades). Kassaboken är poster som skaparen eller kassören lägger in för hand:
//   { typ: "inbetalning" | "utbetalning" | "vinst" | "insats", belopp, text, uid, datum, deltagare }
//   - inbetalning: medlemmen (uid) har betalat in till kassan/kassören
//   - utbetalning: medlemmen (uid) har fått pengar ur kassan
//   - vinst: en vinst utanför appen som delas lika; uid = den som har pengarna (null = kassan)
//   - insats: ett spel utanför appen som delas lika; uid = den som betalade (null = kassan)
//
// Allt delas lika mellan deltagarna. Saldot per medlem är:
//   betalat − mottaget − andel av insatserna + andel av vinsterna
// Positivt saldo = medlemmen har pengar att få; negativt = medlemmen är skyldig. I kassamodellen betalar och
// tar kassan emot spelens insatser och vinster. I turordning betalar veckans spelare insatsen och får vinsten
// utbetald av Svenska Spel – det bokförs som att hen betalat respektive tagit emot.

import { ratta } from "./minaspel.js?v=20261015f";

export const SPELFORMER = { kassa: "Kassa", tur: "Turordning" };
export const POSTTYPER = { inbetalning: "Inbetalning", utbetalning: "Utbetalning", vinst: "Vinst utanför appen", insats: "Spel utanför appen" };
export const MAX_MEDLEMMAR = 20;

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
  return uid === turFor(grupp, omgangId);
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
  if ((post.typ === "inbetalning" || post.typ === "utbetalning") && !grupp.medlem_uids.includes(post.uid)) {
    return "Välj vilken medlem det gäller.";
  }
  if (post.uid && !grupp.medlem_uids.includes(post.uid)) return "Medlemmen finns inte i bolaget.";
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
  const medlem = (uid) => (m[uid] ||= { namn: grupp.medlemmar?.[uid]?.namn || "Tidigare medlem", betalat: 0, mottaget: 0, insats: 0, vinst: 0 });
  for (const uid of grupp.medlem_uids || []) medlem(uid);
  let kassa = 0, insatsTot = 0, vinstTot = 0;

  const dela = (belopp, deltagare, falt) => {
    const lista = deltagare?.length ? deltagare : grupp.medlem_uids;
    for (const uid of lista) medlem(uid)[falt] += belopp / lista.length;
  };
  // Kassan eller en medlem betalar/tar emot
  const betala = (uid, belopp) => { if (uid) medlem(uid).betalat += belopp; else kassa -= belopp; };
  const taEmot = (uid, belopp) => { if (uid) medlem(uid).mottaget += belopp; else kassa += belopp; };

  const spel = [];
  for (const s of [...spelLista].sort((a, b) => b.omgang_id - a.omgang_id)) {
    const r = ratta(s, perId.get(s.omgang_id));
    const spelare = grupp.spelform === "tur" ? s.sparad_av : null;
    betala(spelare, s.insats);
    dela(s.insats, s.deltagare, "insats");
    insatsTot += s.insats;
    if (r && r.vinst) {
      taEmot(spelare, r.vinst);
      dela(r.vinst, s.deltagare, "vinst");
      vinstTot += r.vinst;
    }
    spel.push({ spel: s, resultat: r, spelare: s.sparad_av });
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
