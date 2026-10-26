'use strict';

/* =========================================================
   Vasco, o assistente do Planejador (Groq).
   A chave fica no processo principal, criptografada pelo Windows;
   a página só pede respostas e executa as ferramentas abaixo.
   ========================================================= */

const NOME_IA = 'Vasco';
const IA_MAX_PASSOS = 7;

/* ---------- escolha do modelo mais avançado disponível ---------- */
function ordenarModelos(ids) {
  const fora = /whisper|tts|orpheus|guard|safeguard|compound|playai|distil|embed|prompt|allam|vision-preview|muse/i;
  const tam = (id) => { const m = /(\d+(?:\.\d+)?)\s*b\b/i.exec(id.replace(/-/g, ' ')); return m ? +m[1] : 0; };
  return ids.filter((id) => !fora.test(id)).sort((a, b) => ((/gpt-oss/i.test(b) ? 10000 : 0) + tam(b)) - ((/gpt-oss/i.test(a) ? 10000 : 0) + tam(a)) || b.localeCompare(a));
}
function escolherModelo(ids) { return ordenarModelos(ids)[0] || 'openai/gpt-oss-120b'; }
async function modeloAtual(forcar) {
  const c = state.config;
  if (!forcar && c.iaModelo && Date.now() - num(c.iaModelosEm) < 24 * 3600e3) return c.iaModelo;
  const r = await window.net.ia.models();
  if (r && r.ok && Array.isArray(r.ids) && r.ids.length) {
    const lista = ordenarModelos(r.ids);
    c.iaModelo = lista[0] || 'openai/gpt-oss-120b';
    c.iaModelosLista = lista.slice(0, 8);
    c.iaModelosEm = Date.now();
    save();
  }
  return c.iaModelo || 'openai/gpt-oss-120b';
}
const modelosChat = () => (Array.isArray(state.config.iaModelosLista) && state.config.iaModelosLista.length ? state.config.iaModelosLista : [state.config.iaModelo || 'openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
// tarefas de fundo e pesquisas usam outro modelo: cada modelo tem o próprio limite por minuto,
// então a conversa no modelo principal fica livre
const modeloAuxiliar = () => { const l = modelosChat(); return l.find((m) => /gpt-oss-20b/i.test(m)) || l[1] || l[0]; };
const modeloBusca = () => { const l = modelosChat(); return l.find((m) => /gpt-oss-20b/i.test(m)) || l.find((m) => /gpt-oss/i.test(m)) || 'openai/gpt-oss-20b'; };

/* ---------- limite por minuto da Groq (plano gratuito: 8 mil tokens por minuto por modelo) ---------- */
const cotaIA = {}; // modelo -> { limite, restante, resetEm, t }
function duracaoMs(s) {
  s = String(s || '').trim();
  if (/^\d+(\.\d+)?$/.test(s)) return +s * 1000;
  let ms = 0, m;
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  while ((m = re.exec(s))) ms += +m[1] * { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]];
  return ms;
}
function registrarCota(modelo, lim) {
  if (!lim || !modelo) return;
  const c = (cotaIA[modelo] = cotaIA[modelo] || {});
  if (lim['limit-tokens']) c.limite = +lim['limit-tokens'];
  if (lim['remaining-tokens'] != null) c.restante = +lim['remaining-tokens'];
  if (lim['reset-tokens']) c.resetEm = Date.now() + duracaoMs(lim['reset-tokens']);
  c.t = Date.now();
  mostrarCota();
}
const janelaCota = () => window.__janelaCota || 60000; // o limite por minuto se recompõe ao longo de 60 s
const bloqueado = (m) => !!(cotaIA[m] && cotaIA[m].bloqueadoAte > Date.now());
function restanteAgora(modelo) {
  const c = cotaIA[modelo];
  if (bloqueado(modelo)) return 0;
  if (!c || c.restante == null || !c.limite) return null;
  return Math.min(c.limite, c.restante + (c.limite * (Date.now() - c.t)) / janelaCota());
}
// imagens contam como ~2 mil tokens cada, não pelo tamanho do base64
const semImagens = (k, v) => (k === 'url' && typeof v === 'string' && v.startsWith('data:') ? 'x'.repeat(6500) : v);
const estimarTokens = (corpo) => Math.ceil((JSON.stringify(corpo.messages || [], semImagens).length + JSON.stringify(corpo.tools || []).length) / 3.2) + 700;
const modelosBusca = () => { const l = modelosChat().filter((m) => /gpt-oss/i.test(m)); return l.length ? [...l].sort((a, b) => (/20b/.test(b) ? 1 : 0) - (/20b/.test(a) ? 1 : 0)) : ['openai/gpt-oss-20b', 'openai/gpt-oss-120b']; };
function mostrarCota() {
  const el = $('#iaCota');
  if (!el) return;
  const m = state.config.iaModelo || 'openai/gpt-oss-120b';
  const r = restanteAgora(m), c = cotaIA[m];
  if (r == null) { el.textContent = ''; return; }
  el.textContent = `Limite da Groq agora: ${nf(0).format(Math.max(0, r))} de ${nf(0).format(c.limite)} tokens por minuto`;
  el.className = `muted small ${r < c.limite * 0.25 ? 'neg' : ''}`;
}
async function esperarCota(ms, motivo, visivel) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (visivel) { iaPassoTxt = `${motivo}: ${Math.ceil((fim - Date.now()) / 1000)} s`; desenharChat(); }
    await new Promise((ok) => setTimeout(ok, Math.min(1000, fim - Date.now())));
  }
}
const esperaDoErro = (r) => {
  const ra = r && r.limites && r.limites['retry-after'];
  if (ra) return duracaoMs(ra);
  const m = /try again in ([\d.hms]+)/i.exec((r && r.error) || '');
  return m ? duracaoMs(m[1]) : 20000;
};
const ehLimiteDiario = (r) => /per day|\(TPD\)|\(RPD\)|daily/i.test((r && r.error) || '');

// chama a Groq respeitando o limite: espera até 35 s no modelo pedido; se precisar mais, usa o próximo modelo da lista
async function chamarGroq(corpo, opcoes) {
  const { troca = true, visivel = false, espera = 35000, modelos } = opcoes || {};
  const candidatos = () => (modelos || modelosChat()).filter((m) => !bloqueado(m));
  const tentados = new Set();
  let modelo = corpo.model;
  let ultimo = null;
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    tentados.add(modelo);
    const est = estimarTokens(corpo);
    if (bloqueado(modelo)) {
      const alt = troca && candidatos().find((m) => !tentados.has(m));
      if (alt) { modelo = alt; continue; }
      return { ok: false, status: 429, diario: true, modelo, espera: cotaIA[modelo].bloqueadoAte - Date.now(), error: 'limite diário' };
    }
    const livre = restanteAgora(modelo);
    if (livre != null && livre < est) {
      const c = cotaIA[modelo];
      const ms = Math.min(Math.max(0, (c.resetEm || 0) - Date.now()) || janelaCota(), ((est - livre) / c.limite) * janelaCota() + 1500);
      const alt = troca && candidatos().find((m) => !tentados.has(m) && (restanteAgora(m) == null || restanteAgora(m) >= est));
      if (ms > espera && alt) { modelo = alt; continue; }
      if (ms <= 65000) await esperarCota(ms, 'esperando o limite por minuto da Groq', visivel);
    }
    const r = await window.net.ia.chat({ ...corpo, model: modelo });
    if (r) registrarCota(modelo, r.limites);
    if (r && r.ok) return { ...r, modelo };
    ultimo = r;
    if (r && (r.status === 404 || /decommission|not found|does not exist|not supported/i.test(r.error || '')) && troca) {
      const alt = candidatos().find((m) => !tentados.has(m));
      if (alt) { modelo = alt; continue; }
    }
    if (!r || r.status !== 429) break;
    const ms = esperaDoErro(r);
    const c = (cotaIA[modelo] = cotaIA[modelo] || { limite: 8000 });
    if (ehLimiteDiario(r)) c.bloqueadoAte = Date.now() + ms;
    else { c.restante = 0; c.t = Date.now(); c.resetEm = Date.now() + ms; }
    const alt = troca && candidatos().find((m) => !tentados.has(m));
    if ((ehLimiteDiario(r) || ms > espera) && alt) { modelo = alt; continue; }
    if (ms <= 65000 && !ehLimiteDiario(r)) { await esperarCota(ms + 500, 'a Groq pediu uma pausa', visivel); tentados.delete(modelo); continue; }
    break;
  }
  return { ...(ultimo || { ok: false, error: 'sem resposta' }), modelo, espera: ultimo ? esperaDoErro(ultimo) : 0, diario: ehLimiteDiario(ultimo) };
}

