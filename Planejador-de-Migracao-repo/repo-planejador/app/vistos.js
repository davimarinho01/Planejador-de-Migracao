'use strict';

/* =========================================================
   Aba Vistos: catálogo, elegibilidade calculada com os dados
   do plano, linha do tempo até a nacionalidade.
   Regras consultadas em out/2026 (Lei 61/2025 e Lei Orgânica 1/2026).
   ========================================================= */

const LINKS_VISTO = {
  mne: ['Portal de Vistos (MNE)', 'https://vistos.mne.gov.pt/pt/vistos-nacionais/informacao-geral/tipos-de-visto'],
  vfs: ['VFS Global Brasil', 'https://www.vfsglobal.com/Portugal/Brazil/index.html'],
  aima: ['AIMA', 'https://aima.gov.pt/'],
  irn: ['Nacionalidade (IRN)', 'https://justica.gov.pt/Servicos/Pedir-nacionalidade-portuguesa'],
};
// valores que a aba Vasco pode atualizar (Regras vigiadas)
const taxaConsular = () => num(state.config.taxaConsular) || 110; // visto nacional, Embaixada de Portugal no Brasil (2026)
const VFS_BRL = 180;           // taxa de serviço da VFS, estimativa

const VISTOS = [
  {
    id: 'd7', nome: 'D7 · Rendimentos próprios', para: 'Quem vive de aposentadoria, aluguéis, dividendos ou juros.',
    requisitos: ['Renda passiva de 1 salário mínimo para o titular, +50% por adulto e +30% por criança', 'Reserva para 12 meses costuma ser aceita como meio de subsistência', 'Alojamento em Portugal (contrato, reserva ou termo de responsabilidade)', 'Antecedentes criminais da Polícia Federal, apostilados (validade de 90 dias)', 'Seguro de viagem: dispensado para brasileiros na lista da VFS; confirme ao agendar'],
    trabalho: 'Depois da autorização de residência pode trabalhar, mas o D7 não é pensado para quem vive de trabalho remoto.',
    familia: 'Cônjuge e filhos pedem visto de acompanhamento junto com o titular.',
    prazo: 'Decisão em até 60 dias pela lei; na prática 60 a 90 dias.',
    duracao: 'Visto de 4 meses com 2 entradas; a AIMA concede residência de 2 anos, renovável por 3.',
    custo: true, links: ['mne', 'vfs', 'aima'],
    docs: ['Formulário de visto nacional e 2 fotos 3×4', 'Comprovantes de renda passiva (aluguel, extratos de investimento)', 'Extratos bancários dos últimos meses', 'Comprovante de alojamento em Portugal'],
  },
  {
    id: 'd8', nome: 'D8 · Nômade digital', para: 'Quem trabalha remoto para empresa ou clientes fora de Portugal.',
    requisitos: ['Renda média de trabalho remoto nos últimos 3 meses de 4 salários mínimos', 'Contrato ou declaração do empregador autorizando trabalho remoto', 'Família: +50% do salário mínimo por adulto e +30% por criança, a confirmar com o consulado', 'Antecedentes criminais apostilados e comprovante de residência fiscal'],
    trabalho: 'Feito para trabalho remoto. Também existe a versão de estadia temporária, de menos de um ano, que não leva à residência.',
    familia: 'Cônjuge e filhos pedem visto de acompanhamento junto.',
    prazo: 'Decisão em até 60 dias; AIMA tem 90 dias para a residência.',
    duracao: 'Visto de 4 meses; residência de 2 anos, renovável por 3.',
    custo: true, links: ['mne', 'vfs'],
    docs: ['Contrato de trabalho com cláusula de trabalho remoto', 'Contracheques ou extratos dos últimos 3 meses', 'Declaração de residência fiscal'],
  },
  {
    id: 'd4', nome: 'D4 · Estudo no ensino superior', para: 'Quem foi admitido em licenciatura, mestrado ou doutoramento.',
    requisitos: ['Carta de aceitação ou matrícula numa instituição reconhecida', 'Brasileiros admitidos no ensino superior estão dispensados da prova de meios na lista da VFS', 'Seguro de viagem dispensado para estudante do ensino superior', 'Antecedentes criminais apostilados'],
    trabalho: 'Pode trabalhar de forma complementar aos estudos, sem limite de horas na lei.',
    familia: 'Cônjuge e filhos menores pedem visto de acompanhamento junto com o estudante.',
    prazo: 'Decisão em até 60 dias; na prática 60 a 90.',
    duracao: 'Residência renovável enquanto houver matrícula e frequência.',
    custo: true, links: ['mne', 'vfs'],
    docs: ['Carta de aceitação da instituição', 'Comprovante de pagamento da propina, se pedido'],
  },
  {
    id: 'd1', nome: 'D1 · Trabalho subordinado', para: 'Quem já tem contrato ou promessa de contrato com empresa em Portugal.',
    requisitos: ['Contrato ou promessa de contrato de trabalho em Portugal', 'Qualificações para a função, quando exigidas', 'Antecedentes criminais apostilados'],
    trabalho: 'Visto de trabalho; a residência fica ligada ao emprego no início.',
    familia: 'Família acompanha com visto próprio pedido junto.',
    prazo: 'Decisão em até 60 dias.',
    duracao: 'Residência de 2 anos, renovável por 3.',
    custo: true, links: ['mne', 'vfs'],
    docs: ['Contrato ou promessa de contrato assinada', 'Declaração da empresa portuguesa'],
  },
  {
    id: 'd3', nome: 'D3 · Atividade altamente qualificada', para: 'Profissionais qualificados contratados em Portugal, incluindo o Cartão Azul UE.',
    requisitos: ['Contrato para função qualificada', 'Diploma de ensino superior ou experiência equivalente', 'Cartão Azul UE: salário anual de pelo menos 1,5 vez o salário médio nacional'],
    trabalho: 'Visto de trabalho qualificado; costuma ter análise mais rápida.',
    familia: 'Família acompanha.',
    prazo: 'Decisão em até 60 dias, muitas vezes menos.',
    duracao: 'Residência de 2 anos, renovável.',
    custo: true, links: ['mne'],
    docs: ['Contrato de trabalho qualificado', 'Diploma (apostilado) e currículo'],
  },
  {
    id: 'procura', nome: 'Procura de trabalho qualificado', para: 'Profissionais de áreas da lista oficial que querem procurar emprego em Portugal.',
    requisitos: ['Desde a Lei 61/2025, só para profissões altamente qualificadas de uma lista definida por portaria', 'Meios de subsistência para o período e passagem de volta'],
    trabalho: 'Permite procurar emprego; depois é preciso converter em residência para trabalho.',
    familia: 'Não prevê acompanhamento familiar no mesmo pedido.',
    prazo: 'Decisão em até 60 dias.',
    duracao: 'Estadia limitada; confirme o prazo atual no portal do MNE.',
    custo: true, links: ['mne'],
    docs: ['Comprovante de qualificação na área da lista', 'Passagem de volta ou meios para comprá-la'],
  },
  {
    id: 'neto', nome: 'Nacionalidade por ser neto de portugueses', para: 'Netos de cidadãos portugueses de origem.',
    requisitos: ['Avô ou avó com nacionalidade portuguesa de origem', 'Laço efetivo com Portugal: para brasileiros a língua é presumida; cultura, história e direitos ainda dependem de regulamentação', 'Ausência de condenações e de risco à segurança'],
    trabalho: 'Como cidadão português, pode morar e trabalhar em Portugal e na União Europeia, sem visto.',
    familia: 'O cônjuge entra como familiar de cidadão da UE e pode pedir a nacionalidade após 3 anos de casamento ou união.',
    prazo: 'O processo no registro costuma levar mais de um ano; vale começar cedo.',
    duracao: 'Permanente.',
    custo: false, links: ['irn'],
    docs: ['Certidões de nascimento em inteiro teor do avô, do pai ou mãe e sua', 'Certidão de casamento, se for o caso', 'Antecedentes criminais'],
  },
  {
    id: 'bisneto', nome: 'Bisneto de portugueses', para: 'Descendentes de 3º grau de portugueses de origem.',
    requisitos: ['Não há atribuição direta da nacionalidade para bisnetos', 'O Governo pode conceder naturalização após 5 anos de residência legal (decisão discricionária)'],
    trabalho: 'Até lá, vale um dos vistos acima.',
    familia: 'Segue as regras do visto usado.',
    prazo: 'Depende da regulamentação.',
    duracao: '—',
    custo: false, links: ['irn'],
    docs: ['Certidões que comprovem a linha de descendência'],
  },
];

