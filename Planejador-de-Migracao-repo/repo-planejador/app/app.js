'use strict';

/* =========================================================
   Núcleo da interface: estado, navegação, tabelas principais,
   painel e dados. As outras abas ficam em views.js e market.js.
   ========================================================= */

/* ---------- estado e persistência ---------- */
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* usa os valores iniciais */ }
  return seed();
}
let state = load();
let saveTimer = null;
const aoSalvar = []; // ganchos (ex.: backup automático)
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      const el = $('#saved');
      el.textContent = 'Salvo agora';
      el.classList.add('flash');
      setTimeout(() => { el.textContent = 'Salvo neste computador'; el.classList.remove('flash'); }, 1400);
      aoSalvar.forEach((f) => { try { f(); } catch (e) { /* ok */ } });
    } catch (e) {
      toast('Não foi possível salvar. Exporte um arquivo .json na aba Dados.');
    }
  }, 350);
}
function copiaSemSegredos() {
  const c = JSON.parse(JSON.stringify(state));
  if (c.config) for (const k of ['brapiToken', 'travelpayoutsToken', 'serpapiKey', 'ignavKey']) c.config[k] = '';
  delete c.assistente; // conversas com o assistente ficam só neste computador
  return c;
}

/* ---------- formatação ---------- */
const nf = (dec) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtSinal = (pref, v, dec) => {
  const r = Math.round(v * 10 ** dec) / 10 ** dec;
  return (r < 0 ? `−${pref} ` : `${pref} `) + nf(dec).format(Math.abs(r));
};
const eur = (v, dec = 0) => fmtSinal('€', v, dec);
const brl = (v, dec = 0) => fmtSinal('R$', v, dec);
const pct = (v, dec = 1) => `${nf(dec).format(v * 100)}%`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2800);
}
function confirmar(msg, ok = 'Confirmar') {
  return new Promise((res) => {
    const dlg = $('#confirmDlg');
    $('#confirmMsg').textContent = msg;
    $('#confirmOk').textContent = ok;
    dlg.returnValue = '';
    dlg.onclose = () => res(dlg.returnValue === 'ok');
    dlg.showModal();
  });
}
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const cidadeNome = () => cidadeDe(state).nome;

/* ---------- campos ---------- */
function inp(field, v, opts = {}) {
  const { type = 'number', step = '0.01', pctField = false, cls = '', nullable = false, disabled = false, placeholder = '', min } = opts;
  const dis = disabled ? 'disabled' : '';
  if (type === 'text') return `<input class="${cls}" data-f="${field}" type="text" value="${esc(v)}" ${dis} placeholder="${esc(placeholder)}">`;
  if (type === 'month') return `<input class="${cls}" data-f="${field}" type="month" value="${esc(v)}" ${dis}>`;
  if (type === 'date') return `<input class="${cls}" data-f="${field}" type="date" value="${esc(v)}" ${dis}>`;
  const shown = nulo(v) ? '' : pctField ? +(num(v) * 100).toFixed(4) : v;
  return `<input class="${cls}" data-f="${field}" ${pctField ? 'data-pct="1"' : ''} ${nullable ? 'data-null="1"' : ''} type="number" step="${step}" ${min !== undefined ? `min="${min}"` : ''} value="${shown}" ${dis} placeholder="${esc(placeholder)}">`;
}
function sel(field, v, options, cls = '') {
  return `<select class="${cls}" data-f="${field}">${Object.entries(options).map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}
const sw = (field, on, label) => `<label class="switch" title="${esc(label)}"><input type="checkbox" data-f="${field}" ${on ? 'checked' : ''} aria-label="${esc(label)}"><span></span></label>`;
const delBtn = `<button class="icon-btn" data-del title="Remover" aria-label="Remover"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>`;
const MOEDAS = { BRL: 'R$', EUR: '€' };
const adultosOpts = () => ({ '': '—', ...Object.fromEntries(state.familia.pessoas.filter((p) => p.tipo !== 'crianca').map((p) => [p.id, p.nome || 'Adulto'])) });

/* edição em linha genérica: atualiza o estado sem redesenhar (a não ser quando a estrutura muda) */
function lerCampo(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') {
    if (el.dataset.null && el.value.trim() === '') return null;
    const v = num(el.value);
    return el.dataset.pct ? v / 100 : v;
  }
  return el.value;
}
function bindLista(tabela, getLista, opts = {}) {
  const t = typeof tabela === 'string' ? $(tabela) : tabela;
  const { reconstruir = [], onChange, nomeItem = 'item' } = opts;
  const handler = (e) => {
    const el = e.target.closest('[data-f]');
    if (!el || !t.contains(el)) return;
    const tr = el.closest('[data-id]');
    if (!tr) return;
    const item = getLista().find((x) => x.id === tr.dataset.id);
    if (!item) return;
    const f = el.dataset.f;
    item[f] = lerCampo(el);
    if (f === 'ativo') tr.classList.toggle('off', !item[f]);
    if (onChange) onChange(item, f, e);
    save();
    if (e.type === 'change' && reconstruir.includes(f)) construirVista();
    refresh();
  };
  t.addEventListener('input', (e) => { if (e.target.tagName !== 'SELECT' && e.target.type !== 'checkbox') handler(e); });
  t.addEventListener('change', handler);
  t.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b || !t.contains(b)) return;
    const tr = b.closest('[data-id]');
    const lista = getLista();
    const item = lista.find((x) => x.id === tr.dataset.id);
    if (!(await confirmar(`Remover “${item?.nome || item?.titulo || nomeItem}”?`, 'Remover'))) return;
    const i = lista.findIndex((x) => x.id === tr.dataset.id);
    if (i >= 0) lista.splice(i, 1);
    if (opts.onDelete) opts.onDelete(item);
    save();
    construirVista();
    refresh();
    toast('Removido');
  });
}

/* ---------- navegação ---------- */
const V = {}; // vistas: { build(), update(all) }
const TITLES = {
  painel: ['Painel', 'Quanto chega, quanto sai e quanto sobra por mês'],
  plano: ['Linha do tempo', 'Do dia de hoje até três anos depois da mudança'],
  rendas: ['Rendas', 'Salários, aluguéis e benefícios'],
  investimentos: ['Investimentos', 'Capital aplicado e o rendimento que entra no orçamento'],
  despesas: ['Despesas', 'O custo de vida mensal em Portugal'],
  impostos: ['Impostos', 'Estimativa do IRS em Portugal com o crédito do que já é pago no Brasil'],
  familia: ['Família', 'Quem vai, e o que isso muda em casa, custos e visto'],
  cidades: ['Cidades', 'Custo de vida embutido e comparação entre cidades'],
  mudanca: ['Custos da mudança', 'O que precisa ser pago antes e logo depois de chegar'],
  vistos: ['Vistos', 'Qual caminho de visto serve para vocês, com requisitos, custos e prazos'],
  viagem: ['Viagem', 'Passagens, bagagem, chegada, clima e feriados'],
  vagas: ['Vagas', 'Vagas em Portugal: quanto sobra com cada uma e que visto ela abre'],
  checklist: ['Checklist', 'Documentos, visto e primeiros passos, com prazos'],
  acompanhamento: ['Acompanhamento', 'O planejado comparado com o que aconteceu de verdade'],
  mercado: ['Mercado', 'Euro, juros e expectativas atualizados da internet'],
  cenarios: ['Cenários', 'Câmbio, juros e premissas de cada cenário'],
  dados: ['Dados', 'Relatório, backup, importação e recomeço'],
  vasco: ['Vasco', 'Resumo da semana, regras vigiadas, decisões e documentos'],
  sistema: ['Sistema', 'Google Drive, atualizações, avisos do Windows e diagnóstico'],
};
let viewAtual = 'painel';
function construirVista() { if (V[viewAtual] && V[viewAtual].build) V[viewAtual].build(); }
function go(view) {
  if (!TITLES[view]) view = 'painel';
  viewAtual = view;
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  $('#viewTitle').textContent = TITLES[view][0];
  $('#viewSub').textContent = TITLES[view][1];
  $('main').scrollTop = 0;
  construirVista();
  refresh();
}
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) go(b.dataset.view);
});

function renderTopo() {
  $('#scenarioSeg').innerHTML = SC.map((k) =>
    `<button role="tab" aria-selected="${k === state.cenarioAtivo}" class="${k === state.cenarioAtivo ? 'on' : ''}" data-sc="${k}">${SC_LABEL[k]}</button>`).join('');
  $('#citySel').innerHTML = todasCidades(state).map((c) => `<option value="${esc(c.id)}" ${c.id === state.cidade ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
  $('#brandSub').textContent = `Brasil → ${cidadeNome()}`;
}
$('#scenarioSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.cenarioAtivo = b.dataset.sc;
  save(); renderTopo(); construirVista(); refresh();
});
$('#citySel').addEventListener('change', (e) => {
  state.cidade = e.target.value;
  save(); renderTopo(); construirVista(); refresh();
  toast(`Custos de ${cidadeNome()} aplicados`);
});

