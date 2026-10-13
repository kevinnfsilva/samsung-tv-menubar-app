const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, nativeTheme, powerMonitor, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { AcBridge } = require('./bridge');
const { appMenuTemplate } = require('./lib/app-menu');
const { isValidChange, isValidRun } = require('./lib/commands');
const { createI18n, resolveLanguage } = require('./lib/i18n');
const { Notifier } = require('./lib/notifications');
const { Scheduler } = require('./lib/scheduler');
const { SettingsStore } = require('./lib/settings');
const { Shortcut } = require('./lib/shortcut');
const { menuTemplate, tooltipFor } = require('./lib/tray-menu');
const { UpdateChecker } = require('./lib/updates');
const { repository } = require('./package.json');

const IS_MAC = process.platform === 'darwin';
// On macOS the window is the card: the system draws its material, rounded corners and shadow. On Windows the window is
// transparent and leaves room around a card drawn in CSS, for the shadow of that card. Each layout of the panel has its
// own size: the compact one is the card the app always had, the tabbed one is taller (and shrinks to fit a short screen).
const PANEL_SIZES = IS_MAC
  ? { compacto: { width: 372, height: 496 }, abas: { width: 376, height: 688 } }
  : { compacto: { width: 412, height: 536 }, abas: { width: 416, height: 728 } };
const TABS_MIN_HEIGHT = 440;
// The distance between the menu bar and the card, and between the card and the edge of the screen.
const PANEL_GAP = 6;
const PANEL_EDGE = 8;
const POLL_VISIBLE_MS = 15_000;
const POLL_HIDDEN_MS = 60_000;
const STALE_AFTER_MS = 5_000;
const REOPEN_GUARD_MS = 300;
const TRAY_SETTLE_MS = 100;
const QUIT_GRACE_MS = 3_000;
const QUIT_POLL_MS = 100;
const LOGIN_ITEM_NAME = 'TV Remote';
const LAUNCH_AGENT_LABEL = 'io.github.kevinnfsilva.tvremote';

const bridge = new AcBridge();
let settings;
let scheduler;
let notifier;
let shortcut;
let updates;
let i18n;
let tray;
let panel;
let pollTimer;
let lastBlurAt = 0;
let menuKey;
let contextMenu;
let quitting = false;

function isAutostartEnabled() {
  return settings.get().autostart;
}

function launchAgentFile() {
  return path.join(app.getPath('home'), 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
}

function isWritable(file) {
  try {
    fs.accessSync(file, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function plistString(value) {
  const escaped = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<string>${escaped}</string>`;
}

// macOS login items can't carry the app folder argument the unpackaged app needs, so a LaunchAgent starts it at login.
// The packaged app goes the same way to keep a single mechanism.
function setLaunchAgent(enabled) {
  const file = launchAgentFile();
  if (!enabled) {
    fs.rmSync(file, { force: true });
    return;
  }
  // Run from the disk image, or from the random path Gatekeeper gives a fresh download, the app is gone by next login.
  const onDiskImage = process.execPath.startsWith('/Volumes/') && !isWritable(process.execPath);
  if (onDiskImage || process.execPath.includes('/AppTranslocation/')) return;
  // The trailing flag tells the launch at login from one the user asked for, which opens the panel.
  const programArguments = [...(app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()]), '--hidden'];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${plistString(LAUNCH_AGENT_LABEL)}
  <key>ProgramArguments</key>
  <array>
    ${programArguments.map(plistString).join('\n    ')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
</dict>
</plist>
`;
  // Rewriting an identical file would make macOS announce the background item again on every launch.
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === plist) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // launchd refuses agents that others can write to.
  fs.writeFileSync(file, plist, { mode: 0o644 });
}

// Applies the setting to the system; the setting itself is saved by the settings store.
function setAutostart(enabled) {
  if (IS_MAC) {
    try {
      setLaunchAgent(enabled);
    } catch (error) {
      // A LaunchAgents folder the user can't write to must not keep the app from starting.
      console.error(error);
    }
  } else {
    // Unpackaged, electron.exe needs the app folder as an argument or it boots the default app.
    const launch = app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] };
    app.setLoginItemSettings({ openAtLogin: enabled, name: LOGIN_ITEM_NAME, ...launch });
  }
  updateMenu(true);
}

// The Dock icon and the menu bar that comes with it go together; without them the app lives in the tray alone.
function applyDock(enabled) {
  if (enabled) {
    app.dock.show().catch(console.error);
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(app.name)));
  } else {
    app.dock.hide();
    // The default menu's shortcuts would let Cmd+W destroy the panel.
    Menu.setApplicationMenu(null);
  }
}

