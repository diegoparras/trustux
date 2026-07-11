// vba.js — Desprotección del proyecto VBA de un libro Office (atajo estructural, sin contraseña).
//
// Port de la solución del usuario (GoodUnLock): dentro de xl/vbaProject.bin (un contenedor OLE/CFB)
// vive el stream de texto PROJECT con las líneas CMG=/DPB=/GC= — son el candado del proyecto de
// macros. Se borran esas líneas y el proyecto queda abierto. No adivina nada: es un dato que se
// quita. Opera sobre un JSZip ya cargado (el .xlsm/.xlsm es un zip).
import * as CFB from "cfb";

const RE_SELLOS = /^[ \t]*(CMG|DPB|GC)=.*\r?\n/gim;
const tieneSellos = (txt) => /(^|\n)[ \t]*(CMG|DPB|GC)=/i.test(txt);

function leerProject(cfb) {
  const idx = cfb.FullPaths.findIndex((p) => p.split("/").pop() === "PROJECT");
  if (idx < 0) return null;
  return { idx, txt: Buffer.from(cfb.FileIndex[idx].content).toString("latin1") };
}

/** ¿El libro tiene un proyecto VBA protegido? (no modifica) */
export async function tieneVbaProtegido(zip) {
  const f = zip.file("xl/vbaProject.bin");
  if (!f) return false;
  try {
    const proj = leerProject(CFB.read(await f.async("nodebuffer"), { type: "buffer" }));
    return proj ? tieneSellos(proj.txt) : false;
  } catch { return false; }
}

/**
 * Quita la contraseña del proyecto VBA modificando xl/vbaProject.bin dentro del JSZip (en su lugar).
 * @returns {Promise<string[]>} lista de sellos levantados (vacía si no había VBA protegido)
 */
export async function quitarVbaDeZip(zip) {
  const f = zip.file("xl/vbaProject.bin");
  if (!f) return [];
  let cfb;
  try { cfb = CFB.read(await f.async("nodebuffer"), { type: "buffer" }); }
  catch { const e = new Error("vbaProject.bin no es un OLE válido: no se toca."); e.code = "vba-ole"; throw e; }
  const proj = leerProject(cfb);
  if (!proj || !tieneSellos(proj.txt)) return [];
  const limpio = Buffer.from(proj.txt.replace(RE_SELLOS, ""), "latin1");
  cfb.FileIndex[proj.idx].content = limpio;
  cfb.FileIndex[proj.idx].size = limpio.length;
  zip.file("xl/vbaProject.bin", CFB.write(cfb, { type: "buffer" }));
  return ["contraseña del proyecto VBA (CMG/DPB/GC)"];
}