/* ---------- gráficos ---------- */
const charts = {};
const CAT_COLORS = () => [cssVar('--azulejo'), '#5B86C8', '#9DB8E0', cssVar('--ocre'), cssVar('--musgo'), cssVar('--dao'), '#7B6CA8', '#8A97A6'];
const SC_COLORS = () => ({ base: cssVar('--azulejo'), conservador: cssVar('--ocre'), estresse: cssVar('--dao') });
function baseOpts(extra = {}) {
  const ink = cssVar('--muted'), line = cssVar('--line');
  return {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.__semAnimacao ? 0 : 450 },
    plugins: {
      legend: { labels: { color: ink, boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 12 } } },
      tooltip: { backgroundColor: cssVar('--ink'), titleColor: cssVar('--granito'), bodyColor: cssVar('--granito'), padding: 10, cornerRadius: 6 },
    },
    scales: {
      x: { ticks: { color: ink, font: { size: 11.5 } }, grid: { display: false }, border: { color: line } },
      y: { ticks: { color: ink, font: { size: 11.5 } }, grid: { color: line }, border: { display: false } },
    },
    ...extra,
  };
}
const yEur = (o = {}) => ({ ...baseOpts().scales.y, ...o, ticks: { ...baseOpts().scales.y.ticks, callback: (v) => eur(v) } });
const tooltipFmt = (fmt) => ({ ...baseOpts().plugins.tooltip, callbacks: { label: (c) => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${fmt(c.raw)}` } });
// linha vertical marcando um índice do eixo x (ex.: mês da mudança)
const marcaX = {
  id: 'marcaX',
  afterDatasetsDraw(ch, _a, o) {
    if (o === undefined || o.index === undefined || o.index === null) return;
    const x = ch.scales.x.getPixelForValue(o.index);
    const { top, bottom } = ch.chartArea;
    const c = ch.ctx;
    c.save();
    c.strokeStyle = o.color || '#888';
    c.setLineDash([4, 4]);
    c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
    c.setLineDash([]);
    c.fillStyle = o.color || '#888';
    c.font = '600 11px "Segoe UI", system-ui, sans-serif';
    c.fillText(o.label || '', x + 5, top + 12);
    c.restore();
  },
};
function chart(id, type, data, options, plugins) {
  const cv = document.getElementById(id);
  if (!cv || typeof Chart === 'undefined') return null;
  if (charts[id]) {
    charts[id].data = data;
    charts[id].options = options;
    charts[id].update();
  } else {
    charts[id] = new Chart(cv, { type, data, options, plugins: plugins || [] });
  }
  return charts[id];
}
function resetCharts() { for (const k of Object.keys(charts)) { charts[k].destroy(); delete charts[k]; } }

/* série de patrimônio (antes + depois) para os três cenários */
function serieTimeline(all) {
  const b = all.base.sim;
  const labels = [...b.pre.map((p) => mesLabel(p.cal)), ...b.pos.map((p) => mesLabel(p.cal))];
  const datasets = SC.map((k) => {
    const s = all[k].sim;
    return {
      label: SC_LABEL[k],
      data: [...s.pre.map((p) => p.patrimonioEUR), ...s.pos.map((p) => p.patrimonioEUR)],
      borderColor: SC_COLORS()[k], backgroundColor: SC_COLORS()[k],
      borderWidth: k === state.cenarioAtivo ? 3 : 1.5, pointRadius: 0, tension: 0.15,
    };
  });
  return { labels, datasets, idxMudanca: b.pre.length };
}
function optsTimeline(idx) {
  return baseOpts({
    interaction: { mode: 'index', intersect: false },
    plugins: {
      ...baseOpts().plugins,
      legend: { ...baseOpts().plugins.legend, position: 'bottom' },
      tooltip: { ...tooltipFmt((v) => eur(v)), callbacks: { label: (c) => ` ${c.dataset.label}: ${eur(c.raw)}` } },
      marcaX: { index: idx, label: 'Mudança', color: cssVar('--muted') },
    },
    scales: {
      x: { ...baseOpts().scales.x, ticks: { ...baseOpts().scales.x.ticks, autoSkip: true, maxTicksLimit: 10, maxRotation: 0 } },
      y: { ...baseOpts().scales.y, ticks: { ...baseOpts().scales.y.ticks, callback: (v) => eur(v / 1000) + ' mil' } },
    },
  });
}

/* ---------- RENDAS ---------- */
V.rendas = {
  build() {
    const outras = (r) => ({ '': 'Nenhuma', ...Object.fromEntries(state.rendas.filter((o) => o.id !== r.id && o.tipo !== 'trabalho_pt').map((o) => [o.id, o.nome])) });
    const det = (r) => {
      if (r.tipo === 'trabalho') return `<label class="mini">${sw('clt', r.clt, 'Recebe 13º e férias (CLT)')} 13º e férias</label>`;
      if (r.tipo === 'trabalho_pt') return `<div class="mini-grid"><span>Pagamentos</span>${sel('pagamentos', String(r.pagamentos || 14), { 12: '12 por ano', 14: '14 por ano' })}<span>Substitui</span>${sel('substitui', r.substitui || '', outras(r))}<span title="20% de IRS por 10 anos; veja a aba Vagas">IFICI</span><label class="mini">${sw('ifici', !!r.ifici, 'IFICI: 20% de IRS')} 20%</label></div>`;
      return '<span class="muted">—</span>';
    };
    const rows = state.rendas.map((r) => `
      <tr data-id="${r.id}" class="${r.ativo ? '' : 'off'}">
        <td class="c-toggle">${sw('ativo', r.ativo, 'Considerar esta renda')}</td>
        <td>${inp('nome', r.nome, { type: 'text', cls: 'w-name' })}</td>
        <td>${sel('tipo', r.tipo, TIPOS)}</td>
        <td>${r.tipo === 'passiva' ? '<span class="muted">—</span>' : sel('pessoa', r.pessoa || '', adultosOpts())}</td>
        <td>${sel('moeda', r.moeda, MOEDAS)}</td>
        <td>${inp('valor', r.valor)}</td>
        <td>${r.moeda === 'EUR' ? '<span class="muted">—</span>' : inp('impostoBR', r.impostoBR, { pctField: true, step: '0.5' })}</td>
        <td>${det(r)}</td>
        <td>${inp('inicio', r.inicio, { nullable: true, step: '1', placeholder: 'já', cls: 'w-mes' })}</td>
        <td>${inp('fim', r.fim, { nullable: true, step: '1', placeholder: '—', cls: 'w-mes' })}</td>
        <td>${sel('status', r.status, { 'confirmada': 'Confirmada', 'a confirmar': 'A confirmar' })}</td>
        <td>${inp('nota', r.nota, { type: 'text', cls: 'w-note' })}</td>
        <td class="num out" data-out="eur"></td>
        <td class="c-del">${delBtn}</td>
      </tr>`).join('');
    $('#tblRendas').innerHTML = `<thead><tr><th></th><th>Renda</th><th>Tipo</th><th>De quem</th><th>Moeda</th><th class="num">Bruto/mês</th><th class="num">IR no Brasil %</th><th>Detalhes</th><th class="num">Começa</th><th class="num">Termina</th><th>Situação</th><th>Observação</th><th class="num">Chega em €</th><th></th></tr></thead><tbody>${rows}</tbody>`;
  },
  update(all) {
    const r = all[state.cenarioAtivo];
    const ref = num(state.plano.mesReferencia);
    for (const it of r.tip.rend) {
      const td = $(`#tblRendas tr[data-id="${it.id}"] [data-out="eur"]`);
      if (!td) continue;
      td.innerHTML = !it.ativo ? '<span class="muted">desligada</span>'
        : it.ativa ? eur(it.eur)
        : `<span class="pill warn" title="Fora do cenário, ainda não começou, já terminou ou foi substituída">fora no mês ${ref}</span>`;
    }
    const tot = r.tip.rend.reduce((s, x) => s + (x.ativa ? x.eur : 0), 0);
    $('#rendasTotal').innerHTML = `Chega em Portugal no mês ${ref} do cenário ${SC_LABEL[state.cenarioAtivo]}<b>${eur(tot)}/mês</b>`;
  },
};
bindLista('#tblRendas', () => state.rendas, {
  reconstruir: ['tipo', 'moeda'],
  onChange: (item, f) => {
    if (f === 'tipo') {
      if (item.tipo === 'trabalho_pt') { item.moeda = 'EUR'; item.pagamentos = 14; item.impostoBR = 0; }
      if (item.tipo === 'passiva') { item.pessoa = ''; }
    }
    if (f === 'pagamentos') item.pagamentos = +item.pagamentos;
  },
});

