const ARROW_CONTROLS = "input:not([type='checkbox']):not([type='button']), select, textarea, [contenteditable='true']";
const TEXT_CONTROLS = "input:not([type='range']):not([type='checkbox']):not([type='button']), select, textarea, [contenteditable='true']";
const SPACE_CONTROLS =
  "button, input, select, textarea, a[href], summary, [role='switch'], [role='radio'], [role='menuitem'], [role='menuitemradio']";
const CLICKABLE = 'button, input, select, textarea, a[href]';

const REMOTE_KEYS = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', Backspace: 'BACK' };
const VOLUME_KEYS = { '+': 1, '=': 1, '-': -1, _: -1 };

const SHORTCUT_GUARD_MS = 700;

let shownAt = Number.NEGATIVE_INFINITY;

// With the global shortcut the panel takes keyboard focus while the user may still be typing elsewhere, and a stray Space
// once toggled the real TV: keys are ignored for a moment after the panel appears. A button that kept focus from last time
// would take Space natively and get around that, so nothing is left focused.
function markPanelShown() {
  shownAt = performance.now();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}

function keysGuarded() {
  return loggedOut() || performance.now() - shownAt < SHORTCUT_GUARD_MS;
}

function onRemotePage() {
  return settingsOpen() && pageStack.at(-1) === 'remote';
}

// Main view: the arrows step the volume, M mutes and Space turns the TV on or off, unless the focused control owns the key.
function handleMainKey(event, target) {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    if (target.matches(ARROW_CONTROLS)) return;
    event.preventDefault();
    stepVolume(event.key === 'ArrowUp' ? 1 : -1);
    return;
  }
  if (event.key.toLowerCase() === 'm') {
    if (target.matches(TEXT_CONTROLS)) return;
    event.preventDefault();
    if (!event.repeat) send('mudo', !view.device.mudo);
    return;
  }
  if (event.key !== ' ' || target.closest(SPACE_CONTROLS)) return;
  event.preventDefault();
  if (!event.repeat) send('ligado', !view.device.ligado);
}

// Controle: the arrows are the d-pad, Enter is OK, Backspace is Back, Space plays or pauses and + / - move the volume, M
// mutes. A control of the page keeps Enter and Space for its own click.
function handleRemoteKey(event, target) {
  if (event.key === 'Enter') {
    if (target.closest(CLICKABLE)) return;
    event.preventDefault();
    sendKey('OK');
    return;
  }
  if (event.key === ' ') {
    if (target.closest(SPACE_CONTROLS)) return;
    event.preventDefault();
    if (!event.repeat) sendPlayPause();
    return;
  }
  if (event.key in VOLUME_KEYS) {
    event.preventDefault();
    sendVolumeKey(VOLUME_KEYS[event.key]);
    return;
  }
  if (event.key.toLowerCase() === 'm') {
    if (target.matches(TEXT_CONTROLS)) return;
    event.preventDefault();
    if (!event.repeat) sendMute();
    return;
  }
  const key = REMOTE_KEYS[event.key];
  if (key === undefined) return;
  event.preventDefault();
  sendKey(key);
}

function handleShortcutKey(event) {
  // Shift only matters for "+" (and "_"), the volume keys of the remote.
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.shiftKey && !(event.key in VOLUME_KEYS)) return;
  if (keysGuarded() || popupOwner || !usable()) return;
  const target = event.target instanceof Element ? event.target : document.body;
  if (onRemotePage()) handleRemoteKey(event, target);
  else if (!settingsOpen()) handleMainKey(event, target);
}

// Escape peels one layer: popup, then sub-page, then settings, then the panel itself.
function handleEscape() {
  if (popupOwner) closePopup({ restoreFocus: true });
  else if (settingsOpen()) goBack();
  else window.ac.hide();
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') handleEscape();
  else handleShortcutKey(event);
});
