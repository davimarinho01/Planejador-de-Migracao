'use strict';

/* =========================================================
   Motor de cálculo: família, cidade, impostos, mês a mês.
   Não mexe na interface; só recebe o estado e devolve números.
   ========================================================= */

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const nulo = (v) => v === null || v === undefined || v === '';

/* ---------- calendário ---------- */
function parseMes(s) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(s || ''));
  if (!m) { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; }
  return { y: +m[1], m: +m[2] };
}
function addMes({ y, m }, n) {
  const t = y * 12 + (m - 1) + n;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
}
const mesKey = ({ y, m }) => `${y}-${String(m).padStart(2, '0')}`;
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesLabel = ({ y, m }) => `${MESES_CURTOS[m - 1]}/${String(y).slice(2)}`;
function hojeMes() { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; }
function mesesEntre(a, b) { return (b.y - a.y) * 12 + (b.m - a.m); }

/* ---------- família ---------- */
function familiaInfo(st) {
  const ps = st.familia.pessoas;
  const adultos = ps.filter((p) => p.tipo !== 'crianca');
  const criancas = ps.filter((p) => p.tipo === 'crianca');
  const A = Math.max(1, adultos.length), C = criancas.length, P = A + C;
  const quartos = 1 + Math.max(0, A - 2) + Math.ceil(C / 2);
  const tipAuto = quartos <= 1 ? 't1' : quartos === 2 ? 't2' : 't3';
  const tip = st.familia.tipologia && st.familia.tipologia !== 'auto' ? st.familia.tipologia : tipAuto;
  const fatorD7 = 1 + 0.5 * (A - 1) + 0.3 * C; // 1º adulto 100%, demais 50%, crianças 30%
  const comCelular = A + criancas.filter((c) => num(c.idade) >= 12).length;
  return { adultos, criancas, A, C, P, quartos, tip, tipAuto, fatorD7, comCelular };
}

function cidadeDe(st, id) {
  const cs = todasCidades(st);
  return cs.find((c) => c.id === (id || st.cidade)) || cs.find((c) => c.id === 'viseu') || cs[0];
}

function autoValor(st, auto, cidade, fam) {
  const c = cidade, f = fam;
  switch (auto) {
    case 'aluguel': return num(c[f.tip]);
    case 'contas': return (CUSTO.contasT1 + CUSTO.contasPorPessoaExtra * Math.max(0, f.P - 2) + (f.tip === 't2' ? CUSTO.contasT2 : f.tip === 't3' ? CUSTO.contasT3 : 0)) * num(c.contas || 1);
    case 'mercado': return CUSTO.mercadoAdulto * num(c.alim || 1) * (f.A + CUSTO.mercadoCrianca * f.C);
    case 'transporte': return num(c.passe) * f.A;
    case 'telemovel': return CUSTO.telemovel * f.comCelular;
    case 'seguro': return CUSTO.seguroPessoa * f.P;
    case 'escola': return CUSTO.escolaCrianca * f.C;
    default: return null;
  }
}

/* ---------- cenário ---------- */
function cenario(st, k) {
  const sc = st.cenarios[k];
  const cambio = Math.max(0.0001, num(sc.cambio));
  const fator = (1 - num(sc.tarifa)) / (cambio * (1 + num(sc.iof)));
  return { sc, cambio, fator };
}

/* ---------- despesas e custos de entrada ---------- */
function despesasCalc(st, k, cidadeId) {
  const { sc, cambio } = cenario(st, k);
  const fam = familiaInfo(st);
  const cid = cidadeDe(st, cidadeId);
  const ajuste = 1 + num(sc.ajusteDesp);
  const items = st.despesas.map((d) => {
    const autoV = d.auto ? autoValor(st, d.auto, cid, fam) : null;
    const baseV = autoV !== null ? autoV : d.moeda === 'BRL' ? num(d.valor) / cambio : num(d.valor);
    return { ...d, valorAuto: autoV, eur: d.ativo ? baseV * ajuste : 0 };
  });
  const total = items.reduce((s, d) => s + d.eur, 0);
  const porCat = {};
  for (const d of items) if (d.eur) porCat[d.cat] = (porCat[d.cat] || 0) + d.eur;
  const moradia = items.filter((d) => d.cat === 'Moradia').reduce((s, d) => s + d.eur, 0);
  return { items, total, porCat, moradia, cidade: cid, fam };
}

