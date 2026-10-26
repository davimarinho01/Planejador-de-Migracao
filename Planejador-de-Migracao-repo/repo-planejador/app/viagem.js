'use strict';

/* =========================================================
   Aba Viagem: voos (Travelpayouts, SerpApi/Google Flights, Ignav),
   calendário e histórico de preços, alerta, bagagem, transfer,
   clima (Open-Meteo), feriados (Nager.Date) e fuso horário.
   ========================================================= */

const AEROPORTOS_BR = {
  GIG: 'Rio de Janeiro (Galeão)', GRU: 'São Paulo (Guarulhos)', VCP: 'Campinas (Viracopos)', CNF: 'Belo Horizonte (Confins)',
  BSB: 'Brasília', SSA: 'Salvador', REC: 'Recife', FOR: 'Fortaleza', NAT: 'Natal', POA: 'Porto Alegre',
  CWB: 'Curitiba', FLN: 'Florianópolis', BEL: 'Belém', MAO: 'Manaus',
};
const AEROPORTOS_PT = { LIS: 'Lisboa', OPO: 'Porto', FAO: 'Faro', FNC: 'Funchal', PDL: 'Ponta Delgada' };

// coordenadas e trajeto aeroporto → cidade (valores aproximados de 2026)
const GEO = {
  lisboa: { lat: 38.722, lon: -9.139, rotas: [['LIS', 7, [['Metro', '25 min', 1.85], ['Táxi ou Uber (por carro)', '20 min', 15]]]] },
  porto: { lat: 41.150, lon: -8.611, rotas: [['OPO', 15, [['Metro (linha E)', '30 min', 2.25], ['Táxi ou Uber (por carro)', '25 min', 25]]]] },
  setubal: { lat: 38.524, lon: -8.888, rotas: [['LIS', 50, [['Ônibus', '1h', 5], ['Táxi ou Uber (por carro)', '45 min', 55]]]] },
  braga: { lat: 41.545, lon: -8.427, rotas: [['OPO', 50, [['Ônibus direto do aeroporto', '50 min', 9], ['Carro alugado', '45 min', 0]]]] },
  guimaraes: { lat: 41.444, lon: -8.296, rotas: [['OPO', 55, [['Ônibus direto do aeroporto', '50 min', 9]]]] },
  aveiro: { lat: 40.641, lon: -8.654, rotas: [['OPO', 75, [['Metro + comboio', '1h30', 10]]]] },
  coimbra: { lat: 40.203, lon: -8.410, rotas: [['OPO', 125, [['Ônibus', '1h30', 14]]], ['LIS', 205, [['Comboio ou ônibus', '2h30', 18]]]] },
  viseu: { lat: 40.657, lon: -7.914, rotas: [['OPO', 130, [['Ônibus (Rede Expressos)', '1h45', 15], ['Carro alugado', '1h30', 0]]], ['LIS', 290, [['Ônibus (Rede Expressos)', '3h30', 20]]]] },
  leiria: { lat: 39.744, lon: -8.807, rotas: [['LIS', 145, [['Ônibus', '1h45', 13]]]] },
  castelobranco: { lat: 39.822, lon: -7.491, rotas: [['LIS', 250, [['Comboio ou ônibus', '3h', 18]]]] },
  evora: { lat: 38.571, lon: -7.913, rotas: [['LIS', 135, [['Ônibus', '1h45', 13]]]] },
  faro: { lat: 37.019, lon: -7.930, rotas: [['FAO', 7, [['Ônibus', '20 min', 2.5]]]] },
  funchal: { lat: 32.650, lon: -16.908, rotas: [['FNC', 20, [['Aerobus', '30 min', 5]]]] },
};
const geoCidade = () => GEO[state.cidade] || GEO.viseu;

function viagemState() {
  if (!state.viagem || typeof state.viagem !== 'object') state.viagem = {};
  const v = state.viagem;
  const mud = parseMes(state.plano.dataMudanca);
  if (!v.origem) v.origem = 'GIG';
  if (!v.destino) v.destino = geoCidade().rotas[0][0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.data || '')) v.data = `${mesKey(mud)}-05`;
  if (!Number.isFinite(+v.flex)) v.flex = 3;
  for (const k of ['ofertas', 'historico']) if (!Array.isArray(v[k])) v[k] = [];
  for (const k of ['calendario', 'clima', 'feriados', 'fontes']) if (!v[k] || typeof v[k] !== 'object') v[k] = {};
  if (!v.bagagem) v.bagagem = { inclusas: 1, extras: 1, custoExtra: 90 };
  if (!Number.isFinite(+v.alertaPreco)) v.alertaPreco = 0;
  const c = state.config;
  for (const k of ['travelpayoutsToken', 'serpapiKey', 'ignavKey']) if (typeof c[k] !== 'string') c[k] = '';
  if (typeof c.autoVoos !== 'boolean') c.autoVoos = true;
  return v;
}

