'use strict';

/* =========================================================
   Árvore até o antepassado português e o caminho da nacionalidade.
   Base: Lei n.º 37/81 republicada pela Lei Orgânica n.º 1/2026
   (em vigor desde 19/05/2026):
   - art. 1.º, n.º 1, c): filhos de português nascidos no estrangeiro;
   - art. 1.º, n.º 1, d) e n.º 3: netos (2.º grau), com laços efetivos;
   - art. 6.º, n.º 8: bisnetos (3.º grau) podem ser naturalizados após
     5 anos de residência legal, a critério do Governo.
   ========================================================= */

const GERACOES = { '': 'Não sei', 1: 'Pai ou mãe', 2: 'Avô ou avó', 3: 'Bisavô ou bisavó', 4: 'Trisavô ou trisavó', 5: 'Tetravô ou tetravó' };
const SIM_NAO = { sim: 'Sim', nao: 'Não', '?': 'Não sei' };
const CERT_ST = { procurar: 'Procurar', pedida: 'Pedida', tenho: 'Tenho' };
const LINKS_ASC = [
  ['DIGITARQ do Arquivo de Viana do Castelo', 'https://digitarq.advct.arquivos.pt', 'livros paroquiais; use Pesquisa Avançada com o nome da paróquia no campo Título'],
  ['Pedir certidão ao arquivo (CRAV)', 'https://crav.arquivos.pt', 'certidões de batismo e casamento antigos'],
  ['Tombo.pt', 'https://tombo.pt/d/viana-do-castelo', 'índice dos livros por freguesia, com link para as imagens'],
  ['FamilySearch: Viana do Castelo, 1537–1911', 'https://www.familysearch.org/search/collection/1976095', 'imagens dos registos católicos; pede conta gratuita'],
  ['Nacionalidade no IRN', 'https://justica.gov.pt/Servicos/Pedir-nacionalidade-portuguesa', 'formulários e onde entregar'],
];

function ascState() {
  if (!state.ascendencia || !Array.isArray(state.ascendencia.linha)) state.ascendencia = ascendenciaInicial((state.familia.pessoas.find((p) => p.tipo !== 'crianca') || {}).id || '');
  return state.ascendencia;
}

