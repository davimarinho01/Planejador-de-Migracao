'use strict';

/* =========================================================
   Dados embutidos: cidades, tabelas de IRS, valores iniciais
   e migração de versões antigas.
   ========================================================= */

const STORE_KEY = 'planejador-viseu-v1'; // mesma chave da v1: a migração acontece no load
const THEME_KEY = 'planejador-viseu-tema';
const VERSAO = 2;
const SC = ['base', 'conservador', 'estresse'];
const SC_LABEL = { base: 'Base', conservador: 'Conservador', estresse: 'Estresse' };
const CATS = ['Moradia', 'Contas', 'Alimentação', 'Educação', 'Transporte', 'Saúde', 'Lazer', 'Outros'];
const TIPOS = { trabalho: 'Trabalho no Brasil', trabalho_pt: 'Trabalho em Portugal', passiva: 'Aluguel recebido', beneficio: 'Benefício', outra: 'Outra' };
const IDX = { cdi: 'CDI', fii: 'FII', fixa: 'Taxa fixa' };
const AUTO = {
  '': 'Valor manual', aluguel: 'Cidade: aluguel', contas: 'Cidade: contas', mercado: 'Cidade: mercado',
  transporte: 'Cidade: transporte', telemovel: 'Família: telemóvel', seguro: 'Família: seguro de saúde', escola: 'Família: escola',
};

let uid = 0;
const nid = (p) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

/* ---------- cidades (valores de referência, € por mês) ----------
   Aluguel sem mobília. Fontes: re-locant (base Idealista, out/2026) para Lisboa, Porto, Braga,
   Coimbra, Aveiro, Faro e Funchal; Brasileiro em Portugal (mar/2026) para Setúbal; para as demais,
   estimativa a partir do €/m² do distrito (Doutor Finanças, set/2026) e de anúncios. */
const CIDADES_BASE = [
  { id: 'lisboa', nome: 'Lisboa', t1: 1320, t2: 1780, t3: 2340, passe: 40, alim: 1.10, contas: 0.95, fonte: 'Idealista via re-locant, out/2026; passe Navegante Metropolitano' },
  { id: 'porto', nome: 'Porto', t1: 1110, t2: 1480, t3: 1960, passe: 40, alim: 1.05, contas: 1.0, fonte: 'Idealista via re-locant, out/2026; passe Andante Metropolitano' },
  { id: 'setubal', nome: 'Setúbal', t1: 800, t2: 1025, t3: 1225, passe: 40, alim: 1.03, contas: 0.95, fonte: 'Faixas de mar/2026 (Brasileiro em Portugal)' },
  { id: 'braga', nome: 'Braga', t1: 690, t2: 890, t3: 1130, passe: 35, alim: 1.0, contas: 1.0, fonte: 'Idealista via re-locant, out/2026' },
  { id: 'guimaraes', nome: 'Guimarães', t1: 655, t2: 845, t3: 1075, passe: 30, alim: 1.0, contas: 1.0, fonte: 'Estimativa: distrito de Braga' },
  { id: 'aveiro', nome: 'Aveiro', t1: 760, t2: 990, t3: 1260, passe: 30, alim: 1.0, contas: 1.0, fonte: 'Idealista via re-locant, out/2026' },
  { id: 'coimbra', nome: 'Coimbra', t1: 750, t2: 960, t3: 1230, passe: 30, alim: 1.0, contas: 1.0, fonte: 'Idealista via re-locant, out/2026' },
  { id: 'viseu', nome: 'Viseu', t1: 700, t2: 900, t3: 1150, passe: 0, alim: 0.97, contas: 1.05, fonte: 'T1 no centro entre € 550 e € 790 (Ricavida, 2026); transporte gratuito para residentes' },
  { id: 'leiria', nome: 'Leiria', t1: 725, t2: 935, t3: 1190, passe: 30, alim: 1.0, contas: 1.0, fonte: 'Estimativa: €/m² do distrito' },
  { id: 'castelobranco', nome: 'Castelo Branco', t1: 560, t2: 720, t3: 920, passe: 25, alim: 0.96, contas: 1.05, fonte: 'T1 entre € 500 e € 550 (Clube do Passaporte, 2026)' },
  { id: 'evora', nome: 'Évora', t1: 800, t2: 1030, t3: 1310, passe: 30, alim: 1.0, contas: 1.05, fonte: 'Estimativa: €/m² do distrito' },
  { id: 'faro', nome: 'Faro', t1: 790, t2: 1050, t3: 1400, passe: 30, alim: 1.05, contas: 0.95, fonte: 'Idealista via re-locant, out/2026' },
  { id: 'funchal', nome: 'Funchal', t1: 1070, t2: 1430, t3: 1880, passe: 35, alim: 1.08, contas: 0.9, fonte: 'Idealista via re-locant, out/2026' },
];
// valores-base do custo de vida (cidade com índice 1,0)
const CUSTO = {
  contasT1: 200,        // luz, água, gás e internet de um T1
  contasPorPessoaExtra: 15,
  contasT2: 20, contasT3: 40,
  mercadoAdulto: 185,   // casal ≈ € 370; criança = 60% de um adulto
  mercadoCrianca: 0.6,
  telemovel: 10,        // por adulto ou criança a partir de 12 anos
  seguroPessoa: 30,     // seguro de saúde privado por pessoa
  escolaCrianca: 60,    // refeições, material e atividades (ensino público é gratuito)
};

