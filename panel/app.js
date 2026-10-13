// Entry point: renders from the two sources of truth (the bridge view and the settings) and subscribes to them.

let settingsReceived = false;
let updateReceived = false;

function render() {
  renderMain();
  renderSettings();
  renderUpdate();
  renderTrayIcon();
  const device = view?.device;
  const popupInputs = [
    settings.timer,
    Boolean(device),
    device?.ligado,
    device?.mudo,
    device?.entrada,
    device?.entradas,
    device?.imagem,
    device?.imagens,
    device?.som,
    device?.sons,
  ];
  if (changed('popup', popupInputs)) refreshPopup();
}

panel.addEventListener('animationend', (event) => {
  if (event.target === panel) panel.classList.remove('entering');
});

window.ac.onShow(() => {
  markPanelShown();
  panel.classList.remove('asleep', 'entering');
  void panel.offsetWidth;
  panel.classList.add('entering');
});

window.ac.onHide(() => {
  closePopup();
  closeSettings();
  resetPages();
  panel.classList.add('asleep');
});

// Every text drawn so far is in the old language: the caches that skip redundant redraws are dropped, then all is drawn again.
window.ac.onLocale((code) => {
  setLocale(code);
  signatures.clear();
  applyPageStack();
  render();
});

window.ac.onTheme((dark) => {
  darkTaskbar = dark;
  trayIconKey = '';
  renderTrayIcon();
});

window.ac.onState((next) => {
  view = next;
  pendingVolume = null;
  render();
});

// Registered before getState() below: settings also change outside the panel (tray menu, a timer firing).
window.ac.onSettings((next) => {
  settingsReceived = true;
  applySettings(next);
  render();
});

window.ac.onUpdate((next) => {
  updateReceived = true;
  applyUpdate(next);
  renderUpdate();
});

document.documentElement.dataset.platform = window.ac.platform;
if (IS_MAC) {
  byId('autostart-title').dataset.i18n = 'autostart.mac';
  byId('autostart').dataset.i18nAriaLabel = 'autostart.mac';
  byId('row-dock').hidden = false;
  // Only the macOS menu bar icon can show the volume next to the TV glyph; the Windows tray icon always does.
  byId('row-volume-icon').hidden = false;
  applyStaticTexts();
}

lucide.createIcons();

window.ac.getState().then((initial) => {
  darkTaskbar = initial.darkTaskbar;
  view ??= initial.view;
  if (!settingsReceived) applySettings(initial.settings);
  if (!updateReceived) applyUpdate(initial.update);
  if (initial.locale) setLocale(initial.locale);
  render();
});