function analisarAscendencia(asc) {
  asc = asc || ascState();
  const titular = state.familia.pessoas.find((p) => p.id === asc.titular) || state.familia.pessoas[0] || { nome: 'Titular' };
  const linha = asc.linha.filter((x) => x.portugues === 'sim');
  const conhecidos = linha.filter((x) => num(x.geracao) >= 1);
  const out = { titular: titular.nome, geracao: null, tipo: 'nenhum', status: 'nao', passos: [], alertas: [], certidoes: [] };
  if (!conhecidos.length) {
    out.tipo = linha.length ? 'sem_geracao' : 'nenhum';
    if (linha.length) out.alertas.push('Diga em que geração está o antepassado português (avô, bisavô...) para calcular o caminho.');
    return out;
  }
  const g = Math.min(...conhecidos.map((x) => num(x.geracao)));
  const pt = conhecidos.find((x) => num(x.geracao) === g);
  const nomeG = (n) => { const p = asc.linha.find((x) => num(x.geracao) === n && x.portugues !== 'sim') || asc.linha.find((x) => num(x.geracao) === n); return p && p.nome ? p.nome : GERACOES[n].toLowerCase(); };
  const vivo = (n) => { const ps = asc.linha.filter((x) => num(x.geracao) === n && x.portugues !== 'sim'); if (!ps.length) return '?'; if (ps.some((x) => x.vivo === 'sim')) return 'sim'; if (ps.every((x) => x.vivo === 'nao')) return 'nao'; return '?'; };
  out.geracao = g;
  const ptNome = pt.nome || 'o antepassado português';

  // certidões da linha
  out.certidoes.push(`Assento de batismo ou nascimento de ${ptNome}${pt.local ? ` (${pt.local})` : ''}: antes de 1911 está nos livros paroquiais do Arquivo Distrital; depois, na Conservatória do Registo Civil`);
  for (let n = g - 1; n >= 1; n--) out.certidoes.push(`Certidão de nascimento em inteiro teor de ${nomeG(n)}, apostilada`);
  out.certidoes.push(`Certidão de nascimento em inteiro teor de ${titular.nome}, apostilada`);
  out.certidoes.push('Certidões de casamento da linha quando houver mudança de sobrenome, apostiladas');
  if (g >= 2) out.certidoes.push(`Antecedentes criminais de ${titular.nome} (Polícia Federal), apostilados`);

  const lei = 'Lei da Nacionalidade com a redação da Lei Orgânica 1/2026';
  if (g === 1) {
    out.tipo = 'filho'; out.status = 'neto';
    out.passos.push({ quem: titular.nome, como: 'Filho de português: pede a atribuição da nacionalidade (art. 1.º, n.º 1, c) com o registo de nascimento', tempo: 'costuma levar de 1 a 2 anos' });
  } else if (g === 2) {
    out.tipo = 'neto'; out.status = 'neto';
    out.passos.push({ quem: titular.nome, como: 'Neto de português: pede a atribuição (art. 1.º, n.º 1, d). Precisa mostrar laços efetivos: a língua é presumida para brasileiros; conhecimento de cultura e de direitos e deveres será avaliado como diz a regulamentação', tempo: 'costuma levar mais de 1 ano' });
    out.alertas.push('A regulamentação do teste de cultura e direitos estava pendente em setembro de 2026; confirme no IRN antes de pedir.');
  } else {
    out.tipo = 'bisneto_ou_mais'; out.status = g === 3 ? 'bisneto' : 'nao';
    // caminho em cadeia: começa no filho (g-1) ou no neto (g-2) que estiver vivo
    let inicio = null;
    if (vivo(g - 1) === 'sim') inicio = { n: g - 1, como: 'filho' };
    else if (g - 2 >= 1 && vivo(g - 2) === 'sim') inicio = { n: g - 2, como: 'neto' };
    else if (vivo(g - 1) === '?' || (g - 2 >= 1 && vivo(g - 2) === '?')) out.alertas.push(`Marque se ${nomeG(g - 1)}${g - 2 >= 1 ? ` e ${nomeG(g - 2)}` : ''} estão vivos: a nacionalidade em cadeia começa por quem está vivo mais perto do português.`);
    if (inicio) {
      let ok = true;
      for (let n = inicio.n - 1; n >= 1; n--) if (vivo(n) === 'nao') { ok = false; out.alertas.push(`A cadeia para em ${nomeG(n)}, que já faleceu; ${titular.nome} não herda a nacionalidade por essa linha.`); break; } else if (vivo(n) === '?') out.alertas.push(`Confirme se ${nomeG(n)} está vivo: cada pessoa da cadeia precisa fazer o próprio pedido.`);
      if (ok) {
        out.tipo = 'cadeia'; out.status = 'neto';
        out.passos.push({ quem: nomeG(inicio.n), como: inicio.como === 'filho' ? `Filho de ${ptNome}: pede a atribuição (art. 1.º, n.º 1, c)` : `Neto de ${ptNome}: pede a atribuição (art. 1.º, n.º 1, d), com os laços efetivos`, tempo: '1 a 2 anos' });
        for (let n = inicio.n - 1; n >= 1; n--) out.passos.push({ quem: nomeG(n), como: `Filho de português (agora que ${nomeG(n + 1)} é português): art. 1.º, n.º 1, c`, tempo: '1 a 2 anos' });
        out.passos.push({ quem: titular.nome, como: `Filho de português (depois de ${nomeG(1)}): art. 1.º, n.º 1, c`, tempo: '1 a 2 anos' });
        out.alertas.push('Cada etapa só começa quando a anterior estiver registrada. Um advogado de nacionalidade pode dizer se dá para adiantar documentos em paralelo.');
      }
    }
    if (g === 3) out.passos.push({ quem: titular.nome, como: `Alternativa sem cadeia: como bisneto, pedir a naturalização depois de ${num(state.config.anosBisneto) || 5} anos de residência legal em Portugal (art. 6.º, n.º 8), a critério do Governo`, tempo: `${num(state.config.anosBisneto) || 5} anos morando em Portugal` });
    if (g >= 4 && out.tipo !== 'cadeia') out.alertas.push('Para trisnetos não há caminho direto; só a cadeia por parentes vivos ou a naturalização comum por tempo de residência.');
  }
  out.lei = lei;
  return out;
}

