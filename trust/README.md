# Trust store — raíces de confianza del standalone

Soltá acá los certificados raíz (`.pem`/`.crt`/`.cer`) y las listas de revocación (`.crl`) que
la verificación debe considerar **confiables**, y reiniciá Trustux. Una firma cuya cadena llegue
a alguna de estas raíces da válida; si es íntegra pero no llega a ninguna, da observada.

En producción cargá la **AC Raíz de la República Argentina** (IFDRA), las ACs licenciadas / del
Consejo y la AC del token de los matriculados.

> Los archivos `test-root-ca.pem`, `test.crl` y `xades-root-ca.pem` son **de prueba** (self-signed,
> sin valor legal): sirven para verificar los fixtures de ejemplo. **Borralos en producción.**
