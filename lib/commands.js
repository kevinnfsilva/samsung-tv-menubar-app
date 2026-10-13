// What may be asked of the bridge. Keys and values end up as tokens on the command line of the CLI, so anything that
// does not have one of these shapes is refused here, before it gets that far.
const FLAG_KEYS = new Set(['ligado', 'mudo']);
const TEXT_KEYS = new Set(['entrada', 'imagem', 'som']);
const TEXT_MAX_LENGTH = 80;
const VOLUME_MAX = 100;
const PLAIN_ACTIONS = new Set(['vol+', 'vol-', 'canal+', 'canal-', 'play', 'pause', 'stop', 'avancar', 'voltar']);
const CHANNEL_PATTERN = /^[0-9]{1,6}$/;
const REMOTE_KEYS = new Set(['UP', 'DOWN', 'LEFT', 'RIGHT', 'OK', 'BACK', 'EXIT', 'MENU', 'HOME', 'MUTE', 'PLAY', 'PAUSE', 'STOP', 'REWIND', 'FF', 'PLAY_BACK', 'SOURCE']);
const APP_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

// Counts characters, not UTF-16 units, so an accented or emoji name is measured the way a person reads it.
function isText(value) {
  const length = typeof value === 'string' ? [...value].length : 0;
  return length > 0 && length <= TEXT_MAX_LENGTH;
}

function isValidChange(key, value) {
  if (FLAG_KEYS.has(key)) return typeof value === 'boolean';
  if (key === 'volume') return Number.isInteger(value) && value >= 0 && value <= VOLUME_MAX;
  return TEXT_KEYS.has(key) && isText(value);
}

// Keeps the valid entries of a `{ key: value }` object and nothing else.
function sanitizeChanges(changes) {
  const entries = Object.entries(changes !== null && typeof changes === 'object' ? changes : {});
  return Object.fromEntries(entries.filter(([key, value]) => isValidChange(key, value)));
}

// One-shot actions: the plain ones take no argument, the others take a channel, a remote key or an app id.
function isValidRun(action, arg) {
  if (PLAIN_ACTIONS.has(action)) return arg === undefined;
  if (action === 'tecla') return REMOTE_KEYS.has(arg);
  if (action === 'canal') return typeof arg === 'string' && CHANNEL_PATTERN.test(arg);
  if (action === 'app') return typeof arg === 'string' && APP_PATTERN.test(arg);
  return false;
}

module.exports = { isValidChange, isValidRun, sanitizeChanges };
