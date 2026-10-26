'use strict';

/* =========================================================
   Aluguéis oficiais do INE na aba Cidades.
   Indicador 0009631: renda mediana por m² dos novos contratos
   de arrendamento, por concelho (Estatísticas de Rendas da
   Habitação ao nível local). A resposta é lida de forma tolerante:
   procura o concelho pelo código (DICO) no fim do geocod e, se
   não achar, pelo nome.
   ========================================================= */

const INE_INDICADORES = ['0009631'];
// código de concelho (distrito + concelho) de cada cidade embutida
const INE_DICO = { lisboa: '1106', porto: '1312', setubal: '1512', braga: '0303', guimaraes: '0308', aveiro: '0105', coimbra: '0603', viseu: '1823', leiria: '1009', castelobranco: '0502', evora: '0705', faro: '0805', funchal: '3103' };
// área típica de um contrato novo por tipologia, para passar de €/m² para renda mensal
const INE_AREA = { t1: 55, t2: 80, t3: 105 };

const semAcento = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const numINE = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

function lerRespostaINE(j) {
  const ind = Array.isArray(j) ? j[0] : j;
  if (!ind || !ind.Dados || typeof ind.Dados !== 'object') return null;
  const periodos = Object.keys(ind.Dados);
  if (!periodos.length) return null;
  const ordem = (p) => { const a = /(\d{4})/.exec(p); const t = /(\d)\.?º?\s*trimestre/i.exec(p); return (a ? +a[1] : 0) * 10 + (t ? +t[1] : 5); };
  const periodo = periodos.sort((a, b) => ordem(b) - ordem(a))[0];
  const linhas = (ind.Dados[periodo] || []).filter((x) => x && numINE(x.valor) !== null);
  // quando houver outra dimensão (ex.: tipo de alojamento), fica com o total
  const total = linhas.filter((x) => !x.dim_3 || /^(T|total)$/i.test(String(x.dim_3)) || /total/i.test(String(x.dim_3_t || '')));
  const usar = total.length ? total : linhas;
  const out = {};
  for (const c of CIDADES_BASE) {
    const dico = INE_DICO[c.id];
    let l = dico && usar.find((x) => String(x.geocod || '').length >= 6 && String(x.geocod).endsWith(dico));
    if (!l) l = usar.filter((x) => semAcento(x.geodsg) === semAcento(c.nome)).sort((a, b) => String(b.geocod || '').length - String(a.geocod || '').length)[0];
    if (l) out[c.id] = { m2: numINE(l.valor), geocod: l.geocod, nome: l.geodsg };
  }
  const pt = usar.find((x) => String(x.geocod) === 'PT' || semAcento(x.geodsg) === 'portugal');
  return { periodo, indicador: ind.IndicadorCod || '', descricao: ind.IndicadorDsg || '', atualizado: ind.DataUltimoAtualizacao || '', cidades: out, portugal: pt ? numINE(pt.valor) : null };
}

