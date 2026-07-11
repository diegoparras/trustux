// office-agile.js — Descifrado de Office cifrado con contraseña (ECMA-376 Agile Encryption).
//
// Port server-side de la solución del usuario (GoodUnLock/index.html, función decryptAgile):
// misma lógica —parsear el CFB, derivar clave con spinCount, verificar la contraseña y descifrar
// el paquete por segmentos de 4096— pero con node:crypto (en vez de CryptoJS) y el paquete `cfb`.
// Un Office cifrado no es un ZIP sino un contenedor OLE/CFB (magic D0CF11E0).
import { createHash, createDecipheriv } from "node:crypto";
import * as CFB from "cfb";

// blockKeys constantes (MS-OFFCRYPTO).
const BLOCK_VERIFIER_INPUT = Buffer.from([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]);
const BLOCK_VERIFIER_VALUE = Buffer.from([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]);
const BLOCK_KEY_VALUE = Buffer.from([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]);

const HASH = { SHA1: "sha1", SHA256: "sha256", SHA384: "sha384", SHA512: "sha512" };
function hashBytes(algo, buf) {
  const node = HASH[algo];
  if (!node) throw new Error("hashAlgorithm no soportado: " + algo);
  return createHash(node).update(buf).digest();
}
function aesCbcNoPad(key, iv, data) {
  const algo = key.length === 32 ? "aes-256-cbc" : key.length === 24 ? "aes-192-cbc" : "aes-128-cbc";
  const d = createDecipheriv(algo, key, iv);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(data), d.final()]);
}
const utf16le = (s) => Buffer.from(s, "utf16le");
const le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };

// Derivación de clave con spinCount (idéntica a la del usuario).
function deriveKey(passwordBuf, salt, hashAlgo, spinCount, blockKey, keyBits) {
  let h = hashBytes(hashAlgo, Buffer.concat([salt, passwordBuf]));
  for (let i = 0; i < spinCount; i++) h = hashBytes(hashAlgo, Buffer.concat([le32(i), h]));
  const hfinal = hashBytes(hashAlgo, Buffer.concat([h, blockKey]));
  const keyLen = keyBits / 8;
  if (hfinal.length >= keyLen) return hfinal.subarray(0, keyLen);
  const out = Buffer.alloc(keyLen, 0x36);
  hfinal.copy(out, 0);
  return out;
}
function getAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*\\b${attr}="([^"]*)"`));
  return m ? m[1] : null;
}
const b64 = (s) => Buffer.from(s, "base64");

// Parsea el CFB + el XML de EncryptionInfo → parámetros del cifrado agile (una sola vez).
export function parseAgile(fileBytes) {
  const cont = CFB.read(fileBytes, { type: "buffer" });
  const stream = (name) => {
    const i = cont.FullPaths.findIndex((p) => p.split("/").pop() === name);
    return i >= 0 ? Buffer.from(cont.FileIndex[i].content) : null;
  };
  const encInfo = stream("EncryptionInfo");
  const encPackage = stream("EncryptedPackage");
  if (!encInfo || !encPackage) { const e = new Error("faltan EncryptionInfo/EncryptedPackage"); e.code = "no-aplica"; throw e; }
  const vMajor = encInfo[0] | (encInfo[1] << 8), vMinor = encInfo[2] | (encInfo[3] << 8);
  if (!(vMajor === 4 && vMinor === 4)) {
    const e = new Error(`Solo se soporta Agile Encryption (v4.4); este archivo es v${vMajor}.${vMinor} (esquema Standard/antiguo).`);
    e.code = "no-soportado"; throw e;
  }
  const xml = encInfo.subarray(8).toString("utf8");
  return {
    encPackage,
    keyData: {
      saltValue: b64(getAttr(xml, "keyData", "saltValue")),
      hashAlgorithm: getAttr(xml, "keyData", "hashAlgorithm"),
      blockSize: parseInt(getAttr(xml, "keyData", "blockSize"), 10),
    },
    ek: {
      spinCount: parseInt(getAttr(xml, "encryptedKey", "spinCount"), 10),
      saltValue: b64(getAttr(xml, "encryptedKey", "saltValue")),
      hashAlgorithm: getAttr(xml, "encryptedKey", "hashAlgorithm"),
      keyBits: parseInt(getAttr(xml, "encryptedKey", "keyBits"), 10),
      encryptedVerifierHashInput: b64(getAttr(xml, "encryptedKey", "encryptedVerifierHashInput")),
      encryptedVerifierHashValue: b64(getAttr(xml, "encryptedKey", "encryptedVerifierHashValue")),
      encryptedKeyValue: b64(getAttr(xml, "encryptedKey", "encryptedKeyValue")),
    },
  };
}

