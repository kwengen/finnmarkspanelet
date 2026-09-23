#!/usr/bin/env node
/**
 * Verifiserer kommunenumrene for Finnmark mot SSBs klassifikasjons-API (KLASS)
 * og bygger en historisk kodekjede per kommune.
 *
 *   node scripts/ssb/regioner.mjs
 *
 * Bakgrunn: kommunenumrene i finnmark-datapanel.html er skrevet fra
 * hukommelsen. De MÅ verifiseres før ekte data hentes, ellers henter vi tall
 * for feil kommune uten å merke det. Kodene endret seg to ganger:
 *
 *   ≤2019   Finnmark fylke 20  → kommuner 20xx
 *   2020–23 Troms og Finnmark 54 → kommuner 54xx (sammen med Troms!)
 *   2024–   Finnmark fylke 56  → kommuner 56xx
 *
 * Fordi 54xx også inneholder Troms-kommunene kan vi ikke filtrere på prefiks i
 * den perioden. Vi matcher derfor på NAVN mot hvert tidspunkts fulle,
 * landsdekkende kodeliste — uavhengig for 2019, 2020 og 2024 — i stedet for å
 * kjede koder bakover via KLASS sitt /changes-endepunkt. Finnmark hadde ingen
 * kommunesammenslåinger i denne perioden, bare en fylkesdrevet omnummerering,
 * og et endepunkt for STRUKTURELLE endringer registrerer ikke nødvendigvis
 * en ren omnummerering — noe som ga tomme kodelister for alle år før 2024
 * uten at noe feilet underveis.
 *
 * Skriver scripts/ssb/data/regioner.json og rapporterer avvik mot påstanden i
 * HTML-fila. Skriptet retter ikke HTML-fila selv — det viser hva som må rettes.
 */
import { KLASS_BASE, hentJson, skrivJson } from "./lib.mjs";
import { mkdir } from "node:fs/promises";

const KLASSIFIKASJON = process.env.KLASS_KOMMUNE ?? "131";  // Standard for kommuneinndeling
const FINNMARK_2024 = "56";

/* Påstanden fra finnmark-datapanel.html, uverifisert. Ligger her for å kunne
   diffes — den er testens fasit-kandidat, ikke fasiten. */
const PÅSTAND = {
  hammerfest:  { navn: "Hammerfest",   ssb2024: "5601", ssb2020: "5406", ssb2019: ["2004", "2017"] },
  alta:        { navn: "Alta",         ssb2024: "5603", ssb2020: "5403", ssb2019: ["2012"] },
  sorvaranger: { navn: "Sør-Varanger", ssb2024: "5605", ssb2020: "5444", ssb2019: ["2030"] },
  vadso:       { navn: "Vadsø",        ssb2024: "5607", ssb2020: "5405", ssb2019: ["2003"] },
  karasjok:    { navn: "Karasjok",     ssb2024: "5610", ssb2020: "5437", ssb2019: ["2021"] },
  kautokeino:  { navn: "Kautokeino",   ssb2024: "5612", ssb2020: "5430", ssb2019: ["2011"] },
  loppa:       { navn: "Loppa",        ssb2024: "5614", ssb2020: "5414", ssb2019: ["2014"] },
  hasvik:      { navn: "Hasvik",       ssb2024: "5616", ssb2020: "5411", ssb2019: ["2015"] },
  masoy:       { navn: "Måsøy",        ssb2024: "5618", ssb2020: "5427", ssb2019: ["2018"] },
  nordkapp:    { navn: "Nordkapp",     ssb2024: "5620", ssb2020: "5435", ssb2019: ["2019"] },
  porsanger:   { navn: "Porsanger",    ssb2024: "5622", ssb2020: "5436", ssb2019: ["2020"] },
  lebesby:     { navn: "Lebesby",      ssb2024: "5624", ssb2020: "5438", ssb2019: ["2022"] },
  gamvik:      { navn: "Gamvik",       ssb2024: "5626", ssb2020: "5439", ssb2019: ["2023"] },
  tana:        { navn: "Tana",         ssb2024: "5628", ssb2020: "5441", ssb2019: ["2025"] },
  berlevag:    { navn: "Berlevåg",     ssb2024: "5630", ssb2020: "5440", ssb2019: ["2024"] },
  batsfjord:   { navn: "Båtsfjord",    ssb2024: "5632", ssb2020: "5443", ssb2019: ["2028"] },
  vardo:       { navn: "Vardø",        ssb2024: "5634", ssb2020: "5404", ssb2019: ["2002"] },
  nesseby:     { navn: "Nesseby",      ssb2024: "5636", ssb2020: "5442", ssb2019: ["2027"] },
};

const erKommunekode = k => /^\d{4}$/.test(k);

async function kodeliste(dato) {
  const url = `${KLASS_BASE}/classifications/${KLASSIFIKASJON}/codesAt?date=${dato}`;
  const svar = await hentJson(url);
  const koder = (svar.codes ?? []).filter(c => erKommunekode(c.code));
  if (!koder.length) {
    throw new Error(
      `KLASS-klassifikasjon ${KLASSIFIKASJON} ga ingen firesifrede koder for ${dato}.\n` +
      `Sannsynligvis er ${KLASSIFIKASJON} ikke «Standard for kommuneinndeling».\n` +
      `Finn riktig id på ${KLASS_BASE}/classifications?size=200 og sett KLASS_KOMMUNE.`);
  }
  return new Map(koder.map(c => [c.code, c.name]));
}

/* Navnematching, uavhengig per tidspunkt — se kommentaren øverst i fila for
   hvorfor dette erstattet en changes()-basert kodekjede. */