/* ---------- conversão de moeda ---------- */
function paraBRL(valor, moeda) {
  const m = (moeda || 'BRL').toUpperCase();
  if (m === 'BRL') return valor;
  const mk = state.mercado || {};
  if (m === 'EUR') return valor * ((mk.eur && mk.eur.bid) || num(state.cenarios.base.cambio));
  if (m === 'USD' && mk.usd && mk.usd.bid) return valor * mk.usd.bid;
  return null;
}

/* ---------- leitura das respostas ---------- */
const ParseVoo = {
  tpDates(d) {
    const arr = d && Array.isArray(d.data) ? d.data : [];
    return arr.filter((x) => Number.isFinite(+x.price)).map((x) => ({
      fonte: 'Travelpayouts', preco: +x.price, moeda: (d.currency || 'brl').toUpperCase(),
      cia: x.airline || '', voo: x.flight_number ? `${x.airline || ''}${x.flight_number}` : '',
      saida: x.departure_at || '', chegada: '', duracao: +x.duration || +x.duration_to || 0, escalas: +x.transfers || 0,
      link: x.link ? (String(x.link).startsWith('/') ? `https://www.aviasales.com${x.link}` : `https://www.aviasales.com/search/${x.link}`) : '',
    }));
  },
  tpGrouped(d) {
    const o = d && d.data && typeof d.data === 'object' ? d.data : {};
    const out = {};
    for (const [dia, x] of Object.entries(o)) if (/^\d{4}-\d{2}-\d{2}/.test(dia) && Number.isFinite(+(x && x.price))) out[dia.slice(0, 10)] = +x.price;
    return out;
  },
  serp(d) {
    if (!d) return { ofertas: [], insights: null };
    const todas = [...(d.best_flights || []), ...(d.other_flights || [])];
    const link = d.search_metadata && d.search_metadata.google_flights_url;
    const ofertas = todas.filter((x) => Number.isFinite(+x.price) && Array.isArray(x.flights) && x.flights.length).map((x) => ({
      fonte: 'Google Flights', preco: +x.price, moeda: ((d.search_parameters && d.search_parameters.currency) || 'BRL').toUpperCase(),
      cia: [...new Set(x.flights.map((f) => f.airline).filter(Boolean))].join(' + '),
      voo: x.flights.map((f) => f.flight_number).filter(Boolean).join(', '),
      saida: (x.flights[0].departure_airport || {}).time || '', chegada: (x.flights[x.flights.length - 1].arrival_airport || {}).time || '',
      duracao: +x.total_duration || 0, escalas: x.flights.length - 1, link: link || '',
    }));
    const pi = d.price_insights;
    return { ofertas, insights: pi ? { menor: +pi.lowest_price, nivel: pi.price_level, faixa: pi.typical_price_range } : null };
  },
  ignav(d) {
    const arr = d && Array.isArray(d.itineraries) ? d.itineraries : [];
    return arr.filter((x) => x.price && Number.isFinite(+x.price.amount) && x.outbound).map((x) => {
      const seg = x.outbound.segments || [];
      return {
        fonte: 'Ignav', preco: +x.price.amount, moeda: (x.price.currency || 'USD').toUpperCase(),
        cia: x.outbound.carrier || (seg[0] && seg[0].operating_carrier_name) || '',
        voo: seg.map((s) => `${s.marketing_carrier_code || ''}${s.flight_number || ''}`).join(', '),
        saida: (seg[0] && seg[0].departure_time_local) || '', chegada: (seg[seg.length - 1] && seg[seg.length - 1].arrival_time_local) || '',
        duracao: +x.outbound.duration_minutes || 0, escalas: Math.max(0, seg.length - 1), link: '',
      };
    });
  },
};

