#!/usr/bin/env python3
"""Sanity-check de los fixtures con pyHanko como verificador de referencia.
Confirma el veredicto esperado de cada PDF antes de construir firma-core."""
from pathlib import Path
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext
from asn1crypto import pem, x509

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "fixtures"

# Trust store = solo la root de prueba (como haría el admin al cargarla en Trustux).
der = FIX / "trust" / "test-root-ca.pem"
data = der.read_bytes()
if pem.detect(data):
    _, _, data = pem.unarmor(data)
root = x509.Certificate.load(data)
vc = ValidationContext(trust_roots=[root], allow_fetching=False)  # offline

for pdf in sorted(FIX.glob("*.pdf")):
    r = PdfFileReader(pdf.open("rb"))
    sigs = r.embedded_signatures
    print(f"\n{pdf.name}  — {len(sigs)} firma(s)")
    for s in sigs:
        st = validate_pdf_signature(s, vc)
        signer = "?"
        try:
            signer = s.signer_cert.subject.human_friendly
        except Exception:
            pass
        print(f"  • intacta={st.intact}  valida={st.valid}  confiable={st.trusted}  "
              f"cubre_todo={st.coverage}  firmante={signer[:60]}")
