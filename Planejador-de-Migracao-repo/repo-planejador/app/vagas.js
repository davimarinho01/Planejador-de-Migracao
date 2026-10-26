'use strict';

/* =========================================================
   Aba Vagas: vagas em Portugal simuladas no plano.
   Cada vaga vira, numa cópia do plano, uma renda de trabalho em
   Portugal (14 pagamentos, IRS e Segurança Social calculados) que
   substitui o trabalho remoto da pessoa. Nada muda no plano real
   até você clicar em "Usar no plano".
   ========================================================= */

const VAGA_STATUS = { interesse: 'Interesse', candidatura: 'Candidatura enviada', entrevista: 'Entrevista', proposta: 'Proposta', encerrada: 'Encerrada' };
const VAGA_MODO = { presencial: 'Presencial', hibrido: 'Híbrido', remoto: 'Remoto (empresa portuguesa)' };

function novaVaga(dados) {
  const pessoa = (state.familia.pessoas.find((p) => p.tipo !== 'crianca') || {}).id || '';
  return {
    id: nid('vg'), titulo: 'Nova vaga', empresa: '', cidade: state.cidade, link: '', brutoAnual: 0, pagamentos: 14,
    pessoa, modalidade: 'presencial', inicio: 0, status: 'interesse', area: '', nota: '', criadaEm: new Date().toISOString().slice(0, 10),
    encerraBeneficios: true, ificiEmpresa: '?', ificiQualificacao: '?', ...(dados || {}),
  };
}

function rendaDaVaga(st, v) {
  const anterior = st.rendas.find((r) => r.ativo && r.tipo === 'trabalho' && r.pessoa === v.pessoa);
  const pag = num(v.pagamentos) || 14;
  return {
    renda: {
      id: `vaga_${v.id}`, ativo: true, nome: `${v.titulo || 'Vaga'}${v.empresa ? ` (${v.empresa})` : ''}`, tipo: 'trabalho_pt', pessoa: v.pessoa,
      moeda: 'EUR', valor: Math.round((num(v.brutoAnual) / pag) * 100) / 100, impostoBR: 0, clt: false, pagamentos: pag,
      inicio: num(v.inicio) || 0, fim: null, substitui: anterior ? anterior.id : '', status: 'confirmada', ifici: ificiDaVaga(v) === 'sim',
      nota: `Vaga${v.link ? `: ${v.link}` : ''}`,
    },
    anterior,
  };
}

function aplicarVagaEm(st, v) {
  const { renda, anterior } = rendaDaVaga(st, v);
  st.rendas.push(renda);
  const encerrados = [];
  if (v.encerraBeneficios !== false) {
    for (const r of st.rendas) {
      if (r.ativo && r.tipo === 'beneficio' && r.pessoa === v.pessoa && (nulo(r.fim) || num(r.fim) > renda.inicio)) { r.fim = renda.inicio; encerrados.push(r.nome); }
    }
  }
  if (v.cidade && todasCidades(st).some((c) => c.id === v.cidade)) st.cidade = v.cidade;
  return { renda, anterior, encerrados };
}

/* IFICI: 20% de IRS por 10 anos para trabalho qualificado em empresa elegível (Portaria 352/2024/1) */
function ificiDaVaga(v) {
  if (v.ificiForcar === 'sim' || v.ificiForcar === 'nao') return v.ificiForcar;
  if (v.ificiEmpresa === 'nao' || v.ificiQualificacao === 'nao') return 'nao';
  if (v.ificiEmpresa === 'sim' && v.ificiQualificacao === 'sim') return 'sim';
  return '?';
}
function simularVagaIfici(v, k) {
  const com = simularVaga({ ...v, ificiForcar: 'sim' }, k), sem = simularVaga({ ...v, ificiForcar: 'nao' }, k);
  return { com, sem, ganho_mes: com.sobra_com_vaga - sem.sobra_com_vaga };
}
// salário bruto anual a partir do qual o IFICI passa a valer a pena (busca binária)
const cacheLimiarIfici = {};
function limiarIfici(v) {
  const chave = JSON.stringify([v.pessoa, v.cidade, v.pagamentos, v.inicio, state.cenarioAtivo, state.rendas.length, state.familia, state.cenarios[state.cenarioAtivo].cambio]);
  if (cacheLimiarIfici[chave] !== undefined) return cacheLimiarIfici[chave];
  const ganho = (b) => simularVagaIfici({ ...v, brutoAnual: b }).ganho_mes;
  let lo = 12000, hi = 250000;
  if (ganho(hi) < 0) return (cacheLimiarIfici[chave] = null);
  if (ganho(lo) >= 0) return (cacheLimiarIfici[chave] = lo);
  for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (ganho(m) >= 0) hi = m; else lo = m; }
  return (cacheLimiarIfici[chave] = Math.ceil(hi / 500) * 500);
}

