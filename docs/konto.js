// Inloggning och sparade spel (Mina spel) via Firebase Authentication och Firestore.
//
// Firebase laddas först när någon använder kontot, så resten av appen fungerar som vanligt utan det.
// Är FIREBASE_CONFIG inte ifylld (se FIREBASE.md) är kontot avstängt. Med ?demo-konto i adressen används
// en lokal låtsasdatabas i minnet, så att sidorna går att prova utan Firebase.
//
// Data i Firestore (se firestore.rules):
//   anvandare/{uid}            { namn, epost, delad_med: [e-post], skapad }
//   spel/{uid}_{omgang_id}     { agare, agare_namn, delad_med: [e-post], …spelet (se minaspel.js) }
//   grupper/{gid}              spelbolaget (se spelbolag.js)
//   grupper/{gid}/spel/{omg}   bolagets spel, med sparad_av och deltagare
//   grupper/{gid}/kassabok/{id} poster som skaparen eller kassören lagt in
//   inbjudningar/{kod}         { gid, namn } – inbjudningslänken pekar hit
// delad_med kopieras till varje spel, så att den man delat med kan hämta spelen med en enkel fråga.

import { FIREBASE_CONFIG } from "./firebase-config.js?v=20261014e";
import { nyKod } from "./spelbolag.js?v=20261014e";

const VERSION = "10.12.2";
const BAS = `https://www.gstatic.com/firebasejs/${VERSION}`;
const EPOST_NYCKEL = "stryktipsguiden-epostlank";
export const DEMO = new URLSearchParams(location.search).has("demo-konto");

export const aktiverat = () => DEMO || Boolean(FIREBASE_CONFIG);

let impl = null;
let anvandare = null;
const lyssnare = new Set();

/** Anropas med {uid, namn, epost, bild} eller null när inloggningen ändras (bild = egen bild, Google-bild eller null). Returnerar en avregistrering. */
export function nar(fn) {
  lyssnare.add(fn);
  fn(anvandare);
  return () => lyssnare.delete(fn);
}
const meddela = (u) => { anvandare = u; for (const fn of lyssnare) fn(u); };
export const inloggad = () => anvandare;

/** Ladda Firebase (eller demoläget) och börja följa inloggningen. Säker att anropa flera gånger. */
export async function starta() {
  if (impl) return impl;
  if (!aktiverat()) throw new Error("Inloggningen är inte aktiverad än.");
  impl = DEMO ? demo() : await firebase();
  return impl;
}

export async function loggaInGoogle() { return (await starta()).loggaInGoogle(); }
export async function skickaLank(epost) {
  await (await starta()).skickaLank(epost);
  try { localStorage.setItem(EPOST_NYCKEL, epost); } catch { /* privat läge */ }
}
export async function loggaUt() { return (await starta()).loggaUt(); }
export async function sparaSpel(spel) { return (await starta()).sparaSpel(spel); }
export async function taBortSpel(omgangId) { return (await starta()).taBortSpel(omgangId); }
export async function minaSpel() { return (await starta()).minaSpel(); }
export async function deladeSpel() { return (await starta()).deladeSpel(); }
export async function profil() { return (await starta()).profil(); }
export async function satDelning(lista) { return (await starta()).satDelning(lista); }
export async function raderaKonto() { return (await starta()).raderaKonto(); }
/** Spara en egen profilbild (data-URL, JPEG) eller null för att ta bort den. */
export async function sparaBild(dataUrl) {
  await (await starta()).sparaBild(dataUrl);
  if (anvandare) meddela({ ...anvandare, egenBild: dataUrl, bild: dataUrl || anvandare.googleBild });
}

