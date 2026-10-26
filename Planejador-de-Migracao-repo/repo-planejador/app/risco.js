'use strict';

/* =========================================================
   Risco do câmbio: mil caminhos possíveis do euro até o fim
   do horizonte, em vez de três cenários fixos.
   Como funciona: o plano é simulado com dois câmbios constantes.
   Para cada mês, a diferença separa a parte do saldo que não
   depende do euro (a) da que depende de 1/câmbio (b); então
   saldo(c) ≈ a + b/c. Cada caminho aplica o câmbio do próprio mês,
   tira da conta em euros e depois dos investimentos quando falta,
   e registra se o dinheiro acaba. É uma aproximação: os juros dos
   investimentos sacados e o IRS anual entram de forma linear.
   ========================================================= */

const RISCO = { caminhos: 1000, semente: 20261026 };

function aleatorio(semente) { // mulberry32
  let a = semente >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function normal(rnd) { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

function volatilidadeEuro() {
  const h = state.mercado && state.mercado.eurHist;
  if (h && h.length > 15) {
    const r = [];
    for (let i = 1; i < h.length; i++) if (h[i].v > 0 && h[i - 1].v > 0) r.push(Math.log(h[i].v / h[i - 1].v));
    const m = r.reduce((s, x) => s + x, 0) / r.length;
    const dp = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, r.length - 1));
    return { valor: Math.min(0.25, Math.max(0.08, dp * Math.sqrt(252))), fonte: `últimos ${h.length} dias do euro` };
  }
  return { valor: 0.13, fonte: 'média histórica do real contra o euro' };
}
function tendenciaEuro() {
  const m = state.mercado || {};
  if (m.ipca12 && m.hicpPT) return { valor: Math.max(-0.02, Math.min(0.08, (m.ipca12.v - m.hicpPT.v) / 100)), fonte: 'IPCA menos a inflação de Portugal' };
  return { valor: 0.02, fonte: 'diferença típica de inflação Brasil × Portugal' };
}

