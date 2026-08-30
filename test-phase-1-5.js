/**
 * Controles de contrato para la convergencia SEO + experiencia de Fase 1.5.
 * Cero dependencias: se ejecutan con Node junto con la suite existente.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}\n      ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function filesUnder(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(absolute, output);
    else output.push(absolute);
  }
  return output;
}

const cleanRoutes = ['/', '/dental/', '/ia/', '/3d/', '/pack/', '/lux/', '/catalogo/'];
const routeFile = route => route === '/' ? 'index.html' : route.slice(1) + 'index.html';
const dental = read('dental/index.html');
const rootHtml = read('index.html');
const divisionCss = read('assets/css/division-page.css');

console.log('\n[FASE 1.5] Rutas y SEO');

test('todas las rutas canónicas tienen un documento HTML', () => {
  cleanRoutes.forEach(route => {
    assert(fs.existsSync(path.join(ROOT, routeFile(route))), `Falta ${route}`);
  });
});

test('/dental/ conserva canonical, robots y datos estructurados', () => {
  assert(dental.includes('<link rel="canonical" href="https://valquiriainc.com/dental/">'), 'Canonical Dental incorrecta');
  assert(dental.includes('name="robots" content="index,follow,max-image-preview:large"'), 'Falta robots indexable');
  assert(dental.includes('"@type":"BreadcrumbList"'), 'Falta BreadcrumbList');
  assert(dental.includes('"@type":"WebPage"'), 'Falta WebPage');
});

test('el sitemap usa sólo URLs limpias y ninguna ruta hash', () => {
  const sitemap = read('sitemap.xml');
  assert(!sitemap.includes('/#/'), 'El sitemap contiene una ruta legacy');
  const sitemapRoutes = ['/', '/dental/', '/ia/', '/3d/', '/pack/', '/lux/'];
  sitemapRoutes.forEach(route => {
    const url = `https://valquiriainc.com${route}`;
    assert(sitemap.includes(`<loc>${url}</loc>`), `Falta ${url}`);
  });
});

test('la navegación pública principal no enlaza rutas #/', () => {
  const rootNav = rootHtml.match(/<nav id="nav">[\s\S]*?<\/nav>/);
  const mobileNav = rootHtml.match(/<div id="menu"[\s\S]*?<\/div>\s*<\/div>/);
  assert(rootNav && !/href=["']#\//.test(rootNav[0]), 'La navegación desktop de Inicio conserva #/');
  assert(mobileNav && !/href=["']#\//.test(mobileNav[0]), 'La navegación móvil de Inicio conserva #/');

  for (const route of cleanRoutes.slice(1)) {
    const html = read(routeFile(route));
    const nav = html.match(/<nav class="nav[^"]*" aria-label="Principal">[\s\S]*?<\/nav>/);
    assert(nav, `No se encontró navegación principal en ${route}`);
    assert(!/href=["'][^"']*#\//.test(nav[0]), `Navegación legacy en ${route}`);
  }
});

test('los accesos legacy conocidos se reemplazan por su URL limpia', () => {
  const pairs = {
    "'#/dental': '/dental/'": '/dental/',
    "'#/ia': '/ia/'": '/ia/',
    "'#/3d': '/3d/'": '/3d/',
    "'#/pack': '/pack/'": '/pack/',
    "'#/lux': '/lux/'": '/lux/',
    "'#/catalogo': '/catalogo/'": '/catalogo/'
  };
  Object.keys(pairs).forEach(pair => assert(rootHtml.includes(pair), `Falta redirección ${pair}`));
  assert(rootHtml.includes('location.replace(limpias[location.hash])'), 'La redirección no usa replace');
});

console.log('\n[FASE 1.5] HTML útil sin JavaScript');

test('el mensaje principal y los CTA existen en el HTML inicial', () => {
  const withoutScripts = dental.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  [
    'Valquiria Dental',
    'La anatomía se aprende tocándola.',
    'Modelos dentales didácticos para entrenamiento odontológico.',
    'href="/catalogo/"',
    'https://wa.me/527717959131'
  ].forEach(text => assert(withoutScripts.includes(text), `Falta en HTML estático: ${text}`));
});

test('Dental cubre el contenido comercial acordado sin páginas hijas', () => {
  const expected = ['entrenamiento preclínico', 'endodoncia', 'pulpotomía', 'nervio sintético', 'anatomía interna', 'tipodonto Nissin', 'universidades', 'docentes', 'distribuidores', 'producción propia'];
  expected.forEach(term => assert(dental.toLocaleLowerCase('es-MX').includes(term.toLocaleLowerCase('es-MX')), `Falta ${term}`));
  assert(dental.includes('No son dispositivos médicos ni están destinados a uso clínico en pacientes.'), 'Falta declaración didáctica completa');
  assert(!/href=["']\/dental\/dientes-|href=["']\/dental\/kit-/.test(dental), 'Se enlazó una página de producto de Fase 2');
});

test('los cuatro productos reales aparecen y enlazan sólo al catálogo', () => {
  ['ValEnd', 'ValPulpo', 'DientesRealistas', 'Endotnissin'].forEach(sku => {
    assert(dental.includes(sku), `Falta ${sku}`);
  });
  const productLinks = [...dental.matchAll(/class="product-link" href="([^"]+)"/g)].map(match => match[1]);
  assert(productLinks.length === 4, `Se esperaban 4 enlaces de producto; hay ${productLinks.length}`);
  assert(productLinks.every(link => link === '/catalogo/'), 'Un producto no enlaza al catálogo canónico');
});

console.log('\n[FASE 1.5] Teléfono y WhatsApp');

test('no queda el teléfono anterior en archivos públicos o del Asesor', () => {
  const extensions = new Set(['.html', '.js', '.json', '.xml', '.css']);
  const oldPhone = new RegExp(['52', '55', '5467', '5821'].join('[^0-9]*'));
  const offenders = filesUnder(ROOT)
    .filter(file => extensions.has(path.extname(file)) && path.basename(file) !== 'test-phase-1-5.js')
    .filter(file => oldPhone.test(fs.readFileSync(file, 'utf8')))
    .map(file => path.relative(ROOT, file));
  assert(offenders.length === 0, `Teléfono anterior en: ${offenders.join(', ')}`);
});

test('todos los enlaces wa.me usan el número temporal oficial', () => {
  const publicFiles = filesUnder(ROOT).filter(file => ['.html', '.js'].includes(path.extname(file)));
  const invalid = [];
  let count = 0;
  for (const file of publicFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(/wa\.me\/([0-9]+)/g)) {
      count++;
      if (match[1] !== '527717959131') invalid.push(path.relative(ROOT, file) + ':' + match[1]);
    }
  }
  assert(count > 0, 'No se detectaron enlaces de WhatsApp');
  assert(invalid.length === 0, `Números wa.me inconsistentes: ${invalid.join(', ')}`);
});

test('schema, frontend y Asesor contienen el número nuevo', () => {
  assert(rootHtml.includes('"telephone":"+52-771-795-9131"'), 'Organization schema no actualizado');
  assert(dental.includes('"telephone":"+52-771-795-9131"'), 'Schema Dental no actualizado');
  assert(read('assets/js/app.js').includes("whatsapp: '527717959131'"), 'CFG del frontend no actualizado');
  assert(read('conocimiento.js').includes('+52 771 795 9131'), 'Conocimiento del Asesor no actualizado');
  assert(read('server.js').includes('+52 771 795 9131'), 'Backend del Asesor no actualizado');
});

console.log('\n[FASE 1.5] 3D, layout y referencias');

test('Dental usa el motor y el molar existentes con canvas decorativo', () => {
  assert(dental.includes('id="escena"'), 'Falta canvas de escena');
  assert(dental.includes('aria-hidden="true"'), 'El canvas no está oculto a lectores de pantalla');
  assert(dental.includes('href="/assets/diente.glb"'), 'No se precarga el molar existente');
  assert(read('assets/js/division-config.js').includes("figure: 'diente'"), 'La configuración no monta el molar');
  assert(read('assets/js/figuras.js').includes('glb: DENTAL_MODEL'), 'El registro no usa DENTAL_MODEL');
  assert(!read('assets/js/escena.js').includes('const modeloListo = pedirMalla(FIGURA_HUB)'), 'Dental descargaría también la figura del home');
});

test('el layout contiene zonas reservadas y protección de overflow', () => {
  assert(divisionCss.includes('grid-template-areas:"visual copy" "visual actions"'), 'Faltan áreas desktop');
  assert(divisionCss.includes('grid-template-areas:"copy" "visual" "actions"'), 'Falta orden móvil');
  assert(divisionCss.includes('overflow-x:clip'), 'Falta protección de overflow horizontal');
  assert(divisionCss.includes('#escena{position:absolute;inset:0;display:block;width:100%;height:100%'), 'Canvas sin dimensiones reservadas');
  assert(divisionCss.includes('@media(prefers-reduced-motion:reduce)'), 'Falta CSS reduced motion');
  assert(read('assets/css/valquiria.css').includes('#escena{position:fixed; inset:0; width:100%; height:100%'), 'El canvas de Inicio no tiene dimensiones CSS estables');
});

test('todas las referencias locales de Dental existen', () => {
  const refs = [...dental.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1]);
  const broken = [];
  for (const ref of refs) {
    if (/^(?:https?:|mailto:|tel:|#)/.test(ref)) continue;
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) continue;
    let target = clean.startsWith('/') ? clean.slice(1) : path.join('dental', clean);
    if (!target) target = 'index.html';
    if (target.endsWith('/')) target += 'index.html';
    if (!fs.existsSync(path.join(ROOT, target))) broken.push(ref);
  }
  assert(broken.length === 0, `Referencias rotas: ${broken.join(', ')}`);
});

test('Asesor, carrito y pagos existentes siguen presentes', () => {
  ['id="cart-btn"', 'id="drawer"', 'id="asesor-btn"', 'id="asesor"'].forEach(marker => {
    assert(rootHtml.includes(marker), `Falta ${marker} en Inicio`);
  });
  const app = read('assets/js/app.js');
  assert(app.includes('const Carrito'), 'Se eliminó Carrito');
  assert(app.includes('const Asesor'), 'Se eliminó Asesor');
  assert(app.includes("'/api/pago'") || app.includes("+ '/api/pago'"), 'Se perdió la integración de pago');
  assert(dental.includes('>Asesor</a>') && dental.includes('>Carrito</a>'), 'Dental no conserva accesos comerciales');
});

test('Pack y Lux conservan sus modelos y puntos de reemplazo', () => {
  const config = read('assets/js/division-config.js');
  assert(config.includes('PACK_MODEL = null'), 'PACK_MODEL fue sustituido');
  assert(config.includes('LUX_MODEL = null'), 'LUX_MODEL fue sustituido');
  const figures = read('assets/js/figuras.js');
  assert(!/empaque:\s*{[\s\S]*?glb:/.test(figures.match(/empaque:\s*{[\s\S]*?\n  },/)[0]), 'Pack recibió un GLB en esta fase');
  assert(!/lampara:\s*{[\s\S]*?glb:/.test(figures.match(/lampara:\s*{[\s\S]*?\n  }/)[0]), 'Lux recibió un GLB en esta fase');
});

console.log(`\n${passed} pruebas pasaron, ${failed} fallaron.`);
if (failed) process.exit(1);
