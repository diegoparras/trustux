// test-standalone.mjs — El adaptador del servidor verifica PDF y XML contra el trust store
// del standalone (trust/), detectando el tipo por contenido. Sin levantar el HTTP.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verificarDocumento, trustInfo } from "../server/verificar.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = (p) => readFileSync(join(ROOT, p));

let ok = 0;
const test = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`  \x1b[32mok\x1b[0m  ${nombre}`); }
  catch (e) { console.error(`  \x1b[31mFALLA\x1b[0m  ${nombre}\n    ${e.message}`); process.exitCode = 1; }
};

console.log("standalone — adaptador del servidor");

await test("trust store del standalone cargado", () => {
  assert.ok(trustInfo().length >= 1);
});

await test("PDF firmado → detecta PAdES y da válida", async () => {
  const r = await verificarDocumento(fx("fixtures/01-firmado-integro.pdf"));
  assert.match(r.tipo, /PAdES/);
  assert.equal(r.global, "valida");
});

await test("factura XML firmada → detecta XAdES y da válida", async () => {
  const r = await verificarDocumento(fx("fixtures/xades/factura-firmada.xml"));
  assert.match(r.tipo, /XAdES/);
  assert.equal(r.global, "valida");
});

await test("factura XML alterada → inválida", async () => {
  const r = await verificarDocumento(fx("fixtures/xades/factura-alterada.xml"));
  assert.equal(r.global, "invalida");
});

await test("CMS .p7m firmado → detecta CAdES y da válida", async () => {
  const r = await verificarDocumento(fx("fixtures/07-cades.p7m"));
  assert.match(r.tipo, /CAdES/);
  assert.equal(r.global, "valida");
});

await test("contenido no firmable → error de formato", async () => {
  await assert.rejects(() => verificarDocumento(Buffer.from("hola mundo")), /Formato no reconocido/);
});

console.log(`\n${ok}/6 OK`);
