const volumeInput = byId('volume-input');

// Target of the last step while its command is still in flight, so fast key repeats keep adding up.
let pendingVolume = null;
let lastLogin = 'ok';
let notice = null;
let noticeTimer = null;
const NOTICE_MS = 4000;
const VOLUME_MAX = 100;

function send(key, value) {
  window.ac.set(key, value);
}

function withDevice(handler) {
  return (event) => {
    if (view?.device) handler(view.device, event);
  };
}

// A short message in the footer for something the main process refused; it clears itself. It is kept as a dictionary
// key so that a language change while it shows translates it too.
function showNotice(key) {
  notice = key;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice = null;
    renderMain();
  }, NOTICE_MS);
  renderMain();
}

// The main process resolves null when it refused a request, undefined when it has no answer.
async function refused(call, noticeKey) {
  const result = await call;
  if (result === null) showNotice(noticeKey);
  return result;
}

/* Volume */

// Key repeats and a dragged slider change the number faster than it can roll: the first change of a burst rolls it.
const ROLL_BURST_MS = 80;
let lastRollAt = Number.NEGATIVE_INFINITY;

function showVolume(value) {
  const element = byId('volume');
  const previous = element.dataset.value ? Number(element.dataset.value) : Number.NaN;
  element.dataset.value = value ?? '';
  if (element.textContent === formatVolume(value)) return;
  const before = element.textContent;
  element.textContent = formatVolume(value);
  if (value == null || Number.isNaN(previous)) return;
  const now = performance.now();
  const burst = now - lastRollAt < ROLL_BURST_MS;
  lastRollAt = now;
  if (burst) return;
  // The old number leaves on the ghost beside the value while the new one arrives
  const ghost = byId('volume-ghost');
  ghost.textContent = before;
  const direction = value > previous ? 'roll-up' : 'roll-down';
  for (const node of [element, ghost]) {
    node.classList.remove('roll-up', 'roll-down');
    void node.offsetWidth;
    node.classList.add(direction);
  }
}

function setSliderPosition(value) {
  volumeInput.value = value ?? 0;
  volumeInput.parentElement.style.setProperty('--pct', value == null ? 0 : clamp(value / VOLUME_MAX, 0, 1));
}

// One step of the volume buttons and of the arrow keys; each step builds on the last one still in flight.
function stepVolume(direction) {
  const device = view?.device;
  if (!usable() || device.volume == null) return;
  const base = pendingVolume ?? device.volume;
  const next = clamp(base + direction, 0, VOLUME_MAX);
  if (next === base) return;
  pendingVolume = next;
  showVolume(next);
  setSliderPosition(next);
  send('volume', next);
}

function runChannel(action) {
  if (usable()) window.ac.run(action);
}

/* Rendering */

// The option menus' cells show the current value and open a menu of the TV's own list; an empty list leaves the cell off.
// A long name is cut in its cell, so the full name is also the cell's tooltip.
function renderCells(device) {
  for (const key of ['entrada', 'imagem', 'som']) {
    const cell = document.querySelector(`[data-menu='${key}']`);
    const current = currentOf(key, device);
    cell.disabled = menuOptions(key, device).length === 0;
    cell.title = current ?? '';
    document.querySelector(`[data-value-for='${key}']`).textContent = current ?? '--';
  }
}

// Draws the whole main view; with no TV yet (signed out, still loading) every value shows as "--".
function renderDevice(device) {
  const volume = Number.isInteger(device?.volume) ? device.volume : null;
  const muted = device?.mudo === true;
  panel.dataset.power = device?.ligado ? 'on' : 'off';
  panel.dataset.muted = String(muted);
  byId('tv-name').textContent = device?.nome || t('device.defaultName');
  byId('power').setAttribute('aria-label', t(device?.ligado ? 'main.powerOff' : 'main.powerOn'));
  byId('mute').setAttribute('aria-checked', String(muted));
  volumeInput.disabled = volume == null;
  byId('volume-down').disabled = volume == null || volume <= 0;
  byId('volume-up').disabled = volume == null || volume >= VOLUME_MAX;
  if (!volumeInput.parentElement.classList.contains('dragging')) {
    showVolume(volume);
    setSliderPosition(volume);
  }
  byId('channel').textContent = device?.canal == null ? '--' : String(device.canal);
  renderCells(device);
  byId('tv-app').textContent = screenTitle(device) ?? '';
  byId('tv-mode').textContent = textOf(device?.imagem) ?? '';
  renderHeaderTexts(device);
  renderHomeCards(device);
}

// What a failed run looks like to the person, by reason: the footer and the sign-in card say the same thing.
function failedError(error) {
  const reason = Object.hasOwn(ERROR_STATUS, error.reason) ? error.reason : 'desconhecido';
  const known = ERROR_STATUS[reason];
  // The backend's own message is in Portuguese: it is only worth showing to someone reading Portuguese.
  const detail = activeLocale === 'pt-BR' ? error.message : undefined;
  return { icon: known.icon, text: t(`status.error.${reason}`), pick: Boolean(known.pick), detail };
}

