#!/usr/bin/env python3
"""
gen_fixtures.py — Genera PDFs firmados de ejemplo para probar `firma-core` de Rubrica.

Construye una PKI de prueba de dos niveles (Root CA → firmantes) y produce cuatro
casos que cubren los veredictos del motor:

  01-firmado-integro.pdf   firma única, intacta            → 🟢 válida (si se confía en la root de prueba)
  02-firmado-alterado.pdf  saldo cambiado DESPUÉS de firmar → 🔴 inválida (integridad rota)
  03-doble-firma.pdf       contador + síndico               → 🟢/🟢 (dos firmas válidas)
  04-firmado-con-sello.pdf PAdES-T con sello de tiempo       → 🟢 con sello (best-effort, requiere red)

También exporta la raíz de confianza de prueba a fixtures/trust/test-root-ca.pem para
cargarla en el trust store y ver el camino verde completo.

NO usar estos certificados en producción: son self-signed de juguete, sin valor legal.

Uso:  python scripts/gen_fixtures.py
Deps: pip install "pyHanko[opentype]" reportlab cryptography
"""
from __future__ import annotations
import io
import datetime
from pathlib import Path

from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

from pyhanko.sign import signers, fields
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter

# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "fixtures"
TRUST = FIX / "trust"
FIX.mkdir(parents=True, exist_ok=True)
TRUST.mkdir(parents=True, exist_ok=True)

# Ventana de validez amplia y fija → fixtures reproducibles año a año.
NOT_BEFORE = datetime.datetime(2025, 1, 1, tzinfo=datetime.timezone.utc)
NOT_AFTER = datetime.datetime(2035, 1, 1, tzinfo=datetime.timezone.utc)

# Cadena de texto del saldo. MISMA LONGITUD que la versión alterada (clave: no correr offsets).
SALDO_OK = b"$ 1.000.000,00"
SALDO_MAL = b"$ 9.000.000,00"


def _key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _name(cn, *, cuit=None, org="Rubrica TEST", ou=None):
    parts = [
        x509.NameAttribute(NameOID.COUNTRY_NAME, "AR"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, org),
        x509.NameAttribute(NameOID.COMMON_NAME, cn),
    ]
    if ou:
        parts.append(x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, ou))
    if cuit:
        # En la PKI argentina el CUIT del firmante viaja en el OID serialNumber (2.5.4.5).
        parts.append(x509.NameAttribute(NameOID.SERIAL_NUMBER, f"CUIT {cuit}"))
    return x509.Name(parts)


def make_root():
    key = _key()
    subj = _name("AC Raiz Rubrica TEST - NO USAR EN PRODUCCION", org="Suite Escriba (TEST)")
    cert = (
        x509.CertificateBuilder()
        .subject_name(subj).issuer_name(subj)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(NOT_BEFORE).not_valid_after(NOT_AFTER)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(
            digital_signature=True, key_cert_sign=True, crl_sign=True,
            content_commitment=False, key_encipherment=False, data_encipherment=False,
            key_agreement=False, encipher_only=False, decipher_only=False), critical=True)
        .sign(key, hashes.SHA256())
    )
    return key, cert


def make_signer(cn, cuit, ou, root_key, root_cert):
    key = _key()
    cert = (
        x509.CertificateBuilder()
        .subject_name(_name(cn, cuit=cuit, ou=ou))
        .issuer_name(root_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(NOT_BEFORE).not_valid_after(NOT_AFTER)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(
            digital_signature=True, content_commitment=True,  # content_commitment = no repudio
            key_cert_sign=False, crl_sign=False, key_encipherment=False,
            data_encipherment=False, key_agreement=False, encipher_only=False,
            decipher_only=False), critical=True)
        .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.EMAIL_PROTECTION]), critical=False)
        .sign(root_key, hashes.SHA256())
    )
    return key, cert


def to_p12(path: Path, key, cert, root_cert, friendly: str):
    blob = pkcs12.serialize_key_and_certificates(
        name=friendly.encode(), key=key, cert=cert,
        cas=[root_cert], encryption_algorithm=serialization.BestAvailableEncryption(b"1234"))
    path.write_bytes(blob)