/* ---------- caminhos para ler e alterar dados ---------- */
const RAIZES_EDITAVEIS = ['cenarios', 'metas', 'plano', 'familia', 'rendas', 'investimentos', 'despesas', 'entrada', 'eventos', 'tarefas', 'cidade', 'cidadesEdit', 'impostos', 'vistos', 'viagem', 'cenarioAtivo', 'ascendencia', 'vagas', 'config'];
// em config, só valores de regras e metas (nunca chaves de API)
const CONFIG_EDITAVEL = ['metaEuros', 'taxaConsular', 'anosNacionalidade', 'anosBisneto', 'limiarCartaoAzul', 'alertaEuro'];
function partes(caminho) {
  const out = [];
  String(caminho).replace(/([^.[\]]+)|\[([^\]]+)\]/g, (_m, nome, sel) => { out.push(nome !== undefined ? { k: nome } : { s: sel }); return ''; });
  return out;
}
function resolver(obj, ps, criar) {
  let cur = obj, pai = null, chave = null;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (criar && cur && typeof cur === 'object' && !Array.isArray(cur) && p.k !== undefined && cur[p.k] == null && i < ps.length - 1 && ps[i + 1].k !== undefined) cur[p.k] = {};
    pai = cur;
    if (p.k !== undefined) { if (p.k === '__proto__' || p.k === 'constructor' || p.k === 'prototype') throw new Error('caminho inválido'); chave = p.k; cur = cur == null ? undefined : cur[p.k]; continue; }
    if (!Array.isArray(cur)) throw new Error(`"${p.s}" só funciona em listas`);
    const m = /^\s*(\w+)\s*=\s*(.+?)\s*$/.exec(p.s);
    let idx;
    if (/^\d+$/.test(p.s)) idx = +p.s;
    else if (m) {
      const alvo = m[2].replace(/^["']|["']$/g, '').toLowerCase();
      idx = cur.findIndex((x) => String(x[m[1]] ?? '').toLowerCase() === alvo);
      if (idx < 0) idx = cur.findIndex((x) => String(x[m[1]] ?? '').toLowerCase().includes(alvo));
    }
    if (idx === undefined || idx < 0 || idx >= cur.length) throw new Error(`não encontrei ${p.s}`);
    chave = idx; cur = cur[idx];
  }
  return { pai, chave, valor: cur };
}
function aplicarAlteracoes(st, alteracoes) {
  const feitas = [];
  for (const a of alteracoes || []) {
    const ps = partes(a.caminho);
    if (!ps.length || !RAIZES_EDITAVEIS.includes(ps[0].k)) throw new Error(`não posso alterar "${a.caminho}"`);
    if (ps[0].k === 'config' && !(ps.length === 2 && CONFIG_EDITAVEL.includes(ps[1].k))) throw new Error(`em config só posso alterar ${CONFIG_EDITAVEL.join(', ')}`);
    const op = a.operacao || 'definir';
    if (op === 'adicionar') {
      const { valor: lista } = resolver(st, ps);
      if (!Array.isArray(lista)) throw new Error(`"${a.caminho}" não é uma lista`);
      const modelo = NOVOS[ps[0].k] ? NOVOS[ps[0].k]() : ps[0].k === 'familia' ? { id: nid('p'), nome: 'Pessoa', tipo: 'adulto', idade: null, irsJovemAno: 0 }
        : ps[0].k === 'vagas' ? novaVaga() : ps[0].k === 'ascendencia' ? { id: nid('a'), geracao: null, nome: '', local: '', data: '', portugues: 'nao', vivo: '?', certidao: 'procurar', nota: '' } : { id: nid('x') };
      lista.push({ ...modelo, ...(a.valor || {}), id: modelo.id });
      feitas.push(`adicionado em ${a.caminho}`);
    } else if (op === 'remover') {
      const { pai, chave } = resolver(st, ps);
      if (!Array.isArray(pai)) throw new Error(`"${a.caminho}" não é um item de lista`);
      pai.splice(chave, 1);
      feitas.push(`removido ${a.caminho}`);
    } else {
      const { pai, chave, valor: antes } = resolver(st, ps, true);
      if (pai == null || typeof pai !== 'object') throw new Error(`caminho inválido: ${a.caminho}`);
      let v = a.valor;
      if (typeof antes === 'number' && typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v.replace(',', '.'))) v = +v.replace(',', '.');
      if (typeof antes === 'boolean' && typeof v === 'string') v = /^(true|sim|1)$/i.test(v);
      if (ps.length === 1 && ps[0].k === 'cidade' && !todasCidades(st).some((c) => c.id === v)) throw new Error(`cidade desconhecida: ${v}. Use o id da cidade (ex.: viseu, porto)`);
      if (ps.length === 1 && ps[0].k === 'cenarioAtivo' && !SC.includes(v)) throw new Error('cenário deve ser base, conservador ou estresse');
      pai[chave] = v;
      feitas.push(`${a.caminho} = ${JSON.stringify(v)}`);
    }
  }
  return feitas;
}

