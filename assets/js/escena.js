/* ═══════════════════════════════════════════════════════════════════════════
   VALQUIRIA — LA PLATAFORMA DE IMPRESIÓN
   ───────────────────────────────────────────────────────────────────────────
   Un solo canvas para todo el sitio. Al cambiar de sección la pieza no se
   reemplaza de golpe: se retrae y la siguiente se imprime capa por capa.

   API pública (window.VQ.escena):
     init()                      arranca WebGL y el bucle
     mostrar(id, tope, lado)     pide una figura; tope 0..1 es hasta dónde
                                 llega su impresión (una división en obra se
                                 queda a medias, y eso es el mensaje)
     atenuar(v)                  0 apaga la plataforma, 1 la enciende
     alProgresar(cb)             cb({p, fase, figura}) en cada cuadro
     precargar(ids)              muestrea en segundo plano, sin robar cuadros
   ═══════════════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { FIGURAS } from './figuras.js?v=72';
import { cargarModelo, animarMallas, GLSL_IDLE } from './modelo.js?v=72';

/* ── Las piezas esculpidas ─────────────────────────────────────────────────
   Cualquier figura puede declarar un `glb` en figuras.js y dejar de ser una
   SDF para pasar a ser una malla esculpida. La SDF NO se borra: sigue viva
   como red de seguridad, y si el archivo no llega —conexión mala, WebGL sin
   memoria, un 404 porque todavía no lo has subido— la escena cae sola a la
   figura procedural y el visitante ve un sitio completo, no un hueco. Esa
   caída está probada, no es teórica.

   Hay dos ritmos de carga, y la diferencia importa:

   · La primera figura se descarga al pedir `primeraFigura`: en la home será la
     valquiria y en una página limpia Dental será el molar. Su descarga llena
     el preloader de esa experiencia.
   · Las demás se piden la PRIMERA VEZ que se navega a su sección. Nadie paga
     el peso de una pieza que esa página no va a mostrar.

   Si declaras un `glb` que todavía no existe, el costo es un 404 la primera
   vez que se visita esa sección y nada más: la figura sale procedural y el
   fallo queda registrado para no reintentarlo. Por eso puedes declarar el
   archivo ANTES de subirlo — el día que lo dejes en assets/ funciona sin
   tocar una línea de código.

   El interruptor global de abajo apaga TODAS las mallas de golpe. Es para
   depurar o para un incidente, no para el uso diario.

   La valquiria actual salió de Tripo y pasó por gltf-transform: de 59 MB y
   1.99 M triángulos a 1.9 MB y 179 k, con Draco sobre la geometría y las
   texturas PBR a 2048. Ver MODELO.md — ahí está la receta completa y la lista
   de requisitos que debe cumplir cualquier pieza nueva. */
const USAR_MODELO = true;
const FIGURA_HUB = 'valquiria';

/* Los uniformes de la animación viven fuera de init() porque la malla puede
   terminar de descargarse antes de que exista el canvas, y necesita
   engancharse a los MISMOS objetos que después actualiza el bucle. Compartir
   la referencia es lo que mantiene a la nube y a la pieza moviéndose como una
   sola cosa. */
const uAnim = {
  uTime:  { value: 0 },
  uIdle:  { value: 0 },
  uAwake: { value: 0 },
  uMirar: { value: new THREE.Vector2(0, 0) }
};
const uniformesAnimacion = () => uAnim;

/* Las piezas esculpidas que YA llegaron, por figura. Vacío es un estado
   válido y frecuente: toda la escena está escrita para funcionar igual con
   malla y sin ella.

   Se declara aquí arriba y no junto al resto del estado porque la descarga
   del hub arranca durante la evaluación del módulo y `corte` tiene que existir
   ya: una const declarada más abajo estaría en zona muerta y reventaría el
   arranque. */
const mallas = new Map();     // id → { grupo, bb, puntos, materiales }
const descargas = new Map();  // id → Promise<boolean>, una por figura y sesión
const enVuelo = new Set();    // ids cuya descarga sigue abierta
let sombraSuelo = null, luzClave = null;

/* Plano de recorte a la altura del cabezal. Recorta la malla, no los puntos:
   los puntos ya se ocultan solos con uBuild. */
const corte = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

const REDUCIDO = matchMedia('(prefers-reduced-motion: reduce)').matches;
/* 1040 px, no 900: es el ancho al que el CSS apila el texto DEBAJO de la
   figura. Los dos umbrales tienen que ser el mismo número — si el CSS apila y
   el encuadre sigue creyéndose de escritorio, la pieza se queda centrada
   encima del titular. Entre 900 y 1040 las dos columnas quedan tan estrechas
   que la valquiria se comía la última línea del párrafo. */
const ANCHO_APILADO = 1040;
const esMovil = () => matchMedia('(max-width: ' + ANCHO_APILADO + 'px)').matches;
const MOVIL = esMovil();

/* Muestreo: en móvil la rejilla es más gruesa. Es la única palanca que
   realmente mueve el tiempo de arranque. */
const PASO_BASE = MOVIL ? 0.0270 : 0.0200;
const ALTURA_CAPA = 0.010;

const cache = new Map();

/* Una figura puede pedir su propia rejilla, y pedirla distinta en móvil: la
   valquiria se muestrea más fino que el resto porque es la que el visitante
   mira de cerca y la única que acaba siendo superficie. */
const pasoDe = F => (MOVIL ? (F.pasoMovil || PASO_BASE) : (F.paso || PASO_BASE));

/* ── Muestreador incremental ───────────────────────────────────────────────
   Devuelve una función que avanza por losas de Y y se detiene al agotar su
   presupuesto de milisegundos, para no bloquear el hilo principal.

   ── Por qué hay dos rejillas ──────────────────────────────────────────────
   La rejilla fina de la valquiria son ~3 millones de celdas, y de esas solo
   una fracción cae cerca de la superficie: el resto es aire, o relleno macizo
   dentro del cuerpo. Evaluarlas todas costaba más de un minuto de preloader,
   que es tiempo suficiente para que el visitante se vaya.

   La solución es la misma que usa cualquier trazador de SDF: preguntar
   primero en grueso. En el centro de cada bloque de BLOQUE³ celdas finas se
   evalúa la distancia UNA vez; si el punto más lejano del bloque sigue
   quedando fuera de la cáscara que nos interesa, el bloque entero se descarta
   sin tocar sus 512 celdas. Eso es lo que convierte un minuto en segundos.

   El margen no es decorativo. Descartar un bloque es correcto solo si la
   función nunca devuelve una distancia MAYOR que la real —si lo hiciera,
   podría jurar que está lejos de una superficie que tiene al lado, y ahí se
   abriría un agujero en la pieza—. Nuestras primitivas cumplen esa condición
   por separado (sdEll subestima, smin también), pero las intersecciones
   —Math.max, smax, que es como está construida la capa— sí sobreestiman. El
   margen compra la holgura que cubre ese error. Bajarlo acelera y arriesga
   agujeros; subirlo solo cuesta tiempo. */
const BLOQUE = 4;
const MARGEN_BLOQUE = 2.2;

