/* Settings: a stack of pages under one header, with the root page's own rows. */

const PAGES = ['root', 'device', 'schedules', 'prefs', 'remote'];
const PAGE_ENTER = { device: () => enterDevicePage() };

let pageStack = ['root'];
let pageOpeners = [];
// The button that opened settings: it gets the focus back when they close.
let settingsOpener = null;

function settingsOpen() {
  return panel.classList.contains('settings-open');
}

function pageElement(name) {
  return byId(`page-${name}`);
}

function applyPageStack() {
  const top = pageStack.at(-1);
  for (const name of PAGES) {
    const page = pageElement(name);
    page.classList.toggle('active', name === top);
    page.classList.toggle('behind', name !== top && pageStack.includes(name));
    page.inert = name !== top;
  }
  byId('settings-title').textContent = t(pageElement(top).dataset.titleKey);
  byId('device-name').hidden = top !== 'root';
}

function pushPage(name, opener = null) {
  pageStack.push(name);
  pageOpeners.push(opener);
  applyPageStack();
  PAGE_ENTER[name]?.();
  byId('settings-title').focus();
}

function resetPages() {
  pageStack = ['root'];
  pageOpeners = [];
  applyPageStack();
}

// The remote opens as a page of its own: Back from it leaves settings, as it leaves the main view.
function openSettings(page = null, opener = null) {
  closePopup();
  resetPages();
  settingsOpener = opener;
  panel.classList.add('settings-open');
  byId('settings').inert = false;
  document.querySelector('.view-main').inert = true;
  renderSettings();
  if (page === 'remote') {
    pageStack = [];
    pushPage(page);
  } else if (page) {
    pushPage(page);
  } else {
    byId('close-settings').focus();
  }
}

function closeSettings({ restoreFocus = false } = {}) {
  panel.classList.remove('settings-open');
  byId('settings').inert = true;
  document.querySelector('.view-main').inert = false;
  if (restoreFocus) (settingsOpener ?? byId('open-settings')).focus();
}

// Back pops one page; from the first page it leaves settings.
function goBack() {
  if (pageStack.length < 2) {
    closeSettings({ restoreFocus: true });
    return;
  }
  pageStack.pop();
  const opener = pageOpeners.pop();
  applyPageStack();
  (opener ?? byId('settings-title')).focus();
}

/* Segmented control shared by every page */

function renderSegmented(container, options, selected, onPick) {
  const signature = options.map((option) => option.value).join('|');
  if (container.dataset.signature !== signature) {
    container.dataset.signature = signature;
    container.replaceChildren(
      ...options.map((option) => {
        const button = el('button', { type: 'button', 'data-value': String(option.value) }, option.label);
        button.addEventListener('click', () => onPick(option.value));
        return button;
      }),
    );
  }
  // The labels change with the language; rewriting them in place keeps the focus on the button the user is pressing.
  options.forEach((option, index) => {
    const button = container.children[index];
    if (button.textContent !== option.label) button.textContent = option.label;
    button.setAttribute('aria-pressed', String(button.dataset.value === String(selected)));
  });
}

/* Root page */

function renderRoot() {
  const device = view?.device;
  byId('device-name').textContent = device?.nome ?? '';
  byId('device-row-name').textContent = device?.nome ?? '--';
}

function renderSettings() {
  renderRoot();
  renderDevicePage();
  renderSchedulesPage();
  renderPrefsPage();
  renderRemotePage();
}

/* Wiring */

for (const button of document.querySelectorAll('[data-go]')) {
  button.addEventListener('click', () => pushPage(button.dataset.go, button));
}

byId('open-settings').addEventListener('click', (event) => openSettings(null, event.currentTarget));
byId('open-remote').addEventListener('click', (event) => openSettings('remote', event.currentTarget));
byId('close-settings').addEventListener('click', goBack);
