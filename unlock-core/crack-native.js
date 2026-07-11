// crack-native.js — Motor de recuperación de clave con binarios nativos (hashcat/John/bkcrack).
//
// Cubre lo que el diccionario en JS puro no alcanza: fuerza bruta/máscara con GPU (hashcat), los
// extractores *2john, las llaves cortas garantizadas (Office 97-2003 y PDF RC4 de 40 bits, vía los
// modos oldoffice de hashcat) y ZipCrypto por texto conocido (bkcrack). Corre solo si los binarios
// están instalados (imagen "full"); si no, el módulo lo reporta y el Tier 3 de Office-por-diccionario
// (JS puro) sigue disponible. El "cerebro" —detección, mapeo de modos, parseo— es puro y testeable.
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Binarios: por PATH, o por env (JOHN_BIN / HASHCAT_BIN) para instalaciones fuera del PATH.
const JOHN = process.env.JOHN_BIN || "john";
const HASHCAT = process.env.HASHCAT_BIN || "hashcat";

// ---- Cerebro puro (sin ejecutar binarios) ---------------------------------------------------

// De qué extractor *2john sale el hash, por familia.
export const EXTRACTOR = { office: "office2john", pdf: "pdf2john", zip: "zip2john", rar: "rar2john" };

/**
 * Modo de hashcat a partir del hash extraído por *2john. Devuelve { modo, etiqueta, garantizado }.
 * "garantizado" marca las llaves cortas (40 bits) que salen sí o sí en tiempo limitado.
 */
export function modoHashcat(hash) {
  const h = String(hash);
  // Office moderno (2007/2010/2013+): $office$*<ver>*...
  let m = h.match(/^\$office\$\*(\d{4})\*/);
  if (m) { const v = m[1]; return { modo: v === "2007" ? 9400 : v === "2010" ? 9500 : 9600, etiqueta: `Office ${v}`, garantizado: false }; }
  // Office 97-2003 (RC4 40-bit): $oldoffice$<0|1|3|4>*...  → llave corta, GARANTIZADO
  m = h.match(/^\$oldoffice\$([0134])\*/);
  if (m) { const t = m[1]; return { modo: (t === "0" || t === "1") ? 9700 : 9800, etiqueta: "Office 97-2003 (RC4 40-bit)", garantizado: true }; }
  // PDF: $pdf$<V>*<R>*<bits>*...   R2 (RC4 40-bit) es GARANTIZADO
  m = h.match(/^\$pdf\$(\d+)\*(\d+)\*(\d+)\*/);
  if (m) {
    const R = +m[2], bits = +m[3];
    if (R <= 2 || bits <= 40) return { modo: 10400, etiqueta: "PDF RC4 40-bit", garantizado: true };
    if (R === 3 || R === 4) return { modo: 10500, etiqueta: "PDF RC4/AES (rev 3-4)", garantizado: false };
    if (R === 5) return { modo: 10600, etiqueta: "PDF AES (rev 5)", garantizado: false };
    return { modo: 10700, etiqueta: "PDF AES-256 (rev 6)", garantizado: false };
  }
  // ZIP: WinZip AES ($zip2$) vs ZipCrypto legacy ($pkzip2$)
  if (/^\$zip2\$/.test(h)) return { modo: 13600, etiqueta: "ZIP AES (WinZip)", garantizado: false };
  if (/^\$pkzip2?\$/.test(h)) return { modo: 17225, etiqueta: "ZIP ZipCrypto", garantizado: false };
  // RAR
  if (/^\$RAR3\$\*0\*/.test(h)) return { modo: 12500, etiqueta: "RAR3", garantizado: false };
  if (/^\$rar5\$/.test(h)) return { modo: 13000, etiqueta: "RAR5", garantizado: false };
  return null;
}

/** Extrae "hash:password" de la salida de `hashcat --show` (o del potfile). */
export function parseCrackShow(salida) {
  const linea = String(salida).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop();
  if (!linea || !linea.includes(":")) return null;
  return linea.slice(linea.lastIndexOf(":") + 1);   // la clave va después del último ':'
}

/** Progreso aproximado (0..1) de una línea de estado JSON de hashcat (--status-json). */
export function progresoHashcat(linea) {
  try { const j = JSON.parse(linea); if (Array.isArray(j.progress) && j.progress[1]) return j.progress[0] / j.progress[1]; }
  catch { /* no es json de estado */ }
  return null;
}

// ---- Ejecución (requiere binarios; solo corre en la imagen "full") --------------------------

function corre(cmd, args, { input, onLine, timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    let out = "", err = "";
    let p;
    try { p = spawn(cmd, args, { windowsHide: true }); }
    catch { return resolve({ ok: false, rc: -1, out: "", err: "spawn falló", noExiste: true }); }
    const t = timeoutMs ? setTimeout(() => { try { p.kill("SIGKILL"); } catch {} }, timeoutMs) : null;
    p.on("error", (e) => { if (t) clearTimeout(t); resolve({ ok: false, rc: -1, out, err: e.message, noExiste: e.code === "ENOENT" }); });
    p.stdout?.on("data", (d) => { out += d; if (onLine) String(d).split(/\r?\n/).forEach((l) => l && onLine(l)); });
    p.stderr?.on("data", (d) => { err += d; });
    if (input != null) { p.stdin.write(input); p.stdin.end(); }
    p.on("close", (rc) => { if (t) clearTimeout(t); resolve({ ok: rc === 0, rc, out, err }); });
  });
}

