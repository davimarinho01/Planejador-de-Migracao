'use strict';

/* =========================================================
   Abas: linha do tempo, família, cidades, impostos, checklist,
   acompanhamento, relatório e backup.
   ========================================================= */

/* ---------- LINHA DO TEMPO ---------- */
V.plano = {
  build() {
    const p = state.plano;
    $('#planoForm').innerHTML = `
      <label>Mês da mudança<small>Primeiro mês morando em Portugal</small></label>${inp('dataMudanca', p.dataMudanca, { type: 'month' })}
      <label>Os capitais informados são<small>Na aba Investimentos</small></label>${sel('capitalBase', p.capitalBase, { mudanca: 'O saldo previsto na mudança', hoje: 'O saldo de hoje' })}
      <label>Aporte mensal até a mudança (R$)<small>${p.capitalBase === 'hoje' ? 'Somado aos investimentos todo mês' : 'Só vale com saldo de hoje'}</small></label>${inp('aporteMensal', p.aporteMensal, { step: '100', disabled: p.capitalBase !== 'hoje' })}
      <label>Mês usado no painel<small>0 = mês da chegada</small></label>${inp('mesReferencia', p.mesReferencia, { step: '1', min: 0 })}
      <label>Meses simulados depois da mudança</label>${inp('horizonte', p.horizonte, { step: '6', min: 6 })}
      <label>IRS dos rendimentos do Brasil<small>Pago de uma vez em agosto do ano seguinte</small></label>${sw('irsEmAgosto', p.irsEmAgosto, 'Pagar IRS em agosto')}`;

    const rows = state.eventos.map((e) => `
      <tr data-id="${e.id}" class="${e.ativo ? '' : 'off'}">
        <td class="c-toggle">${sw('ativo', e.ativo, 'Considerar este evento')}</td>
        <td>${inp('nome', e.nome, { type: 'text', cls: 'w-name' })}</td>
        <td>${sel('tipo', e.tipo, { saida: 'Gasto', entrada: 'Entrada' })}</td>
        <td>${sel('moeda', e.moeda, MOEDAS)}</td>
        <td>${inp('valor', e.valor, { step: '10' })}</td>
        <td><label class="mini">${sw('porPessoa', e.porPessoa, 'Multiplicar pelo número de pessoas')} por pessoa</label></td>
        <td>${inp('quando', e.quando, { step: '1', cls: 'w-mes' })}</td>
        <td>${sel('repetir', e.repetir, { nao: 'Uma vez', anual: 'Todo ano', mensal: 'Todo mês' })}</td>
        <td>${e.repetir === 'anual' ? sel('mesAno', String(e.mesAno || 1), Object.fromEntries(MESES_CURTOS.map((m, i) => [i + 1, m]))) : '<span class="muted">—</span>'}</td>
        <td>${inp('nota', e.nota, { type: 'text', cls: 'w-note' })}</td>
        <td class="c-del">${delBtn}</td>
      </tr>`).join('');
    $('#tblEventos').innerHTML = `<thead><tr><th></th><th>Evento</th><th>Tipo</th><th>Moeda</th><th class="num">Valor</th><th>Quantidade</th><th class="num">A partir do mês</th><th>Repete</th><th>Em</th><th>Observação</th><th></th></tr></thead><tbody>${rows}</tbody>`;
  },
  update(all) {
    const r = all[state.cenarioAtivo], s = r.sim;
    const falta = mesesEntre(hojeMes(), s.mud);
    $('#countdown').textContent = falta > 0 ? `faltam ${falta} meses` : falta === 0 ? 'é este mês' : 'mudança já aconteceu';
    const kpi = (label, val, note, cls = '') => `<div class="kpi"><div class="k-label">${label}</div><div class="k-val ${cls}">${val}</div><div class="k-note">${note}</div></div>`;
    $('#planoKpis').innerHTML = [
      kpi('Patrimônio na mudança', brl(s.patrimonioMudancaBRL), state.plano.capitalBase === 'hoje' ? `com ${s.N} meses de aportes e rendimento` : 'informado como saldo previsto'),
      kpi('Custo da mudança', brl(s.custoEntradaBRL), `em ${mesLabel(s.mud)}`),
      kpi('Mês mais apertado', eur(s.menor.saldo), s.menor.cal ? mesLabel(s.menor.cal) : '', s.menor.saldo >= 0 ? 'pos' : 'neg'),
      kpi(`Patrimônio em ${s.H} meses`, eur(s.patrimonioFinalEUR), `começou com ${eur(s.patrimonioPosEntradaEUR)}`, s.patrimonioFinalEUR >= s.patrimonioPosEntradaEUR ? 'pos' : 'neg'),
      kpi('A reserva acaba?', s.zerou === null ? 'Não' : `No mês ${s.zerou}`, s.zerou === null ? `não zera nos ${s.H} meses simulados` : mesLabel(s.pos[s.zerou].cal), s.zerou === null ? 'pos' : 'neg'),
    ].join('');

    const tl = serieTimeline(all);
    chart('chTimeline', 'line', { labels: tl.labels, datasets: tl.datasets }, optsTimeline(tl.idxMudanca), [marcaX]);

    const mu = cssVar('--musgo'), dao = cssVar('--dao');
    chart('chSaldo', 'bar', {
      labels: s.pos.map((p) => mesLabel(p.cal)),
      datasets: [{ label: 'Saldo do mês', data: s.pos.map((p) => p.saldo), backgroundColor: s.pos.map((p) => (p.saldo >= 0 ? mu : dao)), borderRadius: 3, barPercentage: 0.8 }],
    }, baseOpts({
      plugins: {
        ...baseOpts().plugins, legend: { display: false },
        tooltip: { ...baseOpts().plugins.tooltip, callbacks: {
          label: (c) => ` Saldo: ${eur(c.raw)}`,
          afterLabel: (c) => s.pos[c.dataIndex].eventos.map((e) => `${e.nome}: ${eur(e.eur)}`).join('\n'),
        } },
      },
      scales: { x: { ...baseOpts().scales.x, ticks: { ...baseOpts().scales.x.ticks, maxTicksLimit: 12, maxRotation: 0 } }, y: yEur() },
    }));
    const irs = s.pos.flatMap((p) => p.eventos.filter((e) => e.irs));
    $('#saldoNote').textContent = irs.length ? `inclui ${irs.length} ${irs.length > 1 ? 'pagamentos anuais' : 'pagamento anual'} de IRS em agosto` : 'cenário ' + SC_LABEL[state.cenarioAtivo];

    $('#tblMeses').innerHTML = `<thead><tr><th>Mês</th><th class="num">Receitas</th><th class="num">Despesas</th><th>Eventos</th><th class="num">Saldo do mês</th><th class="num">Conta em €</th><th class="num">Investimentos</th><th class="num">Patrimônio</th></tr></thead><tbody>${
      [...s.pre.map((p) => `<tr class="pre"><td>${mesLabel(p.cal)}</td><td colspan="5" class="muted">antes da mudança</td><td class="num">${brl(p.capsBRL)}</td><td class="num">${eur(p.patrimonioEUR)}</td></tr>`),
        ...s.pos.map((p) => `<tr><td>${mesLabel(p.cal)}${p.m === 0 ? ' <span class="pill ok">chegada</span>' : ''}</td><td class="num">${eur(p.receitas)}</td><td class="num">${eur(p.despesas)}</td><td class="small">${p.eventos.map((e) => `${esc(e.nome)} <span class="${e.eur >= 0 ? 'pos' : 'neg'}">${eur(e.eur)}</span>`).join('<br>') || '<span class="muted">—</span>'}</td><td class="num ${p.saldo >= 0 ? 'pos' : 'neg'}">${eur(p.saldo)}</td><td class="num">${eur(p.contaEUR)}</td><td class="num">${brl(p.capsBRL)}</td><td class="num"><b>${eur(p.patrimonioEUR)}</b></td></tr>`)].join('')
    }</tbody>`;
  },
};
function onPlano(e) {
  const el = e.target.closest('[data-f]');
  if (!el) return;
  const f = el.dataset.f;
  let v = lerCampo(el);
  if (f === 'mesReferencia' || f === 'horizonte') v = Math.max(0, Math.round(num(v)));
  if (f === 'dataMudanca' && !/^\d{4}-\d{2}$/.test(v)) return;
  state.plano[f] = v;
  save();
  if (e.type === 'change' && (f === 'capitalBase')) V.plano.build();
  refresh();
}
$('#planoForm').addEventListener('input', onPlano);
$('#planoForm').addEventListener('change', onPlano);
bindLista('#tblEventos', () => state.eventos, { reconstruir: ['repetir'], onChange: (it, f) => { if (f === 'mesAno') it.mesAno = +it.mesAno; } });

