/* ═══════════════════════════════════════════════════════════════════════════
   VALQUIRIA — APLICACIÓN
   ───────────────────────────────────────────────────────────────────────────
   Router de hash, catálogo, carrito y el Asesor.

   Una sola página: el canvas de impresión vive entre rutas, así que cambiar
   de sección no recarga nada — la pieza anterior se retrae y la nueva se
   imprime encima de la misma plataforma.
   ═══════════════════════════════════════════════════════════════════════════ */
/* La escena se importa por su efecto: al evaluarse deja lista `window.VQ`,
   que es la superficie que usa todo lo de abajo. */
import './escena.js?v=68';

/* Aviso al vigilante del index: los módulos llegaron y se están evaluando.
   A partir de aquí lo que tarde es trabajo, no una carga rota, así que puede
   cancelar el rescate por fallo de carga. Va lo primero de todo —antes de
   cualquier otra cosa que pudiera lanzar— porque su valor está justo en
   distinguir «no llegó» de «está tardando». */
if (window.__vqArranco) window.__vqArranco();

/* ── Configuración ───────────────────────────────────────────────────────── */
const CFG = {
  /* Backend del Asesor. Si no responde, el Asesor sigue funcionando en modo
     local: busca en el catálogo, cotiza y cierra por WhatsApp. Un backend
     dormido no puede dejar la página muda. */
  backend: 'https://rodrigo-corrales1429-github-io.onrender.com',
  whatsapp: '525554675821',
  correo: 'ventas@valquiriadental.com',
  envioGratisDesde: 99900,   // centavos
  costoEnvio: 15000,         // centavos
  timeoutMs: 42000
};

/* ── Catálogo ─────────────────────────────────────────────────────────────
   Espejo de productos.json. Los precios se guardan en CENTAVOS ENTEROS, igual
   que en el servidor: con flotantes, 444.01 * 3 deja de coincidir con el total
   que cobra la pasarela, y ese descuadre se paga en soporte. */
const PRODUCTOS = [
  { sku:'ValEnd', nombre:'Dientes Valquiria para práctica de endodoncia',
    corto:'Nervio sintético líder en la industria, anatomía interna completa.',
    precio:40183, regular:63900, stock:27,
    img:'https://res.cloudinary.com/dyzgyuixk/image/upload/f_auto,q_auto/endo_ahtc7k',
    claves:['endodoncia','endo','conducto','conductos','nervio','endodoncista','endodontico','practica endodoncia','kit endo'] },
  { sku:'ValPulpo', nombre:'Dientes Valquiria para práctica de pulpotomía',
    corto:'Dientes infantiles con cámara y raíces simuladas, tamaño realista.',
    precio:44401, regular:53900, stock:23,
    img:'https://res.cloudinary.com/dyzgyuixk/image/upload/f_auto,q_auto/pulpo_frybuu',
    claves:['pulpotomia','pulpo','pediatria','pediatrico','infantil','niño','niños','odontopediatria','kit pulpo'] },
  { sku:'DientesRealistas', nombre:'Kit de 32 dientes realistas',
    corto:'Arcada completa de adulto con nervio simulado y estuche protector.',
    precio:100711, regular:129900, stock:15,
    img:'https://res.cloudinary.com/dyzgyuixk/image/upload/f_auto,q_auto/realistas_dxfhrr',
    claves:['kit completo','32 dientes','boca completa','arcada','incisivos','caninos','premolares','molares','ultra realista','set completo','kit avanzado'] },
  { sku:'Endotnissin', nombre:'Dientes tipo Nissin para endodoncia',
    corto:'Compatibles con tipodonto Nissin, con el nervio sintético Valquiria.',
    precio:71958, regular:99000, stock:10,
    img:'https://res.cloudinary.com/dyzgyuixk/image/upload/f_auto,q_auto/endonissin_b0hlmi',
    claves:['nissin','nisin','nicin','nissim','tipodonto','tipo nissin','compatible nissin','simulador','fantoma'] }
];
const porSku = sku => PRODUCTOS.find(p => p.sku === sku);

/* ── Utilidades ──────────────────────────────────────────────────────────── */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* Centavos enteros → "$1,234.56 MXN". La única función que produce decimales. */
function mxn(centavos) {
  const neg = centavos < 0, abs = Math.abs(centavos);
  return (neg ? '-' : '') + '$' +
    Math.floor(abs / 100).toLocaleString('en-US') + '.' +
    String(abs % 100).padStart(2, '0');
}

/* El texto del Asesor viene de un modelo de lenguaje, que a su vez puede estar
   reflejando lo que escribió el usuario. Escapar antes de tocar el DOM no es
   opcional. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Markdown mínimo, aplicado DESPUÉS de escapar: negritas, cursivas y párrafos. */
function md(s) {
  return esc(s)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .split(/\n{2,}/).map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('');
}

const normaliza = s => String(s).toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

/* ═══════════════════════════════════════════════════════════════════════════
   CARRITO
   ═══════════════════════════════════════════════════════════════════════════ */
