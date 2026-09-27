# three.js 0.170.0 — copia local

Tomado del paquete oficial `three@0.170.0` de npm. El tarball se verificó contra
la integridad que publica el registro antes de copiar nada:

    sha512-FQK+LEpYc0fBD+J8g6oSEyyNzjp+Q7Ks1C568WWaoMRLW+TkNNWmenWeGgJjV105Gd+p/2ql1ZcjYvNiPZBhuQ==

Por qué está aquí y no en unpkg: el sitio cargaba este código desde un CDN de
terceros sin ninguna verificación de integridad. Quien comprometiera ese CDN
podía ejecutar su propio JavaScript en la tienda —leer lo que el cliente teclea
en el checkout, cambiar el link de pago—, y una caída de unpkg dejaba el sitio
sin 3D. Servido desde el mismo dominio, ese vector desaparece y el CSP ya no
necesita confiar en ningún origen externo para ejecutar código.

Para actualizar: `npm pack three@<versión>`, verificar `dist.integrity` y copiar
exactamente estos archivos (misma estructura, porque GLTFLoader importa
`../utils/BufferGeometryUtils.js` de forma relativa). Licencia MIT en LICENSE.
