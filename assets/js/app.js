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
import './escena.js?v=74';

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
  whatsapp: '527717959131',
  correo: 'ventas@valquiriadental.com',
  /* ⚠️ ESPEJO DEL SERVIDOR. Estos tres valores existen también en
     quote-engine.js y envios.js, que son los que MANDAN: el servidor
     recalcula todo antes de cobrar. Aquí solo se usan para pintar el carrito
     antes de que responda el backend.
     Si cambias ENVIO_GRATIS_DESDE_CENTAVOS en Render, cambia también esta
     línea — hay una prueba (`npm test`) que falla si se desincronizan. */
  envioGratisDesde: 99900,   // centavos
  costoEnvio: 15000,         // centavos
  /* Debe coincidir con PRECIOS_LLEVAN_IVA / IVA_TASA del servidor. Es una
     afirmación fiscal: si el régimen no traslada IVA, pon ivaIncluido:false. */
  ivaIncluido: true,
  ivaTasa: 16,
  timeoutMs: 42000
};

/* Parte de impuesto contenida en un importe que YA lo lleva dentro.
   No suma nada al total: lo separa para que se pueda leer. */
function ivaDe(centavosConIva){
  if (!CFG.ivaIncluido || !CFG.ivaTasa) return 0;
  const t = CFG.ivaTasa / 100;
  return Math.round(centavosConIva - centavosConIva / (1 + t));
}

/* ── Catálogo ─────────────────────────────────────────────────────────────
   Espejo de productos.json. Los precios se guardan en CENTAVOS ENTEROS, igual
   que en el servidor: con flotantes, 444.01 * 3 deja de coincidir con el total
   que cobra la pasarela, y ese descuadre se paga en soporte. */
const PRODUCTOS = [
  { sku:'ValEnd', nombre:'Dientes Valquiria para práctica de endodoncia',
    corto:'Nervio sintético líder en la industria, anatomía interna completa.',
    precio:40183, regular:63900, stock:27,
    img:'https://res.cloudinary.com/dyzgyuixk/image/upload/f_auto,q_auto/endo_ahtc7k',
    claves:['endodoncia','endo','endos','conducto','conductos','nervio','endodoncista','endodontico','endodonzia','practica endodoncia','kit endo','kit endodoncia','permanentes','instrumentacion','obturacion'] },
  { sku:'ValPulpo', nombre:'Dientes Valquiria para práctica de pulpotomía',
    corto:'Dientes infantiles con cámara y raíces simuladas, tamaño realista.',
    precio:44401, regular:53900, stock:23,
    img:'https://res.cloudinary.com/dyzgyuixk/image/upload/f_auto,q_auto/pulpo_frybuu',
    claves:['pulpotomia','pulpo','pulpos','pediatria','pediatrico','infantil','niño','niños','odontopediatria','kit pulpo','kit pulpotomia','deciduo','temporales','dientes de leche','pulpar'] },
  { sku:'DientesRealistas', nombre:'Kit de 32 dientes realistas',
    corto:'Arcada completa de adulto con nervio simulado y estuche protector.',
    precio:100711, regular:129900, stock:15,
    img:'https://res.cloudinary.com/dyzgyuixk/image/upload/f_auto,q_auto/realistas_dxfhrr',
    claves:['realista','realistas','kit realista','kit completo','completo','32 dientes','boca completa','arcada','incisivos','caninos','premolares','molares','ultra realista','ultrarealista','set completo','kit avanzado','estuche','dentadura','juego completo'] },
  { sku:'Endotnissin', nombre:'Dientes tipo Nissin para endodoncia',
    corto:'Compatibles con tipodonto Nissin, con el nervio sintético Valquiria.',
    precio:71958, regular:99000, stock:10,
    img:'https://res.cloudinary.com/dyzgyuixk/image/upload/f_auto,q_auto/endonissin_b0hlmi',
    claves:['nissin','nisin','nisiin','nicin','nissim','nissan','nissn','tipodonto','typodont','tipo nissin','compatible nissin','kit nissin','simulador','fantoma','maniqui'] }
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

/* "a", "a y b", "a, b y c" — la coma de más delata al programa. */
const unir = xs => xs.length <= 1 ? (xs[0] || '')
  : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1];

/* Lo que hay en el carrito, en prosa. Cuando el asesor local quita algo, el
   cliente necesita ver con qué se queda sin abrir el cajón. */
const resumenCarrito = () => unir(
  [...Carrito.items].map(([sku, n]) => {
    const p = porSku(sku);
    return n + ' × ' + (p ? p.nombre : sku);
  })
) || 'nada';

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

/* ════════════════════════════════════════════════════════════════════════════
   MEMORIA DE LA VISITA
   ───────────────────────────────────────────────────────────────────────────────
   Mercado Pago no abre una pestaña nueva: se lleva la que hay. Cuando el
   cliente vuelve, este documento se cargó otra vez desde cero y todo lo que
   vivía en RAM —el hilo del Asesor, sobre todo— ya no existe. El síntoma era
   un Asesor con amnesia ofreciendo el catálogo genérico a alguien que
   acababa de mandar a pagar dos kits de endodoncia.

   El carrito ya vivía en localStorage. Aquí se le añade lo que faltaba:
     · el hilo de la conversación (sessionStorage: dura lo que la pestaña,
       que es exactamente lo que dura una compra),
     · los datos de entrega ya tecleados (localStorage: quien vuelve la
       semana que viene no tiene por qué volver a escribir su dirección),
     · la señal de que se fue a pagar y hay que recibirlo de vuelta.

   Nada de esto guarda tokens, llaves ni nada que sirva fuera de este
   navegador. Si el almacenamiento está bloqueado —modo privado de iOS con
   el disco lleno— todo sigue funcionando en memoria: se pierde el rescate,
   no la tienda.
   ═════════════════════════════════════════════════════════════════════════════ */
const Memoria = {
  escribir(llave, valor, persistente) {
    try {
      (persistente ? localStorage : sessionStorage).setItem(llave, JSON.stringify(valor));
      return true;
    } catch { return false; }
  },
  leer(llave, persistente) {
    try {
      const raw = (persistente ? localStorage : sessionStorage).getItem(llave);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  borrar(llave, persistente) {
    try { (persistente ? localStorage : sessionStorage).removeItem(llave); } catch {}
  }
};

/* ── Envío cotizado ─────────────────────────────────────────────────────
   La última cotización de envío que dio el SERVIDOR, para que el desglose del
   Asesor y el del carrito digan el mismo número. Caduca a las seis horas: una
   tarifa de anteayer es peor que no tener tarifa, porque se dice con la misma
   seguridad. */
const Envio = {
  LLAVE: 'vq_envio_v1',
  VIDA_MS: 6 * 60 * 60 * 1000,
  dato: null,

  cargar() {
    const d = Memoria.leer(this.LLAVE, true);
    if (d && /^\d{5}$/.test(String(d.cp || '')) && Number.isInteger(d.costo_centavos)) {
      this.dato = d;
    }
  },

  recordar(d) {
    this.dato = { ...d, cuando: Date.now() };
    Memoria.escribir(this.LLAVE, this.dato, true);
  },

  /* La cotización solo vale para el código postal con el que se pidió. */
  vigente() {
    const d = this.dato;
    if (!d) return null;
    if (Date.now() - (d.cuando || 0) > this.VIDA_MS) return null;
    if (Comprador.datos.cp && Comprador.datos.cp !== d.cp) return null;
    return d;
  },

  olvidar() { this.dato = null; Memoria.borrar(this.LLAVE, true); }
};

/* Cotiza el envío contra el SERVIDOR y lo recuerda. El costo y la fecha los
   decide envios.js —el mismo motor que usa el Asesor—: aquí solo se guarda lo
   que respondió. Devuelve la opción recomendada, o null si no se pudo. */
async function cotizarEnvio(cp) {
  if (!/^\d{5}$/.test(String(cp || ''))) return null;
  /* Reloj corto y propio. El backend duerme en el plan gratuito de Render y
     tarda ~50 s en levantar: esperarlo con los tres puntitos puestos convierte
     «te digo cuánto cuesta el envío» en un minuto de pantalla muerta a mitad
     del checkout. Doce segundos y se sigue con la tarifa estimada, que es lo
     que el carrito ya enseñaba. */
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(CFG.backend + '/api/envio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cp_destino: String(cp), items: Carrito.lista() }),
      signal: ctrl.signal
    });
    const d = await r.json();
    if (!r.ok || !d.ok || !Array.isArray(d.opciones) || !d.opciones.length) return null;
    const rec = d.opciones.find(o => o.recomendada) || d.opciones[0];
    Envio.recordar({
      cp: (d.destino && d.destino.cp) ? String(d.destino.cp) : String(cp),
      costo_centavos: rec.costo_centavos,
      gratis: !!rec.envio_gratis,
      servicio: rec.servicio || '',
      texto: rec.texto || '',
      destino: (d.destino && d.destino.estado) || ''
    });
    return rec;
  } catch { return null; }
  finally { clearTimeout(reloj); }
}

/* ════════════════════════════════════════════════════════════════════════════
   COMPRADOR — a quién hay que escribirle
   ───────────────────────────────────────────────────────────────────────────────
   El hueco más caro que tenía la tienda: se podía generar un link de pago sin
   pedir un solo dato de contacto. Si el pago se queda a medias —y una parte
   siempre se queda a medias— no hay a quién escribirle. El pedido existe,
   el dinero no llegó, y nadie sabe de quién era.

   Estos cinco campos son el mínimo para poder ENVIAR y para poder RESCATAR.
   Se piden en el chat, uno detrás de otro y con lo que ya se sabe relleno:
   un formulario de doce campos delante de alguien que ya decidió comprar es
   la forma más cara de perder una venta.
   ═════════════════════════════════════════════════════════════════════════════ */
