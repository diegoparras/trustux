// cli.js — Verifica los PDFs de fixtures/ y muestra el veredicto de cada firma.
// Uso:  node firma-core/cli.js [archivo.pdf ...]   (sin args → corre sobre fixtures/)
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { verificar, cargarCert, cargarCRL } from "./verify.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Color en terminal (ANSI), sin emojis: verde=válida, amarillo=observada, rojo=inválida.
const C = { g: "\x1b[32m", y: "\x1b[33m", r: "\x1b[31m", d: "\x1b[90m", x: "\x1b[0m" };
const SEM = { valida: `${C.g}válida${C.x}`, observada: `${C.y}observada${C.x}`,
              invalida: `${C.r}inválida${C.x}`, "sin-firma": `${C.d}sin firma${C.x}` };

const TRUST = join(ROOT, "fixtures/trust");
const trustRoots = readdirSync(TRUST).filter((f) => /\.(pem|crt|cer)$/i.test(f))
  .map((f) => cargarCert(readFileSync(join(TRUST, f))));
const crls = readdirSync(TRUST).filter((f) => /\.crl$/i.test(f))
  .map((f) => cargarCRL(readFileSync(join(TRUST, f))));

const args = process.argv.slice(2);
const pdfs = args.length
  ? args
  : readdirSync(join(ROOT, "fixtures")).filter((f) => f.endsWith(".pdf")).map((f) => join(ROOT, "fixtures", f));

for (const p of pdfs) {
  const { firmas, global } = await verificar(readFileSync(p), { trustRoots, crls });
  console.log(`\n${basename(p)}  →  ${SEM[global] || global}   (${firmas.length} firma/s)`);
  for (const f of firmas) {
    const fr = f.firmante;
    console.log(`  ${SEM[f.estado]}  ${fr.nombre || "?"}  CUIT ${fr.cuit || "?"}  [${fr.rol || "-"}]`);
    console.log(`     integridad=${f.integridad.ok}  cubreTodo=${f.integridad.cubreTodo}  cadena=${f.cadena.confiable}` +
                (f.cadena.raiz ? `  raíz="${f.cadena.raiz}"` : ""));
    console.log(`     algoritmo=${f.algoritmo}  firmado=${f.firmadoEl || "-"}  sello=${f.selloTiempo?.presente ? "sí" : "no"}  revocación=${f.revocacion?.revocado ? "REVOCADO" : f.revocacion?.metodo}`);
    for (const o of f.observaciones) console.log(`     · ${o}`);
  }
}