/* ---------- IRS (Portugal continental) ---------- */
const IRS = {
  // limite superior do escalão e taxa marginal
  2026: { escaloes: [[8342, .125], [12587, .157], [17838, .212], [23089, .241], [29397, .311], [43090, .349], [46566, .431], [86634, .446], [Infinity, .48]], minimo: 12880, solid: 80000 },
  2027: { escaloes: [[8666, .122], [13075, .152], [18530, .207], [23985, .236], [30538, .306], [44762, .346], [48373, .431], [89995, .446], [Infinity, .48]], minimo: 13580, solid: 89995 },
  ias: 537.13,
  dedEspFator: 8.54,      // dedução específica da categoria A = 8,54 × IAS
  despGerais: 250,        // por adulto (35% das despesas gerais, até € 250)
  dependente: 600, menor3: 126, segundoAte6: 300,
  ss: 0.11,               // Segurança Social do trabalhador
  ifici: 0.20,            // IFICI: taxa especial sobre o trabalho elegível (art. 58.º-A do EBF)
  autonomoAluguel: 0.25,  // taxa autónoma, arrendamento habitacional
  autonomoCapitais: 0.28, // juros e rendimentos de fundos
  jovem: [0, 1, .75, .75, .75, .5, .5, .5, .25, .25, .25], // por ano do regime
  jovemTeto: 55,          // × IAS
};
const irsAno = (ano) => (ano >= 2027 ? IRS[2027] : IRS[2026]);

/* ---------- checklist padrão (quando = meses em relação à mudança) ---------- */
const TAREFAS_BASE = [
  ['Visto', 'Decidir o tipo de visto (D7, D4 estudante, D8 ou D1 trabalho)', -9],
  ['Visto', 'Consulta com advogado de imigração', -9],
  ['Documentos', 'Certidões de nascimento e casamento em inteiro teor', -7],
  ['Documentos', 'Antecedentes criminais da Polícia Federal', -4],
  ['Documentos', 'Apostilar certidões e antecedentes', -4],
  ['Documentos', 'NIF português (com representante fiscal)', -6],
  ['Documentos', 'Abrir conta bancária em Portugal', -5],
  ['Visto', 'Seguro de saúde/viagem válido para o visto', -4],
  ['Visto', 'Comprovar meios: extratos e declarações de renda', -4],
  ['Visto', 'Comprovar alojamento (contrato ou termo de responsabilidade)', -4],
  ['Visto', 'Agendar na VFS e entregar o pedido de visto', -3],
  ['Mudança', 'Comprar passagens', -2],
  ['Mudança', 'Comunicação de Saída Definitiva à Receita Federal', -1],
  ['Mudança', 'Avisar bancos e fontes pagadoras (condição de não residente)', -1],
  ['Mudança', 'Reservar hospedagem dos primeiros 30 dias', -1],
  ['Chegada', 'Comparecer à AIMA para a autorização de residência', 0],
  ['Chegada', 'Atestado de residência na Junta de Freguesia', 0],
  ['Chegada', 'Número de utente do SNS (centro de saúde)', 1],
  ['Chegada', 'NISS na Segurança Social', 1],
  ['Chegada', 'Contratar luz, água, gás e internet', 1],
  ['Chegada', 'Trocar a CNH pela carta de condução portuguesa', 6],
  ['Depois', 'Declaração de Saída Definitiva (março a maio do ano seguinte)', 10],
  ['Depois', 'Primeiro IRS em Portugal com anexo J', 12],
];

