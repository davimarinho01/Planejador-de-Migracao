// Processo principal com um Electron simulado: chave da Groq, chamadas, voz, Google Drive, atualização e avisos.
// Rode com: node --test tests/main.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const RAIZ = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'planejador-main-'));
const UD = path.join(tmp, 'userData'), DRIVE = path.join(tmp, 'drive'), INST = path.join(tmp, 'instalado', 'app');
fs.mkdirSync(UD, { recursive: true }); fs.mkdirSync(DRIVE, { recursive: true });
fs.cpSync(path.join(RAIZ, 'app'), INST, { recursive: true });

const h = {}, ev = [], fetches = [];
const respostaGroq = (url) => (url.endsWith('/models') ? { data: [{ id: 'openai/gpt-oss-120b', active: true }, { id: 'velho', active: false }] }
  : url.endsWith('/audio/transcriptions') ? { text: 'olá Vasco' } : { choices: [{ message: { content: 'oi' } }] });
const electron = {
  app: { getPath: () => UD, getAppPath: () => INST, getVersion: () => JSON.parse(fs.readFileSync(path.join(INST, 'package.json'))).version,
    requestSingleInstanceLock: () => true, quit() {}, on() {}, whenReady: () => ({ then() {} }), setAppUserModelId() {},
    setLoginItemSettings: (o) => ev.push(['login', o]), relaunch: () => ev.push(['relaunch']), exit: () => ev.push(['exit']) },
  BrowserWindow: { fromWebContents: () => null }, shell: {}, Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({}) },
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [DRIVE] }) },
  ipcMain: { handle: (k, f) => { h[k] = f; } },
  net: { fetch: async (url, o) => { fetches.push({ url, ...o }); return { ok: true, status: 200, headers: { get: (k) => (k === 'x-ratelimit-remaining-tokens' ? '7000' : null) }, text: async () => JSON.stringify(respostaGroq(url)) }; } },
  // "criptografia" reversível só para o teste
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from([...s].reverse().join('')), decryptString: (b) => [...b.toString()].reverse().join('') },
  Tray: function () { Object.assign(this, { setToolTip() {}, setContextMenu() {}, on() {}, destroy() {}, displayBalloon: (o) => ev.push(['balao', o.title]) }); },
  Notification: Object.assign(function (o) { this.on = () => {}; this.show = () => ev.push(['notificacao', o.title]); }, { isSupported: () => true }),
  nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
};
const resolverOriginal = Module._resolveFilename;
Module._resolveFilename = function (pedido, ...resto) { return pedido === 'electron' ? 'electron-simulado' : resolverOriginal.call(this, pedido, ...resto); };
require.cache['electron-simulado'] = { id: 'electron-simulado', filename: 'electron-simulado', loaded: true, exports: electron };
require(path.join(RAIZ, 'app', 'main.js'));

test('chave da Groq: valida e guarda criptografada', async () => {
  assert.equal((await h['ia:status']()).temChave, false);
  assert.equal((await h['ia:setKey']({}, 'nao-e-chave')).ok, false);
  assert.equal((await h['ia:setKey']({}, 'gsk_ABCDEFGHIJKLMNOPQRSTUVWX123')).ok, true);
  const arq = fs.readFileSync(path.join(UD, 'ia.key')).toString();
  assert.ok(arq.startsWith('enc:') && !arq.includes('gsk_ABCDEFGHIJ'));
  assert.deepEqual(await h['ia:models'](), { ok: true, ids: ['openai/gpt-oss-120b'] });
});

test('chamada à Groq leva só o necessário e devolve os limites', async () => {
  const r = await h['ia:chat']({}, { model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'oi' }], tools: [{ type: 'browser_search' }], tool_choice: 'required', reasoning_effort: 'low', max_completion_tokens: 99999 });
  assert.equal(r.ok, true);
  assert.equal(r.limites['remaining-tokens'], '7000');
  const f = fetches.at(-1), corpo = JSON.parse(f.body);
  assert.equal(f.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.ok(f.headers.Authorization.startsWith('Bearer gsk_'));
  assert.equal(corpo.max_completion_tokens, 4096);
  assert.equal(corpo.reasoning_effort, 'low');
});

