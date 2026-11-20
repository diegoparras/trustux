// test-novedades.mjs — Novedades por versión: salen del CHANGELOG.md (una sola fuente) y se
// muestran en el log de arranque (deploy en EasyPanel), en la UI al entrar después de una
// actualización y en el Release de GitHub.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as nov from "../server/novedades.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let ok = 0;
const test = async (nombre, fn) => {
  try { await fn(); ok++; console.log(`  \x1b[32mok\x1b[0m  ${nombre}`); }
  catch (e) { console.error(`  \x1b[31mFALLA\x1b[0m  ${nombre}\n    ${e.message}`); process.exitCode = 1; }
};

const MUESTRA = `# Changelog

Formato basado en Keep a Changelog.

## [0.3.0] - 2026-11-21

### Nuevo
- **Novedades** en la UI: se ven al entrar
  despues de una actualizacion (\`GET /api/novedades\`).

### Corregido
- Un arreglo corto.

## [0.2.1] - 2026-11-20

### Corregido
- Otro arreglo.

## [0.2.0] - 2026-11-19

### Nuevo
- Algo grande.
`;

console.log("novedades — CHANGELOG, cartel de arranque y notas del Release");

await test("parsea versiones, fechas, secciones e items multilinea (LF y CRLF)", () => {
  const v = nov.parsear(MUESTRA);
  assert.deepEqual(v.map((x) => x.version), ["0.3.0", "0.2.1", "0.2.0"]);
  assert.equal(v[0].fecha, "2026-11-21");
  assert.deepEqual(v[0].secciones.map((s) => s.titulo), ["Nuevo", "Corregido"]);
  assert.deepEqual(v[0].secciones[0].items, ["**Novedades** en la UI: se ven al entrar despues de una actualizacion (`GET /api/novedades`)."]);
  assert.deepEqual(nov.parsear(MUESTRA.replace(/\n/g, "\r\n")), v);
});

await test("desde la ultima version vista hasta la actual, de la mas nueva a la mas vieja", () => {
  const v = nov.parsear(MUESTRA);
  assert.deepEqual(nov.desde(v, "0.2.0", "0.3.0").map((x) => x.version), ["0.3.0", "0.2.1"]);
  assert.deepEqual(nov.desde(v, "0.3.0", "0.3.0"), [], "ya vista: nada que mostrar");
  assert.deepEqual(nov.desde(v, null, "0.3.0").map((x) => x.version), ["0.3.0"], "primera vez: solo la actual");
  assert.deepEqual(nov.desde(v, "0.2.0", "0.2.1").map((x) => x.version), ["0.2.1"], "nunca muestra versiones posteriores a la que corre");
  assert.deepEqual(nov.desde(v, "0.10.0", "0.3.0"), [], "compara como version, no como texto");
});

await test("texto plano para el log y notas en markdown para el Release", () => {
  const [v] = nov.parsear(MUESTRA);
  assert.deepEqual(nov.lineasLog(v), [
    "Nuevo: Novedades en la UI: se ven al entrar despues de una actualizacion (GET /api/novedades).",
    "Corregido: Un arreglo corto.",
  ]);
  const md = nov.notasMarkdown(v);
  assert.match(md, /^### Nuevo\n- \*\*Novedades\*\* en la UI/);
  assert.match(md, /### Corregido\n- Un arreglo corto\./);
});

await test("cartel de arranque: primero la version, despues que cambia, cortado al ancho", () => {
  const v = nov.parsear(MUESTRA);
  const l = nov.cartelArranque("0.3.0", v, 60);
  assert.ok(l.every((x) => x.length <= 60), "ningun renglon pasa el ancho");
  assert.match(l[0], /^=+$/);
  assert.equal(l[1], "TRUSTUX v0.3.0  (2026-11-21)");
  assert.equal(l[2], "Que cambia en esta version:");
  assert.equal(l[3], "- Nuevo: Novedades en la UI: se ven al entrar despues de una");
  assert.match(l[4], /^ {4}actualizacion/, "la continuacion queda sangrada");
  assert.match(l[l.length - 1], /^=+$/);
  assert.ok(!l.some((x) => /\*\*|`/.test(x)), "sin markdown");
  assert.ok(nov.cartelArranque("0.3.0", v).every((x) => x.length <= 80), "por defecto, 80 columnas");
});

await test("sin seccion o sin CHANGELOG: lo dice y no rompe", () => {
  const sin = nov.cartelArranque("9.9.9", nov.parsear(MUESTRA), 60);
  assert.equal(sin[1], "TRUSTUX v9.9.9");
  assert.equal(sin[2], "Sin notas para esta version en el CHANGELOG.");
  assert.equal(nov.cartelArranque("1.0.0", null)[2], "Sin notas para esta version en el CHANGELOG.");
});

await test("el CHANGELOG real tiene la seccion de la version de package.json (cada deploy dice que cambia)", () => {
  const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const v = nov.parsear(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));
  const actual = v.find((x) => x.version === version);
  assert.ok(actual, `falta "## [${version}]" en CHANGELOG.md`);
  assert.ok(actual.secciones.some((s) => s.items.length), `la seccion ${version} del CHANGELOG esta vacia`);
  assert.equal(v[0].version, version, "la version de package.json es la primera del CHANGELOG");
  assert.equal(nov.versionInstalada(), version);
  assert.ok(nov.todas().some((x) => x.version === version), "todas() lee el CHANGELOG de la instalacion");
});

console.log(`\n${ok}/6 OK`);
