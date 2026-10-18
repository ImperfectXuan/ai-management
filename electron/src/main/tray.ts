// electron/src/main/tray.ts
import { Tray, Menu, app, nativeImage, Notification, BrowserWindow } from 'electron';
import path from 'node:path';
import { runFullSyncAll } from './ipc';

export function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'build', 'tray.png'))
    .resize({ width: 16, height: 16 });
  const tray = new Tray(icon);
  tray.setToolTip('AI Workspace');

  const showWindow = () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { win.show(); win.focus(); }
  };

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示窗口', click: showWindow },
    {
      label: '快速同步全部',
      click: async () => {
        try {
          // 托盘与主窗口共用唯一执行路径（经 sync-service），不再各自调 CLI
          const { done } = await runFullSyncAll();
          new Notification({ title: 'AI Workspace', body: `已同步 ${done} 个仓库` }).show();
        } catch (error) {
          console.error('[tray:sync]', error);
          new Notification({ title: '同步失败', body: error instanceof Error ? error.message : '请检查内容库和目标项目' }).show();
        }
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
  return tray;
}