/* ---------- FAMÍLIA ---------- */
V.familia = {
  build() {
    const rows = state.familia.pessoas.map((p) => `
      <tr data-id="${p.id}">
        <td>${inp('nome', p.nome, { type: 'text', cls: 'w-name' })}</td>
        <td>${sel('tipo', p.tipo, { adulto: 'Adulto', crianca: 'Criança' })}</td>
        <td>${inp('idade', p.idade, { nullable: true, step: '1', min: 0, placeholder: '—', cls: 'w-mes' })}</td>
        <td>${p.tipo === 'crianca' ? '<span class="muted">—</span>' : sel('irsJovemAno', String(num(p.irsJovemAno)), { 0: 'Não usa', 1: '1º ano (100%)', 2: '2º ano (75%)', 3: '3º ano (75%)', 4: '4º ano (75%)', 5: '5º ano (50%)', 6: '6º ano (50%)', 7: '7º ano (50%)', 8: '8º ano (25%)', 9: '9º ano (25%)', 10: '10º ano (25%)' })}</td>
        <td class="c-del">${state.familia.pessoas.length > 1 ? delBtn : ''}</td>
      </tr>`).join('');
    $('#tblFamilia').innerHTML = `<thead><tr><th>Nome</th><th>Pessoa</th><th class="num">Idade</th><th>IRS Jovem no 1º ano em PT</th><th></th></tr></thead><tbody>${rows}</tbody>`;
    const f = state.familia;
    $('#famForm').innerHTML = `
      <label>Casados ou em união de facto<small>Permite a declaração conjunta</small></label>${sw('casados', f.casados, 'Casados')}
      <label>Declaração do IRS<small>A conjunta divide a renda por dois antes dos escalões</small></label>${sel('tributacao', f.tributacao, { melhor: 'A mais barata', separada: 'Separada', conjunta: 'Conjunta' })}
      <label>Tamanho da casa<small>Automática: um quarto por casal e um para cada duas crianças</small></label>${sel('tipologia', f.tipologia, { auto: 'Automática', t1: 'T1', t2: 'T2', t3: 'T3' })}`;
  },
  update(all) {
    const r = all[state.cenarioAtivo];
    const fam = r.fam;
    $('#famHead').innerHTML = `${fam.A} ${fam.A === 1 ? 'adulto' : 'adultos'}${fam.C ? ` e ${fam.C} ${fam.C === 1 ? 'criança' : 'crianças'}` : ''}<b>casa ${fam.tip.toUpperCase()}</b>`;
    const cid = r.cidade;
    const linhas = Object.keys(AUTO).filter(Boolean).map((k) => [AUTO[k].replace(/^(Cidade|Família): /, ''), autoValor(state, k, cid, fam)]);
    const custoEnt = r.sim.ent.items.filter((e) => e.porPessoa);
    $('#famResumo').innerHTML = `
      <div class="mk-rows">
        <div class="mk-row"><div><span>Exigência de meios do D7</span><small>1º adulto 100%, demais 50%, crianças 30% do salário mínimo</small></div><div class="mk-val">${eur(r.exigMes)}/mês<small>${eur(r.d7Exig)} em 12 meses</small></div></div>
        ${linhas.map(([n, v]) => `<div class="mk-row"><div><span>${esc(n[0].toUpperCase() + n.slice(1))}</span><small>em ${esc(cid.nome)}</small></div><div class="mk-val">${eur(v)}/mês</div></div>`).join('')}
        ${custoEnt.map((e) => `<div class="mk-row"><div><span>${esc(e.nome)}</span><small>${e.qtd} × ${e.moeda === 'EUR' ? eur(num(e.valor)) : brl(num(e.valor))}</small></div><div class="mk-val">${brl(e.brl)}</div></div>`).join('')}
      </div>
      <p class="muted small">Ensino público e creche são gratuitos em Portugal; a linha de escola cobre refeições, material e atividades.</p>`;
  },
};
bindLista('#tblFamilia', () => state.familia.pessoas, {
  reconstruir: ['tipo'],
  onChange: (it, f) => { if (f === 'irsJovemAno') it.irsJovemAno = +it.irsJovemAno; if (f === 'tipo' && it.tipo === 'crianca') it.irsJovemAno = 0; },
  onDelete: (p) => { for (const r of state.rendas) if (r.pessoa === p.id) r.pessoa = ''; },
});
function onFam(e) {
  const el = e.target.closest('[data-f]');
  if (!el) return;
  state.familia[el.dataset.f] = lerCampo(el);
  save(); refresh();
}
$('#famForm').addEventListener('change', onFam);
$$('[data-addpessoa]').forEach((b) => b.addEventListener('click', () => {
  const tipo = b.dataset.addpessoa;
  const n = state.familia.pessoas.filter((p) => p.tipo === tipo).length + 1;
  state.familia.pessoas.push({ id: nid('p'), nome: tipo === 'crianca' ? `Criança ${n}` : `Adulto ${n}`, tipo, idade: tipo === 'crianca' ? 5 : null, irsJovemAno: 0 });
  save(); V.familia.build(); refresh();
  toast(tipo === 'crianca' ? 'Criança adicionada: casa, mercado, escola, seguro e visto foram recalculados' : 'Adulto adicionado');
}));

