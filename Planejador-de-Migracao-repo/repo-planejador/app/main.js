const { app, BrowserWindow, shell, Menu, ipcMain, net, dialog, safeStorage, Tray, Notification, nativeImage } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const URLS = require('./urls.js');

// Busca de dados de mercado: só endereços montados por urls.js, com tempo-limite.
ipcMain.handle('net:get', async (_event, key, params) => {
  let req;
  try {
    req = URLS.build(key, params);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (typeof req === 'string') req = { url: req };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await net.fetch(req.url, {
      method: req.method || 'GET',
      body: req.body,
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': `PlanejadorViseu/${app.getVersion()}`, ...(req.headers || {}) },
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'tempo esgotado' : e.message };
  } finally {
    clearTimeout(timer);
  }
});

// Relatório: imprime a página (com o CSS de impressão) num PDF e pergunta onde salvar.
ipcMain.handle('pdf:save', async (event, nome) => {
  try {
    const dados = await event.sender.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
    const sugestao = String(nome || 'planejamento.pdf').replace(/[^\w.\-]/g, '_');
    const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Salvar relatório',
      defaultPath: path.join(app.getPath('documents'), sugestao),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { ok: false };
    fs.writeFileSync(filePath, dados);
    shell.openPath(filePath);
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Backup automático: a pasta é escolhida pela pessoa e guardada aqui, nunca vem da página.
const bkCfgPath = () => path.join(app.getPath('userData'), 'backup.json');
function bkCfg() { try { return JSON.parse(fs.readFileSync(bkCfgPath(), 'utf8')); } catch (e) { return {}; } }
function bkSave(c) { fs.writeFileSync(bkCfgPath(), JSON.stringify(c)); }
ipcMain.handle('backup:info', () => { const c = bkCfg(); return { dir: c.dir && fs.existsSync(c.dir) ? c.dir : '', ultimo: c.ultimo || 0 }; });
ipcMain.handle('backup:choose', async (event) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Pasta do backup', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { dir: bkCfg().dir || '' };
  const c = bkCfg(); c.dir = r.filePaths[0]; bkSave(c);
  return { dir: c.dir };
});
ipcMain.handle('backup:write', (_event, json) => {
  try {
    const c = bkCfg();
    if (!c.dir || !fs.existsSync(c.dir)) return { ok: false, error: 'escolha uma pasta' };
    if (typeof json !== 'string' || json.length > 20 * 1024 * 1024) return { ok: false, error: 'dados inválidos' };
    JSON.parse(json);
    fs.writeFileSync(path.join(c.dir, 'planejador-viseu-backup.json'), json);
    const dia = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(c.dir, `planejador-viseu-${dia}.json`), json);
    const antigos = fs.readdirSync(c.dir).filter((f) => /^planejador-viseu-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    antigos.slice(0, Math.max(0, antigos.length - 30)).forEach((f) => { try { fs.unlinkSync(path.join(c.dir, f)); } catch (e) { /* ok */ } });
    c.ultimo = Date.now(); bkSave(c);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Assistente (Groq). A chave nunca vai para a página: fica criptografada pelo Windows
// (safeStorage/DPAPI) em userData/ia.key, e só este processo a usa.
const GROQ = 'https://api.groq.com/openai/v1';
const iaPath = () => path.join(app.getPath('userData'), 'ia.key');
function iaKey() {
  try {
    const raw = fs.readFileSync(iaPath());
    if (raw.slice(0, 4).toString() === 'enc:') return safeStorage.decryptString(raw.slice(4));
    if (raw.slice(0, 4).toString() === 'raw:') return raw.slice(4).toString();
  } catch (e) { /* sem chave */ }
  return '';
}
ipcMain.handle('ia:setKey', (_event, key) => {
  key = String(key || '').trim();
  if (!/^gsk_[A-Za-z0-9]{20,200}$/.test(key)) return { ok: false, error: 'Essa não parece uma chave da Groq (começa com gsk_).' };
  try {
    const cripto = safeStorage.isEncryptionAvailable();
    const dados = cripto ? Buffer.concat([Buffer.from('enc:'), safeStorage.encryptString(key)]) : Buffer.from('raw:' + key);
    fs.writeFileSync(iaPath(), dados, { mode: 0o600 });
    return { ok: true, criptografada: cripto };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('ia:status', () => {
  let criptografada = null;
  try { criptografada = fs.readFileSync(iaPath()).slice(0, 4).toString() === 'enc:'; } catch (e) { /* sem arquivo */ }
  return { temChave: !!iaKey(), criptografada };
});
ipcMain.handle('ia:clear', () => { try { fs.unlinkSync(iaPath()); } catch (e) { /* já não existe */ } return { ok: true }; });

async function groq(rota, corpo, ms, bruto) {
  const key = iaKey();
  if (!key) return { ok: false, status: 401, error: 'Cole a chave da Groq para usar o assistente.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await net.fetch(GROQ + rota, {
      method: corpo || bruto ? 'POST' : 'GET',
      body: bruto ? bruto.body : corpo ? JSON.stringify(corpo) : undefined,
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': bruto ? bruto.type : 'application/json', Accept: 'application/json' },
    });
    const txt = await res.text();
    let data = null;
    try { data = JSON.parse(txt); } catch (e) { /* não é JSON */ }
    // limites da conta, para a página esperar ou trocar de modelo antes de estourar
    const limites = {};
    for (const h of ['limit-tokens', 'remaining-tokens', 'reset-tokens', 'limit-requests', 'remaining-requests', 'reset-requests']) {
      const v = res.headers.get(`x-ratelimit-${h}`);
      if (v != null) limites[h] = v;
    }
    const ra = res.headers.get('retry-after');
    if (ra != null) limites['retry-after'] = ra;
    if (!res.ok) return { ok: false, status: res.status, error: (data && data.error && data.error.message) || `HTTP ${res.status}`, codigo: data && data.error && data.error.code, limites };
    return { ok: true, data, limites };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'tempo esgotado' : e.message };
  } finally {
    clearTimeout(timer);
  }
}
ipcMain.handle('ia:models', async () => {
  const r = await groq('/models', null, 20000);
  if (!r.ok) return r;
  return { ok: true, ids: (r.data.data || []).filter((m) => m.active !== false).map((m) => m.id) };
});
ipcMain.handle('ia:chat', async (_event, req) => {
  req = req || {};
  const corpo = {
    model: String(req.model || 'openai/gpt-oss-120b').slice(0, 100),
    messages: Array.isArray(req.messages) ? req.messages.slice(-60) : [],
    temperature: 0.3,
    max_completion_tokens: Math.min(4096, Math.max(256, parseInt(req.max_completion_tokens, 10) || 1500)),
  };
  if (Array.isArray(req.tools) && req.tools.length) { corpo.tools = req.tools; corpo.tool_choice = req.tool_choice || 'auto'; }
  if (/gpt-oss/i.test(corpo.model) && ['low', 'medium', 'high'].includes(req.reasoning_effort)) corpo.reasoning_effort = req.reasoning_effort;
  if (req.response_format && req.response_format.type === 'json_object') corpo.response_format = { type: 'json_object' };
  // imagens em base64 entram no corpo; o limite da Groq para pedidos com imagem é 20 MB
  if (JSON.stringify(corpo).length > 18 * 1024 * 1024) return { ok: false, error: 'conversa ou imagem grande demais; limpe o histórico' };
  return groq('/chat/completions', corpo, 120000);
});

// Voz: o áudio gravado vai para o Whisper da Groq (multipart montado aqui)
ipcMain.handle('ia:transcrever', async (_event, audio, mime, modelo) => {
  try {
    const buf = Buffer.from(audio instanceof ArrayBuffer ? new Uint8Array(audio) : audio);
    if (!buf.length || buf.length > 25 * 1024 * 1024) return { ok: false, error: 'áudio vazio ou maior que 25 MB' };
    const m = /^whisper[\w.-]{0,40}$/.test(String(modelo || '')) ? modelo : 'whisper-large-v3';
    const b = '----PlanejadorViseu' + Date.now().toString(16);
    const campo = (nome, valor) => Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${nome}"\r\n\r\n${valor}\r\n`);
    const tipo = /^audio\/[\w.+-]+$/.test(String(mime || '')) ? mime : 'audio/webm';
    const corpo = Buffer.concat([
      campo('model', m), campo('language', 'pt'), campo('response_format', 'json'), campo('temperature', '0'),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="voz.webm"\r\nContent-Type: ${tipo}\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    const r = await groq('/audio/transcriptions', null, 90000, { body: corpo, type: `multipart/form-data; boundary=${b}` });
    if (!r.ok) return r;
    return { ok: true, texto: (r.data && r.data.text) || '' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* =========================================================
   Google Drive: sincronização, atualização e resumo para o celular.
   A pasta é escolhida pela pessoa (a pasta do Google Drive para
   computador) e guardada em userData/sync.json, nunca vem da página.
   ========================================================= */
const syncCfgPath = () => path.join(app.getPath('userData'), 'sync.json');
const syncCfg = () => { try { return JSON.parse(fs.readFileSync(syncCfgPath(), 'utf8')); } catch (e) { return {}; } };
const syncSalvarCfg = (c) => fs.writeFileSync(syncCfgPath(), JSON.stringify(c));
const PASTA_APP = 'Planejador Viseu';
function pastaSync() {
  const c = syncCfg();
  if (!c.dir || !fs.existsSync(c.dir)) return '';
  const p = path.basename(c.dir) === PASTA_APP ? c.dir : path.join(c.dir, PASTA_APP);
  try { fs.mkdirSync(p, { recursive: true }); } catch (e) { return ''; }
  return p;
}
function sugestoesDrive() {
  const achados = [];
  const tentar = (p) => { try { if (p && fs.existsSync(p) && fs.statSync(p).isDirectory() && !achados.includes(p)) achados.push(p); } catch (e) { /* sem acesso */ } };
  if (process.platform === 'win32') {
    for (const l of 'GHIJKLMNOPDEFQRSTUVWXYZ') for (const n of ['Meu Drive', 'My Drive', 'O meu disco', 'Mi unidad']) tentar(`${l}:\\${n}`);
  }
  const home = os.homedir();
  for (const n of ['Google Drive', 'Meu Drive', 'My Drive', 'GoogleDrive']) { tentar(path.join(home, n)); tentar(path.join(home, n, 'Meu Drive')); tentar(path.join(home, n, 'My Drive')); }
  try { for (const n of fs.readdirSync(path.join(home, 'Library', 'CloudStorage'))) if (/^GoogleDrive/i.test(n)) { tentar(path.join(home, 'Library', 'CloudStorage', n, 'Meu Drive')); tentar(path.join(home, 'Library', 'CloudStorage', n, 'My Drive')); } } catch (e) { /* não é Mac */ }
  return achados;
}
ipcMain.handle('sync:info', () => {
  const p = pastaSync();
  return { dir: syncCfg().dir || '', pasta: p, sugestoes: p ? [] : sugestoesDrive(), usuario: os.userInfo().username, computador: os.hostname() };
});
ipcMain.handle('sync:escolher', async (event) => {
  const sug = sugestoesDrive()[0];
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Escolha a pasta do Google Drive (ou uma pasta compartilhada dentro dele)', defaultPath: sug || os.homedir(), properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  syncSalvarCfg({ ...syncCfg(), dir: r.filePaths[0] });
  return { ok: true, pasta: pastaSync() };
});
ipcMain.handle('sync:usarSugestao', (_e, dir) => {
  if (!sugestoesDrive().includes(dir)) return { ok: false, error: 'pasta não reconhecida' };
  syncSalvarCfg({ ...syncCfg(), dir });
  return { ok: true, pasta: pastaSync() };
});
ipcMain.handle('sync:desligar', () => { const c = syncCfg(); delete c.dir; syncSalvarCfg(c); return { ok: true }; });
ipcMain.handle('sync:ler', () => {
  const p = pastaSync();
  if (!p) return { ok: false, error: 'sem pasta' };
  const arq = path.join(p, 'plano.json');
  const out = { ok: true, conflitos: [] };
  try {
    // cópias em conflito que o Google Drive cria, como "plano (1).json"
    for (const n of fs.readdirSync(p)) if (/^plano \(\d+\)\.json$/i.test(n)) { try { out.conflitos.push({ nome: n, conteudo: fs.readFileSync(path.join(p, n), 'utf8') }); } catch (e) { /* ilegível */ } }
    if (!fs.existsSync(arq)) return { ...out, vazio: true };
    out.conteudo = fs.readFileSync(arq, 'utf8');
    out.mtime = fs.statSync(arq).mtimeMs;
  } catch (e) { return { ok: false, error: e.message }; }
  return out;
});
ipcMain.handle('sync:mtime', () => { const p = pastaSync(); try { return p ? fs.statSync(path.join(p, 'plano.json')).mtimeMs : 0; } catch (e) { return 0; } });
ipcMain.handle('sync:gravar', (_e, json) => {
  const p = pastaSync();
  if (!p) return { ok: false, error: 'sem pasta' };
  try {
    if (typeof json !== 'string' || json.length > 20 * 1024 * 1024) return { ok: false, error: 'dados inválidos' };
    JSON.parse(json);
    const tmp = path.join(p, '.plano.json.tmp');
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, path.join(p, 'plano.json'));
    return { ok: true, mtime: fs.statSync(path.join(p, 'plano.json')).mtimeMs };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('sync:conflitoResolvido', (_e, nome) => {
  const p = pastaSync();
  if (!p || !/^plano \(\d+\)\.json$/i.test(String(nome))) return { ok: false };
  try { fs.renameSync(path.join(p, nome), path.join(p, String(nome).replace(/\.json$/i, '.mesclado.json'))); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});
// resumo em PDF para abrir no celular pelo app do Google Drive
ipcMain.handle('sync:pdf', async (event) => {
  const p = pastaSync();
  if (!p) return { ok: false, error: 'sem pasta' };
  try {
    const dados = await event.sender.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
    fs.writeFileSync(path.join(p, 'Resumo para o celular.pdf'), dados);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// atualização: a nova versão fica em "<pasta>/atualizacao/app"; quem atualizar primeiro publica para os outros
const verMaior = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; };
function pacoteValido(dir) {
  try {
    const pk = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const meu = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
    if (pk.name !== meu.name) return null;
    for (const f of ['main.js', 'preload.js', 'index.html', 'app.js']) if (!fs.existsSync(path.join(dir, f))) return null;
    return pk;
  } catch (e) { return null; }
}
ipcMain.handle('update:verificar', () => {
  const p = pastaSync();
  const atual = app.getVersion();
  if (!p) return { ok: true, atual, disponivel: false, motivo: 'sem pasta' };
  const dir = path.join(p, 'atualizacao', 'app');
  const pk = fs.existsSync(dir) ? pacoteValido(dir) : null;
  let notas = '', por = '';
  try { const v = JSON.parse(fs.readFileSync(path.join(p, 'atualizacao', 'versao.json'), 'utf8')); notas = String(v.notas || ''); por = String(v.por || ''); } catch (e) { /* sem notas */ }
  return { ok: true, atual, publicada: pk ? pk.version : null, disponivel: !!(pk && verMaior(pk.version, atual)), podePublicar: !pk || verMaior(atual, pk.version), notas, por };
});
ipcMain.handle('update:aplicar', () => {
  const p = pastaSync();
  const dir = p && path.join(p, 'atualizacao', 'app');
  const pk = dir && fs.existsSync(dir) && pacoteValido(dir);
  if (!pk || !verMaior(pk.version, app.getVersion())) return { ok: false, error: 'nenhuma versão nova válida' };
  const alvo = app.getAppPath();
  if (/\.asar$/i.test(alvo)) return { ok: false, error: 'esta instalação não permite atualizar pela pasta' };
  const reserva = `${alvo}-anterior`;
  try {
    fs.rmSync(reserva, { recursive: true, force: true });
    fs.cpSync(alvo, reserva, { recursive: true });
    fs.cpSync(dir, alvo, { recursive: true, force: true });
  } catch (e) {
    try { fs.cpSync(reserva, alvo, { recursive: true, force: true }); } catch (e2) { /* restauração falhou */ }
    return { ok: false, error: e.message };
  }
  setTimeout(() => { app.isQuitting = true; app.relaunch(); app.exit(0); }, 600);
  return { ok: true, versao: pk.version };
});
ipcMain.handle('update:publicar', (_e, notas) => {
  const p = pastaSync();
  if (!p) return { ok: false, error: 'escolha a pasta do Google Drive primeiro' };
  const destino = path.join(p, 'atualizacao', 'app');
  try {
    fs.rmSync(destino, { recursive: true, force: true });
    fs.mkdirSync(destino, { recursive: true });
    fs.cpSync(app.getAppPath(), destino, { recursive: true });
    fs.writeFileSync(path.join(p, 'atualizacao', 'versao.json'), JSON.stringify({ versao: app.getVersion(), notas: String(notas || '').slice(0, 2000), por: os.userInfo().username, em: new Date().toISOString() }, null, 2));
    return { ok: true, versao: app.getVersion() };
  } catch (e) { return { ok: false, error: e.message }; }
});

/* ---------- diagnóstico ---------- */
ipcMain.handle('app:info', () => ({
  versao: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
  sistema: `${os.type()} ${os.release()} (${process.arch})`, usuario: os.userInfo().username, computador: os.hostname(),
  dados: app.getPath('userData'), instalacao: app.getAppPath(), criptografia: safeStorage.isEncryptionAvailable(),
  pastaSync: pastaSync(), segundoPlano: !!bgCfg().segundoPlano, iniciarComWindows: !!bgCfg().iniciarComWindows,
}));

/* ---------- segundo plano: bandeja, avisos e início com o Windows ---------- */
const bgCfgPath = () => path.join(app.getPath('userData'), 'segundo-plano.json');
const bgCfg = () => { try { return JSON.parse(fs.readFileSync(bgCfgPath(), 'utf8')); } catch (e) { return {}; } };
let tray = null;
function criarBandeja() {
  if (tray || !bgCfg().segundoPlano) return;
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Planejador Viseu');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir o Planejador', click: mostrarJanela },
    { label: 'Verificar agora', click: () => win && win.webContents.send('bg:verificar') },
    { type: 'separator' },
    { label: 'Sair', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', mostrarJanela);
}
function mostrarJanela() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
ipcMain.handle('bg:config', (_e, c) => {
  const atual = { ...bgCfg(), segundoPlano: !!(c && c.segundoPlano), iniciarComWindows: !!(c && c.iniciarComWindows) };
  fs.writeFileSync(bgCfgPath(), JSON.stringify(atual));
  if (atual.segundoPlano) criarBandeja(); else if (tray) { tray.destroy(); tray = null; }
  try { app.setLoginItemSettings({ openAtLogin: atual.iniciarComWindows && atual.segundoPlano, args: ['--oculto'] }); } catch (e) { /* sem suporte */ }
  return { ok: true, ...atual };
});
ipcMain.handle('app:mostrar', () => { mostrarJanela(); return { ok: true }; });
ipcMain.handle('bg:notificar', (_e, n) => {
  const titulo = String((n && n.titulo) || 'Planejador Viseu').slice(0, 120), corpo = String((n && n.corpo) || '').slice(0, 400);
  try {
    if (Notification.isSupported()) {
      const nt = new Notification({ title: titulo, body: corpo, icon: path.join(__dirname, 'icon.png') });
      nt.on('click', () => { mostrarJanela(); if (n && n.aba && win) win.webContents.send('bg:abrir', String(n.aba)); });
      nt.show();
      return { ok: true };
    }
  } catch (e) { /* cai para o balão da bandeja */ }
  if (tray) { tray.displayBalloon({ title: titulo, content: corpo, iconType: 'info' }); return { ok: true }; }
  return { ok: false };
});
// no Windows, os avisos precisam de um atalho no Menu Iniciar com o mesmo AppUserModelID
const AUMID = 'com.planejadorviseu.app';
function garantirAtalho() {
  if (process.platform !== 'win32') return;
  try {
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Planejador Viseu.lnk');
    let atual = null;
    try { atual = shell.readShortcutLink(lnk); } catch (e) { /* não existe */ }
    if (!atual || atual.target !== process.execPath || atual.appUserModelId !== AUMID) {
      shell.writeShortcutLink(lnk, atual ? 'replace' : 'create', { target: process.execPath, appUserModelId: AUMID, description: 'Planejador Viseu', icon: process.execPath, iconIndex: 0 });
    }
  } catch (e) { /* sem permissão: os avisos usam o balão da bandeja */ }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Planejador Viseu',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#EDEFF1',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      backgroundThrottling: false, // as verificações em segundo plano continuam com a janela escondida
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(null);
  // só o microfone, e só para a própria página do app (voz do assistente)
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((wc, perm, cb, det) => {
    const doApp = wc === win.webContents && String((det && det.requestingUrl) || wc.getURL()).startsWith('file://');
    cb(perm === 'media' && doApp && (!det || !det.mediaTypes || det.mediaTypes.every((t) => t === 'audio')));
  });
  ses.setPermissionCheckHandler((wc, perm) => perm === 'media' && !!wc && wc === win.webContents);
  win.loadFile(path.join(__dirname, 'index.html'));
  const oculto = process.argv.includes('--oculto') && bgCfg().segundoPlano;
  win.once('ready-to-show', () => {
    win.maximize();
    if (!oculto) win.show();
  });
  // fechar a janela só esconde, quando o segundo plano está ligado
  win.on('close', (e) => {
    if (bgCfg().segundoPlano && !app.isQuitting) {
      e.preventDefault();
      win.hide();
      if (tray && !bgCfg().avisouBandeja) {
        tray.displayBalloon({ title: 'O Planejador continua aberto', content: 'Ele segue avisando sobre o euro, passagens e prazos. Para fechar de vez, use Sair no ícone perto do relógio.', iconType: 'info' });
        fs.writeFileSync(bgCfgPath(), JSON.stringify({ ...bgCfg(), avisouBandeja: true }));
      }
    }
  });

  // Links externos abrem no navegador, nunca dentro do app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
}

app.on('second-instance', mostrarJanela);

app.setAppUserModelId(AUMID);
app.whenReady().then(() => { garantirAtalho(); createWindow(); criarBandeja(); });
app.on('before-quit', () => { app.isQuitting = true; });
app.on('window-all-closed', () => app.quit());