const CAMPOS_COMPRADOR = [
  { id:'nombre', rotulo:'Nombre completo', tipo:'text', modo:'text',
    auto:'name', ph:'Nombre y apellido' },
  { id:'whatsapp', rotulo:'WhatsApp', tipo:'tel', modo:'numeric',
    auto:'tel-national', ph:'10 dígitos con lada' },
  { id:'email', rotulo:'Correo', tipo:'email', modo:'email',
    auto:'email', ph:'donde te llega el comprobante' },
  { id:'cp', rotulo:'Código postal', tipo:'text', modo:'numeric',
    auto:'postal-code', ph:'5 dígitos' },
  { id:'direccion', rotulo:'Calle y número, colonia y ciudad', tipo:'text', modo:'text',
    auto:'street-address', ph:'Av. Juárez 120, Centro, Pachuca' },
  { id:'referencias', rotulo:'Referencias de entrega', tipo:'text', modo:'text',
    auto:'off', ph:'opcional — portón negro, entre dos farmacias', opcional:true }
];

const Comprador = {
  LLAVE: 'vq_comprador_v1',
  datos: { nombre:'', whatsapp:'', email:'', cp:'', direccion:'', referencias:'' },

  cargar() {
    const d = Memoria.leer(this.LLAVE, true);
    if (!d || typeof d !== 'object') return;
    CAMPOS_COMPRADOR.forEach(c => {
      const r = this.revisar(c.id, d[c.id]);
      if (r.ok && r.valor) this.datos[c.id] = r.valor;
    });
    /* El código postal ya se guardaba por su cuenta para el calculador del
       carrito. Si el comprador todavía no tiene, se hereda: teclearlo dos
       veces en la misma visita es justo lo que hay que evitar. */
    if (!this.datos.cp) {
      try {
        const cp = localStorage.getItem(CP_GUARDADO);
        if (/^\d{5}$/.test(String(cp || ''))) this.datos.cp = cp;
      } catch {}
    }
  },

  guardar() { Memoria.escribir(this.LLAVE, this.datos, true); },

  /* Normaliza y valida UN campo. Devuelve { ok, valor, error }. Es la única
     puerta por la que estos datos entran: lo que sale de aquí ya viaja al
     servidor y de ahí al aviso de Telegram. */
  revisar(id, bruto) {
    const v = String(bruto == null ? '' : bruto)
      .replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();

    if (id === 'referencias') return { ok:true, valor: v.slice(0, 140) };

    if (!v) return { ok:false, valor:'', error:'Este dato me hace falta.' };

    if (id === 'nombre') {
      if (v.length < 3 || !/[a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]/i.test(v)) {
        return { ok:false, valor:'', error:'Escribe tu nombre completo.' };
      }
      return { ok:true, valor: v.slice(0, 80) };
    }

    if (id === 'whatsapp') {
      /* Mexico: diez dígitos. Se aceptan tal cual, con 52 delante, con el 1
         viejo de WhatsApp o con espacios y paréntesis, y se guardan SIEMPRE
         como 52 + diez dígitos, que es como hay que marcarlos desde fuera. */
      let n = v.replace(/\D/g, '');
      if (n.length === 13 && n.startsWith('521')) n = n.slice(3);
      else if (n.length === 12 && n.startsWith('52')) n = n.slice(2);
      else if (n.length === 11 && n.startsWith('1')) n = n.slice(1);
      if (n.length !== 10) {
        return { ok:false, valor:'', error:'Necesito los 10 dígitos, con lada.' };
      }
      return { ok:true, valor:'52' + n };
    }

    if (id === 'email') {
      const e = v.toLowerCase().slice(0, 160);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) {
        return { ok:false, valor:'', error:'Ese correo no tiene forma de correo.' };
      }
      return { ok:true, valor:e };
    }

    if (id === 'cp') {
      const cp = v.replace(/\D/g, '');
      if (!/^\d{5}$/.test(cp)) {
        return { ok:false, valor:'', error:'Son 5 dígitos.' };
      }
      return { ok:true, valor:cp };
    }

    if (id === 'direccion') {
      /* Un número exterior no es un capricho: sin él la guía no se puede
         imprimir y el paquete vuelve. */
      if (v.length < 10 || !/\d/.test(v)) {
        return { ok:false, valor:'',
          error:'Falta calle CON número, colonia y ciudad.' };
      }
      return { ok:true, valor: v.slice(0, 180) };
    }

    return { ok:true, valor: v.slice(0, 180) };
  },

  fijar(id, bruto) {
    const r = this.revisar(id, bruto);
    if (r.ok) { this.datos[id] = r.valor; this.guardar(); }
    return r;
  },

  /* Qué falta para poder cobrar. El orden es el orden en que se pregunta. */
  faltantes() {
    return CAMPOS_COMPRADOR
      .filter(c => !c.opcional && !this.revisar(c.id, this.datos[c.id]).ok)
      .map(c => c.id);
  },

  completo() { return this.faltantes().length === 0; },

  telefonoBonito() {
    const n = String(this.datos.whatsapp || '').replace(/^52/, '');
    return n.length === 10 ? n.slice(0, 3) + ' ' + n.slice(3, 6) + ' ' + n.slice(6) : n;
  },

  /* Lo que viaja al servidor. Nada más: ni el historial ni el carrito, que
     el servidor recalcula por su cuenta. */
  paraServidor() {
    const d = this.datos;
    return {
      nombre: d.nombre,
      whatsapp: d.whatsapp,
      email: d.email,
      cp: d.cp,
      direccion: d.direccion,
      referencias: d.referencias || ''
    };
  }
};

/* ── Desglose del pedido ──────────────────────────────────────────────
   Lo que el Asesor tiene que saber decir SIEMPRE, con backend o sin él. Un
   asesor que no sabe recitar el pedido que acaba de armar no es un asesor:
   es un buscador con burbujas. */