function avaliarVisto(id, r) {
  const sm = num(state.metas.salarioMinimo);
  const fam = r.fam;
  const c = r.tip.cambio;
  const L = [];
  const add = (ok, txt) => L.push({ ok, txt });
  const remotoAtivo = r.tip.rend.filter((x) => x.ativa && x.tipo === 'trabalho');
  const ptAtivo = st().rendas.filter((x) => x.ativo && x.tipo === 'trabalho_pt');
  const asc = (p) => (st().vistos.ascendencia || {})[p.id] || 'nao';
  let status = 'parcial';
  switch (id) {
    case 'd7': {
      const okRenda = r.passiva >= r.exigMes;
      const okReserva = r.reservaEUR >= r.d7Exig;
      add(okRenda, `Renda passiva de ${eur(r.passiva)} por mês para ${eur(r.exigMes)} exigidos`);
      add(okReserva, `Reserva de ${eur(r.reservaEUR)} para ${eur(r.d7Exig)} em 12 meses`);
      if (remotoAtivo.length) add(false, `${remotoAtivo.map((x) => x.nome).join(' e ')} ${remotoAtivo.length > 1 ? 'são trabalho ativo' : 'é trabalho ativo'}: o D7 é para renda passiva`);
      status = okRenda && !remotoAtivo.length ? 'ok' : okReserva ? 'parcial' : 'nao';
      break;
    }
    case 'd8': {
      const exig = 4 * sm;
      const porPessoa = {};
      for (const x of remotoAtivo) porPessoa[x.pessoa || '_'] = (porPessoa[x.pessoa || '_'] || 0) + x.brutoMes / c;
      const melhor = Math.max(0, ...Object.values(porPessoa));
      const nomes = Object.entries(porPessoa).map(([pid, v]) => `${(fam.adultos.find((p) => p.id === pid) || {}).nome || 'renda'}: ${eur(v)}`).join('; ');
      add(melhor >= exig, `Maior renda remota de um titular: ${eur(melhor)} por mês para ${eur(exig)} exigidos${nomes ? ` (${nomes})` : ''}`);
      const extra = sm * (0.5 * (fam.A - 1) + 0.3 * fam.C);
      if (extra > 0) add(null, `Família: cerca de ${eur(extra)} a mais por mês, a confirmar com o consulado`);
      status = melhor >= exig ? 'ok' : 'nao';
      break;
    }
    case 'd4': {
      const propina = st().despesas.some((d) => d.ativo && /propina|universid|politécnico|faculdade/i.test(d.nome));
      add(propina ? null : false, propina ? 'Há propina no plano: falta a carta de aceitação' : 'Nenhuma matrícula prevista no plano');
      add(true, 'Brasileiros admitidos no ensino superior estão dispensados da prova de meios');
      add(true, 'Permite trabalhar junto com os estudos');
      status = propina ? 'parcial' : 'info';
      break;
    }
    case 'd1':
    case 'd3': {
      const emp = ptAtivo.find((x) => x.inicio === null || num(x.inicio) <= 0);
      if (emp) add(true, `“${emp.nome}” começa na chegada: com contrato assinado, o pedido é possível`);
      else if (ptAtivo.length) add(null, `“${ptAtivo[0].nome}” começa no mês ${num(ptAtivo[0].inicio)}: o D1 exige o contrato antes de viajar`);
      else add(false, 'Nenhum emprego em Portugal no plano');
      if (id === 'd3') add(null, 'Para o Cartão Azul, o salário anual precisa ser de pelo menos 1,5 vez o salário médio');
      status = emp ? 'ok' : ptAtivo.length ? 'parcial' : 'nao';
      break;
    }
    case 'procura':
      add(null, 'Depende de a sua profissão estar na lista oficial de profissões altamente qualificadas');
      status = 'info';
      break;
    case 'neto': {
      const netos = fam.adultos.filter((p) => asc(p) === 'neto');
      const arvN = typeof analisarAscendencia === 'function' ? analisarAscendencia() : null;
      if (arvN && arvN.tipo === 'cadeia') add(null, `Pela árvore, ${arvN.titular} chega à nacionalidade em cadeia: ${arvN.passos.length} etapas, começando por ${arvN.passos[0].quem}`);
      if (netos.length) {
        add(true, `${netos.map((p) => p.nome).join(' e ')} ${netos.length > 1 ? 'podem' : 'pode'} pedir a nacionalidade sem morar em Portugal`);
        const outros = fam.adultos.filter((p) => asc(p) !== 'neto');
        if (outros.length) add(true, `${outros.map((p) => p.nome).join(' e ')} entra${outros.length > 1 ? 'm' : ''} como familiar de cidadão da UE`);
        status = 'ok';
      } else {
        add(null, 'Marque abaixo quem é neto de portugueses');
        status = 'info';
      }
      break;
    }
    case 'bisneto': {
      const b = fam.adultos.filter((p) => asc(p) === 'bisneto');
      add(b.length ? null : null, b.length ? `${b.map((p) => p.nome).join(' e ')}: naturalização possível depois de 5 anos de residência, a critério do Governo` : 'Marque abaixo quem é bisneto de portugueses');
      status = 'info';
      break;
    }
  }
  return { status, linhas: L };
}
const st = () => state;
const STATUS_VISTO = { ok: ['Atende', 'ok'], parcial: ['Atende em parte', 'warn'], nao: ['Não atende', 'bad'], info: ['Depende de vocês', 'info'] };

