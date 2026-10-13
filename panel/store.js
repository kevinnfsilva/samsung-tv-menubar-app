const DEFAULT_SETTINGS = {
  autostart: false,
  dock: true,
  atalho: { ativo: false, tecla: '' },
  icone: { volume: true },
  notificacoes: { offline: true, ligadoHoras: 0 },
  timer: null,
  agendas: [],
  idioma: 'auto',
  atualizacoes: true,
  estilo: 'compacto',
};

let view = null;
let settings = DEFAULT_SETTINGS;
// The newer release the main process knows about, { versao, url }, or null.
let updateNotice = null;
let darkTaskbar = true;

// A missing group or field must never crash a render: fill it from the defaults.
function applySettings(next) {
  settings = {
    ...DEFAULT_SETTINGS,
    ...next,
    atalho: { ...DEFAULT_SETTINGS.atalho, ...next?.atalho },
    icone: { ...DEFAULT_SETTINGS.icone, ...next?.icone },
    notificacoes: { ...DEFAULT_SETTINGS.notificacoes, ...next?.notificacoes },
  };
}

// Like applySettings: whatever arrives, the render only ever sees null or a notice that has a version to show.
function applyUpdate(next) {
  updateNotice = typeof next?.versao === 'string' && next.versao ? next : null;
}

function loginState() {
  return view?.login ?? 'ok';
}

function loggedOut() {
  return loginState() !== 'ok';
}

// Controls only make sense with a reachable TV: not signed out, not loading, not offline.
function usable() {
  return !loggedOut() && Boolean(view?.device) && view.device.online !== false;
}

// Timers and schedules say which TV they act on; a name is only worth showing when it is not the one on screen.
function otherUnitName(aparelho) {
  return aparelho?.nome && aparelho.id !== view?.device?.id ? aparelho.nome : null;
}
