/* ═══════════════════════════════════════════════════════════════════════════
   VALQUIRIA — LA PIEZA MAESTRA
   ───────────────────────────────────────────────────────────────────────────
   La figura del hub deja de ser una función de distancia y pasa a ser una malla
   esculpida. Es la única forma de que el personaje tenga cara, dedos y pliegues:
   elipsoides fundidos con smin no dan para eso, por muchos que se apilen.

   Lo que NO cambia es la coreografía, y ese es el punto entero de este módulo:
   la nube de puntos de la impresión se muestrea DE LA PROPIA MALLA. Los puntos
   que el visitante ve caer son literalmente los de la superficie que queda
   después, así que cuando la resina cura no hay corte ni fundido entre dos
   cosas distintas: es el mismo objeto en dos estados.

   Si el archivo no está, o el navegador no puede con él, `cargarModelo` lanza y
   la escena sigue con la valquiria procedural. El sitio nunca depende de una
   descarga.

   Cómo generar el .glb: ver MODELO.md en la raíz.
   ═══════════════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import * as GeoUtils from 'three/addons/utils/BufferGeometryUtils.js';

/* Los generadores de imagen→3D suelen entregar el .glb comprimido con Draco.
   El decodificador es un wasm de ~200 kb que solo se descarga si el archivo
   viene comprimido, así que declararlo no cuesta nada cuando no hace falta. */
const draco = new DRACOLoader().setDecoderPath(
  'https://unpkg.com/three@0.170.0/examples/jsm/libs/draco/');

/* ═══════════════════════════════════════════════════════════════════════════
   ANIMACIÓN COMPARTIDA
   ───────────────────────────────────────────────────────────────────────────
   Una sola función GLSL para los dos renderizados: la nube de puntos y la
   malla. Vive aquí —y no en escena.js— solo para que el import vaya en una
   dirección; conceptualmente es del personaje, no de ninguno de los dos.

   Devuelve el giro acumulado y deja la posición deformada en `p`. El giro sale
   aparte porque hay que aplicárselo también a la normal: con la mirada llegando
   a ~35°, una normal sin girar ilumina la cara desde donde ya no está la luz.
   ═══════════════════════════════════════════════════════════════════════════ */
/* Las declaraciones van aparte porque el shader de puntos ya declara estos
   uniformes por su cuenta, y repetirlos no compila. La malla, que parte del
   shader de three, sí los necesita. */
export const GLSL_IDLE_UNIFORMES = `
uniform float uTime, uIdle, uAwake;
uniform vec2 uMirar;
`;