/* ---------- busca ---------- */
let buscandoVoos = false;
async function buscarVoos({ silencioso = false } = {}) {
  const v = viagemState();
  const c = state.config;
  const fam = familiaInfo(state);
  if (buscandoVoos) return null;
  if (!c.travelpayoutsToken && !c.serpapiKey && !c.ignavKey) {
    if (!silencioso) toast('Conecte pelo menos uma fonte de preços no fim da página, ou use os links prontos.');
    return null;
  }
  buscandoVoos = true;
  const btn = $('#vgBuscar');
  if (btn) { btn.disabled = true; btn.textContent = 'Buscando…'; }
  const base = { origin: v.origem, destination: v.destino, date: v.data };
  const fontes = {};
  const tarefas = [];
  let ofertas = [], insights = null, calendario = null;
  if (c.travelpayoutsToken) {
    tarefas.push(api('tp_dates', { ...base, token: c.travelpayoutsToken }).then((r) => {
      fontes.Travelpayouts = r.ok ? 'ok' : r.status === 401 ? 'token inválido' : 'sem resposta';
      if (r.ok) ofertas.push(...ParseVoo.tpDates(r.data));
    }));
    tarefas.push(api('tp_grouped', { ...base, month: v.data.slice(0, 7), token: c.travelpayoutsToken }).then((r) => {
      if (r.ok) calendario = ParseVoo.tpGrouped(r.data);
    }));
  }
  if (c.serpapiKey && !silencioso) {
    tarefas.push(api('serp_flights', { ...base, adults: fam.A, children: fam.C, key: c.serpapiKey }).then((r) => {
      fontes['Google Flights'] = r.ok ? 'ok' : r.status === 401 ? 'chave inválida' : 'sem resposta';
      if (r.ok) { const p = ParseVoo.serp(r.data); ofertas.push(...p.ofertas); insights = p.insights; }
    }));
  }
  if (c.ignavKey && !silencioso) {
    tarefas.push(api('ignav_oneway', { ...base, key: c.ignavKey }).then((r) => {
      fontes.Ignav = r.ok ? 'ok' : r.status === 401 ? 'chave inválida' : 'sem resposta';
      if (r.ok) ofertas.push(...ParseVoo.ignav(r.data));
    }));
  }
  await Promise.all(tarefas);
  buscandoVoos = false;
  if (btn) { btn.disabled = false; btn.textContent = 'Buscar preços'; }

  // Google Flights traz o preço total para todos os passageiros; os outros, por pessoa
  for (const o of ofertas) {
    const brlV = paraBRL(o.preco, o.moeda);
    o.precoBRL = brlV === null ? null : o.fonte === 'Google Flights' ? brlV / Math.max(1, fam.P) : brlV;
  }
  ofertas = ofertas.filter((o) => o.precoBRL !== null).sort((a, b) => a.precoBRL - b.precoBRL).slice(0, 40);
  const rk = `${v.origem}-${v.destino}`;
  if (ofertas.length) {
    v.ofertas = ofertas;
    v.buscadoEm = Date.now();
    v.rotaBuscada = `${rk}-${v.data}`;
    v.historico.push({ t: Date.now(), rk, data: v.data, min: ofertas[0].precoBRL, fonte: ofertas[0].fonte });
    v.historico = v.historico.slice(-200);
  }
  if (calendario && Object.keys(calendario).length) v.calendario[`${rk}-${v.data.slice(0, 7)}`] = { t: Date.now(), dias: calendario };
  if (insights) v.insights = { ...insights, rota: `${rk}-${v.data}`, porPessoa: fam.P };
  v.fontes = fontes;
  save();
  verificarAlertaVoo();
  refresh();
  if (!silencioso) {
    const falhas = Object.entries(fontes).filter(([, s]) => s !== 'ok');
    toast(ofertas.length ? `${ofertas.length} opções encontradas${falhas.length ? `; ${falhas.map(([n, s]) => `${n}: ${s}`).join(', ')}` : ''}` : 'Nenhum preço encontrado para essa data. Tente outra data ou os links prontos.');
  }
  return { ofertas: ofertas.slice(0, 8), insights, fontes };
}

function verificarAlertaVoo() {
  const v = viagemState();
  const alvo = num(v.alertaPreco);
  const min = v.ofertas[0] && v.ofertas[0].precoBRL;
  if (!alvo || !min || min > alvo) return;
  const chave = `${alvo}-${v.rotaBuscada}-${new Date().toDateString()}`;
  if (v.alertaAvisado === chave) return;
  v.alertaAvisado = chave;
  toast(`Passagem abaixo do alvo: ${brl(min)} por pessoa`);
  try { new Notification('Passagem abaixo do seu alvo', { body: `${v.origem} → ${v.destino} em ${v.data}: ${brl(min)} por pessoa` }); } catch (e) { /* ok */ }
}

/* ---------- links prontos ---------- */
function linksVoo() {
  const v = viagemState();
  const fam = familiaInfo(state);
  const idades = fam.criancas.map((c) => Math.max(2, Math.min(17, num(c.idade) || 8)));
  const [y, m, d] = v.data.split('-');
  const yymmdd = `${y.slice(2)}${m}${d}`;
  const q = encodeURIComponent(`Flights from ${v.origem} to ${v.destino} on ${v.data} one way ${fam.A} adults${fam.C ? ` ${fam.C} children` : ''}`);
  return [
    ['Google Flights', `https://www.google.com/travel/flights?q=${q}&hl=pt-BR&curr=BRL`],
    ['Skyscanner', `https://www.skyscanner.com.br/transporte/passagens-aereas/${v.origem.toLowerCase()}/${v.destino.toLowerCase()}/${yymmdd}/?adultsv2=${fam.A}${idades.length ? `&childrenv2=${idades.join('%7C')}` : ''}&cabinclass=economy&rtn=0`],
    ['Kayak', `https://www.kayak.com.br/flights/${v.origem}-${v.destino}/${v.data}/${fam.A}adults${idades.length ? `/children-${idades.join('-')}` : ''}?sort=price_a`],
    ['Momondo', `https://www.momondo.com.br/flight-search/${v.origem}-${v.destino}/${v.data}/${fam.A}adults?sort=price_a`],
    ['TAP', 'https://www.flytap.com/pt-br'],
    ['LATAM', 'https://www.latamairlines.com/br/pt'],
    ['Azul', 'https://www.voeazul.com.br'],
  ];
}