const Carrito = {
  items: new Map(),   // sku -> cantidad
  LLAVE: 'vq_carrito_v1',

  cargar() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.LLAVE) || '[]');
      if (Array.isArray(raw)) {
        raw.forEach(it => {
          const p = porSku(it && it.sku);
          const c = parseInt(it && it.cantidad, 10);
          if (p && Number.isInteger(c) && c > 0) {
            this.items.set(p.sku, Math.min(c, p.stock));
          }
        });
      }
    } catch (e) { /* localStorage bloqueado o corrupto: arrancamos vacíos */ }
  },

  guardar() {
    try { localStorage.setItem(this.LLAVE, JSON.stringify(this.lista())); }
    catch (e) { /* modo privado: el carrito vive solo en memoria */ }
  },

  lista() { return [...this.items].map(([sku, cantidad]) => ({ sku, cantidad })); },
  piezas() { return [...this.items.values()].reduce((a, b) => a + b, 0); },

  agregar(sku, cantidad) {
    const p = porSku(sku); if (!p) return false;
    const n = Math.max(1, Math.min(99, parseInt(cantidad, 10) || 1));
    const total = Math.min(p.stock, (this.items.get(sku) || 0) + n);
    this.items.set(sku, total);
    this.cambio(); return true;
  },

  fijar(sku, cantidad) {
    const p = porSku(sku); if (!p) return false;
    const n = parseInt(cantidad, 10);
    if (!Number.isInteger(n) || n <= 0) this.items.delete(sku);
    else this.items.set(sku, Math.min(n, p.stock));
    this.cambio(); return true;
  },

  quitar(sku) { this.items.delete(sku); this.cambio(); },
  vaciar() { this.items.clear(); this.cambio(); },

  /* Reemplaza el carrito completo. Es lo que usa el Asesor cuando arma un
     pedido de varias líneas de una sola vez. */
  reemplazar(lista) {
    this.items.clear();
    (lista || []).forEach(it => {
      const p = porSku(it && it.sku);
      const n = parseInt(it && it.cantidad, 10);
      if (p && Number.isInteger(n) && n > 0) this.items.set(p.sku, Math.min(n, p.stock));
    });
    this.cambio();
  },

  totales() {
    let subtotal = 0;
    const lineas = [];
    this.items.forEach((cantidad, sku) => {
      const p = porSku(sku); if (!p) return;
      const linea = p.precio * cantidad;
      lineas.push({ p, cantidad, linea });
      subtotal += linea;
    });
    const gratis = subtotal >= CFG.envioGratisDesde;
    const envio = (subtotal === 0 || gratis) ? 0 : CFG.costoEnvio;
    return {
      lineas, subtotal, envio, gratis,
      total: subtotal + envio,
      falta: gratis ? 0 : CFG.envioGratisDesde - subtotal
    };
  },

  cambio() {
    this.guardar();
    const n = this.piezas();
    $('#cart-n').textContent = n;
    const b = $('#cart-btn');
    b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
    pintarDrawer();
  }
};

/* ── Panel del carrito ───────────────────────────────────────────────────── */
function pintarDrawer() {
  const cont = $('#drawer-items'), pie = $('#drawer-pie');
  const t = Carrito.totales();

  if (!t.lineas.length) {
    cont.innerHTML = `
      <div class="vacio">
        <p>Tu carrito está vacío.<br>¿Quieres que el Asesor te arme el pedido?</p>
        <button class="btn ia abrir-asesor"><span>Hablar con el Asesor</span></button>
      </div>`;
    pie.innerHTML = `<a class="btn ghost" href="#/catalogo" data-cierra-drawer><span>Ver catálogo</span></a>`;
    return;
  }

  cont.innerHTML = t.lineas.map(l => `
    <div class="ci" data-sku="${esc(l.p.sku)}">
      <img src="${esc(l.p.img)}" alt="" loading="lazy">
      <div class="ci-info">
        <h4>${esc(l.p.nombre)}</h4>
        <span class="ci-p">${mxn(l.linea)}</span>
        <div class="ci-ctl">
          <button data-d="-1" aria-label="Quitar uno">−</button>
          <span>${l.cantidad}</span>
          <button data-d="1" aria-label="Agregar uno">+</button>
          <button class="ci-quitar" data-quitar>Quitar</button>
        </div>
      </div>
    </div>`).join('');

  pie.innerHTML = `
    <div class="tot-l"><span>Subtotal</span><span>${mxn(t.subtotal)}</span></div>
    <div class="tot-l"><span>Envío</span><span>${t.gratis ? 'Gratis' : mxn(t.envio)}</span></div>
    ${t.gratis ? '' : `<div class="tot-envio">Te faltan ${mxn(t.falta)} para envío gratis</div>`}
    <div class="tot-l grande"><span>Total</span><span>${mxn(t.total)}</span></div>
    <button class="btn" id="ir-pagar"><span>Pagar con Mercado Pago</span></button>
    <a class="btn ghost" id="ir-wa" href="#"><span>Cerrar por WhatsApp</span></a>
    <p class="pie-nota">
      Al continuar aceptas los <a href="#/terminos" data-cierra-drawer>términos de uso</a>.
      Pago procesado por Mercado Pago.
    </p>`;
}

function abrirDrawer(v) {
  $('#drawer').classList.toggle('on', v);
  $('#velo').classList.toggle('on', v);
  $('#drawer').setAttribute('aria-hidden', v ? 'false' : 'true');
  document.body.style.overflow = v ? 'hidden' : '';
}

/* ── Pedido en texto, para WhatsApp ───────────────────────────────────────
   El cliente abre WhatsApp con el pedido ya escrito: cantidades, importes,
   total y folio. Del otro lado se responde, no se transcribe. */
function folio() {
  return 'VQ-' + Date.now().toString(36).toUpperCase().slice(-6);
}

function textoPedido(f) {
  const t = Carrito.totales();
  if (!t.lineas.length) {
    return 'Hola Valquiria, me gustaría recibir asesoría sobre sus productos.';
  }
  const l = t.lineas.map(x =>
    `• ${x.cantidad} × ${x.p.nombre} — ${mxn(x.linea)}`).join('\n');
  return 'Hola Valquiria, quiero confirmar este pedido:\n\n' + l +
    `\n\nSubtotal: ${mxn(t.subtotal)}` +
    `\nEnvío: ${t.gratis ? 'gratis' : mxn(t.envio)}` +
    `\nTotal: ${mxn(t.total)}` +
    `\n\nFolio: ${f}`;
}

const urlWhatsApp = txt => `https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent(txt)}`;

/* ── Checkout ─────────────────────────────────────────────────────────────
   Al servidor se le mandan SKUs y cantidades, nunca precios: los importes se
   recalculan allá contra el catálogo. Un carrito manipulado desde la consola
   no puede cambiar lo que se cobra. */