/* ---------- valores iniciais (análise de out/2026) ---------- */
function seed() {
  const ana = nid('p'), bruno = nid('p'), salAna = nid('r');
  return {
    versao: VERSAO,
    cenarioAtivo: 'base',
    cidade: 'viseu',
    cidadesEdit: {},
    cidadesExtras: [],
    custosDosInvest: true,
    familia: {
      pessoas: [
        { id: ana, nome: 'Ana', tipo: 'adulto', idade: null, irsJovemAno: 0 },
        { id: bruno, nome: 'Bruno', tipo: 'adulto', idade: null, irsJovemAno: 0 },
      ],
      tipologia: 'auto',
      casados: true,
      tributacao: 'melhor',
    },
    impostos: { regime: 'melhor' },
    plano: { dataMudanca: '2028-04', capitalBase: 'mudanca', aporteMensal: 0, mesReferencia: 3, horizonte: 36, irsEmAgosto: true },
    metas: { poupanca: 400, salarioMinimo: 970 },
    cenarios: {
      base:        { cambio: 5.95, iof: 0.035, tarifa: 0.0085, cdi: 0.0095, fii: 0.010,  contarIncertas: true,  varTrabalho: 0,     ajusteDesp: 0,    mesesAluguel: 6 },
      conservador: { cambio: 6.30, iof: 0.035, tarifa: 0.0085, cdi: 0.0085, fii: 0.0085, contarIncertas: false, varTrabalho: 0,     ajusteDesp: 0.03, mesesAluguel: 6 },
      estresse:    { cambio: 6.80, iof: 0.035, tarifa: 0.0085, cdi: 0.0080, fii: 0.0075, contarIncertas: false, varTrabalho: -0.12, ajusteDesp: 0.05, mesesAluguel: 12 },
    },
    rendas: [
      { id: salAna, ativo: true, nome: 'Salário Ana', tipo: 'trabalho', pessoa: ana, moeda: 'BRL', valor: 5000, impostoBR: 0.25, clt: false, pagamentos: 12, inicio: null, fim: null, substitui: '', status: 'confirmada', nota: 'Bruto; 25% de IR de não residente. Ligue CLT se receber 13º e férias' },
      { id: nid('r'), ativo: true, nome: 'Salário Bruno', tipo: 'trabalho', pessoa: bruno, moeda: 'BRL', valor: 4000, impostoBR: 0, clt: false, pagamentos: 12, inicio: null, fim: null, substitui: '', status: 'confirmada', nota: 'Líquido informado; confirmar se já tem os 25%' },
      { id: nid('r'), ativo: true, nome: 'Aluguel de imóvel no Brasil', tipo: 'passiva', pessoa: '', moeda: 'BRL', valor: 2000, impostoBR: 0.15, clt: false, pagamentos: 12, inicio: null, fim: null, substitui: '', status: 'confirmada', nota: 'Bruto; 15% no Brasil, complemento calculado em Portugal' },
      { id: nid('r'), ativo: true, nome: 'Vale-refeição', tipo: 'beneficio', pessoa: ana, moeda: 'BRL', valor: 800, impostoBR: 0, clt: false, pagamentos: 12, inicio: null, fim: null, substitui: '', status: 'a confirmar', nota: 'Confirmar se funciona fora do Brasil' },
      { id: nid('r'), ativo: false, nome: 'Emprego em Portugal (exemplo)', tipo: 'trabalho_pt', pessoa: ana, moeda: 'EUR', valor: 1600, impostoBR: 0, clt: false, pagamentos: 14, inicio: 6, fim: null, substitui: salAna, status: 'a confirmar', nota: 'Bruto mensal em 14 pagamentos; substitui o salário do Brasil' },
    ],
    investimentos: [
      { id: nid('i'), nome: 'CDB 100% CDI', capital: 150000, idx: 'cdi', param: 1, impostoBR: 0.15, irResidente: 0.175, nota: '' },
      { id: nid('i'), nome: 'Fundos imobiliários', capital: 60000, idx: 'fii', param: 0, impostoBR: 0, irResidente: 0, nota: '' },
    ],
    despesas: [
      { id: nid('d'), ativo: true, nome: 'Aluguel', cat: 'Moradia', moeda: 'EUR', valor: 700, auto: 'aluguel', nota: '' },
      { id: nid('d'), ativo: true, nome: 'Luz, água, gás e internet', cat: 'Contas', moeda: 'EUR', valor: 200, auto: 'contas', nota: '' },
      { id: nid('d'), ativo: true, nome: 'Telemóvel', cat: 'Contas', moeda: 'EUR', valor: 20, auto: 'telemovel', nota: '' },
      { id: nid('d'), ativo: true, nome: 'Mercado', cat: 'Alimentação', moeda: 'EUR', valor: 350, auto: 'mercado', nota: '' },
      { id: nid('d'), ativo: true, nome: 'Propina do ensino superior', cat: 'Educação', moeda: 'EUR', valor: 150, auto: '', nota: '€ 1.500–1.600 por ano' },
      { id: nid('d'), ativo: true, nome: 'Escola e atividades das crianças', cat: 'Educação', moeda: 'EUR', valor: 0, auto: 'escola', nota: 'Ensino público é gratuito' },
      { id: nid('d'), ativo: true, nome: 'Transporte público', cat: 'Transporte', moeda: 'EUR', valor: 20, auto: 'transporte', nota: '' },
      { id: nid('d'), ativo: true, nome: 'Academia', cat: 'Saúde', moeda: 'EUR', valor: 40, auto: '', nota: '' },
      { id: nid('d'), ativo: true, nome: 'Seguro de saúde', cat: 'Saúde', moeda: 'EUR', valor: 60, auto: 'seguro', nota: '' },
      { id: nid('d'), ativo: true, nome: 'Farmácia, higiene e roupas', cat: 'Outros', moeda: 'EUR', valor: 80, auto: '', nota: '' },
      { id: nid('d'), ativo: true, nome: 'Contabilista (IRS)', cat: 'Outros', moeda: 'EUR', valor: 15, auto: '', nota: 'Anexo J todo ano' },
      { id: nid('d'), ativo: true, nome: 'Imprevistos e manutenção', cat: 'Outros', moeda: 'EUR', valor: 50, auto: '', nota: '' },
    ],
    entrada: [
      { id: nid('e'), nome: 'Móveis e eletrodomésticos', moeda: 'EUR', valor: 3200, porPessoa: false, nota: '' },
      { id: nid('e'), nome: 'Visto consular', moeda: 'BRL', valor: 843.61, porPessoa: true, nota: 'VFS, mar/2026' },
      { id: nid('e'), nome: 'Apostilas, certidões e traduções', moeda: 'BRL', valor: 600, porPessoa: true, nota: 'Estimativa' },
      { id: nid('e'), nome: 'Seguro exigido no visto', moeda: 'BRL', valor: 1000, porPessoa: true, nota: 'Estimativa' },
      { id: nid('e'), nome: 'Taxas da AIMA', moeda: 'EUR', valor: 200, porPessoa: true, nota: 'Estimativa' },
      { id: nid('e'), nome: 'NIF, conta e chips', moeda: 'EUR', valor: 150, porPessoa: false, nota: '' },
      { id: nid('e'), nome: 'Passagem só de ida', moeda: 'BRL', valor: 3500, porPessoa: true, nota: 'Estimativa' },
      { id: nid('e'), nome: 'Hospedagem até achar casa', moeda: 'EUR', valor: 1200, porPessoa: false, nota: '~30 dias' },
      { id: nid('e'), nome: 'Lisboa → cidade e bagagem extra', moeda: 'EUR', valor: 75, porPessoa: true, nota: '' },
    ],
    eventos: [
      { id: nid('v'), ativo: true, nome: 'Primeiras compras da casa', tipo: 'saida', moeda: 'EUR', valor: 400, porPessoa: false, quando: 0, repetir: 'nao', mesAno: 1, nota: '' },
      { id: nid('v'), ativo: true, nome: 'Viagem ao Brasil (passagens)', tipo: 'saida', moeda: 'EUR', valor: 800, porPessoa: true, quando: 6, repetir: 'anual', mesAno: 12, nota: 'A partir do 6º mês, todo dezembro' },
      { id: nid('v'), ativo: true, nome: 'Aquecimento extra no inverno', tipo: 'saida', moeda: 'EUR', valor: 150, porPessoa: false, quando: 0, repetir: 'anual', mesAno: 1, nota: '' },
      { id: nid('v'), ativo: true, nome: 'Renovação da autorização de residência', tipo: 'saida', moeda: 'EUR', valor: 100, porPessoa: true, quando: 24, repetir: 'nao', mesAno: 1, nota: 'Estimativa' },
    ],
    tarefas: TAREFAS_BASE.map(([grupo, titulo, quando]) => ({ id: nid('t'), grupo, titulo, quando, status: 'pendente', nota: '' })),
    realizado: {},
    comprasEuro: [],
    mercado: {},
    config: { autoMercado: true, brapiToken: '', tickers: ['MXRF11', 'HGLG11'], alertaEuro: 0, backupAuto: false, travelpayoutsToken: '', serpapiKey: '', ignavKey: '', autoVoos: true, iaModelo: '', iaModelosEm: 0, iaVisao: '', iaVoz: '',
      resumoFreq: 'semanal', regrasAuto: true, metaEuros: null,
      taxaConsular: 110, anosNacionalidade: 7, anosBisneto: 5, limiarCartaoAzul: 21030 },
    vistos: { escolhido: '', ascendencia: {} },
    ascendencia: ascendenciaInicial(ana),
    vagas: [],
    decisoes: [],
  };
}

