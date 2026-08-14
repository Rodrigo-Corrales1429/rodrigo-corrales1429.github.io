/* ═══════════════════════════════════════════════════════════════════════════
   VALQUIRIA — FÁBRICA DE FIGURAS
   ───────────────────────────────────────────────────────────────────────────
   Ninguna figura es un archivo 3D. Todas son funciones de distancia con signo
   (SDF) que se muestrean en una rejilla, se proyectan a la superficie con dos
   pasos de Newton y se imprimen capa por capa en el canvas.

   Agregar una pieza al catálogo visual = escribir una función. 0 kb de assets,
   0 peticiones de red, y la silueta se puede afinar con un número.

   Convención: la figura vive centrada en X/Z y apoyada sobre la plataforma,
   con Y creciendo hacia arriba. El bounding box (bb) debe envolverla siempre:
   si queda corto, la pieza sale rebanada.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Primitivas ─────────────────────────────────────────────────────────── */

const LEJOS = 1e9;
const PI2 = Math.PI * 2;

/* Unión e intersección suaves. k = radio del filete. */
const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a, b, k) => -smin(-a, -b, k);

/* Elipsoide. Distancia aproximada pero con gradiente correcto: es lo que
   necesita la proyección a la superficie. */
function sdEll(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const x = (px - cx) / rx, y = (py - cy) / ry, z = (pz - cz) / rz;
  const k0 = Math.sqrt(x * x + y * y + z * z);
  if (k0 === 0) return -Math.min(rx, ry, rz);
  const a = (px - cx) / (rx * rx), b = (py - cy) / (ry * ry), c = (pz - cz) / (rz * rz);
  return k0 * (k0 - 1) / Math.sqrt(a * a + b * b + c * c);
}

/* Cono capsulado entre dos puntos, con radio distinto en cada extremo.
   Es la primitiva de trabajo: huesos, astas, raíces, dedos, todo sale de aquí. */
