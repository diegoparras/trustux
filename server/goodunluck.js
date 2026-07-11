// goodunluck.js — Adaptador del módulo de recuperación de archivos protegidos.
//
// Responsable por diseño: recuperación de archivos PROPIOS, local, auditada, gateada por una
// matriz rol→capacidad que edita el superadmin. Detecta el tipo, valida permisos + salvaguardas,
// llama al motor (unlock-core) y registra en una auditoría append-only. El archivo NO se persiste.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { analizarOffice, quitarProteccionOffice } from "../unlock-core/office.js";
import { analizarPdf, quitarPermisosPdf, descifrarPdf } from "../unlock-core/pdf.js";

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
export async function desbloquear(buf, name, { tier, password, motivo, propiedad, usuario }) {
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
      else { const e = new Error("El descifrado de Office/ZIP/RAR con clave llega en la próxima fase."); e.code = "no-aplica"; throw e; }
    } else { const e = new Error("La recuperación de clave (Tier 3) no está habilitada en este build."); e.code = "no-aplica"; throw e; }
    auditar({ ...base, resultado: "ok", quitadas: r.quitadas || null });
    return { archivo: r.archivo, nombreSalida: nombreSalida(name, familia) };
  } catch (e) {
    auditar({ ...base, resultado: "error", error: e.code || e.message });
    throw e;
  }
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