/* ---------- árvore de ascendência (ponto de partida) ---------- */
function ascendenciaInicial(titular) {
  return {
    titular,
    linha: [
      { id: nid('a'), geracao: null, nome: '', local: '', data: '', portugues: 'sim', vivo: '?', certidao: 'procurar', nota: 'Antepassado português: preencha geração, nome e freguesia' },
    ],
  };
}

/* ---------- migração e normalização ---------- */
function migrarV1(d) {
  const s = seed();
  const out = { ...d };
  // família a partir do antigo "adultos"
  const nAd = Math.max(1, Math.round(+((d.metas || {}).adultos) || 2));
  out.familia = s.familia;
  if (nAd !== 2) {
    out.familia = { ...s.familia, pessoas: Array.from({ length: nAd }, (_, i) => ({ id: nid('p'), nome: i === 0 ? 'Ana' : i === 1 ? 'Bruno' : `Adulto ${i + 1}`, tipo: 'adulto', idade: null, irsJovemAno: 0 })) };
  }
  const pes = out.familia.pessoas;
  const quem = (nome) => (pes.find((p) => new RegExp(p.nome, 'i').test(nome || '')) || pes[0]).id;
  const temClt = (d.rendas || []).some((r) => /13º/.test(r.nome) && r.ativo);
  out.rendas = (d.rendas || []).filter((r) => !/13º/.test(r.nome)).map((r) => ({
    clt: r.tipo === 'trabalho' && temClt, pagamentos: 12, inicio: null, fim: null, substitui: '',
    pessoa: r.tipo === 'passiva' ? '' : quem(r.nome),
    ...r,
    impostoBR: r.tipo === 'passiva' && Math.abs((+r.imposto || 0) - 0.25) < 1e-9 ? 0.15 : (+r.imposto || 0),
  }));
  out.investimentos = (d.investimentos || []).map((i) => ({
    ...i, impostoBR: i.idx === 'fii' ? 0 : 0.15, irResidente: i.idx === 'fii' ? 0 : 0.175,
  }));
  const autoPorNome = [[/^aluguel/i, 'aluguel', 750], [/luz|água|internet|gás/i, 'contas', 200], [/telem/i, 'telemovel', 20],
    [/^mercado/i, 'mercado', 350], [/transporte/i, 'transporte', 20], [/seguro de saúde/i, 'seguro', 60]];
  out.despesas = (d.despesas || []).map((x) => {
    const hit = autoPorNome.find(([re, , orig]) => re.test(x.nome) && +x.valor === orig);
    return { auto: hit ? hit[1] : '', ...x };
  });
  const ppOrig = [[/vistos consulares/i, 1687.22, 'Visto consular'], [/apostilas/i, 1200, null], [/seguro exigido/i, 2000, null],
    [/taxas da aima/i, 400, 'Taxas da AIMA'], [/passagens/i, 7000, 'Passagem só de ida']];
  out.entrada = (d.entrada || []).map((e) => {
    const hit = ppOrig.find(([re, v]) => re.test(e.nome) && +e.valor === v);
    return hit ? { ...e, valor: +(hit[1] / 2).toFixed(2), porPessoa: true, nome: hit[2] || e.nome } : { porPessoa: false, ...e };
  });
  out.metas = { poupanca: (d.metas || {}).poupanca ?? 400, salarioMinimo: (d.metas || {}).salarioMinimo ?? 970 };
  out.versao = VERSAO;
  return out;
}

