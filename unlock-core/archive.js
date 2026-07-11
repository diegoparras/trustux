// archive.js — Inspección de archivos ZIP (fuga de metadatos, atajo garantizado).
//
// El ZIP guarda su índice central (nombres, tamaños, fechas, CRC-32, si está cifrado) SIN cifrar,
// aunque el contenido de cada archivo tenga contraseña. Así que siempre se puede ver QUÉ hay
// adentro de un ZIP protegido sin la clave. No rompe cripto: lee un dato que el formato deja
// expuesto. (7z/RAR pueden cifrar el índice; el ZIP no.)
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
