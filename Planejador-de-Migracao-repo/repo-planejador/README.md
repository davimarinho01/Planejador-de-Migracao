# Planejador de Migração

App desktop (Electron) para planejar a mudança do Brasil para Portugal: rendas, investimentos, despesas,
impostos (IRS, IRS Jovem e IFICI), vistos e nacionalidade, viagem, vagas, cidades, risco do câmbio e um
assistente com IA (Vasco, na Groq). O plano pode ser usado a dois pela pasta do Google Drive.

O app roda sem servidor: os dados ficam no computador (e, se ligado, numa pasta do Google Drive),
as chaves de API ficam criptografadas pelo Windows e nunca vão para o Drive nem para exportações.

## Estrutura

```
app/
  main.js          processo principal: janela, APIs, Groq, PDF, backup, Google Drive, atualização, bandeja e avisos
  preload.js       ponte mínima entre a página e o processo principal (window.net)
  urls.js          lista dos endereços de API permitidos
  index.html       layout e abas; styles.css tema claro/escuro e CSS do relatório
  data.js          valores iniciais, cidades, tabelas do IRS, migração de versões
  engine.js        motor de cálculo: família, cidade, IRS (com IFICI), simulação mês a mês
  app.js           estado, navegação, painel, rendas, investimentos, despesas, cenários
  views.js         linha do tempo, família, cidades, impostos, checklist (.ics), acompanhamento, relatório, backup
  market.js        Mercado: euro, juros, Focus, inflação, cotações, compras e plano de compra de euros
  vistos.js        Vistos; ascendencia.js árvore até o antepassado português e caminho da nacionalidade
  viagem.js        Viagem: passagens, bagagem, trajeto, clima, feriados
  vagas.js         Vagas em Portugal simuladas no plano, com IFICI e visto
  assistente.js    Vasco: conversa, ferramentas, limite da Groq, documentos (pdf.js + visão), voz (Whisper)
  vasco.js         aba Vasco: resumo da semana, regras vigiadas, diário de decisões, documentos
  ine.js           aluguéis do INE por concelho; risco.js mil caminhos do euro
  sistema.js       Google Drive (mescla de três vias), atualização pela pasta, PDF para o celular, avisos, diagnóstico
  vendor/          Chart.js 4.4.1 (MIT) e pdf.js 3.11.174 (Apache 2.0)
tests/             testes automáticos (veja abaixo)
tools/seticon.py   troca o ícone do .exe sem precisar de Wine
```

## Rodar em modo desenvolvimento

```bash
cd app
npm init -y && npm i -D electron@39
npx electron .
```

Também dá para abrir `app/index.html` no navegador: tudo funciona, exceto o que depende do processo
principal (Groq, Google Drive, PDF, avisos).

## Testes

```bash
node --test tests/main.test.js              # processo principal, com Electron simulado
pip install playwright && python -m playwright install chromium
cd tests && python -m unittest discover -v  # interface no Chromium, com APIs, Groq e Drive simulados
```

Os testes de interface simulam `window.net` (arquivos em `tests/mocks/`): APIs de mercado e voos,
a Groq com o limite de 8 mil tokens por minuto, e dois computadores dividindo o mesmo arquivo do Drive.
Rodam sozinhos a cada push pelo GitHub Actions (`.github/workflows/testes.yml`).

## Gerar o .exe

1. Baixe `electron-v39.x-win32-x64.zip` em github.com/electron/electron/releases e extraia.
2. Renomeie `electron.exe` para `Planejador Viseu.exe` e apague `resources/default_app.asar`.
3. Copie a pasta `app` para `resources/app`.
4. (Opcional) `python tools/seticon.py "Planejador Viseu.exe" app/icon.png`.

Com Node no Windows, `npx electron-builder --win portable` também funciona.

## Atualizar os dois computadores

Depois de instalar uma versão nova num computador, use **Sistema › Publicar esta versão no Drive**.
O app copia `resources/app` para `Planejador Viseu/atualizacao/app`; o outro computador compara a versão
ao abrir e, se você confirmar, atualiza (guardando a anterior em `resources/app-anterior`).

## Onde ficam os dados

`%APPDATA%\Planejador Viseu`: o plano (localStorage do Electron), a chave da Groq criptografada (`ia.key`)
e as configurações de backup, Drive e segundo plano.