async function irAPagar(boton) {
  const t = Carrito.totales();
  if (!t.lineas.length) return;
  const original = boton ? boton.innerHTML : '';
  if (boton) { boton.innerHTML = '<span>Generando link…</span>'; boton.disabled = true; }

  try {
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), CFG.timeoutMs);
    const r = await fetch(CFG.backend + '/api/pago', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: Carrito.lista() }), signal: ctrl.signal
    });
    clearTimeout(reloj);
    const data = await r.json();
    if (!r.ok || !data.url) throw new Error(data.error || 'Sin link de pago');
    location.href = data.url;
  } catch (e) {
    if (boton) { boton.innerHTML = original; boton.disabled = false; }
    const f = folio();
    toast('No pude generar el link de pago en este momento. Te abro WhatsApp con tu pedido ya escrito para cerrarlo ahí.');
    setTimeout(() => window.open(urlWhatsApp(textoPedido(f)), '_blank', 'noopener'), 1400);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CATÁLOGO
   ═══════════════════════════════════════════════════════════════════════════ */
function pintarCatalogo() {
  const grid = $('#grid');
  if (!grid || grid.dataset.listo) return;
  grid.dataset.listo = '1';

  grid.innerHTML = PRODUCTOS.map(p => `
    <article class="card" data-sku="${esc(p.sku)}">
      <div class="media">
        <img src="${esc(p.img)}" alt="${esc(p.nombre)}" loading="lazy">
        <div class="scan"></div>
      </div>
      <div class="card-body">
        <span class="sku">SKU ${esc(p.sku)}</span>
        <h3>${esc(p.nombre)}</h3>
        <p class="desc">${esc(p.corto)}</p>
        <div class="price">
          <span class="now">${mxn(p.precio)}</span>
          <span class="was">${mxn(p.regular)}</span>
        </div>
        <div class="buy">
          <div class="qty">
            <button data-d="-1" aria-label="Quitar uno">−</button>
            <input type="number" value="1" min="1" max="99" aria-label="Cantidad de ${esc(p.nombre)}">
            <button data-d="1" aria-label="Agregar uno">+</button>
          </div>
          <button class="add"><span>Agregar</span></button>
        </div>
      </div>
    </article>`).join('');

  /* Cada tarjeta también se imprime al entrar en pantalla. */
  const io = new IntersectionObserver(es => {
    es.forEach(en => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      const m = en.target.querySelector('.media');
      if (VQ.escena.reducido) {
        m.style.setProperty('--built', '100%'); m.style.setProperty('--f', 1); return;
      }
      let s = 0; const N = 30;
      m.style.setProperty('--scan', 1);
      const iv = setInterval(() => {
        s++; const f = s / N;
        m.style.setProperty('--built', (f * 100) + '%');
        m.style.setProperty('--f', f.toFixed(3));
        if (s >= N) { clearInterval(iv); m.style.setProperty('--scan', 0); }
      }, 35);
    });
  }, { threshold: .3 });
  $$('.card').forEach(c => io.observe(c));
}

/* ═══════════════════════════════════════════════════════════════════════════
   ROUTER
   ═══════════════════════════════════════════════════════════════════════════ */
const RUTAS = {
  '/':           { vista:'v-hub',        fig:'valquiria', tope:1,    lado:1,  titulo:'Valquiria Inc. — Manufactura aditiva en México' },
  '/dental':     { vista:'v-dental',     fig:'diente',    tope:1,    lado:-1, titulo:'Valquiria Dental — Modelos anatómicos con nervio sintético' },
  '/ia':         { vista:'v-ia',         fig:'cyborg',    tope:.94,  lado:1,  titulo:'Valquiria IA — Automatización y consultoría en inteligencia artificial' },
  '/3d':         { vista:'v-3d',         fig:'engrane',   tope:.62,  lado:-1, titulo:'Valquiria 3D — Prototipado y manufactura aditiva' },
  /* El tope subió de .55 a .88: la charola nueva es baja y con .55 el corte
     caía antes de la cavidad y el sello — se veía una losa, no un empaque.
     Con .88 todo el detalle imprime y la esquina alta queda en obra. */
  '/pack':       { vista:'v-pack',       fig:'empaque',   tope:.88,  lado:1,  titulo:'Valquiria Pack — Empaque termoformado a la medida' },
  '/lux':        { vista:'v-lux',        fig:'lampara',   tope:.68,  lado:-1, titulo:'Valquiria Lux — Iluminación impresa' },
  '/catalogo':   { vista:'v-catalogo',   fig:null, titulo:'Catálogo — Valquiria Dental' },
  /* Mercado Pago devuelve al cliente aquí después de pagar. */
  '/gracias':    { vista:'v-gracias',    fig:null, titulo:'Gracias por tu pedido — Valquiria Inc.' },
  '/filosofia':  { vista:'v-filosofia',  fig:null, titulo:'Filosofía — Valquiria Inc.' },
  '/contacto':   { vista:'v-contacto',   fig:null, titulo:'Contacto — Valquiria Inc.' },
  '/privacidad': { vista:'v-privacidad', fig:null, titulo:'Aviso de privacidad — Valquiria Inc.' },
  '/terminos':   { vista:'v-terminos',   fig:null, titulo:'Términos de uso — Valquiria Inc.' }
};