function crearMuestreador(id) {
  const F = FIGURAS[id], bb = F.bb, fn = F.fn, mat = F.mat || null;
  const PASO = pasoDe(F);
  const CASCARA = PASO * 1.55;
  const NX = Math.ceil((bb.x1 - bb.x0) / PASO);
  const NY = Math.ceil((bb.y1 - bb.y0) / PASO);
  const NZ = Math.ceil((bb.z1 - bb.z0) / PASO);
  const out = [];

  /* Distancia del centro del bloque a su esquina más lejana. */
  const RADIO_BLOQUE = PASO * (BLOQUE - 1) * 0.8660254;
  const CORTE = MARGEN_BLOQUE * (RADIO_BLOQUE + CASCARA);
  const NLOSAS = Math.ceil(NY / BLOQUE);
  let losa = 0;

  /* Evalúa el bloque fino que arranca en (i0, j0, k0). */
  function bloqueFino(i0, j0, k0) {
    const iF = Math.min(i0 + BLOQUE, NX);
    const jF = Math.min(j0 + BLOQUE, NY);
    const kF = Math.min(k0 + BLOQUE, NZ);
    for (let j = j0; j < jF; j++) {
      const y = bb.y0 + j * PASO;
      for (let i = i0; i < iF; i++) {
        const x = bb.x0 + i * PASO;
        for (let k = k0; k < kF; k++) {
          const z = bb.z0 + k * PASO;
          const d = fn(x, y, z);
          if (d <= -CASCARA || d >= CASCARA) continue;
          /* Proyección a la superficie: tres pasos de Newton sobre el
             gradiente. Con SDFs aproximados es lo que endereza la nube.

             El gradiente del último paso ES la normal de la superficie, y
             sale gratis. Guardarla es lo que permite iluminar la pieza
             curada como una superficie de verdad en vez de como un montón
             de discos: sin ella, el pecho y el costado reciben la misma luz
             y la figura se ve plana por más sólida que esté. */
          let px = x, py = y, pz = z;
          let nx = 0, ny = 1, nz = 0;
          for (let it = 0; it < 3; it++) {
            const f = fn(px, py, pz), e = 0.0035;
            const gx = (fn(px + e, py, pz) - f) / e;
            const gy = (fn(px, py + e, pz) - f) / e;
            const gz = (fn(px, py, pz + e) - f) / e;
            const g = Math.hypot(gx, gy, gz) || 1;
            nx = gx / g; ny = gy / g; nz = gz / g;
            px -= f * nx; py -= f * ny; pz -= f * nz;
          }
          /* El material se pregunta en el punto YA proyectado, no en el de
             la rejilla: media celda de error basta para que el filo dorado
             de una placa caiga sobre el marfil de al lado. */
          out.push(px, py, pz, nx, ny, nz, mat ? mat(px, py, pz) : 0);
        }
      }
    }
  }

  return function paso(ms) {
    const t0 = performance.now();
    while (losa < NLOSAS && performance.now() - t0 < ms) {
      const j0 = losa * BLOQUE;
      const cy = bb.y0 + (j0 + (BLOQUE - 1) / 2) * PASO;
      for (let i0 = 0; i0 < NX; i0 += BLOQUE) {
        const cx = bb.x0 + (i0 + (BLOQUE - 1) / 2) * PASO;
        for (let k0 = 0; k0 < NZ; k0 += BLOQUE) {
          const cz = bb.z0 + (k0 + (BLOQUE - 1) / 2) * PASO;
          if (Math.abs(fn(cx, cy, cz)) > CORTE) continue;
          bloqueFino(i0, j0, k0);
        }
      }
      losa++;
    }
    if (losa >= NLOSAS) { cache.set(id, out); return 1; }
    return losa / NLOSAS;
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   LAS PIEZAS ESCULPIDAS
   ───────────────────────────────────────────────────────────────────────────
   Si una figura declara `glb`, su malla SUSTITUYE al muestreo de la SDF — los
   puntos que se imprimen salen de la superficie de esa misma malla, así que la
   nube que cae y la pieza que queda son el mismo objeto en dos estados. Si no
   llega, nadie se entera: la figura sale procedural y la única diferencia es
   que la pieza curada se dibuja con splats.
   ═══════════════════════════════════════════════════════════════════════════ */
let avanceModelo = 0;   // 0..1 de la descarga del hub; llena el preloader

/* Marco al que se encaja cada malla.
   ─────────────────────────────────────────────────────────────────────────
   Por defecto es el bounding box de su SDF, que es lo correcto cuando la
   malla representa lo mismo que la función.

   La valquiria es la excepción y la razón es concreta: en la figura procedural
   la lanza se llevaba el tercio superior y el regatón el pie del marco, así que
   el CUERPO ocupaba bastante menos que la caja. La malla de Tripo no trae lanza
   —es cuerpo de arriba abajo— y encajarla al marco completo la dejaba enorme,
   con la cabeza rozando la barra de navegación y los pies pisando la rejilla de
   divisiones. Por eso puede pedir `encaje` y `alza` en figuras.js.

   Después de cargar, FIGURAS[id].bb pasa a ser la caja real de la malla, y la
   plataforma y la sombra siguen a los pies solas. */
function marcoDe(id) {
  const F = FIGURAS[id], b = F.bb;
  const encaje = F.encaje == null ? 1 : F.encaje;
  const alza = F.alza == null ? 0 : F.alza;
  if (encaje === 1 && alza === 0) return b;
  const y0 = b.y0 + alza;
  return { ...b, y0, y1: y0 + (b.y1 - b.y0) * encaje };
}

/**
 * Pide la malla de una figura. Devuelve una promesa que resuelve a true si
 * llegó y a false si no la hay, no se pudo, o las mallas están apagadas.
 *
 * Es idempotente y se cachea POR SESIÓN: un .glb que no existe se intenta una
 * vez, se registra el fallo y no se vuelve a pedir. Eso es lo que permite
 * declarar el archivo antes de subirlo sin castigar al visitante con un 404
 * en cada navegación.
 */
function pedirMalla(id) {
  if (descargas.has(id)) return descargas.get(id);

  const F = FIGURAS[id];
  if (!USAR_MODELO || !F || !F.glb) {
    const nada = Promise.resolve(false);
    descargas.set(id, nada);
    return nada;
  }

  enVuelo.add(id);
  const p = cargarModelo({
    url: F.glb,
    bb: marcoDe(id),
    /* Estos puntos son la impresión, no la pieza: con que la nube se lea densa
       basta, y de más solo cuestan memoria. */
    puntos: MOVIL ? 60000 : 180000,
    corte,
    /* Solo la del hub mueve la barra del preloader; las demás llegan mientras
       el visitante ya está viendo su sección. */
    alAvanzar: id === FIGURA_HUB ? (v => { avanceModelo = v; }) : null
  }).then(m => {
    mallas.set(id, m);
    /* `holgura` estira el marco POR ENCIMA de la pieza, y solo sirve a las
       secciones cuyo `tope` es menor que 1.

       El corte del cabezal se mide contra esta caja: con `tope` 0.94 se
       imprime el 94 % de su altura. Cuando la caja es la de la malla —tan
       justa como la pieza— ese 6 % que falta se lo come la parte más alta,
       y en una figura humana la parte más alta es la CABEZA. La SDF no tenía
       el problema porque su tercio superior lo ocupaban los anillos de
       órbita, no el personaje: ahí el corte se llevaba aire.

       Con holgura 1.07 la caja crece un 7 % hacia arriba, así que el 94 % cae
       un pelo por encima de la coronilla: la figura sale entera y el cabezal
       se queda justo encima, pulsando. Que es exactamente lo que la sección
       quiere contar — esta división está EN BETA, la pieza aún se imprime—
       solo que dicho sin decapitar a nadie. */
    F.bb = F.holgura
      ? { ...m.bb, y1: m.bb.y0 + (m.bb.y1 - m.bb.y0) * F.holgura }
      : m.bb;
    F.malla = true;
    cache.set(id, m.puntos);
    animarMallas(m.materiales, uniformesAnimacion(), F.modo);
    adjuntarMalla(id);
    return true;
  }).catch(e => {
    console.info('[' + id + '] sin pieza esculpida (' + (e && e.message || e) +
                 '); se usa la figura procedural. Ver MODELO.md.');
    return false;
  }).finally(() => { enVuelo.delete(id); });

  descargas.set(id, p);
  return p;
}

/* Cuelga la malla del mismo grupo que la nube para que compartan encuadre,
   escala y giro. Es idempotente porque puede llamarla tanto la descarga como
   init(), y el orden entre las dos depende de la red. */
function adjuntarMalla(id) {
  const m = mallas.get(id);
  if (!m || !grupo || m.grupo.parent === grupo) return;
  grupo.add(m.grupo);
  m.grupo.visible = (figActual === id);
  if (figActual === id) montar(id);
  encuadrar();
}

/* La malla de la figura que se está viendo, si la hay. */
const mallaViva = () => mallas.get(figActual) || null;

/* Muestrea una figura repartida en cuadros y avisa del avance: es lo que llena
   la barra del preloader cuando la pieza es procedural.

   Si la pestaña está en segundo plano, requestAnimationFrame se detiene del
   todo, así que ahí se pasa a setTimeout. Pero setTimeout tampoco es libre:
   Chrome estrangula los temporizadores de una pestaña oculta a UNO POR
   SEGUNDO, sin importar el retardo que se le pida. Con el presupuesto de 60 ms
   que había antes, eso convertía ~2.5 s de CPU en más de cuarenta segundos de
   reloj — quien abría el sitio con cmd+clic en otra pestaña volvía y se
   encontraba el preloader casi intacto.

   La cuenta correcta es al revés: si el estrangulador solo va a concedernos un
   turno por segundo, ese turno tiene que traer trabajo suficiente. Bloquear el
   hilo medio segundo cuando nadie mira no cuesta nada —no hay cuadros que
   perder— y baja el muestreo completo a un puñado de turnos. */
const MS_VISIBLE = 18;
const MS_OCULTO = 500;

function muestrear(id, alAvanzar, alTerminar) {
  const m = crearMuestreador(id);
  (function paso() {
    const oculto = document.hidden;
    const p = m(oculto ? MS_OCULTO : MS_VISIBLE);
    alAvanzar(p);
    if (p >= 1) return alTerminar();
    if (oculto) setTimeout(paso, 0);
    else requestAnimationFrame(paso);
  })();
}

/* ── Cola de muestreo ─────────────────────────────────────────────────────
   Lo que hace falta ahora salta al frente de la fila. */
let cola = [], trabajo = null, trabajoId = null;

function bombear(ms) {
  if (!trabajo) {
    while (cola.length && cache.has(cola[0])) cola.shift();
    if (!cola.length) return;
    trabajoId = cola[0];
    trabajo = crearMuestreador(trabajoId);
  }
  if (trabajo(ms) === 1) { cola.shift(); trabajo = null; trabajoId = null; }
}

function pedir(id) {
  if (cache.has(id)) return true;
  /* Mientras se descarga la malla de una figura nadie muestrea su SDF: si las
     dos terminaran, la segunda pisaría a la primera y la figura podría quedarse
     con los puntos de una y el marco de la otra. */
  if (enVuelo.has(id)) return false;
  if (trabajoId !== id) {
    const i = cola.indexOf(id);
    if (i > 0) { cola.splice(i, 1); cola.unshift(id); }
    else if (i < 0) cola.unshift(id);
    if (trabajoId && trabajoId !== id) { trabajo = null; trabajoId = null; }
  }
  return false;
}

/* ── Shaders ─────────────────────────────────────────────────────────────── */
const VERT = `
attribute float aRand;
attribute float aMat;
attribute vec3 aNormal;
uniform float uBuild, uLayerH, uSize, uDpr, uSettle, uTime, uIdle, uModo;
uniform float uEsSolida, uSolido, uPaso, uPxUnidad, uEsSplat, uAwake;
uniform vec2 uMirar;
varying float vFresh, vA, vSolid;
varying vec3 vN, vAlb;
varying vec2 vMat;

/* La animación del personaje es la misma para la nube y para la malla, y vive
   en modelo.js. Aquí solo se inyecta: si se escribiera dos veces, el día que se
   afine la respiración una de las dos se quedaría atrás y durante el curado se
   vería a la pieza pelearse consigo misma. */
${GLSL_IDLE}

void main(){
  vec3 p = position;
  float yawT = 0.0;   /* giro acumulado del personaje: la normal lo sigue */
  float ly = floor(p.y/uLayerH)*uLayerH;
  float d = uBuild - ly;
  if(d < 0.0){ gl_Position = vec4(2.0,2.0,2.0,1.0); gl_PointSize = 0.0; vA = 0.0; vFresh = 0.0; vSolid = 0.0; vN = vec3(0.0,0.0,1.0); return; }
  float band = uLayerH*16.0;
  float fresh = 1.0 - smoothstep(0.0, band, d);
  vFresh = fresh;

  /* CURADO. Solo la valquiria (uEsSolida) deja de ser nube: detrás del cabezal
     la resina se cura y la capa pasa de puntos a superficie. uSolido remata el
     proceso al terminar la impresión — sin él, las últimas capas se quedarían
     en puntos para siempre, porque uBuild deja de subir y su distancia al
     cabezal nunca crece. */
  vSolid = uEsSolida * max(smoothstep(band*0.8, band*2.6, d), uSolido);

  /* El escalón de capa es del PROCESO, no de la pieza. Mientras la resina está
     fresca el punto se queda pegado a su plano de capa —se ve depositarse—, y
     conforme cura recupera su altura real sobre la superficie. Sin esto habría
     que elegir: o discos gordos que tapen el hueco entre capas y la figura
     sale de palomitas, o discos justos y sale rayada. Así el estriado existe
     donde tiene sentido y desaparece donde estorba. */
  p.y = mix(ly, position.y, vSolid);
  p.y -= fresh*uLayerH*2.4*uSettle;
  p.x += (aRand-0.5)*fresh*0.016*uSettle;
  p.z += (fract(aRand*13.17)-0.5)*fresh*0.016*uSettle;

  if(uIdle > 0.001 || uAwake > 0.001){
    /* El tiempo se cuantiza a 10 fps para las piezas físicas: la pieza corre
       a 60 fps pero su animación no, y esa rigidez es deliberada. La IA es la
       excepción — ella sí se mueve continuo. */
    float t = (uModo < 3.5) ? floor(uTime*10.0)/10.0 : uTime;
    float k = max(uIdle, 0.0);

    if(uModo < 0.5){                                   /* humanoide */
      /* Toda la coreografía del personaje —respiración, cambio de peso,
         seguimiento del visitante y despertar— está en vqIdle, compartida con
         la malla esculpida. */
      yawT = vqIdle(position, p);
      float c = cos(yawT), s = sin(yawT);
      p.xz = vec2(c*p.x + s*p.z, -s*p.x + c*p.z);

    } else if(uModo < 1.5){                            /* colgante */
      float h = 1.0 - smoothstep(-0.55, 1.0, position.y);
      p.x += sin(t*0.75)*0.055*h*k;
      p.z += cos(t*0.61)*0.032*h*k;

    } else if(uModo < 2.5){                            /* giro sobre su eje */
      float ang = t*0.30*k;
      float c = cos(ang), s = sin(ang);
      p.xy = vec2(c*p.x - s*p.y, s*p.x + c*p.y);

    } else if(uModo > 3.5){                            /* IA */
      /* La órbita gira mucho más rápido que el cuerpo. No hace falta marcar
         qué punto es órbita: basta con que la velocidad dependa del radio. */
      float rad = length(position.xz);
      float orb = smoothstep(0.30, 0.38, rad);
      float ang = t*(0.10 + orb*0.62)*k;
      float c = cos(ang), s = sin(ang);
      p.xz = vec2(c*p.x + s*p.z, -s*p.x + c*p.z);
      p.y += sin(t*0.85)*0.020*k*(1.0-orb*0.6);         /* levita */
      /* El núcleo del pecho late hacia afuera. */
      float dn = distance(position, vec3(0.0, 0.232, 0.094));
      float nuc = 1.0 - smoothstep(0.0, 0.085, dn);
      p.z += nuc*0.014*sin(t*2.6)*k;
      vFresh = max(vFresh, nuc*(0.55+0.45*sin(t*2.6))*k);
    }
  }

  /* La normal viaja al espacio de vista para iluminar. El giro del personaje
     sí se le aplica —con la mirada llegando a ~35° el error ya se vería como
     una cara iluminada por una luz que no está donde parece—; el resto de la
     deformación es de grados y no hace falta. */
  vec3 nrm = aNormal;
  float cyn = cos(yawT), syn = sin(yawT);
  nrm.xz = vec2(cyn*nrm.x + syn*nrm.z, -syn*nrm.x + cyn*nrm.z);
  vN = normalize(normalMatrix * nrm);

  /* Paleta del personaje. Se resuelve aquí, una vez por punto: dentro de un
     splat el material no cambia, y hacerlo por píxel sería pagar la cadena de
     comparaciones una vez por cada píxel del disco. */
  int m = int(aMat + 0.5);
  vec3 alb = vec3(0.930, 0.900, 0.840); vec2 esp = vec2(0.26, 40.0);  /* marfil */
  if(m == 1){ alb = vec3(0.840, 0.660, 0.270); esp = vec2(0.80, 76.0); }  /* oro */
  else if(m == 2){ alb = vec3(0.820, 0.648, 0.530); esp = vec2(0.09, 16.0); }  /* piel */
  else if(m == 3){ alb = vec3(0.115, 0.106, 0.098); esp = vec2(0.05, 10.0); }  /* capa */
  else if(m == 4){ alb = vec3(0.190, 0.172, 0.150); esp = vec2(0.30, 28.0); }  /* asta */
  vAlb = alb; vMat = esp;

  vec4 mv = modelViewMatrix*vec4(p,1.0);
  gl_Position = projectionMatrix*mv;

  float dist = max(0.4, -mv.z);
  float pxPunto = uSize*(1.0+fresh*1.5)*uDpr/dist;
  /* Tamaño del splat derivado de la geometría, no de una constante: una celda
     de la rejilla de muestreo mide uPaso en el mundo, y uPxUnidad la convierte
     a píxeles a esta distancia. Así los discos siempre alcanzan a tocarse y
     forman superficie, sea cual sea el zoom o el tamaño de la ventana. */
  /* En móvil el grupo entero se escala para encuadrar la pieza arriba; el
     splat tiene que encogerse con ella o los discos quedan enormes sobre una
     figura pequeña. length() de la primera columna da esa escala. */
  float escalaMundo = length(modelViewMatrix[0].xyz);
  /* El disco tiene que cubrir la MAYOR de las dos separaciones que hay entre
     puntos vecinos: uPaso en horizontal, pero uLayerH en vertical, porque el
     cuantizado a capas de más arriba junta varias filas de muestreo en un
     mismo plano. Dimensionarlo solo con uPaso deja una franja negra entre capa
     y capa, y la pieza curada sale rayada como una persiana. */
  /* El 1.8 no es gusto. Los puntos salen de una rejilla cúbica proyectada a la
     superficie, así que su separación depende de cómo esté orientada la cara:
     en una cara alineada con la rejilla vale uPaso, y en una diagonal llega a
     uPaso·√3. Un disco más corto que eso deja pecas negras justo en los
     hombros y el pecho, que es donde la cara gira. Pasarse tampoco es gratis:
     muy por encima, la cintura y los filos se hinchan. */
  float pxSplat = uPaso*escalaMundo*uPxUnidad/dist*1.58;
  gl_PointSize = (uEsSplat > 0.5) ? max(pxPunto, pxSplat) : pxPunto;

  /* El piso importa: es la opacidad de la pieza YA terminada, que es como el
     visitante la va a ver el 95% del tiempo. Demasiado bajo y la figura
     desaparece en cuanto deja de imprimirse. */
  vA = mix(0.55, 1.0, fresh);
}`;

/* Nube: los puntos del proceso. Se apagan a medida que la resina cura. */
const FRAG = `
precision mediump float;
uniform vec3 uIvory, uGold, uCure;
uniform float uOpacity;
varying float vFresh, vA, vSolid;
varying vec3 vN, vAlb;
varying vec2 vMat;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c,c);
  if(r > 0.25) discard;
  float a = 1.0 - smoothstep(0.02, 0.25, r);
  vec3 col = mix(uIvory, uGold, smoothstep(0.10, 0.60, vFresh));
  col = mix(col, uCure, smoothstep(0.72, 1.0, vFresh));
  gl_FragColor = vec4(col, a*vA*uOpacity*(1.0 - vSolid));
}`;

/* Resina curada. Cada punto se dibuja como un disco iluminado —point
   splatting—: con los discos solapados la nube deja de leerse como nube y pasa
   a leerse como una pieza sólida, sin triangular nada y sin salir del sistema
   de partículas que ya existe.

   La clave de que se lea SUPERFICIE y no un montón de canicas está en de dónde
   sale la normal. Si manda el casquete esférico del splat, cada punto se
   ilumina como una bola independiente y la pieza sale con grumos por más
   solapados que estén los discos. Manda la normal real de la SDF; el casquete
   solo entra un poco en el borde, para que el recorte del disco no sea duro.

   Iluminación de estudio, como la referencia: clave alta y frontal, relleno
   frío al lado contrario, contraluz dorado. El contraluz no es adorno — es lo
   único que despega una pieza casi blanca de un fondo casi negro. */
const FRAG_SOLIDO = `
precision mediump float;
uniform vec3 uGold;
uniform float uOpacity;
varying float vFresh, vA, vSolid;
varying vec3 vN, vAlb;
varying vec2 vMat;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c,c);
  if(r2 > 0.25) discard;

  float zc = sqrt(max(0.0, 0.25 - r2));
  vec3 ns = normalize(vec3(c.x, -c.y, zc));
  vec3 n  = normalize(mix(normalize(vN), ns, 0.09));

  vec3 V  = vec3(0.0, 0.0, 1.0);
  vec3 L1 = normalize(vec3(-0.42, 0.72, 0.56));   /* clave */
  vec3 L2 = normalize(vec3( 0.78, 0.10, 0.34));   /* relleno */
  vec3 L3 = normalize(vec3( 0.16, 0.34,-0.92));   /* contra */

  float dif1 = max(dot(n, L1), 0.0);
  float dif2 = max(dot(n, L2), 0.0);
  float dif3 = max(dot(n, L3), 0.0);

  /* Ambiente hemisférico: arriba el rebote cálido del plató, abajo el negro
     del vacío. Es lo que evita que las zonas en sombra se aplasten. */
  vec3 amb = mix(vec3(0.038,0.035,0.033), vec3(0.185,0.178,0.162), n.y*0.5+0.5);

  vec3 col = vAlb * (amb
           + vec3(1.00,0.968,0.905) * dif1 * 0.98
           + vec3(0.40,0.470,0.620) * dif2 * 0.26);

  vec3 H = normalize(L1 + V);
  col += vec3(1.0,0.985,0.940) * pow(max(dot(n,H),0.0), vMat.y) * vMat.x;

  /* El contraluz solo debe encender el CANTO. Con exponente bajo se cuela en
     cualquier punto cuya normal se desvíe un poco y la pieza sale salpicada
     de motas doradas en vez de perfilada. */
  float rim = pow(1.0 - max(dot(V,n),0.0), 4.5);
  col += uGold * rim * (0.14 + dif3 * 0.62);

  /* Disco OPACO, sin degradado en el borde. Con mezcla normal y escritura de
     profundidad, un anillo translúcido escribe profundidad con alfa parcial:
     el splat de detrás queda rechazado por el test de profundidad y por ese
     anillo se acaba viendo el fondo. El resultado es una pieza salpicada de
     sal y pimienta, y no se arregla haciendo los discos más grandes —cuanto
     mayores, más anillo—. El contorno lo resuelve el propio solape. */
  gl_FragColor = vec4(col, vSolid * uOpacity);
}`;

/* ── Estado de la escena ─────────────────────────────────────────────────── */
let renderer, scene, camera, grupo, nube, halo, solido, frente, plato, motas, uni, uniG, uniS;
let viewportCanvas = null, resizeObserver = null;
let solidoGoal = 0;
let awake = 0;          /* 0→1 al terminar de imprimir: el momento "cobra vida" */
let figActual = null;
let build = 0, target = 0, tope = 1, fase = 'espera';   // espera|imprime|listo|retrae
let pendiente = null, topePendiente = 1;
let quieto = 0, mx = 0, my = 0, cx = 0, cy = 0;
/* Hacia dónde mira la pieza. Se persigue el puntero con un resorte lento: si
   la cabeza fuera pegada al ratón el efecto sería de marioneta; llegando tarde
   y frenando al final se lee como alguien que te está siguiendo con la vista.
   `atento` sube al mover el puntero y decae solo, para que al dejar el ratón
   quieto la figura vuelva despacio a su eje en vez de quedarse torcida. */
let mirarX = 0, mirarY = 0, atento = 0;
let dist = 5, distGoal = 5, lado = 0, ladoGoal = 0, ladoDeseado = 0;
let T = 0, visible = 1, visGoal = 1;
let vivo = false, suscriptores = [], primeraImpresion = true;

function texRadial(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(s => grd.addColorStop(s[0], s[1]));
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

/* La plataforma: círculos concéntricos y una corona de marcas, desvanecida
   hacia el borde. Da escala a la pieza sin competir con ella. */
function texPlato() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'); g.translate(256, 256);
  g.strokeStyle = 'rgba(201,168,76,0.55)'; g.lineWidth = 1;
  for (let r = 40; r <= 240; r += 40) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
  g.strokeStyle = 'rgba(201,168,76,0.35)';
  for (let i = 0; i < 72; i++) {
    const a = i * Math.PI / 36, L = i % 6 === 0;
    g.beginPath();
    g.moveTo(Math.cos(a) * (L ? 216 : 232), Math.sin(a) * (L ? 216 : 232));
    g.lineTo(Math.cos(a) * 246, Math.sin(a) * 246);
    g.stroke();
  }
  const f = g.createRadialGradient(0, 0, 90, 0, 0, 256);
  f.addColorStop(0, 'rgba(0,0,0,0)'); f.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = f; g.fillRect(-256, -256, 512, 512);
  return new THREE.CanvasTexture(c);
}

/* ═══════════════════════════════════════════════════════════════════════════
   EL PLATÓ
   ───────────────────────────────────────────────────────────────────────────
   Lo que hace que un render se lea caro casi nunca es el modelo: es de dónde
   viene la luz. Aquí se monta un estudio de tres puntos con entorno propio.

   El entorno se cocina en el navegador a partir de una habitación de cartón
   —tres planos emisivos— y no de un HDRI descargado. Un .hdr decente pesa 2-8
   MB y es una petición más que puede fallar; esta habitación pesa cero y da
   exactamente lo que hace falta: que el oro tenga algo que reflejar y que la
   armadura tenga un degradado en las zonas que ninguna luz directa toca.
   ═══════════════════════════════════════════════════════════════════════════ */
function habitacionDeEstudio() {
  const cuarto = new THREE.Scene();
  const caja = new THREE.BoxGeometry(1, 1, 1);
  caja.deleteAttribute('uv');
  const panel = (color, intensidad, x, y, z, sx, sy, sz) => {
    const m = new THREE.Mesh(caja, new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensidad),
      side: THREE.BackSide
    }));
    m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    cuarto.add(m);
  };
  /* Las paredes: un cubo oscuro que se traga la luz, para que el fondo del
     reflejo sea negro y los brillos se lean como brillos. */
  panel(0x14151a, 1, 0, 0, 0, 12, 12, 12);
  /* Softbox principal, arriba y al frente-izquierda. Casi blanco a propósito:
     con el softbox cálido la armadura de marfil se lee dorada y la pieza
     entera parece un trofeo en vez de resina pigmentada. El calor se reserva
     para el contraluz, donde sí construye. */
  panel(0xfff8f0, 7.0, -2.2, 3.4, 2.6, 3.2, 0.1, 3.2);
  /* Relleno frío, al lado contrario y más bajo. Bajó de 3.0 a 1.5 al entrar la
     malla texturizada: el azul del relleno es lo que empujaba el marfil de la
     armadura hacia el gris acero. Sigue estando —sin él la sombra del costado
     se cierra en negro— pero ya no compite con el color de la pieza. */
  panel(0x9fb6ff, 1.5, 3.2, 0.4, 1.6, 0.1, 2.6, 2.6);
  /* Contraluz cálido detrás: es el que dibuja el canto del yelmo. */
  panel(0xffe6c8, 2.0, 0.6, 1.6, -3.4, 3.0, 2.0, 0.1);
  return cuarto;
}

