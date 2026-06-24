// test-xades.mjs — Contrato del motor XAdES: la factura firmada debe dar válida y la
// alterada inválida. Sin framework (estilo Selega): assert + node.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verificarXml } from "../firma-core/xades.js";
import { cargarCert } from "../firma-core/verify.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = (f) => readFileSync(join(ROOT, "fixtures", "xades", f));
const trustRoots = [cargarCert(fx("xades-root-ca.pem"))];
const run = (f) => verificarXml(fx(f).toString("utf8"), { trustRoots });

let ok = 0;
const test = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`  \x1b[32mok\x1b[0m  ${nombre}`); }
  catch (e) { console.error(`  \x1b[31mFALLA\x1b[0m  ${nombre}\n    ${e.message}`); process.exitCode = 1; }
};

console.log("xades — tabla de verdad");

await test("factura firmada → válida, íntegra, confiable, CUIT del firmante", async () => {
  const { firmas, global } = await run("factura-firmada.xml");
  assert.equal(global, "valida");
  assert.equal(firmas.length, 1);
  assert.equal(firmas[0].integridad.ok, true);
  assert.equal(firmas[0].cadena.confiable, true);
  assert.equal(firmas[0].firmante.cuit, "20-12345678-9");
});

await test("factura alterada → inválida (importe cambiado tras firmar)", async () => {
  const { firmas, global } = await run("factura-alterada.xml");
  assert.equal(global, "invalida");
  assert.equal(firmas[0].integridad.ok, false);
});

await test("sin trust store → observada (íntegra pero cadena no evaluada)", async () => {
  const { firmas, global } = await verificarXml(fx("factura-firmada.xml").toString("utf8"), { trustRoots: [] });
  assert.equal(global, "observada");
  assert.equal(firmas[0].integridad.ok, true);
  assert.equal(firmas[0].cadena.confiable, false);
});

console.log(`\n${ok}/3 OK`);