/* ---------- resumos que a IA lê ---------- */
const r0 = (x) => Math.round(num(x));
function resumoCenario(r) {
  return {
    cambio: r.tip.cambio, chega_em_portugal_eur_mes: r0(r.receitas), despesas_eur_mes: r0(r.despesas), sobra_eur_mes: r0(r.sobra),
    depois_da_meta_eur_mes: r0(r.aposMeta), custo_mudanca_brl: r0(r.entradaBRL), patrimonio_na_mudanca_brl: r0(r.sim.patrimonioMudancaBRL),
    reserva_pos_custos_eur: r0(r.reservaEUR), mes_mais_apertado: { saldo_eur: r0(r.sim.menor.saldo), mes: r.sim.menor.cal ? mesKey(r.sim.menor.cal) : null },
    [`patrimonio_apos_${r.sim.H}_meses_eur`]: r0(r.sim.patrimonioFinalEUR), reserva_acaba_no_mes: r.sim.zerou,
    irs_portugal_eur_ano: r0(r.tip.imp.escolhida.total), regime_irs: `${r.tip.imp.escolhida.regime}${r.tip.imp.escolhida.conjunta ? ' conjunta' : ' separada'}`,
    d7_exigencia_mes_eur: r0(r.exigMes), renda_passiva_eur_mes: r0(r.passiva),
  };
}
function lerResumo() {
  const all = calcAll();
  const fam = all.base.fam;
  return {
    hoje: new Date().toISOString().slice(0, 10), cidade: cidadeNome(), mudanca: state.plano.dataMudanca, mes_de_referencia: num(state.plano.mesReferencia),
    familia: { adultos: fam.adultos.map((p) => p.nome), criancas: fam.criancas.map((c) => ({ nome: c.nome, idade: c.idade })), casa: fam.tip.toUpperCase() },
    meta_poupanca_eur: num(state.metas.poupanca), cenario_ativo: state.cenarioAtivo,
    cenarios: Object.fromEntries(SC.map((k) => [k, resumoCenario(all[k])])),
    visto_escolhido: (state.vistos && state.vistos.escolhido) || null,
  };
}
function lerSecao(secao) {
  const all = calcAll();
  const r = all[state.cenarioAtivo];
  const limpar = (arr, campos) => arr.map((x) => Object.fromEntries(campos.filter((c) => x[c] !== undefined).map((c) => [c, x[c]])));
  switch (secao) {
    case 'rendas': return r.tip.rend.map((x) => ({ nome: x.nome, ativo: x.ativo, tipo: x.tipo, moeda: x.moeda, valor_bruto_mes: x.valor, ir_brasil: x.impostoBR, clt: x.clt, inicio: x.inicio, fim: x.fim, situacao: x.status, entra_no_mes_referencia: x.ativa, chega_eur_mes: r0(x.eur), nota: x.nota }));
    case 'investimentos': return r.tip.inv.map((x) => ({ nome: x.nome, capital_informado_brl: x.capital, capital_apos_mudanca_brl: r0(x.cap), indexador: x.idx, parametro: x.param, ir_brasil: x.impostoBR, taxa_mes: x.taxa, chega_eur_mes: r0(x.eur) }));
    case 'despesas': return r.sim.desp.items.map((d) => ({ nome: d.nome, ativo: d.ativo, categoria: d.cat, origem: d.auto || 'manual', valor_informado: d.valor, moeda: d.moeda, no_cenario_eur_mes: r0(d.eur) }));
    case 'custos_mudanca': return { itens: r.sim.ent.items.map((e) => ({ nome: e.nome, moeda: e.moeda, valor: e.valor, por_pessoa: e.porPessoa, em_reais: r0(e.brl) })), aluguel_adiantado_eur: r0(r.sim.ent.aluguelAdiantadoEUR), total_brl: r0(r.entradaBRL) };
    case 'familia': return { pessoas: state.familia.pessoas.map((p) => ({ nome: p.nome, tipo: p.tipo, idade: p.idade, irs_jovem_ano: p.irsJovemAno })), casados: state.familia.casados, casa: r.fam.tip, ascendencia: (state.vistos || {}).ascendencia || {} };
    case 'cenarios': return state.cenarios;
    case 'impostos': return { ano: r.tip.imp.ano, opcoes: r.tip.imp.opcoes.map((o) => ({ regime: o.regime, conjunta: o.conjunta, total_eur_ano: r0(o.total), por_categoria: Object.fromEntries(Object.entries(o.cat).map(([k, v]) => [k, r0(v)])) })), pessoas: r.tip.imp.pessoa.map((p) => ({ nome: p.nome, trabalho_brasil_eur_ano: r0(p.br), trabalho_pt_eur_ano: r0(p.pt), ir_pago_brasil_eur: r0(p.brTax), isento_irs_jovem: r0(p.isento), coletavel: r0(p.tributavel) })) };
    case 'linha_do_tempo': return { eventos: limpar(state.eventos, ['nome', 'ativo', 'tipo', 'moeda', 'valor', 'porPessoa', 'quando', 'repetir', 'mesAno']), meses: r.sim.pos.map((p) => ({ mes: mesKey(p.cal), saldo: r0(p.saldo), patrimonio_eur: r0(p.patrimonioEUR), eventos: p.eventos.map((e) => `${e.nome}: ${r0(e.eur)}`) })) };
    case 'cidades': return todasCidades(state).map((c) => { const x = resumo(state, state.cenarioAtivo, { cidade: c.id }); return { cidade: c.nome, id: c.id, t1: c.t1, t2: c.t2, t3: c.t3, passe: c.passe, despesas_eur_mes: r0(x.despesas), sobra_eur_mes: r0(x.sobra), custo_mudanca_brl: r0(x.entradaBRL), fonte: c.fonte }; });
    case 'checklist': return limpar(state.tarefas, ['titulo', 'grupo', 'quando', 'status']);
    case 'vistos': return { escolhido: (state.vistos || {}).escolhido || null, avaliacao: VISTOS.map((v) => ({ id: v.id, nome: v.nome, ...avaliarVisto(v.id, r) })) };
    case 'viagem': { const v = viagemState(); return { origem: v.origem, destino: v.destino, data: v.data, melhores_ofertas: v.ofertas.slice(0, 5).map((o) => ({ cia: o.cia, preco_brl_pessoa: r0(o.precoBRL), escalas: o.escalas, fonte: o.fonte })), insights: v.insights, buscado_em: v.buscadoEm ? new Date(v.buscadoEm).toISOString() : null, alerta_brl: v.alertaPreco, bagagem: v.bagagem }; }
    case 'mercado': return state.mercado;
    case 'acompanhamento': return { meses_registrados: Object.keys(state.realizado || {}).sort(), dica: 'use ler_acompanhamento com o mês para comparar planejado e realizado' };
    case 'vagas': return (state.vagas || []).map((v) => ({ id: v.id, titulo: v.titulo, empresa: v.empresa, cidade: v.cidade, situacao: v.status, link: v.link, ...simularVaga(v) }));
    case 'ascendencia': return { arvore: ascState().linha.map((x) => ({ geracao: GERACOES[x.geracao ?? ''], nome: x.nome, local: x.local, data: x.data, portugues: x.portugues, vivo: x.vivo, certidao: x.certidao, nota: x.nota })), titular: (state.familia.pessoas.find((p) => p.id === ascState().titular) || {}).nome, analise: analisarAscendencia(), caminho_para_alterar: 'ascendencia.linha[nome=...].campo (geracao 1 a 5, portugues/vivo sim|nao|?)' };
    case 'decisoes': return (state.decisoes || []).slice(-30);
    case 'plano_compra_euros': return typeof planoCompraEuros === 'function' ? planoCompraEuros() : null;
    case 'regras': return typeof regrasComValores === 'function' ? regrasComValores() : null;
    case 'documentos': return ((state.assistente || {}).documentos || []).slice(-15);
    case 'risco_cambio': { const x = riscoAtual(); const { faixa, meses, ...resto } = x; return { ...resto, explicacao: 'mil caminhos aleatórios do euro; chance_dinheiro_acabar é a fração em que conta em euros e investimentos zeram no horizonte' }; }
    case 'aluguel_ine': return state.ine ? { periodo: state.ine.periodo, por_m2: Object.fromEntries(Object.entries(state.ine.cidades).map(([id, d]) => [id, d.m2])), estimativas: Object.fromEntries(Object.keys(state.ine.cidades).map((id) => [id, estimativaINE(id)])) } : { erro: 'ainda não buscado; o usuário pode clicar em Buscar no INE na aba Cidades' };
    default: return { erro: 'seção desconhecida' };
  }
}
function iaSimular(alteracoes) {
  const antes = calcAll();
  const st2 = JSON.parse(JSON.stringify(state));
  const feitas = aplicarAlteracoes(st2, alteracoes);
  const depois = Object.fromEntries(SC.map((k) => [k, resumo(st2, k)]));
  const comp = (k) => {
    const a = resumoCenario(antes[k]), d = resumoCenario(depois[k]);
    const out = {};
    for (const key of Object.keys(d)) if (typeof d[key] === 'number' && a[key] !== d[key]) out[key] = { antes: a[key], depois: d[key] };
    return out;
  };
  return { alteracoes_simuladas: feitas, diferencas: Object.fromEntries(SC.map((k) => [k, comp(k)])) };
}

/* ---------- ferramentas oferecidas ao modelo ---------- */
const SECOES = ['risco_cambio', 'aluguel_ine', 'rendas', 'investimentos', 'despesas', 'custos_mudanca', 'familia', 'cenarios', 'impostos', 'linha_do_tempo', 'cidades', 'checklist', 'vistos', 'ascendencia', 'viagem', 'vagas', 'mercado', 'plano_compra_euros', 'acompanhamento', 'decisoes', 'regras', 'documentos'];
const ALTERACAO = {
  type: 'object',
  properties: {
    caminho: { type: 'string', description: 'Ex.: cenarios.base.cambio, metas.poupanca, despesas[nome=Mercado].valor, rendas[nome=X].ativo, cidadesEdit.viseu.t1' },
    valor: { description: 'Número, texto, booleano ou objeto (adicionar). Percentual em fração' },
    operacao: { type: 'string', enum: ['definir', 'adicionar', 'remover'], description: 'Padrão: definir' },
  },
  required: ['caminho'],
};
const F = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: properties || {}, ...(required ? { required } : {}) } } });
const FERRAMENTAS = [
  F('ler_resumo', 'Números principais dos 3 cenários. Use antes de falar de números.'),
  F('ler_secao', 'Dados detalhados de uma parte do app.', { secao: { type: 'string', enum: SECOES } }, ['secao']),
  F('simular', 'Testa mudanças sem salvar; devolve antes e depois.', { alteracoes: { type: 'array', items: ALTERACAO } }, ['alteracoes']),
  F('propor_alteracoes', 'Propõe mudanças; só valem se o usuário clicar em Aplicar.', { alteracoes: { type: 'array', items: ALTERACAO }, explicacao: { type: 'string' } }, ['alteracoes', 'explicacao']),
  F('dados_reais', 'Euro, dólar, CDI, Selic, IPCA, inflação de Portugal e Focus de hoje, com as premissas dos cenários.'),
  F('pesquisar_internet', 'Pesquisa informação atual na internet e devolve resumo com fontes.', { pergunta: { type: 'string' } }, ['pergunta']),
  F('buscar_voos', 'Preços de passagens da rota da aba Viagem.'),
  F('registrar_vaga', 'Registra vaga em Portugal na aba Vagas e devolve líquido, sobra, visto e cidades.', {
    titulo: { type: 'string' }, empresa: { type: 'string' }, cidade: { type: 'string' }, salario_bruto_anual: { type: 'number', description: '€; faixa: use o meio' },
    salario_bruto_mensal: { type: 'number' }, pagamentos: { type: 'number', description: 'padrão 14' }, pessoa: { type: 'string' },
    modalidade: { type: 'string', enum: ['presencial', 'hibrido', 'remoto'] }, link: { type: 'string' }, inicio_mes: { type: 'number', description: 'meses após a mudança' },
    area: { type: 'string' }, observacoes: { type: 'string' }, empresa_ifici: { type: 'string', enum: ['sim', 'nao', '?'], description: 'empresa elegível ao IFICI (exportadora, startup certificada, I&D)?' } }, ['titulo']),
  F('analisar_vaga', 'Simula uma vaga já registrada e compara cidades.', { vaga: { type: 'string' } }, ['vaga']),
  F('ler_acompanhamento', 'Planejado x realizado de um mês (AAAA-MM).', { mes: { type: 'string' } }, ['mes']),
  F('ler_documento', 'Lê um trecho do texto completo de um documento anexado nesta conversa.', { nome: { type: 'string' }, parte: { type: 'number', description: '1, 2, 3...' } }, ['nome']),
  F('registrar_decisao', 'Anota no diário algo que o usuário decidiu.', { texto: { type: 'string' } }, ['texto']),
  F('abrir_aba', 'Mostra uma aba do app.', { aba: { type: 'string', enum: Object.keys(TITLES) } }, ['aba']),
];

