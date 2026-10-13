// The settings tokens that take a value, and the SmartThings command each one sends.
// The unit reports every value back in parseStatus, where the caller checks it.
export const SETTINGS = {
  volume: { command: (value) => `audioVolume:setVolume(${value})` },
  mudo: { command: (on) => `audioMute:setMute(${JSON.stringify(on ? 'muted' : 'unmuted')})` },
  entrada: { command: (id) => `samsungvd.mediaInputSource:setInputSource(${JSON.stringify(id)})` },
  imagem: { command: (name) => `custom.picturemode:setPictureMode(${JSON.stringify(name)})` },
  som: { command: (name) => `custom.soundmode:setSoundMode(${JSON.stringify(name)})` },
};

function reported(main, capability, attribute) {
  const value = main[capability]?.[attribute]?.value;
  return Number.isNaN(value) ? null : (value ?? null);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// An empty text is not a value: the channel and the app stay empty when nothing is tuned or running.
function text(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

function names(list) {
  return Array.isArray(list) ? list.filter((item) => typeof item === 'string' && item !== '') : null;
}

function inputs(list) {
  if (!Array.isArray(list)) return null;
  return list
    .filter((item) => typeof item?.id === 'string')
    .map(({ id, name }) => ({ id, nome: typeof name === 'string' ? name : id }));
}

// Every field a unit does not report is null, so the panel can tell "unknown" apart from off or zero.
export function parseStatus(main, device, online) {
  const switchState = reported(main, 'switch', 'switch');
  const mute = reported(main, 'audioMute', 'mute');
  const power = main.powerConsumptionReport?.powerConsumption?.value;
  return {
    id: device.id,
    nome: device.nome ?? null,
    online,
    ligado: switchState === null ? null : switchState === 'on',
    volume: finite(reported(main, 'audioVolume', 'volume')),
    mudo: mute === null ? null : mute === 'muted',
    entrada: text(reported(main, 'samsungvd.mediaInputSource', 'inputSource')),
    entradas: inputs(reported(main, 'samsungvd.mediaInputSource', 'supportedInputSourcesMap')),
    app: text(reported(main, 'tvChannel', 'tvChannelName')),
    canal: text(reported(main, 'tvChannel', 'tvChannel')),
    imagem: text(reported(main, 'custom.picturemode', 'pictureMode')),
    imagens: names(reported(main, 'custom.picturemode', 'supportedPictureModes')),
    som: text(reported(main, 'custom.soundmode', 'soundMode')),
    sons: names(reported(main, 'custom.soundmode', 'supportedSoundModes')),
    reproducao: text(reported(main, 'mediaPlayback', 'playbackStatus')),
    potencia: finite(power?.power),
  };
}