def base_pdf() -> bytes:
    """Un 'balance' mínimo. pageCompression=0 → el texto queda como literal en el stream,
    así la alteración del saldo es un simple find/replace de bytes."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4, pageCompression=0)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(60, 760, "Estado de Situacion Patrimonial (EJEMPLO)")
    c.setFont("Helvetica", 11)
    c.drawString(60, 730, "Comitente: ACME S.A.   CUIT: 30-71234567-8")
    c.drawString(60, 705, "Ejercicio cerrado al 31/12/2025")
    c.setFont("Helvetica-Bold", 13)
    c.drawString(60, 670, "TOTAL ACTIVO: " + SALDO_OK.decode())
    c.setFont("Helvetica", 9)
    c.drawString(60, 120, "Documento de prueba de Rubrica - sin valor legal.")
    c.showPage()
    c.save()
    return buf.getvalue()


def sign(pdf_bytes: bytes, field: str, signer, *, box, reason, timestamper=None) -> bytes:
    w = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))
    fields.append_signature_field(w, fields.SigFieldSpec(sig_field_name=field, box=box))
    meta = signers.PdfSignatureMetadata(field_name=field, reason=reason, location="CABA, AR")
    out = signers.sign_pdf(w, meta, signer=signer, timestamper=timestamper)
    return out.getvalue()


def main():
    print("PKI de prueba…")
    root_key, root_cert = make_root()
    TRUST.joinpath("test-root-ca.pem").write_bytes(
        root_cert.public_bytes(serialization.Encoding.PEM))
    print("  raiz → fixtures/trust/test-root-ca.pem")

    ck, cc = make_signer("PEREZ, Juan Carlos", "20-12345678-9", "Contador Publico", root_key, root_cert)
    sk, sc = make_signer("GOMEZ, Maria Elena", "27-23456789-4", "Sindico", root_key, root_cert)
    to_p12(ROOT / "scripts" / "_contador.p12", ck, cc, root_cert, "Contador")
    to_p12(ROOT / "scripts" / "_sindico.p12", sk, sc, root_cert, "Sindico")
    contador = signers.SimpleSigner.load_pkcs12(ROOT / "scripts" / "_contador.p12", passphrase=b"1234")
    sindico = signers.SimpleSigner.load_pkcs12(ROOT / "scripts" / "_sindico.p12", passphrase=b"1234")

    base = base_pdf()

    # 01 — firma única, íntegra
    f01 = sign(base, "FirmaContador", contador,
               box=(60, 300, 320, 360), reason="Firma del contador certificante")
    (FIX / "01-firmado-integro.pdf").write_bytes(f01)
    print("  01-firmado-integro.pdf")

    # 02 — alterar el saldo DESPUÉS de firmar (misma longitud → no corre offsets, rompe el digest)
    assert SALDO_OK in f01, "no se halló el saldo en el PDF firmado (¿se comprimió el stream?)"
    assert len(SALDO_OK) == len(SALDO_MAL)
    f02 = f01.replace(SALDO_OK, SALDO_MAL, 1)
    (FIX / "02-firmado-alterado.pdf").write_bytes(f02)
    print("  02-firmado-alterado.pdf  (saldo 1.000.000 → 9.000.000 post-firma)")

    # 03 — segunda firma incremental (síndico) sobre el PDF ya firmado por el contador
    f03 = sign(f01, "FirmaSindico", sindico,
               box=(330, 300, 560, 360), reason="Certificacion de la sindicatura")
    (FIX / "03-doble-firma.pdf").write_bytes(f03)
    print("  03-doble-firma.pdf")

    # 04 — PAdES-T con sello de tiempo (best-effort: necesita una TSA pública por red)
    try:
        from pyhanko.sign.timestamps import HTTPTimeStamper
        ts = HTTPTimeStamper(url="https://freetsa.org/tsr")
        f04 = sign(base, "FirmaConSello", contador,
                   box=(60, 300, 320, 360), reason="Firma con sello de tiempo", timestamper=ts)
        (FIX / "04-firmado-con-sello.pdf").write_bytes(f04)
        print("  04-firmado-con-sello.pdf")
    except Exception as e:  # sin red / TSA caída → se omite, los otros 3 alcanzan
        print(f"  04-firmado-con-sello.pdf  OMITIDO (sin TSA: {type(e).__name__})")

    # limpieza de los .p12 temporales (las claves privadas no se commitean)
    for p in ("_contador.p12", "_sindico.p12"):
        (ROOT / "scripts" / p).unlink(missing_ok=True)
    print("Listo.")


if __name__ == "__main__":
    main()