function taskbarIsDark() {
  return nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ?? nativeTheme.shouldUseDarkColors;
}

// macOS paints the window itself: a vibrancy material that stays lit while the panel is not the key window, with the
// system's own corners and shadow. The page above it is transparent.
const MAC_WINDOW = { vibrancy: 'popover', visualEffectState: 'active', hasShadow: true, roundedCorners: true, backgroundColor: '#00000000' };
const WINDOWS_WINDOW = { transparent: true, backgroundColor: '#00000000', hasShadow: false, type: 'toolbar' };

// How long the macOS window takes to fade in; the page's own spring (panel/styles.css) runs a little longer.
const FADE_IN_MS = 160;
let fadeTimer;

function fadeInPanel(win) {
  const started = Date.now();
  // A show of a window that is already up (a second launch, a clicked notification) must not blink: fade from where it is.
  const from = win.getOpacity();
  clearInterval(fadeTimer);
  fadeTimer = setInterval(() => {
    if (win.isDestroyed()) {
      clearInterval(fadeTimer);
      return;
    }
    const progress = Math.min(1, (Date.now() - started) / FADE_IN_MS);
    win.setOpacity(from + (1 - from) * (1 - (1 - progress) ** 2));
    if (progress === 1) clearInterval(fadeTimer);
  }, 16);
}

function panelStyle() {
  return settings.get().estilo === 'abas' ? 'abas' : 'compacto';
}

