// Simula window.net (APIs, Groq e Google Drive) para os testes de interface.
(() => {
  // simulador do limite da Groq: balde por modelo, recompõe LIMITE tokens a cada JANELA ms
  const LIMITE = 8000, JANELA = 8000; window.__janelaCota = JANELA;
  const balde = {}; window.__bloqueioDiario = new Set(); window.__log = [];
  const nivel = (m) => { const b = balde[m] = balde[m] || { v: LIMITE, t: Date.now() }; b.v = Math.min(LIMITE, b.v + LIMITE * (Date.now() - b.t) / JANELA); b.t = Date.now(); return b; };
  const custo = (req) => Math.ceil(JSON.stringify(req.messages).length / 3.2 + JSON.stringify(req.tools || []).length / 3.2) + 400;
  const lim = (m) => { const b = nivel(m); return { 'limit-tokens': String(LIMITE), 'remaining-tokens': String(Math.max(0, Math.floor(b.v))), 'reset-tokens': ((LIMITE - b.v) / LIMITE * 60).toFixed(2) + 's' }; };
  const tc = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const resp = (m, content, tool_calls) => ({ ok: true, limites: lim(m), data: { choices: [{ message: { role: 'assistant', content, ...(tool_calls ? { tool_calls } : {}) } }] } });
  const ia = {
    status: async () => ({ temChave: true, criptografada: true }), setKey: async () => ({ ok: true }), clearKey: async () => ({ ok: true }),
    models: async () => ({ ok: true, ids: ['whisper-large-v3', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'] }),
    transcrever: async () => ({ ok: true, texto: 'oi' }),
    chat: async (req) => {
      const m = req.model, c = custo(req);
      if (window.__bloqueioDiario.has(m)) { window.__log.push([m, c, 429, 'dia']); return { ok: false, status: 429, error: `Rate limit reached for model \`${m}\` on tokens per day (TPD): Limit 200000, Used 199990. Please try again in 2h13m5s.`, limites: { 'retry-after': '7985' } }; }
      const b = nivel(m);
      if (c > b.v) { const s = ((c - b.v) / LIMITE * JANELA / 1000).toFixed(1); window.__log.push([m, c, 429, s]); return { ok: false, status: 429, error: `Rate limit reached for model \`${m}\` on tokens per minute (TPM): Limit ${LIMITE}, Used ${Math.round(LIMITE - b.v)}, Requested ${c}. Please try again in ${s}s.`, limites: { ...lim(m), 'retry-after': String(Math.ceil(+s)) } }; }
      b.v -= c; window.__log.push([m, c, 200, req.tools && req.tools[0].type === 'browser_search' ? 'busca' : '']);
      if (req.tools && req.tools[0].type === 'browser_search') return resp(m, 'Mercado de TI em Portugal (out/2026): .NET pleno ganha € 28 mil a € 40 mil por ano; Porto, Lisboa e Braga concentram vagas; inglês intermediário é aceito em muitas empresas (itjobs.pt, landing.jobs, 2026).');
      const ult = [...req.messages].reverse().find((x) => x.role === 'user');
      const txt = String(ult && ult.content || '');
      if (/Extraia deste documento/.test(txt)) return resp(m, 'Maria Exemplo, Full Stack .NET 8/C#/Angular/Oracle/Azure na Empresa X desde 2024 (estágio desde set/2024); harness de IA; ADS Estácio 2026; pós em Engenharia de Dados e IA até 2027; inglês intermediário; 69 projetos com .NET/Angular/Azure.');
      const nTool = req.messages.filter((x) => x.role === 'tool').length;
      if (/currículo/i.test(txt) && nTool === 0) return resp(m, '', [tc('t1', 'pesquisar_internet', { pergunta: 'salário desenvolvedor .NET pleno Portugal 2026' }), tc('t2', 'ler_resumo', {})]);
      if (nTool) return resp(m, '**Sim, o seu perfil tem boa chance em Portugal.** .NET + Angular + Azure é muito pedido; mire em € 30 a 38 mil por ano.');
      return resp(m, 'Bom dia!');
    },
  };
  window.net = { get: async () => ({ ok: false, error: 'offline' }), pdf: async () => ({ ok: true }), backup: { info: async () => ({ dir: '' }), choose: async () => ({}), write: async () => ({ ok: true }) }, ia };
})();
