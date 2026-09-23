#!/usr/bin/env node
/**
 * Legger hentede SSB-data inn i finnmark-datapanel.html.
 *
 *   node scripts/ssb/bygg.mjs
 *   node scripts/ssb/bygg.mjs --ut docs/finnmarkspanelet.html   # ikke overskriv kilden
 *   node scripts/ssb/bygg.mjs --tom                             # tilbake til demodata
 *
 * Alt i scripts/ssb/data/*.json leses og legges inn i JSON-blokka med
 * id="ssb-data". HTML-fila kjører like godt uten — da genererer den demodata i
 * samme form — så den er trygg å åpne fra disk når som helst.
 *
 * Filnavnet blir temanøkkelen: befolkning.json → SSB.befolkning. regioner.json
 * hoppes over; den er input til hentskriptene, ikke data til siden.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";

const HTML = new URL("../../finnmark-datapanel.html", import.meta.url);
const DATA = new URL("./data/", import.meta.url);
const IKKE_DATA = new Set(["regioner.json"]);

const arg = (navn) => {
  const i = process.argv.indexOf(`--${navn}`);
  return i > -1 ? (process.argv[i + 1] ?? true) : null;
};
const tøm = Boolean(arg("tom"));
const utFil = arg("ut") && typeof arg("ut") === "string"
  ? new URL(arg("ut"), new URL("../../", import.meta.url))
  : HTML;

let bunt = {};
if (!tøm) {
  let filer = [];
  try {
    filer = (await readdir(DATA)).filter(f => f.endsWith(".json") && !IKKE_DATA.has(f));
  } catch {
    console.error("Fant ingen scripts/ssb/data/. Kjør et hentskript først, f.eks. befolkning.mjs.");
    process.exit(1);
  }
  if (!filer.length) {
    console.error("scripts/ssb/data/ inneholder ingen datasett. Kjør f.eks. befolkning.mjs.");
    process.exit(1);
  }

  for (const f of filer) {
    const tema = f.replace(/\.json$/, "");
    const d = JSON.parse(await readFile(new URL(f, DATA), "utf8"));
    if (d.advarsler?.length) {
      console.log(`⚠️  ${f}: ${d.advarsler.length} advarsler fra hentingen — se fila.`);
    }
    // Bare feltene siden faktisk leser. Resten er sporbarhet vi ikke trenger
    // å frakte inn i HTML-fila.
    bunt[tema] = {
      kilde: d.kilde,
      hentet: d.hentet,
      aar: d.aar,
      ...(d.fakta ? { fakta: d.fakta } : {}),
      ...(d.befolkning ? { befolkning: d.befolkning } : {}),
      ...(d.resultater ? { resultater: d.resultater } : {}),
    };
    const n = (d.fakta?.length ?? 0) + (d.befolkning?.length ?? 0) + (d.resultater?.length ?? 0);
    console.log(`  ${tema.padEnd(12)} ${n.toLocaleString("nb-NO")} rader  ${d.aar?.[0]}–${d.aar?.at(-1)}`);
  }
}

/* </script> inne i JSON ville avsluttet script-taggen tidlig. Escapes alltid,
   selv om dataene våre ikke inneholder det i dag. */
const json = JSON.stringify(bunt).replace(/<\//g, "<\\/");

const html = await readFile(HTML, "utf8");
const mønster = /(<script type="application\/json" id="ssb-data">)([\s\S]*?)(<\/script>)/;
if (!mønster.test(html)) {
  console.error('Fant ikke <script type="application/json" id="ssb-data"> i finnmark-datapanel.html.');
  process.exit(1);
}
await writeFile(utFil, html.replace(mønster, `$1${json}$3`), "utf8");

const kb = Math.round(json.length / 1024);
console.log(
  tøm
    ? `\nTømt datablokka. ${utFil.pathname.split("/").pop()} viser demodata igjen.`
    : `\nLagt inn ${kb} kB i ${utFil.pathname.split("/").pop()}. Åpne fila i nettleser for å kontrollere.`
);