function createPanel() {
  const panelWindow = new BrowserWindow({
    ...PANEL_SIZES[panelStyle()],
    show: false,
    frame: false,
    ...(IS_MAC ? MAC_WINDOW : WINDOWS_WINDOW),
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (IS_MAC) {
    panelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    // The page cannot fade a window the system draws: it starts clear and fades in as it appears, while the page springs.
    panelWindow.setOpacity(0);
    panelWindow.on('show', () => fadeInPanel(panelWindow));
    panelWindow.on('hide', () => {
      // The event arrives some 300 ms after hide(): a window that is already back on screen must be left alone.
      if (panelWindow.isVisible()) return;
      clearInterval(fadeTimer);
      panelWindow.setOpacity(0);
    });
  }
  // The page starts in the layout the setting asks for, so that not even its first frame is the other one.
  panelWindow.loadFile(path.join(__dirname, 'panel', 'index.html'), { query: { estilo: panelStyle() } });
  panelWindow.on('blur', () => {
    lastBlurAt = Date.now();
    hidePanel();
  });
  return panelWindow;
}

// Where the panel goes: it rises from the Windows taskbar and drops from the macOS menu bar, in the size of its layout.
function panelBounds() {
  const trayBounds = tray.getBounds();
  const anchor = { x: trayBounds.x + trayBounds.width / 2, y: trayBounds.y };
  const { workArea } = screen.getDisplayNearestPoint(anchor);
  const style = panelStyle();
  const { width } = PANEL_SIZES[style];
  const edge = IS_MAC ? PANEL_EDGE : 0;
  const top = IS_MAC ? Math.max(workArea.y, trayBounds.y + trayBounds.height + PANEL_GAP) : workArea.y;
  // Only the tabbed layout scrolls, so only it gives up height when the screen is short.
  const room = workArea.y + workArea.height - top - edge;
  const height = style === 'abas' ? Math.max(TABS_MIN_HEIGHT, Math.min(PANEL_SIZES.abas.height, room)) : PANEL_SIZES[style].height;
  const rightmost = workArea.x + workArea.width - width - edge;
  const centered = trayBounds.width > 0 ? Math.round(anchor.x - width / 2) : rightmost;
  const y = IS_MAC ? top : workArea.y + workArea.height - height;
  return { x: Math.max(workArea.x + edge, Math.min(centered, rightmost)), y, width, height };
}

function positionPanel() {
  panel.setBounds(panelBounds());
}

// A change of layout gives the window its new size: macOS animates it while the page swaps its content.
function resizePanel() {
  if (panel.isVisible()) panel.setBounds(panelBounds(), IS_MAC);
  else positionPanel();
}

// A status item takes a moment to move after its icon changes width, and the open panel hangs from its middle.
function placePanelWhenSettled() {
  setTimeout(positionPanel, TRAY_SETTLE_MS);
}

function showPanel() {
  positionPanel();
  panel.webContents.send('panel:show');
  panel.show();
  panel.focus();
  if (Date.now() - (bridge.updatedAt ?? 0) > STALE_AFTER_MS) bridge.refresh();
  schedulePoll();
}

function hidePanel() {
  if (!panel.isVisible()) return;
  panel.hide();
  // Otherwise macOS keeps the now windowless app in front and the keyboard goes nowhere.
  if (IS_MAC) app.hide();
  panel.webContents.send('panel:hide');
  schedulePoll();
}

// Clicking the tray icon blurs an open panel first, so a click right after a blur means "close", not "reopen".
function togglePanel() {
  if (panel.isVisible()) {
    hidePanel();
    return;
  }
  if (Date.now() - lastBlurAt < REOPEN_GUARD_MS) return;
  showPanel();
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const delay = panel.isVisible() ? POLL_VISIBLE_MS : POLL_HIDDEN_MS;
  pollTimer = setTimeout(() => {
    // Without a session, or after a timeout, a poll would only fail again; the user retries by hand.
    if (!bridge.paused) bridge.refresh();
    schedulePoll();
  }, delay);
}

function updateMenu(force = false) {
  const view = bridge.view();
  const autostart = isAutostartEnabled();
  const update = updates.notice;
  const key = JSON.stringify([view.device?.ligado, view.device?.mudo, Boolean(view.device), view.login, autostart, update?.versao, i18n.language]);
  if (!force && key === menuKey) return;
  menuKey = key;
  contextMenu = Menu.buildFromTemplate(
    menuTemplate({
      view,
      autostart,
      update,
      i18n,
      actions: {
        showPanel,
        openUpdate,
        login: () => bridge.login(),
        cancelLogin: () => bridge.cancelLogin(),
        setPower: (on) => setByHand('ligado', on),
        setMute: (muted) => setByHand('mudo', muted),
        refresh: () => bridge.refresh(),
        setAutostart: (enabled) => settings.update({ autostart: enabled }),
        quit: () => app.quit(),
      },
    }),
  );
  // A menu attached to a macOS status item takes over the left click, so there it only pops up on right-click.
  if (!IS_MAC) tray.setContextMenu(contextMenu);
}

// What the user does by hand wins over a scheduled command that is still being retried for the same unit.
function setByHand(key, value) {
  if (!isValidChange(key, value)) return;
  if (key === 'ligado') scheduler.cancelRetries(bridge.view().device?.id);
  bridge.set(key, value);
}

// A change made a moment ago may still be waiting to go out or be on its way; the bridge would kill it on the way out.
function commandsOnTheWay() {
  return bridge.view().syncing || scheduler.busy;
}

async function openUpdate() {
  const url = updates.downloadPage();
  if (!url) return;
  try {
    await shell.openExternal(url);
  } catch (error) {
    console.error(error);
  }
}

function languageSetting() {
  return resolveLanguage(settings.get().idioma, app.getLocale());
}

// The tray menu and tooltip are rebuilt here; the panel redraws itself when it hears about the new language.
function applyLanguage() {
  const language = languageSetting();
  if (language === i18n.language) return;
  i18n = createI18n(language);
  panel.webContents.send('locale', language);
  tray.setToolTip(tooltipFor(bridge.view(), i18n));
}

// As a template image, macOS repaints the icon to suit whatever sits behind the menu bar.
function trayImage(images) {
  const image = nativeImage.createEmpty();
  for (const { scaleFactor, dataURL } of images) image.addRepresentation({ scaleFactor, dataURL });
  if (IS_MAC) image.setTemplateImage(true);
  return image;
}

function start() {
  // Writing inside the app bundle would break its code signature, so device.json goes next to the settings.
  if (app.isPackaged) process.env.TVREMOTE_DATA_DIR = app.getPath('userData');
  // Windows ties notifications to this id.
  if (!IS_MAC) app.setAppUserModelId(LAUNCH_AGENT_LABEL);

  shortcut = new Shortcut(togglePanel);
  settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), {
    // A key another app already owns can't be registered, so the setting turns itself off instead of lying.
    adjust: (next) => {
      if (!shortcut.apply(next.atalho)) next.atalho.ativo = false;
    },
  });
  // Registered before anything else listens, so the panel hears every change in order even when a later listener changes settings in turn.
  settings.on('change', (next, previous) => {
    panel.webContents.send('settings', next);
    if (next.estilo !== previous.estilo) resizePanel();
    if (next.idioma !== previous.idioma) applyLanguage();
    if (next.autostart !== previous.autostart) setAutostart(next.autostart);
    if (IS_MAC && next.dock !== previous.dock) applyDock(next.dock);
    if (next.atualizacoes !== previous.atualizacoes) updates.setEnabled(next.atualizacoes);
    updateMenu();
  });
  i18n = createI18n(languageSetting());
  updates = new UpdateChecker({ repository, version: app.getVersion() });
  if (IS_MAC) applyDock(settings.get().dock);
  notifier = new Notifier({ settings, bridge, onClick: showPanel, i18n: () => i18n });
  scheduler = new Scheduler({
    settings,
    bridge,
    notify: (aparelho, key) => notifier.alert(aparelho.nome, key),
    file: path.join(app.getPath('userData'), 'pendentes.json'),
  });

  panel = createPanel();
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('TV Remote');
  tray.on('click', togglePanel);
  if (IS_MAC) {
    tray.setIgnoreDoubleClickEvents(true);
    tray.on('right-click', () => tray.popUpContextMenu(contextMenu));
  }
  // An empty update registers a shortcut saved as active, and turns the setting off when the key is no longer free.
  settings.update({});
  updateMenu(true);
  setAutostart(isAutostartEnabled());

  bridge.on('change', (view) => {
    panel.webContents.send('state', view);
    tray.setToolTip(tooltipFor(view, i18n));
    updateMenu();
    notifier.check(view);
  });
  updates.on('change', (notice) => {
    panel.webContents.send('update', notice);
    updateMenu();
  });

  ipcMain.handle('state:get', () => ({ view: bridge.view(), darkTaskbar: taskbarIsDark(), settings: settings.get(), locale: i18n.language, update: updates.notice }));
  ipcMain.handle('autostart:get', isAutostartEnabled);
  ipcMain.on('autostart:set', (_event, enabled) => settings.update({ autostart: enabled }));
  ipcMain.on('ac:set', (_event, key, value) => setByHand(key, value));
  ipcMain.on('ac:refresh', () => bridge.refresh());
  ipcMain.on('ac:login', () => bridge.login());
  ipcMain.on('ac:cancel-login', () => bridge.cancelLogin());
  ipcMain.on('ac:list-devices', () => bridge.listDevices());
  ipcMain.on('ac:use-device', (_event, id) => {
    if (typeof id === 'string') bridge.useDevice(id);
  });
  ipcMain.on('ac:run', (_event, action, arg) => {
    if (isValidRun(action, arg)) bridge.run(action, arg);
  });
  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:update', (_event, patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return settings.update(patch);
    // The timer and schedules only change through their own handlers, which bind them to the active TV.
    const { timer: _timer, agendas: _agendas, ...rest } = patch;
    return settings.update(rest);
  });
  ipcMain.handle('timer:set', (_event, acao, minutos) => scheduler.setTimer(acao, minutos));
  ipcMain.handle('timer:clear', () => scheduler.clearTimer());
  ipcMain.handle('schedule:save', (_event, agenda) => scheduler.saveSchedule(agenda));
  ipcMain.handle('schedule:delete', (_event, id) => scheduler.deleteSchedule(id));
  ipcMain.on('update:open', openUpdate);
  ipcMain.on('panel:hide', hidePanel);
  ipcMain.on('tray:icon', (_event, images) => {
    const { width } = tray.getBounds();
    tray.setImage(trayImage(images));
    if (panel.isVisible() && tray.getBounds().width !== width) placePanelWhenSettled();
  });

  nativeTheme.on('updated', () => panel.webContents.send('theme', taskbarIsDark()));
  powerMonitor.on('resume', () => {
    if (!bridge.paused) bridge.refresh();
    scheduler.check();
    updates.resume();
  });
  app.on('second-instance', showPanel);
  // Opening the app again from Finder is the way in when the menu bar has no room for the icon.
  if (IS_MAC) app.on('activate', showPanel);
  app.on('before-quit', (event) => {
    if (quitting || !commandsOnTheWay()) return;
    // Quitting is put off for a moment, never longer than the grace period, so that the change still goes out.
    event.preventDefault();
    quitting = true;
    const deadline = Date.now() + QUIT_GRACE_MS;
    const wait = setInterval(() => {
      if (commandsOnTheWay() && Date.now() < deadline) return;
      clearInterval(wait);
      app.quit();
    }, QUIT_POLL_MS);
  });
  app.on('will-quit', () => {
    scheduler.stop();
    notifier.stop();
    updates.stop();
    shortcut.dispose();
    bridge.dispose();
  });

  // Opened by hand, the panel greets the user; the LaunchAgent passes --hidden so that a login stays quiet.
  if (IS_MAC && !process.argv.includes('--hidden')) {
    panel.webContents.once('did-finish-load', () => {
      showPanel();
      // The tray icon is still being drawn at this point.
      placePanelWhenSettled();
    });
  }

  bridge.refresh();
  schedulePoll();
  scheduler.start();
  notifier.start();
  updates.start(settings.get().atualizacoes);
}

if (app.requestSingleInstanceLock()) {
  app.whenReady().then(start);
} else {
  app.quit();
}
