// test-core.mjs — Contrato del motor: cada fixture debe dar su veredicto esperado.
// Sin framework (estilo Selega): assert + node test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verificar, cargarCert, cargarCRL } from "../firma-core/verify.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = (f) => readFileSync(join(ROOT, "fixtures", f));
const trustRoots = [cargarCert(fx("trust/test-root-ca.pem"))];
const crls = [cargarCRL(fx("trust/test.crl"))];
const run = (f) => verificar(fx(f), { trustRoots, crls });

let ok = 0;
const test = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`  \x1b[32mok\x1b[0m  ${nombre}`); }
  catch (e) { console.error(`  \x1b[31mFALLA\x1b[0m  ${nombre}\n    ${e.message}`); process.exitCode = 1; }
};

console.log("firma-core — tabla de verdad");

await test("01 íntegro → válida, íntegra, confiable, CUIT del contador", async () => {
  const { firmas, global } = await run("01-firmado-integro.pdf");
  assert.equal(global, "valida");
  assert.equal(firmas.length, 1);
  assert.equal(firmas[0].integridad.ok, true);
  assert.equal(firmas[0].cadena.confiable, true);
  assert.equal(firmas[0].firmante.cuit, "20-12345678-9");
});

await test("02 alterado → inválida, integridad rota (saldo post-firma)", async () => {
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

await test("04 con sello → válida, íntegra, con sello de tiempo presente", async () => {
  const { firmas, global } = await run("04-firmado-con-sello.pdf");
  assert.equal(global, "valida");
  assert.equal(firmas[0].integridad.ok, true);
  assert.equal(firmas[0].selloTiempo.presente, true);
  assert.equal(firmas[0].algoritmo, "SHA-256");
});

await test("05 SHA-1 → inválida por algoritmo de digest inseguro", async () => {
  const { firmas, global } = await run("05-firma-sha1.pdf");
  assert.equal(global, "invalida");
  assert.equal(firmas[0].algoritmo, "SHA-1");
  assert.equal(firmas[0].integridad.ok, false);
  assert.ok(firmas[0].observaciones.some((o) => /inseguro/i.test(o)));
});

await test("06 revocado → inválida (cert en la CRL) pese a integridad y cadena OK", async () => {
  const { firmas, global } = await run("06-firmado-revocado.pdf");
  assert.equal(global, "invalida");
  assert.equal(firmas[0].integridad.ok, true);
  assert.equal(firmas[0].cadena.confiable, true);
  assert.equal(firmas[0].revocacion.revocado, true);
});

await test("01 contra CRL → revocación verificada, no revocado", async () => {
  const { firmas } = await run("01-firmado-integro.pdf");
  assert.equal(firmas[0].revocacion.revocado, false);
  assert.equal(firmas[0].revocacion.metodo, "crl-provista");
});

await test("sin trust store → observada (íntegra pero cadena no evaluada)", async () => {
  const { firmas, global } = await verificar(fx("01-firmado-integro.pdf"), { trustRoots: [] });
  assert.equal(global, "observada");
  assert.equal(firmas[0].integridad.ok, true);
  assert.equal(firmas[0].cadena.confiable, false);
});

console.log(`\n${ok}/8 OK`);