export const GLSL_IDLE = `
float vqIdle(vec3 base, inout vec3 p){
  float yawT = 0.0;
  if(uIdle < 0.001 && uAwake < 0.001) return yawT;

  /* El tiempo se cuantiza a 10 fps: la pieza corre a 60 pero su animación no,
     y esa rigidez de figura articulada es deliberada. */
  float t  = floor(uTime*10.0)/10.0;
  float k  = max(uIdle, 0.0);
  float aw = clamp(uAwake, 0.0, 1.0);

  float h   = smoothstep(-1.05, 0.55, base.y);
  float lag = 1.0 - smoothstep(-0.22, 0.02, base.z);
  float ts  = t - lag*0.20;

  /* Máscara de rigidez: la lanza vive en |x| ≈ 0.24 y es un palo de metal
     apoyado en el suelo. Si la deja entrar la rotación del torso se dobla como
     un junco y se pierde el único apoyo estable de la pose. */
  float rigido = 1.0 - smoothstep(0.20, 0.27, abs(base.x));
  float kBody  = k * rigido;
  float awBody = aw * rigido;

  /* Respiración y balanceo. */
  yawT += (sin(ts*0.90)*0.026 + sin(ts*0.37)*0.011) * h * kBody;
  float q = (base.y-0.26)/0.20;
  float pecho = exp(-q*q);
  p.xz *= 1.0 + 0.019*sin(t*1.5)*pecho*kBody;
  p.y  += 0.009*sin(t*1.5)*h*kBody;

  /* Cambio de peso: la cadera se desplaza muy despacio de una pierna a la otra.
     Es diminuto y es lo que impide que se lea como un maniquí en un pedestal,
     aun cuando no haya nadie moviendo el ratón. */
  p.x += sin(t*0.23) * 0.012 * smoothstep(-0.60, 0.10, base.y) * kBody;

  /* ── NPC: sigue al visitante ─────────────────────────────────────────────
     uMirar llega ya suavizado. La cabeza gira entero, los hombros la acompañan
     a media fuerza y la cadera casi nada: es esa cadena la que hace que el giro
     parezca de un cuerpo y no de una pieza montada sobre un eje. */
  float cabeza = smoothstep(0.30, 0.62, base.y);
  float torsoM = smoothstep(-0.10, 0.42, base.y);
  yawT += uMirar.x * (0.30*torsoM + 0.34*cabeza) * kBody;

  /* Cabeceo alrededor de la base del cuello, no del origen: desde el origen la
     figura entera se inclinaría hacia adelante. */
  float pit = uMirar.y * 0.20 * smoothstep(0.44, 0.66, base.y) * kBody;
  float cp = cos(pit), sp = sin(pit);
  vec2 yz = vec2(p.y - 0.52, p.z);
  p.y = 0.52 + cp*yz.x - sp*yz.y;
  p.z = sp*yz.x + cp*yz.y;

  /* ── Despertar: un solo aliento al terminar de curar. ─────────────────── */
  if(awBody > 0.001){
    float torso  = smoothstep(-0.15, 0.55, base.y);
    float pechoA = exp(-((base.y-0.26)/0.22)*((base.y-0.26)/0.22));
    float awP = sin(awBody * 3.14159);
    float awC = awBody * awBody * (3.0 - 2.0 * awBody);
    p.xz *= 1.0 + 0.050 * awP * pechoA;
    p.y  += 0.026 * awP * torso;
    yawT += 0.16 * awC * cabeza;
  }
  return yawT;
}
`;

/* ═══════════════════════════════════════════════════════════════════════════
   CARGA
   ═══════════════════════════════════════════════════════════════════════════ */

/* Normaliza la malla al mismo marco que la figura procedural: altura exacta,
   centrada en X/Z y con los pies apoyados en la plataforma.

   Que la ALTURA coincida no es cosmético. Toda la animación está escrita con
   alturas del mundo —el pecho en y=0.26, el cuello en y=0.52— porque son
   legibles al leerlas. Si el modelo entrara a otra escala, la valquiria
   respiraría por las rodillas. */
function encajar(raiz, bb) {
  const alto = bb.y1 - bb.y0;
  const caja = new THREE.Box3().setFromObject(raiz);
  const medida = new THREE.Vector3(); caja.getSize(medida);
  if (!(medida.y > 1e-6)) throw new Error('el modelo no tiene altura');

  const grupo = new THREE.Group();
  grupo.add(raiz);
  grupo.scale.setScalar(alto / medida.y);
  grupo.updateMatrixWorld(true);

  const ya = new THREE.Box3().setFromObject(grupo);
  const centro = new THREE.Vector3(); ya.getCenter(centro);
  raiz.position.x -= centro.x / grupo.scale.x;
  raiz.position.z -= centro.z / grupo.scale.z;
  raiz.position.y -= (ya.min.y - bb.y0) / grupo.scale.y;
  grupo.updateMatrixWorld(true);

  const fin = new THREE.Box3().setFromObject(grupo);
  return {
    grupo,
    bb: { x0: fin.min.x, x1: fin.max.x, y0: fin.min.y, y1: fin.max.y,
          z0: fin.min.z, z1: fin.max.z }
  };
}