function statusFor(current) {
  const error = current?.error;
  if (error?.kind === 'failed') return { tone: 'error', retry: true, ...failedError(error) };
  const device = current?.device;
  if (device?.online === false) return { tone: 'error', icon: 'unplug', text: t('status.offline'), retry: true };
  if (error?.kind === 'unconfirmed') {
    const text = t('status.unconfirmed', { names: formatList(error.keys.map(unconfirmedName)) });
    return { tone: 'error', icon: 'triangle-alert', text, detail: text };
  }
  if (notice) return { tone: 'error', icon: 'triangle-alert', text: t(notice) };
  if (!device) return { tone: 'busy', icon: 'loader-circle', text: t('status.connecting') };
  if (current.syncing) return { tone: 'busy', icon: 'loader-circle', text: t('status.syncing') };
  if (settings.timer) {
    const text = timerText(settings.timer);
    // A timer of another TV has a longer line, which the footer may cut: the full text stays in the tooltip.
    return { tone: 'quiet', icon: 'clock', text, detail: otherUnitName(settings.timer.aparelho) ? text : undefined };
  }
  return { tone: 'ok', icon: 'shield-check', text: t('status.connected') };
}

function updatedAtText() {
  if (!view?.updatedAt) return '';
  return t('status.updatedAt', { time: formatClock(view.updatedAt) });
}

// What the footer says now, to tell a real change of message from a redraw of the same one.
let statusKey = null;

// The old message leaves as a ghost that fades up and out while the new one fades in from below.
function crossfadeStatus(element) {
  const icon = byId('status-icon');
  const mark = el('span', { class: 'status-icon' }, ...[...icon.childNodes].map((node) => node.cloneNode(true)));
  mark.style.color = getComputedStyle(icon).color;
  const ghost = el('span', { class: 'status-ghost', 'aria-hidden': 'true' }, mark, el('span', {}, byId('status-text').textContent));
  ghost.style.color = getComputedStyle(element).color;
  element.querySelectorAll('.status-ghost').forEach((old) => old.remove());
  element.append(ghost);
  ghost.addEventListener('animationend', () => ghost.remove());
  element.classList.remove('swap');
  void element.offsetWidth;
  element.classList.add('swap');
}

function renderStatus(status) {
  const element = byId('status');
  const key = JSON.stringify([status.icon, status.text, status.tone]);
  const swapping = statusKey !== null && statusKey !== key && !element.hidden && !panel.classList.contains('asleep');
  statusKey = key;
  if (swapping) crossfadeStatus(element);
  element.hidden = loggedOut();
  element.dataset.tone = status.tone;
  panel.dataset.tone = status.tone;
  setIcon(byId('status-icon'), status.icon);
  byId('status-text').textContent = status.text;
  byId('retry').hidden = !status.retry;
  byId('pick-device').hidden = !status.pick;
  element.title = status.detail ?? updatedAtText();
}

// A failed run can leave an error behind while the user is still signed out (no internet, say): the card says so, since
// the footer is hidden then.
function renderLoginError() {
  const shown = view?.error?.kind === 'failed' ? failedError(view.error) : null;
  for (const box of document.querySelectorAll('.login-error')) {
    box.hidden = shown === null;
    if (!shown) continue;
    setIcon(box.querySelector('.login-error-icon'), shown.icon);
    box.querySelector('.login-error-text').textContent = shown.text;
    box.title = shown.detail ?? '';
  }
}

// A signed-out card swaps its content under the focused button, so focus follows the card's action.
function renderLogin(login) {
  const hadFocus = byId('login-card').contains(document.activeElement);
  byId('login-needed').hidden = login !== 'needed';
  byId('login-waiting').hidden = login !== 'waiting';
  renderLoginError();
  if (login === lastLogin) return;
  lastLogin = login;
  if (login === 'ok' || !hadFocus || !keyboardUser) return;
  (login === 'needed' ? byId('login') : byId('cancel-login')).focus();
}

// The remote and the timer need a reachable TV, and an error leaves their room to the message.
function renderFooterTools(status) {
  const available = usable() && status.tone !== 'error';
  for (const tool of document.querySelectorAll('.tool')) {
    tool.hidden = loggedOut() || status.tone === 'error';
    tool.disabled = !available;
  }
  byId('open-timer').dataset.active = String(Boolean(settings.timer));
  if (!available && popupOwner?.classList.contains('tool')) closePopup();
}

function renderMain() {
  const device = view?.device ?? null;
  const login = loginState();
  const status = statusFor(view);
  panel.dataset.loading = String(!device);
  panel.dataset.login = login;
  panel.dataset.online = String(device?.online !== false);
  renderDevice(device);
  // Behind the sign-in card the TV stays idle, whatever the last reading said.
  if (login !== 'ok') panel.dataset.power = 'off';
  renderLogin(login);
  renderStatus(status);
  renderFooterTools(status);
  renderTabs();
}

/* Wiring */

byId('power').addEventListener('click', withDevice((device) => send('ligado', !device.ligado)));
byId('mute').addEventListener('click', withDevice((device) => send('mudo', !device.mudo)));
byId('volume-down').addEventListener('click', () => stepVolume(-1));
byId('volume-up').addEventListener('click', () => stepVolume(1));
byId('channel-down').addEventListener('click', () => runChannel('canal-'));
byId('channel-up').addEventListener('click', () => runChannel('canal+'));

volumeInput.addEventListener('input', () => {
  const value = Number(volumeInput.value);
  volumeInput.parentElement.classList.add('dragging');
  showVolume(value);
  setSliderPosition(value);
});

volumeInput.addEventListener('change', () => {
  volumeInput.parentElement.classList.remove('dragging');
  pendingVolume = Number(volumeInput.value);
  send('volume', pendingVolume);
});

byId('retry').addEventListener('click', () => window.ac.refresh());
byId('pick-device').addEventListener('click', () => openSettings('device'));
byId('login').addEventListener('click', () => window.ac.login());
byId('cancel-login').addEventListener('click', () => window.ac.cancelLogin());