function simularRisco(opts) {
  opts = opts || {};
  const k = opts.cenario || state.cenarioAtivo;
  const sc = state.cenarios[k];
  const c1 = Math.max(1, num(sc.cambio)), c2 = c1 * 1.25;
  const st1 = JSON.parse(JSON.stringify(state)), st2 = JSON.parse(JSON.stringify(state));
  st2.cenarios[k].cambio = c2;
  const s1 = simular(st1, k), s2 = simular(st2, k);
  const inv = (c) => 1 / c;
  const H = s1.pos.length;
  const a = [], b = [];
  for (let m = 0; m < H; m++) {
    const y1 = s1.pos[m].saldo, y2 = s2.pos[m].saldo;
    b[m] = (y1 - y2) / (inv(c1) - inv(c2));
    a[m] = y1 - b[m] * inv(c1);
  }
  // custos da mudança em euros pagos em reais: custo(c) em BRL ≈ p + q·c
  const q = (s2.custoEntradaBRL - s1.custoEntradaBRL) / (c2 - c1), p0 = s1.custoEntradaBRL - q * c1;
  const iof = num(sc.iof), tarifa = num(sc.tarifa);
  const contaIni = s1.eurComprados - s1.usarEur;
  const capMud = s1.patrimonioMudancaBRL;

  const vol = opts.vol != null ? opts.vol : volatilidadeEuro().valor;
  const tend = opts.tendencia != null ? opts.tendencia : tendenciaEuro().valor;
  const hoje = state.mercado && state.mercado.eur ? +state.mercado.eur.bid : c1;
  const ate = Math.max(0, mesesEntre(hojeMes(), parseMes(state.plano.dataMudanca)));
  const rnd = aleatorio(opts.semente || RISCO.semente);
  const sm = vol / Math.sqrt(12), mu = Math.log(1 + tend) / 12 - (sm * sm) / 2;
  // o câmbio do cenário embute uma margem sobre o euro comercial; mantém a mesma proporção
  const margem = c1 / (hoje || c1);
  const N = opts.caminhos || RISCO.caminhos;
  const fim = [], acabou = [], cambioMud = [], sobraMedia = [], piorMes = [];
  const faixa = Array.from({ length: H }, () => []);
  for (let i = 0; i < N; i++) {
    let c = hoje;
    for (let t = 0; t < ate; t++) c *= Math.exp(mu + sm * normal(rnd));
    const cMud = c * margem;
    cambioMud.push(cMud);
    let caps = Math.max(0, capMud - (p0 + q * cMud));
    let conta = contaIni, zerou = null, soma = 0, pior = Infinity;
    for (let m = 0; m < H; m++) {
      c *= Math.exp(mu + sm * normal(rnd));
      const cm = c * margem;
      const saldo = a[m] + b[m] / cm;
      soma += saldo; pior = Math.min(pior, saldo);
      if (saldo >= 0) conta += saldo;
      else if (conta >= -saldo) conta += saldo;
      else {
        const falta = -saldo - conta; conta = 0;
        const brl = falta * cm * (1 + iof) / (1 - tarifa);
        if (caps > 0 && caps - brl <= 0.5 && zerou === null) zerou = m;
        caps = Math.max(0, caps - brl);
      }
      faixa[m].push(conta + caps / cm);
    }
    fim.push(conta + caps / (c * margem));
    acabou.push(zerou);
    sobraMedia.push(soma / H);
    piorMes.push(pior);
  }
  const pct = (arr, q2) => { const s = arr.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q2 * (s.length - 1))))]; };
  const nAcabou = acabou.filter((x) => x !== null).length;
  return {
    cenario: k, caminhos: N, horizonte_meses: H, meses_ate_mudanca: ate, euro_hoje: hoje,
    volatilidade_ano: vol, tendencia_ano: tend,
    chance_dinheiro_acabar: nAcabou / N,
    mes_tipico_em_que_acaba: nAcabou ? pct(acabou.filter((x) => x !== null), 0.5) : null,
    cambio_na_mudanca: { p10: pct(cambioMud, 0.1), p50: pct(cambioMud, 0.5), p90: pct(cambioMud, 0.9) },
    sobra_media_mes: { p10: pct(sobraMedia, 0.1), p50: pct(sobraMedia, 0.5), p90: pct(sobraMedia, 0.9) },
    patrimonio_final: { p10: pct(fim, 0.1), p50: pct(fim, 0.5), p90: pct(fim, 0.9) },
    chance_sobra_negativa: sobraMedia.filter((x) => x < 0).length / N,
    faixa: faixa.map((v) => ({ p10: pct(v, 0.1), p50: pct(v, 0.5), p90: pct(v, 0.9) })),
    meses: s1.pos.map((x) => mesLabel(x.cal)),
  };
}

let riscoCache = null, riscoChave = '', riscoSemente = RISCO.semente;
function riscoAtual() {
  const ch = estavelRisco() + riscoSemente;
  if (riscoCache && ch === riscoChave) return riscoCache;
  riscoCache = simularRisco({ semente: riscoSemente, vol: state.config.riscoVol ?? undefined, tendencia: state.config.riscoTendencia ?? undefined });
  riscoChave = ch;
  return riscoCache;
}
const estavelRisco = () => JSON.stringify([state.cenarios, state.rendas, state.investimentos, state.despesas, state.entrada, state.eventos, state.plano, state.familia, state.cidade, state.cidadesEdit, state.comprasEuro, state.cenarioAtivo, state.config.riscoVol, state.config.riscoTendencia, state.mercado && state.mercado.eur && state.mercado.eur.bid]);

