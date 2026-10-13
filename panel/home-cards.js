/* The tabbed layout's Início tab: the header subtitle, the "now on screen" line, the favourites row, the list of inputs and the
   model in the footer. The compact layout keeps them in the page too, but its stylesheet hides them. */

function stateWord(device) {
  if (device?.online === false) return t('device.stateOffline');
  if (!device) return '';
  return t(device.ligado ? 'device.stateOn' : 'device.stateOff');
}

function renderHeaderTexts(device) {
  const state = stateWord(device);
  byId('tv-sub').textContent = state ? `${t('device.brand')} · ${state}` : t('device.brand');
  const model = textOf(device?.modelo);
  const element = byId('tv-model');
  element.hidden = model === null;
  element.textContent = model ?? '';
  // What is on screen: the app or input, and the channel when the TV reports one.
  const title = device?.ligado ? (screenTitle(device) ?? t('device.stateOn')) : t('home.tvOff');
  const channel = device?.ligado && device.canal != null ? ` · ${t('main.channel')} ${device.canal}` : '';
  byId('now-value').textContent = title + channel;
}

/* Favourites */

function renderFavorites() {
  byId('fav-row').replaceChildren(
    ...TV_APPS.slice(0, FAVORITE_COUNT).map((app) => {
      const button = el('button', { type: 'button', class: 'fav', 'data-app': app.id }, appBadge(app), el('span', { class: 'fav-name' }, app.nome));
      button.addEventListener('click', () => sendApp(app.id));
      return button;
    }),
  );
}

byId('favs-all').addEventListener('click', () => selectTab('apps'));

/* Inputs: the TV's own list, the one in use ticked */

function inputIcon(id) {
  return /^(dtv|atv|antenna|tv)$/i.test(id) ? 'tv' : 'cable';
}

// "HDMI1" reads "HDMI 1"; the other ids are left as the TV spells them.
function inputCode(id) {
  return String(id).replace(/^(HDMI|USB)(\d)/i, (_match, kind, digit) => `${kind.toUpperCase()} ${digit}`);
}

function inputRow(input) {
  const code = inputCode(input.id);
  // Only a code worth reading goes under the name ("HDMI 1"); "dtv" and the like say nothing to a person.
  const note = code !== input.id && code.toLowerCase() !== input.nome.toLowerCase() ? code : null;
  const row = el(
    'button',
    { type: 'button', class: 'input-row', role: 'radio', 'aria-checked': 'false', 'data-id': input.id },
    el('span', { class: 'input-icon' }, iconElement(inputIcon(input.id))),
    el('span', { class: 'input-text' }, el('span', { class: 'input-name' }, input.nome), note && el('span', { class: 'input-note' }, note)),
    el('span', { class: 'input-mark', 'aria-hidden': 'true' }, iconElement('check')),
  );
  row.addEventListener('click', () => {
    if (usable()) send('entrada', input.id);
  });
  return row;
}

function renderInputs(device) {
  const inputs = inputsOf(device);
  const list = byId('input-list');
  byId('inputs-empty').hidden = inputs.length > 0;
  if (changed('inputs', inputs.map(({ id, nome }) => [id, nome]))) list.replaceChildren(...inputs.map(inputRow));
  for (const row of list.children) {
    row.setAttribute('aria-checked', String(row.dataset.id === device?.entrada));
    row.disabled = !usable();
  }
}

function renderHomeCards(device) {
  renderInputs(device);
}

renderFavorites();
