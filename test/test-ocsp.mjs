// test-ocsp.mjs — Validación OCSP: una respuesta "vigente" deja la firma válida; una "revocada"
// la vuelve inválida (precede a la CRL). Sin red: la respuesta ya viene firmada por la raíz.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verificar, cargarCert, certDelFirmante } from "../firma-core/verify.js";
import { validarRespuestaOCSP } from "../firma-core/ocsp.js";
import { extraerFirmas, toAB } from "../firma-core/pades.js";
import { ContentInfo, SignedData } from "pkijs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = (f) => readFileSync(join(ROOT, "fixtures", f));
const trustRoots = [cargarCert(fx("trust/test-root-ca.pem"))];
const good = fx("ocsp/ocsp-good.der");
const revoked = fx("ocsp/ocsp-revoked.der");

let ok = 0;
const test = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`  \x1b[32mok\x1b[0m  ${nombre}`); }
  catch (e) { console.error(`  \x1b[31mFALLA\x1b[0m  ${nombre}\n    ${e.message}`); process.exitCode = 1; }
};

// El cert del contador (firmante del PDF 01) y su emisor (la raíz).
const f = extraerFirmas(fx("01-firmado-integro.pdf"))[0];
const sd = new SignedData({ schema: ContentInfo.fromBER(toAB(f.cms)).content });
const leaf = certDelFirmante(sd);

console.log("ocsp — validación de estado");

await test("respuesta 'vigente' → aplicable, no revocado", async () => {
  const r = await validarRespuestaOCSP(leaf, trustRoots[0], good);
  assert.equal(r.aplicable, true);
  assert.equal(r.revocado, false);
});

await test("respuesta 'revocada' → aplicable, revocado", async () => {
  const r = await validarRespuestaOCSP(leaf, trustRoots[0], revoked);
  assert.equal(r.aplicable, true);
  assert.equal(r.revocado, true);
});

await test("PDF + OCSP vigente → válida, método ocsp", async () => {
  const { firmas, global } = await verificar(fx("01-firmado-integro.pdf"), { trustRoots, ocsps: [good] });
  assert.equal(global, "valida");
  assert.equal(firmas[0].revocacion.metodo, "ocsp");
  assert.equal(firmas[0].revocacion.revocado, false);
});

await test("PDF + OCSP revocada → inválida (precede a la integridad OK)", async () => {
  const { firmas, global } = await verificar(fx("01-firmado-integro.pdf"), { trustRoots, ocsps: [revoked] });
  assert.equal(global, "invalida");
  assert.equal(firmas[0].revocacion.revocado, true);
});

console.log(`\n${ok}/4 OK`);
