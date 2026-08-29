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

const { tarifasDeReferencia } = require("./impresion3d.js");
const { tarifasDeReferencia: tarifasPack } = require("./termoformado.js");

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
    envio:
      "Se cotiza por código postal con la herramienta cotizar_envio: da costo, " +
      "paquetería y fecha estimada de entrega. Envío gratis a partir de $999 " +
      "en el servicio estándar.",
    venta_en_linea: "Valquiria Dental (catálogo con pago en línea)",
    con_cotizacion_automatica:
      "Dental (precio firme), 3D (estimación por peso/hora), Pack (rango por " +
      "molde y tiraje). Lux e IA se cierran con especialista.",
    whatsapp: "+52 771 795 9131",
    correo: "ventas@valquiriadental.com"
  },
  lo_que_no_prometemos: [
    "Las fechas de entrega que damos son ESTIMADAS y salen de cotizar_envio; la fecha en firme la fija la guía cuando se genera el envío.",
    "Fuera de Dental, los números son ESTIMACIONES preliminares: el especialista los confirma. Nunca se presentan como precio cerrado.",
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
    estado:
      "ACTIVA — toma proyectos desde hoy. Sin tienda en línea (cada pieza es " +
      "distinta), pero el asesor SÍ da estimaciones oficiales de precio con la " +
      "herramienta estimar_impresion_3d",
    promesa: "Prototipos que existen mañana.",
    que_es:
      "Impresión 3D profesional: prototipado rápido, piezas funcionales y " +
      "producción en serie con FDM y resina de alta resolución.",
    capacidades: [
      "FDM para piezas funcionales; resina para detalle fino.",
      "Del archivo a la pieza en obra, con tolerancias medidas (no estimadas a ojo).",
      "Series cortas sin costo de molde — el punto donde la aditiva le gana a la inyección.",
      "Si el modelo no existe, se diseña. No es solo servicio de impresión.",
      "Post-procesado disponible: lijado/alisado y pintura de acabado."
    ],
    /* Tarifas vivas: salen del mismo motor que usa la herramienta, así que
       este bloque y el estimador nunca se contradicen. */
    tarifas_de_referencia: tarifasDeReferencia(),
    como_cotiza:
      "Con la herramienta estimar_impresion_3d, a partir del peso en gramos " +
      "(y las horas de impresión si se conocen). Se cobra por gramo o por " +
      "hora, LO QUE MÁS CONVENGA AL CLIENTE. El resultado es una estimación " +
      "preliminar; la cifra final la confirma un especialista con el archivo " +
      "STL/STEP en la mano.",
    preguntas_de_calificacion: [
      "¿Qué función cumple la pieza: prototipo de forma, prototipo funcional, o pieza final?",
      "¿Ya existe archivo 3D (STL/STEP) o hay que diseñarlo desde cero?",
      "¿Cuánto pesa aproximadamente la pieza, o qué tamaño tiene? (para estimar en el momento)",
      "¿Cuántas piezas y con qué frecuencia?",
      "¿Necesita acabado: lijado o pintura?"
    ],
    lo_que_no_prometemos: [
      "La estimación del chat es preliminar: el precio en firme lo confirma un especialista con el archivo, porque orientación, soportes y relleno cambian el peso y el tiempo reales.",
      "No comprometemos tolerancias específicas sin revisar el archivo.",
      "No hay tienda en línea de esta división todavía: el cierre es con el especialista.",
      "El descuento por volumen (10+ piezas) existe, pero el porcentaje lo confirma el especialista."
    ],
    siguiente_paso:
      "Dar la estimación con estimar_impresion_3d en cuanto haya un peso " +
      "aproximado — un número real abre más conversaciones que un formulario. " +
      "Después, registrar el interés con contacto para que el especialista " +
      "confirme con el archivo."
  },

  // ══════════════════════════════════════════════════════════════════════
  dental: {
    clave: "dental",
    numero: "División 02",
    titulo: "Valquiria Dental",
    subtitulo: "Material pedagógico de alta fidelidad",
    estado: "ACTIVA — la única con catálogo y pago en línea",
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
    estado:
      "ACTIVA — toma proyectos desde hoy. El asesor da un RANGO estimado con " +
      "la herramienta estimar_termoformado; el precio en firme lo cierra el " +
      "especialista",
    promesa: "El empaque es la primera pieza que toca el cliente.",
    que_es:
      "Empaques termoformados a la medida para productos que necesitan " +
      "presentación premium y protección real. Molde propio, cavidad propia, " +
      "ninguna caja genérica. Se vende la lámina termoformada con los moldes " +
      "hechos al gusto y a la medida del cliente, y también el servicio de " +
      "bajada (formado sobre molde del cliente).",
    materiales: [
      "Poliestireno blanco para bases y charolas: rígido, opaco, presentación limpia.",
      "PET o vinil transparente para tapas y blísteres: el producto se ve sin abrirse.",
      "Base y tapa pueden combinarse: base blanca que sostiene, tapa transparente que exhibe."
    ],
    capacidades: [
      "Cavidad diseñada sobre el modelo real del producto, no sobre una medida aproximada.",
      "Molde propio impreso en 3D: no se adapta un blíster de catálogo ajeno, y el molde existe en días, no en semanas.",
      "Prototipo de empaque antes de comprometer el tiraje completo.",
      "Base y tapa termoformadas como juego, en el material que pida el producto.",
      "Descuento por mayoreo en tirajes grandes (el porcentaje lo confirma el especialista)."
    ],
    politica_de_precios:
      "CAMBIÓ el 28 de agosto de 2026: antes no se daba ninguna cifra. Ahora el " +
      "asesor SÍ da un RANGO estimado con la herramienta estimar_termoformado, " +
      "siempre desglosado (molde, lámina, formado) y siempre presentado como " +
      "estimación. El molde es un pago ÚNICO del proyecto y el resto escala con " +
      "el tiraje: explicar eso es la mitad de la venta. El especialista sigue " +
      "cerrando el precio en firme viendo el producto o su archivo.",
    tarifas_de_referencia: tarifasPack(),
    como_cotiza:
      "Con estimar_termoformado, a partir de largo y ancho del producto en cm y " +
      "el tiraje. Acepta el material en texto libre ('transparente', 'base " +
      "blanca', 'PET') y si lleva tapa. Devuelve rango, desglose y la escalera " +
      "de tiraje — que es el mejor argumento comercial de la división.",
    preguntas_de_calificacion: [
      "¿Qué producto va dentro y qué dimensiones tiene?",
      "¿Cuál es el tiraje estimado?",
      "¿El empaque va a punto de venta, a envío, o a ambos?",
      "¿Prefiere base blanca con tapa transparente, todo transparente, u otra combinación?",
      "¿Hay requisitos de marca (sello, logotipo en relieve) o de material (reciclable)?"
    ],
    lo_que_no_prometemos: [
      "El rango del chat es una ESTIMACIÓN con tarifas de referencia del taller, no una cotización firme.",
      "No se estima nada sin largo, ancho y tiraje: sin esos tres datos no hay número, hay adivinanza.",
      "No incluye impresión, etiquetado, sellado, maquila de empaquetado, IVA ni envío del tiraje.",
      "No hay catálogo de empaques estándar: todo es a la medida.",
      "Una pieza que no cabe en lámina de 60×40 cm necesita lámina especial y la ve el especialista."
    ],
    siguiente_paso:
      "Pedir largo, ancho y tiraje; dar el rango con estimar_termoformado " +
      "explicando que el molde se paga una sola vez; y levantar el interés con " +
      "registrar_interes para que el especialista confirme."
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
      "Materiales traslúcidos calibrados para luz cálida.",
      "Diseños escultóricos que solo la impresión 3D permite: lámparas voxel de estética 8-bit, geometrías paramétricas y piezas temáticas (la luz como parte de la escultura, no un foco con pantalla)."
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
    estado:
      "ACTIVA — consultoría y proyectos a la medida, más Valquiria Dental OS " +
      "como producto de suscripción con precios publicados",
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
    /* ══════════════════════════════════════════════════════════════════
       EL PRODUCTO EMPAQUETADO DE LA DIVISIÓN.

       Todo lo demás en Valquiria IA es consultoría: se cotiza por proyecto y
       tarda semanas en cerrarse. Dental OS es lo contrario — precio público,
       alta inmediata, mensualidad. Es lo único de esta división que el asesor
       puede cotizar solo, y por eso vive aquí con sus números exactos.

       Los importes son PRECIOS DE LANZAMIENTO tomados del blueprint de
       negocio. La promesa contractual de Founder/Early Adopter es el DESCUENTO
       RELATIVO sobre la lista vigente, nunca un importe "de por vida": si la
       lista sube, ellos suben conservando su ventaja. Decirlo de otra forma
       crea una obligación que la empresa no puede sostener.
       ══════════════════════════════════════════════════════════════════ */
    producto_estrella: {
      clave: "dental_os",
      nombre: "Valquiria Dental OS",
      una_linea:
        "El sistema operativo inteligente del consultorio dental: agenda, " +
        "pacientes, WhatsApp y un asistente de IA que recupera el dinero que " +
        "hoy se pierde en citas caídas.",
      para_quien:
        "Consultorios dentales independientes y clínicas de 1 a 10 dentistas " +
        "en México.",
      que_resuelve: [
        "Inasistencias: confirma, recuerda y reagenda por WhatsApp sin que nadie lo haga a mano.",
        "Huecos de agenda: cuando alguien cancela, ofrece el espacio a la lista de espera antes de que se pierda la hora.",
        "Seguimiento: detecta al paciente que no volvió y le escribe con el protocolo que corresponde a su tratamiento.",
        "Recepción: contesta dudas y agenda por WhatsApp fuera de horario, dentro de las reglas de la clínica.",
        "Visibilidad: el dueño ve qué se cobró, qué se perdió y por qué."
      ],
      la_metrica_que_lo_vende:
        "Revenue Recovered: el sistema lleva la cuenta, evento por evento y " +
        "auditable, del dinero que recuperó (citas rescatadas, huecos " +
        "revendidos, pacientes reactivados). El argumento nunca es 'tenemos " +
        "IA': es que lo recuperado supere la mensualidad.",
      componentes: [
        "Web para recepción y dirección (escritorio).",
        "App móvil para el dentista.",
        "Valquiria AI: el asistente que opera dentro de las reglas de la clínica.",
        "WhatsApp como canal nativo con el paciente.",
        "Agenda inteligente con lista de espera y reserva de emergencia."
      ],
      planes: [
        {
          nombre: "Lista",
          base_mensual: "$2,499 MXN",
          dentista_adicional: "+$1,800 MXN/mes",
          incluye: "1,500 mensajes/mes; +1,000 por dentista adicional"
        },
        {
          nombre: "Early Adopter",
          base_mensual: "$2,199 MXN",
          dentista_adicional: "+$1,599 MXN/mes",
          incluye: "Mismos límites que Lista",
          ventaja: "~12% bajo la tarifa de lista vigente, mientras conserve el estatus"
        },
        {
          nombre: "Founder",
          base_mensual: "$1,999 MXN",
          dentista_adicional: "+$1,399 MXN/mes",
          incluye: "Mismos límites que Lista",
          ventaja: "~20% bajo la tarifa de lista vigente, mientras conserve el estatus",
          nota: "Cupo limitado: es el programa de los primeros clientes."
        }
      ],
      implementacion:
        "Cuota única de implementación de $3,000 a $5,000 MXN según el tamaño " +
        "de la clínica y la migración de datos. Cubre configuración, carga de " +
        "pacientes, alta de WhatsApp y capacitación del equipo.",
      estado_real:
        "En desarrollo activo con programa Founder abierto. Se agenda una demo " +
        "y un diagnóstico de la clínica antes de dar fecha de alta. NO está " +
        "disponible para autoservicio todavía.",
      lo_que_no_prometemos: [
        "No se promete una fecha de alta por chat: se agenda demo y el especialista la fija.",
        "El precio Founder es una VENTAJA RELATIVA sobre la lista vigente, no un importe congelado para siempre.",
        "No se prometen porcentajes de reducción de inasistencias antes de medir la clínica.",
        "No es un expediente clínico certificado ni sustituye obligaciones legales del consultorio.",
        "El costo de los mensajes de WhatsApp por encima del límite se factura aparte."
      ],
      como_lo_cotiza_el_asesor:
        "Con la herramienta cotizar_dental_os: pregunta cuántos dentistas " +
        "atienden y devuelve el precio de los tres planes con su total mensual " +
        "y anual. Es la ÚNICA cotización de Valquiria IA que el asesor cierra " +
        "solo; cualquier otro proyecto de IA se levanta como interés."
    },

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
      "Primero decidir de qué se trata la conversación, porque son dos caminos " +
      "distintos:\n" +
      "· Si es un CONSULTORIO DENTAL → el producto es Valquiria Dental OS. " +
      "Preguntar cuántos dentistas atienden, cotizar con cotizar_dental_os y " +
      "registrar el interés para agendar demo.\n" +
      "· Si es cualquier otra empresa → consultoría a la medida. Hacer 2-3 " +
      "preguntas de calificación, dar una lectura honesta de si el caso es buen " +
      "candidato, y levantar el interés con registrar_interes."
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
  /* dental os — va ANTES que los tokens sueltos a propósito: normalizarClave
     prueba primero la frase completa, así que "dental os" cae aquí y no en
     "dental". Sin estas entradas, preguntar por el software del consultorio
     devuelve el catálogo de dientes de práctica. */
  "dental os": "dental_os", dentalos: "dental_os",
  "valquiria dental os": "dental_os", "os dental": "dental_os",
  "software dental": "dental_os", "sistema dental": "dental_os",
  "software para consultorio": "dental_os", "sistema para consultorio": "dental_os",
  "software para consultorios": "dental_os", consultorio: "dental_os",
  consultorios: "dental_os", clinica: "dental_os", "clínica": "dental_os",
  "software de clinica": "dental_os", "gestion de consultorio": "dental_os",
  "agenda dental": "dental_os", crm: "dental_os",
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
  /* Dental OS es un producto, no una división, pero se pregunta por él tanto
     como por una — y el usuario rara vez sabe que vive dentro de Valquiria IA.
     Se atiende como tema propio para no obligarlo a adivinar la jerarquía. */
  if (["dental_os", "dentalos", "os"].includes(clave)) {
    return {
      ok: true,
      tipo: "producto",
      contenido: DIVISIONES.ia.producto_estrella,
      division_que_lo_vende: "Valquiria IA (División 05)"
    };
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
      temas_disponibles: ["empresa", "dental", "3d", "pack", "lux", "ia", "dental_os", "procesos"]
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
