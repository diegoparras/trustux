// test-core.mjs — Contrato del motor: cada fixture debe dar su veredicto esperado.
// Sin framework (estilo Selega): assert + node test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verificar, cargarCert } from "../firma-core/verify.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = (f) => readFileSync(join(ROOT, "fixtures", f));
const trustRoots = [cargarCert(fx("trust/test-root-ca.pem"))];
const run = (f) => verificar(fx(f), { trustRoots });

let ok = 0;
const test = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`  ✓ ${nombre}`); }
  catch (e) { console.error(`  ✗ ${nombre}\n    ${e.message}`); process.exitCode = 1; }
};

console.log("firma-core — tabla de verdad");

await test("01 íntegro → 🟢 válida, íntegra, confiable, CUIT del contador", async () => {
  const { firmas, global } = await run("01-firmado-integro.pdf");
  assert.equal(global, "valida");
  assert.equal(firmas.length, 1);
  assert.equal(firmas[0].integridad.ok, true);
  assert.equal(firmas[0].cadena.confiable, true);
  assert.equal(firmas[0].firmante.cuit, "20-12345678-9");
});

await test("02 alterado → 🔴 inválida, integridad rota (saldo post-firma)", async () => {
  const { firmas, global } = await run("02-firmado-alterado.pdf");
  assert.equal(global, "invalida");
  assert.equal(firmas[0].integridad.ok, false);
  assert.equal(firmas[0].integridad.modificadoPostFirma, true);
});

await test("03 doble firma → 2 firmas válidas (contador + síndico)", async () => {
  const { firmas, global } = await run("03-doble-firma.pdf");
  assert.equal(global, "valida");
  assert.equal(firmas.length, 2);
  assert.ok(firmas.every((f) => f.integridad.ok && f.cadena.confiable));
  assert.deepEqual(firmas.map((f) => f.firmante.cuit).sort(), ["20-12345678-9", "27-23456789-4"]);
});

await test("04 con sello → 🟢 válida e íntegra", async () => {
  const { firmas, global } = await run("04-firmado-con-sello.pdf");
  assert.equal(global, "valida");
  assert.equal(firmas[0].integridad.ok, true);
});

await test("sin trust store → 🟡 observada (íntegra pero cadena no evaluada)", async () => {
  const { firmas, global } = await verificar(fx("01-firmado-integro.pdf"), { trustRoots: [] });
  assert.equal(global, "observada");
  assert.equal(firmas[0].integridad.ok, true);
  assert.equal(firmas[0].cadena.confiable, false);
});

console.log(`\n${ok}/5 OK`);