function custoVistoBRL(r) {
  return taxaConsular() * r.tip.cambio + VFS_BRL;
}

V.vistos = {
  build() {
    if (!state.vistos) state.vistos = { escolhido: '', ascendencia: {} };
    const asc = state.vistos.ascendencia || {};
    const arv = typeof analisarAscendencia === 'function' ? analisarAscendencia() : null;
    const titularArv = arv && arv.geracao ? state.ascendencia.titular : null;
    if (typeof renderAscendencia === 'function') renderAscendencia();
    $('#vsAsc').innerHTML = state.familia.pessoas.filter((p) => p.tipo !== 'crianca' && p.id !== titularArv).map((p) => `
      <div class="mk-row"><div><span>${esc(p.nome || 'Adulto')}</span><small>Ascendência portuguesa</small></div>
      <div>${sel('asc', asc[p.id] || 'nao', { nao: 'Não', neto: 'Neto ou neta', bisneto: 'Bisneto ou bisneta' }).replace('data-f="asc"', `data-f="asc" data-pid="${p.id}"`)}</div></div>`).join('');
  },
  update(all) {
    const r = all[state.cenarioAtivo];
    if (typeof renderAscResultado === 'function') renderAscResultado();
    const esc1 = state.vistos.escolhido;
    $('#vsCards').innerHTML = VISTOS.map((v) => {
      const a = avaliarVisto(v.id, r);
      const [stTxt, stCls] = STATUS_VISTO[a.status];
      const custo = v.custo ? `${brl(custoVistoBRL(r) * r.fam.P)} para ${r.fam.P} ${r.fam.P === 1 ? 'pessoa' : 'pessoas'} (taxa consular de € ${taxaConsular()} e serviço da VFS)` : 'Sem taxa de visto; há custos de registro e certidões';
      return `<article class="visa ${esc1 === v.id ? 'chosen' : ''}" data-v="${v.id}">
        <header><div><h3>${esc(v.nome)}</h3><p>${esc(v.para)}</p></div><span class="pill ${stCls}">${stTxt}</span></header>
        <ul class="checks">${a.linhas.map((l) => `<li class="${l.ok === true ? 'yes' : l.ok === false ? 'no' : 'maybe'}">${esc(l.txt)}</li>`).join('')}</ul>
        <details><summary>Requisitos, prazos e custos</summary>
          <dl class="visa-dl">
            <dt>Requisitos</dt><dd><ul>${v.requisitos.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></dd>
            <dt>Trabalho</dt><dd>${esc(v.trabalho)}</dd>
            <dt>Família</dt><dd>${esc(v.familia)}</dd>
            <dt>Prazo</dt><dd>${esc(v.prazo)}</dd>
            <dt>Duração</dt><dd>${esc(v.duracao)}</dd>
            <dt>Custo</dt><dd>${custo}</dd>
          </dl>
          <p class="links">${v.links.map((k) => `<a href="${LINKS_VISTO[k][1]}" target="_blank">${LINKS_VISTO[k][0]}</a>`).join('')}</p>
        </details>
        <div class="btn-row">${esc1 === v.id ? '<button class="primary" disabled>Visto escolhido</button>' : `<button data-escolher="${v.id}">Escolher este caminho</button>`}</div>
      </article>`;
    }).join('');

    const v = VISTOS.find((x) => x.id === esc1);
    $('#vsHead').innerHTML = v ? `Caminho escolhido<b>${esc(v.nome)}</b>` : 'Nenhum caminho escolhido ainda<b>compare abaixo</b>';
    $('#vsAcoes').hidden = !v;
    if (v) $('#vsCustoBtn').hidden = !v.custo;

    // linha do tempo até a nacionalidade
    const mud = parseMes(state.plano.dataMudanca);
    const marcos = v && (v.id === 'neto')
      ? [[0, 'Pedido da nacionalidade', 'pode começar antes da mudança'], [0, 'Chegada', 'sem visto de residência'], [36, 'Cônjuge pode pedir a nacionalidade', 'após 3 anos de casamento ou união']]
      : [[0, 'Chegada e pedido na AIMA', 'entrar com o visto já emitido'], [24, 'Renovação da autorização', 'por mais 3 anos'], [60, 'Residência permanente', 'possível após 5 anos'],
        ...(Object.values(state.vistos.ascendencia || {}).includes('bisneto') ? [[(num(state.config.anosBisneto) || 5) * 12, 'Naturalização como bisneto', `após ${num(state.config.anosBisneto) || 5} anos, a critério do Governo`]] : []),
        [(num(state.config.anosNacionalidade) || 7) * 12, 'Nacionalidade', `${num(state.config.anosNacionalidade) || 7} anos de residência legal para brasileiros`]].sort((a, b) => a[0] - b[0]);
    $('#vsTimeline').innerHTML = marcos.map(([m, t, s]) => `<li><b>${mesLabel(addMes(mud, m))}</b><span>${esc(t)}</span><small>${esc(s)}</small></li>`).join('');
  },
};
(function bindVistos() {
  $('#vsCards').addEventListener('click', (e) => {
    const b = e.target.closest('[data-escolher]');
    if (!b) return;
    state.vistos.escolhido = b.dataset.escolher;
    save(); refresh();
    toast('Caminho escolhido. Adicione os documentos ao checklist quando quiser.');
  });
  $('#vsAsc').addEventListener('change', (e) => {
    const el = e.target.closest('[data-pid]');
    if (!el) return;
    state.vistos.ascendencia = { ...(state.vistos.ascendencia || {}), [el.dataset.pid]: el.value };
    save(); refresh();
  });
  $('#vsDocsBtn').addEventListener('click', () => {
    const v = VISTOS.find((x) => x.id === state.vistos.escolhido);
    if (!v) return;
    let n = 0;
    for (const d of v.docs) {
      const titulo = `${v.nome.split(' · ')[0]}: ${d}`;
      if (state.tarefas.some((t) => t.titulo === titulo)) continue;
      state.tarefas.push({ id: nid('t'), grupo: 'Visto', titulo, quando: v.id === 'neto' ? -12 : -4, status: 'pendente', nota: '' });
      n++;
    }
    save(); refresh();
    toast(n ? `${n} ${n === 1 ? 'tarefa adicionada' : 'tarefas adicionadas'} ao checklist` : 'Essas tarefas já estão no checklist');
  });
  $('#vsCustoBtn').addEventListener('click', () => {
    const r = ultimoAll ? ultimoAll[state.cenarioAtivo] : calcAll()[state.cenarioAtivo];
    const valor = Math.round(custoVistoBRL(r) * 100) / 100;
    let item = state.entrada.find((e) => /visto consular/i.test(e.nome));
    if (!item) { item = { id: nid('e'), nome: 'Visto consular', moeda: 'BRL', valor, porPessoa: true, nota: '' }; state.entrada.push(item); }
    Object.assign(item, { moeda: 'BRL', valor, porPessoa: true, nota: `€ ${taxaConsular()} + VFS, câmbio de R$ ${nf(2).format(r.tip.cambio)}` });
    save(); refresh();
    toast(`Visto consular: ${brl(valor)} por pessoa nos custos da mudança`);
  });
})();
