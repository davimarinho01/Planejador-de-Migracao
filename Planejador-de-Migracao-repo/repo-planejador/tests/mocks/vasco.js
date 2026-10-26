// Simula window.net (APIs, Groq e Google Drive) para os testes de interface.
(() => {
  const R = {
    eur_last: { EURBRL: { bid: '6.21', ask: '6.23', high:'6.25', low:'6.18', pctChange:'0.4', timestamp: String(Math.floor(Date.now()/1000)) } },
    sgs: (p) => [{ data: '20/10/2026', valor: { cdi: '14.90', selic: '15.00', ipca12: '4.70', ptaxEur: '6.20' }[p.serie] }],
  };
  window.__calls = [];
  const get = async (k, p) => { window.__calls.push(k); let d = R[k]; if (typeof d === 'function') d = d(p||{}); return d ? { ok: true, data: d } : { ok: false, error: 'offline' }; };
  window.__iaReqs = []; window.__transc = [];
  const tc = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const resp = (content, tool_calls) => ({ ok: true, data: { choices: [{ message: { role: 'assistant', content, ...(tool_calls ? { tool_calls } : {}) } }] } });
  const ia = {
    status: async () => ({ temChave: true, criptografada: true }),
    setKey: async () => ({ ok: true }), clearKey: async () => ({ ok: true }),
    models: async () => ({ ok: true, ids: ['whisper-large-v3', 'whisper-large-v3-turbo', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'] }),
    transcrever: async (buf, mime, modelo) => { window.__transc.push({ bytes: buf.byteLength, mime, modelo }); return { ok: true, texto: 'Quanto sobra se o aluguel for 800 euros?' }; },
    chat: async (req) => {
      window.__iaReqs.push(JSON.parse(JSON.stringify(req)));
      const sys = (req.messages[0] && typeof req.messages[0].content === 'string') ? req.messages[0].content : '';
      if (req.tools && req.tools[0].type === 'browser_search') {
        if (/SOMENTE com um JSON/.test(sys)) return resp('Aqui está:\n' + JSON.stringify({ regras: [
          { id: 'salarioMinimo', valor: 1020, texto: 'Governo fixou o salário mínimo de 2027 em € 1.020', fonte: 'https://dre.pt/x', data: '2026-10-20', confianca: 'alta' },
          { id: 'taxaConsular', valor: 110, texto: 'Taxa de € 110 mantida', fonte: 'https://vistos.mne.gov.pt', data: '2026-09', confianca: 'media' },
          { id: 'anosNacionalidade', valor: 7, texto: '7 anos (Lei Orgânica 1/2026)', fonte: 'https://diariodarepublica.pt', data: '2026-05-18', confianca: 'alta' },
          { id: 'ias', valor: 552.4, texto: 'IAS de 2027 proposto em € 552,40', fonte: 'https://seg-social.pt', data: '2026-10', confianca: 'baixa' },
          { id: 'regulamento', valor: null, texto: 'Ainda não publicado em outubro de 2026.', fonte: '', data: '', confianca: 'media' } ] }));
        return resp('A vaga no link é Desenvolvedor .NET Pleno na Critical, em Viseu, € 30.000 a € 34.000 por ano, híbrido (itjobs.pt, 22/10/2026).');
      }
      const u0 = req.messages.find((m) => m.role === 'user');
      if (u0 && Array.isArray(u0.content)) return resp('RECIBO DE VENCIMENTO - OUTUBRO 2026\nVencimento base: 2.100,00 EUR\nSeg. Social: -231,00\nIRS: -260,00\nLíquido: 1.609,00 EUR');
      const ultU = [...req.messages].reverse().find((m) => m.role === 'user');
      const txt = String(ultU && ultU.content || '');
      const nTool = req.messages.filter((m) => m.role === 'tool').length;
      if (/Escreva o resumo/.test(txt)) return resp('- O euro subiu e está **acima do câmbio do plano**.\n- Faltam 18 meses.\n\nSugestão: comprar € 1.500 por mês.');
      if (/Analise esta vaga/.test(txt) && nTool === 0) return resp('', [tc('v1', 'registrar_vaga', { titulo: 'Desenvolvedor .NET Pleno', empresa: 'Critical Software', cidade: 'Viseu', salario_bruto_anual: 32000, pagamentos: 14, pessoa: 'Ana', modalidade: 'hibrido', link: 'https://www.itjobs.pt/oferta/1', inicio_mes: 2, observacoes: 'Exige .NET 8, Azure e inglês' })]);
      if (/nacionalidade pela ascend/.test(txt) && nTool === 0) return resp('', [tc('a1', 'ler_secao', { secao: 'ascendencia' })]);
      if (/acompanhamento/.test(txt) && nTool === 0) return resp('', [tc('ac1', 'ler_acompanhamento', { mes: '2026-10' })]);
      if (/<<</.test(txt)) return resp('Li o recibo: **bruto de € 2.100**, líquido de € 1.609. Bate com a simulação da vaga.');
      if (nTool) return resp('Pronto. Veja os números acima.');
      return resp('Ok: ' + txt.slice(0, 60));
    },
  };
  window.net = { get, pdf: async () => ({ ok: true }), backup: { info: async () => ({ dir: '' }), choose: async () => ({}), write: async () => ({ ok: true }) }, ia };
})();