/* ---------- INVESTIMENTOS ---------- */
V.investimentos = {
  build() {
    const rows = state.investimentos.map((i) => `
      <tr data-id="${i.id}">
        <td>${inp('nome', i.nome, { type: 'text', cls: 'w-name' })}</td>
        <td>${inp('capital', i.capital, { step: '100' })}</td>
        <td>${sel('idx', i.idx, IDX)}</td>
        <td>${i.idx === 'fii' ? '<span class="muted small">taxa do cenário</span>' : inp('param', i.param, { pctField: true, step: i.idx === 'cdi' ? '1' : '0.01' })}</td>
        <td>${inp('impostoBR', i.impostoBR, { pctField: true, step: '0.5' })}</td>
        <td>${inp('irResidente', i.irResidente, { pctField: true, step: '0.5' })}</td>
        <td class="num out" data-out="cap"></td>
        <td class="num out" data-out="liq"></td>
        <td class="num out" data-out="eur"></td>
        <td class="c-del">${delBtn}</td>
      </tr>`).join('');
    $('#tblInv').innerHTML = `<thead><tr><th>Investimento</th><th class="num">Capital (R$)</th><th>Rende por</th><th class="num">% do CDI / taxa a.m.</th><th class="num">IR no Brasil (não residente)</th><th class="num">IR enquanto no Brasil</th><th class="num">Capital após a mudança</th><th class="num">Rende líquido/mês</th><th class="num">Chega em €</th><th></th></tr></thead><tbody>${rows}</tbody>`;
    $('#custosDosInvest').checked = !!state.custosDosInvest;
  },
  update(all) {
    const r = all[state.cenarioAtivo];
    r.tip.inv.forEach((x) => {
      const tr = $(`#tblInv tr[data-id="${x.id}"]`);
      if (!tr) return;
      tr.querySelector('[data-out="cap"]').textContent = brl(x.cap);
      tr.querySelector('[data-out="liq"]').textContent = brl(x.brutoMes - x.brTaxMes);
      tr.querySelector('[data-out="eur"]').textContent = eur(x.eur);
    });
    const capT = state.investimentos.reduce((s, i) => s + num(i.capital), 0);
    const base = state.plano.capitalBase === 'hoje' ? 'hoje' : 'na data da mudança';
    $('#invTotal').innerHTML = `Capital ${base} ${brl(capT)}; rendimento que chega<b>${eur(r.tip.inv.reduce((s, x) => s + x.eur, 0))}/mês</b>`;
  },
};
bindLista('#tblInv', () => state.investimentos, {
  reconstruir: ['idx'],
  onChange: (item, f) => { if (f === 'idx') item.param = item.idx === 'cdi' ? 1 : item.idx === 'fixa' ? 0.008 : 0; },
});
$('#custosDosInvest').addEventListener('change', (e) => { state.custosDosInvest = e.target.checked; save(); refresh(); });

