// electron/src/core/links.ts
// 与 CLI platform.sh 对齐的跨平台目录链接层：
// macOS/Linux → symlink；Windows → 优先 junction（免管理员权限），失败回退 copy。
// 管理边界语义与 platform.sh 一致：非 AIWS 管理的同名目标一律改名备份，绝不静默删除。
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type LinkState = 'managed' | 'conflict' | 'missing';

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

async function realpathOrNull(p: string): Promise<string | null> {
  return fs.realpath(p).catch(() => null);
}

export async function nextBackupPath(target: string): Promise<string> {
  let backupPath = `${target}.bak`;
  if (!(await exists(backupPath))) return backupPath;
  backupPath = `${target}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
  return backupPath;
}

export async function backupExistingPath(target: string): Promise<void> {
  const backupPath = await nextBackupPath(target);
  await fs.rename(target, backupPath);
}

// 管理判定：目标经 symlink/junction 解析后的真实路径与 source 一致
export async function isManagedLinkTarget(target: string, source: string): Promise<boolean> {
  if (!(await exists(target))) return false;
  const [targetReal, sourceReal] = await Promise.all([realpathOrNull(target), realpathOrNull(source)]);
  return targetReal !== null && targetReal === sourceReal;
}

// 三态判定：
// - missing  目标不存在
// - managed  链接真实指向 workspace 技能源目录
// - conflict 目标存在但不受 AIWS 管理（如用户手工放置的同名目录）
export async function classifyLinkState(target: string, source: string): Promise<LinkState> {
  if (!(await exists(target))) return 'missing';
  return (await isManagedLinkTarget(target, source)) ? 'managed' : 'conflict';
}

// 复写目标前的准备：受管理目标先移除；非管理同名路径改名 .bak 备份（绝不静默删除）
export async function prepareDirLinkTarget(source: string, target: string): Promise<void> {
  if (!(await exists(target))) return;
  if (await isManagedLinkTarget(target, source)) {
    await removeDirLink(target);
    return;
  }
  await backupExistingPath(target);
}

export type DirLinkKind = 'symlink' | 'junction' | 'copy';

// 策略与 CLI get_link_type() 对齐：posix 用 symlink；Windows 优先 junction（免特权）；
// 两者失败均回退 copy，并输出告警避免静默降级难排查。
export async function createDirLink(source: string, target: string): Promise<DirLinkKind> {
  await fs.mkdir(path.dirname(target), { recursive: true });

  try {
    if (process.platform === 'win32') {
      await fs.symlink(source, target, 'junction');
      return 'junction';
    }
    await fs.symlink(source, target, 'dir');
    return 'symlink';
  } catch (err) {
    console.warn(`[links] link creation failed, falling back to copy: ${(err as Error).message}`);
  }

  await fs.cp(source, target, { recursive: true });
  return 'copy';
}

// 仅移除链接本体：symlink/junction 走 unlink；受管理 copy 回退递归删除。不动 source 目录
export async function removeDirLink(target: string): Promise<void> {
  if (!(await exists(target))) return;
  const stat = await fs.lstat(target).catch(() => null);
  if (stat?.isSymbolicLink()) {
    await fs.unlink(target);
    return;
  }
  await fs.rm(target, { recursive: true, force: true });
}
