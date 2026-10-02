import { app, BrowserWindow, dialog, ipcMain, Notification } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;
let daemonSocket: net.Socket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let daemonStatus: 'connected' | 'disconnected' = 'disconnected';
let installOffered = false;

const SOCKET_PATH = '/var/run/exit-gate/exit-gate.sock';
const RECONNECT_INTERVAL_MS = 5000;

function getResourceDir(): string {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
}

function setDaemonStatus(status: 'connected' | 'disconnected') {
  daemonStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('daemon-status', status);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'logo.png'),
  });

  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return; // never stack retry loops
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToDaemon();
  }, RECONNECT_INTERVAL_MS);
}

function destroySocket() {
  if (daemonSocket) {
    daemonSocket.removeAllListeners();
    daemonSocket.destroy();
    daemonSocket = null;
  }
}

function connectToDaemon() {
  destroySocket();
  const socket = new net.Socket();
  daemonSocket = socket;

  socket.connect(SOCKET_PATH, () => {
    console.log('Connected to daemon');
    setDaemonStatus('connected');
    installOffered = false;
    sendToDaemon({ type: 'GetRules' });
    sendToDaemon({ type: 'GetStats' });
    sendToDaemon({ type: 'GetConfig' });
  });

  let buffer = '';
  socket.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          handleDaemonMessage(message);
        } catch (e) {
          console.error('Failed to parse daemon message:', e);
        }
      }
    }
  });

  socket.on('error', (err) => {
    console.error('Daemon socket error:', err.message);
  });

  // 'close' always fires after 'error' — the single reconnect path
  socket.on('close', () => {
    console.log('Disconnected from daemon');
    setDaemonStatus('disconnected');
    if (app.isPackaged) {
      maybeOfferDaemonInstall();
    }
    scheduleReconnect();
  });
}

/**
 * AppImage / tar users get a one-shot offer to install and start the
 * bundled daemon with polkit privileges when the daemon is unreachable.
 */
function maybeOfferDaemonInstall() {
  if (installOffered || daemonStatus === 'connected') return;
  const installScript = path.join(getResourceDir(), 'daemon', 'install-daemon.sh');
  if (!fs.existsSync(installScript)) return;

  installOffered = true;
  dialog
    .showMessageBox({
      type: 'question',
      title: 'Exit Gate daemon not running',
      message: 'The Exit Gate daemon is not running.',
      detail:
        'Install and start it now? This copies the daemon, eBPF monitors and ' +
        'systemd service to the system and starts the service. Your password ' +
        'will be requested.',
      buttons: ['Install and start', 'Retry quietly'],
      defaultId: 0,
      cancelId: 1,
    })
    .then(({ response }) => {
      if (response !== 0) return;
      const child = spawn('pkexec', ['bash', installScript], { stdio: 'ignore' });
      child.on('error', (err) => {
        console.error('Failed to launch installer:', err.message);
        installOffered = false;
      });
      child.on('exit', (code) => {
        if (code !== 0) installOffered = false; // allow a retry later
      });
    })
    .catch(() => {});
}

function sendToDaemon(message: unknown) {
  if (daemonSocket && daemonSocket.writable) {
    daemonSocket.write(JSON.stringify(message) + '\n');
  } else {
    console.error('Daemon socket not connected');
  }
}

function handleDaemonMessage(message: any) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('daemon-message', message);
  }

  if (message.type === 'ConnectionPrompt') {
    showConnectionPrompt(message);
  }
}

function showConnectionPrompt(data: any) {
  const notification = new Notification({
    title: 'Exit Gate - Connection Request',
    body: `${data.executable} wants to connect to ${data.dest_host || data.dest_ip}:${data.dest_port}`,
    urgency: 'critical' as any,
  });

  notification.show();

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

// IPC handlers
ipcMain.handle('send-to-daemon', async (_event, message) => {
  sendToDaemon(message);
  return { success: true };
});

ipcMain.handle('get-daemon-status', async () => daemonStatus);

ipcMain.handle('install-daemon', async () => {
  const installScript = path.join(getResourceDir(), 'daemon', 'install-daemon.sh');
  return new Promise((resolve) => {
    const child = spawn('pkexec', ['bash', installScript], { stdio: 'ignore' });
    child.on('error', (err) => resolve({ success: false, error: err.message }));
    child.on('exit', (code) =>
      resolve({ success: code === 0, code })
    );
  });
});

ipcMain.handle('get-rules', async () => {
  sendToDaemon({ type: 'GetRules' });
});

ipcMain.handle('add-rule', async (_event, rule) => {
  sendToDaemon({ type: 'AddRule', rule });
});

ipcMain.handle('update-rule', async (_event, rule) => {
  sendToDaemon({ type: 'UpdateRule', rule });
});

ipcMain.handle('delete-rule', async (_event, ruleId) => {
  sendToDaemon({ type: 'DeleteRule', rule_id: ruleId });
});

ipcMain.handle('get-history', async (_event, limit) => {
  sendToDaemon({ type: 'GetHistory', limit: limit || 100 });
});

ipcMain.handle('get-history-since', async (_event, timestamp) => {
  sendToDaemon({ type: 'GetHistorySince', timestamp });
});

ipcMain.handle('get-stats', async () => {
  sendToDaemon({ type: 'GetStats' });
});

ipcMain.handle('respond-to-prompt', async (_event, promptId, action, remember, duration) => {
  sendToDaemon({
    type: 'RespondToPrompt',
    prompt_id: promptId,
    action,
    remember,
    duration,
  });
});

ipcMain.handle('get-config', async () => {
  sendToDaemon({ type: 'GetConfig' });
});

ipcMain.handle('set-default-action', async (_event, action) => {
  sendToDaemon({ type: 'SetDefaultAction', action });
});

app.whenReady().then(() => {
  createWindow();
  connectToDaemon();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  destroySocket();
});