async function executarFerramenta(nome, args) {
  switch (nome) {
    case 'ler_resumo': return lerResumo();
    case 'ler_secao': return lerSecao(args.secao);
    case 'simular': return iaSimular(args.alteracoes || []);
    case 'propor_alteracoes': {
      const teste = iaSimular(args.alteracoes || []); // valida os caminhos antes de mostrar
      const id = nid('prop');
      iaPendentes[id] = { alteracoes: args.alteracoes, explicacao: args.explicacao || '', teste };
      iaMsgs.push({ role: 'proposta', id });
      desenharChat();
      return { status: 'mostrado ao usuário com os botões Aplicar e Descartar; não foi aplicado ainda', efeito_previsto: teste.diferencas };
    }
    case 'dados_reais': {
      await atualizarMercado({ silencioso: true });
      const m = state.mercado, b = state.cenarios.base;
      const am = m.cdi ? Math.pow(1 + m.cdi.v / 100, 1 / 12) - 1 : null;
      return {
        atualizado_em: m.atualizadoEm ? new Date(m.atualizadoEm).toISOString() : null, fontes_sem_resposta: m.falhas || [],
        euro_hoje: m.eur ? m.eur.bid : null, ptax_euro: m.ptax || null, dolar_hoje: m.usd ? m.usd.bid : null,
        cdi_ano_pct: m.cdi ? m.cdi.v : null, cdi_mes_fracao: am, selic_meta_pct: m.selic ? m.selic.v : null, ipca_12m_pct: m.ipca12 ? m.ipca12.v : null,
        inflacao_portugal_12m_pct: m.hicpPT || null, focus_selic: m.focusSelic || null, focus_ipca: m.focusIpca || null,
        premissas: Object.fromEntries(SC.map((k) => [k, { cambio: state.cenarios[k].cambio, cdi_mes: state.cenarios[k].cdi, ajuste_despesas: state.cenarios[k].ajusteDesp }])),
        diferenca_cambio_base_pct: m.eur ? ((b.cambio / m.eur.bid) - 1) * 100 : null,
      };
    }
    case 'pesquisar_internet': {
      const r = await chamarGroq({
        model: modeloBusca(), max_completion_tokens: 1200,
        messages: [
          { role: 'system', content: `Hoje é ${new Date().toLocaleDateString('pt-BR')}. Pesquise e responda em português do Brasil em no máximo 12 linhas, só com o essencial, citando fontes com URL e data.` },
          { role: 'user', content: String(args.pergunta || '').slice(0, 800) },
        ],
        tools: [{ type: 'browser_search' }], tool_choice: 'required', reasoning_effort: 'low',
      }, { visivel: true, modelos: modelosBusca() });
      if (!r || !r.ok) return { erro: r && r.status === 429 ? 'limite da Groq para pesquisas atingido agora; responda com o que já sabe e diga que não deu para pesquisar' : (r && r.error) || 'sem resposta da busca' };
      const msg = r.data.choices && r.data.choices[0] && r.data.choices[0].message;
      return { resposta: String((msg && msg.content) || '').slice(0, 3500) };
    }
    case 'buscar_voos': {
      const r = await buscarVoos({ silencioso: false });
      return r ? { ...r, rota: `${state.viagem.origem}-${state.viagem.destino}`, data: state.viagem.data } : { erro: 'nenhuma fonte de preços conectada na aba Viagem' };
    }
    case 'abrir_aba': go(args.aba); return { ok: true };
    case 'registrar_vaga': {
      const semAc = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const cid = todasCidades(state).find((c) => args.cidade && (semAc(args.cidade).includes(semAc(c.nome)) || semAc(c.nome).includes(semAc(args.cidade))));
      const pessoa = state.familia.pessoas.find((p) => args.pessoa && semAc(p.nome) === semAc(args.pessoa)) || state.familia.pessoas.find((p) => p.tipo !== 'crianca');
      const pag = num(args.pagamentos) || 14;
      const bruto = num(args.salario_bruto_anual) || num(args.salario_bruto_mensal) * pag;
      const v = novaVaga({
        titulo: String(args.titulo || 'Vaga').slice(0, 120), empresa: String(args.empresa || '').slice(0, 80), cidade: cid ? cid.id : '', link: /^https?:\/\//.test(args.link || '') ? args.link : '',
        brutoAnual: Math.round(bruto), pagamentos: pag, pessoa: pessoa ? pessoa.id : '', modalidade: ['presencial', 'hibrido', 'remoto'].includes(args.modalidade) ? args.modalidade : 'presencial',
        inicio: Math.max(0, Math.round(num(args.inicio_mes))), area: String(args.area || '').slice(0, 60), ificiEmpresa: ['sim', 'nao', '?'].includes(args.empresa_ifici) ? args.empresa_ifici : '?', nota: String(args.observacoes || '').slice(0, 400) + (cid || !args.cidade ? '' : ` (cidade do anúncio: ${args.cidade})`),
      });
      state.vagas.unshift(v); save();
      if (viewAtual === 'vagas') { V.vagas.build(); refresh(); }
      toast(`Vaga “${v.titulo}” registrada na aba Vagas`);
      const xi = simularVagaIfici(v);
      return { registrada: true, id: v.id, cidade_reconhecida: cid ? cid.nome : null, ...simularVaga(v), sobra_com_ifici: xi.com.sobra_com_vaga, sobra_sem_ifici: xi.sem.sobra_com_vaga, melhores_cidades: vagaNasCidades(v).slice(0, 5) };
    }
    case 'analisar_vaga': {
      const alvo = String(args.vaga || '').toLowerCase();
      const v = (state.vagas || []).find((x) => x.id === args.vaga || x.titulo.toLowerCase() === alvo) || (state.vagas || []).find((x) => x.titulo.toLowerCase().includes(alvo));
      if (!v) return { erro: 'vaga não encontrada', vagas: (state.vagas || []).map((x) => x.titulo) };
      return { titulo: v.titulo, ...simularVaga(v), cidades: vagaNasCidades(v) };
    }
    case 'ler_acompanhamento': {
      const key = String(args.mes || '');
      const reg = (state.realizado || {})[key];
      if (!reg) return { erro: 'mês sem registro', meses_registrados: Object.keys(state.realizado || {}).sort() };
      const pl = planejadoDoMes(calcAll(), key);
      const linhas = CATS.map((c) => ({ categoria: c, planejado: r0(pl.porCat[c]), realizado: r0((reg.porCat || {})[c]), diferenca: r0(num((reg.porCat || {})[c]) - num(pl.porCat[c])) }));
      const pT = CATS.reduce((a, c) => a + num(pl.porCat[c]), 0), rT = CATS.reduce((a, c) => a + num((reg.porCat || {})[c]), 0);
      return { mes: key, receitas: { planejado: r0(pl.receitas), realizado: r0(reg.receitas) }, despesas: linhas, sobra: { planejada: r0(pl.receitas - pT), realizada: r0(num(reg.receitas) - rT) }, origem: reg.fonte || 'manual' };
    }
    case 'ler_documento': {
      const nomes = Object.keys(iaDocsSessao);
      const nome = nomes.find((n) => n === args.nome) || nomes.find((n) => n.toLowerCase().includes(String(args.nome || '').toLowerCase()));
      if (!nome) return { erro: 'documento não está nesta sessão; peça para anexar de novo', documentos: nomes };
      const t = iaDocsSessao[nome], tam = 3500, total = Math.ceil(t.length / tam), parte = Math.min(total, Math.max(1, Math.round(num(args.parte) || 1)));
      return { nome, parte, de: total, texto: t.slice((parte - 1) * tam, parte * tam) };
    }
    case 'registrar_decisao': registrarDecisao(String(args.texto || '').slice(0, 400), { origem: 'Vasco (anotação)' }); return { ok: true };
    default: return { erro: 'ferramenta desconhecida' };
  }
}

