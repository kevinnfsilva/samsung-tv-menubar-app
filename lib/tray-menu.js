const IS_MAC = process.platform === 'darwin';

// The tooltip is the TV's name, then its state, volume and input; every reading is optional, so a null one is left out.
function tooltipFor({ device, login }, { t, number }) {
  if (login === 'needed') return ['TV Remote', t('tray.tooltip.signIn')].join('\n');
  if (login === 'waiting') return ['TV Remote', t('tray.tooltip.waiting')].join('\n');
  if (!device) return 'TV Remote';
  const name = device.nome ?? t('device.defaultName');
  if (device.online === false) return t('tray.tooltip.offline', { name });
  const lines = [name];
  if (device.ligado === true) lines.push(t('tray.tooltip.on'));
  else if (device.ligado === false) lines.push(t('tray.tooltip.off'));
  if (device.volume != null) lines.push(t('tray.tooltip.volume', { volume: number(device.volume) }));
  // The input is shown by its name; an id that is not in the list of inputs has no name to show.
  const input = device.entradas?.find((entrada) => entrada.id === device.entrada)?.nome;
  if (input) lines.push(t('tray.tooltip.input', { input }));
  return lines.join('\n');
}

function menuTemplate({ view, autostart, update, i18n: { t }, actions }) {
  const { device, login } = view;
  const powerState = device?.ligado;
  const template = [];
  if (update) template.push({ label: t('tray.menu.update', { version: update.versao }), click: actions.openUpdate }, { type: 'separator' });
  template.push({ label: t('tray.menu.open'), click: actions.showPanel });
  if (login === 'needed') {
    template.push({ label: t('tray.menu.signIn'), click: actions.login });
  } else if (login === 'waiting') {
    template.push({ label: t('tray.menu.waiting'), enabled: false }, { label: t('tray.menu.cancelLogin'), click: actions.cancelLogin });
  } else {
    template.push(
      {
        label: powerState ? t('tray.menu.turnOff') : t('tray.menu.turnOn'),
        enabled: Boolean(device),
        click: () => actions.setPower(!powerState),
      },
      {
        label: t('tray.menu.mute'),
        type: 'checkbox',
        checked: device?.mudo === true,
        enabled: Boolean(device),
        // Electron flips the checkbox before the click, so the item says the new state.
        click: (item) => actions.setMute(item.checked),
      },
      { label: t('tray.menu.refresh'), click: actions.refresh },
    );
  }
  template.push(
    { type: 'separator' },
    { label: t(IS_MAC ? 'autostart.mac' : 'autostart.windows'), type: 'checkbox', checked: autostart, click: (item) => actions.setAutostart(item.checked) },
    { type: 'separator' },
    { label: t('tray.menu.quit'), click: actions.quit },
  );
  return template;
}

module.exports = { menuTemplate, tooltipFor };
