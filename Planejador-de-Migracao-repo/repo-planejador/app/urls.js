/* Endereços das APIs públicas usadas na aba Mercado.
   Compartilhado entre o processo principal (Node) e a interface (navegador). */
(function (root) {
  'use strict';

  const SGS_CODES = {
    cdi: 4389,      // CDI anualizado, base 252 (% a.a.)
    selic: 432,     // Meta Selic definida pelo Copom (% a.a.)
    ipca12: 13522,  // IPCA acumulado em 12 meses (%)
    ptaxEur: 21619, // Euro, taxa de venda PTAX (R$/€)
  };

  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function odata(resource, filter, extra) {
    const q = [
      '$format=json',
      `$filter=${encodeURIComponent(filter)}`,
      `$orderby=${encodeURIComponent('Data desc')}`,
      '$top=60',
    ];
    if (extra) q.push(extra);
    return `https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/${resource}?${q.join('&')}`;
  }

  function voo(p, precisaToken) {
    const o = String(p.origin || '').toUpperCase(), d = String(p.destination || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(o) || !/^[A-Z]{3}$/.test(d)) throw new Error('aeroporto inválido');
    const dt = String(p.date || '');
    if (!/^\d{4}-\d{2}(-\d{2})?$/.test(dt)) throw new Error('data inválida');
    const t = String(p.token || '').trim();
    if (precisaToken && !/^[A-Za-z0-9_\-.]{8,200}$/.test(t)) throw new Error('chave ausente ou inválida');
    return { o, d, dt, tok: encodeURIComponent(t) };
  }

  function build(key, p) {
    p = p || {};
    switch (key) {
      case 'eur_last':
        return 'https://economia.awesomeapi.com.br/json/last/EUR-BRL';
      case 'eur_daily': {
        const n = Math.min(360, Math.max(2, parseInt(p.n, 10) || 30));
        return `https://economia.awesomeapi.com.br/json/daily/EUR-BRL/${n}`;
      }
      case 'eur_frank_latest':
        return 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=BRL';
      case 'eur_frank_series': {
        const end = new Date();
        const start = new Date(end.getTime() - (parseInt(p.days, 10) || 45) * 86400000);
        return `https://api.frankfurter.dev/v1/${isoDate(start)}..${isoDate(end)}?base=EUR&symbols=BRL`;
      }
      case 'sgs': {
        const code = SGS_CODES[p.serie];
        if (!code) throw new Error('série desconhecida');
        const n = Math.min(20, Math.max(1, parseInt(p.n, 10) || 1));
        return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/${n}?formato=json`;
      }
      case 'focus_anual': {
        const ind = { selic: 'Selic', ipca: 'IPCA' }[p.indicador];
        if (!ind) throw new Error('indicador desconhecido');
        return odata('ExpectativasMercadoAnuais', `Indicador eq '${ind}' and baseCalculo eq 0`,
          '$select=Indicador,Data,DataReferencia,Mediana,baseCalculo');
      }
      case 'focus_selic_reuniao':
        return odata('ExpectativasMercadoSelic', "Indicador eq 'Selic' and baseCalculo eq 0",
          '$select=Indicador,Data,Reuniao,Mediana,baseCalculo');
      case 'brapi_quote': {
        const t = String(p.ticker || '').toUpperCase();
        if (!/^[A-Z0-9]{4,8}$/.test(t)) throw new Error('ticker inválido');
        const tok = String(p.token || '').trim();
        if (!/^[A-Za-z0-9_-]{6,128}$/.test(tok)) throw new Error('token da brapi ausente ou inválido');
        return `https://brapi.dev/api/quote/${t}?token=${encodeURIComponent(tok)}`;
      }
      case 'usd_last':
        return 'https://economia.awesomeapi.com.br/json/last/USD-BRL';
      case 'eurostat_hicp':
        return 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr?format=JSON&lang=EN&geo=PT&coicop=CP00&lastTimePeriod=3';
      case 'tp_dates': {
        const { o, d, dt, tok } = voo(p, true);
        return `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=${o}&destination=${d}&departure_at=${dt}&one_way=true&sorting=price&direct=false&currency=brl&market=br&limit=30&token=${tok}`;
      }
      case 'tp_grouped': {
        const { o, d, tok } = voo({ ...p, date: p.month }, true);
        const mes = String(p.month || '');
        if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('mês inválido');
        return `https://api.travelpayouts.com/aviasales/v3/grouped_prices?origin=${o}&destination=${d}&departure_at=${mes}&group_by=departure_at&currency=brl&market=br&token=${tok}`;
      }
      case 'serp_flights': {
        const { o, d, dt, tok } = voo({ ...p, token: p.key }, true);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) throw new Error('data inválida');
        const ad = Math.min(9, Math.max(1, parseInt(p.adults, 10) || 1));
        const ch = Math.min(8, Math.max(0, parseInt(p.children, 10) || 0));
        return `https://serpapi.com/search.json?engine=google_flights&departure_id=${o}&arrival_id=${d}&outbound_date=${dt}&type=2&currency=BRL&hl=pt&gl=br&adults=${ad}&children=${ch}&api_key=${tok}`;
      }
      case 'ignav_oneway': {
        const { o, d, dt, tok } = voo({ ...p, token: p.key }, true);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) throw new Error('data inválida');
        return { url: 'https://ignav.com/api/fares/one-way', method: 'POST', headers: { 'X-Api-Key': decodeURIComponent(tok), 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: o, destination: d, departure_date: dt }) };
      }
      case 'meteo_forecast':
      case 'meteo_archive': {
        const lat = +p.lat, lon = +p.lon;
        if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new Error('coordenadas inválidas');
        const ini = String(p.start || ''), fim = String(p.end || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) throw new Error('datas inválidas');
        const host = key === 'meteo_archive' ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
        return `${host}?latitude=${lat}&longitude=${lon}&start_date=${ini}&end_date=${fim}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Europe%2FLisbon`;
      }
      case 'ine_rendas': {
        const v = String(p.varcd || '');
        if (!/^\d{7}$/.test(v)) throw new Error('indicador inválido');
        return `https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd=${v}&lang=PT`;
      }
      case 'feriados': {
        const ano = parseInt(p.ano, 10), pais = String(p.pais || '');
        if (!(ano >= 2000 && ano <= 2100) || !/^(PT|BR)$/.test(pais)) throw new Error('parâmetros inválidos');
        return `https://date.nager.at/api/v3/PublicHolidays/${ano}/${pais}`;
      }
      default:
        throw new Error('consulta desconhecida');
    }
  }

  const api = { build, SGS_CODES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MarketURLs = api;
})(typeof window !== 'undefined' ? window : globalThis);
