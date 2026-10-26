'use strict';

/* =========================================================
   Aba Vasco: resumo da semana (com ou sem IA), regras vigiadas
   na internet, diário de decisões e documentos analisados.
   ========================================================= */

/* ---------- resumo da semana ---------- */
const FREQ_DIAS = { diario: 1, semanal: 7, desligado: 0 };

function fotoAtual() {
  const all = calcAll();
  const r = all[state.cenarioAtivo];
  const v = state.viagem || {};
  const oferta = v.ofertas && v.ofertas[0] && v.rotaBuscada === `${v.origem}-${v.destino}-${v.data}` ? Math.round(v.ofertas[0].precoBRL) : null;
  return {
    t: Date.now(), euro: state.mercado.eur ? +state.mercado.eur.bid : null, cambioPlano: r.tip.cambio, cenario: state.cenarioAtivo,
    sobra: Math.round(r.sobra), reserva: Math.round(r.reservaEUR), patrimonioFinal: Math.round(r.sim.patrimonioFinalEUR), custoMudanca: Math.round(r.entradaBRL),
    passagem: oferta, rota: v.origem ? `${v.origem}-${v.destino}` : '', tarefasFeitas: state.tarefas.filter((t) => t.status === 'feito').length,
    meses: Object.keys(state.realizado || {}).sort(), vagas: (state.vagas || []).length,
  };
}

function montarResumo() {
  const ant = (state.assistente || {}).foto || null;
  const cur = fotoAtual();
  const itens = [];
  const add = (nivel, texto) => itens.push({ nivel, texto });
  const pc = (a, b) => (a ? ((b / a) - 1) * 100 : 0);
  const mud = parseMes(state.plano.dataMudanca);
  const hoje = hojeMes();
  const faltam = mesesEntre(hoje, mud);
  if (faltam > 0) add('info', `Faltam ${faltam} ${faltam === 1 ? 'mês' : 'meses'} para a mudança (${mesLabel(mud)}).`);

  if (cur.euro) {
    const vsPlano = pc(cur.cambioPlano, cur.euro);
    let t = `Euro a R$ ${nf(2).format(cur.euro)}`;
    if (ant && ant.euro) { const d = pc(ant.euro, cur.euro); if (Math.abs(d) >= 0.1) t += `, ${d >= 0 ? 'subiu' : 'caiu'} ${nf(1).format(Math.abs(d))}% desde ${new Date(ant.t).toLocaleDateString('pt-BR')}`; else t += `, estável desde ${new Date(ant.t).toLocaleDateString('pt-BR')}`; }
    t += vsPlano > 0.5 ? `; está ${nf(1).format(vsPlano)}% acima do câmbio do cenário (R$ ${nf(2).format(cur.cambioPlano)}).` : `; abaixo ou perto do câmbio do cenário (R$ ${nf(2).format(cur.cambioPlano)}).`;
    add(vsPlano > 3 ? 'alerta' : 'info', t);
    if (num(state.config.alertaEuro) && cur.euro <= num(state.config.alertaEuro)) add('bom', `O euro está abaixo do seu alvo de R$ ${nf(2).format(state.config.alertaEuro)}: bom momento para comprar.`);
  }
  if (ant && ant.cenario === cur.cenario && ant.sobra !== cur.sobra) add(cur.sobra >= ant.sobra ? 'bom' : 'alerta', `A sobra mensal do plano foi de ${eur(ant.sobra)} para ${eur(cur.sobra)}.`);
  else add(cur.sobra >= num(state.metas.poupanca) ? 'bom' : 'alerta', `Sobra de ${eur(cur.sobra)} por mês no cenário ${SC_LABEL[cur.cenario]}${cur.sobra < num(state.metas.poupanca) ? `, abaixo da meta de ${eur(state.metas.poupanca)}` : ''}.`);
  if (cur.passagem) {
    let t = `Passagem ${cur.rota.replace('-', ' → ')} a partir de ${brl(cur.passagem)} por pessoa`;
    if (ant && ant.passagem && ant.rota === cur.rota && ant.passagem !== cur.passagem) t += ` (era ${brl(ant.passagem)})`;
    const alvo = num((state.viagem || {}).alertaPreco);
    add(alvo && cur.passagem <= alvo ? 'bom' : 'info', t + (alvo && cur.passagem <= alvo ? ', abaixo do seu alvo.' : '.'));
  }
  // checklist
  const pend = state.tarefas.filter((t) => t.status !== 'feito').map((t) => ({ t, cal: addMes(mud, num(t.quando)) }));
  const atrasadas = pend.filter((x) => mesesEntre(hoje, x.cal) < 0);
  const proximas = pend.filter((x) => { const d = mesesEntre(hoje, x.cal); return d >= 0 && d <= 2; }).sort((a, b) => num(a.t.quando) - num(b.t.quando));
  if (atrasadas.length) add('alerta', `${atrasadas.length} ${atrasadas.length === 1 ? 'tarefa atrasada' : 'tarefas atrasadas'}: ${atrasadas.slice(0, 3).map((x) => x.t.titulo).join('; ')}${atrasadas.length > 3 ? '…' : ''}.`);
  if (proximas.length) add('info', `Para os próximos 2 meses: ${proximas.slice(0, 4).map((x) => `${x.t.titulo} (${mesLabel(x.cal)})`).join('; ')}.`);
  // euros
  if (typeof planoCompraEuros === 'function') {
    const p = planoCompraEuros();
    if (p && p.faltam > 0 && p.meses > 0) add('info', `Para juntar ${eur(p.meta)} até a mudança, faltam ${eur(p.faltam)}: cerca de ${eur(p.porMes)} por mês${p.reaisMes ? ` (${brl(p.reaisMes)} ao câmbio de hoje)` : ''}.`);
  }
  // acompanhamento
  const novosMeses = ant ? cur.meses.filter((m) => !ant.meses.includes(m)) : [];
  if (novosMeses.length) add('info', `Novo mês no acompanhamento: ${novosMeses.join(', ')}. Peça ao Vasco para analisar.`);
  // regras
  const rg = (state.assistente || {}).regras;
  const difs = rg ? regrasComValores().filter((x) => x.diferente) : [];
  if (difs.length) add('alerta', `Regras que podem ter mudado: ${difs.map((x) => x.nome).join('; ')}. Veja em Regras vigiadas.`);
  // vagas
  const vg = (state.vagas || []).filter((v) => ['entrevista', 'proposta'].includes(v.status));
  if (vg.length) add('bom', `${vg.length} ${vg.length === 1 ? 'vaga em entrevista ou proposta' : 'vagas em entrevista ou proposta'}: ${vg.map((v) => v.titulo).join('; ')}.`);
  return { desde: ant ? ant.t : null, itens, foto: cur };
}

