<div align="center">

<img src="public/logo.svg" width="76" alt="Trustux" />

# Trustux

**Cada firma, verificada. En tu máquina.**

Verificación de firma digital **100% local** para documentos firmados (PDF/PAdES). Subís un
balance, un dictamen o un escrito firmado y Trustux responde — sin que el documento salga de tu
equipo — si la firma es **íntegra** (¿se modificó después de firmar?), si el firmante es **quien
dice ser** (cadena hasta la AC Raíz Argentina, con extracción de CUIT/CUIL) y si el certificado
estaba **vigente** al firmar. Veredicto con semáforo 🟢🟡🔴 e informe exportable.

Parte de la familia [**Escriba**](https://github.com/diegoparras/escriba). Nace como el
verificador de firma de [Selega](https://github.com/diegoparras/selega) —cierra el lazo de la
legalización: *cifras que cierran **y** firma del matriculado verificada*— y crece a app standalone.

![Local](https://img.shields.io/badge/local-100%25-0E9AAB) ![Self-hosted](https://img.shields.io/badge/self--hosted-✓-0E9AAB) ![Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-0E9AAB)

> Estado: **Fase 1 — motor PAdES funcionando.** `firma-core` verifica integridad, identidad
> (CUIT) y cadena de confianza sobre PDFs firmados, con tests verdes contra los fixtures. Falta
> revocación online (gateada), XAdES/CAdES y la integración con Selega. Ver [`docs/SPEC.md`](docs/SPEC.md).

</div>

---

## Por qué

Los validadores de firma habituales son **online**: subís un documento legal sensible a un
tercero que *promete* no guardarlo. Trustux corre **en tu máquina** — el documento nunca sale,
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
trustux/
├── firma-core/           motor de verificación (JS puro, browser + Node)
│   ├── pades.js          extrae firmas del PDF (ByteRange + CMS)
│   ├── verify.js         integridad · identidad (CUIT) · cadena · veredicto
│   └── cli.js            verifica fixtures/ por consola
├── test/test-core.mjs    tabla de verdad como contrato (npm test)
├── docs/SPEC.md          spec técnica + alcance del MVP
├── fixtures/             PDFs firmados de ejemplo + trust/ (raíz de prueba)
│   └── README.md         tabla de verdad (veredicto esperado de cada PDF)
└── scripts/              generador y validador de fixtures (Python, solo dev)
```

## Probar el motor

```bash
npm install
npm run verificar      # verifica los PDFs de fixtures/ y muestra el veredicto
npm test               # corre la tabla de verdad (5/5)
```

## Licencia

Apache-2.0. Parte de la Suite Escriba.
