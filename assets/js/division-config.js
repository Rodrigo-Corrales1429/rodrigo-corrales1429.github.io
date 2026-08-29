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

export const DIVISION_CONFIG = Object.freeze({
  dental: Object.freeze({
    route: '/dental/',
    figure: 'diente',
    model: DENTAL_MODEL,
    progress: 1,
    side: 0,
    title: 'Valquiria Dental'
  })
});

export function getDivisionConfig(id) {
  return DIVISION_CONFIG[id] || null;
}