async function resumoComIA(res) {
  if (!window.net || !window.net.ia) return null;
  const st = await window.net.ia.status();
  if (!st.temChave) return null;
  await modeloAtual(false);
  const r = await chamarGroq({
    model: modeloAuxiliar(), reasoning_effort: 'low', max_completion_tokens: 600,
    messages: [
      { role: 'system', content: `Você é ${NOME_IA}, assistente de um plano de mudança do Brasil para Portugal. Hoje é ${new Date().toLocaleDateString('pt-BR')}. Escreva em português do Brasil, direto e caloroso.` },
      { role: 'user', content: `Escreva o resumo ${state.config.resumoFreq === 'diario' ? 'do dia' : 'da semana'} do plano em até 120 palavras: 3 a 5 tópicos curtos, do mais importante ao menos, e termine com uma sugestão concreta do que fazer agora. Use só estes fatos (não invente números):\n${JSON.stringify(res.itens.map((i) => i.texto))}` },
    ],
  }, { espera: 20000 });
  if (!r || !r.ok) return null;
  return String((r.data.choices[0].message || {}).content || '').trim() || null;
}

async function gerarResumo({ automatico = false } = {}) {
  const res = montarResumo();
  state.assistente = state.assistente || {};
  state.assistente.ultimoResumo = { t: Date.now(), itens: res.itens, desde: res.desde };
  const texto = await resumoComIA(res);
  if (texto) {
    state.assistente.ultimoResumo.texto = texto;
    iaMsgs.push({ role: 'resumo', content: texto });
    salvarHistorico();
    if ($('#iaDrawer').hidden) avisoIA(true); else desenharChat();
    if (automatico) toast(`${NOME_IA} preparou o resumo ${state.config.resumoFreq === 'diario' ? 'do dia' : 'da semana'}`);
  } else if (automatico) {
    avisoIA(true);
    toast('Resumo da semana pronto na aba Vasco');
  }
  state.assistente.foto = res.foto;
  save();
  if (viewAtual === 'vasco') refresh();
  return res;
}

