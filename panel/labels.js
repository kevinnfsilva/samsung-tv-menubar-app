// Icons, value lists and the names the panel shows for them. Every text comes from the dictionary (../locales), so the
// functions below look it up when they are called and follow a language change.

// Icons of the option menus, by the key they set on the TV.
const MENU_ICONS = { entrada: 'cable', imagem: 'sun-medium', som: 'audio-lines' };

// The apps the remote launches: the Samsung store ids, kept in one place so they are easy to fix or extend. `brand` picks the
// badge colours (styles in remote.css); `key` puts the app on the drawn remote, which has three. An app with a `glyph` is drawn
// with its mark: the Netflix and YouTube paths below are the ones of the Simple Icons set (CC0, https://simpleicons.org, v16.35.0,
// 24x24 viewBox), copied as they are because the project does not depend on that package. Prime Video and Disney+ are not in the
// set and have no openly licensed mark, so they stay a plain colour block with an initial (`mark`) and no logo.
const TV_APPS = [
  {
    id: '3201907018807',
    nome: 'Netflix',
    brand: 'netflix',
    key: true,
    glyph: 'm5.398 0 8.348 23.602c2.346.059 4.856.398 4.856.398L10.113 0H5.398zm8.489 0v9.172l4.715 13.33V0h-4.715zM5.398 1.5V24c1.873-.225 2.81-.312 4.715-.398V14.83L5.398 1.5z',
  },
  {
    id: '111299001912',
    nome: 'YouTube',
    brand: 'youtube',
    key: true,
    glyph:
      'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  },
  { id: '3201910019365', nome: 'Prime Video', brand: 'prime', mark: 'P', key: true },
  { id: '3201901017640', nome: 'Disney+', brand: 'disney', mark: 'D+', key: false },
];
const FAVORITE_COUNT = 4;

const SVG_NS = 'http://www.w3.org/2000/svg';

function appBadge(app) {
  const badge = el('span', { class: 'badge', 'data-brand': app.brand, 'aria-hidden': 'true' }, app.glyph ? null : app.mark);
  if (app.glyph) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', app.glyph);
    svg.append(path);
    badge.append(svg);
  }
  return badge;
}

// Words that name the app running on the TV when device.app only carries an id such as "9Ur5IzDKqV.TizenYouTube".
const APP_WORDS = [
  { word: 'YouTube', nome: 'YouTube' },
  { word: 'Netflix', nome: 'Netflix' },
  { word: 'Prime', nome: 'Prime Video' },
  { word: 'Disney', nome: 'Disney+' },
  { word: 'Globoplay', nome: 'Globoplay' },
  { word: 'Spotify', nome: 'Spotify' },
  { word: 'tvplus', nome: 'Samsung TV Plus' },
];

const ERROR_STATUS = {
  rede: { icon: 'wifi-off' },
  'sem-tv': { icon: 'tv' },
  aparelho: { icon: 'search-x', pick: true },
  tempo: { icon: 'hourglass' },
  desconhecido: { icon: 'cloud-off' },
};

const UNCONFIRMED_KEYS = ['ligado', 'volume', 'mudo', 'entrada', 'imagem', 'som'];

const TIMER_MINUTES = [30, 60, 120, 240, 480];

const SCHEDULE_ACTION_VALUES = ['liga', 'desliga'];

const ON_HOURS_VALUES = [0, 4, 8, 12];

function textOf(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

// The lists the TV reports; anything else in them is dropped rather than shown.
function listOf(value) {
  return Array.isArray(value) ? value.filter((item) => textOf(item) !== null) : [];
}

function inputsOf(device) {
  if (!Array.isArray(device?.entradas)) return [];
  return device.entradas
    .filter((item) => textOf(item?.id) !== null)
    .map((item) => ({ id: item.id, nome: textOf(item.nome) ?? item.id }));
}

// The input's name, or its id when the TV does not name it.
function inputName(device) {
  const current = textOf(device?.entrada);
  if (current === null) return null;
  return inputsOf(device).find((input) => input.id === current)?.nome ?? current;
}

// The friendly name of the running app, when device.app names one.
function appName(device) {
  const app = textOf(device?.app);
  if (app === null) return null;
  const known = TV_APPS.find((item) => item.id === app);
  if (known) return known.nome;
  const lower = app.toLowerCase();
  const named = APP_WORDS.find(({ word }) => lower.includes(word.toLowerCase()))?.nome;
  if (named) return named;
  // Live TV puts the channel's name there, with spaces; anything else is an id nobody should have to read.
  return app.includes(' ') ? app : null;
}

// The first line on the TV's screen: the app when one is known, else the input.
function screenTitle(device) {
  return appName(device) ?? inputName(device);
}

// The options of an option menu: the inputs (by id), or the picture and sound modes (by name).
function menuOptions(key, device) {
  if (key === 'entrada') {
    return inputsOf(device).map(({ id, nome }) => ({ value: id, label: nome, selected: id === device?.entrada }));
  }
  const current = textOf(key === 'imagem' ? device?.imagem : device?.som);
  const names = listOf(key === 'imagem' ? device?.imagens : device?.sons);
  return names.map((value) => ({ value, label: value, selected: value === current }));
}

// What a menu cell shows: the current input, picture or sound mode.
function currentOf(key, device) {
  if (key === 'entrada') return inputName(device);
  return textOf(key === 'imagem' ? device?.imagem : device?.som);
}

function formatVolume(value) {
  return value == null ? '--' : String(value);
}

function unconfirmedName(key) {
  return UNCONFIRMED_KEYS.includes(key) ? t(`unconfirmed.${key}`) : key;
}

// "30 min", "2 h": the length alone, for the chips of the timer card.
function durationLabel(minutos) {
  return minutos < 60 ? t('fmt.minutes', { n: minutos }) : t('fmt.hours', { n: minutos / 60 });
}

function timerOptions(acao) {
  const key = acao === 'liga' ? 'timer.turnOnIn' : 'timer.turnOffIn';
  return TIMER_MINUTES.map((minutos) => {
    return { minutos, label: t(key, { duration: durationLabel(minutos) }) };
  });
}

function scheduleActions() {
  return SCHEDULE_ACTION_VALUES.map((value) => ({ value, label: t(value === 'liga' ? 'schedules.actionOn' : 'schedules.actionOff') }));
}

function onHoursOptions() {
  return ON_HOURS_VALUES.map((value) => ({ value, label: value === 0 ? t('prefs.never') : t('fmt.hours', { n: value }) }));
}

function weekdayName(day, form) {
  return t(`weekday.${day}.${form}`);
}