// Spelbolag
export async function minaGrupper() { return (await starta()).minaGrupper(); }
export async function skapaGrupp(namn, spelform, omgangId) { return (await starta()).skapaGrupp(namn, spelform, omgangId); }
export async function inbjudan(kod) { return (await starta()).inbjudan(kod); }
export async function anslut(kod) { return (await starta()).anslut(kod); }
export async function uppdateraGrupp(gid, falt) { return (await starta()).uppdateraGrupp(gid, falt); }
export async function bytKod(grupp) { return (await starta()).bytKod(grupp); }
export async function lamnaGrupp(grupp) { return (await starta()).lamnaGrupp(grupp); }
export async function taBortMedlem(grupp, uid) { return (await starta()).taBortMedlem(grupp, uid); }
export async function raderaGrupp(grupp) { return (await starta()).raderaGrupp(grupp); }
export async function gruppSpel(gid) { return (await starta()).gruppSpel(gid); }
export async function sparaGruppSpel(grupp, spel) { return (await starta()).sparaGruppSpel(grupp, spel); }
export async function taBortGruppSpel(gid, omgangId) { return (await starta()).taBortGruppSpel(gid, omgangId); }
export async function kassabok(gid) { return (await starta()).kassabok(gid); }
export async function laggTillPost(grupp, post) { return (await starta()).laggTillPost(grupp, post); }
export async function taBortPost(gid, id) { return (await starta()).taBortPost(gid, id); }

/** Är sidan öppnad från en inloggningslänk i e-posten? Då slutförs inloggningen (e-post frågas om den saknas). */
export async function slutforLank(fragaEpost) {
  if (DEMO || !FIREBASE_CONFIG || !/[?&]oobCode=/.test(location.href)) return false;
  const i = await starta();
  let epost = null;
  try { epost = localStorage.getItem(EPOST_NYCKEL); } catch { /* privat läge */ }
  epost = epost || (await fragaEpost());
  if (!epost) return false;
  await i.slutforLank(epost);
  try { localStorage.removeItem(EPOST_NYCKEL); } catch { /* privat läge */ }
  history.replaceState(null, "", location.pathname + "#minaspel");
  return true;
}

// ---------- Firebase ----------