// ¿La contraseña es correcta para estos parámetros? (solo verifica, no descifra el paquete).
export function verificarClave(parsed, password) {
  const { ek } = parsed, pwd = utf16le(password);
  const kIn = deriveKey(pwd, ek.saltValue, ek.hashAlgorithm, ek.spinCount, BLOCK_VERIFIER_INPUT, ek.keyBits);
  const kVal = deriveKey(pwd, ek.saltValue, ek.hashAlgorithm, ek.spinCount, BLOCK_VERIFIER_VALUE, ek.keyBits);
  const verifierInput = aesCbcNoPad(kIn, ek.saltValue, ek.encryptedVerifierHashInput);
  const verifierHashDec = aesCbcNoPad(kVal, ek.saltValue, ek.encryptedVerifierHashValue);
  const computed = hashBytes(ek.hashAlgorithm, verifierInput);
  return computed.subarray(0, verifierHashDec.length).equals(verifierHashDec.subarray(0, computed.length));
}

// Descifra el paquete con una contraseña ya verificada.
function descifrarPaquete(parsed, password) {
  const { ek, keyData, encPackage } = parsed, pwd = utf16le(password);
  const secretKey = aesCbcNoPad(
    deriveKey(pwd, ek.saltValue, ek.hashAlgorithm, ek.spinCount, BLOCK_KEY_VALUE, ek.keyBits),
    ek.saltValue, ek.encryptedKeyValue);
  const totalSize = Number(encPackage.readBigUInt64LE(0));
  const cipher = encPackage.subarray(8);
  const SEG = 4096, partes = [];
  for (let seg = 0; seg * SEG < cipher.length; seg++) {
    const iv = hashBytes(keyData.hashAlgorithm, Buffer.concat([keyData.saltValue, le32(seg)])).subarray(0, keyData.blockSize);
    partes.push(aesCbcNoPad(secretKey, iv, cipher.subarray(seg * SEG, seg * SEG + SEG)));
  }
  return Buffer.concat(partes).subarray(0, totalSize);
}

/** Tier 2: descifra un Office cifrado (agile) con la clave. Devuelve el OOXML en claro. */
export function decryptAgile(fileBytes, password) {
  const parsed = parseAgile(fileBytes);
  if (!verificarClave(parsed, password)) { const e = new Error("WRONG_PASSWORD"); e.code = "clave"; throw e; }
  return descifrarPaquete(parsed, password);
}

/**
 * Tier 3: recupera la contraseña de un Office cifrado probando una wordlist (diccionario).
 * Pure JS, sin binarios — reusa el mismo verificador que el descifrado. Devuelve la clave
 * hallada + el OOXML en claro, o null si ninguna candidata funcionó.
 * @param {(i:number,total:number)=>void} [onProgress]
 */
export function recuperarClaveAgile(fileBytes, candidatos, onProgress) {
  const parsed = parseAgile(fileBytes);   // se parsea una sola vez
  for (let i = 0; i < candidatos.length; i++) {
    const cand = candidatos[i];
    if (onProgress && i % 50 === 0) onProgress(i, candidatos.length);
    if (verificarClave(parsed, cand)) return { password: cand, archivo: descifrarPaquete(parsed, cand) };
  }
  return null;
}
