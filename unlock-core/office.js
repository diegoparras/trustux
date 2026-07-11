// office.js — Tier 1/2 para archivos Office (Word/Excel/PowerPoint) de goodunluck.
//
// Tier 1 (sin clave): quita las RESTRICCIONES no-criptográficas. Un .docx/.xlsx/.pptx es un ZIP
// OOXML; "proteger hoja", "restringir edición" o "solo lectura" son un elemento en el XML, no
// cifrado. Se borra ese elemento y el archivo queda editable. No rompe nada cifrado.
//
// Tier 2 (con clave): un Office CIFRADO no es un ZIP sino un contenedor OLE/CFB (magic D0CF11E0);
// ahí hace falta la contraseña — lo maneja officecrypto-tool (se cablea en la Fase 2).
import JSZip from "jszip";

// Elementos de protección no-criptográfica que se quitan sin clave (prefijo de namespace opcional).
const PROT = ["sheetProtection", "workbookProtection", "documentProtection", "modifyVerifier", "writeProtection"];
const reDe = (tag) => new RegExp(`<(\\w+:)?${tag}\\b[^>]*?(/>|>[\\s\\S]*?</(\\w+:)?${tag}>)`, "g");

const esOLE = (buf) => buf.length >= 4 && buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0;
const esZip = (buf) => buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4B; // "PK"

function formatoDe(name = "") {
  if (/\.xls[xmb]?$/i.test(name)) return "excel";
  if (/\.doc[xm]?$/i.test(name)) return "word";
  if (/\.ppt[xm]?$/i.test(name)) return "powerpoint";
  return "office";
}

/** Analiza un Office sin modificarlo: formato, si está cifrado, y qué restricciones tiene. */
export async function analizarOffice(buf, name) {
  const formato = formatoDe(name);
  if (esOLE(buf)) return { familia: "office", formato, cifrado: true, protecciones: [] };
  if (!esZip(buf)) { const e = new Error("No parece un archivo Office válido."); e.code = "formato"; throw e; }
  const zip = await JSZip.loadAsync(buf);
  const protecciones = [];
  for (const nombre of partesXml(zip)) {
    const xml = await zip.file(nombre).async("string");
    for (const tag of PROT) if (reDe(tag).test(xml)) protecciones.push({ tag, parte: nombre });
  }
  return { familia: "office", formato, cifrado: false, protecciones };
}

/** Tier 1: quita las restricciones de un Office (sin clave). Devuelve el archivo desbloqueado. */
export async function quitarProteccionOffice(buf, name) {
  if (esOLE(buf)) {
    const e = new Error("El archivo Office está cifrado con contraseña: hace falta la clave (Tier 2).");
    e.code = "cifrado"; throw e;
  }
  if (!esZip(buf)) { const e = new Error("No parece un archivo Office válido."); e.code = "formato"; throw e; }
  const zip = await JSZip.loadAsync(buf);
  const quitadas = [];
  for (const nombre of partesXml(zip)) {
    let xml = await zip.file(nombre).async("string");
    let cambiado = false;
    for (const tag of PROT) {
      const re = reDe(tag);
      if (re.test(xml)) { xml = xml.replace(re, ""); cambiado = true; quitadas.push(`${tag} (${nombre})`); }
    }
    if (cambiado) zip.file(nombre, xml);
  }
  if (!quitadas.length) {
    const e = new Error("El archivo no tenía restricciones para quitar."); e.code = "sin-proteccion"; throw e;
  }
  const archivo = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { archivo, formato: formatoDe(name), quitadas };
}

// Partes XML donde pueden vivir las protecciones (evita content-types y rels).
function partesXml(zip) {
  return Object.keys(zip.files).filter((n) =>
    /\.xml$/i.test(n) && (n.startsWith("xl/") || n.startsWith("word/") || n.startsWith("ppt/")));
}