function normalize(d) {
  const base = seed();
  if (!d || typeof d !== 'object') return base;
  if (!d.versao || d.versao < 2) d = migrarV1(d);
  const out = { ...base, ...d };
  for (const k of ['metas', 'plano', 'impostos', 'config']) out[k] = { ...base[k], ...(d[k] || {}) };
  out.familia = { ...base.familia, ...(d.familia || {}) };
  if (!Array.isArray(out.familia.pessoas) || !out.familia.pessoas.length) out.familia.pessoas = base.familia.pessoas;
  out.cenarios = {};
  for (const k of SC) out.cenarios[k] = { ...base.cenarios[k], ...((d.cenarios || {})[k] || {}) };
  for (const key of ['rendas', 'investimentos', 'despesas', 'entrada', 'eventos', 'tarefas', 'comprasEuro', 'cidadesExtras']) {
    out[key] = Array.isArray(d[key]) ? d[key].map((x) => ({ id: x.id || nid('x'), ...x })) : base[key];
  }
  for (const key of ['cidadesEdit', 'realizado', 'mercado']) out[key] = d[key] && typeof d[key] === 'object' ? d[key] : {};
  out.vistos = { ...base.vistos, ...(d.vistos && typeof d.vistos === 'object' ? d.vistos : {}) };
  for (const key of ['vagas', 'decisoes']) out[key] = Array.isArray(d[key]) ? d[key] : [];
  const adulto1 = (out.familia.pessoas.find((p) => p.tipo !== 'crianca') || {}).id || '';
  if (d.ascendencia && typeof d.ascendencia === 'object' && Array.isArray(d.ascendencia.linha)) out.ascendencia = d.ascendencia;
  else out.ascendencia = ascendenciaInicial(adulto1);
  if (!out.familia.pessoas.some((p) => p.id === out.ascendencia.titular)) out.ascendencia.titular = adulto1;
  if (d.viagem && typeof d.viagem === 'object') out.viagem = d.viagem; else delete out.viagem;
  if (d.assistente && typeof d.assistente === 'object' && Array.isArray(d.assistente.historico)) out.assistente = d.assistente; else delete out.assistente;
  if (!SC.includes(out.cenarioAtivo)) out.cenarioAtivo = 'base';
  if (!todasCidades(out).some((c) => c.id === out.cidade)) out.cidade = 'viseu';
  return out;
}

function todasCidades(st) {
  const ed = (st && st.cidadesEdit) || {};
  return [...CIDADES_BASE, ...((st && st.cidadesExtras) || [])].map((c) => ({ ...c, ...(ed[c.id] || {}) }));
}