const rutaActual = () => {
  const h = (location.hash || '#/').replace(/^#/, '');
  return RUTAS[h] ? h : '/';
};

let rutaViva = null;

function navegar(primera) {
  const clave = rutaActual();
  if (clave === rutaViva && !primera) return;
  rutaViva = clave;
  const R = RUTAS[clave];

  $$('.vista').forEach(v => v.classList.toggle('on', v.id === R.vista));
  document.title = R.titulo;

  $$('[data-ruta]').forEach(a => a.classList.toggle('act', a.dataset.ruta === clave));

  if (R.fig) {
    VQ.escena.atenuar(1);
    /* arrancar() solo sirve si la figura ya está muestreada. No siempre lo
       está: si el visitante cambia de sección mientras carga el preloader, la
       ruta al terminar ya no es la que se muestreó al empezar. En ese caso hay
       que pasar por mostrar(), que sabe encolar y esperar. */
    if (!primera || !VQ.escena.arrancar(R.fig, R.tope)) {
      VQ.escena.mostrar(R.fig, R.tope, R.lado);
    }
    $('#riel').classList.add('on');
  } else {
    VQ.escena.atenuar(0);
    $('#riel').classList.remove('on');
  }

  /* La barra de estado de cada división se llena al entrar, y su lectura de
     capas se calcula desde la geometría real de la pieza. Escritos a mano, el
     texto y el riel terminan diciendo números distintos de la misma cosa. */
  const vista = document.getElementById(R.vista);
  if (vista) {
    const barra = vista.querySelector('.estado-bar i');
    if (barra) {
      /* Reflow forzado en vez de requestAnimationFrame: en una pestaña de
         fondo el rAF no corre y la barra se quedaría vacía para siempre.
         Leer offsetWidth confirma el 0 y deja que la transición arranque. */
      barra.style.width = '0';
      void barra.offsetWidth;
      barra.style.width = ((R.tope || 1) * 100) + '%';
    }
    const lectura = vista.querySelector('[data-capas]');
    if (lectura && R.fig) {
      const capas = VQ.escena.capasDe(R.fig);
      const hechas = Math.round((R.tope || 1) * capas);
      lectura.textContent = hechas >= capas
        ? capas + ' capas · división activa'
        : 'capa ' + hechas + ' de ' + capas;
    }
  }

  if (clave === '/catalogo') pintarCatalogo();

  /* Si el cliente vuelve de Mercado Pago, el pedido ya se pagó: dejarle el
     carrito lleno lo expone a pagar dos veces lo mismo. */
  if (clave === '/gracias' && Carrito.piezas() > 0) Carrito.vaciar();

  cerrarMenu();
  if (!primera) window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
}

addEventListener('hashchange', () => navegar(false));

/* ── Menú móvil ──────────────────────────────────────────────────────────── */
function cerrarMenu() {
  $('#menu').classList.remove('on');
  $('#burger').classList.remove('on');
  $('#burger').setAttribute('aria-expanded', 'false');
  if (!$('#drawer').classList.contains('on')) document.body.style.overflow = '';
}
$('#burger').addEventListener('click', () => {
  const abre = !$('#menu').classList.contains('on');
  $('#menu').classList.toggle('on', abre);
  $('#burger').classList.toggle('on', abre);
  $('#burger').setAttribute('aria-expanded', abre ? 'true' : 'false');
  document.body.style.overflow = abre ? 'hidden' : '';
});

/* ═══════════════════════════════════════════════════════════════════════════
   EL RIEL
   Traduce el avance de la impresión a cota y número de capa. Las etiquetas se
   mantienen cortas a propósito: es texto vertical dentro de un carril de alto
   fijo, y una etiqueta larga se recortaría.
   ═══════════════════════════════════════════════════════════════════════════ */
const rielFill = $('#riel-fill'), rielHead = $('#riel-head'),
      rielZ = $('#riel-z'), rielCapa = $('#riel-capa'), rielSec = $('#riel-sec');

for (let i = 1; i < 8; i++) {
  const t = document.createElement('div');
  t.className = 'riel-tick'; t.style.top = (i * 12.5) + '%';
  $('#riel-track').appendChild(t);
}

const ETIQUETA = { imprime:'Imprimiendo', retrae:'Retrayendo', espera:'En espera' };
let lineasHero = [];

VQ.escena.alProgresar(function (e) {
  const capas = VQ.escena.capasDe(e.figura);
  const pct = (e.p * 100).toFixed(2);
  rielFill.style.height = pct + '%';
  rielHead.style.top = pct + '%';
  rielZ.textContent = (VQ.escena.mmDe(e.figura) * e.p).toFixed(2) + ' mm';
  /* Formato compacto: el carril del riel mide 62px y "Capa 007 / 201" no cabe
     sin desbordarse sobre el contenido. */
  rielCapa.textContent = 'Capa ' + String(Math.round(e.p * capas)).padStart(3, '0') + '/' + capas;

  const listo = e.fase === 'listo';
  const txt = listo ? (e.tope >= 1 ? 'Pieza lista' : 'En proceso') : (ETIQUETA[e.fase] || 'Muestreando');
  if (rielSec.textContent !== txt) rielSec.textContent = txt;
  rielSec.classList.toggle('listo', listo && e.tope >= 1);

  /* En el hub las líneas del titular las revela el cabezal al alcanzarlas. */
  if (e.figura === 'valquiria' && rutaViva === '/') {
    for (let i = 0; i < lineasHero.length; i++) {
      if (e.p >= parseFloat(lineasHero[i].dataset.at)) lineasHero[i].classList.add('built');
    }
  }

});

/* ═══════════════════════════════════════════════════════════════════════════
   ASESOR
   ═══════════════════════════════════════════════════════════════════════════ */
const Asesor = {
  log: $('#asesor-log'),
  historial: [],
  ocupado: false,
  abierto: false,
  saludado: false,
  modoLocal: false,

  abrir() {
    this.abierto = true;
    $('#asesor').classList.add('on');
    $('#asesor').setAttribute('aria-hidden', 'false');
    $('#asesor-btn').classList.add('abierto');
    $('#asesor-btn').setAttribute('aria-expanded', 'true');
    $('#asesor-punto').classList.remove('on');
    if (!this.saludado) { this.saludado = true; this.saludo(); this.despertar(); }
    setTimeout(() => $('#asesor-in').focus(), 320);
  },

  /* El backend duerme en el plan gratuito de Render y tarda ~50 s en levantar.
     Ese despertar cae completo sobre el primer mensaje del usuario, que es
     justo el que decide si el Asesor sirve o no. Al abrir el panel se manda un
     ping: mientras el visitante lee el saludo y escribe, el servidor arranca. */
  despertar() {
    if (this.pingHecho) return;
    this.pingHecho = true;
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 55000);
    fetch(CFG.backend + '/health', { signal: ctrl.signal })
      .catch(() => { /* si no despierta, el modo local toma el relevo */ });
  },

  cerrar() {
    this.abierto = false;
    $('#asesor').classList.remove('on');
    $('#asesor').setAttribute('aria-hidden', 'true');
    $('#asesor-btn').classList.remove('abierto');
    $('#asesor-btn').setAttribute('aria-expanded', 'false');
  },

  saludo() {
    this.burbuja('bot',
      '<p>Soy el <strong>Asesor Valquiria</strong>. Puedo armarte el pedido completo ' +
      '—lo cotizo, lo pongo en tu carrito y te paso el link de pago— y también ' +
      'resolver dudas: de nuestros modelos, de impresión 3D o de un proyecto de IA ' +
      'para tu empresa.</p>');
    this.sugerencias([
      'Quiero 2 kits de endodoncia',
      '¿Qué tienen para pulpotomía?',
      'Algo compatible con tipodonto Nissin',
      'Quiero automatizar mi negocio con IA'
    ]);
  },

  /* Bajar al final del hilo. Se hace tres veces a propósito: ya mismo con el
     layout actual, tras el siguiente cuadro (cuando el bloque recién insertado
     ya midió), y otra vez pasados 150 ms para cuando cargan las imágenes de
     las tarjetas de producto y el hilo crece de golpe. */
  fin() {
    const l = this.log;
    const abajo = () => { l.scrollTop = l.scrollHeight; };
    abajo();
    requestAnimationFrame(abajo);
    setTimeout(abajo, 150);
  },

  burbuja(quien, html) {
    const d = document.createElement('div');
    d.className = 'msj ' + quien;
    d.innerHTML = html;
    this.log.appendChild(d);
    this.fin();
    return d;
  },

  sugerencias(lista) {
    const c = document.createElement('div');
    c.className = 'chips';
    c.innerHTML = lista.map(t => `<button class="chip">${esc(t)}</button>`).join('');
    c.addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (!b) return;
      c.remove();
      this.enviar(b.textContent);
    });
    this.log.appendChild(c); this.fin();
  },

  pensando(v) {
    const y = this.log.querySelector('.pensando');
    if (v && !y) {
      const d = document.createElement('div');
      d.className = 'pensando';
      d.innerHTML = '<i></i><i></i><i></i>';
      this.log.appendChild(d); this.fin();
    } else if (!v && y) y.remove();
  },

  tarjetas(prods) {
    if (!prods || !prods.length) return;
    const c = document.createElement('div');
    c.className = 'chat-prods';
    c.innerHTML = prods.slice(0, 4).map(p => {
      const local = porSku(p.sku);
      const img = (local && local.img) || p.imagen || '';
      const precio = local ? mxn(local.precio) : esc(p.precio || '');
      return `<div class="chat-prod" data-sku="${esc(p.sku)}">
        <img src="${esc(img)}" alt="" loading="lazy">
        <div class="chat-prod-i">
          <b>${esc(p.nombre)}</b>
          <span>${precio}</span>
        </div>
        <button type="button">Agregar</button>
      </div>`;
    }).join('');
    c.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const sku = b.closest('.chat-prod').dataset.sku;
      Carrito.agregar(sku, 1);
      b.textContent = 'Agregado';
      b.disabled = true;
      this.trasCarrito();
    });
    this.log.appendChild(c); this.fin();
  },

  cotizacion(cot) {
    if (!cot || !cot.lineas) return;
    const c = document.createElement('div');
    c.className = 'chat-cot';
    c.innerHTML =
      cot.lineas.map(l => `<div class="cl">
          <span>${l.cantidad} × ${esc(l.nombre)}</span>
          <span>${esc(l.subtotal_linea)}</span></div>`).join('') +
      `<div class="cl"><span>Envío</span><span>${cot.envio && cot.envio.gratis ? 'Gratis' : esc(cot.envio ? cot.envio.costo : '')}</span></div>` +
      `<div class="cl tot"><span>Total</span><span>${esc(cot.total)}</span></div>`;
    this.log.appendChild(c); this.fin();
  },

  /* Botonera de cierre: pagar, WhatsApp, ver carrito. */
  acciones(lista) {
    if (!lista || !lista.length) return;
    const c = document.createElement('div');
    c.className = 'chat-acts';
    c.innerHTML = lista.map(a => {
      if (a.tipo === 'pago')
        return `<button class="chat-act" data-acc="pago">Pagar con Mercado Pago</button>`;
      if (a.tipo === 'whatsapp')
        return `<button class="chat-act wa" data-acc="wa"${
          a.texto ? ` data-txt="${esc(a.texto)}"` : ''}>${
          esc(a.rotulo || 'Cerrar por WhatsApp')}</button>`;
      if (a.tipo === 'carrito')
        return `<button class="chat-act sec" data-acc="carrito">Ver mi carrito</button>`;
      if (a.tipo === 'ir')
        return `<a class="chat-act sec" href="#${esc(a.ruta)}">${esc(a.texto || 'Abrir')}</a>`;
      return '';
    }).join('');
    c.addEventListener('click', e => {
      const b = e.target.closest('[data-acc]'); if (!b) return;
      const t = b.dataset.acc;
      if (t === 'pago') irAPagar(b);
      else if (t === 'wa') {
        /* Una consulta de servicios de IA no debe abrir WhatsApp con un
           pedido de dientes: la acción puede traer su propio texto. */
        const txt = b.dataset.txt || textoPedido(folio());
        window.open(urlWhatsApp(txt), '_blank', 'noopener');
      } else if (t === 'carrito') abrirDrawer(true);
    });
    this.log.appendChild(c); this.fin();
  },

  trasCarrito() {
    const t = Carrito.totales();
    if (!t.lineas.length) return;
    this.acciones([{ tipo:'pago' }, { tipo:'whatsapp' }, { tipo:'carrito' }]);
  },

  async enviar(texto) {
    texto = String(texto || '').trim();
    if (!texto || this.ocupado) return;

    this.burbuja('yo', '<p>' + esc(texto) + '</p>');
    this.historial.push({ role: 'user', parts: [{ text: texto }] });
    this.ocupado = true;
    $('#asesor-send').disabled = true;
    this.pensando(true);

    let data = null;
    let avisoServidor = '';
    if (!this.modoLocal) {
      try { data = await this.pedirAlServidor(); }
      catch (e) {
        if (e.pasajero) {
          /* Cuota agotada o proveedor saturado: este mensaje lo contesta el
             asesor local, pero el siguiente vuelve a intentar el backend. Un
             pico de tráfico de dos minutos no debe dejar al visitante con el
             asesor de repuesto durante toda su visita. */
          console.warn('[asesor] fallo pasajero (' + (e.motivo || '?') +
                       '), contesto en local y reintento en el siguiente mensaje.');
          avisoServidor = e.mensajeUsuario || '';
        } else {
          console.warn('[asesor] backend no disponible, paso a modo local:', e.message);
          this.modoLocal = true;
        }
      }
    }
    if (!data) data = this.responderLocal(texto);
    /* Si el servidor explicó por qué no pudo, se dice UNA vez y arriba del
       todo: el visitante merece saber que está hablando con el suplente. */
    if (avisoServidor) data = { ...data, reply: avisoServidor + '\n\n' + data.reply };

    this.pensando(false);
    this.ocupado = false;
    $('#asesor-send').disabled = false;

    this.burbuja('bot', md(data.reply));
    this.historial.push({ role: 'model', parts: [{ text: data.reply }] });
    if (this.historial.length > 40) this.historial = this.historial.slice(-40);

    /* El servidor no toca el carrito: propone, y el cliente aplica. */
    if (Array.isArray(data.acciones)) {
      data.acciones.forEach(a => {
        if (a.tipo === 'carrito_set') Carrito.reemplazar(a.items);
        else if (a.tipo === 'carrito_add') Carrito.agregar(a.sku, a.cantidad);
        else if (a.tipo === 'abrir_carrito') abrirDrawer(true);
      });
    }

    this.tarjetas(data.products);
    this.cotizacion(data.cotizacion);

    const botones = (data.acciones || []).filter(a =>
      a.tipo === 'pago' || a.tipo === 'whatsapp' || a.tipo === 'carrito' || a.tipo === 'ir');
    if (botones.length) this.acciones(botones);
    else if (data.cotizacion || (data.acciones || []).some(a => a.tipo && a.tipo.indexOf('carrito') === 0)) {
      this.trasCarrito();
    }
  },

  async pedirAlServidor() {
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), CFG.timeoutMs);
    try {
      const r = await fetch(CFG.backend + '/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: this.historial, carrito: Carrito.lista() }),
        signal: ctrl.signal
      });
      const j = await r.json();
      if (!r.ok) {
        const e = new Error(j.error || ('HTTP ' + r.status));
        /* El servidor dice POR QUÉ falló. Un 429 o una saturación son
           pasajeros y no deben condenar la sesión entera al modo local. */
        e.motivo = j.motivo || '';
        e.pasajero = r.status === 429 || r.status === 503 || r.status === 504;
        e.mensajeUsuario = j.error || '';
        throw e;
      }
      if (!j.reply) throw new Error('respuesta vacía');
      return j;
    } finally { clearTimeout(reloj); }
  },

  /* ── Modo local ────────────────────────────────────────────────────────
     Sin backend el Asesor no se disculpa: busca en el catálogo, entiende
     cantidades y cierra por WhatsApp. Es peor que el modelo, pero vende. */
  responderLocal(texto) {
    const q = normaliza(texto);

    const puntuar = frag => PRODUCTOS.map(p => {
      let score = 0;
      if (frag.includes(normaliza(p.sku))) score += 5;
      p.claves.forEach(k => { if (frag.includes(normaliza(k))) score += 3; });
      return { p, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

    const encontrados = puntuar(q);

    /* Cantidad: "2 de endo", "dame tres kits". */
    const PALABRA = { un:1, una:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7, ocho:8, nueve:9, diez:10 };
    const cantidadDe = frag => {
      const mNum = frag.match(/\b(\d{1,2})\b/);
      if (mNum) return Math.max(1, Math.min(99, parseInt(mNum[1], 10)));
      for (const w in PALABRA) if (new RegExp('\\b' + w + '\\b').test(frag)) return PALABRA[w];
      return 1;
    };
    const cantidad = cantidadDe(q);

    /* "2 de endo y uno de nissin" son DOS líneas, no una. El fallback parte la
       frase por sus conectores y puntúa cada trozo por separado; quedarse con
       el primer producto y descartar el resto del pedido es peor que no
       entender nada, porque el usuario no se da cuenta de lo que falta. */
    const pedido = new Map();
    normaliza(texto).split(/\s+(?:y|mas|además|ademas|tambien|también)\s+|,|\+/)
      .map(f => f.trim()).filter(Boolean)
      .forEach(frag => {
        const hit = puntuar(frag)[0];
        if (hit && !pedido.has(hit.p.sku)) pedido.set(hit.p.sku, cantidadDe(frag));
      });

    const quiereComprar = /\b(quiero|dame|compr|pedid|llevo|agrega|añade|anade|necesito|pon)/.test(q);
    const quiereCerrar = /\b(pagar|pago|confirmo|confirmar|cierra|cerrar|listo|proced|checkout|si)\b/.test(q);
    const quiereMayoreo = /\b(mayoreo|volumen|distribuid|factura|universidad|escuela|instituci)/.test(q);

    /* Consultas de la división de IA. Van antes que la búsqueda de catálogo:
       "quiero automatizar mi consultorio" trae la palabra consultorio y
       terminaría enseñándole dientes a alguien que viene por software. */
    /* Ojo con las palabras ambiguas: "modelo" y "pieza" son vocabulario del
       catálogo dental antes que de software, y meterlas aquí manda a un
       cliente que pide modelos de dientes a la división equivocada. */
    const quiereIA = /\b(automatiz|inteligencia artificial|\bia\b|agente|chatbot|asistente virtual|secretaria|consultor[ií]a|software|desarrollo a la medida|pagina web|página web|sitio web|visi[oó]n artificial|visi[oó]n por computadora|machine learning|aprendizaje autom)/.test(q);

    /* Impresión 3D: en modo local se dan las tarifas de referencia — son las
       mismas del estimador del servidor, así el mensaje no cambia según qué
       ruta respondió. Pack va antes: "molde" y "empaque" no deben caer aquí. */
    const quierePack = /\b(empaque|empaques|termoformad|blister|clamshell|charola|bandeja|molde para|empacar)/.test(q);
    const quiere3D = /\b(imprimir|impresion 3d|imprimen|filamento|petg|resina|stl|step|prototipos?|prototipar|maquetas?|gramos?|pieza 3d)\b/.test(q) || /\b(pla|abs|asa|tpu)\b/.test(q);

    if (quierePack && !encontrados.length) {
      return { reply:
        'Eso es de **Valquiria Pack**: empaque termoformado con molde hecho a la ' +
        'medida de tu producto. Trabajamos base de **poliestireno blanco** y tapa o ' +
        'blíster de **PET o vinil transparente**, con descuento por mayoreo en ' +
        'tirajes grandes.\n\n' +
        'Cada molde es distinto, así que el precio se conversa con un especialista. ' +
        'Cuéntame **qué producto va dentro, sus dimensiones y el tiraje** que ' +
        'estimas, y te ponemos en contacto.',
        acciones:[
          { tipo:'whatsapp', rotulo:'Cotizar por WhatsApp',
            texto:'Hola Valquiria, me interesa un empaque termoformado a la medida. Mi producto es:' },
          { tipo:'ir', ruta:'/pack', texto:'Ver Valquiria Pack' }
        ] };
    }

    if (quiere3D && !encontrados.length) {
      /* Si el mensaje ya trae gramos, la estimación se da aquí mismo. Es la
         misma tabla del estimador del servidor (impresion3d.js): centavos
         enteros, por gramo, mínimo $150. Un número real vende más que una
         promesa de número. */
      const peso = q.match(/\b(\d{1,5})\s*(?:g|gr|grs|gramos?)\b/);
      if (peso) {
        const TARIFA = { pla:250, petg:300, abs:300, asa:300, tpu:350, resina:500 };
        let mat = 'pla';
        for (const k in TARIFA) if (new RegExp('\\b' + k + '\\b').test(q)) { mat = k; break; }
        const gramos = parseInt(peso[1], 10);
        const bruto = gramos * TARIFA[mat];
        const total = Math.max(15000, bruto);
        return { reply:
          'Estimación preliminar: **' + gramos + ' g en ' + mat.toUpperCase() +
          '** ≈ **' + mxn(total) + '**' +
          (total > bruto ? ' (aplica el pedido mínimo de $150.00)' : '') +
          '. Si el trabajo tarda pocas horas puede salir aún más barato: también ' +
          'cobramos a **$80.00 por hora de impresión**, lo que más te convenga.\n\n' +
          'La cifra en firme la confirma un especialista con tu archivo STL o ' +
          'STEP en la mano — mándalo por WhatsApp y te responde una persona.',
          acciones:[
            { tipo:'whatsapp', rotulo:'Mandar mi archivo por WhatsApp',
              texto:'Hola Valquiria, quiero imprimir una pieza de ~' + gramos + ' g en ' + mat.toUpperCase() + '. Les mando mi archivo:' },
            { tipo:'ir', ruta:'/3d', texto:'Ver Valquiria 3D' }
          ] };
      }
      return { reply:
        'Eso lo ve **Valquiria 3D**. Las tarifas de referencia: **$2.50 MXN por ' +
        'gramo** en PLA (PETG y ABS $3.00, TPU $3.50, resina $5.00) o **$80 por ' +
        'hora de impresión** — se aplica lo que más te convenga. Lijado +20%, ' +
        'pintura +50%, pedido mínimo $150.\n\n' +
        'Es una estimación preliminar: la cifra en firme la confirma un ' +
        'especialista con tu archivo STL o STEP en la mano. Si me dices el **peso ' +
        'aproximado en gramos y el material**, te doy el número; o manda tu ' +
        'archivo directo por WhatsApp.',
        acciones:[
          { tipo:'whatsapp', rotulo:'Mandar mi archivo por WhatsApp',
            texto:'Hola Valquiria, quiero cotizar una impresión 3D. Les mando mi archivo:' },
          { tipo:'ir', ruta:'/3d', texto:'Ver Valquiria 3D' }
        ] };
    }

    if (quiereIA && !encontrados.length) {
      return { reply:
        'Sí, eso lo vemos en **Valquiria IA**. Trabajamos automatización de ' +
        'procesos, agentes de atención y agenda, visión por computadora para ' +
        'control de calidad y consultoría sobre dónde conviene aplicar IA.\n\n' +
        'No manejamos lista de precios porque cada proceso es distinto: ' +
        'primero revisamos cómo lo haces hoy. Cuéntame **qué proceso quieres ' +
        'resolver y con qué volumen** lo manejas, y te ponemos en contacto con ' +
        'el equipo.',
        acciones:[
          { tipo:'whatsapp', rotulo:'Escribir por WhatsApp',
            texto:'Hola Valquiria, me interesa un proyecto con Valquiria IA. Quiero automatizar este proceso:' },
          { tipo:'ir', ruta:'/ia', texto:'Ver Valquiria IA' }
        ] };
    }

    if (quiereMayoreo) {
      return { reply:
        'Para **mayoreo, distribución o facturación a instituciones** te atiende directamente una persona ' +
        'del equipo: los precios por volumen dependen de la cantidad y del destino.\n\n' +
        'Escríbenos por WhatsApp al **+52 55 5467 5821** o a **' + CFG.correo + '** y te pasan las condiciones.',
        acciones:[{ tipo:'whatsapp' }] };
    }

    if (quiereCerrar && Carrito.piezas() > 0) {
      const t = Carrito.totales();
      return { reply:
        'Perfecto. Tu pedido suma **' + mxn(t.total) + '**' +
        (t.gratis ? ' con envío gratis incluido' : ', envío ' + mxn(t.envio)) + '.\n\n' +
        'Puedes pagar con Mercado Pago ahora mismo, o cerrarlo por WhatsApp si prefieres transferencia.',
        acciones:[{ tipo:'pago' }, { tipo:'whatsapp' }] };
    }

    if (encontrados.length && quiereComprar) {
      const lineas = pedido.size
        ? [...pedido].map(([sku, n]) => ({ p: porSku(sku), n }))
        : [{ p: encontrados[0].p, n: cantidad }];
      lineas.forEach(l => Carrito.agregar(l.p.sku, l.n));
      const t = Carrito.totales();
      const detalle = lineas
        .map(l => '**' + l.n + ' × ' + l.p.nombre + '**')
        .join(lineas.length === 2 ? ' y ' : ', ');
      return { reply:
        'Listo, agregué ' + detalle + ' a tu carrito.\n\n' +
        'Tu total va en **' + mxn(t.total) + '**' +
        (t.gratis ? ' con envío gratis.' : ', más ' + mxn(t.envio) + ' de envío. Te faltan ' +
          mxn(t.falta) + ' para que el envío salga gratis.') +
        '\n\n¿Cierro el pedido?',
        acciones:[{ tipo:'pago' }, { tipo:'whatsapp' }, { tipo:'carrito' }] };
    }

    if (encontrados.length) {
      return { reply: 'Esto es lo que tengo para lo que me pides:',
        products: encontrados.slice(0, 3).map(x => ({ sku:x.p.sku, nombre:x.p.nombre, imagen:x.p.img })) };
    }

    return { reply:
      'Te muestro el catálogo completo para que elijas. ¿Tu práctica es de **endodoncia**, ' +
      '**pulpotomía**, necesitas un **kit completo de 32 dientes** o algo compatible con ' +
      '**tipodonto Nissin**?',
      products: PRODUCTOS.map(p => ({ sku:p.sku, nombre:p.nombre, imagen:p.img })) };
  }
};

/* ── Toast ───────────────────────────────────────────────────────────────── */
let relojToast;
function toast(m) {
  $('#toast-msg').textContent = m;
  $('#toast').classList.add('on');
  clearTimeout(relojToast);
  relojToast = setTimeout(() => $('#toast').classList.remove('on'), 7000);
}

/* ═══════════════════════════════════════════════════════════════════════════
   ENLACES DE EVENTOS
   ═══════════════════════════════════════════════════════════════════════════ */
document.addEventListener('click', e => {
  if (e.target.closest('.abrir-asesor')) { e.preventDefault(); Asesor.abrir(); abrirDrawer(false); return; }
  if (e.target.closest('[data-cierra-drawer]')) abrirDrawer(false);
  if (e.target.closest('#menu a')) cerrarMenu();
});

$('#cart-btn').addEventListener('click', () => abrirDrawer(true));
$('#drawer-x').addEventListener('click', () => abrirDrawer(false));
$('#velo').addEventListener('click', () => abrirDrawer(false));
$('#asesor-btn').addEventListener('click', () => Asesor.abierto ? Asesor.cerrar() : Asesor.abrir());
$('#asesor-x').addEventListener('click', () => Asesor.cerrar());

addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('#drawer').classList.contains('on')) abrirDrawer(false);
  else if (Asesor.abierto) Asesor.cerrar();
  else if ($('#menu').classList.contains('on')) cerrarMenu();
});

