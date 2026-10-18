import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { registerIpc, recoverSyncStatusOnStartup } from './ipc';
import { createTray } from './tray';

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 740,
    title: 'AI Workspace',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

// 单实例约束（design §5）：避免两个主进程同时改写同一 userData 下的同步状态
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.show(); win.focus(); }
  });

  app.whenReady().then(async () => {
    // 启动先把残留 running 恢复为 interrupted，再开放查询与写入
    await recoverSyncStatusOnStartup();
    registerIpc();
    createTray();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
