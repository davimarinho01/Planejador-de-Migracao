'use strict';

/* =========================================================
   Aba Mercado — euro, juros, Focus e cotações (APIs públicas)
   Usa o estado e utilitários definidos em app.js.
   ========================================================= */

const AUTO_MIN = 30; // minutos entre atualizações automáticas

function ensureMarket() {
  if (!state.mercado || typeof state.mercado !== 'object') state.mercado = {};
  if (!state.config || typeof state.config !== 'object') state.config = {};
  const c = state.config;
  if (typeof c.autoMercado !== 'boolean') c.autoMercado = true;
  if (typeof c.brapiToken !== 'string') c.brapiToken = '';
  if (!Array.isArray(c.tickers)) c.tickers = ['MXRF11', 'HGLG11'];
  if (!state.mercado.tickers || typeof state.mercado.tickers !== 'object') state.mercado.tickers = {};
}

/* ---------- acesso à rede ---------- */
async function api(key, params) {
  if (window.net && typeof window.net.get === 'function') {
    try { return await window.net.get(key, params || {}); } catch (e) { return { ok: false, error: e.message }; }
  }
  // fora do app (navegador comum): tenta direto
  let req;
  try { req = MarketURLs.build(key, params || {}); } catch (e) { return { ok: false, error: e.message }; }
  if (typeof req === 'string') req = { url: req };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(req.url, { method: req.method || 'GET', body: req.body, signal: ctrl.signal, headers: { Accept: 'application/json', ...(req.headers || {}) } });
    if (!r.ok) return { ok: false, status: r.status, error: `HTTP ${r.status}` };
    return { ok: true, data: await r.json() };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'tempo esgotado' : 'sem conexão' };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- leitura das respostas ---------- */
