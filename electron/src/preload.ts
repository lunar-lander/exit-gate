import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  // Daemon communication
  sendToDaemon: (message: any) => ipcRenderer.invoke('send-to-daemon', message),
  onDaemonMessage: (callback: (message: any) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: any) => callback(message);
    ipcRenderer.on('daemon-message', listener);
    // Return a cleanup function so callers can remove the listener
    return () => ipcRenderer.removeListener('daemon-message', listener);
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

  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  setDefaultAction: (action: string) => ipcRenderer.invoke('set-default-action', action),
});
