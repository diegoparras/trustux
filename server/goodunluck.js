// goodunluck.js — Adaptador del módulo de recuperación de archivos protegidos.
//
// Responsable por diseño: recuperación de archivos PROPIOS, local, auditada, gateada por una
// matriz rol→capacidad que edita el superadmin. Detecta el tipo, valida permisos + salvaguardas,
// llama al motor (unlock-core) y registra en una auditoría append-only. El archivo NO se persiste.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { analizarOffice, quitarProteccionOffice, descifrarOffice, recuperarClaveOffice } from "../unlock-core/office.js";
import { analizarPdf, quitarPermisosPdf, descifrarPdf } from "../unlock-core/pdf.js";
import { inspeccionarZip } from "../unlock-core/archive.js";
import { parseAgile, hashOffice, decryptAgile } from "../unlock-core/office-agile.js";
import { capacidades as capsNativas, crackJohn, extraerHash } from "../unlock-core/crack-native.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Rutas resueltas en runtime (el env puede fijarse antes de usarlas: Docker, tests).
const CONFIG_DIR = () => process.env.GOODUNLUCK_CONFIG_DIR || join(HERE, "..", "config");
const CONFIG_FILE = () => join(CONFIG_DIR(), "goodunluck.json");
const AUDIT_FILE = () => join(CONFIG_DIR(), "goodunluck-audit.jsonl");

const DEFAULT_CONFIG = {
  roles: { agente: { tiers: [1], formatos: ["office", "pdf"] }, auditor: { tiers: [1, 2], formatos: ["*"] },
           admin: { tiers: [1, 2, 3], formatos: ["*"] }, superadmin: { tiers: [1, 2, 3], formatos: ["*"] } },
  safeguards: { requireReason: true, requireOwnership: true, audit: true },
  cracking: { enabled: false, maxJobMinutes: 120 },
};

// ---- Config (editable por el superadmin, en un volumen montado) ----
let _cfg = null;
export function config() {
  if (_cfg) return _cfg;
  try { _cfg = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_FILE(), "utf8")) }; }
  catch { _cfg = DEFAULT_CONFIG; }
  return _cfg;
}
export function guardarConfig(nuevo) {
  const cfg = { ...config(), ...nuevo };
  mkdirSync(CONFIG_DIR(), { recursive: true });
  writeFileSync(CONFIG_FILE(), JSON.stringify(cfg, null, 2));
  _cfg = cfg;
  return cfg;
}

// Rol efectivo: en federado, del token Lockatus; en local, del env (default admin = dueño del equipo).
function rolDe(usuario) {
  if (usuario && !usuario.local && usuario.role) return usuario.role;
  return process.env.GOODUNLUCK_LOCAL_ROLE || "admin";
}
function capacidades(rol) {
  const c = config().roles[rol] || { tiers: [], formatos: [] };
  return { tiers: c.tiers || [], formatos: c.formatos || [] };
}
const puedeFormato = (cap, familia) => cap.formatos.includes("*") || cap.formatos.includes(familia);

