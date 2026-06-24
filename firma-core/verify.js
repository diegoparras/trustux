// verify.js — Motor de verificación de firma de Trustux (PAdES, JS puro vía pkijs).
//
// Por cada firma del PDF responde: integridad (¿se modificó tras firmar?), identidad
// del firmante (nombre, CUIT, AC), cadena hasta una raíz de confianza, y un veredicto
// con semáforo 🟢🟡🔴. Sin red: todo se resuelve con el documento y el trust store.
//
// Funciona igual en Node y en el browser (mismo pkijs). Acá el engine se cablea con la
// WebCrypto de Node; en el browser, pkijs toma `globalThis.crypto` solo.
import * as asn1js from "asn1js";
import { ContentInfo, SignedData, Certificate, CertificateChainValidationEngine,
         setEngine, CryptoEngine } from "pkijs";
import { webcrypto } from "node:crypto";
import { extraerFirmas, toAB } from "./pades.js";

let _engineListo = false;
function initEngine() {
  if (_engineListo) return;
  const eng = new CryptoEngine({ name: "trustux", crypto: webcrypto });
  setEngine("trustux", eng, eng);
  _engineListo = true;
}

const OID = { CN: "2.5.4.3", SERIAL: "2.5.4.5", OU: "2.5.4.11", O: "2.5.4.10" };
const hex = (u8) => Buffer.from(u8).toString("hex");

/** Carga un certificado desde PEM o DER → pkijs.Certificate. */
export function cargarCert(pemOrDer) {
  let der = pemOrDer;
  if (typeof pemOrDer === "string" || /-----BEGIN/.test(pemOrDer.toString("latin1").slice(0, 64))) {
    const b64 = pemOrDer.toString("latin1").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    der = Buffer.from(b64, "base64");
  }
  return Certificate.fromBER(toAB(Buffer.from(der)));
}

const attr = (cert, oid) => {
  const tv = cert.subject.typesAndValues.find((t) => t.type === oid);
  return tv ? tv.value.valueBlock.value : null;
};

/** Encuentra el certificado del firmante (el referenciado por el SignerInfo). */
function certDelFirmante(sd) {
  const si = sd.signerInfos[0];
  const certs = (sd.certificates || []).filter((c) => c instanceof Certificate);
  // SID por issuer+serial: casamos por número de serie.
  const sidSerial = si?.sid?.serialNumber?.valueBlock?.valueHexView;
  if (sidSerial) {
    const want = hex(sidSerial);
    const m = certs.find((c) => hex(c.serialNumber.valueBlock.valueHexView) === want);
    if (m) return m;
  }
  // Fallback: el certificado hoja (subject ≠ issuer).
  return certs.find((c) => c.subject.toString() !== c.issuer.toString()) || certs[0] || null;
}

/**
 * Verifica todas las firmas de un PDF.
 * @param {Buffer} pdf
 * @param {{trustRoots?: Certificate[]}} opts
 * @returns {Promise<{firmas: object[], global: string}>}
 */
export async function verificar(pdf, { trustRoots = [] } = {}) {
  initEngine();
  const firmas = [];

  for (const f of extraerFirmas(pdf)) {
    const v = { estado: "invalida", integridad: {}, firmante: {}, cadena: {}, observaciones: [],
                provenance: { byteRange: f.byteRange } };
    try {
      const ci = ContentInfo.fromBER(toAB(f.cms));
      const sd = new SignedData({ schema: ci.content });
      const cert = certDelFirmante(sd);

      // 1) Integridad + validez criptográfica de la firma (incluye chequeo de messageDigest).
      let intacta = false;
      try {
        const r = await sd.verify({ signer: 0, data: toAB(f.signedContent), checkChain: false });
        intacta = typeof r === "boolean" ? r : !!(r && (r.signatureVerified ?? r.verified));
      } catch (e) {
        v.observaciones.push(`Verificación criptográfica falló: ${e.message}`);
      }
      v.integridad = { ok: intacta, cubreTodo: f.coversWholeFile, modificadoPostFirma: !intacta };

      // 2) Identidad del firmante (del certificado, nunca de metadata del PDF).
      if (cert) {
        v.firmante = {
          nombre: attr(cert, OID.CN),
          cuit: (attr(cert, OID.SERIAL) || "").replace(/^CUIT\s*/i, "") || null,
          rol: attr(cert, OID.OU),
          organizacion: attr(cert, OID.O),
        };
      }

      // 3) Cadena hasta una raíz de confianza.
      if (cert && trustRoots.length) {
        const certs = (sd.certificates || []).filter((c) => c instanceof Certificate);
        const engine = new CertificateChainValidationEngine({ certs, trustedCerts: trustRoots });
        const res = await engine.verify();
        const confiable = !!res.result;
        v.cadena = { ok: confiable, confiable, raiz: confiable ? nombreRaiz(res) : null };
        if (!confiable) v.observaciones.push(`Cadena no confiable: ${res.resultMessage || "sin ruta a una raíz cargada"}`);
      } else {
        v.cadena = { ok: false, confiable: false, raiz: null };
        if (!trustRoots.length) v.observaciones.push("Sin trust store cargado: no se evaluó la cadena.");
      }

      // 4) Veredicto (semáforo).
      if (!v.integridad.ok) v.estado = "invalida";
      else if (v.cadena.confiable) v.estado = "valida";
      else v.estado = "observada";
    } catch (e) {
      v.observaciones.push(`No se pudo parsear la firma: ${e.message}`);
    }
    firmas.push(v);
  }

  // Veredicto global = la peor firma.
  const peor = ["invalida", "observada", "valida"];
  const global = firmas.length
    ? firmas.map((f) => f.estado).sort((a, b) => peor.indexOf(a) - peor.indexOf(b))[0]
    : "sin-firma";
  return { firmas, global };
}

function nombreRaiz(res) {
  try {
    const path = res.certificatePath || [];
    const root = path[path.length - 1];
    const tv = root?.subject?.typesAndValues?.find((t) => t.type === OID.CN);
    return tv ? tv.value.valueBlock.value : null;
  } catch { return null; }
}