function entradaCalc(st, k, cidadeId, moradia) {
  const { sc, fator } = cenario(st, k);
  const fam = familiaInfo(st);
  const items = st.entrada.map((e) => {
    const qtd = e.porPessoa ? fam.P : 1;
    const v = num(e.valor) * qtd;
    return { ...e, qtd, total: v, eur: e.moeda === 'EUR' ? v : 0, brl: e.moeda === 'EUR' ? v / fator : v };
  });
  const aluguelAdiantadoEUR = num(sc.mesesAluguel) * moradia;
  const eurPart = items.reduce((s, e) => s + e.eur, 0) + aluguelAdiantadoEUR;
  const brlPart = items.filter((e) => e.moeda !== 'EUR').reduce((s, e) => s + e.brl, 0);
  return { items, aluguelAdiantadoEUR, aluguelAdiantadoBRL: aluguelAdiantadoEUR / fator, eurPart, brlPart, totalBRL: brlPart + eurPart / fator };
}

/* ---------- rendas ativas em um mês ---------- */
function rendaBasica(st, k, r, m) {
  const sc = st.cenarios[k];
  if (!r.ativo) return false;
  if (r.status === 'a confirmar' && !sc.contarIncertas) return false;
  if (!nulo(r.inicio) && m < num(r.inicio)) return false;
  if (!nulo(r.fim) && m >= num(r.fim)) return false;
  return true;
}
function rendaAtiva(st, k, r, m) {
  if (!rendaBasica(st, k, r, m)) return false;
  return !st.rendas.some((o) => o.substitui && o.substitui === r.id && o.id !== r.id && rendaBasica(st, k, o, m));
}

/* ---------- IRS ---------- */
function progressivo(x, T) {
  let imposto = 0, inf = 0;
  for (const [sup, taxa] of T.escaloes) {
    if (x <= inf) break;
    imposto += (Math.min(x, sup) - inf) * taxa;
    inf = sup;
  }
  if (x > T.solid) imposto += (x - T.solid) * 0.025;
  return imposto;
}
function deducoesColeta(nAdultos, idadesCriancas) {
  let d = IRS.despGerais * nAdultos;
  const ord = [...idadesCriancas].sort((a, b) => a - b);
  ord.forEach((idade, i) => {
    d += IRS.dependente;
    if (i >= 1 && idade <= 6) d += IRS.segundoAte6;
    else if (idade < 3) d += IRS.menor3;
  });
  return d;
}

/* entradas anuais em euros:
   A[pessoaId] = { br, pt, brTax, ss }  (trabalho)
   F = { bruto, brTax }   E = { bruto, brTax } */