const existe = async (bin, args = ["--version"]) => !(await corre(bin, args)).noExiste;

/** Qué binarios de cracking están disponibles en este equipo. */
export async function capacidades() {
  const [hashcat, john, bkcrack, qpdf] = await Promise.all([
    existe(HASHCAT, ["--version"]), existe(JOHN, ["--list=build-info"]),
    existe("bkcrack", ["--version"]), existe("qpdf", ["--version"]),
  ]);
  return { hashcat, john, bkcrack, qpdf, alguno: hashcat || john };
}

// Nombre del formato de John a partir del hash extraído.
export function formatoJohn(hash) {
  const h = String(hash);
  if (/^\$office\$/.test(h)) return "office";
  if (/^\$oldoffice\$/.test(h)) return "oldoffice";
  if (/^\$pdf\$/.test(h)) return "PDF";
  if (/^\$zip2\$/.test(h)) return "ZIP";
  if (/^\$pkzip2?\$/.test(h)) return "PKZIP";
  if (/^\$RAR3\$/.test(h)) return "rar";
  if (/^\$rar5\$/.test(h)) return "RAR5";
  return null;
}

/**
 * Recupera la clave con John the Ripper (CPU, sin OpenCL — anda donde hashcat no tiene driver).
 * @returns {Promise<{password: string|null}>}
 */
export async function crackJohn(hash, { wordlist, formato } = {}) {
  const fmt = formato || formatoJohn(hash);
  if (!fmt) { const e = new Error("No se reconoció el tipo de hash para John."); e.code = "no-aplica"; throw e; }
  const dir = mkdtempSync(join(tmpdir(), "gu-"));
  try {
    const hf = join(dir, "hash.txt"); writeFileSync(hf, String(hash).trim() + "\n");
    const wf = join(dir, "wl.txt"); writeFileSync(wf, (wordlist || []).join("\n") + "\n");
    const pot = join(dir, "john.pot");
    const r = await corre(JOHN, [`--format=${fmt}`, `--wordlist=${wf}`, `--pot=${pot}`, hf], { timeoutMs: 0 });
    if (r.noExiste) { const e = new Error("John no está instalado (imagen full o JOHN_BIN)."); e.code = "sin-binario"; throw e; }
    let password = null;
    try { password = parseCrackShow(readFileSync(pot, "utf8")); } catch { /* sin pot → no crackeó */ }
    return { password };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Extrae el hash de un archivo con el *2john correspondiente. Requiere John. */
export async function extraerHash(buf, familia, nombre = "archivo") {
  const ext = EXTRACTOR[familia];
  if (!ext) { const e = new Error(`Sin extractor para ${familia}.`); e.code = "no-aplica"; throw e; }
  const dir = mkdtempSync(join(tmpdir(), "gu-"));
  try {
    const f = join(dir, nombre.replace(/[^\w.\-]/g, "_") || "archivo");
    writeFileSync(f, buf);
    const r = await corre(ext, [f], { timeoutMs: 60000 });
    if (r.noExiste) { const e = new Error(`No está instalado ${ext} (imagen full).`); e.code = "sin-binario"; throw e; }
    const hash = r.out.split(/\r?\n/).find((l) => l.includes("$")) || "";
    if (!hash) { const e = new Error("No se pudo extraer el hash del archivo."); e.code = "no-aplica"; throw e; }
    return hash.includes(":") ? hash.slice(hash.indexOf(":") + 1).trim() : hash.trim();
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/**
 * Recupera la clave con hashcat (diccionario -a 0 o máscara -a 3). Requiere hashcat.
 * @returns {Promise<{password:string|null, etiqueta:string, garantizado:boolean}>}
 */
export async function crackHashcat(hash, { wordlist, mask, onProgress } = {}) {
  const info = modoHashcat(hash);
  if (!info) { const e = new Error("No se reconoció el tipo de hash."); e.code = "no-aplica"; throw e; }
  const dir = mkdtempSync(join(tmpdir(), "gu-"));
  try {
    const hf = join(dir, "hash.txt"); writeFileSync(hf, hash + "\n");
    const pot = join(dir, "pot.txt");
    const base = ["-m", String(info.modo), hf, "--potfile-path", pot, "--status", "--status-json", "--quiet"];
    let args;
    if (mask) args = [...base, "-a", "3", mask];
    else { const wf = join(dir, "wl.txt"); writeFileSync(wf, (wordlist || []).join("\n") + "\n"); args = [...base, "-a", "0", wf]; }
    await corre("hashcat", args, { timeoutMs: 0, onLine: (l) => { const p = progresoHashcat(l); if (p != null && onProgress) onProgress(p); } });
    const show = await corre("hashcat", ["-m", String(info.modo), hf, "--potfile-path", pot, "--show"]);
    return { password: parseCrackShow(show.out), etiqueta: info.etiqueta, garantizado: info.garantizado };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