function promptSistema() {
  return `Você é ${NOME_IA}, o assistente do Planejador, um app de planejamento da mudança de uma família do Brasil para Portugal.
Hoje é ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}. Responda sempre em português do Brasil, de forma direta e calorosa, como um planejador financeiro experiente que conhece imigração para Portugal.

Como trabalhar:
- Antes de falar de números do plano, leia os dados com ler_resumo ou ler_secao. Nunca invente valores.
- Para comparar o plano com a realidade, use dados_reais (câmbio, juros, inflação) e pesquisar_internet (leis, vistos, aluguéis, preços atuais). Diga a data e a fonte do dado real.
- Para "e se...", use simular e mostre o antes e depois.
- Para mudar dados do usuário, use propor_alteracoes; o usuário confirma na tela. Nunca diga que alterou algo antes de ele aplicar.
- Despesas com origem automática (aluguel, contas, mercado, transporte, telemóvel, seguro, escola) seguem a cidade e a família. Para corrigir o aluguel ou o passe de uma cidade, altere cidadesEdit.<id da cidade>.t1 (ou t2, t3, passe); para fixar um valor manual numa despesa, defina auto como "" e depois valor.
- Ids das cidades: ${todasCidades(state).map((c) => c.id).join(', ')}. Cidade atual: ${state.cidade}.
- Valores em euros com €, em reais com R$, no formato brasileiro (1.234,56). Percentuais nos dados são frações (0,035 = 3,5%).
- Respostas curtas: comece pela conclusão, depois os números que a sustentam. Use listas ou tabelas só quando ajudarem.
- Vagas: quando o usuário colar uma vaga (texto ou link), use registrar_vaga com os dados extraídos; se for só um link, abra com pesquisar_internet antes. Diga líquido, sobra com a vaga, visto e cidades.
- Ascendência: a seção ascendencia tem a árvore e a análise (filho, neto, bisneto, cadeia) pela Lei Orgânica 1/2026. Ajude a completar a árvore e a achar registos no Arquivo Distrital.
- Documentos anexados chegam entre <<< e >>> (inteiros ou como extrato). Se precisar de mais, use ler_documento. Para currículos, avalie o perfil para o mercado português (áreas, salários, idioma, vistos) e use pesquisar_internet para dados atuais.
- Quando o usuário disser que decidiu algo, anote com registrar_decisao.
- IFICI: trabalho em empresa elegível pode pagar 20% fixo de IRS por 10 anos; registrar_vaga devolve a sobra com e sem IFICI. Com declaração conjunta e salários médios, o regime normal pode sair mais barato: diga qual compensa.
- Risco do câmbio: ler_secao risco_cambio traz mil caminhos do euro (chance de o dinheiro acabar, faixas). Aluguéis oficiais: ler_secao aluguel_ine.
- Impostos e vistos: dê a melhor estimativa com os dados, e lembre que a decisão final deve passar por contador ou advogado de imigração quando o assunto for decisivo.

Abas: ${Object.keys(TITLES).join(', ')}. Cenários: base, conservador, estresse. Mês de referência conta a partir da mudança (0 = chegada).
Seja econômico: leia só as seções necessárias e use poucas ferramentas por resposta.`;
}

/* ---------- conversa ---------- */
let iaMsgs = []; // {role:'user'|'assistant'|'proposta'|'erro', content|id}
const iaPendentes = {};
let iaOcupado = false;

