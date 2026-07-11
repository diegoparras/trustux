// test-archive.mjs — ZIP: fuga de metadatos (siempre) + descifrado a archivo abierto (con 7-Zip).
// El descifrado se saltea si 7z no está instalado (definí SEVENZIP para correrlo).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inspeccionarZip, descifrarArchivo, sevenzipDisponible } from "../unlock-core/archive.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fx = (f) => readFileSync(join(HERE, "..", "fixtures", "unlock", f));

let ok = 0;
const test = async (n, fn) => {
  try { await fn(); ok++; console.log(`  \x1b[32mok\x1b[0m  ${n}`); }
  catch (e) { console.error(`  \x1b[31mFALLA\x1b[0m  ${n}\n    ${e.message}`); process.exitCode = 1; }
};

console.log("archive — inspección de metadatos + descifrado a archivo abierto");

await test("inspeccionarZip: lista el contenido de un ZIP cifrado sin la clave (fuga de metadatos)", () => {
  const r = inspeccionarZip(fx("zip-cifrado.zip"));
  assert.equal(r.familia, "zip");
  assert.equal(r.cifrado, true);
  assert.ok(r.total >= 1, "debería listar al menos una entrada");
  assert.ok(r.entradas.every((e) => typeof e.nombre === "string"));
});

if (!(await sevenzipDisponible())) {
  console.log("  \x1b[33m~\x1b[0m  7-Zip no disponible — se saltea el descifrado (definí SEVENZIP para correrlo)");
} else {
  await test("descifrarArchivo: con la clave, devuelve un ZIP abierto (sin clave) y legible", async () => {
    const { archivo, formato } = await descifrarArchivo(fx("zip-cifrado.zip"), "secreto", "zip");
    assert.equal(formato, "zip");
    assert.ok(Buffer.isBuffer(archivo) && archivo.length > 0);
    // El ZIP de salida ya no está cifrado: se puede inspeccionar y sus entradas no están protegidas.
    const info = inspeccionarZip(archivo);
    assert.equal(info.cifrado, false);
    assert.ok(info.total >= 1);
  });

  await test("descifrarArchivo: clave incorrecta → error code 'clave'", async () => {
    await assert.rejects(
      () => descifrarArchivo(fx("zip-cifrado.zip"), "clave-mala", "zip"),
      (e) => e.code === "clave",
    );
  });
}

console.log(`\n${ok} OK`);