async function buscarAluguelINE() {
  const btn = $('#ineBuscar');
  if (btn) { btn.disabled = true; btn.textContent = 'Buscando no INE…'; }
  let res = null, erro = '';
  for (const varcd of INE_INDICADORES) {
    const r = await api('ine_rendas', { varcd });
    if (r && r.ok) { res = lerRespostaINE(r.data); if (res && Object.keys(res.cidades).length) break; erro = 'resposta sem os concelhos'; }
    else erro = (r && (r.status ? `HTTP ${r.status}` : r.error)) || 'sem resposta';
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Buscar no INE'; }
  if (!res || !Object.keys(res.cidades).length) { toast(`O INE não respondeu agora (${erro}). Tente de novo ou peça ao Vasco.`); return null; }
  state.ine = { ...res, buscadoEm: Date.now() };
  save(); refresh();
  toast(`Aluguéis do INE de ${res.periodo} carregados`);
  return res;
}

function estimativaINE(id) {
  const d = state.ine && state.ine.cidades && state.ine.cidades[id];
  if (!d || !d.m2) return null;
  return { m2: d.m2, t1: Math.round(d.m2 * INE_AREA.t1), t2: Math.round(d.m2 * INE_AREA.t2), t3: Math.round(d.m2 * INE_AREA.t3) };
}

function renderINE() {
  if (!$('#tblINE')) return;
  const ine = state.ine;
  const anoAtual = new Date().getFullYear();
  const antigo = ine && /(\d{4})/.test(ine.periodo) && +/(\d{4})/.exec(ine.periodo)[1] < anoAtual - 1;
  $('#ineNota').textContent = ine ? `INE, ${ine.periodo}${ine.portugal ? `; Portugal: € ${nf(2).format(ine.portugal)}/m²` : ''}; buscado em ${new Date(ine.buscadoEm).toLocaleDateString('pt-BR')}` : 'ainda não buscado';
  $('#ineAviso').hidden = !antigo;
  if (antigo) $('#ineAviso').textContent = `Esses dados são de ${/(\d{4})/.exec(ine.periodo)[1]} e ficam bem abaixo dos anúncios de hoje (os aluguéis subiram e a mediana inclui contratos de casas menores e mais antigas). Use como referência; para números atuais, peça ao Vasco a série trimestral de 2026.`;
  const cs = todasCidades(state);
  $('#tblINE').innerHTML = `<thead><tr><th>Cidade</th><th class="num">€/m² (INE)</th><th class="num">T1 pelo INE</th><th class="num">T2 pelo INE</th><th class="num">T3 pelo INE</th><th class="num">T1 no app</th><th class="num" title="Quanto o INE fica acima ou abaixo do valor usado no app">INE × app</th></tr></thead><tbody>${
    cs.map((c) => {
      const e = estimativaINE(c.id);
      const dif = e && num(c.t1) ? e.t1 / num(c.t1) - 1 : null;
      return `<tr class="${c.id === state.cidade ? 'best' : ''}"><td>${esc(c.nome)}</td><td class="num">${e ? nf(2).format(e.m2) : '—'}</td><td class="num">${e ? eur(e.t1) : '—'}</td><td class="num">${e ? eur(e.t2) : '—'}</td><td class="num">${e ? eur(e.t3) : '—'}</td><td class="num">${eur(num(c.t1))}</td><td class="num">${dif === null ? '—' : `${dif >= 0 ? '+' : ''}${nf(0).format(dif * 100)}%`}</td></tr>`;
    }).join('')
  }</tbody>`;
  $('#ineUsar').disabled = !ine;
  $('#ineUsar').textContent = antigo ? 'Usar mesmo assim' : 'Usar estes aluguéis';
  $('#ineUsar').className = antigo ? 'ghost' : 'primary';
}

(function bindINE() {
  if (!$('#ineBuscar')) return;
  const orig = V.cidades.update;
  V.cidades.update = function (all) { orig.call(this, all); renderINE(); };
  $('#ineBuscar').addEventListener('click', buscarAluguelINE);
  $('#ineUsar').addEventListener('click', async () => {
    const ids = Object.keys((state.ine || {}).cidades || {}).filter((id) => estimativaINE(id));
    if (!ids.length) return;
    const ano = +(/(\d{4})/.exec(state.ine.periodo) || [0, 0])[1];
    const aviso = ano && ano < new Date().getFullYear() - 1 ? ` Atenção: são dados de ${ano}. Os aluguéis subiram desde então, e a mediana de todos os contratos fica bem abaixo dos anúncios atuais; usar esses valores tende a deixar o plano otimista demais.` : '';
    if (!(await confirmar(`Trocar os aluguéis T1, T2 e T3 de ${ids.length} cidades pelos valores estimados com o INE (${state.ine.periodo})?${aviso} Dá para voltar com "Restaurar valores originais".`, 'Usar valores do INE'))) return;
    const antes = calcAll()[state.cenarioAtivo].sobra;
    for (const id of ids) { const e = estimativaINE(id); state.cidadesEdit[id] = { ...(state.cidadesEdit[id] || {}), t1: e.t1, t2: e.t2, t3: e.t3, fonte: `INE ${state.ine.periodo}, €${nf(2).format(e.m2)}/m²` }; }
    if (typeof registrarDecisao === 'function') registrarDecisao(`Aluguéis das cidades atualizados com o INE (${state.ine.periodo})`, { origem: 'INE', antes, depois: calcAll()[state.cenarioAtivo].sobra });
    save(); V.cidades.build(); refresh();
    toast('Aluguéis atualizados com o INE');
  });
  $('#ineVasco').addEventListener('click', () => {
    if (typeof iaPerguntar === 'function') iaPerguntar(`Pesquise a renda mediana por m² dos novos contratos de arrendamento do INE mais recente (trimestral, 2026) para os concelhos ${todasCidades(state).map((c) => c.nome).join(', ')}. Multiplique por ${INE_AREA.t1} m² (T1), ${INE_AREA.t2} m² (T2) e ${INE_AREA.t3} m² (T3) e proponha as alterações em cidadesEdit.<id>.t1/t2/t3, com a fonte e o trimestre.`);
  });
})();
