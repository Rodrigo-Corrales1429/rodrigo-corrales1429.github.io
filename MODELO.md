# La valquiria maestra

**Estado: hecha.** `assets/valquiria.glb` existe, `USAR_MODELO` está en `true`
en `assets/js/escena.js`, y la valquiria del hub es esa malla esculpida.

Este documento explica cómo se llegó ahí, porque el día que quieras
reemplazarla —una pose nueva, otra armadura, la lanza que le falta— vas a
tener que repetir exactamente los mismos pasos.

---

## Lo que hay ahora

Generada con **Tripo** (tripo3d.ai) a partir de `assets/valquiria_cgi.jpg`.
El archivo que entregó Tripo era inservible para web tal cual:

| | Tripo | En el sitio |
|---|---|---|
| Peso | 59 MB | **1.9 MB** |
| Triángulos | 1 986 042 | **178 736** |
| Geometría | sin comprimir | Draco |
| Texturas | 3 JPEG, sin límite | 3 JPEG a 2048 |

59 MB no es «pesado»: es inviable. Serían más de un minuto de espera en una
conexión móvil normal, y GitHub avisa a partir de 50 MB por archivo. Los dos
millones de triángulos tampoco aportaban nada — a la escala a la que se ve la
figura en pantalla, por encima de ~200 k no se distingue un solo detalle más y
en un teléfono empieza a costar cuadros.

## Cómo se optimizó

Con `gltf-transform`, en este orden y por estas razones:

1. **`weld()` primero.** Tripo entrega la malla sin soldar: vértices duplicados
   en cada costura. Sin soldar, el simplificador no puede colapsar aristas a
   través de ellas y no baja del 60 % por más que se le insista.
2. **`simplify({ ratio: 0.09, error: 0.001 })`** con MeshoptSimplifier.
3. **`dedup()` y `prune()`** para tirar lo que quedó huérfano.
4. **`textureCompress({ resize: [2048, 2048], quality: 88 })`**. Las texturas
   eran lo de menos en peso (4 MB de 59), pero 2048 es donde la cara deja de
   ganar detalle visible.
5. **`draco({ quantizePositionBits: 14 })`** al final. Es lo que convierte
   megabytes de posiciones y normales en cientos de kilobytes.

El script completo está en el historial de la sesión; reproducirlo son cinco
líneas con `@gltf-transform/functions`, `meshoptimizer` y `draco3dgltf`.

## Si sustituyes el modelo — la lista que importa

- **De pie, cabeza hacia +Y, de frente a +Z.** El sitio normaliza escala,
  centrado y apoyo solo; la rotación no.
- **Por debajo de 8 MB** y entre 80 k y 250 k triángulos.
- **Comprueba el encuadre.** `ENCAJE_MALLA` y `ALZA_MALLA` en `escena.js`
  están calibrados para una figura **sin lanza**: la malla actual es cuerpo de
  arriba abajo, mientras que la figura procedural reservaba el tercio superior
  del marco para el asta. Si el modelo nuevo sí trae lanza, sube `ENCAJE_MALLA`
  hacia 1.0 o saldrá pequeño.
- **Si dejas de usar Draco**, quita `'wasm-unsafe-eval'` de la CSP en
  `index.html`. Si lo mantienes, no lo toques: sin ese permiso el navegador se
  niega a compilar el decodificador y la malla nunca carga.
- **Nunca quites `blob:` de `connect-src`.** GLTFLoader extrae las texturas
  del `.glb` como URLs `blob:`; sin ese permiso la malla carga **gris**.
- **El `preload` del `.glb` en `index.html` lleva `crossorigin`.** No es
  decorativo: sin ese atributo el modo de credenciales no casa con el de
  three, el preload se descarta y el archivo se descarga **dos veces**. Chrome
  lo avisa en consola; si tocas esa línea, comprueba que el aviso no vuelve.

## Qué hace el sitio con ella

1. **Muestrea puntos de su propia superficie.** Los puntos que caen durante la
   impresión salen de la malla real, así que cuando la resina cura y aparece el
   modelo no hay salto: es el mismo objeto en dos estados.
2. **La recorta a la altura del cabezal** con un plano de three, no con un
   descarte a mano — así el recorte también vale en el mapa de sombras y la
   pieza a medias proyecta la sombra de lo que lleva impreso.
3. **La ilumina como un plató**: clave con sombra proyectada, relleno frío,
   contraluz y un entorno cocinado en el navegador para los reflejos.
4. **La mueve como NPC**: respira, cambia el peso de pierna y te sigue con la
   mirada.

## La red de seguridad

Si el `.glb` no llega —conexión mala, WebGL sin memoria, un navegador sin
WebAssembly— la escena vuelve sola a la **valquiria procedural** de
`figuras.js`: la misma coreografía, dibujada con puntos. El visitante ve un
sitio completo, no un hueco. Esa caída está probada, no es teórica.
