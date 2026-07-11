// test-goodunluck.mjs — Contrato del módulo de recuperación (Fase 1: Tier 1 + Tier 2 Office/PDF).
// Usa un config aislado (temporal) para no ensuciar el real ni la auditoría.
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, "_gu-cfg");
process.env.GOODUNLUCK_CONFIG_DIR = TMP;   // rutas lazy → basta fijarlo antes de llamar

const { analizar, desbloquear, auditoria, guardarConfig, crearJobRecuperacion, estadoJob, archivoJob } = await import("../server/goodunluck.js");
const JSZip = (await import("jszip")).default;
const CFB = await import("cfb");

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

await test("VBA: quitar-restricción levanta el sello del proyecto VBA (CMG/DPB/GC)", async () => {
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, "/PROJECT", Buffer.from('ID="{X}"\r\nCMG="AA"\r\nDPB="BB"\r\nGC="CC"\r\n[Host Extender Info]\r\n', "latin1"));
  const z = new JSZip();
  z.file("[Content_Types].xml", "<Types/>"); z.file("xl/workbook.xml", "<workbook/>");
  z.file("xl/vbaProject.bin", CFB.write(cfb, { type: "buffer" }));
  const xlsm = await z.generateAsync({ type: "nodebuffer" });
  const r = await desbloquear(xlsm, "libro.xlsm", { tier: 1, ...ok });
  const c2 = CFB.read(await (await JSZip.loadAsync(r.archivo)).file("xl/vbaProject.bin").async("nodebuffer"), { type: "buffer" });
  const idx = c2.FullPaths.findIndex((p) => p.split("/").pop() === "PROJECT");
  assert.ok(!/(CMG|DPB|GC)=/i.test(Buffer.from(c2.FileIndex[idx].content).toString("latin1")));
});

await test("PDF Tier 1: quita permisos (owner-password) sin la clave", async () => {
  const r = await desbloquear(fx("pdf-permisos.pdf"), "pdf-permisos.pdf", { tier: 1, ...ok });
  assert.ok(!r.archivo.includes(Buffer.from("/Encrypt")));
});

await test("PDF Tier 2: descifra con la clave de apertura conocida", async () => {
  const r = await desbloquear(fx("pdf-clave.pdf"), "pdf-clave.pdf", { tier: 2, password: "abrime", ...ok });
  assert.ok(!r.archivo.includes(Buffer.from("/Encrypt")));
});

await test("Excel cifrado: analizar detecta cifrado y acción descifrar-con-clave", async () => {
  const a = await analizar(fx("excel-cifrado.xlsx"), "excel-cifrado.xlsx");
  assert.equal(a.familia, "office");
  assert.equal(a.cifrado, true);
  assert.ok(a.acciones.includes("descifrar-con-clave"));
});

await test("Excel cifrado Tier 2: descifra con la clave 'secreto' (tu decryptAgile)", async () => {
  const r = await desbloquear(fx("excel-cifrado.xlsx"), "excel-cifrado.xlsx", { tier: 2, password: "secreto", ...ok });
  const z = await JSZip.loadAsync(r.archivo);
  assert.ok(z.file("xl/workbook.xml"), "el descifrado debe dar un OOXML válido");
});

await test("Excel cifrado Tier 2: clave incorrecta → error de clave", async () => {
  await assert.rejects(() => desbloquear(fx("excel-cifrado.xlsx"), "x.xlsx", { tier: 2, password: "malo", ...ok }),
    (e) => e.code === "clave");
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

await test("Tier 3: gateado — con cracking apagado, se rechaza", async () => {
  await assert.rejects(() => desbloquear(fx("excel-cifrado.xlsx"), "x.xlsx", { tier: 3, wordlist: ["secreto"], ...ok }),
    (e) => e.code === "no-aplica");
});

await test("Tier 3: recupera la clave Office por diccionario (cracking habilitado)", async () => {
  guardarConfig({ cracking: { enabled: true, maxJobMinutes: 120 } });
  const r = await desbloquear(fx("excel-cifrado.xlsx"), "excel-cifrado.xlsx",
    { tier: 3, wordlist: ["hola", "1234", "secreto", "otra"], ...ok });
  assert.equal(r.password, "secreto");
  const z = await JSZip.loadAsync(r.archivo);
  assert.ok(z.file("xl/workbook.xml"));
});

await test("Tier 3: wordlist sin la clave → no-encontrada", async () => {
  await assert.rejects(() => desbloquear(fx("excel-cifrado.xlsx"), "x.xlsx", { tier: 3, wordlist: ["a", "b", "c"], ...ok }),
    (e) => e.code === "no-encontrada");
});

await test("Tier 3 job async: submit → poll → recupera la clave y deja el archivo", async () => {
  const { id } = crearJobRecuperacion(fx("excel-cifrado.xlsx"), "excel-cifrado.xlsx",
    { wordlist: ["hola", "secreto", "otra"], ...ok });
  let est;
  for (let i = 0; i < 50 && (est = estadoJob(id)).estado === "corriendo"; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(est.estado, "ok");
  assert.equal(est.password, "secreto");
  const dl = archivoJob(id);
  assert.ok(dl && dl.archivo.length > 0);
});

await test("ZIP cifrado: fuga de metadatos — nombres visibles sin la clave", async () => {
  const a = await analizar(fx("zip-cifrado.zip"), "zip-cifrado.zip");
  assert.equal(a.familia, "zip");
  assert.equal(a.cifrado, true);
  const nombres = a.entradas.map((e) => e.nombre);
  assert.ok(nombres.includes("balance-secreto.txt"));
  assert.ok(nombres.includes("nomina/sueldos.csv"));
  assert.ok(a.entradas.every((e) => e.crc32));   // CRC-32 de cada archivo, expuesto
});

await test("Auditoría: registra las operaciones", () => {
  assert.ok(auditoria().length >= 4);
});

console.log(`\n${pasados}/18 OK`);
rmSync(TMP, { recursive: true, force: true });
