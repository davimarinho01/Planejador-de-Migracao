// Simula window.net (APIs, Groq e Google Drive) para os testes de interface.
(() => {
  window.__notif = [];
  const R = { eur_last: { EURBRL: { bid: '6.21', ask: '6.23', high:'6.25', low:'6.18', pctChange:'0.4', timestamp: String(Math.floor(Date.now()/1000)) } },
    sgs: (p) => [{ data: '20/10/2026', valor: { cdi: '14.90', selic: '15.00', ipca12: '4.70', ptaxEur: '6.20' }[p.serie] }],
    feriados: [{ date: '2026-12-25', localName: 'Natal', global: true }], ine_rendas: INEJSON };
  const get = async (k, p) => { let d = R[k]; if (typeof d === 'function') d = d(p||{}); return d ? { ok: true, data: d } : (k === 'usd_last' ? { ok: false, status: 404, error: 'HTTP 404' } : { ok: false, error: 'tempo esgotado' }); };
  window.net = { get, pdf: async () => ({ ok: true }), backup: { info: async () => ({ dir: '' }), choose: async () => ({}), write: async () => ({ ok: true }) },
    ia: { status: async () => ({ temChave: false }), models: async () => ({ ok: false }), chat: async () => ({ ok: false }), setKey: async () => ({ ok: true }), clearKey: async () => ({}) },
    sync: {
      info: async () => ({ dir: 'G:\\Meu Drive', pasta: 'G:\\Meu Drive\\Planejador Viseu', sugestoes: [], usuario: QUEM, computador: QUEM + '-PC' }),
      escolher: async () => ({ ok: true }), usarSugestao: async () => ({ ok: true }), desligar: async () => ({ ok: true }),
      ler: async () => { const d = await window.driveLer(); return d.plano ? { ok: true, conteudo: d.plano, mtime: d.mtime, conflitos: [] } : { ok: true, vazio: true, conflitos: [] }; },
      mtime: async () => (await window.driveLer()).mtime,
      gravar: async (json) => ({ ok: true, mtime: await window.driveGravar(json) }),
      conflitoResolvido: async () => ({ ok: true }), pdf: async () => { window.__pdf = (window.__pdf || 0) + 1; return { ok: true }; },
    },
    update: { verificar: async () => ({ ok: true, atual: '2.3.0', publicada: '2.3.0', disponivel: false, podePublicar: false }), aplicar: async () => ({ ok: true }), publicar: async () => ({ ok: true, versao: '2.3.0' }) },
    app: { info: async () => ({ versao: '2.3.0', electron: '39.1.0', sistema: 'Windows_NT 10', criptografia: true, pastaSync: 'G:\\Meu Drive\\Planejador Viseu', segundoPlano: false, iniciarComWindows: false }),
      mostrar: async () => ({}), segundoPlano: async (c) => ({ ok: true, ...c }), notificar: async (n) => { window.__notif.push(n); return { ok: true }; }, aoVerificar: () => {}, aoAbrir: () => {} },
  };
})();