function vistosDaVaga(v) {
  const bruto = num(v.brutoAnual);
  const limiar = num(state.config.limiarCartaoAzul) || 21030;
  const out = [{ id: 'd1', txt: 'D1 · Trabalho subordinado, com o contrato assinado antes de viajar', ok: true }];
  if (bruto >= limiar) out.push({ id: 'd3', txt: `D3 · Cartão Azul UE: o salário passa do limiar de ${eur(limiar)} por ano`, ok: true });
  else if (bruto > 0) out.push({ id: 'd3', txt: `Cartão Azul UE pede ${eur(limiar)} por ano; faltam ${eur(limiar - bruto)}`, ok: false });
  return out;
}

function simularVaga(v, k) {
  k = k || state.cenarioAtivo;
  // elegível ao IFICI: inscrever-se é opcional, então a simulação usa o que deixar mais dinheiro
  if (!v.ificiForcar && ificiDaVaga(v) === 'sim') {
    const a = simularVaga({ ...v, ificiForcar: 'sim' }, k), b = simularVaga({ ...v, ificiForcar: 'nao' }, k);
    return a.sobra_com_vaga >= b.sobra_com_vaga ? { ...a, ifici: 'sim', ifici_compensa: true } : { ...b, ifici: 'sim', ifici_compensa: false };
  }
  const mes = Math.max(num(state.plano.mesReferencia), num(v.inicio) || 0);
  const base = JSON.parse(JSON.stringify(state));
  base.plano.mesReferencia = mes;
  const com = JSON.parse(JSON.stringify(base));
  const { renda, anterior, encerrados } = aplicarVagaEm(com, v);
  const a = resumo(base, k), d = resumo(com, k);
  const it = d.tip.rend.find((x) => x.id === renda.id) || {};
  const bruto = num(v.brutoAnual);
  return {
    mes, bruto_anual: bruto, bruto_mes: renda.valor, pagamentos: renda.pagamentos,
    liquido_mes: Math.round(num(it.eur)), irs_mes: Math.round(num(it.ptMes)), ss_mes: Math.round(num(it.ssMes)),
    sobra_antes: Math.round(a.sobra), sobra_com_vaga: Math.round(d.sobra), diferenca: Math.round(d.sobra - a.sobra),
    despesas_com_vaga: Math.round(d.despesas), cidade: cidadeDe(com, com.cidade).nome,
    substitui: anterior ? anterior.nome : null, beneficios_encerrados: encerrados,
    vistos: vistosDaVaga(v), irs_regime: `${d.tip.imp.escolhida.regime}${d.tip.imp.escolhida.conjunta ? ' conjunta' : ''}`, ifici: ificiDaVaga(v),
  };
}

function vagaNasCidades(v, k) {
  k = k || state.cenarioAtivo;
  const base = JSON.parse(JSON.stringify(state));
  base.plano.mesReferencia = Math.max(num(state.plano.mesReferencia), num(v.inicio) || 0);
  const com = JSON.parse(JSON.stringify(base));
  aplicarVagaEm(com, { ...v, cidade: '' });
  return todasCidades(state).map((c) => {
    const x = resumo(com, k, { cidade: c.id });
    return { id: c.id, nome: c.nome, despesas: Math.round(x.despesas), sobra: Math.round(x.sobra) };
  }).sort((a, b) => b.sobra - a.sobra);
}

function usarVagaNoPlano(v) {
  const melhor = ificiDaVaga(v) === 'sim' ? (simularVaga(v).ifici_compensa ? 'sim' : 'nao') : 'nao';
  const { renda, anterior } = rendaDaVaga(state, { ...v, ificiForcar: melhor });
  const existente = state.rendas.find((r) => r.id === renda.id);
  if (existente) Object.assign(existente, renda, { status: v.status === 'proposta' ? 'confirmada' : 'a confirmar' });
  else state.rendas.push({ ...renda, status: v.status === 'proposta' ? 'confirmada' : 'a confirmar' });
  if (v.encerraBeneficios !== false) for (const r of state.rendas) if (r.ativo && r.tipo === 'beneficio' && r.pessoa === v.pessoa && (nulo(r.fim) || num(r.fim) > renda.inicio)) r.fim = renda.inicio;
  return { renda, anterior };
}

