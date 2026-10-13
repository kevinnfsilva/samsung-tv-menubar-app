/* The two layouts of the panel: "compacto" (the single view) and "abas" (tabs). One page serves both; the stylesheet shows the
   parts that belong to the style set on the panel. A switch is a setting, `estilo`: the main process resizes the window when
   it changes, and the page fades its content out, swaps the style while it is invisible and fades it back in. */

const STYLES = ['compacto', 'abas'];
const STYLE_OUT_MS = 130;
const STYLE_IN_MS = 360;

// The main process hands the style over in the page's address, so the very first frame already has the right layout.
function startStyle() {
  const wanted = new URLSearchParams(location.search).get('estilo');
  panel.dataset.style = STYLES.includes(wanted) ? wanted : 'compacto';
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let styleTimer = null;
let styleShown = null;

// Puts the page in the layout the setting asks for; `animate` is false for the first draw and while the panel is hidden.
function renderStyle({ animate = true } = {}) {
  const wanted = STYLES.includes(settings.estilo) ? settings.estilo : 'compacto';
  if (wanted === panel.dataset.style) return;
  clearTimeout(styleTimer);
  const apply = () => {
    closePopup();
    closeSettings();
    panel.dataset.style = wanted;
    panel.dataset.tab = 'home';
    resetPages();
    renderTabs();
  };
  if (!animate || reducedMotion() || panel.classList.contains('asleep')) {
    apply();
    return;
  }
  panel.classList.remove('style-in');
  panel.classList.add('style-out');
  styleTimer = setTimeout(() => {
    apply();
    void panel.offsetWidth;
    panel.classList.remove('style-out');
    panel.classList.add('style-in');
    styleTimer = setTimeout(() => panel.classList.remove('style-in'), STYLE_IN_MS);
  }, STYLE_OUT_MS);
}

function toggleStyle() {
  window.ac.updateSettings({ estilo: panel.dataset.style === 'abas' ? 'compacto' : 'abas' });
}

for (const button of document.querySelectorAll('.style-toggle')) button.addEventListener('click', toggleStyle);

/* Tabs: the selection highlight glides under the tab that is open; the remote and the apps need a reachable TV. */

function renderTabs() {
  const tab = TABS.includes(currentTab()) ? currentTab() : 'home';
  byId('tabbar').style.setProperty('--tab-index', String(TABS.indexOf(tab)));
  for (const button of document.querySelectorAll('.tab')) {
    const open = button.dataset.tab === tab;
    if (open) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    button.disabled = ['control', 'apps'].includes(button.dataset.tab) && !usable();
  }
  // Signed out, there is nothing to remote: the tab falls back to Início (an offline TV keeps its dimmed remote on screen).
  if (tabbed() && loggedOut() && ['control', 'apps'].includes(tab)) selectTab('home');
}
