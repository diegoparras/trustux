// test-crack-john.mjs — Integración REAL con John the Ripper (Tier 3 nativo). Crackea el Excel
// cifrado de ejemplo por diccionario en CPU. Se saltea si John no está instalado (para CI); acá,
// con JOHN_BIN apuntando al binario, corre de verdad.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAgile, hashOffice } from "../unlock-core/office-agile.js";
import { capacidades, crackJohn, formatoJohn, extraerHash } from "../unlock-core/crack-native.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = (f) => readFileSync(join(HERE, "..", "fixtures", "unlock", f));

let ok = 0;
const test = async (n, fn) => {
  try { await fn(); ok++; console.log(`  \x1b[32mok\x1b[0m  ${n}`); }
  catch (e) { console.error(`  \x1b[31mFALLA\x1b[0m  ${n}\n    ${e.message}`); process.exitCode = 1; }
};

console.log("crack-native — integración con John (Tier 3)");

await test("hashOffice: construye un $office$ que John reconoce como 'office'", () => {
  const hash = hashOffice(parseAgile(fx("excel-cifrado.xlsx")));
  assert.match(hash, /^\$office\$\*2013\*100000\*256\*16\*/);
  assert.equal(formatoJohn(hash), "office");
});

const caps = await capacidades();
if (!caps.john) {
  console.log("  \x1b[33m~\x1b[0m  John no instalado — se saltea el crack real (definí JOHN_BIN para correrlo)");
} else {
  await test("John: recupera la clave 'secreto' del Excel cifrado (CPU, sin OpenCL)", async () => {
    const hash = hashOffice(parseAgile(fx("excel-cifrado.xlsx")));
    const r = await crackJohn(hash, { wordlist: ["hola", "1234", "secreto", "otra"] });
    assert.equal(r.password, "secreto");
  });

  await test("John: recupera la clave de un ZIP cifrado (AES) vía zip2john", async () => {
    const hash = await extraerHash(fx("zip-cifrado.zip"), "zip", "zip-cifrado.zip");
    const r = await crackJohn(hash, { wordlist: ["hola", "secreto", "otra"] });
    assert.equal(r.password, "secreto");
  });
}

console.log(`\n${ok} OK`);