async function firebase() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${BAS}/firebase-app.js`), import(`${BAS}/firebase-auth.js`), import(`${BAS}/firebase-firestore.js`)]);
  const { databaseId, ...config } = FIREBASE_CONFIG;
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  auth.languageCode = "sv";
  // Standarddatabasen heter "(default)"; har databasen fått ett eget namn anges det som databaseId i konfigurationen
  const db = databaseId ? F.getFirestore(app, databaseId) : F.getFirestore(app);
  const fran = (u, profil) => (u ? { uid: u.uid, namn: u.displayName || u.email, epost: (u.email || "").toLowerCase(),
    googleBild: u.photoURL || null, egenBild: profil?.bild || null, bild: profil?.bild || u.photoURL || null } : null);
  A.onAuthStateChanged(auth, async (u) => {
    let profil = null;
    if (u) {   // se till att profilen finns
      const ref = F.doc(db, "anvandare", u.uid);
      const snap = await F.getDoc(ref);
      if (!snap.exists()) {
        await F.setDoc(ref, { namn: u.displayName || u.email, epost: (u.email || "").toLowerCase(), delad_med: [],
          skapad: new Date().toISOString() });
      } else {
        profil = snap.data();
      }
    }
    meddela(fran(u, profil));
  });

  const kravInloggad = () => {
    if (!auth.currentUser) throw new Error("Du behöver logga in först.");
    return auth.currentUser;
  };
  const profilen = async () => (await F.getDoc(F.doc(db, "anvandare", kravInloggad().uid))).data() || { delad_med: [] };

  return {
    loggaInGoogle: () => A.signInWithPopup(auth, new A.GoogleAuthProvider()),
    skickaLank: (epost) => A.sendSignInLinkToEmail(auth, epost,
      { url: location.origin + location.pathname + "#minaspel", handleCodeInApp: true }),
    slutforLank: (epost) => A.signInWithEmailLink(auth, epost, location.href),
    loggaUt: () => A.signOut(auth),
    profil: profilen,
    async sparaSpel(spel) {
      const u = kravInloggad();
      const p = await profilen();
      await F.setDoc(F.doc(db, "spel", `${u.uid}_${spel.omgang_id}`),
        { ...spel, agare: u.uid, agare_namn: p.namn || u.displayName || u.email, delad_med: p.delad_med || [] });
    },
    async taBortSpel(omgangId) {
      const u = kravInloggad();
      await F.deleteDoc(F.doc(db, "spel", `${u.uid}_${omgangId}`));
    },
    async minaSpel() {
      const u = kravInloggad();
      const s = await F.getDocs(F.query(F.collection(db, "spel"), F.where("agare", "==", u.uid)));
      return s.docs.map((d) => d.data());
    },
    async deladeSpel() {
      const u = kravInloggad();
      if (!u.email || !u.emailVerified) return [];
      const s = await F.getDocs(F.query(F.collection(db, "spel"), F.where("delad_med", "array-contains", u.email.toLowerCase())));
      return s.docs.map((d) => d.data()).filter((d) => d.agare !== u.uid);
    },
    async satDelning(lista) {
      const u = kravInloggad();
      const egna = await F.getDocs(F.query(F.collection(db, "spel"), F.where("agare", "==", u.uid)));
      const batch = F.writeBatch(db);
      batch.update(F.doc(db, "anvandare", u.uid), { delad_med: lista });
      for (const d of egna.docs) batch.update(d.ref, { delad_med: lista });
      await batch.commit();
    },
    async sparaBild(dataUrl) {
      const u = kravInloggad();
      await F.updateDoc(F.doc(db, "anvandare", u.uid), { bild: dataUrl || F.deleteField() });
    },
    async raderaKonto() {
      const u = kravInloggad();
      const egna = await F.getDocs(F.query(F.collection(db, "spel"), F.where("agare", "==", u.uid)));
      const batch = F.writeBatch(db);
      for (const d of egna.docs) batch.delete(d.ref);
      batch.delete(F.doc(db, "anvandare", u.uid));
      await batch.commit();
      try {
        await A.deleteUser(u);
      } catch (e) {
        if (e.code === "auth/requires-recent-login") {
          throw new Error("Dina spel är raderade. Logga ut och in igen och tryck på knappen en gång till för att också radera själva kontot.");
        }
        throw e;
      }
    },

    // ---------- spelbolag ----------
    async minaGrupper() {
      const u = kravInloggad();
      const s = await F.getDocs(F.query(F.collection(db, "grupper"), F.where("medlem_uids", "array-contains", u.uid)));
      return s.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async skapaGrupp(namn, spelform, omgangId) {
      const u = kravInloggad();
      const p = await profilen();
      const ref = F.doc(F.collection(db, "grupper"));
      const kod = nyKod();
      const batch = F.writeBatch(db);
      batch.set(ref, { namn, spelform, skapare: u.uid, kassor: spelform === "kassa" ? u.uid : null,
        medlemmar: { [u.uid]: { namn: p.namn || u.displayName || u.email } }, medlem_uids: [u.uid], turordning: [u.uid],
        tur_start: omgangId, kod, skapad: new Date().toISOString() });
      batch.set(F.doc(db, "inbjudningar", kod), { gid: ref.id, namn });
      await batch.commit();
      return ref.id;
    },
    async inbjudan(kod) {
      kravInloggad();
      const s = await F.getDoc(F.doc(db, "inbjudningar", kod));
      return s.exists() ? s.data() : null;
    },
    async anslut(kod) {
      const u = kravInloggad();
      const inb = await this.inbjudan(kod);
      if (!inb) throw new Error("Inbjudningen finns inte längre – be om en ny länk.");
      const p = await profilen();
      await F.updateDoc(F.doc(db, "grupper", inb.gid), {
        medlem_uids: F.arrayUnion(u.uid), turordning: F.arrayUnion(u.uid),
        [`medlemmar.${u.uid}`]: { namn: p.namn || u.displayName || u.email }, anslut_kod: kod });
      return inb.gid;
    },
    uppdateraGrupp: (gid, falt) => F.updateDoc(F.doc(db, "grupper", gid), falt),
    async bytKod(grupp) {
      const kod = nyKod();
      const batch = F.writeBatch(db);
      if (grupp.kod) batch.delete(F.doc(db, "inbjudningar", grupp.kod));
      batch.set(F.doc(db, "inbjudningar", kod), { gid: grupp.id, namn: grupp.namn });
      batch.update(F.doc(db, "grupper", grupp.id), { kod });
      await batch.commit();
      return kod;
    },
    async lamnaGrupp(grupp) {
      const u = kravInloggad();
      await this.taBortMedlem(grupp, u.uid);
    },
    taBortMedlem: (grupp, uid) => F.updateDoc(F.doc(db, "grupper", grupp.id), {
      medlem_uids: F.arrayRemove(uid), turordning: F.arrayRemove(uid), [`medlemmar.${uid}`]: F.deleteField() }),
    async raderaGrupp(grupp) {
      const batch = F.writeBatch(db);
      for (const del of ["spel", "kassabok"]) {
        for (const d of (await F.getDocs(F.collection(db, "grupper", grupp.id, del))).docs) batch.delete(d.ref);
      }
      if (grupp.kod) batch.delete(F.doc(db, "inbjudningar", grupp.kod));
      batch.delete(F.doc(db, "grupper", grupp.id));
      await batch.commit();
    },
    async gruppSpel(gid) {
      return (await F.getDocs(F.collection(db, "grupper", gid, "spel"))).docs.map((d) => d.data());
    },
    async sparaGruppSpel(grupp, spel) {
      const u = kravInloggad();
      const p = await profilen();
      await F.setDoc(F.doc(db, "grupper", grupp.id, "spel", String(spel.omgang_id)),
        { ...spel, grupp_id: grupp.id, sparad_av: u.uid, sparad_av_namn: p.namn || u.displayName || u.email,
          deltagare: grupp.medlem_uids });
    },
    taBortGruppSpel: (gid, omgangId) => F.deleteDoc(F.doc(db, "grupper", gid, "spel", String(omgangId))),
    async kassabok(gid) {
      return (await F.getDocs(F.collection(db, "grupper", gid, "kassabok"))).docs
        .map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.datum < b.datum ? 1 : -1));
    },
    async laggTillPost(grupp, post) {
      const u = kravInloggad();
      await F.addDoc(F.collection(db, "grupper", grupp.id, "kassabok"),
        { ...post, av: u.uid, deltagare: grupp.medlem_uids, skapad: new Date().toISOString() });
    },
    taBortPost: (gid, id) => F.deleteDoc(F.doc(db, "grupper", gid, "kassabok", id)),
  };
}

// ---------- demoläge (?demo-konto) ----------

function demo() {
  const db = { profil: { namn: "Demo", epost: "demo@exempel.se", delad_med: [] }, spel: new Map(), delade: [],
    grupper: new Map(), inbjudningar: new Map(), gruppspel: new Map(), bok: new Map() };
  // Ett exempelbolag med påhittade medlemmar och en inbjudan som går att prova (#gamed-demokod)
  db.grupper.set("exempel", { id: "exempel", namn: "Exempelgänget", spelform: "tur", skapare: "anna", kassor: null,
    medlemmar: { anna: { namn: "Anna (exempel)" }, bo: { namn: "Bo (exempel)" } }, medlem_uids: ["anna", "bo"],
    turordning: ["anna", "bo"], tur_start: 4974, kod: "demokod" });
  db.inbjudningar.set("demokod", { gid: "exempel", namn: "Exempelgänget" });
  db.gruppspel.set("exempel", new Map()); db.bok.set("exempel", []);
  setTimeout(() => meddela(null), 0);
  return {
    loggaInGoogle: async () => meddela({ uid: "demo", namn: "Demo", epost: "demo@exempel.se", bild: db.profil.bild || null,
      egenBild: db.profil.bild || null, googleBild: null }),
    sparaBild: async (dataUrl) => { db.profil.bild = dataUrl; },
    skickaLank: async () => {},
    slutforLank: async () => {},
    loggaUt: async () => meddela(null),
    profil: async () => db.profil,
    sparaSpel: async (spel) => { db.spel.set(spel.omgang_id, { ...spel, agare: "demo", delad_med: db.profil.delad_med }); },
    taBortSpel: async (omgangId) => { db.spel.delete(omgangId); },
    minaSpel: async () => [...db.spel.values()],
    deladeSpel: async () => db.delade,
    satDelning: async (lista) => { db.profil.delad_med = lista; },
    raderaKonto: async () => { db.spel.clear(); meddela(null); },
    // Spelbolag: ett exempelbolag med två påhittade medlemmar, så att saldon och turordning syns
    minaGrupper: async () => [...db.grupper.values()].filter((g) => g.medlem_uids.includes("demo")),
    skapaGrupp: async (namn, spelform, omgangId) => {
      const id = `g${db.grupper.size + 1}`;
      const kod = nyKod();
      db.grupper.set(id, { id, namn, spelform, skapare: "demo", kassor: spelform === "kassa" ? "demo" : null,
        medlemmar: { demo: { namn: "Demo" } }, medlem_uids: ["demo"], turordning: ["demo"], tur_start: omgangId, kod });
      db.inbjudningar.set(kod, { gid: id, namn });
      db.gruppspel.set(id, new Map()); db.bok.set(id, []);
      return id;
    },
    inbjudan: async (kod) => db.inbjudningar.get(kod) || null,
    anslut: async (kod) => {
      const inb = db.inbjudningar.get(kod);
      if (!inb) throw new Error("Inbjudningen finns inte längre – be om en ny länk.");
      const g = db.grupper.get(inb.gid);
      if (!g.medlem_uids.includes("demo")) {
        g.medlem_uids.push("demo"); g.turordning.push("demo"); g.medlemmar.demo = { namn: "Demo" };
      }
      return inb.gid;
    },
    uppdateraGrupp: async (gid, falt) => { Object.assign(db.grupper.get(gid), falt); },
    bytKod: async (g) => {
      db.inbjudningar.delete(g.kod);
      const kod = nyKod();
      db.inbjudningar.set(kod, { gid: g.id, namn: g.namn });
      db.grupper.get(g.id).kod = kod;
      return kod;
    },
    lamnaGrupp: async (g) => { db.grupper.delete(g.id); },
    taBortMedlem: async (g, uid) => {
      const x = db.grupper.get(g.id);
      x.medlem_uids = x.medlem_uids.filter((u) => u !== uid);
      x.turordning = x.turordning.filter((u) => u !== uid);
      delete x.medlemmar[uid];
    },
    raderaGrupp: async (g) => { db.grupper.delete(g.id); },
    gruppSpel: async (gid) => [...(db.gruppspel.get(gid)?.values() || [])],
    sparaGruppSpel: async (g, spel) => {
      db.gruppspel.get(g.id).set(spel.omgang_id, { ...spel, grupp_id: g.id, sparad_av: "demo", sparad_av_namn: "Demo",
        deltagare: [...g.medlem_uids] });
    },
    taBortGruppSpel: async (gid, omgangId) => { db.gruppspel.get(gid).delete(omgangId); },
    kassabok: async (gid) => [...(db.bok.get(gid) || [])].sort((a, b) => (a.datum < b.datum ? 1 : -1)),
    laggTillPost: async (g, post) => {
      db.bok.get(g.id).push({ ...post, id: String(Math.random()), av: "demo", deltagare: [...g.medlem_uids] });
    },
    taBortPost: async (gid, id) => { db.bok.set(gid, db.bok.get(gid).filter((p) => p.id !== id)); },
    _db: db,
  };
}