/* ---------- CIDADES ---------- */
V.cidades = {
  build() {
    const cs = todasCidades(state);
    const rows = cs.map((c) => `
      <tr data-id="${esc(c.id)}" class="${c.id === state.cidade ? 'on' : ''}">
        <td><button class="${c.id === state.cidade ? 'primary' : ''} small-btn" data-usar="${esc(c.id)}">${c.id === state.cidade ? 'Em uso' : 'Usar'}</button></td>
        <td class="cid-nome"><b>${esc(c.nome)}</b>${/estimativa/i.test(c.fonte || '') ? ' <span class="pill warn">estimativa</span>' : ''}<small title="${esc(c.fonte || '')}">${esc(c.fonte || '')}</small></td>
        <td>${inp('t1', c.t1, { step: '10', cls: 'w-num' })}</td>
        <td>${inp('t2', c.t2, { step: '10', cls: 'w-num' })}</td>
        <td>${inp('t3', c.t3, { step: '10', cls: 'w-num' })}</td>
        <td>${inp('passe', c.passe, { step: '1', cls: 'w-num' })}</td>
        <td>${inp('alim', c.alim, { step: '0.01', cls: 'w-num' })}</td>
        <td class="num out" data-out="desp"></td>
        <td class="num out" data-out="sobra"></td>
        <td class="num out" data-out="ent"></td>
        <td class="c-del">${c.extra ? delBtn : ''}</td>
      </tr>`).join('');
    $('#tblCidades').innerHTML = `<thead><tr><th></th><th>Cidade</th><th class="num">T1</th><th class="num">T2</th><th class="num">T3</th><th class="num">Passe</th><th class="num">Índice mercado</th><th class="num">Despesas da família</th><th class="num">Sobra/mês</th><th class="num">Custo da mudança</th><th></th></tr></thead><tbody>${rows}</tbody>`;
  },
  update(all) {
    const k = state.cenarioAtivo;
    const res = todasCidades(state).map((c) => ({ c, r: resumo(state, k, { cidade: c.id }) }));
    for (const { c, r } of res) {
      const tr = $(`#tblCidades tr[data-id="${c.id}"]`);
      if (!tr) continue;
      tr.querySelector('[data-out="desp"]').textContent = eur(r.despesas);
      const so = tr.querySelector('[data-out="sobra"]');
      so.textContent = eur(r.sobra);
      so.className = `num out ${r.sobra >= 0 ? 'pos' : 'neg'}`;
      tr.querySelector('[data-out="ent"]').textContent = brl(r.entradaBRL);
    }
    const fam = all[k].fam;
    $('#cidHead').innerHTML = `Comparando para ${fam.P} ${fam.P === 1 ? 'pessoa' : 'pessoas'}, casa ${fam.tip.toUpperCase()}, cenário ${SC_LABEL[k]}<b>${esc(cidadeNome())}</b>`;
    $('#cidNote').textContent = `mês ${num(state.plano.mesReferencia)} depois da mudança`;
    const ord = [...res].sort((a, b) => b.r.sobra - a.r.sobra);
    const mu = cssVar('--musgo'), dao = cssVar('--dao');
    chart('chCidades', 'bar', {
      labels: ord.map((x) => x.c.nome),
      datasets: [{ data: ord.map((x) => x.r.sobra), backgroundColor: ord.map((x) => ((x.r.sobra >= 0 ? mu : dao) + (x.c.id === state.cidade ? '' : '99'))), borderRadius: 4, barPercentage: 0.72 }],
    }, baseOpts({
      plugins: { ...baseOpts().plugins, legend: { display: false }, tooltip: tooltipFmt((v) => eur(v) + '/mês') },
      scales: { x: { ...baseOpts().scales.x, ticks: { ...baseOpts().scales.x.ticks, autoSkip: false } }, y: yEur() },
    }));
  },
};
(function bindCidades() {
  const t = $('#tblCidades');
  const onEdit = (e) => {
    const el = e.target.closest('[data-f]');
    if (!el) return;
    const id = el.closest('tr').dataset.id;
    const v = num(el.value);
    const extra = state.cidadesExtras.find((c) => c.id === id);
    if (extra) extra[el.dataset.f] = v;
    else state.cidadesEdit[id] = { ...(state.cidadesEdit[id] || {}), [el.dataset.f]: v };
    save(); refresh();
  };
  t.addEventListener('input', onEdit);
  t.addEventListener('click', async (e) => {
    const u = e.target.closest('[data-usar]');
    if (u) {
      state.cidade = u.dataset.usar;
      save(); renderTopo(); V.cidades.build(); refresh();
      toast(`Agora o plano usa ${cidadeNome()}`);
      return;
    }
    const d = e.target.closest('[data-del]');
    if (!d) return;
    const id = d.closest('tr').dataset.id;
    const c = state.cidadesExtras.find((x) => x.id === id);
    if (!c || !(await confirmar(`Remover ${c.nome}?`, 'Remover'))) return;
    state.cidadesExtras = state.cidadesExtras.filter((x) => x.id !== id);
    if (state.cidade === id) state.cidade = 'viseu';
    save(); renderTopo(); V.cidades.build(); refresh();
  });
  $('#cidAdd').addEventListener('click', () => {
    const id = nid('cid');
    state.cidadesExtras.push({ id, nome: 'Nova cidade', t1: 700, t2: 900, t3: 1150, passe: 30, alim: 1, contas: 1, fonte: 'Valores digitados por você', extra: true });
    save(); renderTopo(); V.cidades.build(); refresh();
    const tr = $(`#tblCidades tr[data-id="${id}"]`);
    if (tr) {
      const td = tr.children[1];
      td.innerHTML = `<input type="text" data-nome value="Nova cidade" class="w-name">`;
      const i = td.querySelector('input');
      i.focus(); i.select();
      i.addEventListener('change', () => { const c = state.cidadesExtras.find((x) => x.id === id); c.nome = i.value.trim() || 'Nova cidade'; save(); renderTopo(); V.cidades.build(); refresh(); });
    }
  });
  $('#cidRestore').addEventListener('click', async () => {
    if (!(await confirmar('Voltar os valores das cidades embutidas para os originais? Cidades que você adicionou continuam.', 'Restaurar'))) return;
    state.cidadesEdit = {};
    save(); V.cidades.build(); refresh();
  });
})();