/* ---------- clima e feriados ---------- */
const addDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
async function carregarClima() {
  const v = viagemState();
  const g = geoCidade();
  const chave = `${state.cidade}-${v.data}`;
  if (v.clima[chave] && Date.now() - v.clima[chave].t < 6 * 3600e3) return;
  const hoje = new Date().toISOString().slice(0, 10);
  const diasAte = Math.round((new Date(`${v.data}T12:00:00`) - new Date(`${hoje}T12:00:00`)) / 86400e3);
  const out = { t: Date.now() };
  if (diasAte >= 0 && diasAte <= 14) {
    const r = await api('meteo_forecast', { lat: g.lat, lon: g.lon, start: v.data, end: addDias(v.data, Math.min(6, 15 - diasAte)) });
    if (r.ok && r.data && r.data.daily) out.previsao = r.data.daily;
  }
  // mesmo mês do ano anterior, como referência de clima
  const [y, m] = v.data.split('-').map(Number);
  const ref = new Date(); const anoRef = (y - 1 >= ref.getFullYear() ? ref.getFullYear() - 1 : y - 1);
  const ini = `${anoRef}-${String(m).padStart(2, '0')}-01`;
  const fim = new Date(anoRef, m, 0).toISOString().slice(0, 10);
  const a = await api('meteo_archive', { lat: g.lat, lon: g.lon, start: ini, end: fim });
  if (a.ok && a.data && a.data.daily) out.referencia = { ano: anoRef, ...a.data.daily };
  if (out.previsao || out.referencia) { v.clima[chave] = out; save(); }
  else v.clima[chave] = { t: Date.now(), erro: true };
}
async function carregarFeriados() {
  const v = viagemState();
  const ano = +v.data.slice(0, 4);
  for (const pais of ['PT', 'BR']) {
    const k = `${pais}-${ano}`;
    if (v.feriados[k]) continue;
    const r = await api('feriados', { pais, ano });
    if (r.ok && Array.isArray(r.data)) { v.feriados[k] = r.data.map((f) => ({ data: f.date, nome: f.localName || f.name, global: f.global !== false })); save(); }
  }
}
function offsetHoras(tz, iso) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date(`${iso}T12:00:00Z`));
    const t = (f.find((p) => p.type === 'timeZoneName') || {}).value || 'GMT';
    const m = /GMT([+-]\d+)?(?::(\d+))?/.exec(t);
    return m && m[1] ? +m[1] + (m[2] ? Math.sign(+m[1]) * (+m[2] / 60) : 0) : 0;
  } catch (e) { return 0; }
}

/* ---------- desenho ---------- */
const fmtDur = (min) => (min ? `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}` : '—');
const fmtHora = (s) => { if (!s) return '—'; const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s); return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : esc(s); };