/* ---------- DESPESAS ---------- */
V.despesas = {
  build() {
    const rows = state.despesas.map((d) => `
      <tr data-id="${d.id}" class="${d.ativo ? '' : 'off'}">
        <td class="c-toggle">${sw('ativo', d.ativo, 'Considerar esta despesa')}</td>
        <td>${inp('nome', d.nome, { type: 'text', cls: 'w-name' })}</td>
        <td>${sel('cat', d.cat, Object.fromEntries(CATS.map((c) => [c, c])))}</td>
        <td>${sel('auto', d.auto || '', AUTO)}</td>
        <td>${d.auto ? '<span class="muted">€</span>' : sel('moeda', d.moeda, MOEDAS)}</td>
        <td data-cell="valor">${inp('valor', d.valor, { disabled: !!d.auto })}</td>
        <td>${inp('nota', d.nota, { type: 'text', cls: 'w-note' })}</td>
        <td class="num out" data-out="eur"></td>
        <td class="c-del">${delBtn}</td>
      </tr>`).join('');
    $('#tblDesp').innerHTML = `<thead><tr><th></th><th>Despesa</th><th>Categoria</th><th>Origem do valor</th><th>Moeda</th><th class="num">Valor/mês</th><th>Observação</th><th class="num">No cenário (€)</th><th></th></tr></thead><tbody>${rows}</tbody>`;
  },
  update(all) {
    const r = all[state.cenarioAtivo];
    for (const d of r.sim.desp.items) {
      const tr = $(`#tblDesp tr[data-id="${d.id}"]`);
      if (!tr) continue;
      tr.querySelector('[data-out="eur"]').innerHTML = d.ativo ? eur(d.eur) : '<span class="muted">desligada</span>';
      if (d.auto && d.valorAuto !== null) {
        const i = tr.querySelector('[data-f="valor"]');
        if (i) i.value = Math.round(d.valorAuto * 100) / 100;
      }
    }
    $('#despTotal').innerHTML = `Total em ${esc(cidadeNome())} no cenário ${SC_LABEL[state.cenarioAtivo]}<b>${eur(r.despesas)}/mês</b>`;
    const cats = Object.entries(r.sim.desp.porCat).sort((a, b) => b[1] - a[1]);
    chart('chCat', 'bar', {
      labels: cats.map((c) => c[0]),
      datasets: [{ data: cats.map((c) => c[1]), backgroundColor: CAT_COLORS(), borderRadius: 4, barPercentage: 0.7 }],
    }, baseOpts({
      indexAxis: 'y',
      plugins: { ...baseOpts().plugins, legend: { display: false }, tooltip: tooltipFmt((v) => eur(v)) },
      scales: { x: yEur(), y: { ...baseOpts().scales.x } },
    }));
  },
};
bindLista('#tblDesp', () => state.despesas, {
  reconstruir: ['auto'],
  onChange: (item, f) => {
    if (f === 'auto' && !item.auto) {
      // ao voltar para manual, guarda o último valor automático
      const r = despesasCalc(state, state.cenarioAtivo).items.find((x) => x.id === item.id);
      item.moeda = 'EUR';
      if (r) item.valor = Math.round((r.eur / (1 + num(state.cenarios[state.cenarioAtivo].ajusteDesp))) * 100) / 100;
    }
  },
});

