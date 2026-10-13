// Inloggning och sparade spel (Mina spel) via Firebase Authentication och Firestore.
//
// Firebase laddas först när någon använder kontot, så resten av appen fungerar som vanligt utan det.
// Är FIREBASE_CONFIG inte ifylld (se FIREBASE.md) är kontot avstängt. Med ?demo-konto i adressen används
// en lokal låtsasdatabas i minnet, så att sidorna går att prova utan Firebase.
//
// Data i Firestore (se firestore.rules):
//   anvandare/{uid}            { namn, epost, delad_med: [e-post], skapad }
//   spel/{uid}_{omgang_id}     { agare, agare_namn, delad_med: [e-post], …spelet (se minaspel.js) }
// delad_med kopieras till varje spel, så att den man delat med kan hämta spelen med en enkel fråga.

import { FIREBASE_CONFIG } from "./firebase-config.js?v=20261013k";

const VERSION = "10.12.2";
const BAS = `https://www.gstatic.com/firebasejs/${VERSION}`;
const EPOST_NYCKEL = "stryktipsguiden-epostlank";
export const DEMO = new URLSearchParams(location.search).has("demo-konto");

export const aktiverat = () => DEMO || Boolean(FIREBASE_CONFIG);

let impl = null;
let anvandare = null;
const lyssnare = new Set();

/** Anropas med {uid, namn, epost} eller null när inloggningen ändras. Returnerar en avregistrering. */
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
  const fran = (u) => (u ? { uid: u.uid, namn: u.displayName || u.email, epost: (u.email || "").toLowerCase() } : null);
  A.onAuthStateChanged(auth, async (u) => {
    if (u) {   // se till att profilen finns
      const ref = F.doc(db, "anvandare", u.uid);
      const snap = await F.getDoc(ref);
      if (!snap.exists()) {
        await F.setDoc(ref, { namn: u.displayName || u.email, epost: (u.email || "").toLowerCase(), delad_med: [],
          skapad: new Date().toISOString() });
      }
    }
    meddela(fran(u));
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
  };
}

// ---------- demoläge (?demo-konto) ----------

function demo() {
  const db = { profil: { namn: "Demo", epost: "demo@exempel.se", delad_med: [] }, spel: new Map(), delade: [] };
  setTimeout(() => meddela(null), 0);
  return {
    loggaInGoogle: async () => meddela({ uid: "demo", namn: "Demo", epost: "demo@exempel.se" }),
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
    _db: db,
  };
}
