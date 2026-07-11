// archive.js — Inspección de archivos ZIP (fuga de metadatos, atajo garantizado).
//
// El ZIP guarda su índice central (nombres, tamaños, fechas, CRC-32, si está cifrado) SIN cifrar,
// aunque el contenido de cada archivo tenga contraseña. Así que siempre se puede ver QUÉ hay
// adentro de un ZIP protegido sin la clave. No rompe cripto: lee un dato que el formato deja
// expuesto. (7z/RAR pueden cifrar el índice; el ZIP no.)
//
// Con la clave (conocida o recuperada), 7-Zip descifra y reempaqueta el contenido en un ZIP
// abierto para devolvértelo. 7z es nativo (está en la imagen full; acá, el 7-Zip de Windows).
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SEVENZIP = process.env.SEVENZIP ||
  (process.platform === "win32" ? "C:\\Program Files\\7-Zip\\7z.exe" : "7z");

function corre7z(args, cwd) {
  return new Promise((resolve) => {
    let out = "", err = "";
    let p;
    try { p = spawn(SEVENZIP, args, { cwd, windowsHide: true }); }
    catch { return resolve({ rc: -1, out, err, noExiste: true }); }
    p.on("error", (e) => resolve({ rc: -1, out, err: e.message, noExiste: e.code === "ENOENT" }));
    p.stdout?.on("data", (d) => { out += d; });
    p.stderr?.on("data", (d) => { err += d; });
    p.on("close", (rc) => resolve({ rc, out, err }));
  });
}

/** ¿Está disponible 7-Zip? */
export async function sevenzipDisponible() { return !(await corre7z(["i"])).noExiste; }

/** Descifra un ZIP/RAR con la clave y reempaqueta el contenido en un ZIP abierto (sin clave). */
export async function descifrarArchivo(buf, password, ext = "zip") {
  const dir = mkdtempSync(join(tmpdir(), "gu-"));
  try {
    const inp = join(dir, "in." + ext); writeFileSync(inp, buf);
    const outdir = join(dir, "out"); mkdirSync(outdir);
    const r = await corre7z(["x", inp, "-p" + (password || ""), "-o" + outdir, "-y", "-bso0", "-bsp0"]);
    if (r.noExiste) { const e = new Error("7-Zip no está instalado (imagen full o SEVENZIP)."); e.code = "sin-binario"; throw e; }
    if (r.rc !== 0) {
      const clave = /wrong password|password/i.test(r.err);
      const e = new Error(clave ? "Clave incorrecta." : "No se pudo descifrar el archivo."); e.code = clave ? "clave" : "no-aplica"; throw e;
    }
    const outzip = join(dir, "abierto.zip");
    const r2 = await corre7z(["a", "-tzip", "-mx=3", outzip, "."], outdir);
    if (r2.rc !== 0 || !existsSync(outzip)) { const e = new Error("No se pudo reempaquetar el contenido."); e.code = "no-aplica"; throw e; }
    return { archivo: readFileSync(outzip), formato: "zip" };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const U16 = (b, o) => b.readUInt16LE(o);
const U32 = (b, o) => b.readUInt32LE(o);

const SIG_EOCD = 0x06054b50;   // End of Central Directory
const SIG_CDH = 0x02014b50;    // Central Directory File Header

function buscarEOCD(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  return -1;
}

// Fecha/hora DOS (2 x uint16) → ISO (aprox, hora local del que comprimió).
function fechaDos(time, date) {
  try {
    const y = 1980 + ((date >> 9) & 0x7f), mo = (date >> 5) & 0x0f, d = date & 0x1f;
    const h = (time >> 11) & 0x1f, mi = (time >> 5) & 0x3f, s = (time & 0x1f) * 2;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  } catch { return null; }
}

/** Lista el contenido de un ZIP (nombres/tamaños/fechas/CRC) sin la contraseña. */
export function inspeccionarZip(buf) {
  if (!(buf[0] === 0x50 && buf[1] === 0x4B)) { const e = new Error("No parece un ZIP."); e.code = "formato"; throw e; }
  const eocd = buscarEOCD(buf);
  if (eocd < 0) { const e = new Error("ZIP inválido: no se encontró el índice central."); e.code = "formato"; throw e; }
  const total = U16(buf, eocd + 10);
  let off = U32(buf, eocd + 16);
  const entradas = [];
  let algunoCifrado = false;
  for (let n = 0; n < total && off + 46 <= buf.length; n++) {
    if (U32(buf, off) !== SIG_CDH) break;
    const flag = U16(buf, off + 8), method = U16(buf, off + 10);
    const time = U16(buf, off + 12), date = U16(buf, off + 14);
    const crc = U32(buf, off + 16), csize = U32(buf, off + 20), usize = U32(buf, off + 24);
    const nameLen = U16(buf, off + 28), extraLen = U16(buf, off + 30), commentLen = U16(buf, off + 32);
    const nombre = buf.toString("utf8", off + 46, off + 46 + nameLen);
    const cifrado = (flag & 0x1) === 1;
    if (cifrado) algunoCifrado = true;
    entradas.push({
      nombre, tamano: usize, comprimido: csize, crc32: (crc >>> 0).toString(16).padStart(8, "0"),
      fecha: fechaDos(time, date), cifrado, metodo: method === 99 ? "AES" : method === 0 ? "almacenado" : "deflate",
      dir: nombre.endsWith("/"),
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return { familia: "zip", cifrado: algunoCifrado, total: entradas.length, entradas };
}
