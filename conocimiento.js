/**
 * ============================================================================
 *  VALQUIRIA — CAPA DE CONOCIMIENTO  (conocimiento.js v1)
 * ============================================================================
 *  Esta es la "memoria institucional" del Asesor. Aquí vive todo lo que la
 *  empresa sabe y puede afirmar sobre sí misma: las cinco divisiones, los
 *  procesos de manufactura, y —sobre todo— los LÍMITES de lo que se puede
 *  prometer.
 *
 *  POR QUÉ ESTE ARCHIVO EXISTE (y no está todo en el system prompt):
 *
 *  1. El system prompt se envía en CADA llamada. Meter aquí 4,000 tokens de
 *     conocimiento haría cada respuesta más lenta y más cara, y diluiría las
 *     reglas de comportamiento entre datos que casi nunca se usan.
 *  2. El modelo alucina menos cuando el dato llega como resultado de una
 *     herramienta que cuando lo "recuerda" de su prompt. Un dato devuelto por
 *     consultar_division() es evidencia; un dato del prompt es sugerencia.
 *  3. Tú puedes editar este archivo sin tocar el prompt. Cuando Valquiria 3D
 *     abra, cambias `estado` y una línea de texto. Sin reescribir reglas.
 *
 *  REGLA DE ORO PARA EDITAR ESTE ARCHIVO:
 *  Si un dato no lo puedes sostener frente a un cliente que te lo reclame por
 *  escrito, NO lo escribas aquí. El campo `lo_que_no_prometemos` es tan
 *  importante como `capacidades` — es lo que impide que el asesor venda humo.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// CONTEXTO TRANSVERSAL DE LA EMPRESA
// ----------------------------------------------------------------------------

const EMPRESA = {
  clave: "empresa",
  titulo: "Valquiria Inc.",
  que_es:
    "Holding mexicano de manufactura aditiva con cinco divisiones. Todas " +
    "empiezan igual: un archivo, una plataforma, y capas de 100 micras que se " +
    "apilan hasta que la idea pesa en la mano.",
  filosofia: "Innovación · Precisión · Diseño.",
  principios: [
    "Diseñamos, no surtimos. Cada pieza nace de un archivo propio; si no existe el modelo, lo hacemos.",
    "Resina de alta resolución: detalle que aguanta el uso real, no solo la foto del catálogo.",
    "Producción en México, sin intermediarios entre el diseño y lo que le llega al cliente."
  ],
  comercial: {
    moneda: "MXN (pesos mexicanos)",
    envio_gratis_desde: "$999.00 MXN",
    unica_division_con_venta_en_linea: "Valquiria Dental",
    whatsapp: "+52 55 5467 5821",
    correo: "ventas@valquiriadental.com"
  },
  lo_que_no_prometemos: [
    "No damos fechas de entrega exactas por chat. Se confirman con un especialista una vez cerrado el pedido.",
    "No cotizamos por chat divisiones distintas a Dental: se levanta el interés y un especialista responde.",
    "No emitimos facturas ni condiciones fiscales especiales desde el asesor."
  ]
};

// ----------------------------------------------------------------------------
// LAS CINCO DIVISIONES
// ----------------------------------------------------------------------------

const DIVISIONES = {
  // ══════════════════════════════════════════════════════════════════════
  "3d": {
    clave: "3d",
    numero: "División 01",
    titulo: "Valquiria 3D",
    subtitulo: "Manufactura aditiva",
    estado: "EN CONSTRUCCIÓN — no vende en línea todavía",
    promesa: "Prototipos que existen mañana.",
    que_es:
      "Impresión 3D profesional: prototipado rápido, piezas funcionales y " +
      "producción en serie con FDM y resina de alta resolución.",
    capacidades: [
      "FDM para piezas funcionales; resina para detalle fino.",
      "Del archivo a la pieza en obra, con tolerancias medidas (no estimadas a ojo).",
      "Series cortas sin costo de molde — el punto donde la aditiva le gana a la inyección.",
      "Si el modelo no existe, se diseña. No es solo servicio de impresión."
    ],
    preguntas_de_calificacion: [
      "¿Qué función cumple la pieza: prototipo de forma, prototipo funcional, o pieza final?",
      "¿Ya existe archivo 3D (STL/STEP) o hay que diseñarlo desde cero?",
      "¿Cuántas piezas y con qué frecuencia?",
      "¿Hay requisitos mecánicos, térmicos o de acabado que la pieza deba cumplir?"
    ],
    lo_que_no_prometemos: [
      "No damos precio por pieza sin ver geometría y volumen.",
      "No comprometemos tolerancias específicas sin revisar el archivo.",
      "No hay tienda en línea de esta división todavía."
    ],
    siguiente_paso:
      "Levantar el interés con registrar_interes y ofrecer que un especialista " +
      "revise el archivo o la idea."
  },

  // ══════════════════════════════════════════════════════════════════════
  dental: {
    clave: "dental",
    numero: "División 02",
    titulo: "Valquiria Dental",
    subtitulo: "Material pedagógico de alta fidelidad",
    estado: "ACTIVA — única división que vende en línea hoy",
    promesa: "La anatomía se aprende tocándola.",
    que_es:
      "Modelos anatómicos dentales con nervio sintético que responde como el de " +
      "un paciente real. Hechos para estudiantes que necesitan repetir y para " +
      "docentes que necesitan que la práctica se parezca a la clínica.",
    capacidades: [
      "Nervio sintético con comportamiento cercano al tejido real: se siente al instrumentar, no es un hueco vacío.",
      "Anatomía interna completa: cámara pulpar, conductos y ápice.",
      "Compatibles con tipodonto Nissin y con fantoma estándar.",
      "Precio de mayoreo para universidades y distribuidores.",
      "Cuatro modelos en catálogo: endodoncia, pulpotomía (odontopediatría), kit de 32 dientes y tipo Nissin para endodoncia."
    ],
    a_quien_sirve: [
      "Estudiantes de odontología que necesitan repetir un procedimiento muchas veces.",
      "Docentes y coordinadores de clínica que arman prácticas de laboratorio.",
      "Universidades y distribuidores que compran por volumen."
    ],
    preguntas_de_calificacion: [
      "¿Qué procedimiento va a practicar: endodoncia, pulpotomía, o anatomía general?",
      "¿Es para uso propio o para un grupo/laboratorio?",
      "¿Necesita compatibilidad con tipodonto Nissin?"
    ],
    lo_que_no_prometemos: [
      "No son productos de uso clínico en pacientes: son material pedagógico.",
      "El precio de mayoreo real lo confirma un especialista, no el asesor."
    ],
    siguiente_paso:
      "Usar buscar_productos / listar_catalogo y cerrar con calcular_cotizacion. " +
      "Esta división SÍ se cotiza y se cobra desde el chat."
  },

  // ══════════════════════════════════════════════════════════════════════
  pack: {
    clave: "pack",
    numero: "División 03",
    titulo: "Valquiria Pack",
    subtitulo: "Empaque termoformado a la medida",
    estado: "EN CONSTRUCCIÓN — no vende en línea todavía",
    promesa: "El empaque es la primera pieza que toca el cliente.",
    que_es:
      "Empaques termoformados a la medida para productos que necesitan " +
      "presentación premium y protección real. Molde propio, cavidad propia, " +
      "ninguna caja genérica.",
    capacidades: [
      "Cavidad diseñada sobre el modelo real del producto, no sobre una medida aproximada.",
      "Molde propio: no se adapta un blíster de catálogo ajeno.",
      "Prototipo de empaque antes de comprometer el tiraje completo."
    ],
    preguntas_de_calificacion: [
      "¿Qué producto va dentro y qué dimensiones tiene?",
      "¿Cuál es el tiraje estimado?",
      "¿El empaque va a punto de venta, a envío, o a ambos?",
      "¿Hay requisitos de marca o de material (reciclable, transparente, etc.)?"
    ],
    lo_que_no_prometemos: [
      "No cotizamos molde sin conocer geometría y tiraje.",
      "No hay catálogo de empaques estándar: todo es a la medida."
    ],
    siguiente_paso: "Levantar el interés con registrar_interes."
  },

  // ══════════════════════════════════════════════════════════════════════
  lux: {
    clave: "lux",
    numero: "División 04",
    titulo: "Valquiria Lux",
    subtitulo: "Iluminación y diseño",
    estado: "EN CONSTRUCCIÓN — no vende en línea todavía",
    promesa: "Luz impresa, capa sobre capa.",
    que_es:
      "Lámparas y piezas de iluminación donde la capa deja de ser un defecto y " +
      "se vuelve el material.",
    capacidades: [
      "La capa como textura: el defecto de impresión convertido en acabado deliberado.",
      "Piezas únicas o series cortas para interiorismo.",
      "Materiales traslúcidos calibrados para luz cálida."
    ],
    preguntas_de_calificacion: [
      "¿Es para un espacio residencial, comercial o un proyecto de interiorismo?",
      "¿Pieza única o serie?",
      "¿Hay una referencia estética o un espacio concreto que condicione el diseño?"
    ],
    lo_que_no_prometemos: [
      "No hay catálogo fijo de lámparas todavía.",
      "No se comprometen temperaturas de color ni certificaciones eléctricas por chat."
    ],
    siguiente_paso: "Levantar el interés con registrar_interes."
  },

  // ══════════════════════════════════════════════════════════════════════
  //  LA DIVISIÓN QUE FALTABA EN EL PROMPT ANTERIOR
  // ══════════════════════════════════════════════════════════════════════
  ia: {
    clave: "ia",
    numero: "División 05",
    titulo: "Valquiria IA",
    subtitulo: "Consultoría y automatización con inteligencia artificial",
    estado: "EN BETA — consultoría activa, se agenda con especialista",
    promesa: "Inteligencia artificial que entra a operación.",
    que_es:
      "Diseñamos y ponemos a trabajar sistemas de IA dentro de procesos que ya " +
      "existen. No vendemos demostraciones: entregamos algo que opera todos los " +
      "días, que se puede medir, y que alguien del equipo puede usar sin saber " +
      "programar.",
    capacidades: [
      "Atención y agenda automatizadas: agentes que responden por WhatsApp o desde el sitio, resuelven dudas, agendan y dan seguimiento — dentro de las reglas del negocio, no improvisando.",
      "Procesos administrativos: clasificar correspondencia, extraer datos de documentos, preparar reportes, avisar de pendientes y escalar a una persona lo que lo necesite.",
      "Visión por computadora: inspección visual y control de calidad sobre piezas y líneas de producción.",
      "Análisis de datos de operación: detección de anomalías y comportamientos fuera de patrón en la información que la operación ya genera.",
      "Consultoría: dónde conviene aplicar IA en una empresa y —sobre todo— dónde no. A veces la respuesta correcta es una regla bien escrita, no un modelo."
    ],
    metodo:
      "Trabajamos al revés de lo habitual: primero medimos el proceso, luego " +
      "decidimos qué automatizar. Nunca comprometemos una precisión que no " +
      "hayamos verificado en las condiciones de operación del cliente, y todo lo " +
      "que entregamos deja registro de lo que hizo y por qué.",
    la_prueba_viva:
      "El asesor de este sitio es la propia muestra de la división. Entiende lo " +
      "que le piden aunque lo escriban rápido, arma el pedido, lo coloca en el " +
      "carrito, calcula el total —el servidor hace la aritmética, no el modelo— " +
      "y cierra con link de pago o por WhatsApp. Es exactamente lo que " +
      "construimos para otros. Si el usuario pregunta qué hace Valquiria IA, la " +
      "respuesta más honesta es: esto que está usando ahora mismo.",
    preguntas_de_calificacion: [
      "¿Qué proceso concreto le está costando tiempo o dinero hoy?",
      "¿Quién lo hace hoy y cuántas horas a la semana se van en eso?",
      "¿Dónde vive la información: WhatsApp, correo, un sistema, papel?",
      "¿Cómo sabría usted que la automatización funcionó? ¿Qué número tendría que moverse?"
    ],
    lo_que_no_prometemos: [
      "No prometemos porcentajes de precisión antes de medir el proceso del cliente.",
      "No damos precio de proyecto por chat: depende del proceso, del volumen y de los sistemas que ya existan.",
      "No reemplazamos personas por defecto; el diseño estándar escala a una persona lo que requiere criterio humano.",
      "No trabajamos con datos sensibles de pacientes ni con información personal delicada dentro del chat público."
    ],
    siguiente_paso:
      "Hacer 2-3 preguntas de calificación, dar una lectura honesta de si el caso " +
      "es buen candidato, y levantar el interés con registrar_interes para que un " +
      "especialista agende."
  }
};

// ----------------------------------------------------------------------------
// CONOCIMIENTO TÉCNICO DE PROCESOS
// ----------------------------------------------------------------------------
//  Esto es conocimiento general de manufactura aditiva, no promesas de
//  Valquiria. Sirve para que el asesor pueda sostener una conversación técnica
//  real sin inventar especificaciones de la empresa.
// ----------------------------------------------------------------------------

const PROCESOS = {
  clave: "procesos",
  titulo: "Procesos de manufactura aditiva",
  fdm: {
    nombre: "FDM (modelado por deposición fundida)",
    como_funciona:
      "Un filamento termoplástico se funde y se deposita capa por capa. Cada " +
      "capa se suelda térmicamente a la anterior.",
    fuerte_en: [
      "Piezas funcionales que van a recibir esfuerzo mecánico.",
      "Volúmenes grandes a costo razonable.",
      "Materiales de ingeniería con propiedades conocidas."
    ],
    debil_en: [
      "Detalle fino y superficies muy lisas: las capas se ven y se sienten.",
      "Geometrías con paredes muy delgadas o rasgos de menos de ~0.4 mm.",
      "Anisotropía: la pieza es más débil en el eje Z, en la dirección de apilado."
    ],
    materiales_comunes:
      "PLA (fácil, rígido, poco resistente al calor), PETG (buen balance, algo " +
      "de flexibilidad, resiste humedad), ABS (resistente al calor y al impacto, " +
      "más difícil de imprimir), TPU (flexible), nylon y compuestos con fibra " +
      "para piezas de ingeniería."
  },
  resina: {
    nombre: "Resina (SLA / DLP / MSLA)",
    como_funciona:
      "Una resina fotopolimérica líquida se cura con luz UV capa por capa. La " +
      "resolución la define el sistema óptico, no el diámetro de una boquilla.",
    fuerte_en: [
      "Detalle fino, superficies lisas y geometría interna compleja.",
      "Piezas donde la fidelidad anatómica o estética es el punto — el caso de Valquiria Dental.",
      "Repetibilidad alta entre piezas de una misma serie."
    ],
    debil_en: [
      "Resistencia mecánica y a impacto frente a termoplásticos de ingeniería.",
      "Degradación con exposición prolongada a UV en algunas resinas.",
      "Requiere post-procesado obligatorio: lavado y curado."
    ],
    materiales_comunes:
      "Resinas estándar (prototipo visual), resinas tenaces o tipo-ABS " +
      "(funcionales), resinas dentales certificadas (modelos, guías, férulas) y " +
      "resinas de alta precisión para detalle extremo."
  },
  conceptos: {
    altura_de_capa:
      "Cuánto material se apila por pasada. Capa más baja = más detalle y más " +
      "tiempo. En Valquiria la referencia visual del sitio son capas de 100 micras.",
    soportes:
      "Estructuras temporales que sostienen voladizos durante la impresión. " +
      "Se retiran después y dejan marca: por eso la orientación de la pieza es " +
      "una decisión de diseño, no un detalle.",
    post_procesado:
      "En FDM: retirar soportes, lijar, a veces alisar químicamente. En resina: " +
      "lavado, curado UV y retiro de soportes. El post-procesado es tiempo real " +
      "de producción, no un extra invisible.",
    orientacion:
      "Cómo se acuesta la pieza en la plataforma determina resistencia, acabado " +
      "y cantidad de soportes. Dos piezas idénticas orientadas distinto no son la " +
      "misma pieza.",
    cuando_conviene_aditiva:
      "Series cortas, geometría compleja, iteración rápida, o piezas que no " +
      "existen en catálogo. Deja de convenir cuando el volumen justifica un molde."
  },
  como_elegir:
    "Regla práctica: si la pieza tiene que AGUANTAR, FDM. Si la pieza tiene que " +
    "VERSE o reproducir anatomía con fidelidad, resina. Si tiene que hacer las " +
    "dos cosas, se separa en componentes o se cambia el material."
};

// ----------------------------------------------------------------------------
// RESOLUCIÓN DE CLAVES (tolerante a cómo lo escriba el modelo)
// ----------------------------------------------------------------------------

const SINONIMOS = {
  // empresa
  empresa: "empresa", valquiria: "empresa", holding: "empresa",
  general: "empresa", compania: "empresa", "compañia": "empresa",
  // 3d
  "3d": "3d", "valquiria 3d": "3d", tresd: "3d", impresion: "3d",
  "impresion 3d": "3d", aditiva: "3d", "manufactura aditiva": "3d",
  prototipado: "3d",
  // dental
  dental: "dental", "valquiria dental": "dental", odontologia: "dental",
  "odontología": "dental", dientes: "dental", catalogo: "dental",
  // pack
  pack: "pack", "valquiria pack": "pack", empaque: "pack",
  empaques: "pack", termoformado: "pack", blister: "pack",
  // lux
  lux: "lux", "valquiria lux": "lux", iluminacion: "lux",
  "iluminación": "lux", lamparas: "lux", "lámparas": "lux",
  // ia
  ia: "ia", "valquiria ia": "ia", ai: "ia",
  "inteligencia artificial": "ia", automatizacion: "ia",
  "automatización": "ia", agentes: "ia", chatbot: "ia",
  // procesos
  procesos: "procesos", proceso: "procesos", tecnologia: "procesos",
  "tecnología": "procesos", fdm: "procesos", resina: "procesos",
  sla: "procesos", materiales: "procesos", tecnologias: "procesos"
};

function normalizarClave(texto) {
  if (typeof texto !== "string") return null;
  const limpio = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (SINONIMOS[limpio]) return SINONIMOS[limpio];

  // Coincidencia por token: "cuéntame de valquiria ia" → "ia"
  for (const token of limpio.split(" ")) {
    if (SINONIMOS[token]) return SINONIMOS[token];
  }
  return null;
}

// ----------------------------------------------------------------------------
// API PÚBLICA
// ----------------------------------------------------------------------------

/**
 * Devuelve el bloque de conocimiento de una división, de la empresa, o de
 * los procesos de manufactura. Nunca falla en seco: si no reconoce la clave,
 * devuelve el mapa general para que el asesor siga teniendo algo que decir.
 */
