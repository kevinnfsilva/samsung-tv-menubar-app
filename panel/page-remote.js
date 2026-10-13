/* The drawn remote control (a page of the compact layout, the Controle tab of the tabbed one). Each key sends one command to
   the TV, in the order pressed; a key dips and springs back when it fires, however it was triggered, and the light on the
   remote blinks for every command that goes out. */

const PRESS_MS = 170;
const BLINK_MS = 420;

function flash(button) {
  if (!button) return;
  button.classList.remove('pressed');
  void button.offsetWidth;
  button.classList.add('pressed');
  clearTimeout(button.flashTimer);
  button.flashTimer = setTimeout(() => button.classList.remove('pressed'), PRESS_MS);
}

function blinkLed() {
  const led = byId('remote-led');
  led.classList.remove('blink');
  void led.offsetWidth;
  led.classList.add('blink');
  clearTimeout(led.blinkTimer);
  led.blinkTimer = setTimeout(() => led.classList.remove('blink'), BLINK_MS);
}

function remoteKeyButton(key) {
  return document.querySelector(`#page-remote [data-key='${key}']`);
}

// A key of the remote: the d-pad, Back, Home, Menu, Source and Exit. The keyboard goes through the same function.
function sendKey(key) {
  if (!usable()) return;
  window.ac.run('tecla', key);
  flash(remoteKeyButton(key));
  blinkLed();
}

// Play and pause share a key: the TV's own playback status decides, and when it reports none the remote alternates.
let lastPlayback = null;

function playbackCommand() {
  const status = view?.device?.reproducao;
  if (status === 'playing') return 'pause';
  if (status === 'paused' || status === 'stopped') return 'play';
  return lastPlayback === 'play' ? 'pause' : 'play';
}

function sendPlayPause() {
  if (!usable()) return;
  lastPlayback = playbackCommand();
  window.ac.run(lastPlayback);
  flash(byId('remote-playpause'));
  blinkLed();
}

// The rockers and the extra keys: one-shot actions of the bridge.
function sendAction(action, button) {
  if (!usable()) return;
  window.ac.run(action);
  flash(button);
  blinkLed();
}

function sendVolumeKey(direction) {
  sendAction(direction > 0 ? 'vol+' : 'vol-', document.querySelector(`#page-remote [data-action='${direction > 0 ? 'vol+' : 'vol-'}']`));
}

function sendMute() {
  const device = view?.device;
  if (!usable()) return;
  send('mudo', !device.mudo);
  flash(byId('remote-mute'));
  blinkLed();
}

function sendPower() {
  if (!view?.device) return;
  send('ligado', !view.device.ligado);
  flash(byId('remote-power'));
  blinkLed();
}

function sendApp(id) {
  if (usable()) window.ac.run('app', id);
}

// Without a reachable TV the page shows, dimmed, and its controls do nothing.
function renderRemotePage() {
  const page = byId('page-remote');
  page.dataset.usable = String(usable());
  page.dataset.power = view?.device?.ligado ? 'on' : 'off';
  byId('page-apps').dataset.usable = String(usable());
  byId('remote-mute').setAttribute('aria-checked', String(view?.device?.mudo === true));
}

for (const button of document.querySelectorAll('#page-remote [data-key]')) {
  button.addEventListener('click', () => sendKey(button.dataset.key));
}

for (const button of document.querySelectorAll('#page-remote [data-action]')) {
  button.addEventListener('click', () => {
    if (button.dataset.action === 'playpause') sendPlayPause();
    else sendAction(button.dataset.action, button);
  });
}

byId('remote-mute').addEventListener('click', sendMute);
byId('remote-power').addEventListener('click', sendPower);

/* The remote is drawn at one size and shrinks, never grows, to fit the room its page has. */

const REMOTE_MIN_SCALE = 0.78;

function fitRemote() {
  const scale = byId('remote-scale');
  const page = byId('page-remote');
  if (page.clientHeight === 0) return;
  scale.style.zoom = '1';
  const style = getComputedStyle(page);
  const room = page.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  scale.style.zoom = String(clamp(room / scale.offsetHeight, REMOTE_MIN_SCALE, 1));
}

// The container of the pages never changes with the remote's own size, so this cannot feed back into itself.
new ResizeObserver(fitRemote).observe(byId('page-remote').parentElement);