/* ---------- IMPOSTOS ---------- */
V.impostos = {
  build() {
    $('#impRegime').value = state.impostos.regime || 'melhor';
    $('#impTrib').value = state.familia.tributacao || 'melhor';
  },
  update(all) {
    const r = all[state.cenarioAtivo];
    const imp = r.tip.imp;
    const e = imp.escolhida;
    const nomeOp = (o) => `${o.regime === 'autonomo' ? 'Taxas autónomas' : 'Englobamento'}, declaração ${o.conjunta ? 'conjunta' : 'separada'}`;
    $('#impHead').innerHTML = `Estimativa de ${imp.ano}, mês ${num(state.plano.mesReferencia)} depois da mudança<b>${eur(e.total)}/ano</b>`;
    const brAno = (r.tip.impBR) * 12;
    const brutoAno = r.tip.brutoEq * 12;
    const kpi = (label, val, note) => `<div class="kpi"><div class="k-label">${label}</div><div class="k-val">${val}</div><div class="k-note">${note}</div></div>`;
    $('#impKpis').innerHTML = [
      kpi('IRS em Portugal', eur(e.total), `${eur(e.total / 12)} por mês`),
      kpi('Segurança Social', eur(imp.ss), 'trabalho em Portugal, 11%'),
      kpi('IR pago no Brasil', eur(brAno), 'vira crédito em Portugal'),
      kpi('Carga total', pct(brutoAno > 0 ? (e.total + imp.ss + brAno) / brutoAno : 0), `sobre ${eur(brutoAno)} brutos por ano`),
    ].join('');
    $('#impEscolhida').textContent = nomeOp(e);
    $('#tblImpOpcoes').innerHTML = `<thead><tr><th>Opção</th><th class="num">IRS por ano</th><th class="num">Diferença</th></tr></thead><tbody>${
      imp.opcoes.map((o, i) => `<tr class="${i === 0 ? 'best' : ''}"><td>${nomeOp(o)}${i === 0 ? ' <span class="pill ok">mais barata</span>' : ''}</td><td class="num out">${eur(o.total)}</td><td class="num">${i === 0 ? '—' : '+' + eur(o.total - e.total)}</td></tr>`).join('')
    }</tbody>`;
    const soma = (f) => e.det.reduce((s, d) => s + f(d), 0);
    const cats = [['A', 'Trabalho'], ...(e.cat.I > 0 ? [['I', 'Trabalho com IFICI (20%)']] : []), ['F', 'Aluguel do Brasil'], ['E', 'Juros e fundos']];
    const brutoCat = { I: imp.pessoa.reduce((s, p) => s + p.ifiBruto, 0), A: imp.pessoa.reduce((s, p) => s + p.bruto, 0), F: r.tip.rend.filter((x) => x.ativa && x.tipo === 'passiva').reduce((s, x) => s + x.anual / (x.isBRL ? r.tip.cambio : 1), 0), E: r.tip.inv.reduce((s, x) => s + x.brutoMes * 12 / r.tip.cambio, 0) };
    $('#tblImpCat').innerHTML = `<thead><tr><th>Rendimento</th><th class="num">Bruto/ano</th><th class="num">Imposto PT</th><th class="num">Crédito do Brasil</th><th class="num">A pagar</th></tr></thead><tbody>${
      cats.map(([c, n]) => `<tr><td>${n}</td><td class="num">${eur(brutoCat[c])}</td><td class="num">${eur(soma((d) => d.bruto[c]))}</td><td class="num">${eur(soma((d) => d.credito[c]))}</td><td class="num out">${eur(soma((d) => d.liquido[c]))}</td></tr>`).join('')
    }</tbody>`;
    $('#tblImpPessoa').innerHTML = `<thead><tr><th>Pessoa</th><th class="num">Trabalho no Brasil</th><th class="num">Trabalho em PT</th><th class="num">IR pago no Brasil</th><th class="num">Isento pelo IRS Jovem</th><th class="num">Dedução específica</th><th class="num">Rendimento coletável</th></tr></thead><tbody>${
      imp.pessoa.map((p) => `<tr><td>${esc(p.nome || 'Adulto')}${p.temIfici ? ' <span class="pill ok">IFICI</span>' : ''}</td><td class="num">${eur(p.br)}${p.brIsentoIfici ? `<small class="muted block">${eur(p.brIsentoIfici)} isento pelo IFICI</small>` : ''}</td><td class="num">${eur(p.pt + p.ifiBruto)}${p.ifiBruto ? `<small class="muted block">${eur(p.ifici)} de IRS a 20%</small>` : ''}</td><td class="num">${eur(p.brTax)}</td><td class="num">${eur(p.isento)}</td><td class="num">${eur(p.ded)}</td><td class="num out">${eur(p.tributavel)}</td></tr>`).join('')
    }</tbody>`;
    $('#impAno').textContent = `${imp.ano >= 2027 ? '2027 (proposta do OE2027)' : '2026'}; mínimo de existência ${eur(imp.T.minimo)}`;
    let inf = 0;
    $('#tblEscaloes').innerHTML = `<thead><tr><th>Rendimento coletável</th><th class="num">Taxa</th></tr></thead><tbody>${
      imp.T.escaloes.map(([sup, t]) => { const l = sup === Infinity ? `acima de ${eur(inf)}` : `${eur(inf)} a ${eur(sup)}`; inf = sup; return `<tr><td>${l}</td><td class="num">${nf(1).format(t * 100)}%</td></tr>`; }).join('')
    }</tbody>`;
  },
};
$('#impRegime').addEventListener('change', (e) => { state.impostos.regime = e.target.value; save(); refresh(); });
$('#impTrib').addEventListener('change', (e) => { state.familia.tributacao = e.target.value; save(); refresh(); });

/* ---------- CHECKLIST ---------- */
const GRUPOS = { Visto: 'Visto', Documentos: 'Documentos', Viagem: 'Viagem', Mudança: 'Mudança', Chegada: 'Chegada', Depois: 'Depois' };
V.checklist = {
  build() {
    const mud = parseMes(state.plano.dataMudanca);
    const hoje = hojeMes();
    const ord = [...state.tarefas].sort((a, b) => num(a.quando) - num(b.quando));
    const porMes = {};
    for (const t of ord) (porMes[num(t.quando)] = porMes[num(t.quando)] || []).push(t);
    $('#chkList').innerHTML = Object.entries(porMes).sort((a, b) => +a[0] - +b[0]).map(([q, ts]) => {
      const cal = addMes(mud, +q);
      const rel = +q === 0 ? 'mês da mudança' : +q < 0 ? `${-q} ${-q === 1 ? 'mês' : 'meses'} antes` : `${q} ${+q === 1 ? 'mês' : 'meses'} depois`;
      return `<div class="chk-group"><div class="chk-when"><b>${mesLabel(cal)}</b><span>${rel}</span></div><div class="chk-items">${ts.map((t) => {
        const atrasada = t.status !== 'feito' && mesesEntre(hoje, cal) < 0;
        return `<div class="chk-item ${t.status === 'feito' ? 'done' : ''}" data-id="${t.id}">
          <label class="chk-box"><input type="checkbox" data-f="feito" ${t.status === 'feito' ? 'checked' : ''} aria-label="Concluída"><span></span></label>
          ${inp('titulo', t.titulo, { type: 'text', cls: 'chk-title' })}
          ${sel('grupo', t.grupo, GRUPOS, 'chk-grp')}
          ${sel('status', t.status, { pendente: 'Pendente', andamento: 'Em andamento', feito: 'Feito' }, 'chk-st')}
          <span class="chk-q" title="Meses em relação à mudança">${inp('quando', t.quando, { step: '1', cls: 'w-mes' })}</span>
          ${atrasada ? '<span class="pill bad">atrasada</span>' : '<span></span>'}
          ${delBtn}
        </div>`;
      }).join('')}</div></div>`;
    }).join('') || '<p class="muted">Nenhuma tarefa. Use Adicionar tarefa.</p>';
  },
  update() {
    const tot = state.tarefas.length, feitas = state.tarefas.filter((t) => t.status === 'feito').length;
    const and = state.tarefas.filter((t) => t.status === 'andamento').length;
    $('#chkHead').innerHTML = `${feitas} de ${tot} feitas${and ? `, ${and} em andamento` : ''}<b>${tot ? Math.round((feitas / tot) * 100) : 0}%</b>`;
    $('#chkBar').style.width = `${tot ? (feitas / tot) * 100 : 0}%`;
  },
};
(function bindChecklist() {
  const box = $('#chkList');
  const getT = (el) => state.tarefas.find((t) => t.id === el.closest('[data-id]').dataset.id);
  box.addEventListener('change', (e) => {
    const el = e.target.closest('[data-f]');
    if (!el) return;
    const t = getT(el);
    if (el.dataset.f === 'feito') t.status = el.checked ? 'feito' : 'pendente';
    else t[el.dataset.f] = lerCampo(el);
    save(); V.checklist.build(); refresh();
  });
  box.addEventListener('input', (e) => {
    const el = e.target.closest('[data-f="titulo"]');
    if (!el) return;
    getT(el).titulo = el.value;
    save();
  });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const t = getT(b);
    if (!(await confirmar(`Remover “${t.titulo}”?`, 'Remover'))) return;
    state.tarefas = state.tarefas.filter((x) => x.id !== t.id);
    save(); V.checklist.build(); refresh();
  });
})();

