/* Controle: the TV remote as a page of the settings stack. Each control sends one command to the TV, in the order pressed. */

// The d-pad, Back, Home and Menu send a key of the remote; the keyboard uses the same function.
function sendKey(key) {
  if (usable()) window.ac.run('tecla', key);
}

function sendApp(id) {
  if (usable()) window.ac.run('app', id);
}

function renderApps() {
  byId('apps').replaceChildren(
    ...TV_APPS.map((app) => {
      const button = el('button', { type: 'button', class: 'app-key', 'data-app': app.id }, app.nome);
      button.addEventListener('click', () => sendApp(app.id));
      return button;
    }),
  );
}

// Without a reachable TV the page shows, dimmed, and its controls do nothing.
function renderRemotePage() {
  byId('page-remote').dataset.usable = String(usable());
}

renderApps();

for (const button of document.querySelectorAll('#page-remote [data-key]')) {
  button.addEventListener('click', () => sendKey(button.dataset.key));
}

for (const button of document.querySelectorAll('#page-remote [data-action]')) {
  button.addEventListener('click', () => {
    if (usable()) window.ac.run(button.dataset.action);
  });
}
