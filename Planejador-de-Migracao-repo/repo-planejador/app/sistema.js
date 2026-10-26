'use strict';

/* =========================================================
   Aba Sistema: sincronização pelo Google Drive (para usar o plano
   a dois), atualização pela pasta do Drive, resumo em PDF para o
   celular, avisos do Windows em segundo plano e diagnóstico.
   ========================================================= */

const temSync = () => !!(window.net && window.net.sync);
const LOCAL_KEY = 'planejador-viseu-local'; // só deste computador, nunca sincronizado
function lerLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; } catch (e) { return {}; } }
function gravarLocal(x) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(x)); } catch (e) { /* sem espaço */ } }
const local = lerLocal();
local.avisos = { euro: true, passagem: true, prazos: true, sync: true, regras: true, ...(local.avisos || {}) };
if (local.pdfAuto === undefined) local.pdfAuto = true;
gravarLocal(local);
let infoSync = { pasta: '', sugestoes: [], usuario: '', computador: '' };

/* ---------- o que vai para o Drive ---------- */
const CONFIG_LOCAL = ['brapiToken', 'travelpayoutsToken', 'serpapiKey', 'ignavKey', 'iaModelo', 'iaModelosEm', 'iaModelosLista', 'iaVisao', 'iaVoz', 'backupAuto', 'autoMercado', 'autoVoos', 'resumoFreq', 'regrasAuto'];
const VIAGEM_SYNC = ['origem', 'destino', 'data', 'flex', 'alertaPreco', 'bagagem'];
const pegar = (o, ks) => Object.fromEntries(ks.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
function projecao(st) {
  const c = JSON.parse(JSON.stringify(st));
  delete c.assistente; delete c.mercado;
  for (const k of CONFIG_LOCAL) delete c.config[k];
  if (c.viagem) c.viagem = pegar(c.viagem, VIAGEM_SYNC);
  return c;
}
function estavel(v) {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
const igual = (a, b) => estavel(a) === estavel(b);
const objeto = (x) => x && typeof x === 'object' && !Array.isArray(x);
const listaComId = (x) => Array.isArray(x) && x.length > 0 && x.every((i) => objeto(i) && i.id);

// mescla de três vias: base (última versão em comum), local e remoto
function mesclar(B, L, R, ctx, caminho) {
  if (igual(L, R)) return L;
  if (B !== undefined && igual(B, L)) return R;
  if (B !== undefined && igual(B, R)) return L;
  if (objeto(L) && objeto(R)) {
    const out = {};
    const b = objeto(B) ? B : {};
    for (const k of new Set([...Object.keys(L), ...Object.keys(R)])) {
      const emL = k in L, emR = k in R;
      if (!emR) { if (k in b && igual(b[k], L[k])) continue; out[k] = L[k]; continue; }
      if (!emL) { if (k in b && igual(b[k], R[k])) continue; out[k] = R[k]; continue; }
      out[k] = mesclar(b[k], L[k], R[k], ctx, `${caminho}.${k}`);
    }
    return out;
  }
  if ((listaComId(L) || listaComId(R)) && Array.isArray(L) && Array.isArray(R)) {
    const mapa = (a) => Object.fromEntries((Array.isArray(a) ? a : []).filter((i) => i && i.id).map((i) => [i.id, i]));
    const bm = mapa(B), lm = mapa(L), rm = mapa(R);
    const ids = [...L.map((i) => i.id), ...R.map((i) => i.id).filter((id) => !(id in lm))];
    const out = [];
    for (const id of ids) {
      const emL = id in lm, emR = id in rm, emB = id in bm;
      if (emL && emR) out.push(mesclar(bm[id], lm[id], rm[id], ctx, `${caminho}[${id}]`));
      else if (emL) { if (emB && igual(bm[id], lm[id])) continue; out.push(lm[id]); }
      else { if (emB && igual(bm[id], rm[id])) continue; out.push(rm[id]); }
    }
    return out;
  }
  ctx.conflitos.push(caminho);
  return ctx.preferir === 'remoto' ? R : L;
}

/* ---------- sincronização ---------- */
let sincronizando = false, sincAgendada = null, ultimaSync = null, ultimoPor = null;
const meuNome = () => local.nomeDispositivo || infoSync.usuario || 'este computador';
function statusSync(txt) { const el = $('#syncStatus'); if (el) el.textContent = txt; }
function aplicarMesclado(M) {
  const novo = {
    ...M, assistente: state.assistente, mercado: state.mercado,
    config: { ...(M.config || {}), ...pegar(state.config, CONFIG_LOCAL) },
    viagem: { ...(state.viagem || {}), ...pegar(M.viagem || {}, VIAGEM_SYNC) },
  };
  state = normalize(novo);
}
async function sincronizar() {
  if (!temSync() || !infoSync.pasta || sincronizando) return;
  sincronizando = true;
  try {
    const r = await window.net.sync.ler();
    if (!r || !r.ok) throw new Error((r && r.error) || 'pasta indisponível');
    const L = projecao(state);
    let R = null, remotoEm = null, por = null;
    if (!r.vazio && r.conteudo) {
      const j = JSON.parse(r.conteudo);
      if (j && j.app === 'planejador-viseu' && j.dados) { R = j.dados; remotoEm = j.atualizadoEm; por = j.por; }
    }
    let M = L;
    const ctx = { conflitos: [], preferir: remotoEm && Date.parse(remotoEm) > (local.ultimaEdicao || 0) ? 'remoto' : 'local' };
    if (R && !local.base && !igual(R, L)) {
      // primeira vez neste computador e já existe um plano no Drive: perguntar, em vez de misturar dois planos diferentes
      const quem = por && por.nome ? por.nome : 'outro computador';
      sincronizando = false;
      if (await confirmar(`Já existe um plano no Google Drive, salvo por ${quem} em ${new Date(remotoEm).toLocaleString('pt-BR')}. Usar esse plano neste computador? O plano que está aqui é substituído.`, 'Usar o plano do Drive')) M = R;
      else if (await confirmar('Então substituir o plano do Google Drive pelo deste computador? O outro computador passa a ver este plano.', 'Substituir o do Drive')) M = L;
      else { statusSync('Sincronização pausada: escolha qual plano usar na aba Sistema'); return; }
      sincronizando = true;
    } else if (R && !(local.baseRemotaEm === remotoEm && local.base)) M = mesclar(local.base, L, R, ctx, 'plano');
    for (const c of r.conflitos || []) {
      try { const j = JSON.parse(c.conteudo); if (j && j.dados) M = mesclar(local.base, M, j.dados, { conflitos: ctx.conflitos, preferir: 'local' }, 'plano'); await window.net.sync.conflitoResolvido(c.nome); } catch (e) { /* cópia ilegível */ }
    }
    const mudouAqui = !igual(M, L);
    if (mudouAqui) {
      aplicarMesclado(M);
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      renderTopo(); construirVista(); refresh();
      const quem = por && por.nome && por.nome !== meuNome() ? por.nome : 'outro computador';
      toast(`Plano atualizado com as mudanças de ${quem}${ctx.conflitos.length ? `; ${ctx.conflitos.length} ${ctx.conflitos.length === 1 ? 'campo alterado' : 'campos alterados'} nos dois lados ficou com a versão mais recente` : ''}`);
      if (document.hidden && local.avisos.sync) window.net.app.notificar({ titulo: 'Plano atualizado', corpo: `${quem} mudou o plano da mudança.`, aba: 'painel' });
    }
    let em = remotoEm;
    if (!R || !igual(M, R)) {
      em = new Date().toISOString();
      const g = await window.net.sync.gravar(JSON.stringify({ app: 'planejador-viseu', formato: 1, versaoApp: (await appInfo()).versao, atualizadoEm: em, por: { nome: meuNome(), computador: infoSync.computador }, dados: M }));
      if (!g || !g.ok) throw new Error((g && g.error) || 'não consegui gravar no Drive');
      local.ultimoMtime = g.mtime;
      por = { nome: meuNome() };
      gerarPdfCelular();
    } else local.ultimoMtime = r.mtime;
    local.base = M; local.baseRemotaEm = em;
    gravarLocal(local);
    ultimaSync = Date.now(); ultimoPor = por;
    statusSync(`Sincronizado com o Google Drive às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (e) {
    statusSync(`Google Drive: ${e.message}`);
  }
  sincronizando = false;
  if (viewAtual === 'sistema') refresh();
}
function agendarSync(ms) { clearTimeout(sincAgendada); sincAgendada = setTimeout(sincronizar, ms); }
aoSalvar.push(() => {
  if (!infoSync.pasta) return;
  if (local.base && igual(projecao(state), local.base)) return; // nada mudou aqui
  local.ultimaEdicao = Date.now();
  gravarLocal(local);
  agendarSync(4000);
});

/* ---------- resumo para o celular ---------- */
let gerandoPdf = false;
async function gerarPdfCelular(forcar) {
  if (!temSync() || !infoSync.pasta || gerandoPdf) return;
  if (!forcar && (!local.pdfAuto || Date.now() - (local.ultimoPdf || 0) < 30 * 60000)) return;
  gerandoPdf = true;
  try {
    await gerarRelatorio({ destino: 'drive' });
    local.ultimoPdf = Date.now(); gravarLocal(local);
    if (forcar) toast('“Resumo para o celular.pdf” salvo na pasta do Google Drive');
  } catch (e) { if (forcar) toast(`Não consegui gerar o PDF: ${e.message}`); }
  gerandoPdf = false;
}

/* ---------- atualização pela pasta do Drive ---------- */
let infoUpdate = null;
async function verificarAtualizacao(perguntar) {
  if (!window.net || !window.net.update) return null;
  infoUpdate = await window.net.update.verificar();
  if (infoUpdate && infoUpdate.disponivel && perguntar && local.updateIgnorada !== infoUpdate.publicada) {
    const ok = await confirmar(`Há uma versão nova do Planejador no Google Drive: ${infoUpdate.publicada}${infoUpdate.por ? `, publicada por ${infoUpdate.por}` : ''} (você está na ${infoUpdate.atual}).${infoUpdate.notas ? `\n\n${infoUpdate.notas}` : ''}\n\nAtualizar agora? O app fecha e abre de novo; seus dados ficam como estão.`, 'Atualizar');
    if (ok) await aplicarAtualizacao(); else { local.updateIgnorada = infoUpdate.publicada; gravarLocal(local); }
  }
  if (viewAtual === 'sistema') refresh();
  return infoUpdate;
}
async function aplicarAtualizacao() {
  toast('Atualizando…');
  const r = await window.net.update.aplicar();
  if (!r || !r.ok) toast(`Não consegui atualizar: ${(r && r.error) || 'erro'}`);
}

/* ---------- avisos em segundo plano ---------- */
let verificandoAvisos = false;
async function verificarAvisos() {
  if (verificandoAvisos || !window.net || !window.net.app) return;
  verificandoAvisos = true;
  const not = local.notificados || {};
  const avisar = async (chave, titulo, corpo, aba) => { if (not[chave]) return; not[chave] = Date.now(); await window.net.app.notificar({ titulo, corpo, aba }); };
  try {
    if (state.config.autoMercado !== false) await atualizarMercado({ silencioso: true });
    const e = state.mercado.eur && +state.mercado.eur.bid, alvo = num(state.config.alertaEuro);
    if (local.avisos.euro && e && alvo && e <= alvo) await avisar(`euro-${hojeISO()}`, `Euro a R$ ${nf(2).format(e)}`, `Abaixo do seu alvo de R$ ${nf(2).format(alvo)}. Bom momento para comprar euros.`, 'mercado');
    const v = typeof viagemState === 'function' ? viagemState() : null;
    if (local.avisos.passagem && v && state.config.travelpayoutsToken && num(v.alertaPreco)) {
      await buscarVoos({ silencioso: true });
      const o = v.ofertas && v.ofertas[0];
      if (o && o.precoBRL <= num(v.alertaPreco)) await avisar(`voo-${v.origem}${v.destino}${v.data}-${Math.round(o.precoBRL / 100)}`, `Passagem por ${brl(o.precoBRL)}`, `${v.origem} → ${v.destino} em ${v.data.split('-').reverse().join('/')}, abaixo do seu alvo de ${brl(v.alertaPreco)}.`, 'viagem');
    }
    if (local.avisos.prazos) {
      const mud = parseMes(state.plano.dataMudanca), hoje = hojeMes();
      const vencem = state.tarefas.filter((t) => t.status !== 'feito' && mesesEntre(hoje, addMes(mud, num(t.quando))) <= 0);
      if (vencem.length) await avisar(`prazos-${mesKey(hoje)}-${vencem.length}`, `Checklist: ${vencem.length} ${vencem.length === 1 ? 'tarefa' : 'tarefas'} para este mês`, vencem.slice(0, 3).map((t) => t.titulo).join('; '), 'checklist');
    }
    if (local.avisos.regras && typeof regrasComValores === 'function') {
      const d = regrasComValores().filter((x) => x.diferente && !x.aplicado);
      if (d.length) await avisar(`regras-${d.map((x) => `${x.id}${x.encontrado}`).join('-')}`, 'Uma regra pode ter mudado', `${d.map((x) => x.nome).join('; ')}. Veja na aba Vasco.`, 'vasco');
    }
  } catch (err) { /* tenta de novo na próxima rodada */ }
  for (const [k, t] of Object.entries(not)) if (Date.now() - t > 90 * 864e5) delete not[k];
  local.notificados = not; local.ultimaVerificacao = Date.now(); gravarLocal(local);
  verificandoAvisos = false;
}

/* ---------- diagnóstico ---------- */
let cacheInfo = null;
async function appInfo() { if (!cacheInfo && window.net && window.net.app) cacheInfo = await window.net.app.info(); return cacheInfo || { versao: '?' }; }
const DICAS = {
  401: 'chave ou token recusado: confira se colou a chave inteira',
  403: 'acesso negado: a chave pode não ter permissão ou o plano acabou',
  404: 'endereço não encontrado: a API pode ter mudado',
  429: 'limite de uso atingido: tente mais tarde',
  'tempo esgotado': 'sem resposta em 25 s: antivírus, firewall ou internet lenta',
};
const dicaDe = (r) => (r && (DICAS[r.status] || DICAS[r.error] || (/ENOTFOUND|ERR_NAME|resolve/i.test(r.error || '') ? 'sem internet ou DNS bloqueado' : /CERT|SSL|certificate/i.test(r.error || '') ? 'certificado bloqueado: antivírus inspecionando HTTPS?' : ''))) || '';
let resultadoDiag = [];
async function rodarDiagnostico(incluirPagas) {
  const hoje = hojeISO(), ano = new Date().getFullYear();
  const g = typeof geoCidade === 'function' ? geoCidade() : { lat: 40.66, lon: -7.91 };
  const c = state.config, v = typeof viagemState === 'function' ? viagemState() : {};
  const testes = [
    ['Euro agora', 'AwesomeAPI', 'eur_last', {}],
    ['Euro do Banco Central Europeu', 'Frankfurter', 'eur_frank_latest', {}],
    ['CDI', 'Banco Central (SGS)', 'sgs', { serie: 'cdi', n: 1 }],
    ['Expectativas do Focus', 'Banco Central (Olinda)', 'focus_anual', { indicador: 'selic' }],
    ['Dólar', 'AwesomeAPI', 'usd_last', {}],
    ['Inflação de Portugal', 'Eurostat', 'eurostat_hicp', {}],
    ['Previsão do tempo', 'Open-Meteo', 'meteo_forecast', { lat: g.lat, lon: g.lon, start: hoje, end: hoje }],
    ['Clima histórico', 'Open-Meteo', 'meteo_archive', { lat: g.lat, lon: g.lon, start: `${ano - 1}-04-01`, end: `${ano - 1}-04-03` }],
    ['Feriados', 'Nager.Date', 'feriados', { pais: 'PT', ano }],
    ['Aluguéis por concelho', 'INE', 'ine_rendas', { varcd: '0009631' }],
    ...(c.brapiToken ? [['Cotações de FIIs', 'brapi', 'brapi_quote', { ticker: (c.tickers || ['MXRF11'])[0], token: c.brapiToken }]] : []),
    ...(c.travelpayoutsToken ? [['Passagens', 'Travelpayouts', 'tp_dates', { origin: v.origem || 'GIG', destination: v.destino || 'OPO', date: (v.data || '2028-04').slice(0, 7), token: c.travelpayoutsToken }]] : []),
    ...(incluirPagas && c.serpapiKey ? [['Passagens ao vivo', 'SerpApi (gasta 1 busca)', 'serp_flights', { origin: v.origem || 'GIG', destination: v.destino || 'OPO', date: v.data, key: c.serpapiKey, adults: 1 }]] : []),
    ...(incluirPagas && c.ignavKey ? [['Passagens ao vivo', 'Ignav (gasta 1 busca)', 'ignav_oneway', { origin: v.origem || 'GIG', destination: v.destino || 'OPO', date: v.data, key: c.ignavKey }]] : []),
  ];
  resultadoDiag = testes.map(([nome, fonte]) => ({ nome, fonte, st: 'testando' }));
  renderDiag();
  await Promise.all(testes.map(async ([, , key, p], i) => {
    const t0 = performance.now();
    let r;
    try { r = await api(key, p); } catch (e) { r = { ok: false, error: e.message }; }
    resultadoDiag[i] = { ...resultadoDiag[i], st: r && r.ok ? 'ok' : 'falha', ms: Math.round(performance.now() - t0), det: r && r.ok ? '' : `${r && r.status ? `HTTP ${r.status}` : (r && r.error) || 'sem resposta'}`, dica: r && r.ok ? '' : dicaDe(r) };
    renderDiag();
  }));
  // Groq
  const add = (nome, fonte, st, det, dica, ms) => { resultadoDiag.push({ nome, fonte, st, det, dica, ms }); renderDiag(); };
  if (window.net && window.net.ia) {
    const s = await window.net.ia.status();
    if (!s.temChave) add('Vasco', 'Groq', 'aviso', 'sem chave', 'cole a chave na conversa do Vasco');
    else {
      let t0 = performance.now();
      const m = await window.net.ia.models();
      add('Modelos do Vasco', 'Groq', m && m.ok ? 'ok' : 'falha', m && m.ok ? `${m.ids.length} modelos; principal ${state.config.iaModelo || '—'}` : (m && m.error) || '', m && m.ok ? '' : dicaDe(m), Math.round(performance.now() - t0));
      t0 = performance.now();
      const r = await window.net.ia.chat({ model: modeloAuxiliar(), messages: [{ role: 'user', content: 'Responda só: ok' }], max_completion_tokens: 256 });
      if (r) registrarCota(modeloAuxiliar(), r.limites);
      const livre = restanteAgora(state.config.iaModelo || 'openai/gpt-oss-120b');
      add('Resposta do Vasco', 'Groq', r && r.ok ? 'ok' : 'falha', r && r.ok ? (livre != null ? `limite livre agora: ${nf(0).format(livre)} tokens por minuto` : '') : `${r && r.status ? `HTTP ${r.status} ` : ''}${(r && r.error) || ''}`.slice(0, 160), r && r.ok ? '' : dicaDe(r), Math.round(performance.now() - t0));
    }
  }
  // sistema
  const info = await appInfo();
  add('Chaves guardadas', 'Windows', info.criptografia ? 'ok' : 'aviso', info.criptografia ? 'criptografia do Windows disponível' : 'sem criptografia do sistema', info.criptografia ? '' : 'as chaves ficam só neste computador, sem criptografia');
  add('Pasta do Google Drive', 'sincronização', info.pastaSync ? 'ok' : 'aviso', info.pastaSync || 'não configurada', info.pastaSync ? '' : 'escolha a pasta acima para usar a dois');
  try { const p = await navigator.permissions.query({ name: 'microphone' }); add('Microfone', 'Windows', p.state === 'denied' ? 'falha' : 'ok', p.state === 'granted' ? 'liberado' : p.state === 'prompt' ? 'vai pedir permissão no primeiro uso' : 'bloqueado', p.state === 'denied' ? 'libere em Configurações > Privacidade > Microfone' : ''); } catch (e) { /* sem API */ }
  local.ultimoDiag = Date.now(); gravarLocal(local);
}
function renderDiag() {
  const st = { ok: ['ok', 'funcionando'], falha: ['bad', 'falhou'], aviso: ['warn', 'atenção'], testando: ['info', 'testando…'] };
  $('#tblDiag').innerHTML = `<thead><tr><th>Teste</th><th>Fonte</th><th>Resultado</th><th class="num">Tempo</th><th>Detalhe</th></tr></thead><tbody>${resultadoDiag.map((x) => `<tr><td>${esc(x.nome)}</td><td class="small muted">${esc(x.fonte)}</td><td><span class="pill ${st[x.st][0]}">${st[x.st][1]}</span></td><td class="num small">${x.ms != null ? `${nf(0).format(x.ms)} ms` : ''}</td><td class="small">${esc(x.det || '')}${x.dica ? `<small class="muted block">${esc(x.dica)}</small>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Clique em Testar tudo.</td></tr>'}</tbody>`;
  const ok = resultadoDiag.filter((x) => x.st === 'ok').length, fal = resultadoDiag.filter((x) => x.st === 'falha').length;
  $('#diagResumo').textContent = resultadoDiag.length ? `${ok} funcionando, ${fal} com falha` : '';
}
async function textoDiag() {
  const i = await appInfo();
  return [`Planejador Viseu ${i.versao} · Electron ${i.electron} · ${i.sistema}`, `Teste de ${new Date().toLocaleString('pt-BR')}`, ...resultadoDiag.map((x) => `- ${x.nome} (${x.fonte}): ${x.st}${x.ms != null ? `, ${x.ms} ms` : ''}${x.det ? `, ${x.det}` : ''}`)].join('\n');
}

/* ---------- a aba ---------- */
V.sistema = {
  async build() {
    if (temSync()) infoSync = await window.net.sync.info();
    $('#syNome').value = local.nomeDispositivo || '';
    $('#syNome').placeholder = infoSync.usuario || 'Seu nome';
    $('#syPdf').checked = !!local.pdfAuto;
    for (const k of Object.keys(local.avisos)) { const el = $(`#av-${k}`); if (el) el.checked = !!local.avisos[k]; }
    const i = await appInfo();
    $('#bgLigado').checked = !!i.segundoPlano; $('#bgWindows').checked = !!i.iniciarComWindows; $('#bgWindows').disabled = !i.segundoPlano;
    renderDiag();
    await verificarAtualizacao(false);
    this.update();
  },
  update() {
    const p = infoSync.pasta;
    $('#syEstado').innerHTML = !temSync() ? 'Disponível no app para Windows<b>—</b>'
      : p ? `Sincronizando com<b>${esc(p)}</b>` : 'Ainda não ligado ao Google Drive<b>escolha a pasta</b>';
    $('#sySugestoes').innerHTML = !p && (infoSync.sugestoes || []).length ? `<p class="muted small">Achei a pasta do Google Drive neste computador:</p>${infoSync.sugestoes.map((d) => `<button data-sug-dir="${esc(d)}">Usar ${esc(d)}</button>`).join(' ')}` : '';
    $('#syDesligar').hidden = !p; $('#syAgora').disabled = !p; $('#syPdfAgora').disabled = !p;
    $('#syUltima').textContent = ultimaSync ? `Última sincronização às ${new Date(ultimaSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${ultimoPor && ultimoPor.nome ? `, última mudança gravada por ${ultimoPor.nome}` : ''}.` : '';
    // atualização
    const u = infoUpdate;
    $('#upEstado').innerHTML = !u ? 'Verificando…<b></b>' : `Você está na versão<b>${esc(u.atual)}</b>`;
    $('#upDetalhe').textContent = !u ? '' : !p ? 'Ligue a pasta do Google Drive para receber e publicar atualizações.'
      : u.disponivel ? `Há a versão ${u.publicada} no Drive${u.por ? `, publicada por ${u.por}` : ''}.` : u.publicada ? `No Drive está a versão ${u.publicada}.` : 'Ainda não há versão publicada no Drive.';
    $('#upAplicar').hidden = !(u && u.disponivel);
    $('#upPublicar').disabled = !(u && p && u.podePublicar);
  },
};

(function bindSistema() {
  if (!temSync()) return;
  $('#syEscolher').addEventListener('click', async () => { const r = await window.net.sync.escolher(); if (r && r.ok) { infoSync = await window.net.sync.info(); toast('Pasta escolhida. Sincronizando…'); await sincronizar(); V.sistema.update(); } });
  $('#sySugestoes').addEventListener('click', async (e) => { const b = e.target.closest('[data-sug-dir]'); if (!b) return; const r = await window.net.sync.usarSugestao(b.dataset.sugDir); if (r && r.ok) { infoSync = await window.net.sync.info(); await sincronizar(); V.sistema.update(); } });
  $('#syDesligar').addEventListener('click', async () => { if (!(await confirmar('Parar de sincronizar com o Google Drive neste computador? O plano continua salvo aqui e no Drive.', 'Desligar'))) return; await window.net.sync.desligar(); infoSync = await window.net.sync.info(); delete local.base; delete local.baseRemotaEm; gravarLocal(local); statusSync(''); V.sistema.update(); });
  $('#syAgora').addEventListener('click', () => sincronizar());
  $('#syNome').addEventListener('change', (e) => { local.nomeDispositivo = e.target.value.trim(); gravarLocal(local); });
  $('#syPdf').addEventListener('change', (e) => { local.pdfAuto = e.target.checked; gravarLocal(local); });
  $('#syPdfAgora').addEventListener('click', () => gerarPdfCelular(true));
  $('#upAplicar').addEventListener('click', async () => { if (await confirmar(`Atualizar para a versão ${infoUpdate.publicada}? O app fecha e abre de novo.`, 'Atualizar')) aplicarAtualizacao(); });
  $('#upPublicar').addEventListener('click', async () => {
    const notas = $('#upNotas').value.trim();
    const r = await window.net.update.publicar(notas);
    toast(r && r.ok ? `Versão ${r.versao} publicada no Google Drive. O outro computador recebe ao abrir o app.` : `Não consegui publicar: ${(r && r.error) || 'erro'}`);
    await verificarAtualizacao(false);
  });
  const bg = async () => {
    const r = await window.net.app.segundoPlano({ segundoPlano: $('#bgLigado').checked, iniciarComWindows: $('#bgWindows').checked });
    cacheInfo = null;
    $('#bgWindows').disabled = !r.segundoPlano;
    toast(r.segundoPlano ? 'Ao fechar a janela, o Planejador fica perto do relógio e continua avisando' : 'Segundo plano desligado');
  };
  $('#bgLigado').addEventListener('change', bg);
  $('#bgWindows').addEventListener('change', bg);
  $('#avisosBox').addEventListener('change', (e) => { const k = e.target.id.replace('av-', ''); if (k in local.avisos) { local.avisos[k] = e.target.checked; gravarLocal(local); } });
  $('#bgTestar').addEventListener('click', () => window.net.app.notificar({ titulo: 'Avisos ligados', corpo: 'É assim que o Planejador vai avisar sobre o euro, passagens e prazos.', aba: 'sistema' }));
  $('#diagRodar').addEventListener('click', async (e) => { e.target.disabled = true; await rodarDiagnostico($('#diagPagas').checked); e.target.disabled = false; });
  $('#diagCopiar').addEventListener('click', async () => { try { await navigator.clipboard.writeText(await textoDiag()); toast('Resultado copiado. Pode colar numa conversa.'); } catch (e) { toast('Não consegui copiar.'); } });

  window.net.app.aoVerificar(() => verificarAvisos());
  window.net.app.aoAbrir((aba) => go(aba));
  window.addEventListener('focus', () => { if (infoSync.pasta && Date.now() - (ultimaSync || 0) > 15000) sincronizar(); });

  // ao abrir: liga a sincronização, verifica atualização e agenda os avisos
  (async () => {
    infoSync = await window.net.sync.info();
    if (infoSync.pasta) { await sincronizar(); setTimeout(() => verificarAtualizacao(true), 4000); }
    setInterval(async () => {
      if (!infoSync.pasta || sincronizando) return;
      const mt = await window.net.sync.mtime();
      if (mt && mt !== local.ultimoMtime) sincronizar();
    }, 30000);
    setTimeout(verificarAvisos, 90000);
    setInterval(verificarAvisos, 3 * 3600e3);
  })();
})();

window.__sistema = { mesclar, projecao, estavel, sincronizar, rodarDiagnostico, verificarAvisos, lerLocal };
