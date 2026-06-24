<div align="center">

# 🖋️ Rubrica

**Cada firma, verificada. En tu máquina.**

Verificación de firma digital **100% local** para documentos firmados (PDF/PAdES). Subís un
balance, un dictamen o un escrito firmado y Rubrica responde — sin que el documento salga de tu
equipo — si la firma es **íntegra** (¿se modificó después de firmar?), si el firmante es **quien
dice ser** (cadena hasta la AC Raíz Argentina, con extracción de CUIT/CUIL) y si el certificado
estaba **vigente** al firmar. Veredicto con semáforo 🟢🟡🔴 e informe exportable.

Parte de la familia [**Escriba**](https://github.com/diegoparras/escriba). Nace como el
verificador de firma de [Selega](https://github.com/diegoparras/selega) —cierra el lazo de la
legalización: *cifras que cierran **y** firma del matriculado verificada*— y crece a app standalone.

![Local](https://img.shields.io/badge/local-100%25-7c3aed) ![Self-hosted](https://img.shields.io/badge/self--hosted-✓-7c3aed) ![Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-7c3aed)

> Estado: **Fase 0 — spec + fixtures.** El motor (`firma-core`) y la integración con Selega
> vienen a continuación. Ver [`docs/SPEC.md`](docs/SPEC.md).

</div>

---

## Por qué

Los validadores de firma habituales son **online**: subís un documento legal sensible a un
tercero que *promete* no guardarlo. Rubrica corre **en tu máquina** — el documento nunca sale,
igual que [Anonimal](https://github.com/diegoparras/anonimal) con los datos personales. Para una
Secretaría Técnica que recibe balances firmados, eso no es comodidad: es la diferencia entre
poder usar la herramienta y no poder.

## Qué verifica

- **Integridad** — el documento no se tocó después de firmarse (detección de cambios y de
  actualizaciones incrementales post-firma).
- **Identidad** — cadena de certificados hasta una raíz de confianza (**AC Raíz República
  Argentina** precargada, editable por jurisdicción); extrae nombre, **CUIT/CUIL**, AC emisora y rol.
- **Vigencia** — revocación (CRL/OCSP, *offline-first*) y sello de tiempo (RFC 3161).
- **Estándares** — PAdES (PDF) en el MVP; XAdES (facturas AFIP/ARCA) y CAdES (`.p7s`) después.

## Integración con Selega

Entra como una **capacidad opcional, apagada por defecto**: solo el superadmin la prende
(`cap_firma`). Con la firma encendida, el veredicto alimenta el desenlace de Selega
(legaliza / observa / **certifica firma** / deniega). Con la firma apagada, Selega funciona
exactamente como hoy. Detalle en [`docs/SPEC.md`](docs/SPEC.md).

## Fixtures de prueba

El repo trae cuatro PDFs firmados de ejemplo en [`fixtures/`](fixtures/) —íntegro, alterado,
doble firma y con sello de tiempo— con su [tabla de verdad](fixtures/README.md). Son la base
para desarrollar y testear el motor. Regenerables con:

```bash
pip install -r scripts/requirements.txt
python scripts/gen_fixtures.py     # genera los PDFs + la raíz de confianza de prueba
python scripts/verify_check.py     # los valida con pyHanko (verificador de referencia)
```

## Estructura

```
rubrica/
├── docs/SPEC.md          spec técnica + alcance del MVP
├── fixtures/             PDFs firmados de ejemplo + trust/ (raíz de prueba)
│   └── README.md         tabla de verdad (veredicto esperado de cada PDF)
└── scripts/              generador y validador de fixtures (Python, solo dev)
```

## Licencia

Apache-2.0. Parte de la Suite Escriba.