function montarPlato() {
  /* Entorno para reflejos y luz indirecta. */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const cuarto = habitacionDeEstudio();
  scene.environment = pmrem.fromScene(cuarto, 0.04).texture;
  cuarto.traverse(o => { if (o.isMesh) o.material.dispose(); });
  pmrem.dispose();

  /* Luz clave. Es la única que proyecta sombra: dos sombras cruzadas delatan
     el truco al instante y cuestan el doble. */
  luzClave = new THREE.DirectionalLight(0xfff8f2, 2.1);
  luzClave.position.set(-2.4, 4.2, 3.0);
  luzClave.castShadow = true;
  luzClave.shadow.mapSize.set(MOVIL ? 1024 : 4096, MOVIL ? 1024 : 4096);
  /* La cámara de sombra se ciñe a la pieza. Cuanto más apretada, más resolución
     efectiva por milímetro: una cámara holgada gasta el mapa en vacío y deja
     los bordes de la sombra dentados. */
  const c = luzClave.shadow.camera;
  c.left = -1.8; c.right = 1.8; c.top = 2.4; c.bottom = -1.8;
  c.near = 0.5; c.far = 12;
  luzClave.shadow.bias = -0.0012;
  luzClave.shadow.normalBias = 0.02;
  luzClave.shadow.radius = 3;
  scene.add(luzClave, luzClave.target);

  /* Relleno y contraluz sin sombra: solo modelan. */
  const relleno = new THREE.DirectionalLight(0xa8bcf0, 0.34);
  relleno.position.set(3.4, 0.8, 1.8);
  const contra = new THREE.DirectionalLight(0xffd9a8, 0.85);
  contra.position.set(0.8, 1.4, -3.2);
  scene.add(relleno, contra);

  /* Captador de sombra: un plano invisible que solo recibe. Da la sombra de
     contacto que pega la figura al suelo sin añadir un suelo visible que
     rompería el fondo negro de la página. */
  sombraSuelo = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.ShadowMaterial({ opacity: 0.55 })
  );
  sombraSuelo.rotation.x = -Math.PI / 2;
  sombraSuelo.receiveShadow = true;
  sombraSuelo.visible = false;          // solo con malla; la nube no da sombra
  grupo.add(sombraSuelo);
}