/* ---------- CUSTOS DA MUDANÇA ---------- */
V.mudanca = {
  build() {
    const rows = state.entrada.map((e) => `
      <tr data-id="${e.id}">
        <td>${inp('nome', e.nome, { type: 'text', cls: 'w-name' })}</td>
        <td>${sel('moeda', e.moeda, MOEDAS)}</td>
        <td>${inp('valor', e.valor, { step: '10' })}</td>
        <td><label class="mini">${sw('porPessoa', e.porPessoa, 'Multiplicar pelo número de pessoas')} por pessoa</label></td>
        <td>${inp('nota', e.nota, { type: 'text', cls: 'w-note' })}</td>
        <td class="num out" data-out="brl"></td>
        <td class="c-del">${delBtn}</td>
      </tr>`).join('');
    $('#tblEnt').innerHTML = `<thead><tr><th>Custo</th><th>Moeda</th><th class="num">Valor</th><th>Quantidade</th><th>Observação</th><th class="num">Em reais (com remessa)</th><th></th></tr></thead>
      <tbody>${rows}<tr class="calc"><td colspan="5" id="aluguelAdiantRow"></td><td class="num out" id="aluguelAdiantOut"></td><td></td></tr></tbody>`;
  },
  update(all) {
    const r = all[state.cenarioAtivo];
    const ent = r.sim.ent;
    for (const e of ent.items) {
      const td = $(`#tblEnt tr[data-id="${e.id}"] [data-out="brl"]`);
      if (td) td.innerHTML = brl(e.brl) + (e.porPessoa ? ` <span class="muted small">(${e.qtd}×)</span>` : '');
    }
    const ar = $('#aluguelAdiantRow');
    if (ar) {
      ar.textContent = `Aluguel adiantado e caução: ${num(r.tip.sc.mesesAluguel)} meses × ${eur(r.sim.desp.moradia)} de moradia = ${eur(ent.aluguelAdiantadoEUR)} (mude os meses na aba Cenários)`;
      $('#aluguelAdiantOut').textContent = brl(ent.aluguelAdiantadoBRL);
    }
    const eurc = r.sim.usarEur > 0 ? ` (com ${eur(r.sim.usarEur)} já comprados)` : '';
    $('#entTotal').innerHTML = `Total para ${r.fam.P} ${r.fam.P === 1 ? 'pessoa' : 'pessoas'} em ${esc(cidadeNome())}${eurc}<b>${brl(r.entradaBRL)}</b>`;
    chart('chEnt', 'bar', {
      labels: SC.map((k) => SC_LABEL[k]),
      datasets: [
        { label: 'Aluguel adiantado', data: SC.map((k) => all[k].sim.ent.aluguelAdiantadoBRL), backgroundColor: cssVar('--ocre'), borderRadius: 4 },
        { label: 'Demais custos', data: SC.map((k) => all[k].entradaBRL - all[k].sim.ent.aluguelAdiantadoBRL), backgroundColor: cssVar('--azulejo'), borderRadius: 4 },
      ],
    }, baseOpts({
      indexAxis: 'y',
      plugins: { ...baseOpts().plugins, legend: { ...baseOpts().plugins.legend, position: 'bottom' }, tooltip: tooltipFmt((v) => brl(v)) },
      scales: { x: { ...baseOpts().scales.y, stacked: true, ticks: { ...baseOpts().scales.y.ticks, callback: (v) => brl(v) } }, y: { ...baseOpts().scales.x, stacked: true } },
    }));
  },
};
bindLista('#tblEnt', () => state.entrada);

/* ---------- CENÁRIOS ---------- */
const PARAMS = [
  ['cambio', 'Câmbio (R$ por €)', 'Cotação comercial; a Wise usa essa taxa', { step: '0.01' }],
  ['iof', 'IOF na remessa (%)', '3,5% para conta própria em 2026', { pctField: true, step: '0.1' }],
  ['tarifa', 'Tarifa da plataforma (%)', 'Wise ≈ 0,85%', { pctField: true, step: '0.05' }],
  ['cdi', 'CDI ao mês (%)', '0,95% ≈ 12% ao ano', { pctField: true, step: '0.01' }],
  ['fii', 'Rendimento dos FIIs ao mês (%)', '', { pctField: true, step: '0.01' }],
  ['contarIncertas', 'Contar rendas a confirmar', 'Ex.: benefícios, emprego em Portugal', { toggle: true }],
  ['varTrabalho', 'Variação dos salários (%)', 'Negativo = salário menor', { pctField: true, step: '1' }],
  ['ajusteDesp', 'Ajuste das despesas (%)', 'Inverno, inflação, imprevistos', { pctField: true, step: '1' }],
  ['mesesAluguel', 'Meses de aluguel pagos na entrada', 'Adiantamento + caução', { step: '1' }],
];
V.cenarios = {
  build() {
    const head = `<thead><tr><th>Premissa</th>${SC.map((k) => `<th class="sc ${k === state.cenarioAtivo ? 'on' : ''}">${SC_LABEL[k]}</th>`).join('')}</tr></thead>`;
    const body = PARAMS.map(([f, label, desc, o]) => `<tr><td>${label}${desc ? `<span class="desc">${desc}</span>` : ''}</td>${SC.map((k) => {
      const v = state.cenarios[k][f];
      return `<td class="sc-cell ${k === state.cenarioAtivo ? 'on' : ''}" data-sc="${k}" style="text-align:center">${o.toggle ? sw(f, v, label) : inp(f, v, o)}</td>`;
    }).join('')}</tr>`).join('');
    $('#tblScen').innerHTML = head + `<tbody>${body}</tbody>`;
    const m = state.metas;
    $('#metasForm').innerHTML = `
      <label>Poupança mensal desejada (€)<small>Quanto vocês querem guardar por mês</small></label>${inp('poupanca', m.poupanca, { step: '10' })}
      <label>Salário mínimo em Portugal (€)<small>€ 970 em 2027; € 1.020 previsto para 2028</small></label>${inp('salarioMinimo', m.salarioMinimo, { step: '10' })}`;
  },
  update() {},
};
function onScen(e) {
  const el = e.target.closest('[data-f]');
  if (!el) return;
  const k = el.closest('td').dataset.sc;
  state.cenarios[k][el.dataset.f] = lerCampo(el);
  save(); refresh();
}
$('#tblScen').addEventListener('input', onScen);
$('#tblScen').addEventListener('change', onScen);
$('#metasForm').addEventListener('input', (e) => {
  const el = e.target.closest('[data-f]');
  if (!el) return;
  state.metas[el.dataset.f] = num(el.value);
  save(); refresh();
});

