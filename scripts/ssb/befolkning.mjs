#!/usr/bin/env node
/**
 * Henter befolkning etter kjønn og ettårig alder fra SSB-tabell 07459 og
 * bygger datasettet finnmark-datapanel.html trenger.
 *
 *   node scripts/ssb/regioner.mjs        # først: verifiser kommunenumrene
 *   node scripts/ssb/befolkning.mjs      # deretter: hent tallene
 *   node scripts/ssb/befolkning.mjs --fra 2010 --til 2024
 *
 * To valg er bevisste:
 *
 * 1. Vi henter ETTÅRIG alder og summerer til femårsgrupper selv. SSB har
 *    egne aggregatkoder, men de er ikke like på tvers av tabeller og kan
 *    endres. Egen summering gir samme svar hver gang, og gjør at vi kan regne
 *    ut andel 67+ og andel 0–19 eksakt — 67 er ikke en femårsgrense.
 *
 * 2. For hvert år brukes kommunekoden som GJALDT det året. En kommune kan
 *    ligge i tabellen med flere koder samtidig; å summere dem ville
 *    dobbelttalt. Hvis en annen kode enn årets likevel har tall, sier
 *    skriptet fra i stedet for å velge i stillhet.
 */
import { readFile, mkdir } from "node:fs/promises";
import { postSpørring, flatUt, tabellMeta, finnDim, skrivJson } from "./lib.mjs";

const TABELL = "07459";