function impostoAnual(st, ano, anoMudanca, A, F, E) {
  const T = irsAno(ano);
  const fam = familiaInfo(st);
  const dedEsp = IRS.dedEspFator * IRS.ias;
  const idadesC = fam.criancas.map((c) => num(c.idade));
  const adultos = fam.adultos.length ? fam.adultos : [{ id: '_', irsJovemAno: 0 }];

  const pessoa = adultos.map((p) => {
    const a = A[p.id] || { br: 0, pt: 0, brTax: 0, ss: 0, ifi: 0, ssIfi: 0 };
    // IFICI (art. 58.º-A do EBF): 20% sobre o trabalho elegível em Portugal e isenção do
    // rendimento estrangeiro de quem tem o regime; não acumula com o IRS Jovem
    const ifiB = num(a.ifi), temIfici = ifiB > 0;
    const brTrib = temIfici ? 0 : a.br;
    const bruto = brTrib + a.pt;
    const anoJ = num(p.irsJovemAno) > 0 ? num(p.irsJovemAno) + (ano - anoMudanca) : 0;
    const elegivel = !temIfici && anoJ >= 1 && anoJ <= 10 && (nulo(p.idade) || num(p.idade) + (ano - anoMudanca) <= 35);
    const isento = elegivel ? Math.min(IRS.jovemTeto * IRS.ias, bruto * IRS.jovem[anoJ]) : 0;
    const ded = bruto > 0 ? Math.min(bruto - isento, Math.max(dedEsp, a.ss)) : 0;
    const dedI = temIfici ? Math.min(ifiB, Math.max(bruto > 0 ? 0 : dedEsp, num(a.ssIfi))) : 0;
    const ifici = temIfici ? IRS.ifici * Math.max(0, ifiB - dedI) : 0;
    return { id: p.id, nome: p.nome, bruto, br: brTrib, brIsentoIfici: temIfici ? a.br : 0, pt: a.pt, ifiBruto: ifiB, ifici, ificiTaxa: ifiB ? ifici / ifiB : 0, temIfici,
      brTax: temIfici ? 0 : a.brTax, ss: a.ss + num(a.ssIfi), isento, ded, tributavel: Math.max(0, bruto - isento - ded) };
  });
  // rendimentos não atribuídos a ninguém (ex.: trabalho sem pessoa) vão para o 1º adulto
  if (A._ && pessoa[0]) {
    pessoa[0].br += A._.br; pessoa[0].pt += A._.pt; pessoa[0].brTax += A._.brTax; pessoa[0].bruto += A._.br + A._.pt;
    pessoa[0].tributavel += A._.br + A._.pt;
  }

  function unidades(conjunta) {
    const n = pessoa.length;
    const part = (x) => x / n; // aluguéis e capitais divididos igualmente
    const us = [];
    if (conjunta && n >= 2) {
      const [a, b, ...resto] = pessoa;
      us.push({ q: 2, ps: [a, b], adultos: 2, criancas: idadesC });
      resto.forEach((p) => us.push({ q: 1, ps: [p], adultos: 1, criancas: [] }));
    } else {
      pessoa.forEach((p, i) => us.push({ q: 1, ps: [p], adultos: 1, criancas: i === 0 ? idadesC : [] }));
    }
    return us.map((u) => {
      const s = (f) => u.ps.reduce((t, p) => t + f(p), 0);
      const nTrib = u.ps.filter((p) => !p.temIfici).length; // a parte de quem tem IFICI no aluguel e nos juros do Brasil é isenta
      return {
        ...u, nomes: u.ps.map((p) => p.nome).join(' e '),
        Abruto: s((p) => p.bruto), Abr: s((p) => p.br), Apt: s((p) => p.pt), AbrTax: s((p) => p.brTax), Atrib: s((p) => p.tributavel),
        F: part(F.bruto) * nTrib, FbrTax: part(F.brTax) * nTrib,
        E: part(E.bruto) * nTrib, EbrTax: part(E.brTax) * nTrib, frac: nTrib / n, I: s((p) => p.ifici),
        ded: deducoesColeta(u.adultos, u.criancas),
      };
    });
  }

  // crédito por dupla tributação: calculado rendimento a rendimento (art. 81.º do CIRS)
  function credA(u, impostoA) {
    if (u.Atrib <= 0 || impostoA <= 0) return 0;
    return u.ps.reduce((s, p) => {
      if (p.bruto <= 0) return s;
      const fatia = impostoA * (p.tributavel / u.Atrib) * (p.br / p.bruto);
      return s + Math.min(p.brTax, fatia);
    }, 0);
  }
  function credE(u, taxaMedia) {
    return (E.itens || []).reduce((s, it) => s + Math.min(it.brTax * u.frac, it.bruto * u.frac * taxaMedia), 0);
  }
  function autonomo(us) {
    let tot = { A: 0, F: 0, E: 0, I: 0 };
    const det = us.map((u) => {
      let tA = Math.max(0, progressivo(u.Atrib / u.q, T) * u.q - u.ded);
      tA = Math.min(tA, Math.max(0, u.Abruto - u.q * T.minimo)); // mínimo de existência
      const cA = credA(u, tA);
      const tF = IRS.autonomoAluguel * u.F, cF = Math.min(u.FbrTax, tF);
      const tE = IRS.autonomoCapitais * u.E, cE = credE(u, IRS.autonomoCapitais);
      const r = { A: tA - cA, F: tF - cF, E: tE - cE, I: u.I };
      tot.A += r.A; tot.F += r.F; tot.E += r.E; tot.I += r.I;
      return { nomes: u.nomes, bruto: { A: tA, F: tF, E: tE, I: u.I }, credito: { A: cA, F: cF, E: cE, I: 0 }, liquido: r };
    });
    return { cat: tot, total: tot.A + tot.F + tot.E + tot.I, det };
  }
  function englobamento(us) {
    let tot = { A: 0, F: 0, E: 0, I: 0 };
    const det = us.map((u) => {
      const base = u.Atrib + u.F + u.E;
      const t = base > 0 ? Math.max(0, progressivo(base / u.q, T) * u.q - u.ded) : 0;
      const sA = base ? u.Atrib / base : 0, sF = base ? u.F / base : 0, sE = base ? u.E / base : 0;
      const cA = credA(u, t * sA);
      const cF = Math.min(u.FbrTax, t * sF), cE = credE(u, base ? t / base : 0);
      const r = { A: t * sA - cA, F: t * sF - cF, E: t * sE - cE, I: u.I };
      tot.A += r.A; tot.F += r.F; tot.E += r.E; tot.I += r.I;
      return { nomes: u.nomes, bruto: { A: t * sA, F: t * sF, E: t * sE, I: u.I }, credito: { A: cA, F: cF, E: cE, I: 0 }, liquido: r };
    });
    return { cat: tot, total: tot.A + tot.F + tot.E + tot.I, det };
  }

  const podeConjunta = st.familia.casados && pessoa.length >= 2;
  const trib = st.familia.tributacao || 'melhor';
  const reg = (st.impostos && st.impostos.regime) || 'melhor';
  const opcoes = [];
  for (const conj of [false, true]) {
    if (conj && !podeConjunta) continue;
    if (trib === 'separada' && conj) continue;
    if (trib === 'conjunta' && !conj && podeConjunta) continue;
    const us = unidades(conj);
    if (reg !== 'englobamento') opcoes.push({ regime: 'autonomo', conjunta: conj, ...autonomo(us) });
    if (reg !== 'autonomo') opcoes.push({ regime: 'englobamento', conjunta: conj, ...englobamento(us) });
  }
  opcoes.sort((a, b) => a.total - b.total);
  const escolhida = opcoes[0];
  const totalA = pessoa.reduce((s, p) => s + p.bruto, 0);
  const totalApt = pessoa.reduce((s, p) => s + p.pt, 0);
  const retidoPT = (totalA > 0 ? escolhida.cat.A * (totalApt / totalA) : 0) + escolhida.cat.I;
  const ificiTaxa = Object.fromEntries(pessoa.map((p) => [p.id, p.ificiTaxa]));
  return { ano, T, pessoa, opcoes, escolhida, retidoPT, ificiTaxa, ss: pessoa.reduce((s, p) => s + p.ss, 0) };
}