/* ---------- adicionar itens ---------- */
const NOVOS = {
  rendas: () => ({ id: nid('r'), ativo: true, nome: 'Nova renda', tipo: 'outra', pessoa: '', moeda: 'BRL', valor: 0, impostoBR: 0, clt: false, pagamentos: 12, inicio: null, fim: null, substitui: '', status: 'confirmada', nota: '' }),
  investimentos: () => ({ id: nid('i'), nome: 'Novo investimento', capital: 0, idx: 'cdi', param: 1, impostoBR: 0.15, irResidente: 0.175, nota: '' }),
  despesas: () => ({ id: nid('d'), ativo: true, nome: 'Nova despesa', cat: 'Outros', moeda: 'EUR', valor: 0, auto: '', nota: '' }),
  entrada: () => ({ id: nid('e'), nome: 'Novo custo', moeda: 'EUR', valor: 0, porPessoa: false, nota: '' }),
  eventos: () => ({ id: nid('v'), ativo: true, nome: 'Novo evento', tipo: 'saida', moeda: 'EUR', valor: 0, porPessoa: false, quando: 0, repetir: 'nao', mesAno: 1, nota: '' }),
  tarefas: () => ({ id: nid('t'), grupo: 'Mudança', titulo: 'Nova tarefa', quando: -1, status: 'pendente', nota: '' }),
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-add]');
  if (!b) return;
  const key = b.dataset.add;
  state[key].push(NOVOS[key]());
  save();
  construirVista();
  refresh();
  const campo = $$(`#view-${viewAtual} [data-id="${state[key][state[key].length - 1].id}"] [data-f="nome"], #view-${viewAtual} [data-id="${state[key][state[key].length - 1].id}"] [data-f="titulo"]`)[0];
  if (campo) { campo.focus(); campo.select(); }
});

/* ---------- PAINEL ---------- */
function alavancas(r) {
  const k = state.cenarioAtivo;
  const out = [];
  const com = (mut) => { const st = JSON.parse(JSON.stringify(state)); mut(st); return resumo(st, k).sobra - r.sobra; };
  for (const ri of r.tip.rend) {
    if (!ri.ativo) {
      out.push([`Se incluir “${ri.nome}”`, com((st) => { const x = st.rendas.find((y) => y.id === ri.id); x.ativo = true; x.status = 'confirmada'; })]);
    } else if (ri.status === 'a confirmar') {
      out.push([ri.ativa ? `Se “${ri.nome}” não se confirmar` : `Se “${ri.nome}” se confirmar`,
        com((st) => { const x = st.rendas.find((y) => y.id === ri.id); if (ri.ativa) x.ativo = false; else x.status = 'confirmada'; })]);
    } else if (ri.tipo === 'trabalho' && !ri.clt) {
      out.push([`Se “${ri.nome}” tiver 13º e férias`, com((st) => { st.rendas.find((y) => y.id === ri.id).clt = true; })]);
    }
  }
  out.push(['Câmbio R$ 0,30 mais baixo', com((st) => { st.cenarios[k].cambio -= 0.3; })]);
  out.push(['Câmbio R$ 0,30 mais alto', com((st) => { st.cenarios[k].cambio += 0.3; })]);
  if (r.sim.desp.moradia > 0) out.push(['Aluguel € 100 mais barato', com((st) => {
    const d = st.despesas.find((x) => x.ativo && x.cat === 'Moradia');
    if (!d) return;
    if (d.auto) { const v = despesasCalc(st, k).items.find((x) => x.id === d.id).valorAuto; d.auto = ''; d.moeda = 'EUR'; d.valor = v - 100; }
    else d.valor = num(d.valor) - (d.moeda === 'BRL' ? 100 * st.cenarios[k].cambio : 100);
  })]);
  return out.filter(([, v]) => Math.abs(v) >= 1).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
}

