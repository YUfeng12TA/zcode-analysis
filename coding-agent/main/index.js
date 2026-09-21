'use strict';
/**
 * Electron 主进程：窗口管理、IPC 桥、Agent 会话调度、设置与会话持久化。
 */
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { AgentSession } = require('./agent');

const SMOKE = process.argv.includes('--smoke-test');

let mainWindow = null;
let activeSession = null;
const sessions = new Map(); // id -> {id, title, createdAt, messages}

function dataFile(name) {
  return path.join(app.getPath('userData'), name);
}

async function loadJSON(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

async function saveJSON(file, data) {
  try { await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8'); } catch {}
}

function broadcast(ev) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agent:event', ev);
  }
}

function createSession(settings) {
  const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const s = { id, title: '新会话', createdAt: new Date().toISOString(), messages: [] };
  sessions.set(id, s);
  activeSession = new AgentSession({
    settings,
    workspace: settings.workspace || app.getPath('home'),
    onEvent: (ev) => broadcast({ sessionId: id, ...ev }),
  });
  activeSession.sessionId = id;
  return id;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'DeskCoder',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function registerIPC() {
  ipcMain.handle('settings:get', async () => {
    const s = await loadJSON(dataFile('settings.json'), {});
    return s;
  });

  ipcMain.handle('settings:set', async (_e, settings) => {
    const clean = {
      baseURL: String(settings?.baseURL || ''),
      apiKey: String(settings?.apiKey || ''),
      model: String(settings?.model || ''),
      temperature: Number(settings?.temperature) || 0.2,
      workspace: String(settings?.workspace || ''),
    };
    await saveJSON(dataFile('settings.json'), clean);
    return { ok: true };
  });

  ipcMain.handle('workspace:pick', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: '选择工作目录' });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });

  ipcMain.handle('sessions:new', async () => {
    const settings = await loadJSON(dataFile('settings.json'), {});
    const id = createSession(settings);
    return { id };
  });

  ipcMain.handle('sessions:list', async () => {
    return [...sessions.values()].map(({ id, title, createdAt }) => ({ id, title, createdAt }));
  });

  ipcMain.handle('sessions:load', async (_e, id) => {
    const s = sessions.get(id);
    if (!s) return { error: '会话不存在' };
    const settings = await loadJSON(dataFile('settings.json'), {});
    activeSession = new AgentSession({
      settings,
      workspace: settings.workspace || app.getPath('home'),
      onEvent: (ev) => broadcast({ sessionId: id, ...ev }),
    });
    activeSession.loadHistory(s.messages);
    activeSession.sessionId = id;
    return { messages: s.messages };
  });

  ipcMain.handle('agent:send', async (_e, text) => {
    if (!activeSession) {
      const settings = await loadJSON(dataFile('settings.json'), {});
      createSession(settings);
    }
    const cur = activeSession;
    const sessionId = cur.sessionId;

    // 记录用户消息到会话
    const s = sessions.get(sessionId);
    if (s) {
      s.messages.push({ role: 'user', content: String(text) });
      s.title = String(text).slice(0, 24) || s.title;
      await saveJSON(dataFile('sessions.json'), [...sessions.values()]);
    }

    broadcast({ sessionId, type: 'user_message', content: String(text) });
    try {
      await cur.run(String(text));
      if (s) {
        s.messages = cur.getMessages().map((m) => {
          const { role, content } = m;
          return { role, content: content || '' };
        });
        await saveJSON(dataFile('sessions.json'), [...sessions.values()]);
      }
      return { ok: true };
    } catch (err) {
      broadcast({ sessionId, type: 'error', message: err.message });
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('agent:abort', async () => {
    if (activeSession) activeSession.abort();
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  // 恢复历史会话
  const saved = await loadJSON(dataFile('sessions.json'), []);
  for (const s of saved) {
    sessions.set(s.id, { id: s.id, title: s.title, createdAt: s.createdAt, messages: s.messages || [] });
  }
  registerIPC();

  if (SMOKE) {
    // 冒烟：不显示窗口，加载 renderer，捕获 console 错误后退出
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    win.webContents.on('console-message', (_e, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')).then(() => {
      setTimeout(() => {
        console.log('SMOKE OK: renderer loaded');
        app.exit(0);
      }, 1500);
    }).catch((err) => {
      console.error('SMOKE FAIL: renderer load error:', err);
      app.exit(1);
    });
    return;
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
