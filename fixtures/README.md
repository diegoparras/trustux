# Fixtures de prueba — PDFs firmados

PDFs firmados digitalmente para probar el motor de verificación de Rubrica. Generados de
forma reproducible por [`scripts/gen_fixtures.py`](../scripts/gen_fixtures.py) con una PKI de
prueba de dos niveles (Root CA → firmantes).

> ⚠️ **Sin valor legal.** Los certificados son self-signed de juguete. La raíz de prueba está
> en [`trust/test-root-ca.pem`](trust/test-root-ca.pem): cargala en el trust store para ver el
> camino verde; sin ella, las firmas son íntegras pero de raíz **no confiable** (🟡).

## Tabla de verdad (lo que el motor debe responder)

| Archivo | Firmas | Integridad | Cadena (con root de prueba) | Sello | Veredicto esperado |
|---------|:------:|:----------:|:---------------------------:|:-----:|--------------------|
| `01-firmado-integro.pdf` | 1 | ✅ íntegra | ✅ confiable | — | 🟢 **válida** |
| `02-firmado-alterado.pdf` | 1 | ❌ **rota** | (irrelevante) | — | 🔴 **inválida** |
| `03-doble-firma.pdf` | 2 | ✅ ✅ | ✅ ✅ | — | 🟢 🟢 (contador + síndico) |
| `04-firmado-con-sello.pdf` | 1 | ✅ íntegra | ✅ confiable | ✅ TSA | 🟢 **con sello** (TSA no confiable offline → 🟡 si se exige cadena de la TSA) |

## Detalle de cada caso

- **01 — íntegro.** Firma única del contador *PEREZ, Juan Carlos* (`CUIT 20-12345678-9`). El
  caso feliz: integridad ✓, cadena a la raíz de prueba ✓, cubre todo el archivo.

- **02 — alterado.** Es el `01` con el **TOTAL ACTIVO cambiado de `1.000.000` a `9.000.000`
  después de firmar** (misma cantidad de bytes, para no correr offsets). El digest de la firma
  ya no cierra → **integridad rota**. Es el caso que justifica todo el producto: detectar que
  alguien tocó la cifra después de la firma.

- **03 — doble firma.** El `01` con una **segunda firma incremental** del síndico
  *GOMEZ, María Elena* (`CUIT 27-23456789-4`). La primera firma cubre su revisión; la segunda,
  todo el archivo. Prueba el manejo de múltiples firmantes (contador que confecciona + síndico
  que certifica), patrón típico de un EECC.

- **04 — con sello de tiempo.** Firma del contador con **sello de tiempo RFC 3161 (PAdES-T)**
  de una TSA pública. La firma es válida y confiable; la cadena del **sello** no se valida offline
  porque la raíz de la TSA no está en el trust store — buen caso para la regla 🟡 "sello presente,
  TSA no verificable sin red".

## Regenerar

```bash
pip install "pyHanko[opentype]" reportlab cryptography
python scripts/gen_fixtures.py     # produce los 4 PDFs + trust/test-root-ca.pem
python scripts/verify_check.py     # los valida con pyHanko como verificador de referencia
```

En Windows, si la consola corta los acentos: `set PYTHONUTF8=1` antes de correr.