function normaliser(navn) {
  return navn.toLowerCase()
    .replace(/ø/g, "o").replace(/æ/g, "ae").replace(/å/g, "a")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+kommune$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function navneformer(navn) {
  const deler = navn.split(/\s+-\s+/).map(normaliser).filter(Boolean);
  return [...new Set([normaliser(navn), ...deler])];
}
const ALIAS_TIL_KEY = new Map();
for (const [key, p] of Object.entries(PÅSTAND)) {
  for (const form of navneformer(p.navn)) ALIAS_TIL_KEY.set(form, key);
}

/** Matcher en fullstendig, landsdekkende kodeliste mot PÅSTAND, ved navn. */
function matchAlle(kodeliste) {
  const kart = new Map(); // key -> kode
  for (const [kode, navn] of kodeliste) {
    for (const form of navneformer(navn)) {
      const key = ALIAS_TIL_KEY.get(form);
      if (key) kart.set(key, kode);
    }
  }
  return kart;
}

/* ── Hent ────────────────────────────────────────────────────────────────── */
console.log(`KLASS-klassifikasjon ${KLASSIFIKASJON}\n`);

const k2024 = await kodeliste("2024-01-01");
const k2020 = await kodeliste("2020-01-01");
const k2019 = await kodeliste("2019-01-01");

const kart2024 = matchAlle(k2024);
const kart2020 = matchAlle(k2020);
const kart2019 = matchAlle(k2019);

const finnmark2024 = [...k2024].filter(([kode]) => kode.startsWith(FINNMARK_2024));
console.log(`Finnmark 2024 (prefiks ${FINNMARK_2024}): ${finnmark2024.length} kommuner\n`);

/* ── Bygg fasit ──────────────────────────────────────────────────────────── */
const fasit = [];
for (const [key, p] of Object.entries(PÅSTAND)) {
  const kode2024 = kart2024.get(key) ?? null;
  fasit.push({
    key,
    navn: p.navn,
    navnSSB: kode2024 ? k2024.get(kode2024) : null,
    ssb2024: kode2024,
    ssb2020: kart2020.has(key) ? [kart2020.get(key)] : [],
    ssb2019: kart2019.has(key) ? [kart2019.get(key)] : [],
  });
}

/* ── Diff mot påstanden ──────────────────────────────────────────────────── */
const avvik = [];

for (const f of fasit) {
  const p = PÅSTAND[f.key];
  if (!f.ssb2024) {
    avvik.push(`${f.key}: fant ikke «${p.navn}» i KLASS sitt 2024-sett i det hele tatt.`);
    continue;
  }
  if (f.ssb2024 !== p.ssb2024) {
    avvik.push(`${f.key}: ssb2024 påstått ${p.ssb2024}, KLASS sier ${f.ssb2024}`);
  }
  const likt = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (!f.ssb2020.length) {
    avvik.push(`${f.key}: fant ikke «${p.navn}» i KLASS sitt 2020-sett i det hele tatt.`);
  } else if (!likt(f.ssb2020, [p.ssb2020])) {
    avvik.push(`${f.key}: ssb2020 påstått ${p.ssb2020}, KLASS sier ${f.ssb2020.join("+")}`);
  }
  if (!f.ssb2019.length) {
    avvik.push(`${f.key}: fant ikke «${p.navn}» i KLASS sitt 2019-sett i det hele tatt.`);
  } else if (!likt(f.ssb2019, p.ssb2019)) {
    avvik.push(`${f.key}: ssb2019 påstått ${p.ssb2019.join("+")}, KLASS sier ${f.ssb2019.join("+")}`);
  }
}

// Motsatt retning: en Finnmark-kommune i KLASS sitt 2024-sett som ikke
// matchet noe alias i PÅSTAND — mangler i registeret, eller feilstavet alias.
const treffKoder = new Set(fasit.map(f => f.ssb2024).filter(Boolean));
for (const [kode, navn] of finnmark2024) {
  if (!treffKoder.has(kode)) {
    avvik.push(`MANGLER I REGISTERET: ${kode} «${navn}» — finnes i Finnmark 2024, men matcher ingen PÅSTAND-nøkkel.`);
  }
}

/* ── Rapport ─────────────────────────────────────────────────────────────── */
console.log("kode  kommune                        2020      2019");
console.log("────  ─────────────────────────────  ────────  ──────────────");
for (const f of fasit) {
  console.log(
    `${(f.ssb2024 ?? "????").padEnd(4)}  ${(f.navnSSB ?? f.navn).slice(0, 29).padEnd(29)}  ` +
    `${f.ssb2020.join("+").padEnd(8)}  ${f.ssb2019.join("+")}`
  );
}

console.log("");
if (avvik.length) {
  console.log(`⚠️  ${avvik.length} avvik mellom KLASS og PÅSTAND:\n`);
  for (const a of avvik) console.log(`   ${a}`);
  console.log("\n   Rett PÅSTAND i dette skriptet og REGIONNAVN/REGISTER i lib/ssb/regioner.ts.");
} else {
  console.log("✓ Ingen avvik. Kommunenumrene stemmer overens med KLASS.");
}

await mkdir(new URL("./data/", import.meta.url), { recursive: true });
await skrivJson(new URL("./data/regioner.json", import.meta.url), {
  klassifikasjon: KLASSIFIKASJON,
  hentet: new Date().toISOString(),
  regioner: fasit,
  avvik,
});
console.log("\nSkrevet scripts/ssb/data/regioner.json");
if (avvik.length) process.exitCode = 1;