/* Une todas las mallas en una sola geometría en coordenadas de mundo, para
   poder muestrear la superficie completa con un único repartidor por área.
   Se descarta todo menos posición y normal: los puntos son resina fresca —sin
   pigmento todavía— y el color aparece cuando cura, que es justo cuando toma
   el relevo la malla con sus texturas. */
function fusionar(grupo) {
  const geos = [];
  grupo.updateWorldMatrix(true, true);
  grupo.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.getAttribute('position')) return;
    const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    if (!src.getAttribute('normal')) src.computeVertexNormals();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', src.getAttribute('position').clone());
    g.setAttribute('normal', src.getAttribute('normal').clone());
    g.applyMatrix4(o.matrixWorld);
    geos.push(g);
  });
  if (!geos.length) throw new Error('el .glb no trae mallas');
  return geos.length === 1 ? geos[0] : GeoUtils.mergeGeometries(geos, false);
}

/* Puntos en el formato que ya espera la escena: posición (3) + normal (3) +
   material (1). El material va en 0 porque la pieza curada ya no se pinta con
   splats — la dibuja la malla con sus propios materiales PBR. */
function muestrearSuperficie(grupo, cuantos) {
  const fusion = fusionar(grupo);
  const rep = new MeshSurfaceSampler(new THREE.Mesh(fusion)).build();
  const out = new Float32Array(cuantos * 7);
  const pos = new THREE.Vector3(), nor = new THREE.Vector3();
  for (let i = 0; i < cuantos; i++) {
    rep.sample(pos, nor);
    const j = i * 7;
    out[j] = pos.x; out[j + 1] = pos.y; out[j + 2] = pos.z;
    out[j + 3] = nor.x; out[j + 4] = nor.y; out[j + 5] = nor.z;
  }
  fusion.dispose();
  return out;
}

/**
 * Carga la pieza maestra y la deja lista para entrar en la coreografía.
 *
 * @param {object} o
 * @param {string} o.url        ruta del .glb
 * @param {object} o.bb         marco de la figura procedural al que encajarla
 * @param {number} o.puntos     cuántos puntos muestrear de su superficie
 * @param {THREE.Plane} o.corte plano de recorte a la altura del cabezal
 * @param {function} [o.alAvanzar] progreso 0..1 de la descarga
 * @returns {Promise<{grupo, bb, puntos, materiales}>}
 */
