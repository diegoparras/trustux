// test-cades.mjs — Contrato del motor CAdES (CMS / PKCS#7): el .p7m íntegro da válida y el
// alterado inválida. Reusa el trust store y la CRL de los fixtures PAdES.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verificarCms } from "../firma-core/cades.js";
import { cargarCert, cargarCRL } from "../firma-core/verify.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = (f) => readFileSync(join(ROOT, "fixtures", f));
const trustRoots = [cargarCert(fx("trust/test-root-ca.pem"))];
const crls = [cargarCRL(fx("trust/test.crl"))];
const run = (f) => verificarCms(fx(f), { trustRoots, crls });

let ok = 0;
const test = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`  \x1b[32mok\x1b[0m  ${nombre}`); }
  catch (e) { console.error(`  \x1b[31mFALLA\x1b[0m  ${nombre}\n    ${e.message}`); process.exitCode = 1; }
};

console.log("cades — tabla de verdad");

await test("07 .p7m íntegro → válida, confiable, CUIT del firmante", async () => {
  const { firmas, global } = await run("07-cades.p7m");
  assert.equal(global, "valida");
  assert.equal(firmas[0].integridad.ok, true);
  assert.equal(firmas[0].cadena.confiable, true);
  assert.equal(firmas[0].firmante.cuit, "20-12345678-9");
});

await test("08 .p7m alterado → inválida (contenido cambiado tras firmar)", async () => {
  const { firmas, global } = await run("08-cades-alterado.p7m");
  assert.equal(global, "invalida");
  assert.equal(firmas[0].integridad.ok, false);
});

await test("sin trust store → observada (íntegra pero cadena no evaluada)", async () => {
  const { firmas, global } = await verificarCms(fx("07-cades.p7m"), { trustRoots: [] });
  assert.equal(global, "observada");
  assert.equal(firmas[0].integridad.ok, true);
  assert.equal(firmas[0].cadena.confiable, false);
});

console.log(`\n${ok}/3 OK`);