V.painel = {
  update(all) {
    const r = all[state.cenarioAtivo];
    const nome = SC_LABEL[state.cenarioAtivo];
    const meta = num(state.metas.poupanca);
    const ref = num(state.plano.mesReferencia);
    const heroNum = $('#heroNum');
    if (r.sobra >= 0) {
      $('#heroLead').textContent = `No cenário ${nome}, em ${cidadeNome()}, depois de impostos, remessa e despesas, sobram`;
      heroNum.textContent = eur(r.sobra);
      heroNum.classList.remove('neg');
      $('#heroFoot').textContent = r.aposMeta >= 0
        ? `por mês. Dá para guardar os ${eur(meta)} da meta e ainda ficam ${eur(r.aposMeta)}.`
        : `por mês. Para guardar os ${eur(meta)} da meta faltam ${eur(-r.aposMeta)}.`;
    } else {
      $('#heroLead').textContent = `No cenário ${nome}, em ${cidadeNome()}, as despesas passam do que chega em`;
      heroNum.textContent = eur(-r.sobra);
      heroNum.classList.add('neg');
      const anos = r.reservaEUR / -r.sobra / 12;
      $('#heroFoot').textContent = `por mês. A reserva cobre essa diferença por cerca de ${nf(1).format(anos)} anos.`;
    }

    const kpi = (label, val, note, cls = '') => `<div class="kpi"><div class="k-label">${label}</div><div class="k-val ${cls}">${val}</div><div class="k-note">${note}</div></div>`;
    const menor = r.sim.menor;
    $('#kpis').innerHTML = [
      kpi('Chega em Portugal', eur(r.receitas), `de ${eur(r.tip.brutoEq)} brutos por mês`),
      kpi('Despesas', eur(r.despesas), `${r.fam.P} ${r.fam.P === 1 ? 'pessoa' : 'pessoas'}, casa ${r.fam.tip.toUpperCase()}`),
      kpi('Depois da meta', eur(r.aposMeta), `guardando ${eur(meta)} por mês`, r.aposMeta >= 0 ? 'pos' : 'neg'),
      kpi('Custo da mudança', brl(r.entradaBRL), 'documentos, viagem e entrada'),
      kpi('Patrimônio na mudança', brl(r.sim.patrimonioMudancaBRL), `≈ ${eur(r.reservaEUR)} depois dos custos`),
      kpi('Mês mais apertado', eur(menor.saldo), menor.cal ? `${mesLabel(menor.cal)}, com eventos e IRS` : '', menor.saldo >= 0 ? 'pos' : 'neg'),
    ].join('');

    $('#d7Ref').textContent = `${r.fam.A} ${r.fam.A === 1 ? 'adulto' : 'adultos'}${r.fam.C ? ` e ${r.fam.C} ${r.fam.C === 1 ? 'criança' : 'crianças'}` : ''}, salário mínimo de ${eur(num(state.metas.salarioMinimo))}`;
    const meter = (label, val, alvo, nota) => {
      const ok = val >= alvo;
      const max = Math.max(alvo * 1.25, val);
      const w = max > 0 ? Math.min(100, (val / max) * 100) : 0;
      const g = max > 0 ? (alvo / max) * 100 : 0;
      return `<div class="meter"><div class="meter-top"><span>${label}</span><span><b class="${ok ? 'pos' : 'neg'}">${eur(val)}</b> <span class="muted">de ${eur(alvo)}</span></span></div>
        <div class="bar"><i style="width:${w}%;background:${ok ? 'var(--musgo)' : 'var(--dao)'}"></i><span class="goal" style="left:${g}%"></span></div><p>${nota(ok, alvo ? val / alvo : 0)}</p></div>`;
    };
    $('#meters').innerHTML =
      meter('Reserva para 12 meses', r.reservaEUR, r.d7Exig, (ok, x) => ok ? `Cobre ${nf(1).format(x)} vezes a exigência de 12 meses. Sem nenhum salário, pagaria tudo por ${nf(0).format(r.folego)} meses.` : 'Abaixo da exigência de 12 meses de meios de subsistência.') +
      meter('Renda passiva por mês', r.passiva, r.exigMes, (ok) => ok ? 'A renda passiva sozinha já atende o D7.' : 'A renda passiva não alcança o mínimo; o pedido depende da reserva. Trabalho remoto para empresa de fora é caso do D8.');

    const lv = alavancas(r);
    $('#levers').innerHTML = lv.length
      ? lv.map(([t, v]) => `<li><span>${esc(t)}</span><span class="lv-val ${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${eur(v)}/mês</span></li>`).join('')
      : '<li class="muted">Nada pendente de confirmação.</li>';

    // cascata
    const t = r.tip;
    const steps = [['Rendas brutas', t.brutoEq, 'total'], ['IR no Brasil', -t.impBR, 'down'], ['IRS e Seg. Social', -(t.impPT + t.ss), 'down'], ['IOF e tarifa', -t.remessa, 'down'], ['Chega em PT', t.receitas, 'total']];
    const cats = Object.entries(r.sim.desp.porCat).sort((a, b) => b[1] - a[1]);
    for (const [c, v] of cats) steps.push([c, -v, 'down']);
    steps.push(['Sobra', t.sobra, 'end']);
    let run = 0;
    const bars = steps.map(([, v, kind]) => {
      if (kind === 'total') { run = v; return [0, v]; }
      if (kind === 'end') return [0, v];
      const s = run; run += v; return [s, run];
    });
    const az = cssVar('--azulejo'), dao = cssVar('--dao'), mu = cssVar('--musgo');
    chart('chWaterfall', 'bar', {
      labels: steps.map((s) => s[0]),
      datasets: [{ data: bars, backgroundColor: steps.map(([, v, kind]) => kind === 'total' ? az : kind === 'end' ? (v >= 0 ? mu : dao) : dao + 'B0'), borderRadius: 4, borderSkipped: false, barPercentage: 0.72, categoryPercentage: 0.9 }],
    }, baseOpts({
      plugins: { ...baseOpts().plugins, legend: { display: false }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: (c) => eur(steps[c.dataIndex][1]) } } },
      scales: { ...baseOpts().scales, y: yEur() },
    }));
    $('#wfTitle').textContent = `Do Brasil até ${cidadeNome()}, por mês`;
    $('#wfNote').textContent = `mês ${ref} depois da mudança, câmbio de R$ ${nf(2).format(t.cambio)}`;

    chart('chDonut', 'doughnut', {
      labels: cats.map((c) => c[0]),
      datasets: [{ data: cats.map((c) => c[1]), backgroundColor: CAT_COLORS(), borderColor: cssVar('--surface'), borderWidth: 2 }],
    }, {
      ...baseOpts(), scales: {}, cutout: '64%',
      plugins: { ...baseOpts().plugins, legend: { position: 'right', labels: baseOpts().plugins.legend.labels },
        tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: (c) => ` ${c.label}: ${eur(c.raw)} (${pct(c.raw / r.despesas, 0)})` } } },
    });

    chart('chScen', 'bar', {
      labels: SC.map((k) => SC_LABEL[k]),
      datasets: [{ data: SC.map((k) => all[k].sobra), backgroundColor: SC.map((k) => (all[k].sobra >= 0 ? mu : dao) + (k === state.cenarioAtivo ? '' : '80')), borderRadius: 5, barPercentage: 0.6 }],
    }, baseOpts({
      plugins: { ...baseOpts().plugins, legend: { display: false }, tooltip: tooltipFmt((v) => eur(v)) },
      scales: { ...baseOpts().scales, y: yEur() },
    }));

    const tl = serieTimeline(all);
    chart('chProj', 'line', { labels: tl.labels, datasets: tl.datasets }, optsTimeline(tl.idxMudanca), [marcaX]);
  },
};

