const TRAY_ICON_SIZES = [
  { size: 16, scaleFactor: 1 },
  { size: 20, scaleFactor: 1.25 },
  { size: 24, scaleFactor: 1.5 },
  { size: 32, scaleFactor: 2 },
];
const MENU_BAR_ICON = { height: 18, scaleFactors: [1, 2], glyphWidth: 22, gap: 3 };
const MENU_BAR_FONT = '600 13px system-ui';

let trayIconKey = '';

const measureContext = document.createElement('canvas').getContext('2d');

function textWidth(font, text) {
  measureContext.font = font;
  return Math.ceil(measureContext.measureText(text).width);
}

// A line with a gap cut out along it first, so the slash reads on the drawing and on the background alike.
function slash(context, x1, y1, x2, y2, width) {
  context.save();
  context.globalCompositeOperation = 'destination-out';
  context.lineWidth = width + 2;
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  context.restore();
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

/* Windows tray icon: the volume where the temperature used to be, a bar in the accent colour while the TV is on. */

function drawTrayIcon(size, device, tint) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const ink = darkTaskbar ? '#f3f5f7' : '#14181c';
  const text = formatVolume(device?.volume);
  context.fillStyle = ink;
  context.strokeStyle = ink;
  context.globalAlpha = device?.ligado ? 1 : 0.5;
  let fontSize = Math.round(size * 0.8);
  context.font = `600 condensed ${fontSize}px Bahnschrift`;
  while (fontSize > 6 && context.measureText(text).width > size - 1) {
    fontSize -= 1;
    context.font = `600 condensed ${fontSize}px Bahnschrift`;
  }
  context.textAlign = 'center';
  context.fillText(text, size / 2, Math.round(size * 0.76));
  if (device?.mudo) slash(context, size * 0.2, size * 0.2, size * 0.8, size * 0.8, Math.max(1, size / 12));
  if (device?.ligado) {
    const bar = Math.max(2, Math.round(size / 10));
    context.globalAlpha = 1;
    context.fillStyle = darkTaskbar ? tint : ink;
    context.fillRect(Math.round(size * 0.18), size - bar, Math.round(size * 0.64), bar);
  }
  return canvas.toDataURL('image/png');
}

/* macOS menu bar icon: a template image, so only the alpha channel matters and the system picks the colour. */

// The TV: a rounded screen with a stand. Solid while it is on, hollow while it is off or unknown.
function drawTvGlyph(context, solid) {
  context.beginPath();
  context.roundRect(1, 3, 20, 11, 2.2);
  if (solid) {
    context.fill();
  } else {
    context.lineWidth = 1.5;
    context.stroke();
  }
  context.lineWidth = 1.5;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(6, 16.6);
  context.lineTo(16, 16.6);
  context.stroke();
}

// Inside the hollow screen of a TV that is off: the power sign, so "off" reads differently from "unknown".
function drawPowerSign(context, centerX, centerY) {
  context.lineWidth = 1.4;
  context.lineCap = 'round';
  context.beginPath();
  context.arc(centerX, centerY, 3, -Math.PI / 2 + 0.6, (3 * Math.PI) / 2 - 0.6);
  context.stroke();
  context.beginPath();
  context.moveTo(centerX, centerY - 4);
  context.lineTo(centerX, centerY - 1.4);
  context.stroke();
}

// What the icon writes next to the glyph: nothing while the TV is off, "--" while it is unknown, else the volume.
function menuBarText(device, showVolume) {
  if (!device) return '--';
  if (!device.ligado || !showVolume) return null;
  return formatVolume(device.volume);
}

function drawMenuBarIcon(scaleFactor, device, showVolume) {
  const text = menuBarText(device, showVolume);
  const textX = MENU_BAR_ICON.glyphWidth + MENU_BAR_ICON.gap;
  const width = text == null ? MENU_BAR_ICON.glyphWidth : textX + textWidth(MENU_BAR_FONT, text);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scaleFactor);
  canvas.height = MENU_BAR_ICON.height * scaleFactor;
  const context = canvas.getContext('2d');
  context.scale(scaleFactor, scaleFactor);
  context.fillStyle = '#000000';
  context.strokeStyle = '#000000';
  drawTvGlyph(context, Boolean(device?.ligado));
  if (device && !device.ligado) drawPowerSign(context, 11, 8.6);
  if (device?.mudo) slash(context, 2.5, 3.5, 19.5, 13.5, 1.6);
  if (text != null) {
    context.font = MENU_BAR_FONT;
    context.textAlign = 'left';
    context.fillText(text, textX, 13.5);
  }
  return canvas.toDataURL('image/png');
}

function renderTrayIcon() {
  // Signed out, the last reading is stale, so the menu bar shows "--" instead of it.
  const device = (IS_MAC && loggedOut() ? null : view?.device) ?? null;
  // Only the menu bar can hide the volume; the Windows tray icon always shows it.
  const showVolume = !IS_MAC || settings.icone.volume;
  const key = [device?.volume, device?.mudo, device?.ligado, Boolean(device), showVolume, darkTaskbar].join('|');
  if (key === trayIconKey) return;
  trayIconKey = key;
  if (IS_MAC) {
    window.ac.setTrayIcon(
      MENU_BAR_ICON.scaleFactors.map((scaleFactor) => ({
        scaleFactor,
        dataURL: drawMenuBarIcon(scaleFactor, device, showVolume),
      })),
    );
    return;
  }
  const tint = getComputedStyle(panel).getPropertyValue('--tint').trim();
  window.ac.setTrayIcon(
    TRAY_ICON_SIZES.map(({ size, scaleFactor }) => ({ scaleFactor, dataURL: drawTrayIcon(size, device, tint) })),
  );
}
