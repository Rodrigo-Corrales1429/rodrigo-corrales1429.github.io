import { escena } from './escena.js?v=72';
import { getDivisionConfig } from './division-config.js?v=72';

const divisionId = document.body.dataset.division;
const config = getDivisionConfig(divisionId);
const root = document.querySelector('[data-division-experience]');

function setSceneState(state) {
  if (!root) return;
  root.classList.remove('scene-idle', 'scene-loading', 'scene-ready', 'scene-error');
  root.classList.add('scene-' + state);
}

function updateRail(progress, state) {
  if (!root || !config) return;
  const bounded = Math.max(0, Math.min(config.progress, Number(progress) || 0));
  const ratio = config.progress > 0 ? bounded / config.progress : 0;
  const percent = Math.round(ratio * 100);
  const layers = escena.capasDe(config.figure);
  const layer = Math.min(layers, Math.round(bounded * layers));
  const mm = (bounded * escena.mmDe(config.figure)).toFixed(2);

  root.style.setProperty('--print-progress', percent + '%');
  const fill = root.querySelector('[data-rail-fill]');
  const head = root.querySelector('[data-rail-head]');
  const z = root.querySelector('[data-rail-z]');
  const layerNode = root.querySelector('[data-rail-layer]');
  const stateNode = root.querySelector('[data-rail-state]');
  if (fill) fill.style.height = percent + '%';
  if (head) head.style.top = percent + '%';
  if (z) z.textContent = mm + ' mm';
  if (layerNode) layerNode.textContent = 'Capa ' + String(layer).padStart(3, '0');
  if (stateNode) stateNode.textContent = state === 'listo' ? 'Pieza lista' : 'Imprimiendo';
}

function failGracefully(error) {
  setSceneState('error');
  if (error) console.warn('[valquiria] Experiencia 3D no disponible:', error);
}

if (root && config) {
  setSceneState('loading');
  let lastPercent = -1;

  try {
    escena.alProgresar(({ p, fase }) => {
      const percent = Math.round((p / config.progress) * 100);
      if (percent === lastPercent && fase !== 'listo') return;
      lastPercent = percent;
      updateRail(p, fase);
      if (fase === 'listo') setSceneState('ready');
    });

    escena.primeraFigura(
      config.figure,
      progress => updateRail(progress * config.progress, 'imprime'),
      () => {
        if (!escena.init()) {
          failGracefully();
          return;
        }
        if (!escena.arrancar(config.figure, config.progress)) {
          escena.mostrar(config.figure, config.progress, config.side);
        }
        updateRail(escena.reducido ? config.progress : 0, escena.reducido ? 'listo' : 'imprime');
        if (escena.reducido) setSceneState('ready');
      }
    );
  } catch (error) {
    failGracefully(error);
  }
}
