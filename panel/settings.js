/* Navigation: a stack of pages under one header. In the compact layout it is the settings view that slides over the main one
   (and the drawn remote is one of its pages); in the tabbed layout the base page of the stack is the page of the selected tab,
   and Início is the main view itself. */

const PAGES = ['root', 'device', 'schedules', 'prefs', 'remote', 'apps'];
const TABS = ['home', 'control', 'apps', 'routines', 'settings'];
const TAB_PAGE = { control: 'remote', apps: 'apps', routines: 'schedules', settings: 'root' };
const PAGE_ENTER = { device: () => enterDevicePage() };

let pageStack = ['root'];
let pageOpeners = [];
// The button that opened settings: it gets the focus back when they close.
let settingsOpener = null;

function tabbed() {
  return panel.dataset.style === 'abas';
}

function currentTab() {
  return panel.dataset.tab;
}

function settingsOpen() {
  return panel.classList.contains('settings-open');
}

function pageElement(name) {
  return byId(`page-${name}`);
}

// In the tabbed layout a tab's page waits to the left of the active one when its tab comes before it.
function tabOfPage(name) {
  return TABS.indexOf(pageElement(name).dataset.tab);
}

function applyPageStack() {
  const top = pageStack.at(-1);
  const activeTab = TABS.indexOf(currentTab());
  for (const name of PAGES) {
    const page = pageElement(name);
    const before = tabbed() && tabOfPage(name) >= 0 && tabOfPage(name) < activeTab;
    page.classList.toggle('active', name === top);
    page.classList.toggle('behind', name !== top && (pageStack.includes(name) || before));
    page.inert = name !== top;
  }
  panel.dataset.depth = String(pageStack.length);
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
  pageStack = [tabbed() ? (TAB_PAGE[currentTab()] ?? 'root') : 'root'];
  pageOpeners = [];
  applyPageStack();
}

function showSettingsView() {
  panel.classList.add('settings-open');
  byId('settings').inert = false;
  byId('view-main').inert = true;
  for (const part of document.querySelectorAll('.top, .status')) part.inert = !tabbed();
}

// The remote opens as a page of its own: Back from it leaves settings, as it leaves the main view.
function openSettings(page = null, opener = null) {
  closePopup();
  settingsOpener = opener;
  if (tabbed()) {
    selectTab(page === 'remote' ? 'control' : 'settings');
    if (page && page !== 'remote') pushPage(page);
    return;
  }
  pageStack = ['root'];
  pageOpeners = [];
  applyPageStack();
  showSettingsView();
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
  byId('view-main').inert = false;
  for (const part of document.querySelectorAll('.top, .status')) part.inert = false;
  if (tabbed()) {
    panel.dataset.tab = 'home';
    renderTabs();
  }
  if (restoreFocus) (settingsOpener ?? byId('open-settings')).focus();
}

// The tabbed layout: Início is the main view, every other tab is the base page of the stack.
function selectTab(tab, { restoreFocus = false } = {}) {
  if (!tabbed() || !TABS.includes(tab)) return;
  closePopup();
  if (tab === 'home') {
    closeSettings({ restoreFocus });
    renderTabs();
    return;
  }
  panel.dataset.tab = tab;
  pageStack = [TAB_PAGE[tab]];
  pageOpeners = [];
  applyPageStack();
  showSettingsView();
  renderSettings();
  renderTabs();
}

// Back pops one page; from the first page it leaves settings (or, in the tabbed layout, goes to Início).
function goBack() {
  if (pageStack.length < 2) {
    if (tabbed()) selectTab('home', { restoreFocus: true });
    else closeSettings({ restoreFocus: true });
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
  renderTimerCard();
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

for (const button of document.querySelectorAll('[data-tab].tab')) {
  button.addEventListener('click', () => selectTab(button.dataset.tab));
}
