// pdf.js — Tier 1/2 para PDF de goodunluck, con qpdf compilado a WASM (@jspawn/qpdf-wasm).
//
// Tier 1 (sin clave): un PDF con owner-password abre igual (el user-password es vacío); solo tiene
// permisos bloqueados (imprimir/copiar/editar). `qpdf --decrypt` los quita SIN la clave.
// Tier 2 (con clave): si tiene user-password (no abre sin clave), se descifra con `--password`.
//
// En Node el build fuerza fetch para el wasm; lo instanciamos nosotros con instantiateWasm (sin red).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let _factory = null, _wasm = null;
function cargar() {
  if (_factory) return;
  _factory = require("@jspawn/qpdf-wasm/qpdf.js");
  _wasm = readFileSync(require.resolve("@jspawn/qpdf-wasm/qpdf.wasm"));
}

// Corre qpdf con args sobre archivos en memoria. Devuelve { rc, out?, err }.
async function qpdf(args, entrada) {
  cargar();
  let err = "";
  const mod = await _factory({
    noInitialRun: true, print() {}, printErr(s) { err += s + "\n"; },
    instantiateWasm(imports, cb) {
      WebAssembly.instantiate(_wasm, imports).then((r) => cb(r.instance, r.module));
      return {};
    },
  });
  for (const [name, buf] of Object.entries(entrada)) mod.FS.writeFile("/" + name, buf);
  // qpdf llama a exit() con código ≠0 en errores (p.ej. clave mala); Emscripten lo copia a
  // process.exitCode del proceso host. Lo tomamos como el rc y restauramos el exitCode.
  const prevExit = process.exitCode;
  let rc;
  try { rc = mod.callMain(args); } catch (e) { rc = -1; err += e.message; }
  if (typeof rc !== "number" && typeof process.exitCode === "number") rc = process.exitCode;
  process.exitCode = prevExit;
  let out = null;
  try { out = Buffer.from(mod.FS.readFile("/out.pdf")); } catch { /* sin salida */ }
  return { rc, out, err: err.trim() };
}

const esCifrado = (buf) => buf.includes(Buffer.from("/Encrypt"));

/** Analiza un PDF sin modificarlo: ¿está cifrado? ¿es RC4 de 40 bits (llave corta = garantizado)? */
export async function analizarPdf(buf) {
  if (buf.slice(0, 4).toString() !== "%PDF") { const e = new Error("No parece un PDF."); e.code = "formato"; throw e; }
  const cifrado = esCifrado(buf);
  // Revisión 2 del diccionario /Encrypt = RC4 de 40 bits → llave corta, recuperación garantizada.
  const head = buf.slice(0, 4_000_000).toString("latin1");
  const rc4_40 = cifrado && /\/R\s*2\b/.test(head);
  return { familia: "pdf", cifrado, rc4_40 };
}

/** Tier 1: quita permisos / owner-password SIN la clave. Falla si el PDF pide clave de apertura. */
export async function quitarPermisosPdf(buf) {
  const { rc, out, err } = await qpdf(["--decrypt", "/in.pdf", "/out.pdf"], { "in.pdf": buf });
  if (rc !== 0 || !out) {
    const e = new Error("El PDF pide contraseña de apertura: hace falta la clave (Tier 2)." + (err ? " " + err : ""));
    e.code = "cifrado"; throw e;
  }
  return { archivo: out, formato: "pdf", quitadas: ["cifrado/permisos (owner-password)"] };
}

/** Tier 2: descifra un PDF con la clave de apertura conocida. */
export async function descifrarPdf(buf, password) {
  if (!password) { const e = new Error("Falta la contraseña."); e.code = "clave"; throw e; }
  const { rc, out, err } = await qpdf([`--password=${password}`, "--decrypt", "/in.pdf", "/out.pdf"], { "in.pdf": buf });
  if (rc !== 0 || !out) {
    const e = new Error("Clave incorrecta o PDF no soportado." + (err ? " " + err : "")); e.code = "clave"; throw e;
  }
  return { archivo: out, formato: "pdf" };
}
