import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { TvError, runCli } from './lib/st-cli.mjs';
import { canOverlapRuns, loginState } from './lib/st-login.mjs';
import { SETTINGS, parseStatus } from './lib/tv-status.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// The packaged app can't write inside its own signed bundle, so it names another folder for device.json.
const DEVICE_FILE = path.join(process.env.TVREMOTE_DATA_DIR ?? ROOT, 'device.json');
const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const APP_ID = /^[A-Za-z0-9._-]{1,80}$/;
const CHANNEL = /^[0-9]{1,6}$/;
const VOLUME = /^[0-9]{1,3}$/;
const TEXT_MAX = 80;
const CONFIRM_ATTEMPTS = 4;
const CONFIRM_INTERVAL_MS = 1500;
const REFRESH_SETTLE_MS = 2000;
const KEYS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'OK', 'BACK', 'EXIT', 'MENU', 'HOME', 'MUTE', 'PLAY', 'PAUSE', 'STOP', 'REWIND', 'FF', 'PLAY_BACK', 'SOURCE'];

// Power is confirmed like the other settings: the unit reports it back in `ligado`.
const POWER = {
  liga: { key: 'ligado', expected: true, command: 'switch:on' },
  desliga: { key: 'ligado', expected: false, command: 'switch:off' },
};

// One-shots are sent and never confirmed. The ones in ARGUMENT_ONE_SHOTS take their argument from the next token.
const ONE_SHOTS = {
  'vol+': 'audioVolume:volumeUp',
  'vol-': 'audioVolume:volumeDown',
  'canal+': 'tvChannel:channelUp',
  'canal-': 'tvChannel:channelDown',
  play: 'mediaPlayback:play',
  pause: 'mediaPlayback:pause',
  stop: 'mediaPlayback:stop',
  avancar: 'mediaPlayback:fastForward',
  voltar: 'mediaPlayback:rewind',
};
const ARGUMENT_ONE_SHOTS = ['canal', 'tecla', 'app'];
const KNOWN = [
  'status', 'login', 'aparelhos', 'aparelho', 'usar', 'liga', 'desliga', ...Object.keys(ONE_SHOTS), ...ARGUMENT_ONE_SHOTS,
  ...Object.keys(SETTINGS),
];

// The names a unit accepts come from the unit itself, so each one is checked against its own status.
const OFFERED = {
  entrada: (status) => (status.entradas ?? []).map(({ id }) => id),
  imagem: (status) => status.imagens ?? [],
  som: (status) => status.sons ?? [],
};

let signIn = false;

function cli(args) {
  return runCli(args, { signIn });
}

// A device id the SmartThings API does not know comes back as 403 or 404.
async function deviceCli(args) {
  try {
    return await cli(args);
  } catch (error) {
    if (error.status === 403 || error.status === 404) throw new TvError('aparelho', { detalhe: error.detalhe });
    throw error;
  }
}

function isTv({ components = [] }) {
  return components.some(({ capabilities = [] }) => capabilities.some(({ id }) => id === 'tvChannel'));
}

async function listTvs() {
  const found = JSON.parse(await cli(['devices', '-j']))
    .filter(isTv)
    .map(({ deviceId, label, name }) => ({ id: deviceId, nome: label || name || null }));
  if (found.length === 0) throw new TvError('sem-tv');
  return found;
}

function savedDevice() {
  try {
    const { id, nome } = JSON.parse(readFileSync(DEVICE_FILE, 'utf8'));
    return typeof id === 'string' && DEVICE_ID.test(id) ? { id, nome: nome ?? null } : null;
  } catch {
    return null;
  }
}

function saveDevice(device) {
  writeFileSync(DEVICE_FILE, `${JSON.stringify(device, null, 2)}\n`);
}

// The first run picks a TV that is reachable, so a unit left on the account but unplugged does not win;
// `usar <id>` points the app at another one.
async function loadDevice() {
  const saved = savedDevice();
  if (saved) return saved;
  const found = await listTvs();
  let picked = found[0];
  for (const device of found) {
    if ((await readHealth(device.id)) === true) {
      picked = device;
      break;
    }
  }
  saveDevice(picked);
  return picked;
}

function usageError(message) {
  return new TvError('desconhecido', { mensagem: message });
}

// Volume and mute are checked here; input, picture and sound names are checked against the unit (refusedByUnit).
function parseValue(token, raw) {
  if (token === 'volume') {
    const value = typeof raw === 'string' && VOLUME.test(raw) ? Number(raw) : NaN;
    if (!(value <= 100)) throw usageError('volume aceita de 0 a 100');
    return { value };
  }
  if (token === 'mudo') {
    if (raw !== 'on' && raw !== 'off') throw usageError('mudo aceita: on, off');
    return { value: raw === 'on' };
  }
  if (typeof raw !== 'string' || raw === '' || raw.length > TEXT_MAX) throw usageError(`${token} precisa de um valor`);
  return { value: raw, unverified: true };
}

