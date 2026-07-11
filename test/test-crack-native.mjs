// test-crack-native.mjs — El "cerebro" del motor nativo (sin ejecutar binarios): mapeo de hash a
// modo de hashcat, marca de "garantizado" (llaves cortas), parseo de resultado y de progreso, y
// que la detección de binarios devuelva un estado coherente en cualquier equipo.
import assert from "node:assert/strict";
import { modoHashcat, parseCrackShow, progresoHashcat, capacidades, EXTRACTOR } from "../unlock-core/crack-native.js";

let ok = 0;
const test = async (n, fn) => {
  try { await fn(); ok++; console.log(`  \x1b[32mok\x1b[0m  ${n}`); }
  catch (e) { console.error(`  \x1b[31mFALLA\x1b[0m  ${n}\n    ${e.message}`); process.exitCode = 1; }
};

console.log("crack-native — cerebro (sin binarios)");

await test("modoHashcat: Office moderno 2007/2010/2013 → 9400/9500/9600", () => {
  assert.equal(modoHashcat("$office$*2007*20*128*16*abc").modo, 9400);
  assert.equal(modoHashcat("$office$*2010*100000*128*16*abc").modo, 9500);
  assert.equal(modoHashcat("$office$*2013*100000*256*16*abc").modo, 9600);
});

await test("modoHashcat: Office 97-2003 (oldoffice) → garantizado (llave 40 bits)", () => {
  const m = modoHashcat("$oldoffice$1*abc*def*ghi");
  assert.equal(m.modo, 9700);
  assert.equal(m.garantizado, true);
});

await test("modoHashcat: PDF RC4 40-bit → garantizado; AES-256 → no", () => {
  assert.equal(modoHashcat("$pdf$1*2*40*-1*0*16*aa*32*bb").garantizado, true);
  assert.equal(modoHashcat("$pdf$5*6*256*-1*1*16*aa*127*bb").garantizado, false);
});

await test("modoHashcat: ZIP AES → 13600; ZipCrypto → 17225; RAR5 → 13000", () => {
  assert.equal(modoHashcat("$zip2$*0*3*0*aa*bb*cc*dd*$/zip2$").modo, 13600);
  assert.equal(modoHashcat("$pkzip2$1*1*2*0*aa*bb*$/pkzip2$").modo, 17225);
  assert.equal(modoHashcat("$rar5$16*aa*8*bb*16*cc").modo, 13000);
});

await test("modoHashcat: hash desconocido → null", () => {
  assert.equal(modoHashcat("no-es-un-hash"), null);
});

await test("parseCrackShow: extrae la clave después del último ':'", () => {
  assert.equal(parseCrackShow("$office$*2013*...:secreto"), "secreto");
  assert.equal(parseCrackShow("hash1:mala\nhash2:buena"), "buena");
  assert.equal(parseCrackShow("sin dos puntos"), null);
});

await test("progresoHashcat: lee progreso de una línea --status-json", () => {
  assert.equal(progresoHashcat('{"progress":[50,200]}'), 0.25);
  assert.equal(progresoHashcat("linea no-json"), null);
});

await test("EXTRACTOR: hay un *2john por familia", () => {
  assert.equal(EXTRACTOR.office, "office2john");
  assert.equal(EXTRACTOR.pdf, "pdf2john");
});

await test("capacidades(): devuelve un estado booleano coherente en este equipo", async () => {
  const c = await capacidades();
  for (const k of ["hashcat", "john", "bkcrack", "qpdf", "alguno"]) assert.equal(typeof c[k], "boolean");
});

console.log(`\n${ok}/9 OK`);