const Parse = {
  awesomeLast(d) {
    const q = d && d.EURBRL;
    const bid = q && parseFloat(q.bid);
    if (!Number.isFinite(bid) || bid <= 0) return null;
    return { bid, pct: parseFloat(q.pctChange), high: parseFloat(q.high), low: parseFloat(q.low), t: (parseInt(q.timestamp, 10) || 0) * 1000 || Date.now(), fonte: 'AwesomeAPI' };
  },
  awesomeDaily(arr) {
    if (!Array.isArray(arr)) return null;
    const pts = arr.map((x) => ({ t: (parseInt(x.timestamp, 10) || 0) * 1000, v: parseFloat(x.bid) }))
      .filter((p) => p.t > 0 && Number.isFinite(p.v) && p.v > 0)
      .sort((a, b) => a.t - b.t);
    return pts.length >= 2 ? pts : null;
  },
  frankLatest(d) {
    const bid = d && d.rates && +d.rates.BRL;
    if (!Number.isFinite(bid) || bid <= 0) return null;
    return { bid, pct: null, t: Date.parse(`${d.date}T12:00:00`) || Date.now(), fonte: 'BCE (Frankfurter)' };
  },
  frankSeries(d) {
    if (!d || !d.rates) return null;
    const pts = Object.entries(d.rates).map(([k, v]) => ({ t: Date.parse(`${k}T12:00:00`), v: +(v && v.BRL) }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0)
      .sort((a, b) => a.t - b.t);
    return pts.length >= 2 ? pts.slice(-30) : null;
  },
  sgs(arr) {
    if (!Array.isArray(arr) || !arr.length) return null;
    const last = arr[arr.length - 1];
    const v = parseFloat(String(last.valor).replace(',', '.'));
    if (!Number.isFinite(v)) return null;
    return { v, d: String(last.data || '') };
  },
  focusAnual(d) {
    const rows = d && Array.isArray(d.value) ? d.value : [];
    if (!rows.length) return null;
    const latest = rows.reduce((m, r) => (r.Data > m ? r.Data : m), '');
    const porAno = {};
    for (const r of rows) if (r.Data === latest && r.DataReferencia && Number.isFinite(+r.Mediana)) porAno[String(r.DataReferencia)] = +r.Mediana;
    return Object.keys(porAno).length ? { data: latest, porAno } : null;
  },
  focusReuniao(d) {
    const rows = d && Array.isArray(d.value) ? d.value : [];
    if (!rows.length) return null;
    const latest = rows.reduce((m, r) => (r.Data > m ? r.Data : m), '');
    const best = {};
    for (const r of rows) {
      if (r.Data !== latest) continue;
      const m = /^R(\d+)\/(\d{4})$/.exec(String(r.Reuniao || ''));
      if (!m || !Number.isFinite(+r.Mediana)) continue;
      const [, n, ano] = m;
      if (!best[ano] || +n > best[ano].n) best[ano] = { n: +n, v: +r.Mediana };
    }
    const porAno = Object.fromEntries(Object.entries(best).map(([a, x]) => [a, x.v]));
    return Object.keys(porAno).length ? { data: latest, porAno } : null;
  },
  awesomeUsd(d) {
    const q = d && d.USDBRL;
    const bid = q && parseFloat(q.bid);
    return Number.isFinite(bid) && bid > 0 ? { bid, t: (parseInt(q.timestamp, 10) || 0) * 1000 || Date.now() } : null;
  },
  eurostat(d) {
    if (!d || !d.value || !d.dimension || !d.dimension.time) return null;
    const idx = d.dimension.time.category.index || {};
    const per = Object.entries(idx).filter(([, i]) => d.value[i] !== undefined && d.value[i] !== null).sort((a, b) => b[1] - a[1]);
    if (!per.length) return null;
    const [periodo, i] = per[0];
    return { v: +d.value[i], periodo };
  },
  brapi(d) {
    const r = d && Array.isArray(d.results) && d.results[0];
    if (!r || !Number.isFinite(+r.regularMarketPrice)) return null;
    return { preco: +r.regularMarketPrice, pct: +r.regularMarketChangePercent, nome: r.shortName || r.longName || '', t: Date.parse(r.regularMarketTime) || Date.now() };
  },
};

/* ---------- atualização ---------- */
let atualizando = false;
async function atualizarMercado({ silencioso = false } = {}) {
  ensureMarket();
  if (atualizando) return;
  atualizando = true;
  const btn = $('#mkRefresh');
  if (btn) { btn.disabled = true; btn.lastChild.textContent = 'Atualizando…'; }
  $('#mkStatus') && ($('#mkStatus').textContent = 'Buscando dados…');

  const m = state.mercado;
  const falhas = [];
  const tentar = async (nome, passos) => {
    for (const [key, params, parser] of passos) {
      const r = await api(key, params);
      if (r && r.ok) {
        const v = parser(r.data);
        if (v) return v;
      }
    }
    falhas.push(nome);
    return null;
  };

  const anoAtual = new Date().getFullYear();
  const [usd, hicp] = await Promise.all([
    tentar('dólar', [['usd_last', {}, Parse.awesomeUsd]]),
    tentar('inflação em Portugal', [['eurostat_hicp', {}, Parse.eurostat]]),
  ]);
  if (usd) m.usd = usd;
  if (hicp) m.hicpPT = hicp;
  const [eur, hist, cdi, selic, ipca12, ptax, fSelic, fIpca] = await Promise.all([
    tentar('euro', [['eur_last', {}, Parse.awesomeLast], ['eur_frank_latest', {}, Parse.frankLatest]]),
    tentar('histórico do euro', [['eur_daily', { n: 30 }, Parse.awesomeDaily], ['eur_frank_series', { days: 45 }, Parse.frankSeries]]),
    tentar('CDI', [['sgs', { serie: 'cdi' }, Parse.sgs]]),
    tentar('Selic', [['sgs', { serie: 'selic' }, Parse.sgs]]),
    tentar('IPCA', [['sgs', { serie: 'ipca12' }, Parse.sgs]]),
    tentar('PTAX', [['sgs', { serie: 'ptaxEur' }, Parse.sgs]]),
    tentar('Focus Selic', [['focus_anual', { indicador: 'selic' }, Parse.focusAnual], ['focus_selic_reuniao', {}, Parse.focusReuniao]]),
    tentar('Focus IPCA', [['focus_anual', { indicador: 'ipca' }, Parse.focusAnual]]),
  ]);
  if (eur) m.eur = eur;
  if (hist) m.eurHist = hist;
  if (cdi) m.cdi = cdi;
  if (selic) m.selic = selic;
  if (ipca12) m.ipca12 = ipca12;
  if (ptax) m.ptax = ptax;
  if (fSelic) m.focusSelic = fSelic;
  if (fIpca) m.focusIpca = fIpca;

  if (state.config.brapiToken) {
    await Promise.all(state.config.tickers.map(async (t) => {
      const r = await api('brapi_quote', { ticker: t, token: state.config.brapiToken });
      const v = r && r.ok ? Parse.brapi(r.data) : null;
      if (v) m.tickers[t] = v;
      else {
        m.tickers[t] = { ...(m.tickers[t] || {}), erro: r && r.status === 401 ? 'token inválido' : r && r.status === 404 ? 'não encontrado' : 'sem resposta' };
        falhas.push(t);
      }
    }));
  }

  const algumOk = [eur, hist, cdi, selic, ipca12, ptax, fSelic, fIpca].some(Boolean);
  if (algumOk) m.atualizadoEm = Date.now();
  m.falhas = falhas;
  m.anoBase = anoAtual;
  verificarAlerta();
  atualizando = false;
  if (btn) { btn.disabled = false; btn.lastChild.textContent = 'Atualizar agora'; }
  save();
  refresh();
  if (!silencioso || !algumOk) {
    if (!algumOk) toast('Sem conexão com as fontes. Os últimos valores salvos continuam valendo.');
    else if (falhas.length) toast(`Atualizado. Não responderam: ${falhas.join(', ')}.`);
    else toast('Mercado atualizado');
  }
}

/* ---------- aplicar nos cenários ---------- */
const r2 = (v) => Math.round(v * 100) / 100;
const aaParaAm = (aa) => Math.pow(1 + aa / 100, 1 / 12) - 1;
function aplicar(msg) {
  save();
  construirVista();
  refresh();
  toast(msg);
}
function applyBase() {
  const e = state.mercado.eur;
  if (!e) return toast('Atualize o mercado primeiro.');
  state.cenarios.base.cambio = r2(e.bid);
  aplicar(`Cenário Base agora usa R$ ${nf(2).format(r2(e.bid))} por euro`);
}
function applyAll() {
  const e = state.mercado.eur;
  if (!e) return toast('Atualize o mercado primeiro.');
  state.cenarios.base.cambio = r2(e.bid);
  state.cenarios.conservador.cambio = r2(e.bid * 1.06);
  state.cenarios.estresse.cambio = r2(e.bid * 1.14);
  aplicar(`Câmbio aplicado: R$ ${nf(2).format(r2(e.bid))}, R$ ${nf(2).format(r2(e.bid * 1.06))} e R$ ${nf(2).format(r2(e.bid * 1.14))}`);
}
function applyCdi() {
  const m = state.mercado;
  if (!m.cdi) return toast('Atualize o mercado primeiro.');
  state.cenarios.base.cdi = +aaParaAm(m.cdi.v).toFixed(5);
  const ano = new Date().getFullYear();
  const f = m.focusSelic && m.focusSelic.porAno;
  const prox = f && (f[ano + 1] ?? f[ano]);
  const depois = f && (f[ano + 2] ?? prox);
  if (Number.isFinite(prox)) state.cenarios.conservador.cdi = +aaParaAm(prox - 0.1).toFixed(5);
  if (Number.isFinite(depois)) state.cenarios.estresse.cdi = +aaParaAm(depois - 0.1).toFixed(5);
  aplicar(Number.isFinite(prox)
    ? 'CDI aplicado: hoje no Base e Selic esperada (−0,10 ponto) nos outros cenários'
    : 'CDI de hoje aplicado no Base. O Focus não respondeu, então os outros cenários não mudaram.');
}

/* ---------- desenho ---------- */
const dataHora = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dataCurta = (t) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const fmtPct = (v, dec = 2) => `${nf(dec).format(v)}%`;
const fmtFocusData = (s) => (s ? s.split('-').reverse().slice(0, 2).join('/') : '');

function renderMercado() {
  ensureMarket();
  const m = state.mercado;
  const base = state.cenarios.base;

  $('#mkAuto').checked = state.config.autoMercado;
  if (document.activeElement !== $('#mkAlvo')) $('#mkAlvo').value = num(state.config.alertaEuro) || '';
  renderCompras();
  if (document.activeElement !== $('#mkToken')) $('#mkToken').value = state.config.brapiToken;

  $('#mkStatus').innerHTML = m.atualizadoEm
    ? `Atualizado em <b>${dataHora(m.atualizadoEm)}</b>${m.falhas && m.falhas.length ? ` <span class="muted">· sem resposta: ${esc(m.falhas.join(', '))}</span>` : ''}`
    : 'Ainda sem dados de mercado. Clique em Atualizar agora.';

  // euro
  const e = m.eur;
  $('#mkEur').textContent = e ? `R$ ${nf(2).format(e.bid)}` : '—';
  const chg = $('#mkEurChg');
  if (e && Number.isFinite(e.pct)) {
    chg.textContent = `${e.pct >= 0 ? '+' : ''}${nf(2).format(e.pct)}% hoje · ${e.fonte}`;
    chg.className = `mk-chg ${e.pct > 0 ? 'neg' : 'pos'}`; // euro subindo é ruim para quem manda reais
  } else {
    chg.textContent = e ? `${e.fonte}, ${dataCurta(e.t)}` : '';
    chg.className = 'mk-chg muted';
  }
  const facts = [];
  if (e) {
    const wise = e.bid * (1 + num(base.iof)) / (1 - num(base.tarifa));
    facts.push(['Custo real na remessa', `R$ ${nf(2).format(wise)}`, 'com IOF e tarifa do cenário Base']);
    const dif = (num(base.cambio) / e.bid - 1) * 100;
    facts.push(['Cenário Base usa', `R$ ${nf(2).format(num(base.cambio))}`, `${dif >= 0 ? '+' : ''}${nf(1).format(dif)}% em relação a hoje`]);
  }
  if (m.ptax) facts.push(['PTAX do Banco Central', `R$ ${nf(4).format(m.ptax.v)}`, `venda, ${m.ptax.d}`]);
  $('#mkEurFacts').innerHTML = facts.map(([k, v, s]) => `<div><dt>${k}</dt><dd>${v}<small>${s}</small></dd></div>`).join('');
  $('#mkApplyBase').disabled = !e;
  $('#mkApplyAll').disabled = !e;

  const h = m.eurHist;
  if (h && h.length) {
    const vals = h.map((p) => p.v);
    $('#mkEurRange').textContent = `mínima R$ ${nf(2).format(Math.min(...vals))}, máxima R$ ${nf(2).format(Math.max(...vals))}`;
    const az = cssVar('--azulejo');
    chart('chEurHist', 'line', {
      labels: h.map((p) => dataCurta(p.t)),
      datasets: [
        { label: 'Euro (R$)', data: vals, borderColor: az, backgroundColor: az + '22', fill: true, borderWidth: 2.5, pointRadius: 0, tension: 0.25 },
        { label: 'Cenário Base', data: vals.map(() => num(base.cambio)), borderColor: cssVar('--ocre'), borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0 },
      ],
    }, baseOpts({
      interaction: { mode: 'index', intersect: false },
      plugins: { ...baseOpts().plugins, legend: { ...baseOpts().plugins.legend, position: 'bottom' },
        tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: (c) => ` ${c.dataset.label}: R$ ${nf(4).format(c.raw)}` } } },
      scales: { ...baseOpts().scales, x: { ...baseOpts().scales.x, ticks: { ...baseOpts().scales.x.ticks, maxTicksLimit: 8, maxRotation: 0 } },
        y: { ...baseOpts().scales.y, ticks: { ...baseOpts().scales.y.ticks, callback: (v) => `R$ ${nf(2).format(v)}` } } },
    }));
  } else {
    $('#mkEurRange').textContent = '';
  }

  // juros
  const linhas = [];
  if (m.cdi) {
    const am = aaParaAm(m.cdi.v) * 100;
    linhas.push(['CDI', `${fmtPct(m.cdi.v)} ao ano`, `${nf(3).format(am)}% ao mês; o Base usa ${nf(3).format(num(base.cdi) * 100)}%`, m.cdi.d]);
  }
  if (m.selic) linhas.push(['Selic (meta do Copom)', `${fmtPct(m.selic.v)} ao ano`, '', m.selic.d]);
  if (m.ipca12) linhas.push(['IPCA em 12 meses', fmtPct(m.ipca12.v), '', m.ipca12.d]);
  if (m.cdi && m.ipca12) {
    const real = ((1 + m.cdi.v / 100) / (1 + m.ipca12.v / 100) - 1) * 100;
    linhas.push(['Juro real do CDI', fmtPct(real), 'quanto o CDI rende acima da inflação', '']);
  }
  if (m.hicpPT) linhas.push(['Inflação em Portugal em 12 meses', fmtPct(m.hicpPT.v, 1), `índice HICP do Eurostat; o Conservador ajusta despesas em ${nf(0).format(num(state.cenarios.conservador.ajusteDesp) * 100)}%`, m.hicpPT.periodo]);
  if (m.usd) linhas.push(['Dólar', `R$ ${nf(2).format(m.usd.bid)}`, 'usado para converter preços de passagens em dólar', '']);
  $('#mkJuros').innerHTML = linhas.length
    ? linhas.map(([k, v, s, d]) => `<div class="mk-row"><div><span>${k}</span>${s ? `<small>${s}</small>` : ''}</div><div class="mk-val">${v}${d ? `<small>${d}</small>` : ''}</div></div>`).join('')
    : '<p class="muted">Sem dados ainda.</p>';
  $('#mkApplyCdi').disabled = !m.cdi;

  // Focus
  const fs = m.focusSelic && m.focusSelic.porAno, fi = m.focusIpca && m.focusIpca.porAno;
  const ano = new Date().getFullYear();
  const anos = [ano, ano + 1, ano + 2].map(String);
  $('#mkFocusDate').textContent = m.focusSelic ? `pesquisa de ${fmtFocusData(m.focusSelic.data)}` : '';
  if (fs || fi) {
    chart('chFocus', 'bar', {
      labels: anos.map((a) => `Fim de ${a}`),
      datasets: [
        { label: 'Selic (% a.a.)', data: anos.map((a) => (fs && fs[a] != null ? fs[a] : null)), backgroundColor: cssVar('--azulejo'), borderRadius: 4 },
        { label: 'IPCA (%)', data: anos.map((a) => (fi && fi[a] != null ? fi[a] : null)), backgroundColor: cssVar('--ocre'), borderRadius: 4 },
      ],
    }, baseOpts({
      plugins: { ...baseOpts().plugins, legend: { ...baseOpts().plugins.legend, position: 'bottom' },
        tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: (c) => ` ${c.dataset.label}: ${nf(2).format(c.raw)}` } } },
      scales: { ...baseOpts().scales, y: { ...baseOpts().scales.y, beginAtZero: true, ticks: { ...baseOpts().scales.y.ticks, callback: (v) => `${v}%` } } },
    }));
  }

  // cotações
  const tk = state.config.tickers;
  const semToken = !state.config.brapiToken;
  $('#tblTickers').innerHTML = `<thead><tr><th>Ativo</th><th>Nome</th><th class="num">Preço</th><th class="num">Variação no dia</th><th>Atualizado</th><th></th></tr></thead><tbody>${
    tk.length ? tk.map((t) => {
      const q = m.tickers[t] || {};
      const preco = Number.isFinite(q.preco) ? brl(q.preco, 2) : '—';
      const pctTxt = Number.isFinite(q.pct) ? `<span class="${q.pct >= 0 ? 'pos' : 'neg'}">${q.pct >= 0 ? '+' : ''}${nf(2).format(q.pct)}%</span>` : '—';
      const st = semToken ? '<span class="pill warn">falta o token</span>' : q.erro ? `<span class="pill warn">${esc(q.erro)}</span>` : q.t ? dataHora(q.t) : '—';
      return `<tr data-t="${esc(t)}"><td><b>${esc(t)}</b></td><td class="muted">${esc(q.nome || '')}</td><td class="num out">${preco}</td><td class="num">${pctTxt}</td><td>${st}</td><td class="c-del"><button class="icon-btn" data-rm title="Remover ${esc(t)}" aria-label="Remover ${esc(t)}"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="muted">Adicione um código de FII ou ação, como MXRF11.</td></tr>'
  }</tbody>`;
}

/* ---------- eventos ---------- */
ensureMarket();
$('#mkRefresh').addEventListener('click', () => atualizarMercado());
$('#mkApplyBase').addEventListener('click', applyBase);
$('#mkApplyAll').addEventListener('click', applyAll);
$('#mkApplyCdi').addEventListener('click', applyCdi);
$('#mkAuto').addEventListener('change', (e) => { state.config.autoMercado = e.target.checked; save(); });
$('#mkToken').addEventListener('change', (e) => {
  state.config.brapiToken = e.target.value.trim();
  save();
  toast(state.config.brapiToken ? 'Token salvo. Clique em Atualizar agora.' : 'Token removido');
  renderMercado();
});
function addTicker() {
  const inp = $('#mkTicker');
  const t = inp.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(t)) return toast('Use o código do ativo, como MXRF11 ou PETR4.');
  if (!state.config.tickers.includes(t)) state.config.tickers.push(t);
  inp.value = '';
  save();
  renderMercado();
  if (state.config.brapiToken) atualizarMercado({ silencioso: true });
}
$('#mkAddTicker').addEventListener('click', addTicker);
$('#mkTicker').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTicker(); });
$('#tblTickers').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rm]');
  if (!b) return;
  const t = b.closest('tr').dataset.t;
  state.config.tickers = state.config.tickers.filter((x) => x !== t);
  delete state.mercado.tickers[t];
  save();
  renderMercado();
});

/* ---------- alerta de cotação ---------- */
function verificarAlerta() {
  const alvo = num(state.config.alertaEuro);
  const e = state.mercado && state.mercado.eur;
  const ban = $('#alertBanner');
  if (!alvo || !e || e.bid > alvo) { ban.hidden = true; return; }
  ban.hidden = false;
  ban.innerHTML = `O euro está em <b>R$ ${nf(2).format(e.bid)}</b>, abaixo do seu alvo de R$ ${nf(2).format(alvo)}. Bom momento para comprar uma parte. <button class="ghost small-btn" id="banClose">Fechar</button>`;
  $('#banClose').onclick = () => { ban.hidden = true; };
  const chave = `${alvo}-${new Date().toDateString()}`;
  if (state.mercado.alertaAvisado !== chave) {
    state.mercado.alertaAvisado = chave;
    try { new Notification('Euro abaixo do seu alvo', { body: `R$ ${nf(2).format(e.bid)} por euro (alvo R$ ${nf(2).format(alvo)})` }); } catch (err) { /* sem notificação */ }
  }
}
$('#mkAlvo').addEventListener('change', (e) => {
  state.config.alertaEuro = num(e.target.value);
  save();
  verificarAlerta();
  toast(state.config.alertaEuro ? `Aviso quando o euro ficar abaixo de R$ ${nf(2).format(state.config.alertaEuro)}` : 'Aviso desligado');
});

/* ---------- euros já comprados ---------- */
function renderCompras() {
  const cs = state.comprasEuro || [];
  const hoje = state.mercado.eur && state.mercado.eur.bid;
  const totE = cs.reduce((s, c) => s + num(c.euros), 0), totR = cs.reduce((s, c) => s + num(c.reais), 0);
  const medio = totE ? totR / totE : 0;
  $('#cpResumo').textContent = totE ? `${eur(totE)} comprados, preço médio de R$ ${nf(4).format(medio)}${hoje ? `; hoje a remessa custaria R$ ${nf(4).format(hoje * (1 + num(state.cenarios.base.iof)) / (1 - num(state.cenarios.base.tarifa)))}` : ''}` : 'nenhuma compra registrada';
  $('#tblCompras').innerHTML = `<thead><tr><th>Data</th><th class="num">Euros recebidos</th><th class="num">Reais pagos (com IOF e tarifas)</th><th class="num">Custo por euro</th><th></th></tr></thead><tbody>${
    cs.map((c) => `<tr data-id="${c.id}"><td>${inp('data', c.data, { type: 'date' })}</td><td>${inp('euros', c.euros, { step: '10' })}</td><td>${inp('reais', c.reais, { step: '10' })}</td><td class="num out">${num(c.euros) ? 'R$ ' + nf(4).format(num(c.reais) / num(c.euros)) : '—'}</td><td class="c-del">${delBtn}</td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">Quando comprar euros, registre aqui para acompanhar o preço médio.</td></tr>'}</tbody>`;
  renderPlanoEuros();
}
/* ---------- plano de compra de euros até a mudança ---------- */
function planoCompraEuros() {
  const all = ultimoAll || calcAll();
  const r = all[state.cenarioAtivo];
  const metaAuto = Math.round((r.sim.ent.eurPart + 3 * r.despesas) / 100) * 100;
  const meta = num(state.config.metaEuros) || metaAuto;
  const cs = state.comprasEuro || [];
  const comprados = cs.reduce((s, c) => s + num(c.euros), 0), pagos = cs.reduce((s, c) => s + num(c.reais), 0);
  const meses = Math.max(0, mesesEntre(hojeMes(), parseMes(state.plano.dataMudanca)));
  const faltam = Math.max(0, meta - comprados);
  const porMes = meses ? faltam / meses : faltam;
  const hoje = state.mercado.eur && +state.mercado.eur.bid;
  const custoHoje = hoje ? hoje * (1 + num(state.cenarios.base.iof)) / (1 - num(state.cenarios.base.tarifa)) : null;
  return {
    meta: Math.round(meta), meta_automatica: metaAuto, usa_meta_automatica: !num(state.config.metaEuros),
    explicacao_meta: 'custos da mudança pagos em euros (com aluguel adiantado) + 3 meses de despesas',
    comprados: Math.round(comprados), preco_medio: comprados ? pagos / comprados : null, faltam: Math.round(faltam), meses,
    porMes: Math.round(porMes), custo_por_euro_hoje: custoHoje, reaisMes: custoHoje ? Math.round(porMes * custoHoje) : null,
    cambio_do_cenario: r.tip.cambio, progresso: meta ? Math.min(1, comprados / meta) : 0,
  };
}
function renderPlanoEuros() {
  if (!$('#peKpis')) return;
  const p = planoCompraEuros();
  if (document.activeElement !== $('#peMeta')) $('#peMeta').value = p.usa_meta_automatica ? '' : p.meta;
  $('#peMeta').placeholder = String(p.meta_automatica);
  const k = (l, v, n) => `<div class="kpi"><div class="k-label">${l}</div><div class="k-val">${v}</div><div class="k-note">${n}</div></div>`;
  $('#peKpis').innerHTML = [
    k('Meta', eur(p.meta), p.usa_meta_automatica ? 'custos em euro + 3 meses de despesas' : 'definida por você'),
    k('Já comprados', eur(p.comprados), p.preco_medio ? `preço médio R$ ${nf(4).format(p.preco_medio)}` : 'nenhuma compra ainda'),
    k('Por mês até a mudança', p.meses ? eur(p.porMes) : '—', p.meses ? `${p.meses} ${p.meses === 1 ? 'mês' : 'meses'}; faltam ${eur(p.faltam)}` : 'a mudança já chegou'),
    k('Em reais por mês, hoje', p.reaisMes ? brl(p.reaisMes) : '—', p.custo_por_euro_hoje ? `R$ ${nf(4).format(p.custo_por_euro_hoje)} por euro com IOF e tarifa` : 'atualize o mercado'),
  ].join('');
  $('#peBar').style.width = `${Math.round(p.progresso * 100)}%`;
  $('#peNota').textContent = p.custo_por_euro_hoje && p.custo_por_euro_hoje > p.cambio_do_cenario * 1.03
    ? `O euro de hoje com custos (R$ ${nf(2).format(p.custo_por_euro_hoje)}) está acima do câmbio do cenário (R$ ${nf(2).format(p.cambio_do_cenario)}). Comprar aos poucos reduz o risco de pegar o pior momento.`
    : 'Comprar a mesma quantia todo mês dilui o risco do câmbio. Registre cada compra acima para acompanhar o preço médio.';
}
$('#peMeta').addEventListener('change', (e) => { state.config.metaEuros = num(e.target.value) || null; save(); renderPlanoEuros(); });

$('#cpAdd').addEventListener('click', () => {
  state.comprasEuro.push({ id: nid('c'), data: new Date().toISOString().slice(0, 10), euros: 1000, reais: Math.round(1000 * num((state.mercado.eur && state.mercado.eur.bid) || state.cenarios.base.cambio) * 1.044) });
  save(); renderCompras(); refresh();
});
bindLista('#tblCompras', () => state.comprasEuro);

V.mercado = { build() { renderMercado(); }, update() { renderMercado(); } };

// atualização automática ao abrir
(function autoStart() {
  const m = state.mercado;
  const velho = !m.atualizadoEm || Date.now() - m.atualizadoEm > AUTO_MIN * 60000;
  if (state.config.autoMercado && velho) setTimeout(() => atualizarMercado({ silencioso: true }), 600);
  verificarAlerta();
  refresh();
})();

window.__market = { Parse, api, atualizarMercado, aaParaAm };