const SNI = { '?': 'Não sei', sim: 'Sim', nao: 'Não' };
function blocoIfici(v) {
  const x = simularVagaIfici(v);
  const st = ificiDaVaga(v);
  const pill = st === 'sim' ? '<span class="pill ok">aplicado na simulação</span>' : st === 'nao' ? '<span class="pill bad">não se aplica</span>' : '<span class="pill warn">a confirmar</span>';
  return `<div class="ifici">
    <div class="ifici-h"><b>IFICI, o regime de 20% de IRS</b> ${pill}</div>
    <p class="small">Com IFICI a sobra seria <b>${eur(x.com.sobra_com_vaga)}</b> por mês; sem, <b>${eur(x.sem.sobra_com_vaga)}</b> (${x.ganho_mes >= 0 ? '+' : ''}${eur(x.ganho_mes)} por mês).</p>
    ${x.ganho_mes < 0 ? (() => { const lim = limiarIfici(v); return `<p class="small"><b>Nesta vaga o IFICI não compensa.</b> Com a declaração conjunta, o IRS normal fica abaixo de 20%. ${lim ? `Passa a compensar a partir de cerca de ${eur(lim)} brutos por ano.` : ''} Como a inscrição é opcional, a simulação usa o regime normal.</p>`; })()
      : '<p class="small">Vale por 10 anos e também deixa sem IRS português a sua parte do aluguel e dos juros do Brasil.</p>'}
    <div class="form vg-form">
      <label>A empresa é elegível?<small>exportadora com 50% ou mais das vendas no exterior e CAE da lista, startup certificada, I&amp;D no SIFIDE ou projeto reconhecido pela AICEP ou IAPMEI. Pergunte ao RH.</small></label>${sel('ificiEmpresa', v.ificiEmpresa || '?', SNI).replace('data-f=', 'data-vf=')}
      <label>Você cumpre a qualificação?<small>licenciatura ou mestrado com 3 anos de experiência, ou doutoramento; diploma brasileiro precisa de reconhecimento</small></label>${sel('ificiQualificacao', v.ificiQualificacao || '?', SNI).replace('data-f=', 'data-vf=')}
    </div>
    <p class="muted small">Também exige não ter morado em Portugal nos 5 anos anteriores, contrato de trabalho (não recibo verde) e inscrição no Portal das Finanças até 15 de janeiro do ano seguinte ao da chegada. Não acumula com o IRS Jovem.</p>
  </div>`;
}