/* ---------- um mês depois da mudança ----------
   modo 'media': 13º, férias e subsídios diluídos; IRS provisionado todo mês.
   modo 'caixa': extras no mês em que caem; IRS de rendimentos do Brasil pago em agosto do ano seguinte. */
function calcMes(st, k, m, ctx) {
  ctx = ctx || {};
  const { sc, cambio, fator } = cenario(st, k);
  const modo = ctx.modo || 'media';
  const mud = parseMes(st.plano.dataMudanca);
  const cal = addMes(mud, m);
  const desp = ctx.desp || despesasCalc(st, k, ctx.cidade);
  const varT = 1 + num(sc.varTrabalho);

  // rendas
  const A = {}, F = { bruto: 0, brTax: 0 }, E = { bruto: 0, brTax: 0, itens: [] };
  const rend = [];
  for (const r of st.rendas) {
    const ativa = rendaAtiva(st, k, r, m);
    const isBRL = r.moeda !== 'EUR';
    let mensal = num(r.valor) * (r.tipo === 'trabalho' || r.tipo === 'trabalho_pt' ? varT : 1);
    let anualMult = 12, extraCaixa = 0;
    if (r.tipo === 'trabalho' && r.clt) {
      anualMult = 12 + 1 + 1 / 3;
      if (cal.m === 12) extraCaixa = mensal;
      if (cal.m === 7) extraCaixa = mensal / 3;
    }
    if (r.tipo === 'trabalho_pt') {
      const pag = num(r.pagamentos) || 14;
      anualMult = pag;
      if (pag > 12 && (cal.m === 6 || cal.m === 11)) extraCaixa = mensal * Math.min(1, (pag - 12) / 2);
    }
    const brutoMes = modo === 'media' ? mensal * anualMult / 12 : mensal + extraCaixa;
    const brTaxMes = isBRL ? brutoMes * num(r.impostoBR) : 0;
    const ssMes = r.tipo === 'trabalho_pt' ? brutoMes * IRS.ss : 0;
    const item = { ...r, ativa, isBRL, brutoMes, brTaxMes, ssMes, anual: ativa ? mensal * anualMult : 0 };
    rend.push(item);
    if (!ativa) continue;
    const anualEUR = item.anual / (isBRL ? cambio : 1);
    const brTaxAnual = isBRL ? anualEUR * num(r.impostoBR) : 0;
    if (r.tipo === 'trabalho' || r.tipo === 'trabalho_pt') {
      const pid = st.familia.pessoas.some((p) => p.id === r.pessoa && p.tipo !== 'crianca') ? r.pessoa : '_';
      const a = (A[pid] = A[pid] || { br: 0, pt: 0, brTax: 0, ss: 0, ifi: 0, ssIfi: 0 });
      if (r.tipo === 'trabalho') { a.br += anualEUR; a.brTax += brTaxAnual; }
      else if (r.ifici) { a.ifi += anualEUR; a.ssIfi += anualEUR * IRS.ss; }
      else { a.pt += anualEUR; a.ss += anualEUR * IRS.ss; }
    } else if (r.tipo === 'passiva') { F.bruto += anualEUR; F.brTax += brTaxAnual; }
  }

  // investimentos
  const caps = ctx.caps || st.investimentos.map((i) => num(i.capital));
  const inv = st.investimentos.map((i, idx) => {
    const taxa = i.idx === 'cdi' ? num(sc.cdi) * num(i.param) : i.idx === 'fii' ? num(sc.fii) : num(i.param);
    const cap = Math.max(0, num(caps[idx]));
    const brutoMes = cap * taxa;
    const brTaxMes = brutoMes * num(i.impostoBR);
    E.bruto += brutoMes * 12 / cambio; E.brTax += brTaxMes * 12 / cambio;
    E.itens.push({ bruto: brutoMes * 12 / cambio, brTax: brTaxMes * 12 / cambio });
    return { ...i, cap, taxa, brutoMes, brTaxMes };
  });

  const imp = impostoAnual(st, cal.y, mud.y, A, F, E);
  const cat = imp.escolhida.cat;
  const totA = Object.values(A).reduce((s, a) => s + a.br + a.pt, 0);

  // distribui o IRS português por item (anual → mensal)
  let receitas = 0, brutoEq = 0, impBR = 0, impPT = 0, ssTot = 0, remessa = 0, ptCaixa = 0, ptProvisao = 0, passiva = 0;
  for (const it of rend) {
    if (!it.ativa) { it.eur = 0; it.ptMes = 0; continue; }
    const anualEUR = it.anual / (it.isBRL ? cambio : 1);
    let ptAnual = 0;
    if (it.tipo === 'trabalho_pt' && it.ifici) {
      const pid = st.familia.pessoas.some((p) => p.id === it.pessoa && p.tipo !== 'crianca') ? it.pessoa : '_';
      ptAnual = anualEUR * ((imp.ificiTaxa || {})[pid] ?? 0.2 * (1 - IRS.ss));
    } else if ((it.tipo === 'trabalho' || it.tipo === 'trabalho_pt') && totA > 0) ptAnual = cat.A * (anualEUR / totA);
    if (it.tipo === 'passiva' && F.bruto > 0) ptAnual = cat.F * (anualEUR / F.bruto);
    const ptMes = ptAnual / 12;
    it.ptMes = ptMes;
    const liqOrigem = it.brutoMes - it.brTaxMes - it.ssMes; // na moeda de origem
    const chega = it.isBRL ? liqOrigem * fator : liqOrigem;
    const retidoAqui = it.tipo === 'trabalho_pt';
    const ptAgora = modo === 'media' || retidoAqui ? ptMes : 0;
    if (!(modo === 'media' || retidoAqui)) ptProvisao += ptMes;
    it.eur = chega - ptAgora;
    receitas += it.eur;
    brutoEq += it.brutoMes / (it.isBRL ? cambio : 1);
    impBR += it.brTaxMes / (it.isBRL ? cambio : 1);
    ssTot += it.ssMes;
    impPT += ptAgora;
    if (it.isBRL) remessa += liqOrigem / cambio - liqOrigem * fator;
    if (it.tipo === 'passiva') passiva += it.eur;
  }
  for (const it of inv) {
    const ptAnual = E.bruto > 0 ? cat.E * ((it.brutoMes * 12 / cambio) / E.bruto) : 0;
    const ptMes = ptAnual / 12;
    const liq = it.brutoMes - it.brTaxMes;
    const ptAgora = modo === 'media' ? ptMes : 0;
    if (modo !== 'media') ptProvisao += ptMes;
    it.ptMes = ptMes;
    it.eur = liq * fator - ptAgora;
    receitas += it.eur;
    passiva += it.eur;
    brutoEq += it.brutoMes / cambio;
    impBR += it.brTaxMes / cambio;
    impPT += ptAgora;
    remessa += liq / cambio - liq * fator;
  }

  const sobra = receitas - desp.total;
  return {
    k, m, cal, sc, cambio, fator, desp, rend, inv, imp,
    receitas, brutoEq, impBR, impPT, ss: ssTot, impostos: impBR + impPT + ssTot, remessa,
    passiva, sobra, ptProvisao,
  };
}