function consultarConocimiento(tema) {
  const clave = normalizarClave(tema);

  if (clave === "empresa") {
    return { ok: true, tipo: "empresa", contenido: EMPRESA };
  }
  if (clave === "procesos") {
    return { ok: true, tipo: "procesos", contenido: PROCESOS };
  }
  if (clave && DIVISIONES[clave]) {
    return { ok: true, tipo: "division", contenido: DIVISIONES[clave] };
  }

  return {
    ok: true,
    tipo: "mapa_general",
    nota_para_asesor:
      `No se reconoció el tema "${tema}". Aquí está el mapa de todo lo ` +
      `consultable. Elige el tema correcto y vuelve a llamar la herramienta, ` +
      `o responde con el mapa si la pregunta era general.`,
    contenido: {
      empresa: EMPRESA,
      divisiones: Object.values(DIVISIONES).map(d => ({
        clave: d.clave,
        titulo: d.titulo,
        subtitulo: d.subtitulo,
        estado: d.estado,
        promesa: d.promesa
      })),
      temas_disponibles: ["empresa", "dental", "3d", "pack", "lux", "ia", "procesos"]
    }
  };
}

/**
 * Resumen compacto de las cinco divisiones para incrustar en el system prompt.
 * Se genera desde la misma fuente de verdad: si cambias el estado de una
 * división arriba, el prompt cambia solo. Sin dos lugares que mantener.
 */
function resumenDivisionesParaPrompt() {
  const orden = ["3d", "dental", "pack", "lux", "ia"];
  return orden
    .map(k => {
      const d = DIVISIONES[k];
      return `${d.numero} · ${d.titulo} — ${d.subtitulo}. [${d.estado}] "${d.promesa}"`;
    })
    .join("\n");
}

module.exports = {
  EMPRESA,
  DIVISIONES,
  PROCESOS,
  consultarConocimiento,
  resumenDivisionesParaPrompt,
  normalizarClave
};