function argumentCommand(token, raw) {
  if (token === 'canal') {
    if (typeof raw !== 'string' || !CHANNEL.test(raw)) throw usageError('canal precisa de um número de canal');
    return `tvChannel:setTvChannel(${JSON.stringify(raw)})`;
  }
  if (token === 'tecla') {
    if (!KEYS.includes(raw)) throw usageError(`tecla aceita: ${KEYS.join(', ')}`);
    return `samsungvd.remoteControl:send(${JSON.stringify(raw)},"PRESS_AND_RELEASED")`;
  }
  if (typeof raw !== 'string' || !APP_ID.test(raw)) throw usageError('app precisa do ID do aplicativo');
  return `custom.launchapp:launchApp(${JSON.stringify(raw)},"")`;
}

// Commands keep the order of the tokens. A value that cannot be sent is set aside and reported as unconfirmed,
// so it does not take the rest of the batch down. A batch with nothing else left to send is a plain usage error.
function parseRequest(tokens) {
  const request = { commands: [], unverified: [], rejected: [], signIn: false, list: false, use: null, device: null };
  let start = 0;
  if (tokens[0] === 'aparelho') {
    if (typeof tokens[1] !== 'string' || !DEVICE_ID.test(tokens[1])) throw usageError('aparelho precisa do ID do aparelho');
    request.device = tokens[1];
    start = 2;
  }
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === 'status') continue;
    if (token === 'login') {
      request.signIn = true;
      continue;
    }
    if (token === 'aparelhos') {
      request.list = true;
      continue;
    }
    if (token === 'aparelho') throw usageError('aparelho só vale no começo, antes das outras ações');
    if (token === 'usar') {
      i += 1;
      if (typeof tokens[i] !== 'string' || !DEVICE_ID.test(tokens[i])) throw usageError('usar precisa do ID do aparelho');
      request.use = tokens[i];
      continue;
    }
    if (Object.hasOwn(POWER, token)) {
      request.commands.push({ ...POWER[token] });
      continue;
    }
    if (Object.hasOwn(ONE_SHOTS, token)) {
      request.commands.push({ command: ONE_SHOTS[token] });
      continue;
    }
    if (ARGUMENT_ONE_SHOTS.includes(token)) {
      // Nothing confirms a one-shot, so a bad one stops the run here instead of being dropped without a word.
      i += 1;
      request.commands.push({ command: argumentCommand(token, tokens[i]) });
      continue;
    }
    if (!Object.hasOwn(SETTINGS, token)) throw usageError(`Ação desconhecida: ${token}. Use: ${KNOWN.join(', ')}`);
    i += 1;
    let parsed;
    try {
      parsed = parseValue(token, tokens[i]);
    } catch (error) {
      request.rejected.push({ key: token, error });
      continue;
    }
    if (parsed.unverified) request.unverified.push({ key: token, value: parsed.value });
    request.commands.push({ key: token, expected: parsed.value, command: SETTINGS[token].command(parsed.value) });
  }
  if (request.commands.length === 0 && request.rejected.length > 0) throw request.rejected[0].error;
  if (request.list && (request.commands.length > 0 || request.use)) {
    throw usageError('aparelhos não combina com outras ações');
  }
  if (request.device && (request.use || request.list)) throw usageError('aparelho não combina com usar nem com aparelhos');
  return request;
}

async function readHealth(deviceId) {
  try {
    const { state } = JSON.parse(await cli(['devices:health', deviceId, '-j']));
    return state === 'ONLINE' ? true : state === 'OFFLINE' ? false : null;
  } catch {
    // Health only adds to the status; a failure here must not hide the status itself.
    return null;
  }
}

// A Samsung TV only publishes what changed once it is asked to; without this the status is whatever it last volunteered.
async function refreshDevice(deviceId) {
  try {
    await cli(['devices:commands', deviceId, 'refresh:refresh']);
    await sleep(REFRESH_SETTLE_MS);
  } catch {
    // A TV that cannot be reached refuses the refresh; the status read that follows still says what it last knew.
  }
}

// The health check runs alongside the status read when that is safe, so it adds no wait.
async function readDevice(device, { health }) {
  await refreshDevice(device.id);
  const alongside = health && canOverlapRuns() ? readHealth(device.id) : null;
  let raw;
  try {
    raw = await deviceCli(['devices:status', device.id, '-j']);
  } finally {
    await alongside;
  }
  const online = health ? await (alongside ?? readHealth(device.id)) : null;
  const main = JSON.parse(raw).components?.main;
  if (!main) throw new TvError('desconhecido');
  return { main, online };
}