/* ---------- regras vigiadas ---------- */
const REGRAS = [
  { id: 'salarioMinimo', nome: 'Salário mínimo em Portugal', unidade: '€ por mês', caminho: 'metas.salarioMinimo', atual: () => num(state.metas.salarioMinimo), uso: 'D7, D8 e meta de renda',
    pergunta: 'Salário mínimo nacional mensal em Portugal mais recente já aprovado (indique o ano de vigência)' },
  { id: 'taxaConsular', nome: 'Taxa do visto nacional (tipo D)', unidade: '€', caminho: 'config.taxaConsular', atual: () => num(state.config.taxaConsular) || 110, uso: 'custo do visto',
    pergunta: 'Valor da taxa do visto nacional (tipo D) cobrada pelos consulados de Portugal no Brasil, em euros' },
  { id: 'anosNacionalidade', nome: 'Anos de residência para a nacionalidade (brasileiros)', unidade: 'anos', caminho: 'config.anosNacionalidade', atual: () => num(state.config.anosNacionalidade) || 7, uso: 'linha do tempo dos vistos',
    pergunta: 'Anos de residência legal exigidos para a naturalização portuguesa de cidadãos brasileiros (Lei da Nacionalidade em vigor)' },
  { id: 'anosBisneto', nome: 'Anos de residência para bisnetos', unidade: 'anos', caminho: 'config.anosBisneto', atual: () => num(state.config.anosBisneto) || 5, uso: 'caminho do bisneto',
    pergunta: 'Anos de residência legal para a naturalização de bisnetos de portugueses (art. 6.º, n.º 8 da Lei da Nacionalidade)' },
  { id: 'limiarCartaoAzul', nome: 'Salário mínimo do Cartão Azul UE', unidade: '€ por ano', caminho: 'config.limiarCartaoAzul', atual: () => num(state.config.limiarCartaoAzul) || 21030, uso: 'aba Vagas',
    pergunta: 'Limiar salarial anual bruto do Cartão Azul UE em Portugal para o ano atual' },
  { id: 'ias', nome: 'IAS (Indexante dos Apoios Sociais)', unidade: '€', caminho: null, atual: () => IRS.ias, uso: 'dedução específica e IRS Jovem (atualizado pelo app)',
    pergunta: 'Valor do IAS em Portugal para o ano atual' },
  { id: 'd8Multiplo', nome: 'Renda exigida no D8 (em salários mínimos)', unidade: 'salários mínimos', caminho: null, atual: () => 4, uso: 'avaliação do D8 (atualizado pelo app)',
    pergunta: 'Quantos salários mínimos de renda média mensal são exigidos para o visto D8 de trabalho remoto em Portugal' },
  { id: 'regulamento', nome: 'Regulamentação do teste para netos', unidade: '', caminho: null, atual: () => null, uso: 'caminho do neto', texto: true,
    pergunta: 'O novo Regulamento da Nacionalidade Portuguesa, que define o teste de cultura e de direitos para netos após a Lei Orgânica 1/2026, já foi publicado? Em que data e o que exige?' },
];

function regrasComValores() {
  const enc = ((state.assistente || {}).regras || {}).itens || {};
  return REGRAS.map((g) => {
    const e = enc[g.id];
    const atual = g.atual();
    const achado = e && Number.isFinite(+e.valor) && e.valor !== null && e.valor !== '' ? +e.valor : null;
    const diferente = !g.texto && achado !== null && atual !== null && Math.abs(achado - atual) > 1e-6;
    return { id: g.id, nome: g.nome, unidade: g.unidade, no_app: atual, uso: g.uso, encontrado: achado, texto: e ? e.texto : '', fonte: e ? e.fonte : '', data_fonte: e ? e.data : '', confianca: e ? e.confianca : '', diferente, editavel: !!g.caminho, aplicado: e ? e.aplicado : false };
  });
}

