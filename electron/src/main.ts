import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import * as net from 'net';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;
let daemonSocket: net.Socket | null = null;

const SOCKET_PATH = '/var/run/exit-gate/exit-gate.sock';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../public/icon.png'),
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function connectToDaemon() {
  daemonSocket = new net.Socket();

  daemonSocket.connect(SOCKET_PATH, () => {
    console.log('Connected to daemon');
    sendToDaemon({ type: 'GetRules' });
    sendToDaemon({ type: 'GetStats' });
  });

  let buffer = '';
  daemonSocket.on('data', (data) => {
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

  daemonSocket.on('error', (err) => {
    console.error('Daemon socket error:', err);
    setTimeout(connectToDaemon, 5000); // Retry connection
  });

  daemonSocket.on('close', () => {
    console.log('Disconnected from daemon');
    setTimeout(connectToDaemon, 5000); // Retry connection
  });
}

function sendToDaemon(message: any) {
  if (daemonSocket && daemonSocket.writable) {
    daemonSocket.write(JSON.stringify(message) + '\n');
  } else {
    console.error('Daemon socket not connected');
  }
}

function handleDaemonMessage(message: any) {
  console.log('Received from daemon:', message);

  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('daemon-message', message);
  }

  // Handle connection prompts
  if (message.type === 'ConnectionPrompt') {
    showConnectionPrompt(message);
  }
}

function showConnectionPrompt(data: any) {
  // Create notification
  const notification = new Notification({
    title: 'Exit Gate - Connection Request',
    body: `${data.executable} wants to connect to ${data.dest_host || data.dest_ip}:${data.dest_port}`,
    urgency: 'critical',
  });

  notification.show();

  // Focus main window or create prompt window
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
  if (daemonSocket) {
    daemonSocket.destroy();
  }
});