V.viagem = {
  build() {
    const v = viagemState();
    const c = state.config;
    const g = geoCidade();
    const destOpts = Object.fromEntries(Object.entries(AEROPORTOS_PT).map(([k, n]) => {
      const rt = g.rotas.find((x) => x[0] === k);
      return [k, `${k} · ${n}${rt ? ` (${rt[1]} km de ${cidadeNome()})` : ''}`];
    }));
    $('#vgForm').innerHTML = `
      <label>Saindo de</label>${sel('origem', v.origem, Object.fromEntries(Object.entries(AEROPORTOS_BR).map(([k, n]) => [k, `${k} · ${n}`])))}
      <label>Chegando em<small>Sugestão para ${esc(cidadeNome())}: ${g.rotas[0][0]}</small></label>${sel('destino', v.destino, destOpts)}
      <label>Data da viagem<small>Mês da mudança: ${mesLabel(parseMes(state.plano.dataMudanca))}</small></label>${inp('data', v.data, { type: 'date' })}
      <label>Passageiros<small>Da aba Família</small></label><span class="form-val" id="vgPax"></span>
      <label>Avisar se a passagem ficar abaixo de (R$ por pessoa)</label>${inp('alertaPreco', v.alertaPreco || '', { step: '50', placeholder: '3000' })}`;
    $('#vgLinks').innerHTML = linksVoo().map(([n, u]) => `<a class="chip" href="${esc(u)}" target="_blank">${esc(n)}</a>`).join('');
    const b = v.bagagem;
    $('#vgBag').innerHTML = `
      <label>Malas de 23 kg incluídas por pessoa</label>${inp('inclusas', b.inclusas, { step: '1', min: 0 })}
      <label>Malas extras por pessoa</label>${inp('extras', b.extras, { step: '1', min: 0 })}
      <label>Custo de cada mala extra (€)<small>Comprando antes, no site da companhia</small></label>${inp('custoExtra', b.custoExtra, { step: '5', min: 0 })}`;
    $('#vgKeys').innerHTML = `
      <div class="key-row"><div><b>Travelpayouts</b><small>Gratuito. Calendário de preços e passagens baratas do cache de buscas (até 48 h).</small></div>
        <input type="password" data-k="travelpayoutsToken" value="${esc(c.travelpayoutsToken)}" placeholder="Token da API" autocomplete="off"><a href="https://www.travelpayouts.com/" target="_blank">Criar conta</a><span class="pill ${c.travelpayoutsToken ? 'ok' : 'warn'}">${c.travelpayoutsToken ? 'conectado' : 'sem token'}</span></div>
      <div class="key-row"><div><b>SerpApi (Google Flights)</b><small>Plano gratuito de 250 buscas por mês. Preços ao vivo e se o preço está bom.</small></div>
        <input type="password" data-k="serpapiKey" value="${esc(c.serpapiKey)}" placeholder="Chave da API" autocomplete="off"><a href="https://serpapi.com/users/sign_up" target="_blank">Criar conta</a><span class="pill ${c.serpapiKey ? 'ok' : 'warn'}">${c.serpapiKey ? 'conectado' : 'sem chave'}</span></div>
      <div class="key-row"><div><b>Ignav</b><small>1.000 buscas grátis, depois US$ 2 por mil. Preços ao vivo.</small></div>
        <input type="password" data-k="ignavKey" value="${esc(c.ignavKey)}" placeholder="Chave da API" autocomplete="off"><a href="https://ignav.com/" target="_blank">Criar conta</a><span class="pill ${c.ignavKey ? 'ok' : 'warn'}">${c.ignavKey ? 'conectado' : 'sem chave'}</span></div>
      <label class="check"><input type="checkbox" id="vgAuto" ${c.autoVoos ? 'checked' : ''}> Atualizar o preço pela Travelpayouts ao abrir o app (não gasta buscas pagas)</label>`;
    carregarClima().then(() => viewAtual === 'viagem' && refresh());
    carregarFeriados().then(() => viewAtual === 'viagem' && refresh());
  },
  update(all) {
    const v = viagemState();
    const r = all[state.cenarioAtivo];
    const fam = r.fam;
    const g = geoCidade();
    $('#vgPax').textContent = `${fam.A} ${fam.A === 1 ? 'adulto' : 'adultos'}${fam.C ? ` e ${fam.C} ${fam.C === 1 ? 'criança' : 'crianças'}` : ''}`;
    $('#vgHead').innerHTML = `${v.origem} → ${v.destino}, ${new Date(`${v.data}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}<b>${fam.P} ${fam.P === 1 ? 'passageiro' : 'passageiros'}</b>`;

    // ofertas
    const atual = v.rotaBuscada === `${v.origem}-${v.destino}-${v.data}`;
    const ofs = atual ? v.ofertas : [];
    const min = ofs[0];
    const ins = v.insights && v.insights.rota === `${v.origem}-${v.destino}-${v.data}` ? v.insights : null;
    const nivel = ins && { low: ['bom', 'pos'], typical: ['normal', ''], high: ['alto', 'neg'] }[ins.nivel];
    const kpi = (label, val, note, cls = '') => `<div class="kpi"><div class="k-label">${label}</div><div class="k-val ${cls}">${val}</div><div class="k-note">${note}</div></div>`;
    const passagemPlano = (state.entrada.find((e) => /passagem/i.test(e.nome)) || {});
    $('#vgKpis').innerHTML = [
      kpi('Menor preço por pessoa', min ? brl(min.precoBRL) : '—', min ? `${esc(min.cia || min.fonte)}, ${min.escalas ? `${min.escalas} ${min.escalas === 1 ? 'escala' : 'escalas'}` : 'direto'}` : 'faça uma busca'),
      kpi('Total da família', min ? brl(min.precoBRL * fam.P) : '—', `${fam.P} ${fam.P === 1 ? 'passagem' : 'passagens'}`),
      kpi('O preço está', nivel ? nivel[0] : '—', ins && ins.faixa ? `faixa típica ${brl(ins.faixa[0] / Math.max(1, ins.porPessoa))} a ${brl(ins.faixa[1] / Math.max(1, ins.porPessoa))} por pessoa` : 'avaliação do Google Flights', nivel ? nivel[1] : ''),
      kpi('No plano hoje', passagemPlano.valor ? brl(num(passagemPlano.valor)) : '—', min && passagemPlano.valor ? `${min.precoBRL <= num(passagemPlano.valor) ? 'abaixo' : 'acima'} do previsto em ${brl(Math.abs(min.precoBRL - num(passagemPlano.valor)))}` : 'por pessoa, aba Custos da mudança'),
    ].join('');
    $('#vgUsar').disabled = !min;
    $('#vgUsar').textContent = min ? `Usar ${brl(min.precoBRL)} por pessoa no plano` : 'Usar no plano';
    const fontesTxt = Object.entries(v.fontes || {}).map(([n, s]) => `${n}: ${s}`).join(', ');
    $('#vgStatus').textContent = v.buscadoEm && atual ? `Busca de ${new Date(v.buscadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${fontesTxt ? `; ${fontesTxt}` : ''}` : 'Sem busca para esta rota e data';
    $('#tblVoos').innerHTML = `<thead><tr><th>Companhia</th><th>Saída</th><th>Chegada</th><th class="num">Duração</th><th class="num">Escalas</th><th class="num">Por pessoa</th><th>Fonte</th><th></th></tr></thead><tbody>${
      ofs.length ? ofs.slice(0, 15).map((o, i) => `<tr class="${i === 0 ? 'best' : ''}"><td><b>${esc(o.cia || '—')}</b><small class="muted block">${esc(o.voo || '')}</small></td><td>${fmtHora(o.saida)}</td><td>${fmtHora(o.chegada)}</td><td class="num">${fmtDur(o.duracao)}</td><td class="num">${o.escalas || 'direto'}</td><td class="num out">${brl(o.precoBRL)}</td><td class="small muted">${esc(o.fonte)}${o.moeda !== 'BRL' ? ` (${esc(o.moeda)})` : ''}</td><td>${o.link ? `<a href="${esc(o.link)}" target="_blank">Ver</a>` : ''}</td></tr>`).join('')
        : `<tr><td colspan="8" class="muted">${state.config.travelpayoutsToken || state.config.serpapiKey || state.config.ignavKey ? 'Clique em Buscar preços.' : 'Conecte uma fonte de preços no fim da página, ou abra os links prontos.'}</td></tr>`
    }</tbody>`;

    // calendário
    const cal = v.calendario[`${v.origem}-${v.destino}-${v.data.slice(0, 7)}`];
    if (cal && Object.keys(cal.dias).length) {
      const dias = Object.keys(cal.dias).sort();
      const vals = dias.map((d) => cal.dias[d]);
      const mn = Math.min(...vals);
      chart('chVgCal', 'bar', {
        labels: dias.map((d) => d.slice(8, 10)),
        datasets: [{ data: vals, backgroundColor: dias.map((d) => d === v.data ? cssVar('--ocre') : cal.dias[d] === mn ? cssVar('--musgo') : cssVar('--azulejo') + '99'), borderRadius: 3 }],
      }, baseOpts({
        onClick: (_e, els) => { if (els[0]) { v.data = dias[els[0].index]; save(); V.viagem.build(); refresh(); } },
        plugins: { ...baseOpts().plugins, legend: { display: false }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { title: (c) => dias[c[0].dataIndex].split('-').reverse().join('/'), label: (c) => ` ${brl(c.raw)} por pessoa` } } },
        scales: { x: baseOpts().scales.x, y: { ...baseOpts().scales.y, ticks: { ...baseOpts().scales.y.ticks, callback: (x) => brl(x) } } },
      }));
      $('#vgCalNote').textContent = `menor: ${brl(mn)} em ${dias[vals.indexOf(mn)].split('-').reverse().slice(0, 2).join('/')}; clique num dia para escolher`;
    } else {
      if (charts.chVgCal) { charts.chVgCal.destroy(); delete charts.chVgCal; }
      $('#vgCalNote').textContent = state.config.travelpayoutsToken ? 'busque para ver o mês' : 'precisa do token da Travelpayouts';
    }

    // histórico
    const rk = `${v.origem}-${v.destino}`;
    const h = v.historico.filter((x) => x.rk === rk);
    if (h.length) {
      chart('chVgHist', 'line', {
        labels: h.map((x) => new Date(x.t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })),
        datasets: [
          { label: 'Menor preço encontrado', data: h.map((x) => x.min), borderColor: cssVar('--azulejo'), backgroundColor: cssVar('--azulejo'), pointRadius: 3, tension: 0.2 },
          ...(num(v.alertaPreco) ? [{ label: 'Seu alvo', data: h.map(() => num(v.alertaPreco)), borderColor: cssVar('--ocre'), borderDash: [6, 5], pointRadius: 0 }] : []),
        ],
      }, baseOpts({
        plugins: { ...baseOpts().plugins, legend: { ...baseOpts().plugins.legend, position: 'bottom' }, tooltip: tooltipFmt((x) => brl(x)) },
        scales: { x: baseOpts().scales.x, y: { ...baseOpts().scales.y, ticks: { ...baseOpts().scales.y.ticks, callback: (x) => brl(x) } } },
      }));
    }
    $('#vgHistNote').textContent = h.length ? `${h.length} ${h.length === 1 ? 'busca registrada' : 'buscas registradas'} nesta rota` : 'cada busca registra o menor preço aqui';

    // bagagem
    const b = v.bagagem;
    const bagEUR = num(b.extras) * num(b.custoExtra) * fam.P;
    $('#vgBagTot').innerHTML = `${num(b.inclusas) + num(b.extras)} malas de 23 kg por pessoa, ${(num(b.inclusas) + num(b.extras)) * fam.P} no total<b>${eur(bagEUR)}</b>`;

    // transfer
    const rt = g.rotas.find((x) => x[0] === v.destino);
    $('#vgTransfer').innerHTML = rt
      ? `<p class="muted">${rt[1]} km do aeroporto ${esc(AEROPORTOS_PT[rt[0]])} até ${esc(cidadeNome())}. Valores aproximados.</p><div class="mk-rows">${rt[2].map(([modo, tempo, custo]) => `<div class="mk-row"><div><span>${esc(modo)}</span><small>${esc(tempo)}</small></div><div class="mk-val">${custo ? eur(custo) : 'varia'}<small>${/carro/i.test(modo) ? 'por carro' : 'por pessoa'}</small></div></div>`).join('')}</div>`
      : `<p class="muted">${esc(cidadeNome())} fica longe de ${esc(AEROPORTOS_PT[v.destino] || v.destino)}. Para essa cidade o aeroporto sugerido é ${g.rotas.map((x) => `${x[0]} (${x[1]} km)`).join(' ou ')}.</p>`;
    $('#vgTransferBtn').disabled = !rt;

    // clima
    const cl = v.clima[`${state.cidade}-${v.data}`];
    if (cl && (cl.previsao || cl.referencia)) {
      const src = cl.previsao || cl.referencia;
      const mx = src.temperature_2m_max || [], mnT = src.temperature_2m_min || [], ch = src.precipitation_sum || [];
      const media = (a) => (a.length ? a.reduce((s, x) => s + (+x || 0), 0) / a.length : 0);
      const chuva = ch.filter((x) => +x >= 1).length;
      $('#vgClima').innerHTML = `<p>${cl.previsao ? 'Previsão para os primeiros dias' : `Como foi ${MESES_CURTOS[+v.data.slice(5, 7) - 1]} de ${cl.referencia.ano} em ${esc(cidadeNome())}`}</p>
        <div class="clima"><div><b>${nf(0).format(media(mx))}°</b><small>máxima média</small></div><div><b>${nf(0).format(media(mnT))}°</b><small>mínima média</small></div><div><b>${chuva}</b><small>${chuva === 1 ? 'dia' : 'dias'} com chuva de ${src.time.length}</small></div></div>
        <p class="muted small">Dados do Open-Meteo.</p>`;
      chart('chVgClima', 'line', {
        labels: (src.time || []).map((d) => d.slice(8, 10)),
        datasets: [
          { label: 'Máxima', data: mx, borderColor: cssVar('--dao'), backgroundColor: cssVar('--dao'), pointRadius: 0, tension: 0.3 },
          { label: 'Mínima', data: mnT, borderColor: cssVar('--azulejo'), backgroundColor: cssVar('--azulejo'), pointRadius: 0, tension: 0.3 },
        ],
      }, baseOpts({ plugins: { ...baseOpts().plugins, legend: { ...baseOpts().plugins.legend, position: 'bottom' }, tooltip: tooltipFmt((x) => `${nf(1).format(x)} °C`) }, scales: { x: { ...baseOpts().scales.x, ticks: { ...baseOpts().scales.x.ticks, maxTicksLimit: 10 } }, y: { ...baseOpts().scales.y, ticks: { ...baseOpts().scales.y.ticks, callback: (x) => `${x}°` } } } }));
    } else {
      $('#vgClima').innerHTML = `<p class="muted">${cl && cl.erro ? 'O serviço de clima não respondeu agora.' : 'Carregando…'}</p>`;
    }

    // feriados
    const ano = +v.data.slice(0, 4);
    const ini = addDias(v.data, -21), fim = addDias(v.data, 21);
    const lista = ['PT', 'BR'].flatMap((p) => (v.feriados[`${p}-${ano}`] || []).filter((f) => f.global && f.data >= ini && f.data <= fim).map((f) => ({ ...f, pais: p })))
      .sort((a, b) => a.data.localeCompare(b.data));
    $('#vgFeriados').innerHTML = (v.feriados[`PT-${ano}`] || v.feriados[`BR-${ano}`])
      ? (lista.length ? `<div class="mk-rows">${lista.map((f) => `<div class="mk-row"><div><span>${esc(f.nome)}</span><small>${f.pais === 'PT' ? 'Portugal' : 'Brasil'}${f.data === v.data ? ', no dia da viagem' : ''}</small></div><div class="mk-val">${f.data.split('-').reverse().slice(0, 2).join('/')}</div></div>`).join('')}</div>`
        : '<p class="muted">Nenhum feriado nacional três semanas antes ou depois da viagem.</p>') + '<p class="muted small">Em feriados portugueses a AIMA, as Finanças e os bancos fecham. Dados do Nager.Date.</p>'
      : '<p class="muted">Carregando feriados…</p>';

    // fuso
    const dif = offsetHoras('Europe/Lisbon', v.data) - offsetHoras('America/Sao_Paulo', v.data);
    $('#vgFuso').innerHTML = `<b>${dif > 0 ? '+' : ''}${nf(0).format(dif)} h</b> em relação a Brasília na data da viagem${state.cidade === 'funchal' ? '' : ''}. Portugal muda para o horário de verão no último domingo de março e volta no último domingo de outubro.`;
  },
};

/* ---------- eventos ---------- */
(function bindViagem() {
  viagemState();
  const onForm = (e) => {
    const el = e.target.closest('[data-f]');
    if (!el) return;
    const v = viagemState();
    const f = el.dataset.f;
    if (f === 'data' && !/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return;
    v[f] = f === 'alertaPreco' ? num(el.value) : el.value;
    save();
    if (e.type === 'change' && f !== 'alertaPreco') V.viagem.build();
    refresh();
  };
  $('#vgForm').addEventListener('change', onForm);
  $('#vgBag').addEventListener('input', (e) => {
    const el = e.target.closest('[data-f]');
    if (!el) return;
    viagemState().bagagem[el.dataset.f] = Math.max(0, num(el.value));
    save(); refresh();
  });
  $('#vgKeys').addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (k) { state.config[k] = e.target.value.trim(); save(); V.viagem.build(); refresh(); toast(state.config[k] ? 'Conexão salva' : 'Conexão removida'); }
    if (e.target.id === 'vgAuto') { state.config.autoVoos = e.target.checked; save(); }
  });
  $('#vgBuscar').addEventListener('click', () => buscarVoos());
  $('#vgUsar').addEventListener('click', () => {
    const v = viagemState();
    const o = v.ofertas[0];
    if (!o) return;
    let item = state.entrada.find((x) => /passagem/i.test(x.nome));
    if (!item) { item = { id: nid('e'), nome: 'Passagem só de ida', moeda: 'BRL', valor: 0, porPessoa: true, nota: '' }; state.entrada.push(item); }
    Object.assign(item, { moeda: 'BRL', valor: Math.round(o.precoBRL), porPessoa: true, nota: `${o.cia || o.fonte}, ${v.origem}→${v.destino} em ${v.data.split('-').reverse().join('/')}` });
    save(); refresh();
    toast(`Passagem de ${brl(o.precoBRL)} por pessoa aplicada aos custos da mudança`);
  });
  $('#vgBagBtn').addEventListener('click', () => {
    const b = viagemState().bagagem;
    let item = state.entrada.find((x) => /malas extras/i.test(x.nome));
    if (!item) { item = { id: nid('e'), nome: 'Malas extras', moeda: 'EUR', valor: 0, porPessoa: true, nota: '' }; state.entrada.push(item); }
    Object.assign(item, { moeda: 'EUR', valor: num(b.extras) * num(b.custoExtra), porPessoa: true, nota: `${num(b.extras)} × ${eur(num(b.custoExtra))} por pessoa` });
    save(); refresh();
    toast('Malas extras aplicadas aos custos da mudança');
  });
  $('#vgTransferBtn').addEventListener('click', () => {
    const v = viagemState();
    const rt = geoCidade().rotas.find((x) => x[0] === v.destino);
    if (!rt) return;
    const pub = rt[2].find((x) => !/carro|táxi/i.test(x[0])) || rt[2][0];
    let item = state.entrada.find((x) => /→ cidade|aeroporto →|lisboa →/i.test(x.nome));
    if (!item) { item = { id: nid('e'), nome: 'Aeroporto → cidade', moeda: 'EUR', valor: 0, porPessoa: true, nota: '' }; state.entrada.push(item); }
    Object.assign(item, { nome: `${AEROPORTOS_PT[rt[0]]} → ${cidadeNome()}`, moeda: 'EUR', valor: pub[2], porPessoa: true, nota: pub[0] });
    save(); refresh();
    toast('Trajeto do aeroporto aplicado aos custos da mudança');
  });
  $('#vgTarefas').addEventListener('click', () => {
    const novas = [['Viagem', 'Conferir validade dos passaportes (pelo menos 3 meses além da estada)', -8], ['Viagem', 'Comprar as passagens e as malas extras', -3], ['Viagem', 'Separar documentos originais na bagagem de mão', -1], ['Viagem', 'Reservar o trajeto do aeroporto até a cidade', -1]];
    let n = 0;
    for (const [grupo, titulo, quando] of novas) if (!state.tarefas.some((t) => t.titulo === titulo)) { state.tarefas.push({ id: nid('t'), grupo, titulo, quando, status: 'pendente', nota: '' }); n++; }
    save(); refresh();
    toast(n ? `${n} tarefas de viagem adicionadas ao checklist` : 'Essas tarefas já estão no checklist');
  });
  // atualização automática do preço (só a fonte gratuita)
  setTimeout(() => {
    const v = viagemState();
    if (state.config.autoVoos && state.config.travelpayoutsToken && (!v.buscadoEm || Date.now() - v.buscadoEm > 12 * 3600e3)) buscarVoos({ silencioso: true });
  }, 1500);
})();
