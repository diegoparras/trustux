// test-goodunluck.mjs — Contrato del módulo de recuperación (Fase 1: Tier 1 + Tier 2 Office/PDF).
// Usa un config aislado (temporal) para no ensuciar el real ni la auditoría.
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, "_gu-cfg");
process.env.GOODUNLUCK_CONFIG_DIR = TMP;   // rutas lazy → basta fijarlo antes de llamar

const { analizar, desbloquear, auditoria } = await import("../server/goodunluck.js");
const JSZip = (await import("jszip")).default;

const fx = (f) => readFileSync(join(HERE, "..", "fixtures", "unlock", f));
const ok = { motivo: "recuperar balance de la organización", propiedad: true };

let pasados = 0;
const test = async (n, fn) => {
  try { await fn(); pasados++; console.log(`  \x1b[32mok\x1b[0m  ${n}`); }
  catch (e) { console.error(`  \x1b[31mFALLA\x1b[0m  ${n}\n    ${e.message}`); process.exitCode = 1; }
};

console.log("goodunluck — recuperación (Fase 1)");

await test("Excel: analizar detecta protecciones y acción quitar-restricción", async () => {
  const a = await analizar(fx("excel-protegido.xlsx"), "excel-protegido.xlsx");
  assert.equal(a.familia, "office");
  assert.ok(a.protecciones.length >= 1);
  assert.ok(a.acciones.includes("quitar-restriccion"));
});

await test("Excel Tier 1: quita la protección de hoja/libro", async () => {
  const r = await desbloquear(fx("excel-protegido.xlsx"), "excel-protegido.xlsx", { tier: 1, ...ok });
  const z = await JSZip.loadAsync(r.archivo);
  const xml = await z.file("xl/worksheets/sheet1.xml").async("string");
  assert.ok(!xml.includes("<sheetProtection"));
  assert.match(r.nombreSalida, /desbloqueado\.xlsx$/);
});

await test("Word Tier 1: quita restrict-editing (documentProtection)", async () => {
  const r = await desbloquear(fx("word-restringido.docx"), "word-restringido.docx", { tier: 1, ...ok });
  const z = await JSZip.loadAsync(r.archivo);
  assert.ok(!(await z.file("word/settings.xml").async("string")).includes("documentProtection"));
});

await test("PDF Tier 1: quita permisos (owner-password) sin la clave", async () => {
  const r = await desbloquear(fx("pdf-permisos.pdf"), "pdf-permisos.pdf", { tier: 1, ...ok });
  assert.ok(!r.archivo.includes(Buffer.from("/Encrypt")));
});

await test("PDF Tier 2: descifra con la clave de apertura conocida", async () => {
  const r = await desbloquear(fx("pdf-clave.pdf"), "pdf-clave.pdf", { tier: 2, password: "abrime", ...ok });
  assert.ok(!r.archivo.includes(Buffer.from("/Encrypt")));
});

await test("PDF Tier 2: clave incorrecta → error de clave", async () => {
  await assert.rejects(() => desbloquear(fx("pdf-clave.pdf"), "x.pdf", { tier: 2, password: "malo", ...ok }),
    (e) => e.code === "clave");
});

await test("Salvaguarda: sin motivo → rechazado", async () => {
  await assert.rejects(() => desbloquear(fx("excel-protegido.xlsx"), "x.xlsx", { tier: 1, propiedad: true }),
    (e) => e.code === "motivo");
});

await test("Autorización: rol 'agente' no puede PDF Tier 2", async () => {
  await assert.rejects(() => desbloquear(fx("pdf-clave.pdf"), "x.pdf", { tier: 2, password: "abrime", ...ok, usuario: { role: "agente" } }),
    (e) => e.code === "autorizacion");
});

await test("Auditoría: registra las operaciones", () => {
  assert.ok(auditoria().length >= 4);
});

console.log(`\n${pasados}/9 OK`);
rmSync(TMP, { recursive: true, force: true });
