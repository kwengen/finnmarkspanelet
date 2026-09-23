#!/usr/bin/env node
/**
 * Undersøker en SSB-tabell FØR vi henter data fra den.
 *
 *   node scripts/ssb/inspect.mjs 07459
 *   node scripts/ssb/inspect.mjs 07459 Alder        # vis alle verdier i én dimensjon
 *
 * Hensikten er å bekrefte antagelser i stedet for å stole på dem: hvilke
 * dimensjoner tabellen faktisk har, hva de heter, og hvilke koder som finnes.
 * Alle hentskriptene i denne mappa er skrevet mot det denne skriver ut.
 */
import { tabellMeta } from "./lib.mjs";

const [tabell, dimFilter] = process.argv.slice(2);

if (!tabell) {
  console.error("Bruk: node scripts/ssb/inspect.mjs <tabellnummer> [dimensjon]");
  process.exit(1);
}

const meta = await tabellMeta(tabell);

console.log(`\nTabell ${tabell}: ${meta.title}\n`);

for (const v of meta.variables ?? []) {
  const n = v.values?.length ?? 0;
  const merker = [
    v.elimination ? "kan utelates" : null,
    v.time ? "tidsdimensjon" : null,
  ].filter(Boolean);

  console.log(`  ${v.code}  «${v.text}»  ${n} verdier${merker.length ? `  [${merker.join(", ")}]` : ""}`);

  const visAlle = dimFilter && v.code.toLowerCase() === dimFilter.toLowerCase();
  const vis = visAlle ? n : Math.min(n, 8);

  for (let i = 0; i < vis; i++) {
    console.log(`      ${v.values[i].padEnd(10)} ${v.valueTexts?.[i] ?? ""}`);
  }
  if (!visAlle && n > vis) {
    console.log(`      … ${n - vis} til. Kjør med «${v.code}» som andre argument for å se alle.`);
    console.log(`      siste: ${v.values[n - 1]}  ${v.valueTexts?.[n - 1] ?? ""}`);
  }
  console.log("");
}

/* Cellegrensen er den vanligste grunnen til at et uttrekk feiler med 403.
   Vi regner ut det fulle produktet, slik at det er tydelig hvor mye som må
   filtreres bort — og hvor mye vi kan hente per kall. */
const totalt = (meta.variables ?? []).reduce((a, v) => a * (v.values?.length ?? 1), 1);
console.log(`  Fullt kryssprodukt: ${totalt.toLocaleString("nb-NO")} celler.`);
console.log(`  SSB avviser uttrekk over ca. 300 000 celler — filtrer eller del opp.\n`);