test('voz: multipart para o Whisper e rejeita tipo estranho', async () => {
  const audio = new Uint8Array([1, 2, 3, 4]).buffer;
  assert.deepEqual(await h['ia:transcrever']({}, audio, 'audio/webm', 'whisper-large-v3'), { ok: true, texto: 'olá Vasco' });
  const corpo = fetches.at(-1).body.toString('latin1');
  assert.match(corpo, /name="model"\r\n\r\nwhisper-large-v3/);
  assert.match(corpo, /name="language"\r\n\r\npt/);
  await h['ia:transcrever']({}, audio, 'x; rm -rf', 'modelo ruim');
  const c2 = fetches.at(-1).body.toString('latin1');
  assert.match(c2, /Content-Type: audio\/webm/);
  assert.match(c2, /whisper-large-v3/);
});

test('Google Drive: grava, lê e resolve a cópia em conflito', async () => {
  assert.equal((await h['sync:escolher']({ sender: {} })).ok, true);
  const pasta = path.join(DRIVE, 'Planejador Viseu');
  assert.equal((await h['sync:ler']()).vazio, true);
  assert.equal((await h['sync:gravar']({}, JSON.stringify({ app: 'planejador-viseu', dados: { a: 1 } }))).ok, true);
  fs.writeFileSync(path.join(pasta, 'plano (1).json'), '{"app":"planejador-viseu","dados":{"a":2}}');
  const r = await h['sync:ler']();
  assert.deepEqual(r.conflitos.map((c) => c.nome), ['plano (1).json']);
  assert.equal((await h['sync:conflitoResolvido']({}, 'plano (1).json')).ok, true);
  assert.ok(fs.existsSync(path.join(pasta, 'plano (1).mesclado.json')));
  assert.equal((await h['sync:conflitoResolvido']({}, '../../fora.json')).ok, false);
  assert.equal((await h['sync:gravar']({}, 'não é json')).ok, false);
});

test('atualização: publica, detecta versão nova, aplica com reserva e recusa outro app', async () => {
  const atual = electron.app.getVersion();
  assert.equal(h['update:verificar']().podePublicar, true);
  assert.equal(h['update:publicar']({}, 'notas').ok, true);
  assert.equal(h['update:verificar']().disponivel, false);
  const pub = path.join(DRIVE, 'Planejador Viseu', 'atualizacao', 'app', 'package.json');
  const pk = JSON.parse(fs.readFileSync(pub));
  fs.writeFileSync(pub, JSON.stringify({ ...pk, version: '99.0.0' }));
  assert.equal(h['update:verificar']().disponivel, true);
  assert.equal(h['update:aplicar']().ok, true);
  assert.equal(electron.app.getVersion(), '99.0.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(`${INST}-anterior`, 'package.json'))).version, atual);
  fs.writeFileSync(pub, JSON.stringify({ ...pk, name: 'outro-app', version: '100.0.0' }));
  assert.equal(h['update:verificar']().disponivel, false);
  assert.equal(h['update:aplicar']().ok, false);
});

test('segundo plano e avisos', async () => {
  const r = await h['bg:config']({}, { segundoPlano: true, iniciarComWindows: true });
  assert.equal(r.segundoPlano, true);
  assert.deepEqual(ev.find((e) => e[0] === 'login')[1], { openAtLogin: true, args: ['--oculto'] });
  assert.equal((await h['bg:notificar']({}, { titulo: 'Euro a R$ 6,10', corpo: 'abaixo do alvo' })).ok, true);
  assert.ok(ev.some((e) => e[0] === 'notificacao' && e[1] === 'Euro a R$ 6,10'));
});

test('endereços das APIs: só os permitidos', () => {
  const URLS = require(path.join(RAIZ, 'app', 'urls.js'));
  assert.match(URLS.build('ine_rendas', { varcd: '0009631' }), /^https:\/\/www\.ine\.pt\//);
  assert.throws(() => URLS.build('ine_rendas', { varcd: '1;drop' }));
  assert.throws(() => URLS.build('tp_dates', { origin: 'GIG', destination: 'OPO', date: '2028-04-05' }), /chave/);
  assert.throws(() => URLS.build('qualquer_coisa', {}));
});
