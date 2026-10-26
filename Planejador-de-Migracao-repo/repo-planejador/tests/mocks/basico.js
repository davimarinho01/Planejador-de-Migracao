// Simula window.net (APIs, Groq e Google Drive) para os testes de interface.
(() => {
  const dias = Array.from({length: 30}, (_, i) => `2028-04-${String(i+1).padStart(2,'0')}`);
  const clima = (n, base) => ({ time: Array.from({length:n},(_,i)=>`2025-04-${String(i+1).padStart(2,'0')}`), temperature_2m_max: Array.from({length:n},(_,i)=>base+Math.sin(i/3)*3), temperature_2m_min: Array.from({length:n},(_,i)=>base-9+Math.cos(i/4)*2), precipitation_sum: Array.from({length:n},(_,i)=> i%4===0 ? 5 : 0) });
  const R = {
    tp_dates: { success: true, currency: 'brl', data: [
      { origin:'GIG', destination:'OPO', price: 3120, airline:'TP', flight_number:'74', departure_at:'2028-04-05T22:15:00-03:00', transfers: 1, duration: 760, link:'/search/GIG0504OPO1' },
      { origin:'GIG', destination:'OPO', price: 3480, airline:'LA', flight_number:'8084', departure_at:'2028-04-05T16:40:00-03:00', transfers: 1, duration: 900, link:'/search/x' } ] },
    tp_grouped: { success: true, data: Object.fromEntries(dias.map((d,i)=>[d,{price: 2900 + ((i*137)%900)}])) },
    serp_flights: { search_parameters: { currency: 'BRL' }, search_metadata: { google_flights_url: 'https://www.google.com/travel/flights?x' },
      best_flights: [{ price: 6100, total_duration: 690, flights: [{ airline:'TAP Air Portugal', flight_number:'TP 74', departure_airport:{time:'2028-04-05 22:15'}, arrival_airport:{time:'2028-04-06 11:20'} }] }],
      other_flights: [{ price: 7020, total_duration: 980, flights: [{ airline:'Azul', flight_number:'AD 8750', departure_airport:{time:'2028-04-05 18:00'}, arrival_airport:{time:'2028-04-05 23:00'} }, { airline:'TAP Air Portugal', flight_number:'TP 12', departure_airport:{time:'2028-04-06 01:00'}, arrival_airport:{time:'2028-04-06 14:20'} }] }],
      price_insights: { lowest_price: 6100, price_level: 'low', typical_price_range: [6500, 9000] } },
    meteo_archive: { daily: clima(30, 20) },
    feriados: (p) => p.pais === 'PT' ? [{date:'2028-04-14', localName:'Sexta-feira Santa', global:true},{date:'2028-04-25', localName:'Dia da Liberdade', global:true},{date:'2028-06-10',localName:'Dia de Portugal',global:true}] : [{date:'2028-04-21', localName:'Tiradentes', global:true}],
    eur_last: { EURBRL: { bid: '6.21', ask: '6.23', high:'6.25', low:'6.18', pctChange:'0.4', timestamp: String(Math.floor(Date.now()/1000)) } },
    sgs: (p) => [{ data: '20/10/2026', valor: { cdi: '14.90', selic: '15.00', ipca12: '4.70', ptaxEur: '6.20' }[p.serie] }],
  };
  window.__calls = [];
  const get = async (k, p) => { window.__calls.push(k); let d = R[k]; if (typeof d === 'function') d = d(p||{}); return d ? { ok: true, data: d } : { ok: false, error: 'offline' }; };
  let temChave = false, passo = 0;
  window.__iaReqs = [];
  const tc = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const ia = {
    status: async () => ({ temChave, criptografada: true }),
    setKey: async (k) => /^gsk_[A-Za-z0-9]{20,}$/.test(k) ? (temChave = true, { ok: true }) : { ok: false, error: 'Essa não parece uma chave da Groq (começa com gsk_).' },
    clearKey: async () => { temChave = false; return { ok: true }; },
    models: async () => ({ ok: true, ids: ['whisper-large-v3', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'groq/compound', 'meta-llama/llama-guard-4-12b', 'playai-tts'] }),
    chat: async (req) => {
      window.__iaReqs.push(JSON.parse(JSON.stringify(req)));
      if (req.tools && req.tools[0].type === 'browser_search') return { ok: true, data: { choices: [{ message: { role:'assistant', content: 'Em outubro de 2026, T1 em Viseu anunciado entre € 650 e € 850, mediana perto de € 750 (idealista.pt, 20/10/2026).' } }] } };
      const n = req.messages.filter(m => m.role === 'tool').length;
      const steps = [
        [tc('a','ler_resumo',{}), tc('b','dados_reais',{})],
        [tc('c','simular',{ alteracoes: [{ caminho:'cenarios.base.cambio', valor: 6.83 }] })],
        [tc('d','pesquisar_internet',{ pergunta: 'preço aluguel T1 Viseu outubro 2026' })],
        [tc('e','propor_alteracoes',{ alteracoes: [{ caminho:'cidadesEdit.viseu.t1', valor: 750 }], explicacao: 'Atualizar o T1 de Viseu para € 750, mediana dos anúncios de hoje.' })],
      ];
      const idx = [0, 2, 3, 4, 5].indexOf(n);
      if (idx >= 0 && idx < steps.length) return { ok: true, data: { choices: [{ message: { role:'assistant', content: '', tool_calls: steps[idx] } }] } };
      return { ok: true, data: { choices: [{ message: { role:'assistant', content: '**Resumo:** o plano fecha, mas com margem curta.\n\n| Item | Plano | Hoje |\n|---|---|---|\n| Euro | R$ 6,50 | R$ 6,21 |\n| T1 Viseu | € 700 | € 750 |\n\n- Se o euro for a R$ 6,83 (+5%), a sobra cai.\n- Propus atualizar o aluguel; confira o cartão acima.\n\nFonte: https://www.idealista.pt' } }] } };
    },
  };
  window.net = { get, pdf: async () => ({ ok: true }), backup: { info: async () => ({ dir: '' }), choose: async () => ({}), write: async () => ({ ok: true }) }, ia };
})();