/* ---------- agenda (.ics) ---------- */
function gerarICS() {
  const mud = parseMes(state.plano.dataMudanca);
  const pad = (n) => String(n).padStart(2, '0');
  const dia = (y, m, d) => `${y}${pad(m)}${pad(d)}`;
  const escI = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
  const dobrar = (l) => { const out = []; let x = l; while (x.length > 74) { out.push(x.slice(0, 74)); x = ' ' + x.slice(74); } out.push(x); return out.join('\r\n'); };
  const agora = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const ev = [];
  const add = (uid, y, m, d, titulo, desc, alarmeDias) => {
    const fim = new Date(Date.UTC(y, m - 1, d + 1));
    ev.push(['BEGIN:VEVENT', `UID:${uid}@planejador-viseu`, `DTSTAMP:${agora}`, `DTSTART;VALUE=DATE:${dia(y, m, d)}`, `DTEND;VALUE=DATE:${dia(fim.getUTCFullYear(), fim.getUTCMonth() + 1, fim.getUTCDate())}`,
      `SUMMARY:${escI(titulo)}`, `DESCRIPTION:${escI(desc)}`, ...(alarmeDias ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escI(titulo)}`, `TRIGGER:-P${alarmeDias}D`, 'END:VALARM'] : []), 'END:VEVENT'].map(dobrar).join('\r\n'));
  };
  let n = 0;
  for (const t of state.tarefas.filter((x) => x.status !== 'feito')) {
    const c = addMes(mud, num(t.quando));
    add(t.id, c.y, c.m, 1, `${t.titulo}`, `${t.grupo} · Planejador Viseu (${num(t.quando) < 0 ? `${-num(t.quando)} meses antes da mudança` : num(t.quando) === 0 ? 'mês da mudança' : `${num(t.quando)} meses depois`})${t.nota ? `\n${t.nota}` : ''}`, 7);
    n++;
  }
  const v = state.viagem || {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(v.data || '')) { const [y, m, d] = v.data.split('-').map(Number); add('voo-mudanca', y, m, d, `Voo da mudança ${v.origem || ''} → ${v.destino || ''}`, 'Planejador Viseu', 14); }
  else add('mudanca', mud.y, mud.m, 1, `Mudança para ${cidadeNome()}`, 'Planejador Viseu', 30);
  const cal = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Planejador Viseu//PT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Mudança para Portugal', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
  return { cal, n };
}
$('#chkIcs').addEventListener('click', () => {
  const { cal, n } = gerarICS();
  baixar('mudanca-portugal.ics', cal, 'text/calendar');
  toast(`${n} tarefas e a data da mudança exportadas. Abra o arquivo para pôr na sua agenda.`);
});

/* ---------- ACOMPANHAMENTO ---------- */
const REGRAS_CAT = [
  [/renda|arrend|senhorio|condom/i, 'Moradia'],
  [/edp|endesa|galp|goldenergy|iberdrola|repsol|aguas|águas|smas|meo|nos |nos comun|vodafone|digi|nowo|uzo|moche|internet|eletric/i, 'Contas'],
  [/continente|pingo doce|lidl|aldi|mercadona|intermarch|minipre|auchan|jumbo|el corte|padaria|talho|super/i, 'Alimentação'],
  [/propina|escola|col[eé]gio|universid|politécnico|livraria|bertrand|fnac/i, 'Educação'],
  [/\bcp\b|comboios|metro|carris|stcp|muv|uber|bolt|galp frota|bp |prio|portagem|via verde|gasolin|combust/i, 'Transporte'],
  [/farm[aá]cia|hospital|cl[ií]nica|m[eé]dis|multicare|ginásio|gin[aá]sio|fitness|holmes|solinca/i, 'Saúde'],
  [/restaurante|caf[eé]|bar |cinema|netflix|spotify|disney|hbo|steam|playstation|bilhete|viagem|booking|airbnb|ryanair|tap /i, 'Lazer'],
];
function categorizar(desc) { for (const [re, c] of REGRAS_CAT) if (re.test(desc)) return c; return 'Outros'; }
function parseNumeroBR(s) {
  let t = String(s || '').replace(/[^\d,.\-−]/g, '').replace('−', '-');
  if (!t) return NaN;
  if (t.includes(',') && t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  return parseFloat(t);
}
function parseData(s) {
  s = String(s || '').trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) return { y: m[3].length === 2 ? 2000 + +m[3] : +m[3], m: +m[2] };
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return { y: +m[1], m: +m[2] };
  return null;
}
function lerCSV(texto) {
  const linhas = texto.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (linhas.length < 2) throw new Error('vazio');
  const cont = (c) => (linhas[0].match(new RegExp(`\\${c}`, 'g')) || []).length;
  const delim = [';', '\t', ','].sort((a, b) => cont(b) - cont(a))[0];
  const split = (l) => {
    const out = []; let cur = '', q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === delim && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };
  // procura a linha de cabeçalho nas primeiras 10 linhas
  let hi = 0, H = [];
  for (let i = 0; i < Math.min(10, linhas.length); i++) {
    const h = split(linhas[i]).map((x) => x.toLowerCase());
    if (h.some((x) => /data|date/.test(x)) && h.some((x) => /valor|montante|amount|d[ée]bito|cr[ée]dito|importe/.test(x))) { hi = i; H = h; break; }
  }
  if (!H.length) throw new Error('cabeçalho');
  const iData = H.findIndex((x) => /data mov|data valor|^data|date/.test(x));
  const iDesc = H.findIndex((x) => /descri|hist[oó]rico|movimento|description|concept|detalhe/.test(x));
  const iValor = H.findIndex((x) => /^valor|montante|amount|importe/.test(x));
  const iDeb = H.findIndex((x) => /d[ée]bito/.test(x));
  const iCred = H.findIndex((x) => /cr[ée]dito/.test(x));
  const lanc = [];
  for (const l of linhas.slice(hi + 1)) {
    const c = split(l);
    const d = parseData(c[iData]);
    if (!d) continue;
    let v;
    if (iValor >= 0) v = parseNumeroBR(c[iValor]);
    else v = (parseNumeroBR(c[iCred]) || 0) - (parseNumeroBR(c[iDeb]) || 0);
    if (!Number.isFinite(v) || v === 0) continue;
    lanc.push({ mes: mesKey(d), desc: c[iDesc] || '', valor: v });
  }
  return lanc;
}
const mesSelecionado = () => $('#acMes').value || mesKey(hojeMes());
function planejadoDoMes(all, key) {
  const r = all[state.cenarioAtivo];
  const m = mesesEntre(r.sim.mud, parseMes(key));
  const mm = Math.max(0, Math.min(r.sim.H - 1, m));
  const c = calcMes(state, state.cenarioAtivo, mm, { caps: r.sim.capsPosEntrada, modo: 'caixa', desp: r.sim.desp });
  return { m, receitas: c.receitas, porCat: c.desp.porCat, antes: m < 0 };
}
V.acompanhamento = {
  build() {
    if (!$('#acMes').value) $('#acMes').value = mesKey(hojeMes());
    const key = mesSelecionado();
    const reg = state.realizado[key] || { receitas: 0, porCat: {} };
    const all = ultimoAll || calcAll();
    const pl = planejadoDoMes(all, key);
    const linha = (cat, plan, real) => `<tr data-cat="${esc(cat)}"><td>${cat}</td><td class="num">${eur(plan)}</td><td>${`<input type="number" step="1" data-real="${esc(cat)}" value="${real ? Math.round(real * 100) / 100 : ''}" placeholder="0">`}</td><td class="num out" data-dif="${esc(cat)}"></td></tr>`;
    $('#tblAc').innerHTML = `<thead><tr><th>Linha</th><th class="num">Planejado</th><th class="num">Realizado</th><th class="num">Diferença</th></tr></thead><tbody>
      ${linha('Receitas', pl.receitas, reg.receitas)}
      ${CATS.map((c) => linha(c, pl.porCat[c] || 0, (reg.porCat || {})[c])).join('')}
      <tr class="calc"><td>Sobra</td><td class="num" id="acSobraPlan"></td><td class="num" id="acSobraReal"></td><td class="num out" id="acSobraDif"></td></tr></tbody>`;
    $('#acNote').textContent = pl.antes ? 'mês antes da mudança: comparado com o primeiro mês planejado' : `mês ${pl.m} depois da mudança, cenário ${SC_LABEL[state.cenarioAtivo]}`;
  },
  update(all) {
    const key = mesSelecionado();
    const reg = state.realizado[key] || { receitas: 0, porCat: {} };
    const pl = planejadoDoMes(all, key);
    const realCat = (c) => num((reg.porCat || {})[c]);
    const pTot = CATS.reduce((s, c) => s + (pl.porCat[c] || 0), 0);
    const rTot = CATS.reduce((s, c) => s + realCat(c), 0);
    const setDif = (cat, plan, real, receita) => {
      const td = $(`[data-dif="${cat}"]`);
      if (!td) return;
      const d = real - plan;
      td.textContent = real ? `${d >= 0 ? '+' : ''}${eur(d)}` : '—';
      td.className = `num out ${!real ? 'muted' : (receita ? d >= 0 : d <= 0) ? 'pos' : 'neg'}`;
    };
    setDif('Receitas', pl.receitas, num(reg.receitas), true);
    CATS.forEach((c) => setDif(c, pl.porCat[c] || 0, realCat(c), false));
    const sP = pl.receitas - pTot, sR = num(reg.receitas) - rTot;
    if ($('#acSobraPlan')) {
      $('#acSobraPlan').textContent = eur(sP);
      $('#acSobraReal').textContent = state.realizado[key] ? eur(sR) : '—';
      $('#acSobraDif').textContent = state.realizado[key] ? `${sR - sP >= 0 ? '+' : ''}${eur(sR - sP)}` : '—';
      $('#acSobraDif').className = `num out ${state.realizado[key] ? (sR >= sP ? 'pos' : 'neg') : 'muted'}`;
    }
    chart('chAc', 'bar', {
      labels: CATS,
      datasets: [
        { label: 'Planejado', data: CATS.map((c) => pl.porCat[c] || 0), backgroundColor: cssVar('--azulejo') + '66', borderRadius: 3 },
        { label: 'Realizado', data: CATS.map((c) => realCat(c)), backgroundColor: cssVar('--azulejo'), borderRadius: 3 },
      ],
    }, baseOpts({
      indexAxis: 'y',
      plugins: { ...baseOpts().plugins, legend: { ...baseOpts().plugins.legend, position: 'bottom' }, tooltip: tooltipFmt((v) => eur(v)) },
      scales: { x: yEur(), y: { ...baseOpts().scales.x } },
    }));
    const meses = Object.keys(state.realizado).sort().reverse();
    $('#tblAcHist').innerHTML = `<thead><tr><th>Mês</th><th class="num">Receitas</th><th class="num">Despesas</th><th class="num">Sobra real</th><th class="num">Sobra planejada</th><th class="num">Diferença</th><th>Origem</th><th></th></tr></thead><tbody>${
      meses.length ? meses.map((mk) => {
        const g = state.realizado[mk];
        const dTot = Object.values(g.porCat || {}).reduce((s, v) => s + num(v), 0);
        const p = planejadoDoMes(all, mk);
        const pS = p.receitas - Object.values(p.porCat).reduce((s, v) => s + v, 0);
        const rS = num(g.receitas) - dTot;
        return `<tr data-mes="${mk}"><td><button class="link" data-ir="${mk}">${mesLabel(parseMes(mk))}</button></td><td class="num">${eur(num(g.receitas))}</td><td class="num">${eur(dTot)}</td><td class="num out">${eur(rS)}</td><td class="num">${eur(pS)}</td><td class="num ${rS >= pS ? 'pos' : 'neg'}">${rS - pS >= 0 ? '+' : ''}${eur(rS - pS)}</td><td class="small muted">${g.fonte === 'csv' ? `extrato, ${num(g.n)} lançamentos` : 'digitado'}</td><td class="c-del"><button class="icon-btn" data-rmmes="${mk}" title="Apagar mês" aria-label="Apagar mês"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button></td></tr>`;
      }).join('') : '<tr><td colspan="8" class="muted">Nenhum mês registrado. Digite os valores na tabela ou importe um extrato.</td></tr>'
    }</tbody>`;
  },
};
$('#acMes').addEventListener('change', () => { V.acompanhamento.build(); refresh(); });
$('#tblAc').addEventListener('input', (e) => {
  const el = e.target.closest('[data-real]');
  if (!el) return;
  const key = mesSelecionado();
  const g = (state.realizado[key] = state.realizado[key] || { receitas: 0, porCat: {}, fonte: 'manual' });
  const v = num(el.value);
  if (el.dataset.real === 'Receitas') g.receitas = v; else g.porCat[el.dataset.real] = v;
  if (g.fonte !== 'csv') g.fonte = 'manual';
  save(); refresh();
});
$('#tblAcHist').addEventListener('click', async (e) => {
  const ir = e.target.closest('[data-ir]');
  if (ir) { $('#acMes').value = ir.dataset.ir; V.acompanhamento.build(); refresh(); return; }
  const rm = e.target.closest('[data-rmmes]');
  if (!rm) return;
  if (!(await confirmar(`Apagar os valores de ${mesLabel(parseMes(rm.dataset.rmmes))}?`, 'Apagar'))) return;
  delete state.realizado[rm.dataset.rmmes];
  save(); V.acompanhamento.build(); refresh();
});
$('#acLimpar').addEventListener('click', async () => {
  const key = mesSelecionado();
  if (!state.realizado[key]) return toast('Este mês não tem valores.');
  if (!(await confirmar(`Apagar os valores de ${mesLabel(parseMes(key))}?`, 'Apagar'))) return;
  delete state.realizado[key];
  save(); V.acompanhamento.build(); refresh();
});
$('#acCsv').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      let txt = rd.result;
      if (/�/.test(txt)) { /* tenta de novo em latin1 */ }
      const lanc = lerCSV(txt);
      if (!lanc.length) throw new Error('sem lançamentos');
      const porMes = {};
      let outros = 0;
      for (const l of lanc) {
        const g = (porMes[l.mes] = porMes[l.mes] || { receitas: 0, porCat: {}, fonte: 'csv', n: 0 });
        g.n++;
        if (l.valor > 0) g.receitas += l.valor;
        else { const c = categorizar(l.desc); if (c === 'Outros') outros++; g.porCat[c] = (g.porCat[c] || 0) - l.valor; }
      }
      Object.assign(state.realizado, porMes);
      const meses = Object.keys(porMes).sort();
      $('#acMes').value = meses[meses.length - 1];
      save(); V.acompanhamento.build(); refresh();
      toast(`${lanc.length} lançamentos em ${meses.length} ${meses.length === 1 ? 'mês' : 'meses'}; ${outros} sem categoria foram para Outros.`);
    } catch (err) {
      toast('Não reconheci o extrato. O arquivo precisa ter colunas de data e de valor (ou débito e crédito).');
    }
    e.target.value = '';
  };
  rd.readAsText(f, 'utf-8');
});

/* ---------- RELATÓRIO PDF ---------- */
async function gerarRelatorio(opcoes = {}) {
  const all = calcAll();
  const r = all[state.cenarioAtivo];
  const fam = r.fam;
  const linhaSc = (label, f) => `<tr><td>${label}</td>${SC.map((k) => `<td class="num">${f(all[k])}</td>`).join('')}</tr>`;
  const box = $('#report');
  box.innerHTML = `
    <header class="rp-head"><h1>Planejamento da mudança para ${esc(cidadeNome())}</h1>
      <p>${esc(fam.adultos.map((p) => p.nome).join(', '))}${fam.C ? ` e ${fam.C} ${fam.C === 1 ? 'criança' : 'crianças'}` : ''}; mudança em ${mesLabel(r.sim.mud)}; gerado em ${new Date().toLocaleDateString('pt-BR')}.</p></header>
    <h2>Resumo dos cenários</h2>
    <table class="rp"><thead><tr><th></th>${SC.map((k) => `<th class="num">${SC_LABEL[k]}</th>`).join('')}</tr></thead><tbody>
      ${linhaSc('Câmbio (R$/€)', (x) => nf(2).format(x.tip.cambio))}
      ${linhaSc('Chega em Portugal por mês', (x) => eur(x.receitas))}
      ${linhaSc('Despesas por mês', (x) => eur(x.despesas))}
      ${linhaSc('Sobra antes de poupar', (x) => eur(x.sobra))}
      ${linhaSc('Custo da mudança', (x) => brl(x.entradaBRL))}
      ${linhaSc('Patrimônio na mudança', (x) => brl(x.sim.patrimonioMudancaBRL))}
      ${linhaSc('Mês mais apertado', (x) => eur(x.sim.menor.saldo))}
      ${linhaSc(`Patrimônio após ${r.sim.H} meses`, (x) => eur(x.sim.patrimonioFinalEUR))}
      ${linhaSc('IRS estimado por ano', (x) => eur(x.tip.imp.escolhida.total))}
      ${linhaSc('Reserva ÷ exigência do D7', (x) => nf(1).format(x.d7Ratio) + '×')}
    </tbody></table>
    <div class="rp-charts"><figure><img id="rpImg1" alt=""><figcaption>Do Brasil até ${esc(cidadeNome())}, cenário ${SC_LABEL[state.cenarioAtivo]}</figcaption></figure>
      <figure><img id="rpImg2" alt=""><figcaption>Patrimônio até a mudança e depois</figcaption></figure></div>
    <h2>Rendas (mês ${num(state.plano.mesReferencia)}, cenário ${SC_LABEL[state.cenarioAtivo]})</h2>
    <table class="rp"><thead><tr><th>Renda</th><th>Tipo</th><th class="num">Bruto/mês</th><th class="num">Chega em €</th></tr></thead><tbody>
      ${r.tip.rend.filter((x) => x.ativo).map((x) => `<tr><td>${esc(x.nome)}</td><td>${TIPOS[x.tipo]}</td><td class="num">${x.moeda === 'EUR' ? eur(num(x.valor)) : brl(num(x.valor))}</td><td class="num">${x.ativa ? eur(x.eur) : 'fora'}</td></tr>`).join('')}
      ${r.tip.inv.map((x) => `<tr><td>${esc(x.nome)}</td><td>Investimento</td><td class="num">${brl(x.brutoMes)}</td><td class="num">${eur(x.eur)}</td></tr>`).join('')}
    </tbody></table>
    <h2>Despesas em ${esc(cidadeNome())}</h2>
    <table class="rp"><thead><tr><th>Despesa</th><th>Categoria</th><th class="num">€/mês</th></tr></thead><tbody>
      ${r.sim.desp.items.filter((d) => d.ativo && d.eur).map((d) => `<tr><td>${esc(d.nome)}</td><td>${esc(d.cat)}</td><td class="num">${eur(d.eur)}</td></tr>`).join('')}
      <tr class="tot"><td colspan="2">Total</td><td class="num">${eur(r.despesas)}</td></tr></tbody></table>
    <h2>Custos da mudança</h2>
    <table class="rp"><thead><tr><th>Custo</th><th class="num">Em reais</th></tr></thead><tbody>
      ${r.sim.ent.items.map((e) => `<tr><td>${esc(e.nome)}${e.porPessoa ? ` (${e.qtd}×)` : ''}</td><td class="num">${brl(e.brl)}</td></tr>`).join('')}
      <tr><td>Aluguel adiantado e caução</td><td class="num">${brl(r.sim.ent.aluguelAdiantadoBRL)}</td></tr>
      <tr class="tot"><td>Total</td><td class="num">${brl(r.entradaBRL)}</td></tr></tbody></table>
    <h2>Impostos em Portugal (${r.tip.imp.ano})</h2>
    <p>Opção mais barata: ${r.tip.imp.escolhida.regime === 'autonomo' ? 'taxas autónomas' : 'englobamento'}, declaração ${r.tip.imp.escolhida.conjunta ? 'conjunta' : 'separada'}: ${eur(r.tip.imp.escolhida.total)} por ano, depois do crédito do IR pago no Brasil. Estimativa para revisão com contador.</p>
    ${(state.vagas || []).filter((v) => num(v.brutoAnual) > 0).length ? `<h2>Vagas em Portugal analisadas</h2>
    <table class="rp"><thead><tr><th>Vaga</th><th class="num">Bruto/ano</th><th class="num">Líquido/mês</th><th class="num">Sobra com a vaga</th></tr></thead><tbody>
      ${state.vagas.filter((v) => num(v.brutoAnual) > 0).map((v) => { const x = simularVaga(v); return `<tr><td>${esc(v.titulo)}${v.empresa ? `, ${esc(v.empresa)}` : ''}</td><td class="num">${eur(x.bruto_anual)}</td><td class="num">${eur(x.liquido_mes)}</td><td class="num">${eur(x.sobra_com_vaga)}</td></tr>`; }).join('')}
    </tbody></table>` : ''}
    ${(state.decisoes || []).length ? `<h2>Decisões registradas</h2>
    <ul class="rp-list">${state.decisoes.slice(-15).reverse().map((d) => `<li><b>${new Date(d.data).toLocaleDateString('pt-BR')}</b> ${esc(d.texto)}${d.antes !== null && d.depois !== null && d.antes !== d.depois ? ` (sobra ${eur(d.antes)} → ${eur(d.depois)})` : ''}</li>`).join('')}</ul>` : ''}
    <h2>Pendências do checklist</h2>
    <ul class="rp-list">${state.tarefas.filter((t) => t.status !== 'feito').sort((a, b) => num(a.quando) - num(b.quando)).map((t) => `<li><b>${mesLabel(addMes(r.sim.mud, num(t.quando)))}</b> ${esc(t.titulo)}</li>`).join('') || '<li>Nenhuma pendência.</li>'}</ul>
    <p class="rp-foot">Valores de referência de 2026. Não substitui a orientação de contador e advogado de imigração.</p>
    <div class="rp-offscreen"><div class="rp-cbox"><canvas id="rpC1" width="900" height="380"></canvas></div><div class="rp-cbox"><canvas id="rpC2" width="900" height="380"></canvas></div></div>`;

  // gráficos sem animação, desenhados fora da tela e convertidos em imagem
  window.__semAnimacao = true;
  const t = r.tip;
  const steps = [['Rendas brutas', t.brutoEq, 'total'], ['IR no Brasil', -t.impBR, 'd'], ['IRS e Seg. Social', -(t.impPT + t.ss), 'd'], ['IOF e tarifa', -t.remessa, 'd'], ['Chega em PT', t.receitas, 'total'],
    ...Object.entries(r.sim.desp.porCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, -v, 'd']), ['Sobra', t.sobra, 'end']];
  let run = 0;
  const bars = steps.map(([, v, k]) => { if (k === 'total') { run = v; return [0, v]; } if (k === 'end') return [0, v]; const s = run; run += v; return [s, run]; });
  const claro = { ink: '#18202C', line: '#D9DEE4', az: '#1F4E9C', dao: '#9A2E3F', mu: '#2F7A4A' };
  const opt = (extra) => ({ responsive: false, animation: false, plugins: { legend: { display: !!extra, labels: { color: claro.ink } } }, scales: { x: { ticks: { color: claro.ink }, grid: { display: false } }, y: { ticks: { color: claro.ink, callback: (v) => eur(v) }, grid: { color: claro.line } } } });
  const c1 = new Chart($('#rpC1'), { type: 'bar', data: { labels: steps.map((s) => s[0]), datasets: [{ data: bars, backgroundColor: steps.map(([, v, k]) => k === 'total' ? claro.az : k === 'end' ? (v >= 0 ? claro.mu : claro.dao) : claro.dao + 'B0'), borderRadius: 3 }] }, options: opt(false) });
  const tl = serieTimeline(all);
  const cores = { base: claro.az, conservador: '#B7802A', estresse: claro.dao };
  const c2 = new Chart($('#rpC2'), { type: 'line', data: { labels: tl.labels, datasets: tl.datasets.map((d, i) => ({ ...d, borderColor: cores[SC[i]], backgroundColor: cores[SC[i]] })) }, options: { ...opt(true), plugins: { legend: { position: 'bottom', labels: { color: claro.ink } }, marcaX: { index: tl.idxMudanca, label: 'Mudança', color: '#5E6B7A' } } }, plugins: [marcaX] });
  $('#rpImg1').src = c1.toBase64Image();
  $('#rpImg2').src = c2.toBase64Image();
  c1.destroy(); c2.destroy();
  window.__semAnimacao = false;
  $('.rp-offscreen').remove();

  await new Promise((res) => setTimeout(res, 150));
  if (opcoes.destino === 'drive') {
    const r = await window.net.sync.pdf();
    if (!r || !r.ok) throw new Error((r && r.error) || 'falha ao gravar');
    return r;
  }
  const nome = `planejamento-${cidadeDe(state).id}-${hojeISO()}.pdf`;
  if (window.net && window.net.pdf) {
    const res = await window.net.pdf(nome);
    if (res && res.ok) toast('Relatório salvo e aberto');
    else if (res && res.error) toast(`Não foi possível gerar o PDF: ${res.error}`);
  } else {
    window.print();
  }
}
$('#btnPdf').addEventListener('click', () => { gerarRelatorio().catch((e) => toast('Não foi possível gerar o relatório.')); });

/* ---------- BACKUP AUTOMÁTICO ---------- */
const temBackup = () => !!(window.net && window.net.backup);
async function bkInfo() {
  if (!temBackup()) { $('#bkInfo').textContent = 'disponível no app para Windows'; $('#bkPasta').disabled = true; $('#bkAgora').disabled = true; $('#bkAuto').disabled = true; return; }
  const i = await window.net.backup.info();
  $('#bkInfo').textContent = i && i.dir ? `${i.dir}${i.ultimo ? `, último em ${new Date(i.ultimo).toLocaleString('pt-BR')}` : ''}` : 'nenhuma pasta escolhida';
  $('#bkAuto').checked = !!state.config.backupAuto;
  $('#bkAuto').disabled = !(i && i.dir);
  $('#bkAgora').disabled = !(i && i.dir);
}
async function fazerBackup(avisar) {
  if (!temBackup()) return;
  const r = await window.net.backup.write(JSON.stringify(copiaSemSegredos()));
  if (avisar) toast(r && r.ok ? 'Backup feito' : `Backup falhou: ${(r && r.error) || 'sem pasta'}`);
  bkInfo();
}
let bkTimer = null;
aoSalvar.push(() => {
  if (!state.config.backupAuto || !temBackup()) return;
  clearTimeout(bkTimer);
  bkTimer = setTimeout(() => fazerBackup(false), 4000);
});
$('#bkPasta').addEventListener('click', async () => {
  if (!temBackup()) return;
  const r = await window.net.backup.choose();
  if (r && r.dir) { state.config.backupAuto = true; save(); await fazerBackup(true); }
  bkInfo();
});
$('#bkAuto').addEventListener('change', (e) => { state.config.backupAuto = e.target.checked; save(); });
$('#bkAgora').addEventListener('click', () => fazerBackup(true));
V.dados = { build() { bkInfo(); }, update() {} };

// abre o app no painel
go('painel');
