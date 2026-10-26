const { contextBridge, ipcRenderer } = require('electron');

// Pontes com o sistema: internet (só endereços de urls.js), PDF, backup e assistente.
contextBridge.exposeInMainWorld('net', {
  get: (key, params) => ipcRenderer.invoke('net:get', key, params || {}),
  pdf: (nome) => ipcRenderer.invoke('pdf:save', nome),
  backup: {
    info: () => ipcRenderer.invoke('backup:info'),
    choose: () => ipcRenderer.invoke('backup:choose'),
    write: (json) => ipcRenderer.invoke('backup:write', json),
  },
  // Google Drive: sincronização, atualização e resumo para o celular
  sync: {
    info: () => ipcRenderer.invoke('sync:info'),
    escolher: () => ipcRenderer.invoke('sync:escolher'),
    usarSugestao: (dir) => ipcRenderer.invoke('sync:usarSugestao', dir),
    desligar: () => ipcRenderer.invoke('sync:desligar'),
    ler: () => ipcRenderer.invoke('sync:ler'),
    mtime: () => ipcRenderer.invoke('sync:mtime'),
    gravar: (json) => ipcRenderer.invoke('sync:gravar', json),
    conflitoResolvido: (nome) => ipcRenderer.invoke('sync:conflitoResolvido', nome),
    pdf: () => ipcRenderer.invoke('sync:pdf'),
  },
  update: {
    verificar: () => ipcRenderer.invoke('update:verificar'),
    aplicar: () => ipcRenderer.invoke('update:aplicar'),
    publicar: (notas) => ipcRenderer.invoke('update:publicar', notas),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    mostrar: () => ipcRenderer.invoke('app:mostrar'),
    segundoPlano: (c) => ipcRenderer.invoke('bg:config', c),
    notificar: (n) => ipcRenderer.invoke('bg:notificar', n),
    aoVerificar: (f) => ipcRenderer.on('bg:verificar', () => f()),
    aoAbrir: (f) => ipcRenderer.on('bg:abrir', (_e, aba) => f(aba)),
  },
  // Assistente: a página manda a conversa; a chave fica no processo principal.
  ia: {
    setKey: (k) => ipcRenderer.invoke('ia:setKey', k),
    status: () => ipcRenderer.invoke('ia:status'),
    clearKey: () => ipcRenderer.invoke('ia:clear'),
    models: () => ipcRenderer.invoke('ia:models'),
    chat: (req) => ipcRenderer.invoke('ia:chat', req),
    transcrever: (audio, mime, modelo) => ipcRenderer.invoke('ia:transcrever', audio, mime, modelo),
  },
});
