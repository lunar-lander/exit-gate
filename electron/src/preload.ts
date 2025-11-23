import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  // Daemon communication
  sendToDaemon: (message: any) => ipcRenderer.invoke('send-to-daemon', message),
  onDaemonMessage: (callback: (message: any) => void) => {
    ipcRenderer.on('daemon-message', (_event, message) => callback(message));
  },

  // Rule management
  getRules: () => ipcRenderer.invoke('get-rules'),
  addRule: (rule: any) => ipcRenderer.invoke('add-rule', rule),
  updateRule: (rule: any) => ipcRenderer.invoke('update-rule', rule),
  deleteRule: (ruleId: number) => ipcRenderer.invoke('delete-rule', ruleId),

  // History and stats
  getHistory: (limit: number) => ipcRenderer.invoke('get-history', limit),
  getHistorySince: (timestamp: string) => ipcRenderer.invoke('get-history-since', timestamp),
  getStats: () => ipcRenderer.invoke('get-stats'),

  // Prompt responses
  respondToPrompt: (promptId: string, action: string, remember: boolean, duration: string) =>
    ipcRenderer.invoke('respond-to-prompt', promptId, action, remember, duration),
});