let vagaAberta = null;
V.vagas = {
  build() {
    if (!Array.isArray(state.vagas)) state.vagas = [];
    const cidades = Object.fromEntries(todasCidades(state).map((c) => [c.id, c.nome]));
    $('#tblVagas').innerHTML = `<thead><tr><th>Vaga</th><th>Cidade</th><th class="num">Bruto/ano (€)</th><th class="num" title="Meses depois da mudança">Começa</th><th>Situação</th><th class="num">Líquido/mês</th><th class="num">Sobra</th><th>Visto</th><th></th></tr></thead><tbody>${
      state.vagas.length ? state.vagas.map((v) => `<tr data-id="${v.id}" class="${vagaAberta === v.id ? 'sel' : ''}">
        <td class="vg-tit">${inp('titulo', v.titulo, { type: 'text' })}${inp('empresa', v.empresa, { type: 'text', placeholder: 'Empresa', cls: 'sub' })}${v.link ? `<a class="small" href="${esc(v.link)}" target="_blank">ver anúncio</a>` : ''}</td>
        <td>${sel('cidade', v.cidade, { '': 'Outra', ...cidades })}</td>
        <td>${inp('brutoAnual', v.brutoAnual, { step: '500', min: 0 })}</td>
        <td>${inp('inicio', v.inicio, { step: '1', cls: 'w-mes' })}</td>
        <td>${sel('status', v.status, VAGA_STATUS)}</td>
        <td class="num out" data-o="liq"></td><td class="num out" data-o="sobra"></td><td data-o="visto"></td>
        <td class="vg-acts"><button class="ghost small-btn" data-abrir title="Ver detalhes">Detalhes</button>${delBtn}</td></tr>`).join('')
        : '<tr><td colspan="9" class="muted">Nenhuma vaga ainda. Cole o anúncio acima para o Vasco analisar, ou use Adicionar vaga.</td></tr>'
    }</tbody>`;
  },
  update(all) {
    const r = all[state.cenarioAtivo];
    const sims = {};
    for (const v of state.vagas) {
      const s = sims[v.id] = simularVaga(v);
      const tr = $(`#tblVagas tr[data-id="${v.id}"]`);
      if (!tr) continue;
      tr.querySelector('[data-o="liq"]').textContent = s.bruto_anual ? eur(s.liquido_mes) : '—';
      const so = tr.querySelector('[data-o="sobra"]');
      so.innerHTML = s.bruto_anual ? `${eur(s.sobra_com_vaga)}<small class="${s.diferenca >= 0 ? 'pos' : 'neg'}">${s.diferenca >= 0 ? '+' : ''}${eur(s.diferenca)}</small>` : '—';
      tr.querySelector('[data-o="visto"]').innerHTML = s.bruto_anual ? s.vistos.map((x) => `<span class="pill ${x.ok ? 'ok' : 'warn'}" title="${esc(x.txt)}">${x.id === 'd3' ? (x.ok ? 'Cartão Azul' : 'sem Cartão Azul') : 'D1'}</span>`).join(' ') + (s.ifici === 'sim' ? '<span class="pill ok">IFICI</span>' : s.ifici === '?' ? '<span class="pill info" title="Pode ter IFICI; confirme nos detalhes">IFICI?</span>' : '') : '';
    }
    const comValor = state.vagas.filter((v) => num(v.brutoAnual) > 0);
    const melhor = comValor.slice().sort((a, b) => sims[b.id].sobra_com_vaga - sims[a.id].sobra_com_vaga)[0];
    $('#vgsHead').innerHTML = state.vagas.length
      ? `${state.vagas.length} ${state.vagas.length === 1 ? 'vaga' : 'vagas'}${melhor ? `; a que mais sobra é ${esc(melhor.titulo)}` : ''}<b>${melhor ? eur(sims[melhor.id].sobra_com_vaga) : '—'}</b>`
      : `Sobra hoje no plano<b>${eur(r.sobra)}</b>`;

    // gráfico
    if (comValor.length) {
      chart('chVagas', 'bar', {
        labels: ['Plano atual', ...comValor.map((v) => v.titulo.length > 22 ? v.titulo.slice(0, 21) + '…' : v.titulo)],
        datasets: [{ data: [r.sobra, ...comValor.map((v) => sims[v.id].sobra_com_vaga)], backgroundColor: [cssVar('--muted') + '88', ...comValor.map((v) => sims[v.id].diferenca >= 0 ? cssVar('--musgo') : cssVar('--dao'))], borderRadius: 4 }],
      }, baseOpts({ plugins: { ...baseOpts().plugins, legend: { display: false }, tooltip: tooltipFmt((x) => eur(x)) }, scales: { x: baseOpts().scales.x, y: yEur() } }));
      $('#vgsChartNote').textContent = `sobra por mês no cenário ${SC_LABEL[state.cenarioAtivo]}`;
    } else {
      if (charts.chVagas) { charts.chVagas.destroy(); delete charts.chVagas; }
      $('#vgsChartNote').textContent = 'informe o salário bruto anual para comparar';
    }

    // detalhe
    const v = state.vagas.find((x) => x.id === vagaAberta);
    $('#vgsDet').hidden = !v;
    if (v) {
      const s = sims[v.id];
      const cid = vagaNasCidades(v);
      $('#vgsDetTit').textContent = `${v.titulo}${v.empresa ? `, ${v.empresa}` : ''}`;
      $('#vgsDetBody').innerHTML = `
        <div class="mk-rows">
          <div class="mk-row"><div><span>Bruto</span><small>${s.pagamentos} pagamentos de ${eur(s.bruto_mes)}</small></div><div class="mk-val">${eur(s.bruto_anual)}<small>por ano</small></div></div>
          <div class="mk-row"><div><span>Segurança Social e IRS</span><small>média mensal; regime ${esc(s.irs_regime)}</small></div><div class="mk-val">−${eur(s.ss_mes + s.irs_mes)}<small>${eur(s.ss_mes)} + ${eur(s.irs_mes)}</small></div></div>
          <div class="mk-row"><div><span>Líquido</span><small>média com 13º e 14º diluídos</small></div><div class="mk-val">${eur(s.liquido_mes)}<small>por mês</small></div></div>
          <div class="mk-row"><div><span>Sobra no mês ${s.mes} depois da mudança</span><small>${s.substitui ? `no lugar de ${esc(s.substitui)}` : 'somada às outras rendas'}${s.beneficios_encerrados.length ? `; encerra ${esc(s.beneficios_encerrados.join(', '))}` : ''}</small></div><div class="mk-val ${s.diferenca >= 0 ? 'pos' : 'neg'}">${eur(s.sobra_com_vaga)}<small>${s.diferenca >= 0 ? '+' : ''}${eur(s.diferenca)} contra hoje</small></div></div>
        </div>
        <ul class="checks">${s.vistos.map((x) => `<li class="${x.ok ? 'yes' : 'no'}">${esc(x.txt)}</li>`).join('')}</ul>
        ${blocoIfici(v)}
        <div class="form vg-form">
          <label>Para quem</label>${sel('pessoa', v.pessoa, adultosOpts()).replace('data-f=', 'data-vf=')}
          <label>Pagamentos por ano<small>14 é o padrão em Portugal</small></label>${sel('pagamentos', String(v.pagamentos || 14), { 14: '14', 12: '12' }).replace('data-f=', 'data-vf=')}
          <label>Modalidade</label>${sel('modalidade', v.modalidade, VAGA_MODO).replace('data-f=', 'data-vf=')}
          <label>Link do anúncio</label><input type="text" data-vf="link" value="${esc(v.link)}" placeholder="https://">
        </div>
        ${v.nota ? `<p class="muted small">${esc(v.nota)}</p>` : ''}
        <label class="check"><input type="checkbox" id="vgsBen" ${v.encerraBeneficios !== false ? 'checked' : ''}> Encerrar os benefícios do emprego atual dessa pessoa quando a vaga começar</label>`;
      $('#vgsCidades').innerHTML = `<thead><tr><th>Com esta vaga, morando em</th><th class="num">Despesas</th><th class="num">Sobra</th></tr></thead><tbody>${cid.map((c) => `<tr class="${c.id === v.cidade ? 'best' : ''}"><td>${esc(c.nome)}</td><td class="num">${eur(c.despesas)}</td><td class="num out ${c.sobra >= 0 ? '' : 'neg'}">${eur(c.sobra)}</td></tr>`).join('')}</tbody>`;
    }
  },
};

