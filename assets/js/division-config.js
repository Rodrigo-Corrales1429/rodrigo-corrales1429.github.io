/* Configuración visual compartida por las páginas limpias de división.
   El contenido indexable vive en HTML; este archivo sólo decide qué experiencia
   monta el motor 3D. Las rutas absolutas funcionan igual desde / y /dental/. */
export const VALQUIRIA_MODEL = '/assets/valquiria.glb';
export const DENTAL_MODEL = '/assets/diente.glb';
export const IA_MODEL = '/assets/cyborg.glb';

/* Pack y Lux siguen usando sus figuras procedurales. Cuando existan los GLB
   aprobados por el flujo externo, cambia null por una ruta /assets/*.glb y
   conecta la constante en figuras.js. Ver MODELO.md. */
export const PACK_MODEL = null;
export const LUX_MODEL = null;

/* `progress` es hasta dónde imprime la pieza de cada división, y es una
   afirmación sobre el NEGOCIO, no un ajuste visual: Dental está en producción
   y su molar imprime entero; IA va al 94 % porque está en beta; 3D, Pack y Lux
   imprimen la fracción que corresponde a lo construido de cada taller. Los
   mismos números viven en las RUTAS del hub (app.js) — si cambian ahí, cambian
   aquí, o el visitante vería dos verdades distintas de la misma división. */
export const DIVISION_CONFIG = Object.freeze({
  dental: Object.freeze({
    route: '/dental/',
    figure: 'diente',
    model: DENTAL_MODEL,
    progress: 1,
    side: 0,
    title: 'Valquiria Dental'
  }),
  ia: Object.freeze({
    route: '/ia/',
    figure: 'cyborg',
    model: IA_MODEL,
    progress: 0.94,
    side: 0,
    title: 'Valquiria IA'
  }),
  '3d': Object.freeze({
    route: '/3d/',
    figure: 'engrane',
    model: null,
    progress: 0.62,
    side: 0,
    title: 'Valquiria 3D'
  }),
  pack: Object.freeze({
    route: '/pack/',
    figure: 'empaque',
    model: PACK_MODEL,
    progress: 0.88,
    side: 0,
    title: 'Valquiria Pack'
  }),
  lux: Object.freeze({
    route: '/lux/',
    figure: 'lampara',
    model: LUX_MODEL,
    progress: 0.68,
    side: 0,
    title: 'Valquiria Lux'
  })
});

export function getDivisionConfig(id) {
  return DIVISION_CONFIG[id] || null;
}