const arg = (navn, fallback) => {
  const i = process.argv.indexOf(`--${navn}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const FRA = Number(arg("fra", 2015));
const TIL = Number(arg("til", 2024));
const ÅR = Array.from({ length: TIL - FRA + 1 }, (_, i) => String(FRA + i));

/* ── Regioner: bruk det verifiserte resultatet, aldri påstanden ──────────── */
let regioner;
try {
  const fil = JSON.parse(await readFile(new URL("./data/regioner.json", import.meta.url), "utf8"));
  regioner = fil.regioner.filter(r => r.key);
  if (fil.avvik?.length) {
    console.error(`⚠️  regioner.json har ${fil.avvik.length} uløste avvik. Rett REGIONS i HTML-fila og kjør regioner.mjs på nytt.`);
    process.exit(1);
  }
} catch {
  console.error("Fant ikke scripts/ssb/data/regioner.json. Kjør «node scripts/ssb/regioner.mjs» først.");
  process.exit(1);
}

/** Kommunekoden som gjaldt et gitt år. Returnerer flere ved sammenslåing. */
function vintage(r, år) {
  if (år >= 2024) return [r.ssb2024];
  if (år >= 2020) return r.ssb2020;
  return r.ssb2019;
}
const alleKoder = [...new Set(regioner.flatMap(r => [r.ssb2024, ...r.ssb2020, ...r.ssb2019]))];

/* ── Metadata: bekreft dimensjonsnavn og hvilke koder tabellen faktisk har ─ */
const meta = await tabellMeta(TABELL);
const dimRegion = finnDim(meta, ["Region", "Regioner", "region"]);
const dimKjonn  = finnDim(meta, ["Kjonn", "Kjønn", "Sex"]);
const dimAlder  = finnDim(meta, ["Alder", "Age"]);
const dimTid    = finnDim(meta, ["Tid", "Time", "År"]);
const dimInnhold = (meta.variables ?? []).find(v => v.code === "ContentsCode");

for (const [navn, d] of [["Region", dimRegion], ["Kjonn", dimKjonn], ["Alder", dimAlder], ["Tid", dimTid]]) {
  if (!d) {
    console.error(`Tabell ${TABELL} har ingen dimensjon som ligner «${navn}». Kjør: node scripts/ssb/inspect.mjs ${TABELL}`);
    process.exit(1);
  }
}

const advarsler = [];

const finnesIRegion = new Set(dimRegion.values);
const brukbareKoder = alleKoder.filter(k => finnesIRegion.has(k));
const ukjenteKoder = alleKoder.filter(k => !finnesIRegion.has(k));
if (ukjenteKoder.length) {
  advarsler.push(`Tabell ${TABELL} kjenner ikke kommunekodene ${ukjenteKoder.join(", ")}. De hoppes over.`);
}

const finnesITid = new Set(dimTid.values);
const årSomFinnes = ÅR.filter(y => finnesITid.has(y));
const årSomMangler = ÅR.filter(y => !finnesITid.has(y));
if (årSomMangler.length) {
  advarsler.push(`Tabell ${TABELL} har ikke årene ${årSomMangler.join(", ")}. De hoppes over.`);
}
if (!årSomFinnes.length) {
  console.error(`Ingen av årene ${FRA}–${TIL} finnes i tabell ${TABELL}. Tilgjengelig: ${dimTid.values[0]}–${dimTid.values.at(-1)}`);
  process.exit(1);
}

/* Ettårig alder: SSB koder dem tresifret ("000", "001", …). Aggregatkoder og
   «uoppgitt» ser annerledes ut og skal ikke være med. */
const alderKoder = dimAlder.values.filter(v => /^\d{3}$/.test(v) && Number(v) <= 130);
if (alderKoder.length < 90) {
  console.error(
    `Fant bare ${alderKoder.length} ettårige alderskoder i tabell ${TABELL}. ` +
    `Denne tabellen ser ut til å bruke aldersgrupper.\n` +
    `Kjør: node scripts/ssb/inspect.mjs ${TABELL} ${dimAlder.code}`);
  process.exit(1);
}
const alderUtelatt = dimAlder.values.filter(v => !alderKoder.includes(v));
if (alderUtelatt.length) {
  advarsler.push(`Alderskoder utelatt som ikke-ettårige: ${alderUtelatt.join(", ")}`);
}

/* Kjønn: vi vil ha menn og kvinner hver for seg, ikke totalen. */
const kjønnKart = {};
dimKjonn.values.forEach((v, i) => {
  const t = (dimKjonn.valueTexts?.[i] ?? "").toLowerCase();
  if (t.startsWith("mann") || t.startsWith("menn")) kjønnKart[v] = "m";
  else if (t.startsWith("kvinn")) kjønnKart[v] = "k";
});
if (Object.keys(kjønnKart).length !== 2) {
  console.error(`Klarte ikke å tolke kjønnsdimensjonen: ${JSON.stringify(dimKjonn.valueTexts)}`);
  process.exit(1);
}

const innholdKode = dimInnhold
  ? (dimInnhold.values.find((v, i) => /personer/i.test(dimInnhold.valueTexts?.[i] ?? v)) ?? dimInnhold.values[0])
  : null;

/* ── Hent, ett år av gangen ──────────────────────────────────────────────── */
const BÅND = (() => {
  const b = [];
  for (let a = 0; a < 90; a += 5) b.push({ key: `${a}_${a + 4}`, lo: a, hi: a + 4 });
  b.push({ key: "90p", lo: 90, hi: 999 });
  return b;
})();
const båndFor = alder => (alder >= 90 ? "90p" : `${Math.floor(alder / 5) * 5}_${Math.floor(alder / 5) * 5 + 4}`);

const spørring = år => ({
  query: [
    { code: dimRegion.code, selection: { filter: "item", values: brukbareKoder } },
    { code: dimKjonn.code,  selection: { filter: "item", values: Object.keys(kjønnKart) } },
    { code: dimAlder.code,  selection: { filter: "item", values: alderKoder } },
    ...(innholdKode ? [{ code: "ContentsCode", selection: { filter: "item", values: [innholdKode] } }] : []),
    { code: dimTid.code, selection: { filter: "item", values: [år] } },
  ],
  response: { format: "json-stat2" },
});

// "kode|år|kjønn|bånd" → antall, og "kode|år" → sum, for konfliktdeteksjon.
const råBånd = new Map();
const råSum = new Map();
const råAldersgrupper = new Map();  // "kode|år" → { under20, over67 }

console.log(`Henter tabell ${TABELL}: ${brukbareKoder.length} kommunekoder × ${alderKoder.length} aldre × 2 kjønn\n`);

for (const år of årSomFinnes) {
  const ds = await postSpørring(TABELL, spørring(år));
  const { rader } = flatUt(ds);

  for (const rad of rader) {
    const kode = rad[dimRegion.code];
    const kjønn = kjønnKart[rad[dimKjonn.code]];
    if (!kjønn) continue;
    const alder = Number(rad[dimAlder.code]);
    const antall = Number(rad.verdi) || 0;

    const bk = `${kode}|${år}|${kjønn}|${båndFor(alder)}`;
    råBånd.set(bk, (råBånd.get(bk) ?? 0) + antall);
    råSum.set(`${kode}|${år}`, (råSum.get(`${kode}|${år}`) ?? 0) + antall);

    const ak = `${kode}|${år}`;
    const a = råAldersgrupper.get(ak) ?? { under20: 0, over67: 0 };
    if (alder <= 19) a.under20 += antall;
    if (alder >= 67) a.over67 += antall;
    råAldersgrupper.set(ak, a);
  }
  console.log(`  ${år}  ${rader.length.toLocaleString("nb-NO")} celler`);
}

/* ── Sett sammen per kommune og år, med årets gjeldende kode ─────────────── */
const befolkning = [];   // [region, år, kjønn, bånd, antall]
const fakta = [];        // [region, år, indikator, verdi]
const kodebruk = {};

for (const r of regioner) {
  kodebruk[r.key] = {};
  for (const årStr of årSomFinnes) {
    const år = Number(årStr);
    const gjeldende = vintage(r, år).filter(k => brukbareKoder.includes(k));
    const medData = gjeldende.filter(k => (råSum.get(`${k}|${årStr}`) ?? 0) > 0);

    // Koder fra andre vintager som også har tall dette året — mistanke om
    // at SSB har publisert samme befolkning under to koder.
    const andreMedData = [r.ssb2024, ...r.ssb2020, ...r.ssb2019]
      .filter(k => !gjeldende.includes(k) && (råSum.get(`${k}|${årStr}`) ?? 0) > 0);

    let brukt = medData;
    if (!brukt.length && andreMedData.length) {
      brukt = andreMedData;
      advarsler.push(
        `${r.key} ${år}: gjeldende kode ${gjeldende.join("+") || "(ingen)"} har ingen tall. ` +
        `Bruker ${andreMedData.join("+")} i stedet — kontroller at tabellen er omkodet til ny inndeling.`);
    } else if (brukt.length && andreMedData.length) {
      advarsler.push(
        `${r.key} ${år}: både ${brukt.join("+")} og ${andreMedData.join("+")} har tall. ` +
        `Bruker gjeldende kode; de øvrige ignoreres for å unngå dobbelttelling.`);
    }
    if (!brukt.length) {
      advarsler.push(`${r.key} ${år}: ingen tall i tabell ${TABELL}.`);
      continue;
    }
    kodebruk[r.key][år] = brukt;

    let total = 0;
    for (const kjønn of ["m", "k"]) {
      for (const b of BÅND) {
        const antall = brukt.reduce((s, k) => s + (råBånd.get(`${k}|${årStr}|${kjønn}|${b.key}`) ?? 0), 0);
        befolkning.push([r.key, år, kjønn, b.key, antall]);
        total += antall;
      }
    }

    const agg = brukt.reduce((a, k) => {
      const v = råAldersgrupper.get(`${k}|${årStr}`) ?? { under20: 0, over67: 0 };
      return { under20: a.under20 + v.under20, over67: a.over67 + v.over67 };
    }, { under20: 0, over67: 0 });

    fakta.push([r.key, år, "folkemengde", total]);
    if (total > 0) {
      fakta.push([r.key, år, "andel0_19", +(agg.under20 / total * 100).toFixed(1)]);
      fakta.push([r.key, år, "andel67",   +(agg.over67  / total * 100).toFixed(1)]);
    }
  }
}

/* ── Kontroll: strukturen må summere til folkemengden ────────────────────── */
const folkemengde = new Map(fakta.filter(f => f[2] === "folkemengde").map(f => [`${f[0]}|${f[1]}`, f[3]]));
const strukturSum = new Map();
for (const [reg, år, , , antall] of befolkning) {
  strukturSum.set(`${reg}|${år}`, (strukturSum.get(`${reg}|${år}`) ?? 0) + antall);
}
let avvikTeller = 0;
for (const [nøkkel, sum] of strukturSum) {
  if (sum !== folkemengde.get(nøkkel)) {
    advarsler.push(`Kontrollfeil ${nøkkel}: aldersstruktur ${sum} ≠ folkemengde ${folkemengde.get(nøkkel)}`);
    avvikTeller++;
  }
}

/* ── Skriv ───────────────────────────────────────────────────────────────── */
await mkdir(new URL("./data/", import.meta.url), { recursive: true });
const ut = {
  kilde: "ssb:07459",
  tabell: TABELL,
  tabellnavn: meta.title,
  hentet: new Date().toISOString(),
  aar: årSomFinnes.map(Number),
  aldersbaand: BÅND.map(b => b.key),
  kolonner: {
    befolkning: ["region", "aar", "kjonn", "band", "antall"],
    fakta: ["region", "aar", "indikator", "verdi"],
  },
  kodebruk,
  advarsler,
  befolkning,
  fakta,
};
await skrivJson(new URL("./data/befolkning.json", import.meta.url), ut);

console.log(`\n${befolkning.length.toLocaleString("nb-NO")} strukturrader, ${fakta.length.toLocaleString("nb-NO")} faktarader.`);
console.log(`Kontroll: ${avvikTeller === 0 ? "✓ aldersstruktur summerer til folkemengde overalt" : `⚠️  ${avvikTeller} avvik`}`);
if (advarsler.length) {
  console.log(`\n⚠️  ${advarsler.length} advarsler:`);
  for (const a of advarsler.slice(0, 25)) console.log(`   ${a}`);
  if (advarsler.length > 25) console.log(`   … ${advarsler.length - 25} til (se befolkning.json)`);
}
console.log("\nSkrevet scripts/ssb/data/befolkning.json");
console.log("Neste steg: node scripts/ssb/bygg.mjs — legger dataene inn i finnmark-datapanel.html");
