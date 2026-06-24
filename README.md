<div align="center">

<img src="public/logo.svg" width="76" alt="Trustux" />

# Trustux

**Cada firma, verificada. En tu máquina.**

Verificación de firma digital **100% local** para documentos firmados (PDF/PAdES). Subís un
balance, un dictamen o un escrito firmado y Trustux responde — sin que el documento salga de tu
equipo — si la firma es **íntegra** (¿se modificó después de firmar?), si el firmante es **quien
dice ser** (cadena hasta la AC Raíz Argentina, con extracción de CUIT/CUIL) y si el certificado
estaba **vigente** al firmar. Veredicto con semáforo e informe exportable.

Parte de la familia [**Escriba**](https://github.com/diegoparras/escriba). Nace como el
verificador de firma de [Selega](https://github.com/diegoparras/selega) —cierra el lazo de la
legalización: *cifras que cierran **y** firma del matriculado verificada*— y crece a app standalone.

![Local](https://img.shields.io/badge/local-100%25-0E9AAB) ![Self-hosted](https://img.shields.io/badge/self--hosted-ok-0E9AAB) ![Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-0E9AAB)

> Estado: **motor PAdES + XAdES funcionando.** `firma-core` verifica integridad, identidad
> (CUIT), cadena de confianza y revocación por CRL (offline) sobre PDFs (PAdES) y XML (XAdES,
> facturas AFIP), con tests verdes. Integrado en Selega (gateado por el superadmin). Falta la
> revocación online (proxy gateado) y CAdES. Ver [`docs/SPEC.md`](docs/SPEC.md).

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
- **Vigencia** — revocación por CRL (*offline-first*, embebida o del trust store) y sello de tiempo (RFC 3161). OCSP online pendiente.
- **Estándares** — PAdES (PDF) y XAdES (XML, facturas AFIP/ARCA) funcionando; CAdES (`.p7s`) pendiente.

## Integración con Selega

Entra como una **capacidad opcional, apagada por defecto**: solo el superadmin la prende
(`cap_firma`). Con la firma encendida, el veredicto alimenta el desenlace de Selega
(legaliza / observa / **certifica firma** / deniega). Con la firma apagada, Selega funciona
exactamente como hoy. Detalle en [`docs/SPEC.md`](docs/SPEC.md).

## Fixtures de prueba

El repo trae fixtures de ejemplo con su [tabla de verdad](fixtures/README.md):

- **PDFs (PAdES)** en [`fixtures/`](fixtures/): íntegro, alterado, doble firma, con sello de
  tiempo, SHA-1 y revocado.
- **Facturas XML (XAdES)** en [`fixtures/xades/`](fixtures/xades/): firmada y alterada.

Regenerables con:

```bash
pip install -r scripts/requirements.txt
python scripts/gen_fixtures.py     # PDFs PAdES + raíz de confianza + CRL de prueba
python scripts/verify_check.py     # valida los PDFs con pyHanko (verificador de referencia)
npm install
node scripts/gen_xades.mjs         # facturas XML firmadas (XAdES) + su raíz de prueba
```

## Estructura

```
trustux/
├── firma-core/           motor de verificación (JS puro, browser + Node)
│   ├── pades.js          extrae firmas del PDF (ByteRange + CMS)
│   ├── verify.js         PAdES: integridad · identidad (CUIT) · cadena · revocación · veredicto
│   ├── xades.js          XAdES: firmas XML (facturas AFIP), reusa identidad y cadena
│   └── cli.js            verifica fixtures/ por consola
├── test/
│   ├── test-core.mjs     tabla de verdad PAdES (npm test)
│   └── test-xades.mjs    tabla de verdad XAdES
├── docs/SPEC.md          spec técnica + alcance
├── fixtures/             PDFs firmados + trust/ (raíz + CRL de prueba)
│   ├── xades/            facturas XML firmadas + su raíz de prueba
│   └── README.md         tabla de verdad (veredicto esperado de cada caso)
└── scripts/              generadores de fixtures (Python para PAdES, Node para XAdES)
```

## Probar el motor

```bash
npm install
npm run verificar      # verifica los PDFs de fixtures/ y muestra el veredicto
npm test               # tabla de verdad: PAdES (8/8) + XAdES (3/3)
```

## Licencia

Apache-2.0. Parte de la Suite Escriba.
