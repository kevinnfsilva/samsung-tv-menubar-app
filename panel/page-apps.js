/* Apps: a grid of badges on its own page (a tab of the tabbed layout), and the shortcuts on the drawn remote. The list lives
   in TV_APPS (labels.js). A badge is the app's mark when TV_APPS carries one, else a colour block with an initial. */

function renderAppGrid() {
  byId('app-grid').replaceChildren(
    ...TV_APPS.map((app) => {
      const tile = el('button', { type: 'button', class: 'app-tile', 'data-app': app.id }, appBadge(app), el('span', { class: 'app-tile-name' }, app.nome));
      tile.addEventListener('click', () => sendApp(app.id));
      return tile;
    }),
  );
}

// The remote's own three app keys: a small badge and the name.
function renderRemoteApps() {
  byId('remote-apps').replaceChildren(
    ...TV_APPS.filter((app) => app.key).map((app) => {
      const key = el('button', { type: 'button', class: 'rm-app remote-control', 'data-app': app.id }, appBadge(app), el('span', {}, app.nome));
      key.addEventListener('click', () => {
        sendApp(app.id);
        flash(key);
        blinkLed();
      });
      return key;
    }),
  );
}

renderAppGrid();
renderRemoteApps();