(function bindVagas() {
  if (!Array.isArray(state.vagas)) state.vagas = [];
  bindLista('#tblVagas', () => state.vagas, { reconstruir: ['pessoa'], nomeItem: 'vaga' });
  $('#tblVagas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-abrir]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    vagaAberta = vagaAberta === id ? null : id;
    V.vagas.build(); refresh();
    if (vagaAberta) setTimeout(() => $('#vgsDet').scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  });
  $('#vgsAdd').addEventListener('click', () => {
    const v = novaVaga();
    state.vagas.unshift(v); vagaAberta = v.id;
    save(); V.vagas.build(); refresh();
  });
  $('#vgsDet').addEventListener('change', (e) => {
    const v = state.vagas.find((x) => x.id === vagaAberta);
    if (!v) return;
    if (e.target.id === 'vgsBen') v.encerraBeneficios = e.target.checked;
    else if (e.target.dataset.vf) {
      const f = e.target.dataset.vf;
      v[f] = f === 'pagamentos' ? num(e.target.value) : f === 'link' ? (/^https?:\/\//.test(e.target.value.trim()) ? e.target.value.trim() : '') : e.target.value;
      if (f === 'link') V.vagas.build();
    } else return;
    save(); refresh();
  });
  $('#vgsUsar').addEventListener('click', async () => {
    const v = state.vagas.find((x) => x.id === vagaAberta);
    if (!v || !num(v.brutoAnual)) return toast('Informe o salário bruto anual da vaga.');
    const s = simularVaga(v);
    if (!(await confirmar(`Pôr “${v.titulo}” no plano como renda em Portugal${s.substitui ? `, no lugar de ${s.substitui}` : ''}? A sobra passa de ${eur(s.sobra_antes)} para ${eur(s.sobra_com_vaga)} no mês ${s.mes}.`, 'Usar no plano'))) return;
    usarVagaNoPlano(v);
    if (typeof registrarDecisao === 'function') registrarDecisao(`Vaga “${v.titulo}” incluída no plano como renda em Portugal`, { origem: 'Vagas', antes: s.sobra_antes, depois: s.sobra_com_vaga, alteracoes: [`renda de ${eur(s.bruto_anual)} por ano a partir do mês ${num(v.inicio) || 0}`] });
    save(); refresh();
    toast('Vaga incluída na aba Rendas');
  });
  $('#vgsAnalisar').addEventListener('click', () => {
    const t = $('#vgsTexto').value.trim();
    if (!t) return toast('Cole o texto ou o link da vaga.');
    if (typeof iaPerguntar !== 'function') return;
    iaPerguntar(`Analise esta vaga em Portugal. Extraia título, empresa, cidade, salário e modalidade e registre com registrar_vaga. Se for um link, abra com pesquisar_internet. Depois diga quanto sobra com ela, que visto ela abre e o que pesar antes de se candidatar.\n\n${t.slice(0, 12000)}`);
    $('#vgsTexto').value = '';
  });
})();