// Returns the names this unit does not offer, each with the error that says what it does offer.
function refusedByUnit(unverified, status) {
  const refused = [];
  for (const { key, value } of unverified) {
    const offered = OFFERED[key](status);
    if (offered.includes(value)) continue;
    const message = offered.length > 0 ? `${key} aceita: ${offered.join(', ')}` : `${key} não é suportado por este aparelho`;
    refused.push({ key, value, error: usageError(message) });
  }
  return refused;
}

function pendingKeys(commands, status) {
  return commands.filter(({ key, expected }) => status[key] !== expected).map(({ key }) => key);
}

// A unit that is offline refuses commands; the status read afterwards then shows what it did not take.
// A command the unit itself answers with 400 or 422 is one it does not accept: it is set aside and the rest still goes.
async function sendCommands(device, commands) {
  const refused = [];
  for (const command of commands) {
    try {
      await deviceCli(['devices:commands', device.id, command.command]);
    } catch (error) {
      // A TV that turns one command down (an app it lacks, a key it ignores) is still on the account.
      if (error.erro === 'aparelho' || (error.erro === 'desconhecido' && (error.status === 400 || error.status === 422))) {
        refused.push(command);
        continue;
      }
      if (error.erro !== 'desconhecido' || (await readHealth(device.id)) !== false) throw error;
      break;
    }
  }
  return refused;
}

async function execute(request) {
  if (request.list) {
    const found = await listTvs();
    const active = savedDevice()?.id ?? found[0].id;
    console.log(JSON.stringify({ aparelhos: found.map((device) => ({ ...device, ativo: device.id === active })) }));
    return;
  }

  let device;
  let switchingTo = null;
  if (request.use) {
    device = (await listTvs()).find(({ id }) => id === request.use);
    if (!device) throw new TvError('aparelho', { mensagem: 'Essa TV não está na sua conta SmartThings.' });
    switchingTo = device;
  } else if (request.device) {
    // Only for this run: the saved unit stays as it is, and its name is only known when it happens to be that one.
    const saved = savedDevice();
    device = { id: request.device, nome: saved?.id === request.device ? saved.nome : null };
  } else {
    device = await loadDevice();
  }

  let commands = request.commands;
  const rejected = [...request.rejected];
  if (request.unverified.length > 0) {
    const status = parseStatus((await readDevice(device, { health: false })).main, device, null);
    const refused = refusedByUnit(request.unverified, status);
    commands = commands.filter(({ key, expected }) => !refused.some((one) => one.key === key && one.value === expected));
    rejected.push(...refused);
    if (commands.length === 0 && refused.length > 0) throw refused[0].error;
  }
  const refusedCommands = await sendCommands(device, commands);
  commands = commands.filter((command) => !refusedCommands.includes(command));
  // Presses are never confirmed, so reading the TV back after each one would only make the next press wait.
  if (request.commands.length > 0 && request.commands.every(({ key }) => key === undefined) && !switchingTo) {
    console.log(JSON.stringify({ enviado: commands.length }));
    return;
  }

  const { main, online } = await readDevice(device, { health: true });
  const settings = commands.filter(({ key }) => key !== undefined);
  let status = parseStatus(main, device, online);
  // Retrying is pointless while the unit is offline: it keeps reporting what it last knew.
  for (let attempt = 1; attempt < CONFIRM_ATTEMPTS && pendingKeys(settings, status).length > 0 && online !== false; attempt++) {
    await sleep(CONFIRM_INTERVAL_MS);
    status = parseStatus((await readDevice(device, { health: false })).main, device, online);
  }

  // The new unit becomes the saved one only once its status has been read, so a failed switch leaves everything as it was.
  if (switchingTo) saveDevice(switchingTo);
  const pendente = [
    ...new Set([
      ...pendingKeys(settings, status),
      ...refusedCommands.filter(({ key }) => key !== undefined).map(({ key }) => key),
      ...rejected.map(({ key }) => key),
    ]),
  ];
  console.log(JSON.stringify(pendente.length > 0 ? { ...status, pendente } : status));
}

async function run() {
  const request = parseRequest(process.argv.slice(2));
  signIn = request.signIn;
  if (!signIn && loginState().saved === false) throw new TvError('login');
  try {
    await execute(request);
  } catch (error) {
    // Asking for a sign-in must get one. The saved login is only dropped once the API is known to reject it,
    // because it may well be valid and the CLI signs in again by itself when it is not.
    if (!signIn || error.status !== 401) throw error;
    await cli(['logout']).catch(() => {});
    await execute(request);
  }
}

try {
  await run();
} catch (error) {
  const failure = error instanceof TvError ? error : new TvError('desconhecido', { mensagem: error.message });
  if (failure.detalhe) console.error(failure.detalhe);
  console.error(JSON.stringify({ erro: failure.erro, mensagem: failure.message }));
  process.exit(1);
}
