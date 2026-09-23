/**
 * Felles hjelpefunksjoner for SSB-uttrekk.
 *
 * Ingen autentisering — SSBs API-er er åpne. Skriptene her er skrevet for å
 * UNDERSØKE kontrakten framfor å anta den, fordi de er utviklet i et miljø
 * uten nettverkstilgang til data.ssb.no. Alt som ikke kunne verifiseres er
 * markert, og skriptene rapporterer hva de faktisk fant.
 */

export const PX_BASE = "https://data.ssb.no/api/v0/no/table";
export const KLASS_BASE = "https://data.ssb.no/api/klass/v1";

/** SSB har kallgrense per IP. Vi holder god margin med en liten pause. */
const PAUSE_MS = 900;
let sisteKall = 0;

async function stagger() {
  const siden = Date.now() - sisteKall;
  if (siden < PAUSE_MS) await new Promise(r => setTimeout(r, PAUSE_MS - siden));
  sisteKall = Date.now();
}

function feilmelding(res, body) {
  const kort = typeof body === "string" ? body.slice(0, 400) : JSON.stringify(body).slice(0, 400);
  if (res.status === 403) return `HTTP 403 — spørringen kan være for stor, eller filteret er ugyldig.\n${kort}`;
  if (res.status === 404) return `HTTP 404 — tabellen eller ressursen finnes ikke på denne adressen.\n${kort}`;
  if (res.status === 429) return `HTTP 429 — for mange kall. Vent litt og prøv igjen.\n${kort}`;
  return `HTTP ${res.status}\n${kort}`;
}

export async function hentJson(url) {
  await stagger();
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const tekst = await res.text();
  if (!res.ok) throw new Error(`GET ${url}\n${feilmelding(res, tekst)}`);
  try { return JSON.parse(tekst); }
  catch { throw new Error(`GET ${url} ga ikke gyldig JSON:\n${tekst.slice(0, 300)}`); }
}

export async function postSpørring(tabell, spørring) {
  const url = `${PX_BASE}/${tabell}`;
  await stagger();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(spørring),
  });
  const tekst = await res.text();
  if (!res.ok) throw new Error(`POST ${url}\n${feilmelding(res, tekst)}\n\nSpørring:\n${JSON.stringify(spørring, null, 2)}`);
  try { return JSON.parse(tekst); }
  catch { throw new Error(`POST ${url} ga ikke gyldig JSON:\n${tekst.slice(0, 300)}`); }
}

/**
 * Flater ut et JSON-stat2-datasett til rader.
 *
 * JSON-stat lagrer verdiene i én flat liste i rad-hovedrekkefølge: siste
 * dimensjon varierer raskest. Vi regner oss derfor bakover gjennom
 * dimensjonene for hver indeks. Nullverdier hoppes over — SSB bruker dem for
 * celler som ikke finnes (f.eks. en kommune som ikke eksisterte det året).
 */
export function flatUt(ds) {
  if (!ds?.id || !ds?.size || ds.value === undefined) {
    throw new Error("Svaret ser ikke ut som json-stat2 (mangler id/size/value).");
  }
  const dims = ds.id.map(id => {
    const d = ds.dimension[id];
    const idx = d?.category?.index;
    const koder = Array.isArray(idx)
      ? idx
      : Object.keys(idx ?? {}).sort((a, b) => idx[a] - idx[b]);
    return { id, koder, etiketter: d?.category?.label ?? {} };
  });

  const antall = ds.size.reduce((a, b) => a * b, 1);
  const hentVerdi = Array.isArray(ds.value)
    ? i => ds.value[i]
    : i => ds.value[String(i)];

  const rader = [];
  for (let i = 0; i < antall; i++) {
    const v = hentVerdi(i);
    if (v === null || v === undefined) continue;
    let rest = i;
    const rad = { verdi: v };
    for (let d = dims.length - 1; d >= 0; d--) {
      const k = rest % ds.size[d];
      rest = Math.floor(rest / ds.size[d]);
      rad[dims[d].id] = dims[d].koder[k];
    }
    rader.push(rad);
  }
  return { rader, dims };
}

/** Leser metadata for en tabell: hvilke dimensjoner og verdier den har. */
export async function tabellMeta(tabell) {
  return hentJson(`${PX_BASE}/${tabell}`);
}

/**
 * Finner dimensjonen som matcher ett av flere mulige navn.
 * SSB er ikke helt konsekvent på tvers av tabeller (Region/Regioner,
 * Kjonn/Kjønn), så vi slår opp framfor å hardkode.
 */
export function finnDim(meta, kandidater) {
  const vars = meta?.variables ?? [];
  for (const k of kandidater) {
    const treff = vars.find(v =>
      v.code?.toLowerCase() === k.toLowerCase() ||
      v.text?.toLowerCase() === k.toLowerCase());
    if (treff) return treff;
  }
  return null;
}

export const skrivJson = (fil, data) =>
  import("node:fs/promises").then(fs => fs.writeFile(fil, JSON.stringify(data, null, 2) + "\n", "utf8"));