function renderRisco() {
  if (!$('#rkKpis')) return;
  const r = riscoAtual();
  const v = volatilidadeEuro(), t = tendenciaEuro();
  const k = (l, val, n, cls = '') => `<div class="kpi"><div class="k-label">${l}</div><div class="k-val ${cls}">${val}</div><div class="k-note">${n}</div></div>`;
  const ch = r.chance_dinheiro_acabar;
  $('#rkKpis').innerHTML = [
    k('O dinheiro acaba?', `${nf(0).format(ch * 100)}%`, ch ? `dos caminhos; o típico é no mês ${r.mes_tipico_em_que_acaba} depois da mudança` : `em nenhum dos ${nf(0).format(r.caminhos)} caminhos, em ${r.horizonte_meses} meses`, ch > 0.1 ? 'neg' : ch > 0 ? '' : 'pos'),
    k('Euro na mudança', `R$ ${nf(2).format(r.cambio_na_mudanca.p50)}`, `8 em 10 caminhos entre R$ ${nf(2).format(r.cambio_na_mudanca.p10)} e R$ ${nf(2).format(r.cambio_na_mudanca.p90)}`),
    k('Sobra média por mês', eur(r.sobra_media_mes.p50), `8 em 10 entre ${eur(r.sobra_media_mes.p10)} e ${eur(r.sobra_media_mes.p90)}`, r.sobra_media_mes.p50 < 0 ? 'neg' : ''),
    k(`Patrimônio após ${r.horizonte_meses} meses`, eur(r.patrimonio_final.p50), `no pior décimo, ${eur(r.patrimonio_final.p10)}`, r.patrimonio_final.p10 < 0 ? 'neg' : ''),
  ].join('');
  $('#rkNota').textContent = `${nf(0).format(r.caminhos)} caminhos do euro a partir de R$ ${nf(2).format(r.euro_hoje)}; oscilação de ${nf(0).format(r.volatilidade_ano * 100)}% ao ano (${state.config.riscoVol != null ? 'definida por você' : v.fonte}) e tendência de ${r.tendencia_ano >= 0 ? '+' : ''}${nf(1).format(r.tendencia_ano * 100)}% ao ano (${state.config.riscoTendencia != null ? 'definida por você' : t.fonte}); cenário ${SC_LABEL[r.cenario]}.`;
  if (document.activeElement !== $('#rkVol')) $('#rkVol').value = state.config.riscoVol != null ? Math.round(state.config.riscoVol * 100) : '';
  $('#rkVol').placeholder = String(Math.round(v.valor * 100));
  if (document.activeElement !== $('#rkTend')) $('#rkTend').value = state.config.riscoTendencia != null ? +(state.config.riscoTendencia * 100).toFixed(1) : '';
  $('#rkTend').placeholder = String(+(t.valor * 100).toFixed(1));
  const az = cssVar('--azulejo');
  chart('chRisco', 'line', {
    labels: r.meses,
    datasets: [
      { label: '9 em 10 caminhos ficam acima', data: r.faixa.map((x) => x.p10), borderColor: cssVar('--dao'), backgroundColor: 'transparent', borderDash: [5, 4], pointRadius: 0, tension: 0.2 },
      { label: 'Caminho do meio', data: r.faixa.map((x) => x.p50), borderColor: az, backgroundColor: az, pointRadius: 0, tension: 0.2, borderWidth: 2.5 },
      { label: '1 em 10 caminhos fica acima', data: r.faixa.map((x) => x.p90), borderColor: cssVar('--musgo'), backgroundColor: 'transparent', borderDash: [5, 4], pointRadius: 0, tension: 0.2 },
    ],
  }, baseOpts({ plugins: { ...baseOpts().plugins, legend: { ...baseOpts().plugins.legend, position: 'bottom' }, tooltip: tooltipFmt((x) => eur(x)) }, scales: { x: { ...baseOpts().scales.x, ticks: { ...baseOpts().scales.x.ticks, maxTicksLimit: 12 } }, y: yEur() } }));
}

(function bindRisco() {
  if (!$('#rkKpis')) return;
  const orig = V.cenarios.update;
  V.cenarios.update = function (all) { orig.call(this, all); renderRisco(); };
  $('#rkDeNovo').addEventListener('click', () => { riscoSemente = Math.floor(Math.random() * 1e9); renderRisco(); });
  const campo = (id, chave) => $(id).addEventListener('change', (e) => { const v = e.target.value.trim(); state.config[chave] = v === '' ? null : num(v) / 100; save(); renderRisco(); });
  campo('#rkVol', 'riscoVol'); campo('#rkTend', 'riscoTendencia');
})();
