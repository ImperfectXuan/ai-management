// electron/src/core/sync-unit-identity.ts
// 功能 002：单元键的路径身份（design §2.1）。
// realpath 解析软链接别名；目标缺失不回退父目录；搬家/换路径产生新身份，旧记录不迁移。
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ErrorCodes, WorkspaceError } from './errors';
import { SyncModule, SyncScope, SyncTool, SyncUnitKey } from '../shared/sync-status';

export type RootResolution =
  | { ok: true; path: string }
  | { ok: false; reason: 'missing' | 'not_directory' };

/** 语法层校验：绝对路径且已规范化；realpath 归属本模块的解析函数，不在此做。 */
export function assertSyntacticPath(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `${field} 必须是规范绝对路径：${String(value)}`);
  }
}

/**
 * 解析目录身份：symlink 与真实路径归并为同一 realpath。
 * 不存在或非目录返回 missing/not_directory，绝不回退到父目录（目标移走即不可读取）。
 */
export async function resolveRootPath(input: string): Promise<RootResolution> {
  assertSyntacticPath(input, '目录路径');
  try {
    const stats = await fs.stat(input);
    if (!stats.isDirectory()) return { ok: false, reason: 'not_directory' };
    return { ok: true, path: await fs.realpath(input) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, reason: 'missing' };
    throw error;
  }
}

/**
 * 单个输出路径：尚不存在时以最近的真实父目录加规范化后缀解析（design §2.1）。
 * 父链必须落到目录——中间是文件的路径继续向上找最近目录。
 */
async function resolveOutputPath(input: string): Promise<string> {
  assertSyntacticPath(input, '输出路径');
  const suffix: string[] = [];
  let current = input;
  for (;;) {
    try {
      const real = await fs.realpath(current);
      if (suffix.length === 0) return real;
      const stats = await fs.stat(real);
      if (stats.isDirectory()) return path.join(real, ...suffix.reverse());
      // 祖先是文件：它不可能承载子路径，继续向上找最近的真实目录。
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    }
    suffix.push(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, `输出路径无可用的真实父目录：${input}`);
    }
    current = parent;
  }
}

/** 解析全部输出路径并去重排序；别名与真实路径归并为同一输出键。 */
export async function resolveOutputKeys(inputs: readonly string[]): Promise<string[]> {
  const resolved = await Promise.all(inputs.map((item) => resolveOutputPath(item)));
  return [...new Set(resolved)].sort();
}

export type UnitKeyFailure = 'library_missing' | 'target_missing';

export interface UnitKeyInput {
  libraryPath: string;
  /** project scope 必填；global 忽略此项（global 目标不含项目维度）。 */
  projectPath?: string;
  tool: SyncTool;
  module: SyncModule;
  scope: SyncScope;
}

export type UnitKeyResolution =
  | { ok: true; key: SyncUnitKey }
  | { ok: false; reason: UnitKeyFailure };

/**
 * 从已选内容库与已登记项目解析规范单元键（design §2.1、§6）：
 * project 的 targetRoot 为项目真实路径；global 的 targetRoot 为 $HOME（本机用户配置根），
 * 同一用户在任何项目查看 global 都得到同一记录键。
 */
export async function resolveUnitKey(input: UnitKeyInput): Promise<UnitKeyResolution> {
  const library = await resolveRootPath(input.libraryPath);
  if (!library.ok) return { ok: false, reason: 'library_missing' };

  let target: string;
  if (input.scope === 'project') {
    if (!input.projectPath) return { ok: false, reason: 'target_missing' };
    const project = await resolveRootPath(input.projectPath);
    if (!project.ok) return { ok: false, reason: 'target_missing' };
    target = project.path;
  } else {
    const home = process.env.HOME;
    if (!home) {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, '未设置 HOME，无法解析 global 分发目标');
    }
    const resolved = await resolveRootPath(home);
    if (!resolved.ok) {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, `HOME 不可作为 global 分发目标：${home}`);
    }
    target = resolved.path;
  }

  return {
    ok: true,
    key: {
      libraryRoot: library.path,
      targetRoot: target,
      tool: input.tool,
      module: input.module,
      scope: input.scope,
    },
  };
}
