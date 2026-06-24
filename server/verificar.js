// verificar.js — Adaptador del servidor standalone: carga el trust store y enruta el
// documento subido al motor correcto (PAdES si es PDF, XAdES si es XML). El documento no
// se persiste: se verifica y se descarta. Sin red (revocación offline por CRL del trust store).
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verificar, cargarCert, cargarCRL } from "../firma-core/verify.js";
import { verificarXml } from "../firma-core/xades.js";
import { verificarCms } from "../firma-core/cades.js";

const TRUST_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "trust");

let _roots = null, _crls = null, _info = null;
function cargarTrust() {
  if (_roots) return;
  _roots = []; _crls = []; _info = [];
  let files = [];
  try { files = readdirSync(TRUST_DIR); } catch { /* sin dir */ }
  for (const f of files) {
    try {
      if (/\.(pem|crt|cer)$/i.test(f)) {
        const cert = cargarCert(readFileSync(join(TRUST_DIR, f)));
        _roots.push(cert);
        const cn = cert.subject.typesAndValues.find((t) => t.type === "2.5.4.3");
        _info.push({ archivo: f, cn: cn ? cn.value.valueBlock.value : f });
      } else if (/\.crl$/i.test(f)) {
        _crls.push(cargarCRL(readFileSync(join(TRUST_DIR, f))));
      }
    } catch { /* archivo ilegible: lo ignoramos */ }
  }
}

/** Raíces de confianza activas (para mostrar en la UI). */
export function trustInfo() { cargarTrust(); return _info; }

/** Verifica un documento firmado (PDF o XML). Detecta el tipo por su contenido. */
export async function verificarDocumento(buf) {
  cargarTrust();
  const head = buf.slice(0, 256).toString("latin1").replace(/^﻿/, "").trimStart();
  if (head.startsWith("%PDF")) {
    return { tipo: "PDF (PAdES)", ...(await verificar(buf, { trustRoots: _roots, crls: _crls })) };
  }
  if (head.startsWith("<")) {
    return { tipo: "XML (XAdES)", ...(await verificarXml(buf.toString("utf8"), { trustRoots: _roots })) };
  }
  // CMS / CAdES: PEM (-----BEGIN PKCS7/CMS) o DER (ASN.1 SEQUENCE = byte 0x30).
  if (/^-----BEGIN (PKCS7|CMS)/.test(head) || buf[0] === 0x30) {
    return { tipo: "CMS (CAdES)", ...(await verificarCms(buf, { trustRoots: _roots, crls: _crls })) };
  }
  const e = new Error("Formato no reconocido: se espera un PDF, un XML o un CMS (.p7m/.p7s) firmado.");
  e.code = "formato";
  throw e;
}