// ---- Detección de tipo ----
function detectar(buf, name = "") {
  const ext = (name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
  const pk = buf[0] === 0x50 && buf[1] === 0x4B;                       // "PK" (zip / OOXML)
  const ole = buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0; // OLE (office cifrado)
  const pdf = buf.slice(0, 4).toString() === "%PDF";
  const rar = buf.slice(0, 4).toString("latin1") === "Rar!";
  if (pdf) return { familia: "pdf" };
  const officeExt = ["docx", "xlsx", "pptx", "docm", "xlsm", "pptm", "doc", "xls", "ppt"];
  if (officeExt.includes(ext) || (ole && officeExt.includes(ext))) return { familia: "office" };
  if (rar || ext === "rar") return { familia: "rar" };
  if (ext === "zip" || pk) return { familia: "zip" };
  const e = new Error("Formato no reconocido: se espera Office, PDF, ZIP o RAR."); e.code = "formato"; throw e;
}

const hash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

// ---- Auditoría append-only (nombre + hash del archivo, nunca el contenido) ----
function auditar(entry) {
  if (!config().safeguards.audit) return;
  try { mkdirSync(CONFIG_DIR(), { recursive: true }); appendFileSync(AUDIT_FILE(), JSON.stringify(entry) + "\n"); }
  catch { /* si no se puede auditar, no se procesa: lo maneja el llamador */ }
}
export function auditoria(limite = 200) {
  try {
    if (!existsSync(AUDIT_FILE())) return [];
    return readFileSync(AUDIT_FILE(), "utf8").trim().split("\n").filter(Boolean).slice(-limite)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
  } catch { return []; }
}

// ---- Analizar: qué es y qué se puede hacer con el rol (sin procesar) ----
export async function analizar(buf, name, usuario) {
  const rol = rolDe(usuario);
  const cap = capacidades(rol);
  const { familia } = detectar(buf, name);
  let detalle = { familia, cifrado: false, protecciones: [] };
  if (familia === "office") detalle = await analizarOffice(buf, name);
  else if (familia === "pdf") detalle = await analizarPdf(buf);
  else if (familia === "zip") { try { detalle = inspeccionarZip(buf); } catch { /* zip ilegible */ } }
  // Acciones que este rol podría ejecutar sobre este archivo.
  const acciones = [];
  const permitido = (tier) => cap.tiers.includes(tier) && puedeFormato(cap, familia);
  if ((familia === "office" && !detalle.cifrado && detalle.protecciones?.length) ||
      (familia === "pdf" && detalle.cifrado)) { if (permitido(1)) acciones.push("quitar-restriccion"); }
  if ((familia === "office" && detalle.cifrado) || familia === "pdf" || familia === "zip" || familia === "rar") {
    if (permitido(2)) acciones.push("descifrar-con-clave");
  }
  if (permitido(3) && config().cracking.enabled) acciones.push("recuperar-clave");
  return { rol, familia, ...detalle, acciones };
}

// ---- Desbloquear: ejecuta Tier 1 (restricción) o Tier 2 (con clave). Devuelve el archivo. ----
export async function desbloquear(buf, name, { tier, password, wordlist, motivo, propiedad, usuario }) {
  const rol = rolDe(usuario);
  const cap = capacidades(rol);
  const { familia } = detectar(buf, name);
  const sg = config().safeguards;

  // Salvaguardas: motivo + declaración de propiedad (si el superadmin las exige).
  if (sg.requireReason && !String(motivo || "").trim()) { const e = new Error("Falta el motivo de la recuperación."); e.code = "motivo"; throw e; }
  if (sg.requireOwnership && !propiedad) { const e = new Error("Falta declarar que la organización es dueña del archivo."); e.code = "propiedad"; throw e; }

  // Autorización: el rol debe tener el tier y el formato.
  if (!cap.tiers.includes(tier) || !puedeFormato(cap, familia)) {
    const e = new Error(`Tu rol (${rol}) no está autorizado a esta operación (tier ${tier}, ${familia}).`); e.code = "autorizacion"; throw e;
  }

  const base = { ts: new Date().toISOString(), usuario: rol, rol, archivo: name || "(sin nombre)", hash: hash(buf), familia, tier, motivo: motivo || "" };
  try {
    let r;
    if (tier === 1) {
      if (familia === "office") r = await quitarProteccionOffice(buf, name);
      else if (familia === "pdf") r = await quitarPermisosPdf(buf);
      else { const e = new Error("Tier 1 solo aplica a Office y PDF."); e.code = "no-aplica"; throw e; }
    } else if (tier === 2) {
      if (familia === "pdf") r = await descifrarPdf(buf, password);
      else if (familia === "office") r = descifrarOffice(buf, password, name);
      else { const e = new Error("El descifrado de ZIP/RAR con clave llega en la próxima fase."); e.code = "no-aplica"; throw e; }
    } else if (tier === 3) {
      if (!config().cracking.enabled) { const e = new Error("La recuperación de clave (Tier 3) está desactivada por el superadmin."); e.code = "no-aplica"; throw e; }
      if (familia === "office") r = recuperarClaveOffice(buf, wordlist, name);
      else { const e = new Error(`La recuperación de clave para ${familia} (John/hashcat) llega en la próxima fase.`); e.code = "no-aplica"; throw e; }
    } else { const e = new Error("Tier no soportado."); e.code = "no-aplica"; throw e; }
    // La auditoría registra que se recuperó una clave, nunca la clave en sí.
    auditar({ ...base, resultado: "ok", quitadas: r.quitadas || null, claveRecuperada: r.password ? true : undefined });
    return { archivo: r.archivo, nombreSalida: nombreSalida(name, familia), password: r.password };
  } catch (e) {
    auditar({ ...base, resultado: "error", error: e.code || e.message });
    throw e;
  }
}

// ---- Jobs de recuperación de clave (Tier 3, asíncronos) --------------------------------------
// Modelo submit → poll → download, como los recuperadores comerciales. Hoy el backend es el
// diccionario de Office (JS puro); hashcat/John se enchufan acá mismo en la fase con binarios.
const _jobs = new Map();
let _jobSeq = 0;

export function crearJobRecuperacion(buf, name, { wordlist, motivo, propiedad, usuario }) {
  const rol = rolDe(usuario), cap = capacidades(rol), sg = config().safeguards;
  const { familia } = detectar(buf, name);
  if (sg.requireReason && !String(motivo || "").trim()) { const e = new Error("Falta el motivo."); e.code = "motivo"; throw e; }
  if (sg.requireOwnership && !propiedad) { const e = new Error("Falta declarar la propiedad del archivo."); e.code = "propiedad"; throw e; }
  if (!config().cracking.enabled) { const e = new Error("La recuperación de clave (Tier 3) está desactivada por el superadmin."); e.code = "no-aplica"; throw e; }
  if (!cap.tiers.includes(3) || !puedeFormato(cap, familia)) { const e = new Error(`Tu rol (${rol}) no está autorizado a recuperar claves de ${familia}.`); e.code = "autorizacion"; throw e; }
  if (!wordlist?.length) { const e = new Error("Falta la wordlist."); e.code = "wordlist"; throw e; }

  const id = `job_${++_jobSeq}_${Date.now().toString(36)}`;
  const job = { id, estado: "corriendo", progreso: 0, total: wordlist.length, familia, rol };
  _jobs.set(id, job);
  const base = { ts: new Date().toISOString(), usuario: rol, rol, archivo: name || "(sin nombre)", hash: hash(buf), familia, tier: 3, motivo: motivo || "" };
  queueMicrotask(async () => {
    try {
      let password, archivo = null;
      const caps = await capsNativas();
      if (familia === "office" && caps.john) {
        // Motor nativo (John, CPU): el hash $office$ se arma de los parámetros agile (sin office2john).
        job.motor = "john";
        const { password: pw } = await crackJohn(hashOffice(parseAgile(buf)), { wordlist });
        if (!pw) { const e = new Error("No se recuperó la clave con esa wordlist."); e.code = "no-encontrada"; throw e; }
        password = pw; archivo = Buffer.from(decryptAgile(buf, pw));
      } else if (familia === "office") {
        // Diccionario en JS puro (sin binarios). Con progreso.
        job.motor = "js";
        const r = recuperarClaveOffice(buf, wordlist, name, (i) => { job.progreso = i; });
        password = r.password; archivo = r.archivo;
      } else if (caps.john) {
        // PDF/ZIP/RAR: extractor *2john → John. Devuelve la clave; el PDF además se descifra.
        job.motor = "john";
        const { password: pw } = await crackJohn(await extraerHash(buf, familia, name), { wordlist });
        if (!pw) { const e = new Error("No se recuperó la clave con esa wordlist."); e.code = "no-encontrada"; throw e; }
        password = pw;
        if (familia === "pdf") archivo = (await descifrarPdf(buf, pw)).archivo;
      } else {
        const e = new Error(`La recuperación de ${familia} necesita John/hashcat (imagen full o JOHN_BIN).`); e.code = "sin-binario"; throw e;
      }
      Object.assign(job, { estado: "ok", progreso: job.total, password, archivo, nombreSalida: archivo ? nombreSalida(name, familia) : null });
      auditar({ ...base, resultado: "ok", motor: job.motor, claveRecuperada: true });
    } catch (e) {
      Object.assign(job, { estado: "error", error: e.message, code: e.code });
      auditar({ ...base, resultado: "error", error: e.code || e.message });
    }
  });
  return { id };
}

/** Estado del job (sin el archivo binario). */
export function estadoJob(id) {
  const j = _jobs.get(id);
  if (!j) return null;
  return { id: j.id, estado: j.estado, progreso: j.progreso, total: j.total, motor: j.motor || null, password: j.password || null, nombreSalida: j.nombreSalida || null, error: j.error || null };
}
/** El archivo recuperado de un job terminado OK (para la descarga). */
export function archivoJob(id) {
  const j = _jobs.get(id);
  return j && j.estado === "ok" && j.archivo ? { archivo: j.archivo, nombreSalida: j.nombreSalida } : null;
}

function nombreSalida(name = "documento", familia) {
  const m = String(name).match(/^(.*?)(\.[a-z0-9]+)?$/i);
  const stem = (m && m[1]) || "documento";
  const ext = (m && m[2]) || (familia === "pdf" ? ".pdf" : "");
  return `${stem}-desbloqueado${ext}`;
}

/** Estado del módulo para la UI/Admin. */
export function estado() {
  const c = config();
  return { roles: c.roles, safeguards: c.safeguards, cracking: c.cracking };
}
