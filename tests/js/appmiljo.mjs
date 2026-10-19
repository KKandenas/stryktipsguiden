// Hjälp för röktesterna av appen (app.test.mjs, app-demo.test.mjs): kupongen i olika lägen och laddning
// av docs/index.html + docs/app.js i minidom.
import { readFileSync } from "node:fs";
import { installera } from "./minidom.mjs";

const DOCS = new URL("../../docs/", import.meta.url);
const las = (f) => readFileSync(new URL(f, DOCS), "utf8");
const json = (f) => JSON.parse(las(f));

const HTML = las("index.html");
export const EXEMPEL = json("exempel-kupong.json");
const HISTORIK = json("historik.json");
const SENASTE = json("senaste.json");

/** Exempelkupongen i ett visst läge, så som pipeline/export.py skriver den. */
export function kupong(status) {
  const k = structuredClone(EXEMPEL);
  k.omgang.status = status;
  if (status !== "oppen") k.omgang.frusen = "2026-10-10T12:24:21Z";
  if (status === "avgjord") {
    const tecken = ["1", "X", "2"];
    k.matcher.forEach((m, i) => {
      m.resultat = tecken[i % 3];
      m.mal = { 1: "2-1", X: "1-1", 2: "0-2" }[m.resultat];
    });
    k.omgang.utdelning = { 13: 59266.0, 12: 1302.0, 11: 115.0, 10: 31.0 };
    k.omgang.vinnare = { 13: 77, 12: 2104, 11: 20311, 10: 112040 };
  }
  return k;
}

let korning = 0;

/** Laddar appen med kupong.json = k. Varje körning får en egen instans av app.js (egen query-sträng). */
export async function laddaApp(k, sok = "") {
  const miljo = installera({
    html: HTML,
    url: `https://exempel.test/${sok}`,
    filer: { "kupong.json": k, "exempel-kupong.json": EXEMPEL, "historik.json": HISTORIK, "senaste.json": SENASTE },
  });
  await import(new URL(`app.js?rok=${++korning}`, DOCS));
  await miljo.vanta();
  return miljo;
}

export const $ = (miljo, id) => miljo.document.getElementById(id);
export const felText = (miljo) => miljo.fel.join("\n\n");