/* Catálogo: cantidad y agregar */
$('#grid').addEventListener('click', e => {
  const card = e.target.closest('.card'); if (!card) return;
  const input = card.querySelector('.qty input');
  const paso = e.target.closest('[data-d]');
  if (paso) {
    input.value = Math.max(1, Math.min(99, (+input.value || 1) + (+paso.dataset.d)));
    return;
  }
  if (e.target.closest('.add')) {
    Carrito.agregar(card.dataset.sku, +input.value || 1);
    const p = porSku(card.dataset.sku);
    toast('Agregué ' + (+input.value || 1) + ' × ' + p.nombre + ' a tu carrito.');
    input.value = 1;
  }
});

/* Carrito: cantidades, quitar, pagar, WhatsApp */
$('#drawer').addEventListener('click', e => {
  const fila = e.target.closest('.ci');
  if (fila) {
    const sku = fila.dataset.sku;
    if (e.target.closest('[data-quitar]')) { Carrito.quitar(sku); return; }
    const paso = e.target.closest('[data-d]');
    if (paso) { Carrito.fijar(sku, (Carrito.items.get(sku) || 0) + (+paso.dataset.d)); return; }
  }
  if (e.target.closest('#ir-pagar')) { irAPagar(e.target.closest('#ir-pagar')); return; }
  const wa = e.target.closest('#ir-wa');
  if (wa) { e.preventDefault(); window.open(urlWhatsApp(textoPedido(folio())), '_blank', 'noopener'); }
});

