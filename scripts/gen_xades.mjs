// gen_xades.mjs — Genera una factura XML firmada (XAdES/XML-DSig) de ejemplo para probar
// el motor xades.js. Crea una PKI propia (raíz → firmante con CUIT) y firma un comprobante
// estilo AFIP; produce además una versión alterada (importe cambiado tras firmar) que debe
// dar inválida. Todo con el stack de PeculiarVentures. Sin valor legal.
//
// Uso:  node scripts/gen_xades.mjs
import "reflect-metadata";   // requerido por @peculiar/x509 (tsyringe)
import * as x509 from "@peculiar/x509";
import { Crypto } from "@peculiar/webcrypto";
import * as xadesjs from "xadesjs";
import { DOMParser, XMLSerializer, DOMImplementation } from "@xmldom/xmldom";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const crypto = new Crypto();
x509.cryptoProvider.set(crypto);
xadesjs.Application.setEngine("NodeJS", crypto);
xadesjs.setNodeDependencies({ DOMParser, XMLSerializer, DOMImplementation });

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "xades");
mkdirSync(OUT, { recursive: true });

const alg = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 };
const notBefore = new Date("2025-01-01T00:00:00Z");
const notAfter = new Date("2035-01-01T00:00:00Z");

// --- PKI de prueba: raíz que emite el certificado del firmante ---
const caKeys = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);
const caCert = await x509.X509CertificateGenerator.createSelfSigned({
  serialNumber: "01",
  name: "CN=AC Raiz Trustux XAdES TEST - NO USAR EN PRODUCCION, C=AR",
  notBefore, notAfter, keys: caKeys, signingAlgorithm: alg,
  extensions: [new x509.BasicConstraintsExtension(true, undefined, true)],
});

const leafKeys = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);
const leafCert = await x509.X509CertificateGenerator.create({
  serialNumber: "02",
  // CUIT en el OID 2.5.4.5 (serialNumber), igual que en los certificados argentinos.
  subject: "CN=PEREZ Juan Carlos, 2.5.4.5=CUIT 20-12345678-9, O=ACME SA, C=AR",
  issuer: caCert.subject,
  notBefore, notAfter,
  signingKey: caKeys.privateKey, publicKey: leafKeys.publicKey, signingAlgorithm: alg,
});

// --- Comprobante estilo AFIP ---
const factura = `<?xml version="1.0" encoding="UTF-8"?>
<comprobante tipo="FacturaC" pto_vta="0001" nro="00001234">
  <emisor cuit="20123456789">ACME SA</emisor>
  <receptor cuit="30712345678">Cliente SRL</receptor>
  <fecha>2026-06-20</fecha>
  <importe_total>121000.00</importe_total>
  <cae>74123456789012</cae>
</comprobante>`;

const doc = new DOMParser().parseFromString(factura, "application/xml");
const signed = new xadesjs.SignedXml();
const signature = await signed.Sign(alg, leafKeys.privateKey, doc, {
  keyValue: leafKeys.publicKey,
  references: [{ hash: "SHA-256", transforms: ["enveloped"] }],
  x509: [Buffer.from(leafCert.rawData).toString("base64")],
});
doc.documentElement.appendChild(signature.GetXml());
const xmlFirmado = new XMLSerializer().serializeToString(doc);
writeFileSync(join(OUT, "factura-firmada.xml"), xmlFirmado);
console.log("  factura-firmada.xml");

// Alterada: cambiar el importe DESPUÉS de firmar → el digest no cierra → inválida.
const xmlAlterado = xmlFirmado.replace("121000.00", "999000.00");
writeFileSync(join(OUT, "factura-alterada.xml"), xmlAlterado);
console.log("  factura-alterada.xml  (importe 121000 -> 999000 post-firma)");

writeFileSync(join(OUT, "xades-root-ca.pem"), caCert.toString("pem"));
console.log("  xades-root-ca.pem");
console.log("Listo.");