/* ---------- eventos do mês ---------- */
function eventosMes(st, k, m, cal, fam) {
  const { fator } = cenario(st, k);
  const out = [];
  for (const e of st.eventos || []) {
    if (!e.ativo) continue;
    const q = num(e.quando);
    let cai = false;
    if (e.repetir === 'mensal') cai = m >= q;
    else if (e.repetir === 'anual') cai = m >= q && cal.m === (num(e.mesAno) || 1);
    else cai = m === q;
    if (!cai) continue;
    const v = num(e.valor) * (e.porPessoa ? fam.P : 1);
    const eur = e.moeda === 'EUR' ? v : v * fator; // reais passam pela remessa
    out.push({ nome: e.nome, eur: e.tipo === 'entrada' ? eur : -eur });
  }
  return out;
}

/* ---------- simulação completa: antes, mudança e depois ---------- */
function simular(st, k, opts) {
  opts = opts || {};
  const { cambio, fator, sc } = cenario(st, k);
  const fam = familiaInfo(st);
  const mud = parseMes(st.plano.dataMudanca);
  const hoje = hojeMes();
  const H = Math.max(6, Math.min(120, num(st.plano.horizonte) || 36));
  const desp = despesasCalc(st, k, opts.cidade);
  let caps = st.investimentos.map((i) => num(i.capital));
  const soma = (a) => a.reduce((s, x) => s + x, 0);
  const distribuir = (delta) => {
    const tot = soma(caps);
    if (tot <= 0) { if (caps.length) caps[0] = Math.max(0, caps[0] + delta); return; }
    caps = caps.map((c) => Math.max(0, c + delta * (c / tot)));
  };

  // fase antes da mudança
  const pre = [];
  const N = st.plano.capitalBase === 'hoje' ? Math.max(0, mesesEntre(hoje, mud)) : 0;
  for (let i = 0; i < N; i++) {
    const m = i - N;
    const cal = addMes(hoje, i);
    st.investimentos.forEach((inv, idx) => {
      const taxa = inv.idx === 'cdi' ? num(sc.cdi) * num(inv.param) : inv.idx === 'fii' ? num(sc.fii) : num(inv.param);
      caps[idx] += caps[idx] * taxa * (1 - num(inv.irResidente));
    });
    distribuir(num(st.plano.aporteMensal));
    for (const ev of eventosMes(st, k, m, cal, fam)) distribuir(ev.eur / fator);
    pre.push({ m, cal, capsBRL: soma(caps), patrimonioEUR: soma(caps) / cambio });
  }
  const patrimonioMudancaBRL = soma(caps);

  // mudança: custos de entrada
  const ent = entradaCalc(st, k, opts.cidade, desp.moradia);
  let contaEUR = (st.comprasEuro || []).reduce((s, c) => s + num(c.euros), 0);
  const eurComprados = contaEUR;
  const usarEur = Math.min(contaEUR, ent.eurPart);
  contaEUR -= usarEur;
  const custoEntradaBRL = ent.brlPart + (ent.eurPart - usarEur) / fator;
  distribuir(-custoEntradaBRL);
  const capsPosEntrada = [...caps];

  // depois da mudança, mês a mês
  const pos = [];
  const irsDevido = {};
  let menor = { saldo: Infinity }, zerou = null;
  for (let m = 0; m < H; m++) {
    const r = calcMes(st, k, m, { caps, modo: 'caixa', desp, cidade: opts.cidade });
    const evs = eventosMes(st, k, m, r.cal, fam);
    if (st.plano.irsEmAgosto) {
      irsDevido[r.cal.y] = (irsDevido[r.cal.y] || 0) + r.ptProvisao;
      if (r.cal.m === 8 && irsDevido[r.cal.y - 1] > 0.5) {
        evs.push({ nome: `IRS de ${r.cal.y - 1}`, eur: -irsDevido[r.cal.y - 1], irs: true });
        irsDevido[r.cal.y - 1] = 0;
      }
    }
    const receitasCaixa = r.receitas + (st.plano.irsEmAgosto ? 0 : -r.ptProvisao);
    const saldo = receitasCaixa - r.desp.total + evs.reduce((s, e) => s + e.eur, 0);
    if (saldo >= 0) contaEUR += saldo;
    else if (contaEUR >= -saldo) contaEUR += saldo;
    else {
      const falta = -saldo - contaEUR;
      contaEUR = 0;
      const antes = soma(caps);
      distribuir(-falta / fator);
      if (antes > 0 && soma(caps) <= 0.5 && zerou === null) zerou = m;
    }
    if (saldo < menor.saldo) menor = { saldo, m, cal: r.cal };
    pos.push({ m, cal: r.cal, receitas: receitasCaixa, despesas: r.desp.total, eventos: evs, saldo, contaEUR, capsBRL: soma(caps), patrimonioEUR: contaEUR + soma(caps) / cambio });
  }

  return {
    k, fam, desp, ent, pre, pos, N, H, mud,
    patrimonioMudancaBRL, eurComprados, usarEur, custoEntradaBRL, capsPosEntrada,
    patrimonioPosEntradaEUR: soma(capsPosEntrada) / cambio + (eurComprados - usarEur),
    patrimonioFinalEUR: pos.length ? pos[pos.length - 1].patrimonioEUR : 0,
    menor, zerou,
  };
}

/* ---------- resumo usado pelo painel ---------- */
function resumo(st, k, opts) {
  const sim = simular(st, k, opts);
  const ref = Math.max(0, Math.min(sim.H - 1, num(st.plano.mesReferencia)));
  const tip = calcMes(st, k, ref, { caps: sim.capsPosEntrada, modo: 'media', desp: sim.desp, cidade: opts && opts.cidade });
  const fam = sim.fam;
  const exigMes = num(st.metas.salarioMinimo) * fam.fatorD7;
  const reservaEUR = sim.patrimonioPosEntradaEUR;
  return {
    sim, tip, fam, cidade: sim.desp.cidade,
    receitas: tip.receitas, despesas: sim.desp.total, sobra: tip.sobra,
    aposMeta: tip.sobra - num(st.metas.poupanca),
    entradaBRL: sim.custoEntradaBRL,
    reservaEUR, reservaBRL: reservaEUR * tip.cambio,
    folego: sim.desp.total > 0 ? reservaEUR / sim.desp.total : 0,
    exigMes, d7Exig: exigMes * 12, d7Ratio: exigMes ? reservaEUR / (exigMes * 12) : 0,
    passiva: tip.passiva,
  };
}