/* ---------- DADOS ---------- */
function baixar(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const hojeISO = () => new Date().toISOString().slice(0, 10);
$('#btnExport').addEventListener('click', () => {
  baixar(`planejador-viseu-${hojeISO()}.json`, JSON.stringify(copiaSemSegredos(), null, 2), 'application/json');
  toast('Arquivo exportado');
});
$('#btnCsv').addEventListener('click', () => {
  const all = calcAll();
  const linhas = [
    ['Indicador', ...SC.map((k) => SC_LABEL[k])],
    ['Cidade', ...SC.map(() => cidadeNome())],
    ['Câmbio (R$/€)', ...SC.map((k) => all[k].tip.cambio)],
    ['Chega em Portugal (€/mês)', ...SC.map((k) => all[k].receitas)],
    ['Despesas (€/mês)', ...SC.map((k) => all[k].despesas)],
    ['Sobra antes de poupar (€/mês)', ...SC.map((k) => all[k].sobra)],
    ['Sobra depois da meta (€/mês)', ...SC.map((k) => all[k].aposMeta)],
    ['Custo da mudança (R$)', ...SC.map((k) => all[k].entradaBRL)],
    ['Patrimônio na mudança (R$)', ...SC.map((k) => all[k].sim.patrimonioMudancaBRL)],
    ['Mês mais apertado (€)', ...SC.map((k) => all[k].sim.menor.saldo)],
    [`Patrimônio após ${all.base.sim.H} meses (€)`, ...SC.map((k) => all[k].sim.patrimonioFinalEUR)],
    ['IRS estimado por ano (€)', ...SC.map((k) => all[k].tip.imp.escolhida.total)],
  ];
  const csv = linhas.map((l) => l.map((c) => (typeof c === 'number' ? c.toFixed(2).replace('.', ',') : `"${String(c).replace(/"/g, '""')}"`)).join(';')).join('\r\n');
  baixar(`planejador-viseu-resumo-${hojeISO()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  toast('Resumo exportado');
});
$('#fileImport').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      if (!Array.isArray(d.rendas) || !Array.isArray(d.despesas)) throw new Error('formato');
      const token = state.config && state.config.brapiToken;
      state = normalize(d);
      if (token) state.config.brapiToken = token;
      save(); renderTopo(); construirVista(); refresh();
      toast('Dados importados');
    } catch (err) {
      toast('Esse arquivo não é um backup do Planejador. Escolha um .json exportado pela aba Dados.');
    }
    e.target.value = '';
  };
  rd.readAsText(f);
});
$('#btnReset').addEventListener('click', async () => {
  if (!(await confirmar('Substituir tudo pelos números da análise de outubro de 2026?', 'Restaurar'))) return;
  state = { ...seed(), config: state.config, mercado: state.mercado, comprasEuro: state.comprasEuro, realizado: state.realizado };
  save(); renderTopo(); construirVista(); refresh(); toast('Dados da análise restaurados');
});
$('#btnClear').addEventListener('click', async () => {
  if (!(await confirmar('Apagar rendas, investimentos, despesas, custos e eventos? Família, cidades e cenários continuam.', 'Apagar'))) return;
  state.rendas = []; state.investimentos = []; state.despesas = []; state.entrada = []; state.eventos = [];
  save(); construirVista(); refresh(); toast('Tudo apagado');
});

/* ---------- cálculo e redesenho ---------- */
const calcAll = () => Object.fromEntries(SC.map((k) => [k, resumo(state, k)]));
let rafPending = false;
let ultimoAll = null;
function refresh() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const all = calcAll();
    ultimoAll = all;
    const r = all[state.cenarioAtivo];
    const hojeEur = state.mercado && state.mercado.eur && state.mercado.eur.bid;
    $('#fxChip').innerHTML = `<b>R$ ${nf(2).format(r.tip.cambio)}</b> por euro` + (hojeEur ? ` <span class="muted">(hoje R$ ${nf(2).format(hojeEur)})</span>` : '');
    if (V[viewAtual] && V[viewAtual].update) V[viewAtual].update(all);
    $$('#tblScen th.sc').forEach((th, i) => th.classList.toggle('on', SC[i] === state.cenarioAtivo));
    $$('#tblScen td.sc-cell').forEach((td) => td.classList.toggle('on', td.dataset.sc === state.cenarioAtivo));
  });
}

/* ---------- tema ---------- */
function aplicarTema(t) {
  document.documentElement.dataset.theme = t;
  $('#themeBtn span').textContent = t === 'dark' ? 'Tema claro' : 'Tema escuro';
  resetCharts();
  refresh();
}
$('#themeBtn').addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ok */ }
  aplicarTema(t);
});

/* ---------- início ---------- */
(function init() {
  let t = null;
  try { t = localStorage.getItem(THEME_KEY); } catch (e) { /* ok */ }
  if (!t) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  $('#themeBtn span').textContent = t === 'dark' ? 'Tema claro' : 'Tema escuro';
  if (typeof Chart !== 'undefined') Chart.defaults.font.family = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  renderTopo();
})();

// exposto para testes
window.__planner = { resumo, calcAll, seed, normalize, get state() { return state; } };