function sdCone(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {
  const bax = bx - ax, bay = by - ay, baz = bz - az, l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const xx = pax * l2 - bax * y, xy = pay * l2 - bay * y, xz = paz * l2 - baz * y;
  const x2 = xx * xx + xy * xy + xz * xz, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

/* Láminas: el mismo cono, aplastado en un eje. Dividir entre k mantiene la
   distancia métrica y evita que la cara plana se pierda al proyectar.

   Hay dos versiones porque el eje importa, y equivocarlo no se nota en el
   código pero sí en la pantalla: una pluma que se extiende hacia atrás y se
   aplasta EN Z queda comprimida justo en la dirección en la que crece, y de
   frente las tres plumas se apelmazan en un bulto redondo. La que barre hacia
   atrás tiene que ser plana en Y — horizontal, como en un casco real. */
const sdLaminaZ = (px, py, pz, ax, ay, az, bx, by, bz, r1, r2, k) =>
  sdCone(px, py, pz * k, ax, ay, az * k, bx, by, bz * k, r1, r2) / k;

const sdLaminaY = (px, py, pz, ax, ay, az, bx, by, bz, r1, r2, k) =>
  sdCone(px, py * k, pz, ax, ay * k, az, bx, by * k, bz, r1, r2) / k;

/* La tercera: aplastada en X. La piden las raíces del molar, que son cintas
   anchas en sentido vestíbulo-lingual y delgadas en sentido mesio-distal. */
const sdLaminaX = (px, py, pz, ax, ay, az, bx, by, bz, r1, r2, k) =>
  sdCone(px * k, py, pz, ax * k, ay, az, bx * k, by, bz, r1, r2) / k;

/* Caja redondeada. */
function sdBox(px, py, pz, cx, cy, cz, bx, by, bz, r) {
  const qx = Math.abs(px - cx) - bx, qy = Math.abs(py - cy) - by, qz = Math.abs(pz - cz) - bz;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) +
         Math.min(Math.max(qx, qy, qz), 0) - r;
}

/* Toro sobre el eje Y. Anillos, órbitas, aros de refuerzo. */
function sdToroY(px, py, pz, cx, cy, cz, R, r) {
  const q = Math.hypot(px - cx, pz - cz) - R;
  return Math.hypot(q, py - cy) - r;
}

/* Esfera de recorte: sirve para descartar regiones enteras sin evaluarlas.
   Devolver LEJOS es seguro dentro de un smin porque cuando |a-b| > k el
   filete vale 0 y smin degenera en min. */
const fuera = (px, py, pz, cx, cy, cz, r) =>
  (px - cx) * (px - cx) + (py - cy) * (py - cy) + (pz - cz) * (pz - cz) > r * r;

/* Repetición angular alrededor del eje Y: devuelve el radio y el ángulo
   plegado al sector. Dientes de engrane, lamas del faldar, costillas. */
function sector(x, z, n, giro) {
  const r = Math.hypot(x, z);
  const paso = PI2 / n;
  let a = Math.atan2(z, x) + (giro || 0);
  a -= Math.round(a / paso) * paso;
  return { r: r, x: r * Math.cos(a), z: r * Math.sin(a) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   MATERIALES
   ───────────────────────────────────────────────────────────────────────────
   El muestreador pregunta, por cada punto ya proyectado a la superficie, de
   qué está hecho. Sin esta capa la pieza curada sale de un solo blanco y no
   hay nada que la separe de un maniquí: la capa negra, el asta oscura y la
   piel son justo lo que hace que la silueta se lea como personaje y no como
   volumen. Es un entero por punto y se resuelve una sola vez, al muestrear.
   ═══════════════════════════════════════════════════════════════════════════ */
const MAT = { MARFIL: 0, ORO: 1, PIEL: 2, CAPA: 3, ASTA: 4 };

/* ═══════════════════════════════════════════════════════════════════════════
   1 · LA VALQUIRIA — figura del hub
   ───────────────────────────────────────────────────────────────────────────
   Pose alineada con la referencia: de pie, casi frontal, ligero contrapposto.
   La lanza va en su mano derecha —que en pantalla cae a la IZQUIERDA, x<0— y
   la capa cuelga del hombro contrario, hacia atrás y a la derecha. El brazo
   libre reposa al costado.

   Las tres partes que definen la silueta (lanza, capa, alas) viven en sus
   propias funciones porque el material vuelve a necesitarlas: preguntar "¿este
   punto es capa?" con la misma SDF que la dibujó es exacto, y aproximarlo con
   una caja de recorte deja el borde del paño pintado de marfil.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Eje de la lanza. Compartido por geometría y material. */
const LANZA_X = -0.238, LANZA_Z = 0.058;

function sdLanza(x, y, z) {
  const sx = LANZA_X, sz = LANZA_Z;
  /* Asta: larga y delgada, del suelo hasta por encima del yelmo. */
  let s = sdCone(x, y, z, sx, -0.975, sz, sx, 0.885, sz, 0.0150, 0.0130);
  /* Hoja: una hoja de lanza LARGA, como en la referencia — se abre en el
     primer tercio y remata en una punta que domina la silueta por encima de
     la cabeza. Dos láminas encadenadas; la de arriba lleva casi toda la
     longitud, que es lo que la separa de un cono con ínfulas. El aplastado
     2.5 la deja con canto de filo sin bajar del grosor que la rejilla puede
     muestrear. */
  s = Math.min(s, sdLaminaZ(x, y, z, sx, 0.880, sz, sx, 0.960, sz, 0.008, 0.030, 2.2));
  s = Math.min(s, sdLaminaZ(x, y, z, sx, 0.960, sz, sx, 1.150, sz, 0.030, 0.0015, 2.2));
  s = smin(s, sdEll(x, y, z, sx, 0.872, sz, 0.021, 0.016, 0.016), 0.010);  // cuello de la hoja
  s = smin(s, sdEll(x, y, z, sx, 0.102, sz, 0.026, 0.015, 0.026), 0.010);  // virola bajo la mano
  s = smin(s, sdCone(x, y, z, sx, -0.900, sz, sx, -0.995, sz, 0.026, 0.006), 0.014); // regatón
  return s;
}

/* Capa: una lámina de perfil, no un elipsoide. El ancho, la profundidad y la
   ondulación dependen de la altura, así que cae abriéndose y ondea al llegar
   al suelo — que es lo único que distingue un paño de una plancha. */
function sdCapa(x, y, z) {
  if (y > 0.47 || y < -1.03) return LEJOS;
  const t = Math.min(1, Math.max(0, (0.42 - y) / 1.38));   // 0 hombro, 1 suelo
  /* Prendida de LOS DOS hombros, como en la referencia: arriba cubre el ancho
     de la espalda y al caer se abre hasta asomar por los costados. Una capa
     que nace de un solo hombro se pierde detrás del torso y de frente no
     existe — y la capa es la mitad de la silueta. */
  const centro = 0.020 * t;
  const semi   = 0.150 + 0.190 * Math.pow(t, 0.80);
  const u      = x - centro;
  const onda   = Math.sin(u * 8.5 + t * 3.2) * (0.006 + 0.040 * t);
  const fondo  = -0.085 - 0.125 * t + onda;
  let c = Math.abs(z - fondo) - 0.027;
  c = Math.max(c, Math.abs(u) - semi);
  /* El borde de arriba NO es un corte recto. Con una horizontal, la capa
     asomaba por encima de los hombros como un tablón negro cruzado a la
     espalda. Una capa va prendida en DOS broches y cuelga entre ellos, así
     que el borde sube hacia los hombros y baja en el centro, detrás de la
     nuca: un escote en V invertida. Es la diferencia entre un paño y una
     tabla apoyada. */
  c = Math.max(c, y - Math.min(0.428, 0.318 + 0.78 * Math.abs(u)));
  /* Dobladillo irregular: un corte a una altura constante delata la plancha. */
  c = Math.max(c, (-0.950 + Math.sin(u * 6.3 + 1.1) * 0.048) - y);
  /* El paño no invade el cuerpo: si lo hace, el torso sale pintado de negro. */
  return smax(c, -sdEll(x, y, z, 0, 0.05, 0.015, 0.185, 0.420, 0.125), 0.045);
}

/* Alas del yelmo: abanico de plumas planas que sube y se abre hacia atrás.
   Se aplastan en Z —el plano del abanico es X/Y— porque en la referencia las
   plumas se ven de canto desde el frente; aplastarlas en Y las convertiría en
   dos cuernos horizontales.

   Las plumas se unen con Math.min, NO con smin: fundirlas las convierte en una
   sola paleta redondeada, que es exactamente el par de orejas que hay que
   evitar. El surco entre pluma y pluma es lo que las hace legibles como ala. */
function sdAlas(ax, y, z) {
  let w = sdEll(ax, y, z, 0.068, 0.662, -0.010, 0.028, 0.033, 0.033);   // base sobre la sien
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    /* Tres reglas, las tres aprendidas mirando el resultado:

       · El arranque va POR ENCIMA y POR DETRÁS de la sien. Naciendo a la
         altura del ojo, el abanico se lee como dos conchas pegadas a la cara
         por bien que apunten las plumas.
       · Ninguna pluma baja de ~30°: en cuanto una se tumba deja de ser ala y
         se convierte en una oreja.
       · La pluma es GRUESA en el arranque y termina EN PUNTA. Al revés —que
         es lo que sale si uno escribe los radios en el orden natural del
         cono— cada pluma acaba en un casquete redondo del tamaño de su
         grosor, y el ala entera se lee como una vieira. Ancha abajo, además,
         las plumas se funden en una sola masa junto al yelmo y solo se
         separan al abrirse, que es como se comporta un ala de verdad. */
    const ang = 1.44 - t * 0.60;         /* 82°..48°: todas apuntan ARRIBA */
    const lar = 0.310 - t * 0.120;       /* largas: el ala debe rebasar el yelmo */
    const x0 = 0.058 + t * 0.024, y0 = 0.670 - t * 0.036, z0 = -0.010 - t * 0.018;
    const x1 = x0 + lar * Math.cos(ang) * 0.92;
    const y1 = y0 + lar * Math.sin(ang);
    const z1 = z0 - lar * 0.34;
    /* El grosor manda sobre todo lo demás. Con plumas gruesas el abanico se
       lee como un puñado de plátanos; una pluma es una LÁMINA, así que el
       radio se queda en lo mínimo que la rejilla resuelve (≈2 celdas de 0.0064)
       y el aplastado en Z hace el resto: 3.1 deja el canto afilado sin bajar
       del espesor que se puede muestrear. Por debajo de eso la pluma sale rota
       a tiras, que es peor que gorda.

       El filete con la base también baja a 0.004: fundirlas más las devuelve
       a ser una sola paleta, y el surco entre pluma y pluma es lo único que
       las hace legibles como ala. */
    const gr = 0.0165 - t * 0.0045;
    w = smin(w, sdLaminaZ(ax, y, z, x0, y0, z0, x1, y1, z1, gr, gr * 0.16, 3.1), 0.004);
  }
  return w;
}

/* Cuerno frontal del yelmo: la aguja que remata la silueta en la referencia.
   Aplastado en X —de frente es una lámina estrecha, de perfil un triángulo—
   dividiendo entre k para conservar la métrica, igual que las láminas. */
function sdCuerno(x, y, z) {
  const k = 1.7;
  return sdCone(x * k, y, z, 0, 0.700, 0.052, 0, 0.945, -0.010, 0.020, 0.002) / k;
}

function valquiria(x, y, z) {
  const ax = Math.abs(x);

  /* — Banda alta: por encima del yelmo solo existen la lanza, el cuerno y las
       alas. Saltarse el cuerpo entero aquí paga la rejilla más fina: es un
       sexto del volumen de muestreo evaluando 4 primitivas en vez de 40. — */
  if (y > 0.80) {
    let s = sdLanza(x, y, z);
    s = Math.min(s, sdCuerno(x, y, z));
    if (ax > 0.028) s = Math.min(s, sdAlas(ax, y, z));
    return s;
  }

  /* — Torso / coraza — */
  let d = sdEll(x, y, z, 0, 0.250, 0.010, 0.148, 0.175, 0.095);          // pecho
  d = smin(d, sdEll(x, y, z, 0, 0.080, 0.005, 0.081, 0.100, 0.066), 0.080); // cintura
  d = smin(d, sdEll(x, y, z, 0, -0.080, 0.000, 0.128, 0.095, 0.088), 0.085); // cadera

  /* Volumen de pecho de la coraza (lectura femenina de frente) */
  d = smin(d, sdEll(ax, y, z, 0.055, 0.280, 0.055, 0.060, 0.055, 0.042), 0.050);
  /* Quilla / líneas geométricas de la coraza */
  d = smin(d, sdCone(ax, y, z, 0.0, 0.340, 0.095, 0.0, 0.100, 0.080, 0.009, 0.006), 0.028);

  /* — Faldar de placas. Placas que se ABREN al caer y terminan en punta,
       como los escarpes de la referencia — no un cilindro de tablones. Cada
       placa es una lámina delgada en el eje radial (s.x), ancha arriba y
       rematada en punta abajo, inclinada hacia afuera para dar el vuelo.
       Atrás se recortan: ahí vive la capa, y una placa de marfil asomando a
       través del paño negro delata el truco al instante. — */
  if (y < 0.02 && y > -0.36) {
    const s = sector(x, z, 8, 0.393);
    /* Aplastado 3.4 en el eje radial: una PLACA, no un tablón. Con 2.0 cada
       lama salía con sección casi circular y el faldar entero se leía como
       una falda de globos. */
    let lama = sdLaminaZ(s.z, y, s.x, 0, -0.058, 0.126, 0, -0.288, 0.182, 0.062, 0.046, 3.4);
    lama = Math.max(lama, -z - 0.150);
    d = smin(d, lama, 0.020);
    /* Forro interior: tapa los huecos entre placas para que no se vea el
       fondo a través del faldar. De material va oscuro, como tela. */
    d = smin(d, sdCone(x, y, z, 0, -0.060, 0, 0, -0.262, 0, 0.116, 0.152), 0.030);
  }

  /* — Piernas de pie (casi paralelas, ligero contrapposto) — */
  if (y < 0.05) {
    /* Izquierda — ligeramente adelantada */
    let pi = sdCone(x, y, z, -0.075, -0.100, 0.025, -0.078, -0.500, 0.040, 0.070, 0.045);
    pi = smin(pi, sdEll(x, y, z, -0.078, -0.510, 0.040, 0.048, 0.042, 0.048), 0.035); // rodilla
    pi = smin(pi, sdCone(x, y, z, -0.078, -0.520, 0.040, -0.072, -0.900, 0.030, 0.045, 0.028), 0.040);
    pi = smin(pi, sdEll(x, y, z, -0.072, -0.620, 0.020, 0.040, 0.070, 0.036), 0.045); // gemelo
    pi = smin(pi, sdEll(x, y, z, -0.070, -0.940, 0.055, 0.042, 0.032, 0.078), 0.032); // pie

    /* Derecha — apoyo */
    let pd = sdCone(x, y, z, 0.075, -0.100, -0.010, 0.080, -0.500, -0.015, 0.070, 0.045);
    pd = smin(pd, sdEll(x, y, z, 0.080, -0.510, -0.015, 0.048, 0.042, 0.048), 0.035);
    pd = smin(pd, sdCone(x, y, z, 0.080, -0.520, -0.015, 0.078, -0.900, -0.020, 0.045, 0.028), 0.040);
    pd = smin(pd, sdEll(x, y, z, 0.078, -0.620, -0.030, 0.040, 0.070, 0.036), 0.045);
    pd = smin(pd, sdEll(x, y, z, 0.078, -0.940, 0.010, 0.042, 0.032, 0.078), 0.032);

    d = smin(d, Math.min(pi, pd), 0.050);
  }

  /* — Trapecio: sin este relleno entre cuello y hombrera queda un valle y el
       cuello se lee larguísimo. — */
  d = smin(d, sdEll(ax, y, z, 0.054, 0.378, 0.000, 0.070, 0.042, 0.060), 0.055);

  /* — Hombreras: dos casquetes superpuestos con poco filete. Lo que dice
       "armadura" no es el volumen sino el ESCALÓN entre placa y placa: con un
       filete ancho las dos se funden en un músculo, y con cajas rectas salen
       dos repisas horizontales que convierten la figura en un espantapájaros.
       Casquete curvo + unión corta. Más chicas que antes: infladas, la figura
       entera se leía rechoncha por más fina que fuera la cintura. — */
  d = smin(d, sdEll(ax, y, z, 0.150, 0.374, 0.004, 0.063, 0.042, 0.060), 0.028);
  d = smin(d, sdEll(ax, y, z, 0.166, 0.330, 0.004, 0.052, 0.027, 0.048), 0.018);

  /* — Brazos — */
  if (y > -0.25 && y < 0.48) {
    /* El de la lanza (x<0): codo flexionado, mano cerrada sobre el asta. */
    let bl = sdCone(x, y, z, -0.158, 0.345, 0.010, -0.226, 0.200, 0.040, 0.040, 0.033);
    bl = smin(bl, sdCone(x, y, z, -0.226, 0.200, 0.040, -0.236, 0.080, 0.056, 0.033, 0.027), 0.030);
    bl = smin(bl, sdEll(x, y, z, LANZA_X, 0.055, LANZA_Z, 0.038, 0.036, 0.036), 0.025); // mano

    /* El libre: cae al costado, ligeramente separado del cuerpo. */
    let br = sdCone(x, y, z, 0.158, 0.345, 0.000, 0.192, 0.100, 0.015, 0.040, 0.033);
    br = smin(br, sdCone(x, y, z, 0.192, 0.100, 0.015, 0.188, -0.120, 0.020, 0.033, 0.027), 0.030);
    br = smin(br, sdEll(x, y, z, 0.188, -0.152, 0.020, 0.033, 0.031, 0.031), 0.024);

    d = smin(d, Math.min(bl, br), 0.036);
  }

  /* — Cuello y cabeza — */
  d = smin(d, sdCone(x, y, z, 0, 0.400, 0, 0, 0.520, 0.008, 0.036, 0.034), 0.038);
  d = smin(d, sdEll(x, y, z, 0, 0.600, 0.018, 0.066, 0.080, 0.070), 0.034);   // cráneo
  d = smin(d, sdEll(x, y, z, 0, 0.554, 0.046, 0.040, 0.038, 0.042), 0.026);   // mentón

  /* — Rasgos. Solo la nariz, y pequeña. Los pómulos como elipsoides sueltos
       se leían como dos bultos pegados a la cara: a esta escala la cara ocupa
       unos 15 puntos de ancho y cualquier volumen que se le añada compite con
       la nariz en vez de acompañarla. El relieve de la mejilla lo da la luz
       sobre la esfera del cráneo, que ya está ahí. — */
  d = smin(d, sdCone(x, y, z, 0, 0.610, 0.094, 0, 0.588, 0.104, 0.007, 0.004), 0.007);  // nariz
  /* Cuencas: se RESTAN. Un hueco lee como ojo en sombra; un bulto, como una
     verruga. Es la única forma de sugerir mirada a esta densidad. */
  d = smax(d, -sdEll(ax, y, z, 0.024, 0.616, 0.086, 0.014, 0.009, 0.012), 0.010);

  /* — Yelmo — */
  {
    let casco = sdEll(x, y, z, 0, 0.652, 0.006, 0.086, 0.084, 0.086);
    /* Ventana facial. Sin restarla, el casco envuelve la cabeza entera y la
       valquiria se queda literalmente sin cara: la esfera del yelmo es más
       grande que la del cráneo en las tres direcciones, así que la piel nunca
       llega a ser superficie y no hay nada que muestrear.

       Ovalada, no una caja: la caja deja dos aristas verticales a los lados de
       la cara que, con el nasal en medio, leen como un hocico. */
    casco = smax(casco, -sdEll(x, y, z, 0, 0.592, 0.092, 0.050, 0.047, 0.064), 0.012);
    d = smin(d, casco, 0.028);
  }
  /* Carrilleras pegadas a la mandíbula. Despegadas parecen orejas. */
  d = smin(d, sdEll(ax, y, z, 0.064, 0.586, 0.012, 0.020, 0.046, 0.048), 0.020);

  /* — Cuerno y alas del yelmo — */
  d = smin(d, sdCuerno(x, y, z), 0.012);
  if (y > 0.55 && ax > 0.028) d = smin(d, sdAlas(ax, y, z), 0.014);

  /* — Lanza — */
  d = Math.min(d, sdLanza(x, y, z));

  /* — Capa — */
  d = smin(d, sdCapa(x, y, z), 0.030);

  return d;
}

/* De qué está hecho cada punto de la valquiria.
   El orden importa: lo que se comprueba antes gana. Los dedos envuelven el
   asta, así que la mano tiene que preguntarse antes que la lanza o la
   empuñadura sale con nudillos de bronce. */
function matValquiria(x, y, z) {
  const ax = Math.abs(x);

  /* Mano sobre el asta */
  if (sdEll(x, y, z, LANZA_X, 0.055, LANZA_Z, 0.040, 0.038, 0.038) < 0.014) return MAT.PIEL;

  /* Lanza: asta oscura, hoja de marfil con nervio dorado, herrajes dorados */
  if (sdLanza(x, y, z) < 0.014) {
    if (y > 0.885) {
      /* El nervio central de la hoja: una línea de oro que sube hasta la
         punta, como el canal grabado de la referencia. */
      if (Math.abs(x - LANZA_X) < 0.006 && y < 1.10) return MAT.ORO;
      return MAT.MARFIL;
    }
    if (y > 0.852 || (y > 0.082 && y < 0.124) || y < -0.895) return MAT.ORO;
    return MAT.ASTA;
  }

  /* Capa */
  if (sdCapa(x, y, z) < 0.014) return MAT.CAPA;

  /* Forro interior del faldar: tela oscura entre las placas. Se pregunta por
     la misma superficie que lo dibuja; los puntos de las placas caen fuera de
     su cáscara y conservan su marfil. */
  if (y < -0.055 && y > -0.272 &&
      sdCone(x, y, z, 0, -0.060, 0, 0, -0.262, 0, 0.116, 0.152) < 0.010) return MAT.CAPA;

  /* Piel: cara dentro del yelmo, brazos por encima del codo y muslos entre
     el faldar y las botas. Es lo que le da temperatura a la pieza. */
  if (z > 0.038 && y > 0.548 && y < 0.640 && ax < 0.052) return MAT.PIEL;
  if (y > 0.180 && y < 0.336 &&
      Math.min(sdCone(x, y, z, -0.158, 0.345, 0.010, -0.226, 0.200, 0.040, 0.038, 0.031),
               sdCone(x, y, z,  0.158, 0.345, 0.000,  0.192, 0.100, 0.015, 0.038, 0.031)) < 0.016)
    return MAT.PIEL;
  /* Muslo desnudo entre el faldar y la bota, como en la referencia: la bota
     armada empieza justo encima de la rodilla. */
  if (y < -0.285 && y > -0.455) return MAT.PIEL;

  /* — Oro: filos y molduras. Bandas estrechas a alturas concretas; a este
       paso de muestreo cada banda son dos hileras de puntos y se lee como una
       línea grabada, no como un cinturón.

       Cada banda lleva su acotación en X. Sin ella, una banda pensada para la
       gola aparece también como un anillo alrededor de los dos brazos, que
       pasan por esa misma altura: la pieza acaba pareciendo dorada a rayas. — */
  if (y > 0.636 && y < 0.654 && z > 0.015 && ax < 0.088) return MAT.ORO;    // ceja del yelmo
  if (sdEll(ax, y, z, 0.068, 0.662, -0.010, 0.034, 0.039, 0.039) < 0.010) return MAT.ORO; // base del ala
  if (y > 0.700 && y < 0.762 && sdCuerno(x, y, z) < 0.012) return MAT.ORO;  // base del cuerno
  if (y > 0.392 && y < 0.410 && ax < 0.105) return MAT.ORO;                 // gola
  if (y > 0.012 && y < 0.034 && ax < 0.160) return MAT.ORO;                 // cinturón
  if (y > -0.302 && y < -0.282 && ax < 0.210) return MAT.ORO;               // filo del faldar
  if (y > -0.478 && y < -0.457 && ax < 0.150) return MAT.ORO;               // filo de la bota
  if (y > -0.912 && y < -0.894 && ax < 0.150) return MAT.ORO;               // tobillo

  /* Quilla del peto */
  if (sdCone(ax, y, z, 0.0, 0.340, 0.095, 0.0, 0.100, 0.080, 0.011, 0.008) < 0.010) return MAT.ORO;

  /* Galones en V sobre el abdomen, como en la referencia */
  if (z > 0.030 && y > -0.075 && y < 0.230 && ax < 0.150) {
    const v = (y + 0.55 * ax) + 10;
    if (Math.abs((v % 0.088) - 0.044) < 0.009) return MAT.ORO;
  }

  return MAT.MARFIL;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · VALQUIRIA IA — la cyborg
   ───────────────────────────────────────────────────────────────────────────
   Busto que levita sobre una base de anillos. Mitad guerrera, mitad máquina:
   el yelmo conserva las alas, pero hechas de segmentos separados —datos, no
   plumas—; el pecho lleva un núcleo con anillo; y una órbita inclinada la
   envuelve. No tiene piernas a propósito: no camina, procesa.
   ═══════════════════════════════════════════════════════════════════════════ */
function cyborg(x, y, z) {
  const ax = Math.abs(x);
  let d = LEJOS;

  /* — Órbita: dos anillos inclinados. Se evalúan primero y aparte porque
       viven en el volumen exterior, donde no hay nada más que fundir. — */
  {
    const ca = Math.cos(0.40), sa = Math.sin(0.40);
    const oy = y * ca - z * sa, oz = y * sa + z * ca;
    let o = sdToroY(x, oy, oz, 0, 0.150, 0, 0.452, 0.0118);
    const cb = Math.cos(-0.34), sb = Math.sin(-0.34);
    const py = y * cb - x * sb, px = y * sb + x * cb;
    o = Math.min(o, sdToroY(px, py, z, 0, 0.150, 0, 0.386, 0.0080));
    d = o;
  }

  /* — Peana: anillos escalonados que se abren hacia abajo, unidos al busto
       por un tallo. Sostienen la figura sin que ella toque nada: no camina,
       procesa. Sueltos y separados se leen como rayas, no como pedestal. — */
  if (y < -0.12) {
    let b = sdCone(x, y, z, 0, -0.150, 0, 0, -0.318, 0, 0.030, 0.040);   // tallo
    b = smin(b, sdToroY(x, y, z, 0, -0.330, 0, 0.128, 0.0180), 0.030);
    b = smin(b, sdToroY(x, y, z, 0, -0.386, 0, 0.208, 0.0165), 0.026);
    b = Math.min(b, sdToroY(x, y, z, 0, -0.438, 0, 0.288, 0.0150));
    /* tres radios que atan los anillos entre sí */
    const s = sector(x, z, 3, 0.4);
    b = smin(b, sdBox(s.x, y, s.z, 0.208, -0.386, 0, 0.098, 0.013, 0.013, 0.006), 0.02);
    d = Math.min(d, b);
  }

  /* Todo lo que sigue es el busto. Fuera de esta esfera no hay nada que
     calcular, y son ~40 primitivas ahorradas por muestra. */
  if (fuera(x, y, z, 0, 0.24, 0, 0.72)) return d;

  /* — Torso: mismo lenguaje que la valquiria, terminado en punta sobre la
       peana en vez de en piernas. — */
  let c = sdEll(x, y, z, 0, 0.196, 0, 0.162, 0.162, 0.112);
  c = smin(c, sdEll(x, y, z, 0, 0.026, 0, 0.110, 0.096, 0.082), 0.10);
  c = smin(c, sdCone(x, y, z, 0, 0.010, 0, 0, -0.166, 0, 0.098, 0.036), 0.085);

  /* — Costillas de la coraza en el flanco mecánico (x < 0). La repetición
       vertical es lo que distingue la placa del músculo. — */
  if (x < 0.02 && y > 0.06 && y < 0.32) {
    const franja = Math.abs(((y + 10) % 0.046) - 0.023) - 0.0095;
    const piel = sdEll(x, y, z, 0, 0.196, 0, 0.166, 0.166, 0.116);
    c = smin(c, Math.max(piel - 0.011, franja), 0.011);
  }

  /* — Núcleo: esfera en el esternón con su anillo. El punto que la mirada
       busca primero, y el que late en la animación. — */
  c = smin(c, sdEll(x, y, z, 0, 0.232, 0.094, 0.052, 0.052, 0.040), 0.040);
  c = smin(c, sdToroY(x, z - 0.104, y - 0.232, 0, 0, 0, 0.076, 0.009), 0.016);

  /* — Hombreras: placas angulares, no domos. La geometría delata la máquina. — */
  c = smin(c, sdBox(ax, y, z, 0.152, 0.344, 0, 0.038, 0.030, 0.058, 0.042), 0.046);
  c = smin(c, sdBox(ax, y, z, 0.176, 0.286, 0, 0.030, 0.022, 0.044, 0.030), 0.034);

  /* — Brazos: sólo hasta el codo. Se pierden dentro de la órbita. — */
  if (y > 0.08 && y < 0.40) {
    c = smin(c, sdCone(ax, y, z, 0.172, 0.330, 0.004, 0.230, 0.152, 0.012, 0.046, 0.035), 0.042);
  }

  /* — Cuello y cabeza — */
  c = smin(c, sdCone(x, y, z, 0, 0.340, 0, 0, 0.458, 0.004, 0.040, 0.036), 0.042);
  c = smin(c, sdEll(x, y, z, 0, 0.548, 0.010, 0.074, 0.088, 0.076), 0.038);
  c = smin(c, sdEll(x, y, z, 0, 0.584, 0, 0.090, 0.084, 0.090), 0.036);            // yelmo
  c = smin(c, sdLaminaZ(x, y, z, 0, 0.582, 0.072, 0, 0.474, 0.082, 0.016, 0.010, 2.4), 0.024);

  /* Placa facial: la mitad derecha del rostro es panel, con su ranura de
     visor. Se resta, así que la cara queda partida en dos lecturas. */
  if (x > -0.02 && y > 0.48) {
    c = smin(c, sdBox(x, y, z, 0.042, 0.540, 0.056, 0.044, 0.050, 0.038, 0.015), 0.026);
    c = smax(c, -sdBox(x, y, z, 0.046, 0.556, 0.090, 0.034, 0.007, 0.026, 0.003), 0.010);
  }

  /* — Alas del yelmo en segmentos: cinco barras por lado, cada una más corta
       y más separada, despegadas del casco. Misma dirección barrida que la
       valquiria; aquí son plumas de datos, no de ave. — */
  if (y > 0.46 && ax > 0.05) {
    let w = LEJOS;
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const x0 = 0.078 + t * 0.030, y0 = 0.586 - t * 0.052, z0 = -0.004 + t * 0.014;
      const lar = 0.222 - t * 0.062;
      const x1 = x0 + lar * 0.62, y1 = y0 + lar * 0.26, z1 = z0 - lar * 0.74;
      const gr = 0.022 - t * 0.005;
      /* el segmento arranca despegado del casco: el hueco es el efecto */
      const sx = x0 + (x1 - x0) * 0.18, sy = y0 + (y1 - y0) * 0.18, sz = z0 + (z1 - z0) * 0.18;
      w = Math.min(w, sdLaminaY(ax, y, z, sx, sy, sz, x1, y1, z1, gr, gr * 0.22, 3.4));
    }
    c = Math.min(c, w);
  }

  /* — Trenza de datos: cable segmentado que baja por la espalda. — */
  if (z < -0.02 && ax < 0.13) {
    let t = sdCone(ax, y, z, 0.026, 0.556, -0.070, 0.046, 0.280, -0.132, 0.017, 0.022);
    t = smin(t, sdCone(ax, y, z, 0.046, 0.280, -0.132, 0.034, 0.060, -0.146, 0.022, 0.015), 0.026);
    const nudo = Math.abs(((y + 10) % 0.052) - 0.026) - 0.012;
    c = smin(c, smax(t, -nudo, 0.007), 0.030);
  }

  return Math.min(d, c);
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · MOLAR — Valquiria Dental
   ───────────────────────────────────────────────────────────────────────────
   Molar inferior: corona con cuatro cúspides reales, surco oclusal en cruz,
   línea cervical marcada y dos raíces que se curvan hacia distal con el ápice
   afilado. Es la pieza que el cliente reconoce, así que la anatomía importa
   más aquí que en ninguna otra.
   ═══════════════════════════════════════════════════════════════════════════ */
function diente(x, y, z) {
  /* Sin `ax`/`az`: este molar ya no se construye por espejo. Un molar inferior
     no es simétrico —la cúspide distal es menor y desplaza a las demás— y
     replicar cuadrantes obligaba a que lo fuera. */

  /* ── CORONA ───────────────────────────────────────────────────────────────
     Caja redondeada de verdad. La que había declaraba un radio de redondeo de
     0.185 sobre una semialtura de 0.170: el radio se comía la caja entera y lo
     que quedaba era una cápsula. De ahí que la corona se leyera como un globo
     en vez de como un molar, que es un cuerpo con cuatro caras planas —
     vestibular, lingual, mesial y distal — y una tabla oclusal arriba. */
  let c = sdBox(x, y, z, 0, 0.455, 0, 0.345, 0.230, 0.315, 0.105);

  /* — Cinco cúspides, que es lo que tiene un primer molar inferior: tres por
       vestibular (mesio, disto y la distal, más pequeña) y dos por lingual.
       Van colocadas una por una y NO con simetría de espejo: si se mira la
       cara oclusal de un molar, lo primero que se ve es que las cúspides no
       están repartidas por igual — la distal es menor y empuja al resto hacia
       mesial. Esa asimetría es la mitad del parecido.

       El filete es corto (0.055). Con el 0.155 de antes las cúspides se
       fundían entre sí y la tabla oclusal salía como una cúpula lisa; lo que
       las hace legibles es la cresta que queda entre una y otra. — */
  const cusp = (cx, cy, cz, rx, ry, rz) => sdEll(x, y, z, cx, cy, cz, rx, ry, rz);
  c = smin(c, cusp(-0.200, 0.640, 0.215, 0.205, 0.165, 0.195), 0.055);  // mesiovestibular
  c = smin(c, cusp( 0.098, 0.632, 0.232, 0.190, 0.155, 0.185), 0.055);  // distovestibular
  c = smin(c, cusp( 0.300, 0.598, 0.060, 0.150, 0.128, 0.165), 0.055);  // distal
  c = smin(c, cusp(-0.208, 0.658, -0.222, 0.200, 0.168, 0.190), 0.055); // mesiolingual
  c = smin(c, cusp( 0.128, 0.648, -0.228, 0.185, 0.158, 0.180), 0.055); // distolingual

  /* — Surcos de la cara oclusal. No es una cruz: en un molar inferior el
       surco principal corre mesio-distal y de él salen ramas hacia vestibular
       y hacia lingual, separando cúspide de cúspide. Restarlos es lo que
       convierte la tabla en una cara masticatoria y no en una meseta. — */
  if (y > 0.50) {
    const principal = sdBox(x, y, z, -0.010, 0.760, 0, 0.400, 0.105, 0.026, 0.016);
    const ramaV = sdBox(x, y, z, -0.048, 0.760, 0.185, 0.026, 0.105, 0.180, 0.016);
    const ramaL = sdBox(x, y, z, -0.038, 0.760, -0.190, 0.026, 0.105, 0.180, 0.016);
    const ramaD = sdBox(x, y, z, 0.212, 0.760, 0.130, 0.024, 0.105, 0.140, 0.014);
    let surcos = smin(principal, ramaV, 0.045);
    surcos = smin(surcos, ramaL, 0.045);
    surcos = smin(surcos, ramaD, 0.040);
    c = smax(c, -surcos, 0.048);
  }

  /* — Línea cervical: el estrechamiento donde la corona entrega a la raíz. La
       corona es más ancha que el cuello, y ese escalón —el contorno de mayor
       convexidad— es lo que hace que un diente se vea asentado en la encía y
       no como una pieza torneada. — */
  const cuello = sdEll(x, y, z, 0, 0.175, 0, 0.315, 0.150, 0.285);
  c = smin(c, cuello, 0.115);

  /* ── RAÍCES ───────────────────────────────────────────────────────────────
     Un molar inferior tiene dos raíces, mesial y distal, y lo que las delata
     en cuanto se ven de frente no es su largo: es que son **cintas**. Anchas
     en sentido vestíbulo-lingual (el eje Z aquí) y delgadas en sentido
     mesio-distal (el eje X). Modeladas como conos de revolución salen como dos
     alfileres redondos, que es exactamente lo que se veía antes.

     Por eso van con sdLaminaX. El aplastado baja hacia el ápice a propósito:
     una raíz real se redondea al terminar, y además —esto es lo que de verdad
     las estaba estropeando— por debajo de cierto grosor la rejilla de muestreo
     ya no las resuelve. Con paso 0.02 la cáscara mide 0.031, así que nada por
     debajo de ~0.08 de espesor llega entero a la pantalla: los radios de 0.009
     que tenían los ápices eran ocho veces más finos que eso y se muestreaban
     a tiras. De ahí venía el aspecto de alambre.

     Longitud: la raíz mide del orden de 1.7 veces la corona, y la mesial es
     algo más larga y más curva que la distal. */
  const K_CINTA = 2.35;   // aplastado mesio-distal del cuerpo de la raíz
  const K_APICE = 1.45;   // el ápice se redondea

  /* Tronco radicular: de la línea cervical a la furca. Las dos raíces salen
     de aquí, no del cuello — sin este tramo común el diente se ve horquillado
     desde la corona misma. */
  let raiz = sdLaminaX(x, y, z, 0, 0.140, 0, 0, -0.090, 0.004, 0.246, 0.226, 1.55);

  /* Mesial (x < 0): más ancha, más larga y con más curva distal. */
  let r = sdLaminaX(x, y, z, -0.078, -0.030, 0.008, -0.196, -0.500, 0.030, 0.198, 0.140, K_CINTA);
  r = smin(r, sdLaminaX(x, y, z, -0.196, -0.500, 0.030, -0.286, -0.870, 0.046, 0.140, 0.086, K_CINTA), 0.075);
  r = smin(r, sdLaminaX(x, y, z, -0.286, -0.870, 0.046, -0.330, -1.010, 0.052, 0.086, 0.052, K_APICE), 0.060);

  /* Distal (x > 0): más estrecha, más corta y casi recta. */
  let r2 = sdLaminaX(x, y, z, 0.078, -0.030, -0.006, 0.180, -0.470, -0.024, 0.182, 0.128, K_CINTA);
  r2 = smin(r2, sdLaminaX(x, y, z, 0.180, -0.470, -0.024, 0.252, -0.810, -0.036, 0.128, 0.080, K_CINTA), 0.075);
  r2 = smin(r2, sdLaminaX(x, y, z, 0.252, -0.810, -0.036, 0.288, -0.940, -0.040, 0.080, 0.050, K_APICE), 0.060);

  /* Concavidad furcal: la depresión longitudinal en la cara que cada raíz le
     da a la otra. Es de las cosas que más se notan en un molar real y la que
     antes estaba mal: el surco se evaluaba con la X clavada en cero, así que
     en vez de un canal siguiendo el eje de cada raíz abría una banda
     atravesando las dos por igual. Ahora cada raíz lleva el suyo, paralelo a
     su propio eje y asomando apenas por la cara interna. */
  {
    const surcoM = sdCone(x, y, z, -0.036, -0.060, 0.006, -0.150, -0.800, 0.034, 0.062, 0.034);
    r = smax(r, -surcoM, 0.055);
    const surcoD = sdCone(x, y, z, 0.038, -0.060, -0.004, 0.140, -0.760, -0.028, 0.058, 0.032);
    r2 = smax(r2, -surcoD, 0.055);
  }

  /* La furca: el punto donde el tronco se abre en dos. Filete corto — con uno
     ancho las raíces se funden en una pala y desaparece justo el hueco que
     hace que se lean como dos. */
  const raices = smin(raiz, smin(r, r2, 0.055), 0.070);

  return smin(c, raices, 0.105);
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · ENGRANE — Valquiria 3D
   ───────────────────────────────────────────────────────────────────────────
   Corona dentada, alma aligerada con radios, buje central elevado y cuñero.
   Una pieza que se ve maquinada, no dibujada.
   ═══════════════════════════════════════════════════════════════════════════ */
function engrane(x, y, z) {
  const r = Math.hypot(x, y);

  /* — Corona: un ANILLO, no un disco. Con Math.max(r - R, ...) el interior
       queda sólido y el engrane se lee como una moneda dentada; hay que
       vaciarlo con Math.abs(r - R) para que existan las ventanas. — */
  const corona = Math.max(Math.abs(r - 0.548) - 0.058, Math.abs(z) - 0.084) - 0.016;
  const s = sector(x, y, 16, 0);
  const diente_ = sdBox(s.x, s.z, z, 0.652, 0, 0, 0.058, 0.048, 0.082, 0.024);
  let g = smin(corona, diente_, 0.026);

  /* — Cinco radios que atan el buje con la corona. Entre ellos, las ventanas
       de aligeramiento: el vacío es parte de la pieza. — */
  const s2 = sector(x, y, 5, 0.31);
  g = smin(g, sdBox(s2.x, s2.z, z, 0.330, 0, 0, 0.190, 0.046, 0.046, 0.018), 0.045);

  /* — Buje central, más grueso que los radios. — */
  const buje = Math.max(r - 0.178, Math.abs(z) - 0.118) - 0.018;
  g = smin(g, buje, 0.042);

  /* — Barreno pasante y cuñero. — */
  g = smax(g, -Math.max(r - 0.094, Math.abs(z) - 0.5), 0.014);
  g = smax(g, -sdBox(x, y, z, 0, 0.112, 0, 0.024, 0.032, 0.5, 0.004), 0.009);

  return g;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · BLÍSTER TERMOFORMADO — Valquiria Pack
   ───────────────────────────────────────────────────────────────────────────
   Charola termoformada para un producto que cualquiera reconoce: un celular.
   Brida perimetral, meseta elevada con la cavidad del teléfono hundida (con
   su isla de cámara), lengüeta de apertura y —la firma— un medallón con la V
   de Valquiria en relieve, como el sello que un molde propio deja en la
   lámina. Se muestra en diagonal para que se lea el volumen.

   Todo son cajas y filetes generosos a propósito: el termoformado ES radios
   suaves sobre un molde, así que el medio (SDF) y el objeto coinciden. Los
   rasgos nunca bajan de ~0.06 de espesor, que es lo que la rejilla de 0.02
   resuelve sin deshacerse en tiras.
   ═══════════════════════════════════════════════════════════════════════════ */
/* Inclinación de la charola. Es el número que decide si la pieza se lee:
   una bandeja apoyada plana se ve de canto —una losa— y todo el trabajo de
   las cavidades se pierde. Inclinada ~40° la cámara mira DENTRO, que es
   como se fotografía un empaque. */
/* El signo del cabeceo importa y no es evidente: se rota el PUNTO DE
   CONSULTA, así que la pieza gira al revés. En positivo la charola enseña
   el fondo —una losa lisa— y todo el detalle queda escondido. */
const PACK_GIRO = 0.34;     // yaw: ninguna cara queda frontal
const PACK_ALZA = -0.60;    // pitch: inclina la boca hacia la cámara

function empaque(px, py, pz) {
  /* La charola es un objeto BAJO (un teléfono es delgado) y el marco de la
     escena espera piezas que vivan alrededor del centro: se alza completa
     antes de rotar, o queda hundida en el tercio inferior de la pantalla. */
  py -= 0.30;
  const ca = Math.cos(PACK_GIRO), sa = Math.sin(PACK_GIRO);
  let x = px * ca + pz * sa, z = -px * sa + pz * ca, y = py;
  const cb = Math.cos(PACK_ALZA), sb = Math.sin(PACK_ALZA);
  const y2 = y * cb - z * sb; z = y * sb + z * cb; y = y2;

  /* — Brida perimetral: el marco plano que sale de la termoformadora. — */
  const brida = sdBox(x, y, z, 0, -0.520, 0, 0.505, 0.020, 0.360, 0.030);

  /* — Meseta: el volumen formado que sube de la brida. Radios anchos: una
       pared vertical perfecta no existe en termoformado (ángulo de desmoldeo)
       y el filete gordo lo cuenta. — */
  const meseta = sdBox(x, y, z, -0.010, -0.415, 0, 0.430, 0.085, 0.290, 0.075);
  let cuerpo = smin(brida, meseta, 0.060);

  /* — Lengüeta de apertura en una esquina de la brida. — */
  cuerpo = smin(cuerpo, sdBox(x, y, z, 0.548, -0.520, 0.255, 0.072, 0.017, 0.066, 0.024), 0.032);

  /* — Cavidad del celular: rectángulo redondeado 2.4:1, hundido y profundo.
       Es EL rasgo que hace legible la pieza. La caja de resta rebasa la
       meseta por arriba para que la cavidad quede abierta. — */
  const cavidad = sdBox(x, y, z, -0.105, -0.320, -0.110, 0.310, 0.130, 0.112, 0.036);
  cuerpo = smax(cuerpo, -cavidad, 0.030);

  /* — Los dos compartimentos de accesorios: el canal largo del cable y el
       pozo cuadrado del cargador. Un empaque de celular tiene ambos, y
       tenerlos es lo que separa "una charola" de "la charola de un
       teléfono". — */
  const canal = sdBox(x, y, z, -0.230, -0.356, 0.140, 0.185, 0.098, 0.070, 0.030);
  cuerpo = smax(cuerpo, -canal, 0.024);
  const pozo = sdBox(x, y, z, 0.075, -0.356, 0.140, 0.090, 0.098, 0.078, 0.030);
  cuerpo = smax(cuerpo, -pozo, 0.024);

  /* — Isla de cámara: el escalón dentro de la cavidad que sostiene el módulo
       de cámaras. Se suma DESPUÉS de restar, para que emerja del fondo. — */
  cuerpo = smin(cuerpo, sdBox(x, y, z, -0.330, -0.398, -0.110, 0.058, 0.042, 0.072, 0.022), 0.026);

  /* — Sello Valquiria: medallón en relieve sobre la meseta, con la V encima.
       Trazos gruesos a propósito: a esta rejilla un trazo fino sale roto, y
       un sello troquelado real también es bold. — */
  const sx = 0.305, sy = -0.330, sz2 = -0.020;
  const medallon = sdEll(x, y, z, sx, sy, sz2, 0.150, 0.040, 0.190);
  cuerpo = smin(cuerpo, medallon, 0.030);
  /* La V va tumbada sobre el medallón —con la charola alzada 34° la cara de
     arriba mira a la cámara, así que un relieve plano sí se lee— y con el
     VÉRTICE HACIA EL FRENTE (+z). Apuntando de lado se leía como un ">". */
  const vTop = sy + 0.060;
  let v = sdCone(x, y, z, sx - 0.108, vTop, sz2 - 0.118, sx, vTop, sz2 + 0.132, 0.046, 0.036);
  v = Math.min(v, sdCone(x, y, z, sx + 0.108, vTop, sz2 - 0.118, sx, vTop, sz2 + 0.132, 0.046, 0.036));
  cuerpo = smin(cuerpo, v, 0.016);

  return cuerpo;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6 · LÁMPARA VOXEL — Valquiria Lux
   ───────────────────────────────────────────────────────────────────────────
   La misma campana de siempre, reconstruida en 8-bit: la superficie de
   revolución se cuantiza a una rejilla de cubos y cada voxel queda separado
   de sus vecinos por un surco — arte pixel hecho volumen. El foco y el cordón
   se quedan LISOS a propósito: el contraste entre la esfera tersa y la
   pantalla pixelada es lo que cuenta la historia ("esto solo existe porque se
   imprime").

   Cómo se voxeliza sin romper el muestreador: para cada punto se localiza el
   centro de su celda y se devuelve max(caja de la celda, campana EN EL
   CENTRO). En celda llena manda la caja (cubo perfecto); en celda vacía manda
   la campana evaluada en el centro, que es positiva y crece con la distancia.
   Como la campana es 1-Lipschitz, evaluarla en el centro en vez de en el
   punto se desvía a lo sumo media diagonal de celda —VOX·√3/2 ≈ 0.087—, y
   ese error queda por debajo del margen con que el muestreador descarta
   bloques. Si subes VOX, revisa esa cuenta: pasado el margen, la pieza
   empieza a salir con agujeros.
   ═══════════════════════════════════════════════════════════════════════════ */
/* Los peldaños de la pantalla: [semiancho exterior, altura del centro].
   Seis, no veinte. La lección que costó dos intentos: a la escala a la que
   esta pieza se ve —la pantalla mide unos 160 px— la nube de puntos solo
   comunica la SILUETA. Un enrejado de cubos finos se ve precioso en un
   render y se deshace en una mancha cónica en la nube. Para que la pieza se
   lea 8-bit, el escalón tiene que estar en el contorno y medir del orden de
   diez píxeles: de ahí seis peldaños con saltos de ~0.07. */
const LUX_PELDANOS = [
  [0.520, -0.395],
  [0.418, -0.240],
  [0.318, -0.085],
  [0.216,  0.070]
];
const LUX_ALTO = 0.079;    // semialtura de cada peldaño (se tocan entre sí)
const LUX_PARED = 0.062;   // espesor de la pared: es una pantalla, no un macizo

function lampara(x, y, z) {
  /* — Canopy y cordón: cuadrados también. El lenguaje voxel llega hasta el
       techo; un cilindro aquí delataría que la pantalla es un truco. — */
  let d = sdBox(x, y, z, 0, 0.735, 0, 0.090, 0.026, 0.090, 0.010);
  d = Math.min(d, sdBox(x, y, z, 0, 0.679, 0, 0.056, 0.030, 0.056, 0.008));
  d = Math.min(d, sdBox(x, y, z, 0, 0.410, 0, 0.026, 0.270, 0.026, 0.004));

  /* — Pantalla: cuatro tubos cuadrados que se estrechan al subir. Cuatro y
       no seis, y MÁS ANCHA QUE ALTA (1.04 de boca por 0.62 de alto): con
       peldaños pequeños y muchos, la pieza deja de leerse como lámpara y se
       lee como zigurat. La proporción es lo que dice «pantalla».
       Se unen con Math.min —NO con smin—: el filete redondearía justo la
       arista viva que hace el efecto de pixel. — */
  if (y < 0.20 && y > -0.50) {
    for (let i = 0; i < LUX_PELDANOS.length; i++) {
      const w = LUX_PELDANOS[i][0], cy = LUX_PELDANOS[i][1];
      const fuera = sdBox(x, y, z, 0, cy, 0, w, LUX_ALTO, w, 0.014);
      /* El hueco rebasa el peldaño en altura para que quede pasante: una
         pantalla cerrada por arriba y por abajo es un cubo, no una lámpara. */
      const hueco = sdBox(x, y, z, 0, cy, 0, w - LUX_PARED, LUX_ALTO + 0.08,
                          w - LUX_PARED, 0.010);
      d = Math.min(d, Math.max(fuera, -hueco));
    }
  }

  /* — Portalámparas y foco, ASOMANDO POR DEBAJO de la boca. Es el detalle
       que convierte una pantalla en una lámpara: sin bombilla visible, el
       objeto es una pieza de cerámica colgada. El foco es además la única
       curva de toda la pieza, y ese contraste con la escalera es lo que
       cuenta la historia — esto solo existe porque se imprime. — */
  d = Math.min(d, sdBox(x, y, z, 0, -0.520, 0, 0.082, 0.075, 0.082, 0.010));
  d = Math.min(d, sdEll(x, y, z, 0, -0.735, 0, 0.152, 0.170, 0.152));

  return d;
}

/* ═══════════════════════════════════════════════════════════════════════════
   REGISTRO
   ───────────────────────────────────────────────────────────────────────────
   modo → cómo respira la pieza una vez impresa:
     0 humanoide (peso, respiración, mira al visitante)
     1 colgante (péndulo desde arriba)
     2 giro lento sobre su eje
     3 quieto
     4 IA (levita, la órbita gira más rápido que el cuerpo, el núcleo late)
   mm → la cota real que se muestra en el riel mientras imprime.
   ═══════════════════════════════════════════════════════════════════════════ */
const FIGURAS = {
  /* `paso` afina la rejilla solo para esta figura. Quitar la capa recortó el
     bounding box lo suficiente como para muestrear más fino sin costar más
     tiempo de arranque, y esa densidad extra es justo lo que hace que la
     pieza central se lea definida y no como una nube. `solida` la marca como
     la única que se cura en resina al terminar de imprimirse. */
  valquiria: {
    fn: valquiria, mat: matValquiria, modo: 0, dist: 4.8, mm: 180,
    nombre: 'Valquiria',
    /* La malla esculpida. `encaje` y `alza` la ajustan al marco de la SDF:
       esta figura procedural reserva el tercio superior para la lanza, que la
       malla no trae, y sin corregirlo saldría enorme. Ver MODELO.md. */
    glb: 'assets/valquiria.glb', encaje: 0.74, alza: 0.19,
    /* Es la única pieza que se cura en resina al terminar: deja de ser nube y
       pasa a superficie sombreada. Por eso pide su propia rejilla —los puntos
       tienen que solaparse para que la piel se lea continua— y por eso es la
       única que trae función de material.

       `pasoMovil` existe porque el paso grueso del móvil (0.027) sirve para
       una nube pero no para una superficie: a esa densidad los discos miden
       más que los dedos de la figura y la pieza curada sale de palomitas.
       0.0125 cuesta medio segundo de muestreo y ~60 k puntos, que un teléfono
       de hoy dibuja sin despeinarse. */
    paso: 0.0064, pasoMovil: 0.0115, solida: true,
    bb: { x0: -.37, x1: .37, y0: -1.05, y1: 1.17, z0: -.30, z1: .19 }
  },
  /* ── Las dos que ESPERAN malla ──────────────────────────────────────────
     Estas dos figuras están declaradas con `glb` y `solida` aunque el archivo
     puede no existir todavía. No es un descuido: el día que el .glb aparezca
     en assets/ la pieza pasa a ser esculpida sin tocar una línea de código, y
     mientras tanto la SDF de abajo sigue siendo lo que se ve. El costo de la
     espera es un 404 la primera vez que se visita la sección, y nada más.

     Por qué estas dos y no las otras: son las únicas cuyo tema es ANATOMÍA y
     PERSONAJE. Una función de distancia construida a base de elipsoides
     fundidos da muy bien un engrane, una charola o una lámpara escalonada
     —geometría de taller— y no da un molar reconocible ni una guerrera
     cibernética. Ahí la SDF llega a "caja con dos palillos", y eso no es
     material de portada. */
  cyborg: {
    fn: cyborg, modo: 4, dist: 5.0, mm: 240, nombre: 'Valquiria IA',
    glb: 'assets/cyborg.glb',
    /* `encaje` y `alza` aquí corrigen lo contrario que en la valquiria: aquel
       marco sobraba y este falta. La SDF es un BUSTO sobre una peana, con dos
       anillos de órbita que ocupan el ancho de la caja pero no su alto; la
       malla es la figura COMPLETA, de pie. Encajada tal cual en un marco de
       1.26 salía al 47 % de la pantalla contra el 65 % de la valquiria del
       hub, y son el mismo personaje: leerlo más pequeño en la sección que
       vende IA lo hacía parecer el hermano menor.
       1.357 lo lleva a 1.71 de alto, que a `dist` 5.0 subtiende lo mismo que
       los 1.64 de la valquiria a 4.8. El `alza` negativo baja el apoyo a
       y=-0.895 para que las dos pisen la plataforma a la misma altura. */
    encaje: 1.357, alza: -0.425,
    /* La sección /ia imprime al 94 % a propósito («EN BETA · CAPA 161 DE
       171»). Sin holgura ese 6 % que falta se lo lleva la cabeza. Ver la
       explicación larga en `pedirMalla` de escena.js. */
    holgura: 1.07,
    bb: { x0: -.49, x1: .49, y0: -.47, y1: .79, z0: -.52, z1: .45 }
  },
  diente: {
    fn: diente, modo: 3, dist: 5.0, mm: 20.7, nombre: 'Molar',
    glb: 'assets/diente.glb',
    /* `encajar()` normaliza por ALTURA y centra en X/Z; el ancho sale de la
       proporción de la malla y no se comprueba contra nada. Este molar es más
       rechoncho que la SDF —0.69 de ancho por alto contra 0.62— así que
       encajado a la altura completa medía 1.38 de ancho en una caja de 1.24 y
       se metía debajo del titular: el texto quedaba sobre marfil brillante y
       dejaba de leerse. 0.88 lo deja en 1.21 de ancho, dentro de la caja, y el
       `alza` lo recentra en el hueco que libera. */
    encaje: 0.88, alza: 0.12,
    bb: { x0: -.62, x1: .62, y0: -1.10, y1: .90, z0: -.56, z1: .56 }
  },
  engrane: {
    fn: engrane, modo: 2, dist: 5.2, mm: 64, nombre: 'Engrane',
    bb: { x0: -.76, x1: .76, y0: -.76, y1: .76, z0: -.16, z1: .16 }
  },
  empaque: {
    fn: empaque, modo: 3, dist: 3.6, mm: 52, nombre: 'Charola',
    bb: { x0: -.57, x1: .75, y0: -.43, y1: .31, z0: -.81, z1: .31 }
  },
  lampara: {
    fn: lampara, modo: 1, dist: 4.7, mm: 210, nombre: 'Lámpara voxel',
    bb: { x0: -.56, x1: .56, y0: -.93, y1: .80, z0: -.56, z1: .56 }
  }
};

export { FIGURAS, MAT };