function extrairJSON(txt) {
  const s = String(txt || '');
  const ini = s.indexOf('{'), fim = s.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try { return JSON.parse(s.slice(ini, fim + 1)); } catch (e) { return null; }
}

let verificandoRegras = false;
async function verificarRegras({ automatico = false } = {}) {
  if (verificandoRegras) return;
  if (!window.net || !window.net.ia || !(await window.net.ia.status()).temChave) { if (!automatico) toast(`Conecte a chave da Groq para o ${NOME_IA} verificar as regras.`); return; }
  verificandoRegras = true;
  const btn = $('#vzRegrasBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Pesquisando…'; }
  try {
    const lista = REGRAS.map((g) => `- id "${g.id}": ${g.pergunta}. Valor usado hoje no app: ${g.atual() === null ? '(texto)' : `${g.atual()} ${g.unidade}`}`).join('\n');
    await modeloAtual(false);
    const r = await chamarGroq({
      model: modeloBusca(), max_completion_tokens: 1800,
      tools: [{ type: 'browser_search' }], tool_choice: 'required', reasoning_effort: 'low',
      messages: [
        { role: 'system', content: `Hoje é ${new Date().toLocaleDateString('pt-BR')}. Você verifica regras de imigração e de impostos de Portugal em fontes oficiais (Diário da República, AIMA, MNE/Vistos, IRN, Segurança Social) ou jornais confiáveis. Responda SOMENTE com um JSON válido, sem texto fora dele.` },
        { role: 'user', content: `Pesquise o valor em vigor de cada item:\n${lista}\n\nFormato: {"regras":[{"id":"...","valor":número ou null,"texto":"uma frase com o que encontrou","fonte":"URL","data":"data da fonte","confianca":"alta|media|baixa"}]}. Use null quando não achar fonte confiável. Para o item regulamento, valor é null e o texto responde a pergunta.` },
      ],
    }, { modelos: modelosBusca(), espera: 60000 });
    if (!r || !r.ok) throw new Error((r && r.error) || 'sem resposta');
    const j = extrairJSON((r.data.choices[0].message || {}).content);
    if (!j || !Array.isArray(j.regras)) throw new Error('a resposta da pesquisa veio fora do formato');
    const itens = {};
    for (const x of j.regras) if (x && REGRAS.some((g) => g.id === x.id)) itens[x.id] = { valor: x.valor === null || x.valor === '' ? null : +x.valor, texto: String(x.texto || '').slice(0, 400), fonte: /^https?:\/\//.test(x.fonte || '') ? String(x.fonte).slice(0, 400) : '', data: String(x.data || '').slice(0, 40), confianca: String(x.confianca || '') };
    state.assistente = state.assistente || {};
    state.assistente.regras = { em: Date.now(), itens };
    save();
    const difs = regrasComValores().filter((x) => x.diferente).length;
    if (!automatico || difs) toast(difs ? `${difs} ${difs === 1 ? 'regra pode ter mudado' : 'regras podem ter mudado'}. Veja na aba Vasco.` : 'Regras conferidas: nada mudou');
    if (difs && automatico) avisoIA(true);
  } catch (e) {
    if (!automatico) toast(`Não consegui verificar agora: ${e.message}`);
  }
  verificandoRegras = false;
  if (btn) { btn.disabled = false; btn.textContent = 'Verificar agora'; }
  if (viewAtual === 'vasco') refresh();
}

function aplicarRegra(id) {
  const g = REGRAS.find((x) => x.id === id);
  const e = (((state.assistente || {}).regras || {}).itens || {})[id];
  if (!g || !g.caminho || !e || e.valor === null) return;
  const antes = g.atual();
  const sobraAntes = calcAll()[state.cenarioAtivo].sobra;
  const [raiz, campo] = g.caminho.split('.');
  state[raiz][campo] = e.valor;
  e.aplicado = true;
  registrarDecisao(`Regra atualizada: ${g.nome} de ${antes} para ${e.valor} ${g.unidade}`, { origem: 'Regras vigiadas', fonte: e.fonte, alteracoes: [`${g.caminho} = ${e.valor}`], antes: sobraAntes, depois: calcAll()[state.cenarioAtivo].sobra });
  save(); refresh();
  toast(`${g.nome}: ${e.valor} ${g.unidade}`);
}

/* ---------- a aba ---------- */
const NIVEL_ICO = { alerta: '!', bom: '✓', info: 'i' };
V.vasco = {
  build() {
    $('#vzFreq').value = state.config.resumoFreq || 'semanal';
    $('#vzRegrasAuto').checked = state.config.regrasAuto !== false;
  },
  async update() {
    const a = (state.assistente || {});
    const ult = a.ultimoResumo;
    const res = ult && Date.now() - ult.t < 36 * 3600e3 ? ult : { itens: montarResumo().itens, t: null };
    $('#vzResumoQuando').textContent = ult ? `gerado em ${new Date(ult.t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'ainda não gerado';
    $('#vzResumo').innerHTML = (res.texto ? `<div class="vz-ia">${md(res.texto)}</div>` : '') + `<ul class="vz-itens">${res.itens.map((i) => `<li class="${i.nivel}"><i>${NIVEL_ICO[i.nivel]}</i><span>${esc(i.texto)}</span></li>`).join('')}</ul>`;

    // regras
    const rg = regrasComValores();
    const em = a.regras && a.regras.em;
    $('#vzRegrasQuando').textContent = em ? `verificadas em ${new Date(em).toLocaleDateString('pt-BR')}` : 'ainda não verificadas';
    $('#tblRegras').innerHTML = `<thead><tr><th>Regra</th><th class="num">No app</th><th>Encontrado na internet</th><th></th></tr></thead><tbody>${rg.map((x) => `<tr class="${x.diferente ? 'dif' : ''}">
      <td><b>${esc(x.nome)}</b><small class="muted block">usado em: ${esc(x.uso)}</small></td>
      <td class="num">${x.no_app === null ? '—' : `${nf(x.no_app % 1 ? 2 : 0).format(x.no_app)}<small class="muted block">${esc(x.unidade)}</small>`}</td>
      <td>${x.encontrado !== null || x.texto ? `${x.encontrado !== null ? `<b>${nf(x.encontrado % 1 ? 2 : 0).format(x.encontrado)}</b> ` : ''}${esc(x.texto)}${x.fonte ? ` <a href="${esc(x.fonte)}" target="_blank">fonte</a>` : ''}${x.data_fonte ? ` <small class="muted">(${esc(x.data_fonte)})</small>` : ''}${x.confianca ? ` <span class="pill ${x.confianca === 'alta' ? 'ok' : 'warn'}">${esc(x.confianca)}</span>` : ''}` : '<span class="muted">—</span>'}</td>
      <td>${x.diferente ? (x.editavel ? (x.aplicado ? '<span class="pill ok">aplicado</span>' : `<button data-regra="${x.id}">Usar no app</button>`) : '<span class="pill warn">o app precisa ser atualizado</span>') : x.encontrado !== null ? '<span class="pill ok">igual</span>' : ''}</td></tr>`).join('')}</tbody>`;

    // diário
    const ds = (state.decisoes || []).slice().reverse();
    $('#tblDecisoes').innerHTML = `<thead><tr><th>Quando</th><th>Decisão</th><th class="num">Sobra antes → depois</th><th>Origem</th><th></th></tr></thead><tbody>${
      ds.length ? ds.map((d) => `<tr data-id="${d.id}"><td class="nowrap">${new Date(d.data).toLocaleDateString('pt-BR')}</td><td>${esc(d.texto)}${d.alteracoes && d.alteracoes.length ? `<small class="muted block">${d.alteracoes.map(esc).join('; ')}</small>` : ''}${d.fonte ? ` <a class="small" href="${esc(d.fonte)}" target="_blank">fonte</a>` : ''}</td>
        <td class="num nowrap">${d.antes !== null && d.depois !== null ? `${eur(d.antes)} → <b class="${d.depois >= d.antes ? 'pos' : 'neg'}">${eur(d.depois)}</b>` : '—'}</td><td class="small muted">${esc(d.origem)}</td><td class="c-del">${delBtn}</td></tr>`).join('')
        : '<tr><td colspan="5" class="muted">As mudanças aplicadas pelo Vasco e as decisões que você anotar aparecem aqui, com o efeito na sobra.</td></tr>'}</tbody>`;

    // documentos
    const docs = (a.documentos || []).slice().reverse();
    $('#vzDocs').innerHTML = docs.length ? docs.slice(0, 12).map((d) => `<li><b>${esc(d.nome)}</b><small>${esc(d.descricao)}, ${new Date(d.data).toLocaleDateString('pt-BR')}</small><span class="muted small">${esc(d.inicio.replace(/\s+/g, ' ').slice(0, 140))}…</span></li>`).join('') : '<li class="muted">Nenhum documento analisado ainda.</li>';

    // status da chave
    const s = window.net && window.net.ia ? await window.net.ia.status() : { temChave: false };
    $('#vzStatus').innerHTML = s.temChave ? `Conectado à Groq<b>${esc(state.config.iaModelo || 'openai/gpt-oss-120b')}</b>` : 'Vasco ainda sem chave da Groq<b>cole a chave na conversa</b>';
  },
};

(function bindVasco() {
  $('#vzAbrir').addEventListener('click', () => abrirIA(true));
  $('#acVasco').addEventListener('click', () => {
    const mes = mesSelecionado();
    iaPerguntar(`Analise o mês ${mes} do acompanhamento com ler_acompanhamento: onde gastamos mais ou menos que o planejado, se a diferença é pontual ou deve virar ajuste no plano, e proponha as alterações que fizerem sentido.`);
  });
  $('#vzResumoBtn').addEventListener('click', async (e) => { e.target.disabled = true; await gerarResumo(); e.target.disabled = false; });
  $('#vzFreq').addEventListener('change', (e) => { state.config.resumoFreq = e.target.value; save(); toast(e.target.value === 'desligado' ? 'Resumo automático desligado' : `Resumo ${e.target.value === 'diario' ? 'diário' : 'semanal'} ao abrir o app`); });
  $('#vzRegrasAuto').addEventListener('change', (e) => { state.config.regrasAuto = e.target.checked; save(); });
  $('#vzRegrasBtn').addEventListener('click', () => verificarRegras());
  $('#tblRegras').addEventListener('click', (e) => { const b = e.target.closest('[data-regra]'); if (b) aplicarRegra(b.dataset.regra); });
  $('#vzDecidir').addEventListener('click', () => {
    const t = $('#vzDecisao').value.trim();
    if (!t) return;
    const s = calcAll()[state.cenarioAtivo].sobra;
    registrarDecisao(t, { origem: 'Você', antes: s, depois: s });
    $('#vzDecisao').value = '';
    refresh();
  });
  bindLista('#tblDecisoes', () => state.decisoes, { nomeItem: 'decisão' });
  $('#vzDocBtn').addEventListener('click', () => $('#vzDocArquivo').click());
  $('#vzDocArquivo').addEventListener('change', async (e) => { abrirIA(true); await anexarArquivos(e.target.files); e.target.value = ''; $('#iaInput').focus(); });
  const dz = $('#vzDrop');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('on'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('on'));
  dz.addEventListener('drop', async (e) => { e.preventDefault(); dz.classList.remove('on'); abrirIA(true); await anexarArquivos(e.dataTransfer.files); });

  // rotina ao abrir: resumo no período escolhido e regras uma vez por mês
  setTimeout(async () => {
    const a = state.assistente || {};
    const dias = FREQ_DIAS[state.config.resumoFreq || 'semanal'];
    const ult = (a.ultimoResumo || {}).t || 0;
    if (!a.foto) {
      // primeira vez: só guarda a foto de hoje para comparar no próximo resumo
      state.assistente = { ...a, foto: fotoAtual(), ultimoResumo: { t: Date.now(), itens: montarResumo().itens } };
      save();
    } else if (dias && Date.now() - ult >= dias * 864e5 - 3600e3) await gerarResumo({ automatico: true });
    const reg = (a.regras || {}).em || 0;
    if (state.config.regrasAuto !== false && Date.now() - reg >= 30 * 864e5) agendarRegras();
  }, 7000);
  // a verificação mensal usa várias pesquisas: espera o app ficar parado para não disputar o limite com a conversa
  function agendarRegras() {
    setTimeout(() => {
      const parado = !iaOcupado && Date.now() - (iaUltimaAtividade || 0) > 3 * 60000;
      if (parado) verificarRegras({ automatico: true }); else agendarRegras();
    }, 4 * 60000);
  }
})();