function renderAscendencia() {
  const asc = ascState();
  const adultos = Object.fromEntries(state.familia.pessoas.filter((p) => p.tipo !== 'crianca').map((p) => [p.id, p.nome || 'Adulto']));
  $('#ascTitular').innerHTML = sel('titular', asc.titular, adultos);
  const ord = asc.linha.slice().sort((x, y) => (num(x.geracao) || 99) - (num(y.geracao) || 99));
  $('#tblAsc').innerHTML = `<thead><tr><th>Geração</th><th>Nome</th><th>Onde e quando nasceu ou foi batizado</th><th>Português de origem</th><th>Vivo</th><th>Certidão</th><th></th></tr></thead><tbody>${
    ord.map((x) => `<tr data-id="${x.id}" class="${x.portugues === 'sim' ? 'pt' : ''}">
      <td>${sel('geracao', x.geracao ?? '', GERACOES)}</td>
      <td>${inp('nome', x.nome, { type: 'text', placeholder: 'Nome completo' })}</td>
      <td>${inp('local', x.local, { type: 'text', placeholder: 'Freguesia, concelho' })}${inp('data', x.data, { type: 'text', placeholder: 'Data ou ano', cls: 'sub' })}</td>
      <td>${sel('portugues', x.portugues, SIM_NAO)}</td>
      <td>${sel('vivo', x.vivo, SIM_NAO)}</td>
      <td>${sel('certidao', x.certidao, CERT_ST)}</td>
      <td class="c-del">${delBtn}</td></tr>`).join('')
  }</tbody>`;
  renderAscResultado();
}
function renderAscResultado() {
  const a = analisarAscendencia();
  const cor = { filho: 'ok', neto: 'ok', cadeia: 'ok', bisneto_ou_mais: 'warn', sem_geracao: 'info', nenhum: 'info' }[a.tipo];
  const titulo = { filho: 'Filho de português: atribuição direta', neto: 'Neto de português: atribuição direta', cadeia: 'Nacionalidade em cadeia', bisneto_ou_mais: a.geracao === 3 ? 'Bisneto: naturalização após residência' : 'Sem caminho direto', sem_geracao: 'Falta saber a geração', nenhum: 'Marque o antepassado português' }[a.tipo];
  $('#ascResultado').innerHTML = `<div class="asc-res ${cor}"><b>${titulo}</b>
    ${a.passos.length ? `<ol class="asc-passos">${a.passos.map((p) => `<li><b>${esc(p.quem)}</b><span>${esc(p.como)}</span><small>${esc(p.tempo)}</small></li>`).join('')}</ol>` : ''}
    ${a.alertas.map((t) => `<p class="small">${esc(t)}</p>`).join('')}</div>`;
  $('#ascLinks').innerHTML = LINKS_ASC.map(([n, u, d]) => `<li><a href="${u}" target="_blank">${esc(n)}</a><small>${esc(d)}</small></li>`).join('');
  return a;
}

// mantém a avaliação dos vistos em sincronia com a árvore
function sincronizarAscendencia() {
  const asc = ascState();
  const a = analisarAscendencia(asc);
  if (a.geracao) {
    state.vistos = state.vistos || { escolhido: '', ascendencia: {} };
    state.vistos.ascendencia = { ...(state.vistos.ascendencia || {}), [asc.titular]: a.status === 'neto' ? 'neto' : a.status === 'bisneto' ? 'bisneto' : 'nao' };
  }
  return a;
}

(function bindAscendencia() {
  ascState();
  sincronizarAscendencia();
  const getL = () => ascState().linha;
  bindLista('#tblAsc', getL, { reconstruir: ['geracao', 'portugues', 'vivo'], nomeItem: 'pessoa', onChange: () => sincronizarAscendencia(), onDelete: () => sincronizarAscendencia() });
  $('#ascTitular').addEventListener('change', (e) => { ascState().titular = e.target.value; sincronizarAscendencia(); save(); construirVista(); refresh(); });
  $('#ascAdd').addEventListener('click', () => {
    const l = getL();
    const usadas = l.map((x) => num(x.geracao)).filter(Boolean);
    let prox = 1;
    while (usadas.includes(prox)) prox++;
    l.push({ id: nid('a'), geracao: prox <= 5 ? prox : null, nome: '', local: '', data: '', portugues: 'nao', vivo: '?', certidao: 'procurar', nota: '' });
    save(); construirVista(); refresh();
  });
  $('#ascDocs').addEventListener('click', () => {
    const a = analisarAscendencia();
    let n = 0;
    for (const c of a.certidoes) {
      const titulo = c.split(':')[0];
      if (state.tarefas.some((t) => t.titulo === titulo)) continue;
      state.tarefas.push({ id: nid('t'), grupo: 'Documentos', titulo, quando: -12, status: 'pendente', nota: c });
      n++;
    }
    save(); refresh();
    toast(n ? `${n} certidões adicionadas ao checklist, 12 meses antes da mudança` : 'Essas certidões já estão no checklist');
  });
  $('#ascVasco').addEventListener('click', () => {
    if (typeof iaPerguntar === 'function') iaPerguntar('Me ajude com a nacionalidade pela ascendência: leia a seção ascendencia, explique o caminho que a árvore indica, o que falta descobrir e como achar o registo de batismo no arquivo distrital. Pesquise se a regulamentação da nova lei já saiu.');
  });
})();