/* Asesor: envío y textarea que crece */
$('#asesor-form').addEventListener('submit', e => {
  e.preventDefault();
  const campo = $('#asesor-in');
  const t = campo.value;
  campo.value = ''; campo.style.height = 'auto';
  Asesor.enviar(t);
});
$('#asesor-in').addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 104) + 'px';
});
$('#asesor-in').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#asesor-form').requestSubmit(); }
});

addEventListener('scroll', () => {
  $('#nav').classList.toggle('stuck', scrollY > 40);
}, { passive: true });

/* ═══════════════════════════════════════════════════════════════════════════
   ARRANQUE
   ───────────────────────────────────────────────────────────────────────────
   La primera figura es la de la ruta con la que entró el visitante: si llega
   directo a #/dental, muestreamos el molar y no la valquiria. Nadie debería
   esperar por una pieza que no va a ver.
   ═══════════════════════════════════════════════════════════════════════════ */
const preFill = $('#pre-fill'), preTxt = $('#pre-txt'), preMark = $('#pre-mark');
const FASES = [[0,'Calibrando plataforma'],[0.18,'Muestreando geometría'],
               [0.62,'Proyectando superficie'],[0.9,'Iniciando impresión']];

function arrancar() {
  $('#anio').textContent = new Date().getFullYear();
  Carrito.cargar();
  $('#cart-n').textContent = Carrito.piezas();
  pintarDrawer();
  lineasHero = $$('#v-hub [data-at]');

  const R = RUTAS[rutaActual()];
  const primera = R.fig || 'valquiria';

  const listo = function () {
    preFill.style.width = '100%';
    VQ.escena.init();
    navegar(true);

    setTimeout(() => {
      $('#pre').classList.add('gone');
      /* El resto de las piezas se muestrean en segundo plano, en el orden en
         que es más probable que se visiten. */
      VQ.escena.precargar(['valquiria','diente','cyborg','engrane','lampara','empaque']
        .filter(id => R.fig && id === primera ? false : true));
    }, 420);

    /* Si nadie ha hablado con el Asesor, a los 25 s se enciende el punto.
       Una sola vez: insistir es de vendedor, no de conserje. */
    setTimeout(() => {
      if (!Asesor.abierto && !Asesor.saludado) $('#asesor-punto').classList.add('on');
    }, 25000);
  };

  /* Una ruta sin figura (catálogo, legal, contacto) no debe hacer esperar al
     visitante por una pieza que no va a ver: entra ya, y las figuras se
     muestrean en segundo plano para cuando navegue al resto del sitio. */
  if (!R.fig) { listo(); return; }

  VQ.escena.primeraFigura(primera, function (p) {
    preFill.style.width = (p * 94) + '%';
    preMark.style.setProperty('--reveal', (100 - p * 100).toFixed(1) + '%');
    const f = FASES.filter(x => p >= x[0]).pop();
    if (f) preTxt.textContent = f[1];
  }, listo);
}

/* Los módulos son diferidos: cuando este se evalúa el DOM ya está parseado y
   la rama de 'loading' no llega a darse. Se deja por si alguien vuelve a
   cargar el archivo como script clásico. */
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', arrancar);
else arrancar();