function dimensionesViewport() {
  if (!viewportCanvas) return { ancho: innerWidth, alto: innerHeight };
  const caja = viewportCanvas.getBoundingClientRect();
  return {
    ancho: Math.max(1, Math.round(caja.width || viewportCanvas.clientWidth || innerWidth)),
    alto: Math.max(1, Math.round(caja.height || viewportCanvas.clientHeight || innerHeight))
  };
}

function init() {
  if (renderer) return true;
  const canvas = document.getElementById('escena');
  if (!canvas) return false;
  viewportCanvas = canvas;

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      /* Con una malla esculpida el contorno pasa a ser lo primero que se mira,
         y un filo escalonado delata el trabajo casero antes que cualquier otra
         cosa. La nube de puntos no lo necesitaba; la pieza sí. */
      antialias: true, alpha: true, powerPreference: 'high-performance'
    });
  } catch (e) {
    console.warn('[valquiria] WebGL no disponible:', e);
    canvas.style.display = 'none';
    return false;
  }

  renderer.setClearColor(0x000000, 0);
  /* En escritorio el buffer nunca baja de 1.5x: en un monitor 1080p (dpr 1)
     eso es súper-muestreo puro y es la diferencia entre discos con dientes de
     sierra y una superficie pulida. La escena son point-splats — fragmentos
     baratos — así que el costo lo absorbe cualquier GPU de este siglo. */
  const dpr = MOVIL
    ? Math.min(devicePixelRatio || 1, 1.6)
    : Math.min(Math.max(devicePixelRatio || 1, 1.5), 2);
  renderer.setPixelRatio(dpr);
  const viewport = dimensionesViewport();
  /* `false` conserva las dimensiones CSS reservadas por el layout. En la
     aplicación histórica el canvas sigue midiendo toda la ventana; en una
     página limpia puede vivir dentro de una celda sin estirarse por debajo
     del contenido. */
  renderer.setSize(viewport.ancho, viewport.alto, false);

  /* Cadena de color de plató. Es la diferencia entre marfil y plástico:
     · el trabajo interno va en lineal y la salida se codifica a sRGB, así que
       las luces suman como suman en el mundo real;
     · ACES comprime los altos en vez de recortarlos, que es lo que salva el
       brillo del oro y la mejilla iluminada de quedar en blanco plano. */
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  /* Sombras suaves: la proyectada da peso a la figura y la de contacto la pega
     a la plataforma. Sin ellas la pieza flota, y flotar es de maqueta. */
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  /* El recorte a la altura del cabezal se hace con un plano de three, no con
     un discard a mano: así funciona también en el mapa de sombras y la pieza
     a medias proyecta la sombra de lo que lleva impreso, no de la figura
     entera. */
  renderer.localClippingEnabled = true;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, viewport.ancho / viewport.alto, 0.1, 60);
  grupo = new THREE.Group(); scene.add(grupo);

  uni = {
    uBuild: { value: -9 }, uLayerH: { value: ALTURA_CAPA },
    uSize: { value: MOVIL ? 2.1 : 2.3 }, uDpr: { value: dpr },
    uSettle: { value: 1 }, uOpacity: { value: 0.80 },
    uTime: uAnim.uTime, uIdle: uAnim.uIdle, uModo: { value: 0 },
    uEsSolida: { value: 0 }, uSolido: { value: 0 }, uAwake: uAnim.uAwake,
    uPaso: { value: PASO_BASE }, uPxUnidad: { value: 1000 }, uEsSplat: { value: 0 },
    uMirar: uAnim.uMirar,
    /* Estos colores se declaran en espacio LINEAL a propósito. La nube y los
       splats son shaders propios: escriben en el framebuffer sin pasar por la
       codificación de salida de three, así que si se declararan como sRGB —lo
       normal— llegarían ya linealizados al shader y se dibujarían apagados.
       Los materiales PBR de la malla sí usan la cadena completa. */
    uIvory: { value: new THREE.Color().setHex(0xF2EADA, THREE.LinearSRGBColorSpace) },
    uGold: { value: new THREE.Color().setHex(0xE8C55F, THREE.LinearSRGBColorSpace) },
    uCure: { value: new THREE.Color().setHex(0x8B6BFF, THREE.LinearSRGBColorSpace) }
  };
  uniG = THREE.UniformsUtils.clone(uni);
  ['uBuild', 'uSettle', 'uTime', 'uIdle', 'uModo', 'uMirar',
   'uEsSolida', 'uSolido', 'uAwake', 'uPaso', 'uPxUnidad'].forEach(k => { uniG[k] = uni[k]; });
  uniG.uSize.value = (MOVIL ? 2.1 : 2.3) * 4.2;
  uniG.uOpacity.value = 0.070;

  /* El sólido comparte todo el estado con la nube salvo su propio interruptor
     de splat y su opacidad. */
  uniS = THREE.UniformsUtils.clone(uni);
  Object.keys(uni).forEach(k => {
    if (k !== 'uEsSplat' && k !== 'uOpacity') uniS[k] = uni[k];
  });
  uniS.uEsSplat.value = 1;
  uniS.uOpacity.value = 1;

  const geo = new THREE.BufferGeometry();
  const base = {
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  };
  nube = new THREE.Points(geo, new THREE.ShaderMaterial(Object.assign({}, base, { uniforms: uni })));
  halo = new THREE.Points(geo, new THREE.ShaderMaterial(
    Object.assign({}, base, { uniforms: uniG, depthTest: false })));

  /* La pieza curada es lo único opaco de la escena: necesita mezcla normal y
     escribir profundidad, o los splats del fondo se verían a través del frente
     y la "pieza sólida" volvería a ser una nube luminosa. Se dibuja primero
     para que llene el buffer de profundidad antes de los aditivos. */
  solido = new THREE.Points(geo, new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG_SOLIDO, uniforms: uniS,
    transparent: true, depthWrite: true, depthTest: true,
    blending: THREE.NormalBlending
  }));
  solido.renderOrder = -1;
  nube.renderOrder = 1;
  halo.renderOrder = 2;
  grupo.add(solido, nube, halo);

  /* Frente de curado: el disco de luz que viaja con el cabezal. */
  frente = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 2.1),
    new THREE.MeshBasicMaterial({
      map: texRadial([[0, 'rgba(190,170,255,0.85)'], [0.35, 'rgba(201,168,76,0.42)'], [1, 'rgba(0,0,0,0)']]),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0
    })
  );
  frente.rotation.x = -Math.PI / 2; grupo.add(frente);

  plato = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 3.6),
    new THREE.MeshBasicMaterial({
      map: texPlato(), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0
    })
  );
  plato.rotation.x = -Math.PI / 2; grupo.add(plato);

  /* Polvo en suspensión. Barato y hace que el vacío no se vea muerto. */
  const M = MOVIL ? 240 : 500;
  const mp = new Float32Array(M * 3), mr = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    mp[i * 3] = (Math.random() - .5) * 4.4;
    mp[i * 3 + 1] = (Math.random() - .5) * 3.4;
    mp[i * 3 + 2] = (Math.random() - .5) * 2.4;
    mr[i] = Math.random();
  }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  mg.setAttribute('aRand', new THREE.BufferAttribute(mr, 1));
  motas = new THREE.Points(mg, new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDpr: { value: dpr } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aRand;uniform float uTime,uDpr;varying float vA;
      void main(){vec3 p=position;p.y=mod(p.y+uTime*(0.012+aRand*0.02)+1.7,3.4)-1.7;
      p.x+=sin(uTime*0.25+aRand*30.0)*0.05;vec4 mv=modelViewMatrix*vec4(p,1.0);
      gl_Position=projectionMatrix*mv;gl_PointSize=(0.7+aRand*1.5)*uDpr*(1.0/max(0.4,-mv.z));
      vA=0.10+aRand*0.16;}`,
    fragmentShader: `precision mediump float;varying float vA;void main(){vec2 c=gl_PointCoord-0.5;
      if(dot(c,c)>0.25)discard;gl_FragColor=vec4(0.79,0.66,0.30,vA);}`
  }));
  scene.add(motas);
  montarPlato();
  /* Si la malla llegó antes que el canvas, aquí es donde entra. */
  mallas.forEach((m, id) => adjuntarMalla(id));

  addEventListener('resize', alRedimensionar, { passive: true });
  addEventListener('pointermove', e => {
    const caja = viewportCanvas.getBoundingClientRect();
    if (!caja.width || !caja.height) return;
    mx = Math.max(-.5, Math.min(.5, (e.clientX - caja.left) / caja.width - .5));
    my = Math.max(-.5, Math.min(.5, (e.clientY - caja.top) / caja.height - .5));
    atento = 1;
  }, { passive: true });
  /* El canvas contenido puede cambiar aunque no cambie la ventana (por
     fuentes, grid o orientación). Observarlo evita deformación y no añade
     listeners por frame. */
  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(alRedimensionar);
    resizeObserver.observe(canvas);
  }

  medirEscala();
  vivo = true;
  requestAnimationFrame(bucle);
  return true;
}

function alRedimensionar() {
  if (!renderer) return;
  const viewport = dimensionesViewport();
  camera.aspect = viewport.ancho / viewport.alto;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.ancho, viewport.alto, false);
  medirEscala();
  encuadrar();
}

/* Píxeles de buffer que ocupa una unidad de mundo situada a distancia 1. Es lo
   que permite calcular el tamaño del splat en pixeles a partir del paso de
   muestreo, en vez de una constante que se rompe al cambiar de pantalla. */
function medirEscala() {
  if (!renderer || !uni) return;
  const alto = renderer.domElement.height;
  uni.uPxUnidad.value = alto / (2 * Math.tan(camera.fov * Math.PI / 360));
}

/* El encuadre depende del ancho. En escritorio la pieza se corre al lado
   contrario del texto. En móvil el texto pasa DEBAJO, así que la pieza tiene
   que caber entera en la banda superior — y eso no se resuelve con un offset
   fijo: cada figura tiene distinta altura, y una constante que funciona para
   la valquiria deja al molar montado sobre el titular.

   Aquí se despeja: dado que la semialtura visible es d·tan(fov/2), la escala
   que hace que la figura ocupe la fracción ALTO de la pantalla sale directa, y
   con ella la posición que la centra en CENTRO (medido desde arriba). */
const ALTO_MOVIL = 0.27;    // fracción de la pantalla que ocupa la pieza
const CENTRO_MOVIL = 0.23;  // dónde queda su centro, 0 = borde superior

function encuadrar() {
  if (!grupo || !camera) return;
  const m = esMovil();
  const contenido = viewportCanvas && viewportCanvas.dataset.sceneViewport === 'contained';
  const F = FIGURAS[figActual] || FIGURAS.valquiria;
  const alto = F.bb.y1 - F.bb.y0;
  const centro = (F.bb.y0 + F.bb.y1) / 2;

  if (m) {
    const semi = F.dist * Math.tan(camera.fov * Math.PI / 360);
    const altoMovil = contenido ? 0.72 : ALTO_MOVIL;
    const centroMovil = contenido ? 0.50 : CENTRO_MOVIL;
    const escala = 2 * altoMovil * semi / alto;
    grupo.scale.setScalar(escala);
    grupo.position.y = 0.10 + (1 - 2 * centroMovil) * semi - centro * escala;
    distGoal = F.dist;
    ladoGoal = 0;
  } else {
    grupo.scale.setScalar(1);
    grupo.position.y = 0.02;
    distGoal = F.dist;
    /* En anchos medios (900–1200) las dos columnas se estrechan y la pieza
       alcanza la última línea del texto. Se corre más hacia afuera conforme
       la ventana se angosta. */
    const holgura = Math.min(1, Math.max(0, (dimensionesViewport().ancho - ANCHO_APILADO) / 420));
    ladoGoal = ladoDeseado * (1.34 - holgura * 0.26);
  }
}

/* Monta en la geometría viva una figura ya muestreada. */
function montar(id) {
  const pts = cache.get(id);
  if (!pts || !renderer) return false;
  const F = FIGURAS[id];
  const N = pts.length / 7;              // posición (3) + normal (3) + material (1)
  /* En móvil se diezma la nube para no ahogar la GPU. La pieza que se cura es
     la excepción: ahí los puntos NO son decorado sino la superficie misma, y
     quitar uno de cada tres abre agujeros por los que se ve el fondo. Su
     presupuesto se controla con `pasoMovil`, no recortando aquí. */
  const conservar = MOVIL ? Math.min(N, F.solida ? 80000 : 26000) : N;
  const salto = N / conservar;
  const pos = new Float32Array(conservar * 3);
  const nor = new Float32Array(conservar * 3);
  const rnd = new Float32Array(conservar);
  const mtl = new Float32Array(conservar);
  for (let i = 0; i < conservar; i++) {
    const j = Math.floor(i * salto) * 7;
    pos[i * 3] = pts[j]; pos[i * 3 + 1] = pts[j + 1]; pos[i * 3 + 2] = pts[j + 2];
    nor[i * 3] = pts[j + 3]; nor[i * 3 + 1] = pts[j + 4]; nor[i * 3 + 2] = pts[j + 5];
    mtl[i] = pts[j + 6];
    rnd[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aNormal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
  geo.setAttribute('aMat', new THREE.BufferAttribute(mtl, 1));
  const viejo = nube.geometry;
  /* Los tres objetos comparten la MISMA geometría: nube, halo y pieza curada
     son tres lecturas de los mismos puntos. Olvidar uno lo deja dibujando la
     geometría vacía del arranque — y como la nube se apaga al curar, la
     figura simplemente desaparece. */
  nube.geometry = geo; halo.geometry = geo; solido.geometry = geo;
  if (viejo && viejo.attributes.position) viejo.dispose();
  figActual = id;
  uni.uModo.value = F.modo;
  /* «Cura» quien tiene algo debajo que enseñar: o una malla esculpida, o el
     permiso explícito de curarse con splats (`solida`). La condición NO puede
     ser solo la bandera: una figura que espera su .glb y todavía no lo tiene
     se quedaría apagando sus puntos para revelar una pieza que no existe, y
     desaparecería a la vista del visitante. */
  const curaAlTerminar = mallas.has(id) || !!F.solida;
  uni.uEsSolida.value = curaAlTerminar ? 1 : 0;
  uni.uPaso.value = pasoDe(F);
  /* Al montar una pieza nueva el curado arranca de cero: si se heredara el
     valor anterior, la siguiente figura aparecería ya sólida de golpe. */
  uni.uSolido.value = 0;
  solidoGoal = 0;
  awake = 0;
  if (uni.uAwake) uni.uAwake.value = 0;
  plato.position.y = F.bb.y0 - 0.015;

  /* Cuando la figura tiene malla, el sólido de splats se apaga: lo que queda
     detrás del cabezal es la malla recortada, no un montón de discos. Los
     puntos siguen exactamente igual —son los de su superficie— y se apagan al
     curar, dejándola ver.

     Se recorren TODAS las mallas y no solo la entrante: sin apagar la
     anterior, cambiar de sección dejaría dos piezas esculpidas encima de la
     misma plataforma. */
  const conMalla = mallas.has(id);
  mallas.forEach((m, k) => { m.grupo.visible = (k === id); });
  if (sombraSuelo) {
    sombraSuelo.visible = conMalla;
    sombraSuelo.position.y = F.bb.y0 - 0.004;
  }
  /* `F.solida` es la condición que faltaba, y su ausencia dejaba al molar
     —y a las otras cuatro piezas— casi invisibles.

     La pasada de sólido dibuja cada punto como un disco con `depthWrite`
     activado. En una figura que no cura, su alfa sale 0… pero un fragmento
     transparente ESCRIBE PROFUNDIDAD igual, porque el alfa no descarta nada.
     Y como esos discos se dimensionan con el paso de muestreo —que en las
     figuras de nube es el grueso, 0.02— cada uno tapaba un área varias veces
     mayor que el punto que representa. El resultado: una capa invisible de
     parasoles que rechazaba por profundidad casi toda la nube que venía
     detrás, y de la pieza solo sobrevivía un borde suelto.

     Se dibuja solo donde significa algo: la pieza que se cura en resina. */
  solido.visible = !conMalla && !!F.solida;

  encuadrar();
  return true;
}

/* ── Bucle ───────────────────────────────────────────────────────────────── */
let ultimo = performance.now();

function bucle(ahora) {
  requestAnimationFrame(bucle);
  const dt = Math.min(0.05, (ahora - ultimo) / 1000);
  ultimo = ahora; T += dt;
  if (!renderer || !vivo) return;

  /* Muestrear en segundo plano, pero nunca durante la impresión: ahí cada
     cuadro perdido se ve como un tirón en el cabezal. */
  if (fase !== 'imprime') bombear(4);

  if (fase === 'imprime') {
    /* La primera pieza se imprime con ceremonia: es el momento en que el
       visitante entiende qué está viendo. A partir de ahí, cambiar de sección
       tiene que sentirse instantáneo o el sitio se vuelve una sala de espera. */
    const base = primeraImpresion ? 0.20 : 0.46;
    const v = base + base * 0.6 * Math.sin(Math.min(1, target / tope) * Math.PI);
    target = Math.min(tope, target + dt * v);
    if (target >= tope - 0.0005) { fase = 'listo'; primeraImpresion = false; }
  } else if (fase === 'retrae') {
    target = Math.max(0, target - dt * 2.6);
    if (target <= 0.001) {
      if (pendiente && cache.has(pendiente)) {
        montar(pendiente);
        tope = topePendiente; pendiente = null;
        fase = 'imprime'; quieto = 0;
      } else if (pendiente) { pedir(pendiente); bombear(9); }
    }
  }

  build += (target - build) * Math.min(1, dt * 9);
  visible += (visGoal - visible) * Math.min(1, dt * 4);
  quieto += (((fase === 'listo') ? 1 : 0) - quieto) * Math.min(1, dt * 1.6);

  /* Curado final: al terminar de imprimir, las últimas capas también se
     solidifican. Se interpola despacio (~1.5 s) para que se lea como resina
     endureciéndose bajo luz UV y no como un cambio de material. */
  solidoGoal = (fase === 'listo') ? 1 : 0;
  uni.uSolido.value += (solidoGoal - uni.uSolido.value) * Math.min(1, dt * 0.75);

  /* Despertar (Toy Story): arranca cuando la pieza ya está casi sólida y
     dura ~1.7 s. Después se mantiene en 1 para no reiniciar el gesto. */
  if (fase === 'listo' && uni.uSolido.value > 0.55) {
    awake = Math.min(1, awake + dt * 0.58);   /* ~1.7 s */
  } else if (fase !== 'listo') {
    awake = 0;
  }
  if (uni.uAwake) uni.uAwake.value = awake;

  const F = FIGURAS[figActual] || FIGURAS.valquiria;
  const y = F.bb.y0 + build * (F.bb.y1 - F.bb.y0);
  const escalon = Math.floor(y / ALTURA_CAPA) * ALTURA_CAPA;
  uni.uBuild.value = build <= 0.0005 ? -9 : escalon;
  uni.uTime.value = T; uni.uIdle.value = quieto;

  /* El plano de recorte va en coordenadas de MUNDO, no del grupo: la pieza se
     escala y se desplaza al encuadrar, y con la constante en local la valquiria
     aparecería cortada por la cintura en móvil. Se convierte una vez por cuadro
     y sale gratis. */
  if (mallaViva()) {
    const alto = grupo.scale.y * (build <= 0.0005 ? -9 : escalon) + grupo.position.y;
    corte.constant = alto + 0.004;
    /* La luz clave persigue a la pieza para que la sombra caiga siempre bajo
       ella, no donde estaba el origen de la escena. */
    luzClave.target.position.set(grupo.position.x, grupo.position.y, 0);
    luzClave.target.updateMatrixWorld();
    luzClave.position.set(grupo.position.x - 2.4, grupo.position.y + 4.2, 3.0);
  }
  uni.uOpacity.value = 0.80 * visible;
  uniG.uOpacity.value = 0.070 * visible;
  uniS.uOpacity.value = visible;

  frente.position.y = escalon + 0.004;
  const enMarcha = (fase === 'imprime');
  frente.material.opacity = (enMarcha
    ? 0.55 + Math.sin(T * 7) * 0.07
    : Math.max(0, frente.material.opacity - dt * (fase === 'listo' && tope >= 1 ? 0.9 : 0.15))) * visible;
  /* Una división en obra nunca apaga del todo el cabezal: sigue en proceso. */
  if (fase === 'listo' && tope < 1) frente.material.opacity = (0.22 + Math.sin(T * 2.2) * 0.08) * visible;
  frente.scale.setScalar(1.0 + Math.sin(build * Math.PI) * 0.5);
  plato.material.opacity = Math.min(0.30, plato.material.opacity + dt * 0.25) * visible;
  motas.material.uniforms.uTime.value = T;

  /* Mirada del NPC. Cuando nadie mueve el ratón (`atento` decaído) la figura
     no se queda clavada mirando al último punto: pasea la vista muy despacio,
     que es lo que hace un personaje esperando. */
  atento = Math.max(0, atento - dt * 0.14);
  const paseo = Math.sin(T * 0.19) * 0.55 + Math.sin(T * 0.071) * 0.25;
  const objX = mx * 2.0 * atento + paseo * (1 - atento);
  const objY = my * 1.3 * atento;
  mirarX += (objX - mirarX) * Math.min(1, dt * 1.9);
  mirarY += (objY - mirarY) * Math.min(1, dt * 1.7);
  uni.uMirar.value.set(mirarX, mirarY);

  cx += (mx * 0.55 - cx) * 0.035;
  cy += (-my * 0.28 - cy) * 0.035;
  dist += (distGoal - dist) * 0.05;
  lado += (ladoGoal - lado) * 0.06;
  grupo.position.x = lado;
  camera.position.set(cx, 0.30 + cy, dist);
  camera.lookAt(lado * 0.30, 0.10, 0);
  /* Cuando está viva, la rotación del grupo es casi nula: el movimiento
     tiene que venir de la propia figura (respiración + despertar), no de
     un plato que gira. */
  grupo.rotation.y = (fase === 'listo' ? T * 0.012 : T * 0.02) + cx * 0.35;

  renderer.render(scene, camera);

  for (let i = 0; i < suscriptores.length; i++) {
    suscriptores[i]({ p: build, fase: fase, figura: figActual, tope: tope });
  }
}

/* ── API ─────────────────────────────────────────────────────────────────── */
const escena = {
  init: init,
  disponible: () => !!renderer,
  reducido: REDUCIDO,

  /* Arranca con la primera figura ya muestreada, sin transición de retracción. */
  arrancar(id, topeInicial) {
    if (!cache.has(id)) return false;
    montar(id);
    tope = topeInicial == null ? 1 : topeInicial;
    target = 0; build = 0;
    if (REDUCIDO) { target = tope; build = tope; fase = 'listo'; }
    else fase = 'imprime';
    return true;
  },

  mostrar(id, topeNuevo, ladoNuevo) {
    if (!FIGURAS[id]) return;
    topeNuevo = topeNuevo == null ? 1 : topeNuevo;
    if (ladoNuevo != null) { ladoDeseado = ladoNuevo; encuadrar(); }
    /* Aquí es donde una figura con malla pide su .glb: la primera vez que se
       navega a su sección, no al cargar el sitio. Devuelve enseguida si ya se
       intentó, y `pedir` sabe esperar a que la descarga cierre antes de
       muestrear la SDF. */
    pedirMalla(id);
    if (!cache.has(id)) pedir(id);

    if (figActual === id) {
      tope = topeNuevo;
      if (fase === 'listo' && target < tope) fase = 'imprime';
      return;
    }
    if (REDUCIDO && cache.has(id)) {
      montar(id); tope = topeNuevo; target = tope; build = tope; fase = 'listo';
      return;
    }
    pendiente = id; topePendiente = topeNuevo; fase = 'retrae';
  },

  atenuar(v) { visGoal = v; },
  alProgresar(cb) { suscriptores.push(cb); },

  /* Termina la impresión en curso de inmediato. Lo usan las pruebas y el modo
     de movimiento reducido; también es la salida si algún día quieres un
     "saltar animación".

     Si hay una figura pendiente que todavía no se ha muestreado, hay que
     terminar de muestrearla aquí mismo aunque bloquee: dejarla pendiente
     mientras la fase pasa a 'listo' la deja colgada para siempre, porque el
     bucle solo la monta desde la fase 'retrae'. */
  saltar() {
    if (pendiente) {
      if (!cache.has(pendiente)) {
        const m = crearMuestreador(pendiente);
        while (m(50) < 1) { /* saltar significa saltar */ }
      }
      montar(pendiente);
      tope = topePendiente;
      pendiente = null;
    }
    target = tope; build = tope; fase = 'listo'; quieto = 1;
    if (uni) {
      uni.uSolido.value = 1;
      uni.uAwake.value = 0;
    }
    solidoGoal = 1;
    awake = 0;                 /* el bucle lo subirá al ver uSolido alto */
    primeraImpresion = false;
  },

  /* Deja lista la primera figura y va avisando del avance: es lo que llena la
     barra del preloader. */
  primeraFigura(id, alAvanzar, alTerminar) {
    /* Si la primera pieza es la del hub y hay malla, la barra del preloader
       mide la DESCARGA, no el muestreo: es lo que el visitante está esperando
       de verdad. Y si la descarga falla, se cae al muestreo de siempre sin que
       se note más que un preloader un poco más largo. */
    if (id === FIGURA_HUB) {
      let vivo = true;
      const tic = setInterval(() => { if (vivo) alAvanzar(avanceModelo * 0.98); }, 80);
      pedirMalla(FIGURA_HUB).then(ok => {
        vivo = false; clearInterval(tic);
        if (ok) { alAvanzar(1); alTerminar(); }
        else muestrear(id, alAvanzar, alTerminar);
      });
      return;
    }
    /* Si el visitante entró directo a una sección cuya pieza es esculpida, se
       espera a esa descarga igual que con la del hub: muestrear su SDF para
       tirarla dos segundos después sería trabajo perdido y un parpadeo. */
    if (FIGURAS[id] && FIGURAS[id].glb && USAR_MODELO) {
      pedirMalla(id).then(ok => {
        if (ok) { alAvanzar(1); alTerminar(); }
        else muestrear(id, alAvanzar, alTerminar);
      });
      return;
    }
    muestrear(id, alAvanzar, alTerminar);
  },

  /* Muestrea en segundo plano las SDF de las figuras que el visitante todavía
     no ha pedido. Las que declaran malla se saltan: su .glb se descarga al
     navegar a su sección, y muestrear una SDF que va a ser reemplazada es
     trabajo tirado. Si esa descarga falla, `mostrar` encola la SDF entonces. */
  precargar(ids) {
    ids.forEach(id => {
      const F = FIGURAS[id];
      if (USAR_MODELO && F && F.glb) return;
      if (!cache.has(id) && cola.indexOf(id) < 0) cola.push(id);
    });
  },
  listaCache: () => [...cache.keys()],
  capasDe(id) {
    const F = FIGURAS[id] || FIGURAS.valquiria;
    return Math.round((F.bb.y1 - F.bb.y0) / ALTURA_CAPA);
  },
  mmDe(id) { return (FIGURAS[id] || FIGURAS.valquiria).mm; }
};

/* app.js sigue siendo el mismo código de siempre y habla con la escena por
   `VQ.escena`. Mantener el global evita convertir 900 líneas de router,
   carrito y asesor en módulo sin ninguna ganancia. */
window.VQ = window.VQ || {};
window.VQ.escena = escena;

export { escena };