function desglosePedido() {
  const t = Carrito.totales();
  if (!t.lineas.length) return '';

  const e = Envio.vigente();
  const envio = t.gratis ? 0 : (e ? e.costo_centavos : t.envio);
  const total = t.subtotal + envio;

  let txt = t.lineas
    .map(l => '• **' + l.cantidad + ' × ' + l.p.nombre + '** — ' + mxn(l.linea))
    .join('\n');

  const cp = Comprador.datos.cp;
  txt += '\n\nSubtotal: **' + mxn(t.subtotal) + '**';
  if (t.gratis) txt += '\nEnvío: **gratis**';
  else if (e) {
    txt += '\nEnvío a CP ' + e.cp + ': **' + mxn(envio) + '**' +
           (e.texto ? ' · ' + e.texto : '');
  } else {
    /* Tarifa de referencia, y se dice que lo es. Prometer un número que luego
       cambia cuesta más caro que no darlo. */
    txt += '\nEnvío estimado' + (cp ? ' a CP ' + cp : '') + ': **' + mxn(envio) + '**';
  }
  txt += '\nTotal: **' + mxn(total) + '**';
  if (CFG.ivaIncluido) txt += '\nIVA ' + CFG.ivaTasa + '% incluido: ' + mxn(ivaDe(total));
  if (!t.gratis && !e) {
    txt += cp
      ? '\n\nEs tarifa de referencia; la fecha y el costo en firme salen al preparar tu guía.'
      : '\n\nDime tu **código postal** y te doy el costo y la fecha exactos.';
  }
  return txt;
}

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
    <div class="tot-l"><span>Envío</span><span id="env-costo">${t.gratis ? 'Gratis' : mxn(t.envio)}</span></div>
    ${t.gratis ? '' : `<div class="tot-envio">Te faltan ${mxn(t.falta)} para envío gratis</div>`}
    <div class="tot-l grande"><span>Total</span><span id="env-total">${mxn(t.total)}</span></div>
    ${CFG.ivaIncluido ? `<div class="tot-iva" id="tot-iva">IVA ${CFG.ivaTasa}% incluido: ${mxn(ivaDe(t.total))}</div>` : ''}

    <!-- Calculador de envío. Va ANTES del botón de pagar a propósito: la
         pregunta "¿cuándo me llega?" se resuelve mientras el cliente todavía
         está decidiendo, no después de haberle pedido la tarjeta. -->
    <div class="env-caja">
      <label class="env-lab" for="env-cp">¿Cuándo me llega?</label>
      <div class="env-fila">
        <input id="env-cp" type="text" inputmode="numeric" autocomplete="postal-code"
               maxlength="5" placeholder="Tu código postal" aria-label="Código postal">
        <button type="button" id="env-calc">Calcular</button>
      </div>
      <div id="env-res" class="env-res" role="status" aria-live="polite"></div>
    </div>

    <button class="btn" id="ir-pagar"><span>Pagar con Mercado Pago</span></button>
    <a class="btn ghost" id="ir-wa" href="#"><span>Cerrar por WhatsApp</span></a>
    <p class="pie-nota">
      Al continuar aceptas los <a href="#/terminos" data-cierra-drawer>términos de uso</a>.
      Pago procesado por Mercado Pago.
    </p>`;

  montarCalculadorEnvio();
}

/* ── Calculador de envío ──────────────────────────────────────────────────
   El costo y la fecha los calcula el SERVIDOR, igual que los precios: aquí
   solo se pinta lo que respondió. El código postal se recuerda entre visitas
   porque nadie quiere teclearlo dos veces, y no identifica a nadie. */
const CP_GUARDADO = 'vq_cp';

function montarCalculadorEnvio() {
  const campo = $('#env-cp'), boton = $('#env-calc'), salida = $('#env-res');
  if (!campo || !boton) return;

  try {
    const guardado = localStorage.getItem(CP_GUARDADO);
    if (guardado) { campo.value = guardado; calcularEnvio(); }
  } catch { /* modo privado */ }

  campo.addEventListener('input', () => {
    campo.value = campo.value.replace(/[^0-9]/g, '').slice(0, 5);
  });
  campo.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); calcularEnvio(); } });
  boton.addEventListener('click', calcularEnvio);

  async function calcularEnvio() {
    const cp = campo.value.trim();
    if (cp.length !== 5) {
      salida.innerHTML = '<span class="env-mal">Escribe los 5 dígitos de tu código postal.</span>';
      return;
    }
    salida.textContent = 'Calculando…';
    boton.disabled = true;
    try {
      const r = await fetch(CFG.backend + '/api/envio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cp_destino: cp,
          items: Carrito.totales().lineas.map(l => ({ sku: l.p.sku, cantidad: l.cantidad }))
        })
      });
      const d = await r.json();
      if (!d.ok) {
        salida.innerHTML = `<span class="env-mal">${esc(d.error || 'No se pudo calcular el envío.')}</span>`;
        return;
      }
      try { localStorage.setItem(CP_GUARDADO, cp); } catch {}

      salida.innerHTML =
        `<div class="env-dest">${esc(d.destino.estado)} · CP ${esc(d.destino.cp)}</div>` +
        d.opciones.map(o => `
          <div class="env-op${o.recomendada ? ' rec' : ''}">
            <div class="env-op-l">
              <b>${esc(o.servicio)}</b>
              <span>${esc(o.texto)}</span>
            </div>
            <span class="env-op-p">${esc(o.costo)}</span>
          </div>`).join('') +
        /* Si el número es de la tabla interna y no de una paquetería, se dice.
           Prometer una tarifa que luego cambia cuesta más que no darla. */
        (d.es_estimacion
          ? '<p class="env-nota">Tarifas estimadas. La guía definitiva se confirma al preparar tu envío.</p>'
          : `<p class="env-nota">Cotización en vivo vía ${esc(d.fuente)}.</p>`);

      /* El total del carrito se actualiza con la opción recomendada, que es
         la más barata. Enseñar un total que ignora el envío ya calculado es
         la forma más rápida de que alguien abandone en el checkout. */
      const rec = d.opciones.find(o => o.recomendada);
      if (rec) {
        /* Se recuerda para que el Asesor desglose el MISMO número. Que el
           chat diga $150 y el carrito $170 es la forma más barata de que
           alguien deje de creerse los dos. */
        Envio.recordar({
          cp: d.destino && d.destino.cp ? String(d.destino.cp) : cp,
          costo_centavos: rec.costo_centavos,
          gratis: !!rec.envio_gratis,
          servicio: rec.servicio || '',
          texto: rec.texto || ''
        });
        if (!Comprador.datos.cp) Comprador.fijar('cp', cp);
        const costo = $('#env-costo'), total = $('#env-total');
        if (costo) costo.textContent = rec.envio_gratis ? 'Gratis' : rec.costo;
        const totalCentavos = Carrito.totales().subtotal + rec.costo_centavos;
        if (total) total.textContent = mxn(totalCentavos);
        /* El IVA se recalcula con el total nuevo: dejarlo con el importe
           anterior es peor que no enseñarlo. */
        const iva = $('#tot-iva');
        if (iva) iva.textContent = `IVA ${CFG.ivaTasa}% incluido: ${mxn(ivaDe(totalCentavos))}`;
      }
    } catch {
      salida.innerHTML = '<span class="env-mal">No se pudo consultar el envío. Intenta de nuevo.</span>';
    } finally {
      boton.disabled = false;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   BLOQUEO DE SCROLL
   ───────────────────────────────────────────────────────────────────────────
   Tres paneles pueden tapar la página —el carrito, el menú de móvil y el
   Asesor— y cualquiera de ellos necesita que el fondo deje de moverse. Antes
   cada uno escribía `body.style.overflow` por su cuenta y el que cerraba
   primero desbloqueaba a los demás; había un `if` suelto comprobando el
   carrito, que es justo el parche que deja de funcionar al aparecer el tercer
   panel. Aquí el bloqueo se pide y se suelta por NOMBRE, y solo se levanta
   cuando no queda nadie pidiéndolo.

   Lo que resuelve el `--sb`: en Windows la barra de scroll ocupa ancho real,
   así que al ocultarla el viewport se ENSANCHA ~15px de golpe. Todo lo que
   esté anclado a la derecha —el nav fijo, el botón del Asesor, el toast— da
   un salto lateral, y eso es lo que se veía «raro». La anchura no se adivina
   ni se codifica: se mide el clientWidth ANTES y DESPUÉS de bloquear, y la
   diferencia es exactamente lo que hay que devolver. Medido así da 0 solo
   cuando de verdad no hay salto —en móvil, con barras superpuestas, o si el
   navegador ya reserva el hueco con scrollbar-gutter— y entonces no se toca
   nada.
   ═══════════════════════════════════════════════════════════════════════════ */
const BloqueoScroll = {
  duenos: new Set(),

  pedir(quien) {
    if (this.duenos.has(quien)) return;
    const primero = this.duenos.size === 0;
    this.duenos.add(quien);
    if (!primero) return;

    const antes = document.documentElement.clientWidth;
    document.body.classList.add('sin-scroll');
    const salto = document.documentElement.clientWidth - antes;
    if (salto > 0) {
      document.documentElement.style.setProperty('--sb', salto + 'px');
    }
    document.addEventListener('touchmove', this.guardiaTactil, { passive: false });
  },

  soltar(quien) {
    if (!this.duenos.delete(quien) || this.duenos.size) return;
    document.body.classList.remove('sin-scroll');
    document.documentElement.style.removeProperty('--sb');
    document.removeEventListener('touchmove', this.guardiaTactil, { passive: false });
  },

  /* iOS ignora `overflow:hidden` en el body: el dedo sigue arrastrando la
     página por debajo del panel —el «rubber band»— y al soltar la sección
     que había detrás quedó en otro sitio. La única defensa es cancelar el
     gesto, pero cancelarlo TODO dejaría el hilo del chat y la lista del
     carrito igual de muertos. Así que se cancela solo lo que no ocurre
     dentro de una zona con scroll propio que además pueda moverse: si la
     zona ya está tocando su tope y el dedo insiste en esa dirección, el
     desplazamiento se lo comería la página, y ahí también se corta. */
  guardiaTactil(e) {
    if (e.touches.length > 1) return;              // pellizco para zoom: es del usuario
    const zona = e.target.closest && e.target.closest('[data-scrollable]');
    if (!zona) { e.preventDefault(); return; }
    const alto = zona.scrollHeight - zona.clientHeight;
    if (alto <= 0) { e.preventDefault(); return; }
    const y = e.touches[0].clientY;
    const dy = y - (zona._ultimoY == null ? y : zona._ultimoY);
    zona._ultimoY = y;
    const arriba = zona.scrollTop <= 0 && dy > 0;
    const abajo = zona.scrollTop >= alto - 1 && dy < 0;
    if (arriba || abajo) e.preventDefault();
  }
};

/* Al empezar a tocar se reinicia la referencia vertical de la zona: sin esto,
   el primer movimiento de un gesto nuevo se compara contra el último del
   gesto anterior y da una dirección falsa. */
addEventListener('touchstart', e => {
  const zona = e.target.closest && e.target.closest('[data-scrollable]');
  if (zona) zona._ultimoY = e.touches[0].clientY;
}, { passive: true });

/* ═══════════════════════════════════════════════════════════════════════════
   VIEWPORT VISUAL — el teclado del móvil
   ───────────────────────────────────────────────────────────────────────────
   En un teléfono hay DOS viewports y esa es la raíz de todo el problema. El
   de layout (`innerHeight`, y también `svh`/`vh`) no se entera de que el
   teclado subió: sigue midiendo la pantalla entera. El visual —el trozo que
   el usuario ve de verdad— sí se encoge. Un panel dimensionado con `svh`, o
   pegado con `bottom:0`, se queda con su mitad inferior debajo del teclado, y
   el campo de escribir es justo lo que desaparece.

   `visualViewport` es la única fuente que sabe la verdad. De ahí salen dos
   medidas que el CSS consume como variables:

     --vvh  alto realmente visible.
     --kb   cuánto teclado hay tapando por abajo. Es la resta entre el fondo
            del viewport de layout y el fondo del visual; en iOS hay que
            sumar `offsetTop` porque al enfocar un campo el sistema además
            DESPLAZA la página hacia arriba, y sin ese término el panel se va
            medio teclado de más.

   Se escriben en el <html> y no en el panel para que cualquier pieza futura
   —un modal, una hoja de filtros— pueda usarlas sin repetir esta lógica.
   ═══════════════════════════════════════════════════════════════════════════ */
const Viewport = {
  vv: window.visualViewport || null,
  UMBRAL_TECLADO: 90,   // por debajo de esto es la barra del navegador, no un teclado

  /* «Hoja» = el Asesor ocupa el ancho completo pegado abajo. El número tiene
     que ser el MISMO que el de la media query del CSS: si se separan, el JS
     bloquea el scroll en un layout que no lo necesita, o al revés. */
  esHoja: () => matchMedia('(max-width:520px)').matches,

  iniciar() {
    this.medir();
    if (this.vv) {
      /* `resize` cubre el teclado; `scroll` cubre el desplazamiento que iOS
         hace al enfocar, que no dispara resize. */
      this.vv.addEventListener('resize', () => this.medir());
      this.vv.addEventListener('scroll', () => this.medir());
    }
    addEventListener('orientationchange', () => setTimeout(() => this.medir(), 120));
    addEventListener('resize', () => { this.medir(); this.sincronizarBloqueo(); });
  },

  medir() {
    const raiz = document.documentElement;
    if (!this.vv) { raiz.style.setProperty('--vvh', innerHeight + 'px'); return; }

    const alto = this.vv.height;
    const teclado = Math.max(0, innerHeight - (alto + this.vv.offsetTop));

    const hayTeclado = teclado > this.UMBRAL_TECLADO;
    raiz.style.setProperty('--vvh', Math.round(alto) + 'px');
    raiz.style.setProperty('--kb', Math.round(hayTeclado ? teclado : 0) + 'px');
    document.body.classList.toggle('teclado', hayTeclado);

    /* El panel acaba de encogerse para dejarle sitio al teclado, así que el
       final del hilo quedó fuera de cuadro. Se vuelve a bajar aquí —y no solo
       al enfocar— porque el teclado también aparece y desaparece por cuenta
       propia: al girar el teléfono, o con el autocompletado del sistema. */
    if (hayTeclado && Asesor.abierto) Asesor.fin();
  },

  /* El Asesor tapa la pantalla entera solo en modo hoja. En escritorio es un
     panel de esquina y congelar la página detrás sería un estorbo, no una
     mejora — por eso el bloqueo se pide según el layout y se revisa cuando la
     ventana cambia de tamaño o gira. */
  sincronizarBloqueo() {
    if (Asesor.abierto && this.esHoja()) BloqueoScroll.pedir('asesor');
    else BloqueoScroll.soltar('asesor');
  }
};

function abrirDrawer(v) {
  $('#drawer').classList.toggle('on', v);
  $('#velo').classList.toggle('on', v);
  $('#drawer').setAttribute('aria-hidden', v ? 'false' : 'true');
  v ? BloqueoScroll.pedir('drawer') : BloqueoScroll.soltar('drawer');
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
  /* Los datos de entrega ya tecleados viajan con el pedido: del otro lado se
     responde, no se vuelve a preguntar lo que el cliente ya escribió. */
  const d = Comprador.datos;
  const entrega = [
    d.nombre ? `Nombre: ${d.nombre}` : '',
    d.cp ? `CP: ${d.cp}` : '',
    d.direccion ? `Dirección: ${d.direccion}` : ''
  ].filter(Boolean).join('\n');

  return 'Hola Valquiria, quiero confirmar este pedido:\n\n' + l +
    `\n\nSubtotal: ${mxn(t.subtotal)}` +
    `\nEnvío: ${t.gratis ? 'gratis' : mxn(t.envio)}` +
    `\nTotal: ${mxn(t.total)}` +
    (entrega ? `\n\n${entrega}` : '') +
    `\n\nFolio: ${f}`;
}

const urlWhatsApp = txt => `https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent(txt)}`;

/* ── Checkout ─────────────────────────────────────────────────────────────
   Al servidor se le mandan SKUs y cantidades, nunca precios: los importes se
   recalculan allá contra el catálogo. Un carrito manipulado desde la consola
   no puede cambiar lo que se cobra. */
/* El viaje a Mercado Pago se hace en la MISMA pestaña, a propósito. Abrir
   una segunda con `window.open` parece más amable y en un iPhone es lo
   contrario: o la bloquea el navegador —porque la llamada llega después de
   un `await` y ya no cuenta como gesto del usuario— o deja al comprador con
   dos pestañas y sin saber en cuál está su pedido. Ir en la misma solo es
   seguro si el estado está escrito ANTES de saltar, y eso es justo lo que
   hace `guardarAntesDeSaltar`. */
const PAGO_EN_CURSO = 'vq_pago_en_curso';

function guardarAntesDeSaltar(datos) {
  Asesor.recordar();
  Comprador.guardar();
  Carrito.guardar();
  Memoria.escribir(PAGO_EN_CURSO, { ...datos, cuando: Date.now() });
}

async function irAPagar(boton) {
  const t = Carrito.totales();
  if (!t.lineas.length) return;

  /* SIN CONTACTO NO HAY LINK. Es la regla que le faltaba a la tienda: un
     pago que se queda a medias sin nombre ni WhatsApp es un pedido del que
     no se puede rescatar nada. El servidor también lo exige —esta
     comprobación es por cortesía, no por seguridad—, pero pedirlo aquí
     evita el viaje y deja al Asesor haciendo la pregunta, que es su oficio. */
  const faltan = Comprador.faltantes();
  if (faltan.length) {
    abrirDrawer(false);
    Asesor.abrir();
    Asesor.pedirDatos(faltan);
    return;
  }

  const original = boton ? boton.innerHTML : '';
  if (boton) { boton.innerHTML = '<span>Generando link…</span>'; boton.disabled = true; }

  try {
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), CFG.timeoutMs);
    const r = await fetch(CFG.backend + '/api/pago', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: Carrito.lista(),
        comprador: Comprador.paraServidor()
      }), signal: ctrl.signal
    });
    clearTimeout(reloj);
    const data = await r.json();

    /* El servidor dice QUÉ dato le falta. Se convierte en la siguiente
       pregunta del Asesor, no en un error rojo sin salida. */
    if (r.status === 400 && Array.isArray(data.faltan) && data.faltan.length) {
      if (boton) { boton.innerHTML = original; boton.disabled = false; }
      abrirDrawer(false);
      Asesor.abrir();
      Asesor.pedirDatos(data.faltan.filter(id => CAMPOS_COMPRADOR.some(c => c.id === id)));
      return;
    }

    if (!r.ok || !data.url) throw new Error(data.error || 'Sin link de pago');

    guardarAntesDeSaltar({
      folio: data.folio || '',
      total: data.total || '',
      items: Carrito.lista()
    });
    location.href = data.url;
  } catch (e) {
    if (boton) { boton.innerHTML = original; boton.disabled = false; }
    /* Sin popup automático: se ofrece el botón y lo toca quien quiera. Un
       `window.open` disparado por código después de una espera es
       exactamente lo que Safari bloquea. */
    abrirDrawer(false);
    Asesor.abrir();
    Asesor.burbuja('bot', md(
      'No pude generar el link de pago en este momento. Tu pedido **no se ha ' +
      'perdido**: sigue aquí.\n\n' + desglosePedido() +
      '\n\nPuedo pasártelo por WhatsApp y lo cerramos con una persona.'));
    Asesor.acciones([
      { tipo:'whatsapp', rotulo:'Cerrar por WhatsApp', texto: textoPedido(folio()) },
      { tipo:'pago' }
    ]);
    Asesor.recordar();
  }
}

/* ── La vuelta de Mercado Pago ─────────────────────────────────────────────
   El momento más frágil de la compra: el cliente vuelve de un dominio ajeno
   a un documento recién cargado. Aquí se decide qué se le dice y —solo si el
   pago se aprobó— cuándo se le vacía el carrito: DESPUÉS de enseñarle qué
   compró, nunca antes. */
function estadoDelPago() {
  const p = parametrosVisita();
  const propio = (p.get('estado') || '').toLowerCase();
  const mp = (p.get('collection_status') || p.get('status') ||
              p.get('payment_status') || '').toLowerCase();

  if (mp === 'approved' || propio === 'aprobado') return 'aprobado';
  if (mp === 'rejected' || mp === 'cancelled' || mp === 'failure' || propio === 'fallo') return 'fallo';
  if (mp === 'pending' || mp === 'in_process' || mp === 'in_mediation' || propio === 'pendiente') return 'pendiente';
  return 'desconocido';
}

let graciasAtendido = false;

async function recibirDePago() {
  if (graciasAtendido) return;
  graciasAtendido = true;

  const p = parametrosVisita();
  const enCurso = Memoria.leer(PAGO_EN_CURSO);
  const folioPedido = p.get('external_reference') || (enCurso && enCurso.folio) || '';
  let estado = estadoDelPago();

  /* Si nadie dijo cómo fue, se le pregunta al servidor por el folio: el
     webhook firmado es quien sabe la verdad, el navegador solo trae pistas. */
  if (estado === 'desconocido' && folioPedido) {
    try {
      const r = await fetch(CFG.backend + '/api/pedido/' + encodeURIComponent(folioPedido));
      const d = await r.json();
      if (r.ok && d.estado === 'approved') estado = 'aprobado';
      else if (r.ok && (d.estado === 'rejected' || d.estado === 'cancelled')) estado = 'fallo';
      else if (r.ok) estado = 'pendiente';
    } catch { /* el backend duerme: se trata como pendiente */ }
  }
  if (estado === 'desconocido') {
    /* Nadie viene de pagar: alguien abrió /gracias a pelo, o llegó por un
       enlace viejo. Aquí NO se dice nada — afirmar «pago confirmado» a quien
       no ha pagado es la peor cosa que puede decir una tienda, y la que más
       tarda en descubrirse porque suena bien. */
    if (!enCurso && !folioPedido) return;
    estado = 'pendiente';
  }

  const desglose = desglosePedido();
  const ROTULO = {
    aprobado: 'Pago confirmado',
    pendiente: 'Pago en proceso',
    fallo: 'El pago no se completó'
  };

  /* La vista de gracias cuenta lo mismo que el Asesor: quien cerró el panel
     tiene derecho a ver su folio sin volver a abrirlo. */
  const slot = $('#gracias-estado');
  if (slot) {
    slot.innerHTML =
      '<div class="gr-estado gr-' + estado + '">' +
        '<span class="mono">' + esc(ROTULO[estado]) + '</span>' +
        (folioPedido ? '<b>Folio ' + esc(folioPedido) + '</b>' : '') +
      '</div>' +
      (desglose ? '<div class="gr-desglose">' + md(desglose) + '</div>' : '');
  }

  /* El Asesor habla primero. Que el cliente vuelva a un chat mudo —o peor, a
     uno ofreciéndole el catálogo desde cero— es justo lo que había que matar. */
  const mensaje =
    estado === 'aprobado'
      ? '**Pago confirmado.**' + (folioPedido ? ' Tu folio es **' + folioPedido + '**.' : '') +
        (desglose ? '\n\nEsto es lo que compraste:\n\n' + desglose : '') +
        '\n\nTe llega el comprobante de Mercado Pago al correo y la guía en cuanto salga.'
    : estado === 'fallo'
      ? 'El pago no se completó, así que **aquí sigue tu pedido** tal como lo dejaste:' +
        (desglose ? '\n\n' + desglose : '') +
        '\n\nPodemos reintentar el link o cerrarlo por WhatsApp, como prefieras.'
      : 'Tu pago está **en proceso**' + (folioPedido ? ', folio **' + folioPedido + '**' : '') +
        '. En cuanto Mercado Pago lo confirme te avisamos.' +
        (desglose ? '\n\nAquí sigue tu pedido:\n\n' + desglose : '');

  Asesor.saludado = true;
  Asesor.burbuja('bot', md(mensaje));
  if (estado !== 'aprobado' && Carrito.piezas() > 0) {
    Asesor.acciones([{ tipo:'pago' }, { tipo:'whatsapp' }, { tipo:'carrito' }]);
  }
  Asesor.recordar();
  Asesor.abrir();

  Memoria.borrar(PAGO_EN_CURSO);

  /* Ahora sí. El carrito se vacía cuando el cliente YA vio qué compró, y solo
     con el pago aprobado: quien vuelve de un pago rechazado necesita su
     pedido intacto para reintentar. */
  if (estado === 'aprobado') { Carrito.vaciar(); Envio.olvidar(); }
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

/* El hash puede traer cola de parámetros. Mercado Pago devuelve al cliente
   con `?collection_status=approved&payment_id=…` pegado a la URL de retorno,
   y leyendo la ruta en crudo `/gracias?collection_status=approved` no
   coincidía con ninguna ruta conocida: el visitante que ACABABA DE PAGAR
   aterrizaba en el home, sin folio y sin confirmación. Se parte una sola vez
   y se usa en los dos sitios. */
function hashPartido() {
  const frag = (location.hash || '').replace(/^#/, '');
  const i = frag.indexOf('?');
  return {
    ruta: i === -1 ? frag : frag.slice(0, i),
    cola: i === -1 ? '' : frag.slice(i + 1)
  };
}

/* Todo lo que llegue por query —del hash o del path— en un solo sitio: la
   página puente /gracias/ pasa lo suyo por el hash, pero si algún día
   Mercado Pago lo deja en el path, se lee igual. */
function parametrosVisita() {
  const p = new URLSearchParams(location.search || '');
  new URLSearchParams(hashPartido().cola).forEach((v, k) => p.set(k, v));
  return p;
}

const rutaActual = () => {
  const fragmento = hashPartido().ruta;
  const anclasHome = {
    filosofia: '/filosofia', contacto: '/contacto',
    privacidad: '/privacidad', terminos: '/terminos'
  };
  if (anclasHome[fragmento]) return anclasHome[fragmento];
  const h = fragmento || '/';
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

  /* La vuelta de Mercado Pago. NO se vacía el carrito aquí: `recibirDePago`
     enseña primero qué se compró y solo entonces lo vacía, y únicamente si
     el pago salió aprobado. Vaciarlo de entrada dejaba a quien volvía de un
     pago RECHAZADO sin pedido y sin forma de reintentar. */
  if (clave === '/gracias') recibirDePago();

  cerrarMenu();
  if (!primera) window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
}

addEventListener('hashchange', () => navegar(false));

/* ── Menú móvil ──────────────────────────────────────────────────────────── */
function cerrarMenu() {
  $('#menu').classList.remove('on');
  $('#burger').classList.remove('on');
  $('#burger').setAttribute('aria-expanded', 'false');
  /* Ya no hace falta preguntar por el carrito: el bloqueo se levanta solo
     cuando lo suelta el último que lo pidió. */
  BloqueoScroll.soltar('menu');
}
$('#burger').addEventListener('click', () => {
  const abre = !$('#menu').classList.contains('on');
  $('#menu').classList.toggle('on', abre);
  $('#burger').classList.toggle('on', abre);
  $('#burger').setAttribute('aria-expanded', abre ? 'true' : 'false');
  abre ? BloqueoScroll.pedir('menu') : BloqueoScroll.soltar('menu');
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
/* ═══════════════════════════════════════════════════════════════════════════
   ACCIONES DEL ASESOR
   ───────────────────────────────────────────────────────────────────────────
   El backend no manipula la página: DESCRIBE lo que quiere que pase y aquí se
   decide si se hace. Esa dirección importa. La respuesta del chat viene de un
   modelo de lenguaje que a su vez está leyendo lo que escribió el visitante,
   así que tratarla como una orden directa sería dejar que un desconocido
   redirija el navegador o vacíe un carrito escribiendo la frase adecuada. Cada
   acción de aquí valida sus propios datos contra el catálogo y las rutas
   reales, y lo que no reconoce lo ignora sin ruido.

   Se dividen en dos familias que NO se mezclan:
     · las de EFECTO —estas— se ejecutan solas al llegar la respuesta;
     · las de BOTÓN (pago, whatsapp, carrito, ir) pintan un botón y esperan a
       que el visitante lo toque. Viven en `Asesor.acciones`.
   La frontera es deliberada: nada que cueste dinero o saque al visitante del
   sitio ocurre sin que él lo pida.
   ═══════════════════════════════════════════════════════════════════════════ */
const AccionesAsesor = {
  /* Normaliza [{sku,cantidad}] quedándose solo con SKUs que existen y
     cantidades sanas. Es la única puerta por la que el carrito recibe datos
     del servidor. */
  itemsValidos(items) {
    if (!Array.isArray(items)) return [];
    const out = [];
    items.slice(0, 20).forEach(it => {
      const p = porSku(it && it.sku);
      const n = parseInt(it && it.cantidad, 10);
      if (p && Number.isInteger(n) && n > 0) out.push({ sku: p.sku, cantidad: Math.min(n, 99) });
    });
    return out;
  },

  mapa: {
    /* ── Carrito ───────────────────────────────────────────────────────────
       Un solo verbo con tres modos, que es como lo razona el backend:
       `reemplazar` deja el carrito exactamente así, `sumar` acumula y
       `restar` descuenta. Sin modo se reemplaza, que es el caso de una
       cotización nueva. */
    actualizar_carrito(a) {
      const items = AccionesAsesor.itemsValidos(a.items);
      const modo = a.modo || a.accion || 'reemplazar';
      if (modo === 'sumar') items.forEach(i => Carrito.agregar(i.sku, i.cantidad));
      else if (modo === 'restar') {
        items.forEach(i => {
          const hay = Carrito.items.get(i.sku) || 0;
          if (hay > i.cantidad) Carrito.fijar(i.sku, hay - i.cantidad);
          else Carrito.quitar(i.sku);
        });
      } else Carrito.reemplazar(items);   // incluye la lista vacía = vaciar
    },

    /* ── Navegación ───────────────────────────────────────────────────────
       Solo rutas del propio router. Sin esta comprobación, un `ruta` con una
       URL externa convertiría al asesor en un redirector abierto. */
    navegar(a) {
      const r = String(a.ruta || a.vista || '');
      if (!RUTAS[r]) return;
      location.hash = '#' + r;
    },

    /* ── Resaltar un producto ─────────────────────────────────────────────
       Para «ese es el que te conviene»: lleva la tarjeta al centro y la
       marca un momento. Si la tarjeta no está en pantalla —porque la sección
       es otra— no se fuerza nada: la acción `navegar` es la que decide eso. */
    resaltar_producto(a) {
      const p = porSku(a.sku);
      if (!p) return;
      const carta = document.querySelector(`.card[data-sku="${CSS.escape(p.sku)}"]`);
      if (!carta) return;
      carta.scrollIntoView({ behavior: 'smooth', block: 'center' });
      carta.classList.remove('resaltado');
      /* Reiniciar la animación exige un reflujo entre quitar y poner: sin él
         el navegador funde los dos cambios en uno y no se reproduce nada
         cuando el asesor resalta dos veces la misma tarjeta. */
      void carta.offsetWidth;
      carta.classList.add('resaltado');
      setTimeout(() => carta.classList.remove('resaltado'), 2600);
    },

    /* ── Pago inmediato ───────────────────────────────────────────────────
       Salta el botón y genera el link. `irAPagar` ya se planta solo si el
       carrito está vacío, así que no puede cobrar la nada. */
    generar_pago_inmediato() { irAPagar(null); },

    /* ── Compatibilidad ───────────────────────────────────────────────────
       Los tres nombres de la versión anterior. El backend desplegado todavía
       manda `carrito_set` con cada cotización, así que quitarlos rompería el
       carrito el día del despliegue: se quedan hasta que el servidor hable
       solo el vocabulario nuevo. */
    carrito_set(a) { Carrito.reemplazar(AccionesAsesor.itemsValidos(a.items)); },
    carrito_add(a) {
      const [i] = AccionesAsesor.itemsValidos([{ sku: a.sku, cantidad: a.cantidad }]);
      if (i) Carrito.agregar(i.sku, i.cantidad);
    },
    abrir_carrito() { abrirDrawer(true); }
  },

  ejecutar(acciones) {
    if (!Array.isArray(acciones)) return;
    acciones.forEach(a => {
      const fn = a && this.mapa[a.tipo];
      if (!fn) return;   // los tipos de botón y los desconocidos no son de aquí
      try { fn(a); }
      catch (e) { console.warn('[asesor] acción "' + a.tipo + '" falló:', e.message); }
    });
  }
};

/* Se publica en el mismo espacio que `VQ.escena` para poder probar y depurar
   una acción sin tener que provocar la conversación entera que la dispara.
   No abre ninguna puerta nueva: quien ya puede ejecutar JavaScript en esta
   página puede tocar el carrito de todos modos, y los precios los decide el
   servidor, no el navegador. */
window.VQ = window.VQ || {};
window.VQ.acciones = AccionesAsesor;

const Asesor = {
  log: $('#asesor-log'),
  historial: [],
  ocupado: false,
  abierto: false,
  saludado: false,
  modoLocal: false,

  /* ── Memoria del hilo ───────────────────────────────────────────────────
     El historial vivía SOLO en RAM. Bastaba con recargar —o con irse a pagar,
     que es una recarga con otro dominio en medio— para que el Asesor olvidara
     que acababa de armar un pedido de dos kits de endodoncia y un pulpo.

     Se guarda en sessionStorage: dura lo que la pestaña, que es exactamente
     lo que dura una compra, y no deja rastro en el equipo de quien usa una
     computadora prestada. Solo texto: ni tokens, ni llaves, ni el carrito
     —ese ya tiene su propio cajón—.

     El tope es doble a propósito. Cuarenta turnos son los que manda el
     servidor; los 24 000 caracteres son los que el servidor RECORTA, así que
     guardar más es guardar algo que nunca se va a enviar. */
  LLAVE: 'vq_asesor_v1',
  MAX_TURNOS: 40,
  MAX_TEXTO: 24000,

  textoDe(m) {
    return ((m && m.parts) || []).map(x => (x && x.text) || '').join(' ');
  },

  /* Recorta por los DOS topes y devuelve lo que cabe, de lo más reciente
     hacia atrás. Cortar por el principio y no por el final no es un detalle:
     lo último dicho es lo que da contexto al siguiente mensaje. */
  hiloRecortado() {
    const salida = [];
    let chars = 0;
    for (let i = this.historial.length - 1; i >= 0; i--) {
      const m = this.historial[i];
      const n = this.textoDe(m).length;
      if (salida.length >= this.MAX_TURNOS || chars + n > this.MAX_TEXTO) break;
      chars += n;
      salida.unshift(m);
    }
    return salida;
  },

  recordar() {
    this.historial = this.hiloRecortado();
    Memoria.escribir(this.LLAVE, { v: 1, saludado: this.saludado, h: this.historial });
  },

  /* Repinta la conversación tal cual quedó. Las tarjetas de producto y los
     botones NO se reconstruyen: son acciones de un turno que ya pasó, y
     revivir un botón de pago viejo con un carrito nuevo sería mentir. Lo que
     sí vuelve —porque es lo que importa— es el hilo y el pedido. */
  restaurar() {
    const d = Memoria.leer(this.LLAVE);
    if (!d || d.v !== 1 || !Array.isArray(d.h) || !d.h.length) return false;

    const limpio = d.h.filter(m =>
      m && (m.role === 'user' || m.role === 'model') && this.textoDe(m).trim());
    if (!limpio.length) return false;

    this.historial = limpio;
    this.saludado = true;
    limpio.forEach(m => {
      const t = this.textoDe(m);
      this.burbuja(m.role === 'user' ? 'yo' : 'bot',
        m.role === 'user' ? '<p>' + esc(t) + '</p>' : md(t));
    });
    return true;
  },

  olvidar() { this.historial = []; Memoria.borrar(this.LLAVE); },

  abrir() {
    this.abierto = true;
    $('#asesor').classList.add('on');
    $('#asesor').setAttribute('aria-hidden', 'false');
    $('#asesor-btn').classList.add('abierto');
    $('#asesor-btn').setAttribute('aria-expanded', 'true');
    $('#asesor-punto').classList.remove('on');
    Viewport.sincronizarBloqueo();
    if (!this.saludado) { this.saludado = true; this.saludo(); }
    /* El ping va SIEMPRE, no solo con el saludo. Quien vuelve de pagar llega
       con el hilo restaurado y `saludado` ya en true: sin este empujón su
       primer mensaje se volvería a comer los ~50 s que tarda Render en
       despertar, justo en el turno que menos lo perdona. */
    this.despertar();
    /* El foco automático solo en escritorio. En un teléfono, enfocar sin que
       el visitante haya tocado el campo levanta el teclado encima de un panel
       que todavía se está abriendo: se ve el salto, y además tapa el saludo
       antes de que le dé tiempo a leerlo. */
    if (!Viewport.esHoja()) setTimeout(() => $('#asesor-in').focus(), 320);
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
    /* Soltar el campo cierra el teclado; si no, en iOS se queda levantado
       sobre una página que ya no tiene dónde escribir. */
    $('#asesor-in').blur();
    BloqueoScroll.soltar('asesor');
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

  /* Decir algo Y recordarlo. Las intervenciones del propio front —pedir la
     dirección, confirmar el pedido, avisar de la vuelta del pago— entran al
     historial como turnos del modelo. Si no entraran, al recargar la página
     el cliente vería su respuesta sin la pregunta, y el modelo volvería a
     pedirle los datos que ya dio. */
  decir(texto) {
    this.burbuja('bot', md(texto));
    this.historial.push({ role: 'model', parts: [{ text: texto }] });
    this.recordar();
  },

  /* ── Checkout conversacional ────────────────────────────────────────────
     No es un formulario de doce campos: son los que FALTAN, en el orden en
     que hacen falta, dentro del mismo hilo donde el cliente ya está. Lo que
     ya se sabe de él no se vuelve a preguntar. */
  pedirDatos(faltan) {
    const ids = (Array.isArray(faltan) && faltan.length ? faltan : Comprador.faltantes())
      .filter(id => CAMPOS_COMPRADOR.some(c => c.id === id));

    if (!ids.length) { this.confirmarPedido(); return; }

    /* Si ya hay un formulario abierto no se apila otro: se lleva el foco al
       que hay. Dos formularios pidiendo lo mismo es la forma más rápida de
       que alguien escriba su dirección en el equivocado. */
    const abierto = this.log.querySelector('.chat-datos');
    if (abierto) {
      abierto.scrollIntoView({ behavior:'smooth', block:'center' });
      const primero = abierto.querySelector('input');
      if (primero && !Viewport.esHoja()) primero.focus();
      return;
    }

    const campos = CAMPOS_COMPRADOR.filter(c => ids.includes(c.id));
    /* Las referencias van de propina cuando ya se está pidiendo la dirección:
       preguntar por ellas en un turno aparte no vale un turno aparte. */
    if (ids.includes('direccion') && !ids.includes('referencias')) {
      campos.push(CAMPOS_COMPRADOR.find(c => c.id === 'referencias'));
    }

    const nombre = (Comprador.datos.nombre || '').split(' ')[0];
    this.decir(
      (nombre ? nombre + ', para' : 'Para') + ' generar tu link de pago me ' +
      (campos.filter(c => !c.opcional).length === 1 ? 'falta un dato' : 'faltan estos datos') +
      '. Es lo mínimo para poder mandarte la caja y para poder escribirte si ' +
      'algo se atora con el pago.');

    const f = document.createElement('form');
    f.className = 'chat-datos';
    f.setAttribute('novalidate', '');
    f.innerHTML = campos.map(c => `
      <label class="cd-campo">
        <span>${esc(c.rotulo)}</span>
        <input name="${esc(c.id)}" type="${esc(c.tipo)}" inputmode="${esc(c.modo)}"
               autocomplete="${esc(c.auto)}" placeholder="${esc(c.ph)}"
               value="${esc(Comprador.datos[c.id] || '')}"
               maxlength="180" ${c.opcional ? '' : 'required'}>
        <em class="cd-err" aria-live="polite"></em>
      </label>`).join('') +
      `<button class="chat-act" type="submit">Continuar</button>`;

    f.addEventListener('submit', async e => {
      e.preventDefault();
      let todoBien = true;
      campos.forEach(c => {
        const inp = f.elements[c.id];
        const err = inp.closest('.cd-campo').querySelector('.cd-err');
        const r = Comprador.revisar(c.id, inp.value);
        if (r.ok) {
          err.textContent = '';
          inp.classList.remove('mal');
          inp.value = r.valor;
        } else {
          err.textContent = r.error;
          inp.classList.add('mal');
          if (todoBien) inp.focus();
          todoBien = false;
        }
      });
      if (!todoBien) { this.fin(); return; }

      campos.forEach(c => Comprador.fijar(c.id, f.elements[c.id].value));
      f.querySelectorAll('input, button').forEach(x => { x.disabled = true; });
      f.classList.add('listo');

      /* Lo que el cliente tecleó entra al hilo como turno SUYO —sin el
         correo ni el teléfono: el modelo no necesita el dato para razonar y
         no hay motivo para pasearlo por la red más veces de las debidas. */
      this.historial.push({ role: 'user', parts: [{ text:
        'Mis datos de entrega: ' + (Comprador.datos.nombre || '') +
        ', CP ' + (Comprador.datos.cp || '') + ', ' + (Comprador.datos.direccion || '') }] });

      await this.confirmarPedido();
    });

    this.log.appendChild(f);
    this.fin();
    if (!Viewport.esHoja()) {
      const primero = f.querySelector('input');
      if (primero) setTimeout(() => primero.focus(), 120);
    }
  },

  /* Desglose final antes del link: productos, envío real y total. Es el
     último momento en que el cliente puede decir «espera, eso no». */
  async confirmarPedido() {
    if (!Carrito.piezas()) {
      this.decir('Tu carrito está vacío. Dime qué necesitas y te lo armo.');
      return;
    }

    const cp = Comprador.datos.cp;
    if (cp && !Envio.vigente()) {
      this.pensando(true);
      await cotizarEnvio(cp);
      this.pensando(false);
    }

    const nombre = (Comprador.datos.nombre || '').split(' ')[0];
    this.decir(
      (nombre ? 'Listo, ' + nombre + '.' : 'Listo.') + ' Va a **' +
      (Comprador.datos.direccion || 'la dirección que me diste') + '**, CP ' +
      (cp || '—') + ', y te aviso al **' + Comprador.telefonoBonito() + '**.' +
      '\n\n' + desglosePedido() +
      '\n\nSi está bien, te genero el link de pago.');
    this.acciones([{ tipo:'pago' }, { tipo:'whatsapp' }, { tipo:'carrito' }]);
  },

  async enviar(texto) {
    texto = String(texto || '').trim();
    if (!texto || this.ocupado) return;

    this.burbuja('yo', '<p>' + esc(texto) + '</p>');
    this.historial.push({ role: 'user', parts: [{ text: texto }] });
    /* Se guarda YA, antes de esperar al servidor: si el visitante recarga
       mientras el Asesor piensa, su pregunta no se pierde. */
    this.recordar();
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
          /* El tope propio del servidor no es la cuota de Gemini, y decirlo
             como si el asesor «llegara a su límite» asusta sin informar. Se
             dice cuánto hay que esperar y —esto es lo importante— que el
             pedido sigue donde estaba: la respuesta local que viene detrás
             lo desglosa. */
          avisoServidor = e.motivo === 'rate-limit' && e.espera
            ? 'El Asesor está ocupado ~' + e.espera + ' s. **Tu carrito sigue aquí.**'
            : (e.mensajeUsuario || '');
        } else {
          console.warn('[asesor] backend no disponible, paso a modo local:', e.message);
          this.modoLocal = true;
        }
      }
    }
    if (!data) data = await this.responderLocal(texto);
    /* Si el servidor explicó por qué no pudo, se dice UNA vez y arriba del
       todo: el visitante merece saber que está hablando con el suplente. */
    if (avisoServidor) data = { ...data, reply: avisoServidor + '\n\n' + data.reply };

    this.pensando(false);
    this.ocupado = false;
    $('#asesor-send').disabled = false;

    this.burbuja('bot', md(data.reply));
    this.historial.push({ role: 'model', parts: [{ text: data.reply }] });
    /* `recordar` recorta por turnos Y por caracteres, y deja el hilo escrito.
       Antes solo se recortaba por turnos y no se escribía en ningún sitio. */
    this.recordar();

    /* El servidor no toca el carrito: propone, y el cliente aplica. */
    AccionesAsesor.ejecutar(data.acciones);

    this.tarjetas(data.products);
    this.cotizacion(data.cotizacion);

    const botones = (data.acciones || []).filter(a =>
      a.tipo === 'pago' || a.tipo === 'whatsapp' || a.tipo === 'carrito' || a.tipo === 'ir');
    if (botones.length) this.acciones(botones);
    else if (data.cotizacion || (data.acciones || []).some(a => a.tipo && a.tipo.indexOf('carrito') === 0)) {
      this.trasCarrito();
    }

    /* Si la respuesta pide datos de entrega, el formulario va DETRÁS del
       texto y de los botones: primero se entiende, luego se teclea. Los
       campos se filtran contra la lista real, igual que las acciones: lo que
       llega del servidor propone, aquí se decide. */
    if (Array.isArray(data.datos) && data.datos.length) {
      this.pedirDatos(data.datos.filter(id => CAMPOS_COMPRADOR.some(c => c.id === id)));
    }
  },

  async pedirAlServidor() {
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), CFG.timeoutMs);
    try {
      const r = await fetch(CFG.backend + '/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: this.hiloRecortado(), carrito: Carrito.lista() }),
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
        /* Los segundos vienen en el cuerpo y no en Retry-After: la cabecera
           existe, pero leerla desde otro origen exige exponerla en el CORS, y
           un dato de cortesía no justifica ampliar lo que el navegador deja
           leer al JavaScript de la página. */
        e.espera = parseInt(j.espera_s, 10) || 0;
        throw e;
      }
      if (!j.reply) throw new Error('respuesta vacía');
      return j;
    } finally { clearTimeout(reloj); }
  },

  /* ── Modo local ────────────────────────────────────────────────────────
     Sin backend el Asesor no se disculpa: busca en el catálogo, entiende
     cantidades y cierra por WhatsApp. Es peor que el modelo, pero vende. */
  async responderLocal(texto) {
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

    /* "2 de endo y uno de nissin" son DOS líneas, no una.

       El corte va sobre el texto CRUDO, y ese detalle era el bug: `normaliza`
       hace replace(/[^\w\s]/g,' '), o sea que se lleva por delante las comas
       — y este split intentaba cortar por una coma que ya no existía. Con eso,
       "2 endos, 3 realistas, 1 nisin, 1 pulpo" colapsaba a un solo fragmento,
       se quedaba con el mejor producto y con el PRIMER número: "2 × endodoncia",
       y los otros tres se perdían sin que nadie se enterara. Se normaliza
       DESPUÉS de cortar, que es cuando ya da igual.

       Cada tramo lleva su propio verbo, y el verbo se arrastra hasta que otro
       lo cambie: "elimina los 2 endo y agrega el pulpo" son dos operaciones
       distintas en una sola frase, y tratarlas como una sola es justo lo que
       hacía que borrar acabara agregando. */
    const VERBO_QUITA = /\b(elimina|eliminar|elimine|quita|quitar|quite|borra|borrar|saca|sacar|remueve|remover|descarta|descartar|sin)\b/;
    const VERBO_PON   = /\b(agrega|agregar|añade|anade|añadir|pon|poner|ponme|quiero|dame|suma|sumar|mete|meter)\b/;

    const pedido = new Map();       // sku → { n, verbo }
    let verboVigente = null;

    String(texto)
      .split(/\s*[,;]\s*|\s+(?:y|mas|más|además|ademas|tambien|también)\s+|\s*\+\s*/i)
      .map(f => f.trim()).filter(Boolean)
      .forEach(bruto => {
        const frag = normaliza(bruto);
        if (VERBO_QUITA.test(frag)) verboVigente = 'quitar';
        else if (VERBO_PON.test(frag)) verboVigente = 'agregar';
        const hit = puntuar(frag)[0];
        if (hit && !pedido.has(hit.p.sku)) {
          pedido.set(hit.p.sku, { n: cantidadDe(frag), verbo: verboVigente || 'agregar' });
        }
      });

    /* Intenciones que hablan del carrito entero y no de un producto. */
    const mencionaCarrito = /\b(carrito|pedido|orden|todo|todos|todas|productos|articulos|art[ií]culos)\b/.test(q);
    const quiereVaciar =
      /\b(vacia|vaciar|vacie|limpia|limpiar|resetea|reinicia)\b/.test(q) ||
      (VERBO_QUITA.test(q) && mencionaCarrito && !pedido.size);
    const quiereQuitar = VERBO_QUITA.test(q) && !quiereVaciar;

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
        'Escríbenos por WhatsApp al **+52 771 795 9131** o a **' + CFG.correo + '** y te pasan las condiciones.',
        acciones:[{ tipo:'whatsapp' }] };
    }

    /* ── EL CARRITO MANDA ──────────────────────────────────────────────
       Con piezas dentro, «cuánto es», «desglosa», «qué pedí» y «el link» son
       preguntas sobre ESE pedido, no sobre el catálogo. Este era el bug caro:
       sin backend, alguien con dos kits de endodoncia y un pulpo en el
       carrito preguntaba «cuánto es» y recibía el menú de tipodontos Nissin,
       como si acabara de llegar. Un asesor con amnesia no vende: descoloca.

       Un código postal suelto también cuenta. «03330» a secas no trae verbo
       ni producto, pero después de armar un pedido solo puede significar una
       cosa, y responder «¿en qué te ayudo?» a eso es de recepcionista. */
    const hayCarrito = Carrito.piezas() > 0;

    /* Un número de cinco dígitos solo es un código postal si el mensaje habla
       de envío, o si el mensaje ENTERO es ese número. Sin esa cautela «quiero
       12000 dientes» acabaría cotizando un envío a la Ciudad de México, y el
       cliente vería una fecha de entrega que nadie le prometió. */
    const cpSuelto = (String(texto).match(/(?:^|\D)(\d{5})(?:\D|$)/) || [])[1];
    const pistaEnvio = /\b(envio|envios|enviar|envia|manda|mandar|mandas|entrega|entregar|cp|codigo postal|llega|llegar|domicilio|direccion)\b/.test(q);
    const cpNuevo = cpSuelto && (pistaEnvio || /^\s*\d{5}\s*$/.test(String(texto).trim()))
      ? cpSuelto : null;
    const preguntaPedido = /\b(desglos\w*|cuanto (es|sale|seria|queda|cuesta|va|me sale)|el total|mi total|total|que pedi|que llevo|que traigo|mi pedido|el pedido|mi carrito|el carrito|resumen|el link|link de pago|mi orden|mis datos|donde lo mandas)\b/.test(q);

    if (hayCarrito && !pedido.size && !quiereVaciar && !quiereQuitar &&
        (preguntaPedido || quiereCerrar || cpNuevo)) {

      if (cpNuevo) {
        Comprador.fijar('cp', cpNuevo);
        /* El costo y la fecha los da el servidor de envíos, que sí responde
           aunque Gemini no: son dos servicios distintos del mismo backend. */
        await cotizarEnvio(cpNuevo);
      }

      const cabecera = cpNuevo
        ? 'Cotizado a **CP ' + cpNuevo + '**. Tu pedido queda así:\n\n'
        : 'Tu pedido, punto por punto:\n\n';

      const faltan = Comprador.faltantes();
      if (faltan.length) {
        return { reply: cabecera + desglosePedido() +
          '\n\nPara generar el link de pago necesito tus datos de entrega.',
          datos: faltan };
      }
      return { reply: cabecera + desglosePedido() + '\n\n¿Te genero el link de pago?',
        acciones:[{ tipo:'pago' }, { tipo:'whatsapp' }, { tipo:'carrito' }] };
    }

    /* ── Vaciar el carrito ──────────────────────────────────────────────── */
    if (quiereVaciar) {
      if (!Carrito.piezas()) {
        return { reply: 'Tu carrito ya está vacío. ¿Te armo un pedido? Dime qué ' +
          'práctica necesitas —endodoncia, pulpotomía, kit completo o tipo Nissin—.' };
      }
      Carrito.vaciar();
      return { reply:
        'Listo, vacié tu carrito.\n\n¿Qué quieres poner en su lugar?',
        acciones:[{ tipo:'carrito' }] };
    }

    /* ── Quitar productos concretos ─────────────────────────────────────── */
    if (quiereQuitar && pedido.size) {
      const quitados = [];
      [...pedido].forEach(([sku, { n, verbo }]) => {
        if (verbo !== 'quitar') return;
        const hay = Carrito.items.get(sku) || 0;
        if (!hay) return;
        const p = porSku(sku);
        /* Sin cantidad explícita, o pidiendo más de lo que hay, se va la
           línea entera: "quita los endo" no significa "quita uno". */
        const explicita = /\b\d+\b/.test(normaliza(texto));
        if (!explicita || n >= hay) { Carrito.quitar(sku); quitados.push('**' + p.nombre + '**'); }
        else { Carrito.fijar(sku, hay - n); quitados.push('**' + n + ' × ' + p.nombre + '**'); }
      });

      /* En la misma frase puede venir un alta: "quita los endo y pon el pulpo". */
      const puestos = [];
      [...pedido].forEach(([sku, { n, verbo }]) => {
        if (verbo !== 'agregar') return;
        Carrito.agregar(sku, n);
        puestos.push('**' + n + ' × ' + porSku(sku).nombre + '**');
      });

      if (!quitados.length && !puestos.length) {
        return { reply: 'Eso no lo traías en el carrito. Ahora mismo tienes ' +
          resumenCarrito() + '.\n\n¿Qué quieres que quite?',
          acciones:[{ tipo:'carrito' }] };
      }

      const t = Carrito.totales();
      let msg = '';
      if (quitados.length) msg += 'Quité ' + unir(quitados) + ' de tu carrito. ';
      if (puestos.length) msg += (quitados.length ? 'Y agregué ' : 'Agregué ') + unir(puestos) + '. ';
      msg += Carrito.piezas()
        ? '\n\nTe queda ' + resumenCarrito() + ', **' + mxn(t.total) + '**' +
          (t.gratis ? ' con envío gratis.' : ', más ' + mxn(t.envio) + ' de envío.') +
          '\n\n¿Cierro el pedido?'
        : '\n\nCon eso tu carrito queda vacío. ¿Te armo otro pedido?';
      return { reply: msg,
        acciones: Carrito.piezas()
          ? [{ tipo:'pago' }, { tipo:'whatsapp' }, { tipo:'carrito' }]
          : [{ tipo:'carrito' }] };
    }

    if (encontrados.length && (quiereComprar || pedido.size > 1)) {
      const lineas = pedido.size
        ? [...pedido].map(([sku, { n }]) => ({ p: porSku(sku), n }))
        : [{ p: encontrados[0].p, n: cantidad }];
      lineas.forEach(l => Carrito.agregar(l.p.sku, l.n));

      /* «2 kits de endo y envío a 03330» es UNA frase con dos peticiones. El
         código postal se atiende aquí mismo: hacerle repetirlo en el turno
         siguiente es exactamente el trato que se le da a un formulario. */
      if (cpNuevo) { Comprador.fijar('cp', cpNuevo); await cotizarEnvio(cpNuevo); }

      const detalle = unir(lineas.map(l => '**' + l.n + ' × ' + l.p.nombre + '**'));
      const t = Carrito.totales();
      return { reply:
        'Listo, agregué ' + detalle + ' a tu carrito.\n\n' + desglosePedido() +
        (t.gratis || Envio.vigente() ? '' :
          '\n\nTe faltan ' + mxn(t.falta) + ' para que el envío salga gratis.') +
        '\n\n¿Cierro el pedido?',
        acciones:[{ tipo:'pago' }, { tipo:'whatsapp' }, { tipo:'carrito' }] };
    }

    if (encontrados.length) {
      return { reply: 'Esto es lo que tengo para lo que me pides:',
        products: encontrados.slice(0, 3).map(x => ({ sku:x.p.sku, nombre:x.p.nombre, imagen:x.p.img })) };
    }

    /* Última red. Con carrito, NUNCA el catálogo desde cero: quien ya eligió
       no quiere que le vuelvan a preguntar qué práctica hace. */
    if (hayCarrito) {
      return { reply:
        'No te entendí del todo, pero **tu pedido sigue aquí**:\n\n' + desglosePedido() +
        '\n\n¿Lo cierro, le agrego algo o quito una línea?',
        acciones:[{ tipo:'pago' }, { tipo:'carrito' }, { tipo:'whatsapp' }] };
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
  campo.value = '';
  /* Al vaciarse vuelve a una línea, y hay que quitarle también la marca de
     tope: si el mensaje enviado llegaba al máximo, el campo se quedaba con
     la barra de scroll puesta sobre un campo ya vacío. */
  campo.style.height = 'auto';
  campo.classList.remove('tope');
  Asesor.enviar(t);
});
/* Alto del campo = alto de su contenido, hasta el tope. `height:auto` antes de
   medir no es opcional: `scrollHeight` incluye el alto ya fijado, así que sin
   soltarlo el campo crece y nunca vuelve a encogerse al borrar texto. */
const TOPE_CAMPO = 120;
function ajustarCampo(campo) {
  campo.style.height = 'auto';
  const alto = Math.min(campo.scrollHeight, TOPE_CAMPO);
  campo.style.height = alto + 'px';
  /* Solo al llegar al tope hay algo que desplazar. */
  campo.classList.toggle('tope', campo.scrollHeight > TOPE_CAMPO);
}

$('#asesor-in').addEventListener('input', function () { ajustarCampo(this); });

/* Al enfocar en móvil el teclado tapa media pantalla. Para cuando el sistema
   termina de levantarlo y `visualViewport` ya reporta el alto nuevo, el hilo
   tiene que estar abajo del todo: si no, el visitante ve el centro de la
   conversación y su propio mensaje queda fuera de cuadro. Los dos tiempos
   cubren los dos ritmos de animación de teclado que hay entre iOS y Android. */
$('#asesor-in').addEventListener('focus', function () {
  if (!Viewport.esHoja()) return;
  [180, 420].forEach(t => setTimeout(() => Asesor.fin(), t));
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
  Comprador.cargar();
  Envio.cargar();
  $('#cart-n').textContent = Carrito.piezas();
  Viewport.iniciar();
  pintarDrawer();
  lineasHero = $$('#v-hub [data-at]');

  /* El hilo del Asesor se repinta ANTES de navegar: si el visitante viene de
     pagar, lo primero que tiene que ver al abrir el panel es su propia
     conversación, y encima de ella la confirmación. */
  const hiloRestaurado = Asesor.restaurar();

  /* Los botones no se repintan con el hilo —son acciones de un turno que ya
     pasó—, así que una conversación restaurada terminaba en texto y sin nada
     que tocar. Si el carrito sigue lleno, la botonera vuelve al final: con el
     carrito de AHORA, no con el de ayer. */
  if (hiloRestaurado && Carrito.piezas() > 0 && rutaActual() !== '/gracias') {
    Asesor.acciones([{ tipo:'pago' }, { tipo:'whatsapp' }, { tipo:'carrito' }]);
  }

  /* Volvió de Mercado Pago sin pasar por /gracias: el botón de atrás del
     navegador, o un fallo que devuelve al home. Callarse aquí es lo peor que
     puede hacer la tienda — el cliente no sabe si pagó, si perdió el pedido
     ni a quién preguntarle. */
  const pagoPendiente = Memoria.leer(PAGO_EN_CURSO);
  if (pagoPendiente && rutaActual() !== '/gracias' && Carrito.piezas() > 0) {
    Memoria.borrar(PAGO_EN_CURSO);
    Asesor.saludado = true;
    Asesor.decir(
      'Volviste sin terminar el pago. **Aquí sigue tu pedido:**\n\n' +
      desglosePedido() + '\n\n¿Reintento el link o lo cerramos por WhatsApp?');
    Asesor.acciones([{ tipo:'pago' }, { tipo:'whatsapp' }, { tipo:'carrito' }]);
    Asesor.abrir();
  }

  /* Entradas desde las páginas estáticas. Aquellas enlazaban a `#/catalogo` o
     `#/pack`, y el redirector de rutas antiguas del index las devolvía a la
     misma página de la que venían: el botón de comprar no llevaba a ninguna
     parte. Con un parámetro de query el redirector no se activa —solo mira el
     hash, y ahí ya no hay nada que reconozca— y la aplicación abre lo que se
     le pide. `?asesor=1` abre el Asesor, que es la tienda. */
  const entrada = parametrosVisita();
  const irA = '/' + (entrada.get('ir') || '');
  if (irA !== '/' && RUTAS[irA]) location.hash = '#' + irA;
  if (entrada.get('asesor')) Asesor.abrir();

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