export function cargarModelo({ url, bb, puntos, corte, alAvanzar }) {
  return new Promise((cumplir, fallar) => {
    new GLTFLoader().setDRACOLoader(draco).load(
      url,
      gltf => {
        try {
          const { grupo, bb: caja } = encajar(gltf.scene, bb);
          const materiales = [];

          grupo.traverse(o => {
            if (!o.isMesh) return;
            o.castShadow = true;
            o.receiveShadow = true;
            /* La geometría normalizada deja de coincidir con el bounding
               sphere que traía el archivo; sin recalcularlo el frustum culling
               puede borrar la pieza entera a ciertos ángulos. */
            o.geometry.computeBoundingSphere();
            for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
              if (!m || materiales.includes(m)) continue;
              /* Doble cara: durante la impresión la pieza está recortada y se
                 ve la sección abierta. Con una sola cara ahí no habría nada
                 que dibujar y la valquiria parecería hueca por dentro. */
              m.side = THREE.DoubleSide;
              m.clippingPlanes = [corte];
              m.clipShadows = true;
              /* Reflejo del entorno por DEBAJO de 1. La malla de Tripo trae su
                 propia textura de color —marfil cálido, como la referencia— y
                 con el entorno a 1.15 los reflejos del plató la tapaban: la
                 armadura se leía cromada, plata fría, y el color pintado no
                 llegaba a verse. Bajarlo devuelve el mando al albedo y deja el
                 entorno donde debe estar, dando forma en los cantos y no
                 pintando la pieza. */
              m.envMapIntensity = 0.62;
              materiales.push(m);
            }
          });

          cumplir({
            grupo,
            bb: caja,
            puntos: muestrearSuperficie(grupo, puntos),
            materiales
          });
        } catch (e) { fallar(e); }
      },
      ev => { if (alAvanzar && ev.total) alAvanzar(Math.min(1, ev.loaded / ev.total)); },
      err => fallar(err)
    );
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   LA CYBORG — modo 4
   ───────────────────────────────────────────────────────────────────────────
   El eco exacto de la rama `uModo > 3.5` del shader de puntos de escena.js.
   Tiene que ser exacto, no parecido: durante el curado la nube y la malla se
   ven a la vez, y si una levita medio ciclo por delante de la otra el efecto
   —que son el mismo objeto en dos estados— se rompe delante del visitante.

   La órbita gira mucho más rápido que el cuerpo, y no hace falta marcar qué
   vértice es órbita: basta con que la velocidad dependa del radio.
   ═══════════════════════════════════════════════════════════════════════════ */
const GLSL_ORBITA = `
float vqOrbita(vec3 base, inout vec3 p){
  float k = max(uIdle, 0.0);
  if(k < 0.001) return 0.0;
  float t = uTime;
  float rad = length(base.xz);
  float orb = smoothstep(0.30, 0.38, rad);
  float yawT = t*(0.10 + orb*0.62)*k;
  float c = cos(yawT), s = sin(yawT);
  p.xz = vec2(c*p.x + s*p.z, -s*p.x + c*p.z);
  p.y += sin(t*0.85)*0.020*k*(1.0-orb*0.6);
  float dn = distance(base, vec3(0.0, 0.232, 0.094));
  float nuc = 1.0 - smoothstep(0.0, 0.085, dn);
  p.z += nuc*0.014*sin(t*2.6)*k;
  return yawT;
}
`;

/* Qué animación le toca a cada modo. Devuelve null para las piezas quietas
   (modo 3); el grupo compartido conserva su giro lento y la respuesta al
   puntero, así que los modelos de taller siguen vivos sin deformar su diseño. */
function animacionDe(modo) {
  if (modo === 0) return { glsl: GLSL_IDLE, fn: 'vqIdle', clave: 'vq-idle' };
  if (modo === 4) return { glsl: GLSL_ORBITA, fn: 'vqOrbita', clave: 'vq-orbita' };
  return null;
}

/* Mete la animación de la pieza en los materiales PBR del .glb.
   `onBeforeCompile` es el único punto donde se puede tocar el shader de un
   MeshStandardMaterial sin renunciar a todo lo que trae —sombras, entorno,
   normal maps— y reescribirlo a mano.

   El giro se calcula DOS veces a propósito. three transforma la normal en
   `beginnormal_vertex`, que corre antes de `begin_vertex`, así que no hay un
   sitio donde calcularlo una vez y que llegue a los dos; recalcular una función
   de una docena de operaciones sale más barato que cualquier apaño. */
export function animarMallas(materiales, uniformes, modo) {
  const anim = animacionDe(modo);
  if (!anim) return;

  for (const m of materiales) {
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniformes);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
${GLSL_IDLE_UNIFORMES}
${anim.glsl}
float vqYaw = 0.0;`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{
  vec3 tmp = position;
  vqYaw = ${anim.fn}(position, tmp);
  float c = cos(vqYaw), s = sin(vqYaw);
  objectNormal.xz = vec2(c*objectNormal.x + s*objectNormal.z,
                        -s*objectNormal.x + c*objectNormal.z);
}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  ${anim.fn}(position, transformed);
  float c = cos(vqYaw), s = sin(vqYaw);
  transformed.xz = vec2(c*transformed.x + s*transformed.z,
                       -s*transformed.x + c*transformed.z);
}`);
    };
    /* Sin esto three reutiliza el programa compilado de un material idéntico
       sin la inyección, y la mitad de la pieza se queda quieta. La clave
       depende del modo: dos piezas con animaciones distintas no pueden
       compartir programa. */
    m.customProgramCacheKey = () => anim.clave;
    m.needsUpdate = true;
  }
}