function md(txt) {
  const e = esc(String(txt || ''));
  const linhas = e.split('\n');
  let html = '', lista = null, tabela = [];
  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank">$2</a>');
  const fechar = () => {
    if (lista) { html += `</${lista}>`; lista = null; }
    if (tabela.length) {
      const rows = tabela.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map((l) => l.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => inline(c.trim())));
      html += `<table class="md-t"><thead><tr>${rows[0].map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      tabela = [];
    }
  };
  for (const l of linhas) {
    if (/^\s*\|.*\|\s*$/.test(l)) { if (lista) { html += `</${lista}>`; lista = null; } tabela.push(l); continue; }
    if (tabela.length) fechar();
    let m;
    if ((m = /^\s*[-*•]\s+(.*)/.exec(l))) { if (lista !== 'ul') { fechar(); html += '<ul>'; lista = 'ul'; } html += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)/.exec(l))) { if (lista !== 'ol') { fechar(); html += '<ol>'; lista = 'ol'; } html += `<li>${inline(m[1])}</li>`; continue; }
    fechar();
    if ((m = /^#{1,4}\s+(.*)/.exec(l))) { html += `<h4>${inline(m[1])}</h4>`; continue; }
    if (l.trim()) html += `<p>${inline(l)}</p>`;
  }
  fechar();
  return html;
}

function desenharChat() {
  const box = $('#iaLog');
  if (!box) return;
  box.innerHTML = iaMsgs.map((m) => {
    if (m.role === 'user') return `<div class="ia-msg user">${esc(m.exibir ?? m.content).replace(/\n/g, '<br>')}${(m.anexos || []).map((n) => `<span class="ia-anexo-tag">${esc(n)}</span>`).join('')}</div>`;
    if (m.role === 'resumo') return `<div class="ia-msg bot resumo"><p class="ia-resumo-t">Resumo da semana</p>${md(m.content)}</div>`;
    if (m.role === 'erro') return `<div class="ia-msg erro">${esc(m.content)}${m.retry ? ' <button class="link" data-retry>Tentar de novo</button>' : ''}</div>`;
    if (m.role === 'proposta') {
      const p = iaPendentes[m.id];
      if (!p) return '';
      const efeitos = Object.entries(p.teste.diferencas[state.cenarioAtivo] || {}).slice(0, 5).map(([k, v]) => `<li>${esc(k.replace(/_/g, ' '))}: ${esc(String(v.antes))} → <b>${esc(String(v.depois))}</b></li>`).join('');
      return `<div class="ia-prop ${p.estado || ''}"><p><b>Proposta:</b> ${esc(p.explicacao)}</p><ul class="ia-alt">${p.teste.alteracoes_simuladas.map((x) => `<li><code>${esc(x)}</code></li>`).join('')}</ul>${efeitos ? `<p class="muted small">No cenário ${SC_LABEL[state.cenarioAtivo]}:</p><ul class="small">${efeitos}</ul>` : ''}
        ${p.estado ? `<p class="muted small">${p.estado === 'aplicada' ? 'Aplicada.' : 'Descartada.'}</p>` : `<div class="btn-row"><button class="primary" data-aplicar="${m.id}">Aplicar</button><button class="ghost" data-descartar="${m.id}">Descartar</button></div>`}</div>`;
    }
    return `<div class="ia-msg bot">${md(m.content)}${m.modelo ? `<small class="ia-modelo-tag">respondido com ${esc(m.modelo)}, porque o limite do modelo principal estava cheio</small>` : ''}</div>`;
  }).join('') + (iaOcupado ? `<div class="ia-msg bot pensando"><span></span><span></span><span></span><small id="iaPasso">${esc(iaPassoTxt)}</small></div>` : '');
  box.scrollTop = box.scrollHeight;
}
let iaPassoTxt = '';
const PASSO_TXT = { ler_resumo: 'lendo o plano', ler_secao: 'lendo os detalhes', simular: 'simulando', propor_alteracoes: 'preparando a proposta', dados_reais: 'buscando dados de hoje', pesquisar_internet: 'pesquisando na internet', buscar_voos: 'buscando passagens', abrir_aba: 'abrindo a aba' };

async function enviar(texto) {
  texto = String(texto || '').trim();
  if (iaOcupado || iaLendo) { if (texto || iaAnexos.length) toast(`Espere o ${NOME_IA} terminar a resposta anterior.`); return; }
  const anexosAgora = iaAnexos.splice(0);
  if (!texto && !anexosAgora.length) return;
  if (!window.net || !window.net.ia) { iaMsgs.push({ role: 'user', content: texto }, { role: 'erro', content: `${NOME_IA} funciona no app para Windows.` }); desenharChat(); return; }
  const exibir = texto || 'Analise este documento e compare com o plano.';
  iaUltimaAtividade = Date.now();
  $('#iaInput').value = '';
  desenharAnexos();
  iaOcupado = true; iaPassoTxt = anexosAgora.length ? 'lendo o documento' : 'pensando'; 
  const msgUser = { role: 'user', content: exibir, exibir, anexos: anexosAgora.map((a) => a.nome) };
  iaMsgs.push(msgUser);
  desenharChat();
  // documentos: inteiros se forem curtos; se forem longos, um extrato feito no modelo auxiliar
  for (const a of anexosAgora) {
    iaDocsSessao[a.nome] = a.texto;
    let corpo = a.texto, tipo = 'texto completo';
    if (a.texto.length > DOC_INTEIRO) {
      const ex = await extrairDocumento(a, exibir);
      if (ex) { corpo = ex; tipo = `extrato; o texto completo tem ${nf(0).format(a.texto.length)} caracteres em ${Math.ceil(a.texto.length / 3500)} partes (ler_documento)`; }
      else { corpo = a.texto.slice(0, DOC_INTEIRO); tipo = `começo do texto; o resto pode ser lido com ler_documento`; }
    }
    msgUser.content += `\n\n[Documento anexado: ${a.nome}, ${a.descricao}, ${tipo}]\n<<<\n${corpo}\n>>>`;
  }
  await rodarConversa();
}

const DOC_INTEIRO = 6000;
let iaDocsSessao = {};
let iaUltimaAtividade = 0;
async function extrairDocumento(a, pergunta) {
  iaPassoTxt = `resumindo ${a.nome}`; desenharChat();
  const r = await chamarGroq({
    model: modeloAuxiliar(), reasoning_effort: 'low', max_completion_tokens: 1300,
    messages: [
      { role: 'system', content: 'Você extrai informação de documentos. Responda em português, só com fatos do documento, sem opinião.' },
      { role: 'user', content: `Pergunta do usuário: "${pergunta.slice(0, 300)}"\nExtraia deste documento tudo que importa para a pergunta, mantendo números, datas, nomes, cargos, empresas, formação, idiomas e tecnologias. No máximo 2.500 caracteres.\n<<<\n${a.texto.slice(0, 16000)}\n>>>` },
    ],
  }, { visivel: true });
  return r && r.ok ? String((r.data.choices[0].message || {}).content || '').slice(0, 3000) : null;
}

// mantém a conversa dentro do limite por minuto: corta respostas antigas de ferramentas
function compactar(msgs, alvo) {
  const tam = () => estimarTokens({ messages: msgs, tools: FERRAMENTAS });
  for (let i = 1; i < msgs.length - 1 && tam() > alvo; i++) {
    const m = msgs[i];
    if ((m.role === 'tool' || (m.role === 'user' && i < msgs.length - 3) || (m.role === 'assistant' && i < msgs.length - 3)) && typeof m.content === 'string' && m.content.length > 700) {
      m.content = m.content.slice(0, 600) + '…(cortado para caber no limite)';
    }
  }
}

async function rodarConversa() {
  iaOcupado = true; desenharChat();
  let usado = null;
  try {
    const principal = await modeloAtual(false);
    const conv = iaMsgs.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'resumo').slice(-10);
    const hist = conv.map((m, i) => ({ role: m.role === 'resumo' ? 'assistant' : m.role, content: i < conv.length - 3 && m.content.length > 1500 ? m.content.slice(0, 1500) + '…' : m.content }));
    const msgs = [{ role: 'system', content: promptSistema() }, ...hist];
    for (let passo = 0; passo < IA_MAX_PASSOS; passo++) {
      iaPassoTxt = passo ? iaPassoTxt : 'pensando'; desenharChat();
      compactar(msgs, 6500);
      let r = await chamarGroq({ model: principal, messages: msgs, tools: FERRAMENTAS, tool_choice: 'auto', reasoning_effort: 'low', max_completion_tokens: 1500 }, { visivel: true });
      if (r && !r.ok && (r.status === 413 || /too large|context length|maximum context/i.test(r.error || ''))) {
        compactar(msgs, 3500);
        r = await chamarGroq({ model: principal, messages: msgs, tools: FERRAMENTAS, tool_choice: 'auto', reasoning_effort: 'low', max_completion_tokens: 1200 }, { visivel: true });
      }
      if (!r || !r.ok) {
        const e = new Error(
          r && r.status === 401 ? 'A chave da Groq foi recusada. Confira a chave ou crie outra no console da Groq.'
            : r && r.status === 429 && r.diario ? `O limite diário da Groq acabou para todos os modelos que tentei. Ele volta ${r.espera ? `em cerca de ${Math.max(1, Math.round(r.espera / 3600000))} h` : 'amanhã'}.`
              : r && r.status === 429 ? `A Groq ainda está no limite por minuto. Tente de novo em ${Math.ceil((r.espera || 20000) / 1000)} s.`
                : (r && r.error) || 'sem resposta');
        e.retry = !(r && r.status === 401);
        throw e;
      }
      usado = r.modelo;
      const msg = r.data.choices[0].message;
      const calls = msg.tool_calls || [];
      if (!calls.length) {
        iaMsgs.push({ role: 'assistant', content: msg.content || '(sem resposta)', ...(usado && usado !== principal ? { modelo: usado } : {}) });
        break;
      }
      msgs.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
      for (const c of calls) {
        let args = {};
        try { args = JSON.parse(c.function.arguments || '{}'); } catch (e) { /* args vazios */ }
        iaPassoTxt = PASSO_TXT[c.function.name] || 'trabalhando'; desenharChat();
        let res;
        try { res = await executarFerramenta(c.function.name, args); } catch (e) { res = { erro: e.message }; }
        msgs.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(res).slice(0, 6000) });
      }
      if (passo === IA_MAX_PASSOS - 1) iaMsgs.push({ role: 'assistant', content: 'Precisei de muitos passos para essa pergunta. Pode reformular de forma mais específica?' });
    }
  } catch (e) {
    iaMsgs.push({ role: 'erro', content: e.message, retry: !!e.retry });
  }
  iaOcupado = false;
  iaUltimaAtividade = Date.now();
  if ($('#iaModelo') && state.config.iaModelo) $('#iaModelo').textContent = state.config.iaModelo;
  salvarHistorico();
  desenharChat();
}
function salvarHistorico() {
  // documentos longos ficam inteiros só na sessão; no histórico salvo, só o começo
  const h = iaMsgs.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'resumo').slice(-40).map((m) => (m.anexos && m.content.length > 6000 ? { ...m, content: m.content.slice(0, 6000) + '\n>>> (documento cortado no histórico)' } : m));
  state.assistente = { ...(state.assistente || {}), historico: h };
  save();
}

/* ---------- painel ---------- */
async function iaConfig() {
  const temIA = !!(window.net && window.net.ia);
  const s = temIA ? await window.net.ia.status() : { temChave: false };
  $('#iaSetup').hidden = !!s.temChave;
  $('#iaMain').hidden = !s.temChave;
  $('#iaModelo').textContent = s.temChave ? (state.config.iaModelo || 'modelo será escolhido na primeira pergunta') : '';
  $('#iaCripto').textContent = s.criptografada === false ? 'O Windows não ofereceu criptografia; a chave fica só neste computador.' : 'A chave fica criptografada pelo Windows, só neste computador.';
  if (!temIA) $('#iaSetupMsg').textContent = `${NOME_IA} funciona no app para Windows.`;
  mostrarCota();
}
function abrirIA(abrir) {
  const d = $('#iaDrawer');
  const on = abrir === undefined ? d.hidden : abrir;
  d.hidden = !on;
  $('#iaFab').setAttribute('aria-expanded', String(on));
  if (on) { iaConfig(); desenharChat(); atualizarSugestoes(); avisoIA(false); setTimeout(() => $('#iaInput') && $('#iaInput').focus(), 50); }
}
(function bindIA() {
  iaMsgs = ((state.assistente && state.assistente.historico) || []).slice(-40);
  $('#iaFab').addEventListener('click', () => abrirIA());
  $('#iaFechar').addEventListener('click', () => abrirIA(false));
  $('#iaForm').addEventListener('submit', (e) => { e.preventDefault(); enviar($('#iaInput').value); });
  $('#iaInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar($('#iaInput').value); } });
  $('#iaSug').addEventListener('click', (e) => { const b = e.target.closest('[data-sug]'); if (b) enviar(b.dataset.sug); });
  $('#iaLog').addEventListener('click', (e) => {
    const ap = e.target.closest('[data-aplicar]'), ds = e.target.closest('[data-descartar]');
    if (ap) {
      const p = iaPendentes[ap.dataset.aplicar];
      try {
        const antes = calcAll()[state.cenarioAtivo].sobra;
        const feitas = aplicarAlteracoes(state, p.alteracoes); p.estado = 'aplicada';
        if (typeof sincronizarAscendencia === 'function') sincronizarAscendencia();
        registrarDecisao(p.explicacao, { origem: NOME_IA, alteracoes: feitas, antes, depois: calcAll()[state.cenarioAtivo].sobra });
        save(); renderTopo(); construirVista(); refresh(); toast('Alterações aplicadas e anotadas no diário');
      }
      catch (err) { toast(`Não foi possível aplicar: ${err.message}`); }
      desenharChat();
    }
    if (ds) { iaPendentes[ds.dataset.descartar].estado = 'descartada'; desenharChat(); }
    if (e.target.closest('[data-retry]') && !iaOcupado) {
      const i = iaMsgs.map((m) => m.role).lastIndexOf('erro');
      if (i >= 0) iaMsgs.splice(i, 1);
      rodarConversa();
    }
  });
  $('#iaSalvarChave').addEventListener('click', async () => {
    const k = $('#iaChave').value.trim();
    if (!window.net || !window.net.ia) return;
    const r = await window.net.ia.setKey(k);
    if (!r || !r.ok) { toast((r && r.error) || 'Chave inválida'); return; }
    $('#iaChave').value = '';
    await modeloAtual(true);
    toast(`Chave salva. ${NOME_IA} está pronto.`);
    iaConfig();
  });
  $('#iaRemover').addEventListener('click', async () => {
    if (!(await confirmar(`Remover a chave da Groq deste computador? ${NOME_IA} para de funcionar até você colar outra.`, 'Remover'))) return;
    await window.net.ia.clearKey();
    iaConfig();
  });
  $('#iaLimpar').addEventListener('click', () => { iaMsgs = []; salvarHistorico(); desenharChat(); });
  $('#iaAtualizarModelo').addEventListener('click', async () => { const m = await modeloAtual(true); $('#iaModelo').textContent = m; toast(`Usando ${m}`); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#iaDrawer').hidden) abrirIA(false); });
})();

/* ---------- diário de decisões ---------- */
function registrarDecisao(texto, extra) {
  extra = extra || {};
  if (!Array.isArray(state.decisoes)) state.decisoes = [];
  state.decisoes.push({
    id: nid('dc'), data: new Date().toISOString(), texto: String(texto || '').trim() || 'Decisão', origem: extra.origem || 'Você',
    alteracoes: extra.alteracoes || [], antes: extra.antes == null ? null : Math.round(extra.antes), depois: extra.depois == null ? null : Math.round(extra.depois),
    cenario: state.cenarioAtivo, fonte: extra.fonte || '',
  });
  if (state.decisoes.length > 300) state.decisoes.splice(0, state.decisoes.length - 300);
  save();
}

/* ---------- perguntar a partir de qualquer aba ---------- */
function iaPerguntar(texto) {
  abrirIA(true);
  setTimeout(() => enviar(texto), 120);
}

/* ---------- sugestões conforme a aba ---------- */
const SUGESTOES = {
  painel: ['Resuma como está o plano hoje e o maior risco.', 'O que mais aumentaria a sobra mensal?'],
  plano: ['Qual é o mês mais apertado e por quê?', 'A reserva aguenta um atraso de 6 meses para achar emprego?'],
  rendas: ['Quanto chega de cada renda depois de impostos e remessa?', 'Algum benefício do emprego atual continua valendo morando em Portugal? Pesquise.'],
  investimentos: ['Vale manter os investimentos no Brasil depois da mudança?', 'Compare o CDI do plano com o de hoje.'],
  despesas: ['Os valores de aluguel e mercado da cidade estão de acordo com os preços atuais? Pesquise.', 'Onde dá para cortar sem mexer na qualidade de vida?'],
  impostos: ['Explique por que o regime escolhido de IRS é o mais barato.', 'Quanto muda o IRS com o IRS Jovem?'],
  familia: ['Quanto custa a mais ter um filho em Portugal no nosso plano?'],
  cidades: ['Qual cidade deixa a maior sobra e quais as desvantagens dela?', 'Compare Viseu com Braga e Coimbra.'],
  mudanca: ['Algum custo da mudança está subestimado? Pesquise preços atuais.'],
  vistos: ['Qual visto faz mais sentido para nós e o que falta para cumprir os requisitos?', 'Me ajude a completar a árvore de ascendência.'],
  viagem: ['Qual a melhor época para comprar a passagem? Busque os preços.', 'O que levar na bagagem de mão no dia da mudança?'],
  vagas: ['Quais áreas de TI pagam melhor em Portugal? Pesquise faixas salariais atuais.', 'Que salário bruto eu preciso para a sobra chegar à meta?'],
  checklist: ['O que está atrasado e o que vence nos próximos 3 meses?'],
  acompanhamento: ['Analise o último mês registrado no acompanhamento.'],
  mercado: ['Compare as premissas dos cenários com o euro, os juros e a inflação de hoje.', 'Quantos euros devo comprar por mês até a mudança?'],
  cenarios: ['Os três cenários estão bem calibrados com a realidade? Pesquise.'],
  vasco: ['Verifique se alguma regra mudou desde a última vez.', 'Resuma as decisões que já tomamos.'],
};
const SUG_GERAIS = ['Comparar com dados reais|Compare as premissas dos cenários com o euro, os juros e a inflação de hoje.', 'E se o euro subir?|Quanto muda a sobra mensal se o euro subir 10%?'];
function atualizarSugestoes() {
  const box = $('#iaSug');
  if (!box) return;
  const ctx = (SUGESTOES[viewAtual] || []).map((t) => [t.length > 34 ? t.slice(0, 32).replace(/\s+\S*$/, '') + '…' : t, t]);
  const ger = SUG_GERAIS.map((x) => x.split('|'));
  box.innerHTML = [...ctx, ...ger].slice(0, 5).map(([rot, t]) => `<button data-sug="${esc(t)}" title="${esc(t)}">${esc(rot)}</button>`).join('');
}
(function ganchoNavegacao() {
  const original = go;
  go = function (view) { original(view); atualizarSugestoes(); };
})();

/* ---------- modelos auxiliares: visão e voz ---------- */
async function listaModelos() {
  const r = await window.net.ia.models();
  return r && r.ok ? r.ids : [];
}
async function modeloVisao() {
  const c = state.config;
  if (c.iaVisao && Date.now() - num(c.iaModelosEm) < 24 * 3600e3) return c.iaVisao;
  const ids = await listaModelos();
  const pref = ['qwen/qwen3.8-27b', 'meta-models/muse-spark-open', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct'];
  c.iaVisao = pref.find((m) => ids.includes(m)) || ids.find((m) => /vision|\bvl\b|-vl-|llama-4|scout|maverick|qwen3\.8|muse/i.test(m)) || '';
  save();
  return c.iaVisao;
}
async function modeloVoz() {
  const c = state.config;
  if (c.iaVoz) return c.iaVoz;
  const ids = await listaModelos();
  c.iaVoz = ['whisper-large-v3', 'whisper-large-v3-turbo'].find((m) => ids.includes(m)) || ids.find((m) => /whisper/i.test(m)) || 'whisper-large-v3';
  save();
  return c.iaVoz;
}

/* ---------- documentos ---------- */
let iaAnexos = []; // { nome, descricao, texto }
let iaLendo = false;
const MAX_DOC = 24000;
function desenharAnexos() {
  const box = $('#iaAnexos');
  if (!box) return;
  box.hidden = !iaAnexos.length && !iaLendo;
  box.innerHTML = iaAnexos.map((a, i) => `<span class="ia-anexo"><svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>${esc(a.nome)}<small>${esc(a.descricao)}</small><button type="button" class="icon-btn" data-tirar="${i}" aria-label="Tirar anexo">×</button></span>`).join('')
    + (iaLendo ? `<span class="ia-anexo lendo">${esc(iaLendo)}</span>` : '');
}
function textoDoPdfItens(items) {
  let out = '', ultY = null, ultFim = null;
  for (const it of items) {
    if (!it.str && !it.hasEOL) continue;
    const x = it.transform ? it.transform[4] : 0, y = it.transform ? it.transform[5] : 0, h = it.height || 10;
    if (ultY !== null && Math.abs(y - ultY) > h * 0.5) out += '\n';
    else if (ultFim !== null && x - ultFim > h * 0.18 && !out.endsWith(' ')) out += ' ';
    out += it.str;
    ultY = y; ultFim = x + (it.width || 0);
    if (it.hasEOL) { out += '\n'; ultY = null; ultFim = null; }
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}
async function imagemParaDataURL(fonte, max) {
  max = max || 1600;
  const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => erro(new Error('não consegui abrir a imagem')); i.src = fonte; });
  const f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.naturalWidth * f); cv.height = Math.round(img.naturalHeight * f);
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.85);
}
async function transcreverImagens(urls, nome) {
  const modelo = await modeloVisao();
  if (!modelo) throw new Error('A Groq não tem agora um modelo que lê imagens nesta conta. Envie o documento em PDF com texto ou CSV.');
  const partes = [];
  for (let i = 0; i < urls.length; i += 3) {
    const r = await chamarGroq({ model: modelo, max_completion_tokens: 1500, messages: [{ role: 'user', content: [
      { type: 'text', text: `Transcreva fielmente todo o texto e todos os números desta imagem de documento ("${nome}"), mantendo tabelas como linhas "coluna: valor". Não resuma nem comente. Se não houver texto, descreva o que a imagem mostra em uma frase.` },
      ...urls.slice(i, i + 3).map((u) => ({ type: 'image_url', image_url: { url: u } })),
    ] }] }, { troca: false, visivel: true });
    if (!r || !r.ok) throw new Error(`Não consegui ler a imagem: ${(r && r.error) || 'sem resposta'}`);
    partes.push(String((r.data.choices[0].message || {}).content || ''));
  }
  return partes.join('\n\n');
}
async function lerArquivo(file) {
  const nome = file.name || 'documento';
  const ext = (nome.split('.').pop() || '').toLowerCase();
  if (file.size > 25 * 1024 * 1024) throw new Error('Arquivo grande demais (máximo 25 MB).');
  if (ext === 'pdf' || file.type === 'application/pdf') {
    if (!window.pdfjsLib) throw new Error('Leitor de PDF indisponível.');
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
    const n = Math.min(doc.numPages, 40);
    let texto = '';
    for (let i = 1; i <= n; i++) { const pg = await doc.getPage(i); texto += textoDoPdfItens((await pg.getTextContent()).items) + '\n\n'; }
    if (texto.replace(/\s/g, '').length < 40 * n) {
      // PDF escaneado: lê as primeiras páginas como imagem
      const urls = [];
      for (let i = 1; i <= Math.min(n, 3); i++) {
        const pg = await doc.getPage(i);
        const vp = pg.getViewport({ scale: 1.6 });
        const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
        await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        urls.push(cv.toDataURL('image/jpeg', 0.85));
      }
      texto = await transcreverImagens(urls, nome);
      return { nome, descricao: `PDF escaneado, ${doc.numPages} ${doc.numPages === 1 ? 'página' : 'páginas'}${doc.numPages > 3 ? ', li as 3 primeiras' : ''}`, texto: texto.slice(0, MAX_DOC) };
    }
    return { nome, descricao: `PDF, ${doc.numPages} ${doc.numPages === 1 ? 'página' : 'páginas'}${doc.numPages > n ? `, li ${n}` : ''}`, texto: texto.trim().slice(0, MAX_DOC) + (texto.length > MAX_DOC ? '\n(cortado)' : '') };
  }
  if (/^image\//.test(file.type) || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) {
    const url = URL.createObjectURL(file);
    try { return { nome, descricao: 'imagem', texto: (await transcreverImagens([await imagemParaDataURL(url)], nome)).slice(0, MAX_DOC) }; }
    finally { URL.revokeObjectURL(url); }
  }
  if (['csv', 'txt', 'md', 'json', 'tsv', 'ofx', 'xml', 'html', 'htm'].includes(ext) || /^text\//.test(file.type)) {
    const t = await file.text();
    return { nome, descricao: `texto, ${t.split('\n').length} linhas`, texto: t.slice(0, MAX_DOC) + (t.length > MAX_DOC ? '\n(cortado)' : '') };
  }
  throw new Error('Formato não suportado. Envie PDF, imagem, CSV ou texto (planilhas: exporte como CSV).');
}
async function anexarArquivos(files) {
  for (const f of Array.from(files || []).slice(0, 4)) {
    iaLendo = `lendo ${f.name}…`; desenharAnexos();
    try {
      const a = await lerArquivo(f);
      iaAnexos.push(a);
      const docs = (state.assistente = state.assistente || {}).documentos = (state.assistente.documentos || []);
      docs.push({ id: nid('doc'), nome: a.nome, descricao: a.descricao, data: new Date().toISOString(), caracteres: a.texto.length, inicio: a.texto.slice(0, 240) });
      if (docs.length > 60) docs.splice(0, docs.length - 60);
      save();
    } catch (e) { toast(e.message); }
    iaLendo = false; desenharAnexos();
  }
  if (viewAtual === 'vasco') refresh();
}

/* ---------- voz ---------- */
let gravador = null, gravPartes = [], gravTimer = null, gravInicio = 0;
async function alternarGravacao() {
  const btn = $('#iaMic');
  if (gravador && gravador.state === 'recording') { gravador.stop(); return; }
  if (!window.net || !window.net.ia || !window.net.ia.transcrever) return toast(`A voz funciona no app para Windows.`);
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { return toast('Não consegui usar o microfone. Confira a permissão do Windows para microfone.'); }
  gravPartes = [];
  const tipo = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  gravador = new MediaRecorder(stream, { mimeType: tipo });
  gravador.ondataavailable = (e) => { if (e.data && e.data.size) gravPartes.push(e.data); };
  gravador.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(gravTimer);
    btn.classList.remove('gravando'); btn.querySelector('small').textContent = '';
    const blob = new Blob(gravPartes, { type: 'audio/webm' });
    if (blob.size < 2000) return;
    iaLendo = 'transcrevendo o áudio…'; desenharAnexos();
    const r = await window.net.ia.transcrever(await blob.arrayBuffer(), 'audio/webm', await modeloVoz());
    iaLendo = false; desenharAnexos();
    if (!r || !r.ok) return toast(`Não consegui transcrever: ${(r && r.error) || 'sem resposta'}`);
    const txt = String(r.texto || '').trim();
    if (!txt) return toast('Não entendi o áudio. Tente de novo mais perto do microfone.');
    enviar(txt);
  };
  gravador.start(1000);
  gravInicio = Date.now();
  btn.classList.add('gravando');
  gravTimer = setInterval(() => {
    const s = Math.round((Date.now() - gravInicio) / 1000);
    btn.querySelector('small').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s >= 120) gravador.stop();
  }, 250);
}

/* ---------- aviso no botão ---------- */
function avisoIA(on) { const d = $('#iaDot'); if (d) d.hidden = !on; }

(function bindExtras() {
  atualizarSugestoes();
  $('#iaClip').addEventListener('click', () => $('#iaArquivo').click());
  $('#iaArquivo').addEventListener('change', (e) => { anexarArquivos(e.target.files); e.target.value = ''; });
  $('#iaAnexos').addEventListener('click', (e) => { const b = e.target.closest('[data-tirar]'); if (b) { iaAnexos.splice(+b.dataset.tirar, 1); desenharAnexos(); } });
  $('#iaMic').addEventListener('click', alternarGravacao);
  const dw = $('#iaDrawer');
  dw.addEventListener('dragover', (e) => { e.preventDefault(); dw.classList.add('soltar'); });
  dw.addEventListener('dragleave', (e) => { if (!dw.contains(e.relatedTarget)) dw.classList.remove('soltar'); });
  dw.addEventListener('drop', (e) => { e.preventDefault(); dw.classList.remove('soltar'); anexarArquivos(e.dataTransfer.files); });
  $('#iaFab').addEventListener('click', () => avisoIA(false));
})();

window.__ia = { escolherModelo, ordenarModelos, chamarGroq, cotaIA, duracaoMs, estimarTokens, aplicarAlteracoes, simular: iaSimular, lerResumo, lerSecao, md, executarFerramenta, enviar, lerArquivo, anexarArquivos, textoDoPdfItens, registrarDecisao, iaPerguntar };
