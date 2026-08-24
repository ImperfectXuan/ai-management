// electron/src/main/rules-args.ts
// IPC RulesSetRequired 入参校验（M6 修复）
// 抽成独立文件是为了让 main 进程之外的测试也能覆盖。
// ipc.ts 顶层有 `app.getPath('userData')` 副作用,直接 import 会 crash,
// 把纯函数单独成文件就绕开了这个加载期副作用。
import { WorkspaceError, ErrorCodes } from '../core/errors';
import { PER_FILE_TOOLS } from '../core/rules';

export interface RulesSetRequiredArgs {
  repoId: string;
  tool: string;
  id: string;
  domain: boolean;
  value: boolean;
}

export function validateRulesSetRequiredArgs(args: unknown): RulesSetRequiredArgs {
  if (!args || typeof args !== 'object') {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, 'RulesSetRequired: args 必须是对象');
  }
  const a = args as Record<string, unknown>;
  if (typeof a.repoId !== 'string' || !a.repoId) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, 'RulesSetRequired: repoId 必填且为非空字符串');
  }
  if (typeof a.id !== 'string' || !a.id) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, 'RulesSetRequired: id 必填且为非空字符串');
  }
  if (typeof a.tool !== 'string' || !PER_FILE_TOOLS.includes(a.tool as any)) {
    throw new WorkspaceError(
      ErrorCodes.UnsupportedTool,
      `RulesSetRequired: tool 必须是 ${PER_FILE_TOOLS.join('/')},收到 ${JSON.stringify(a.tool)}`
    );
  }
  if (typeof a.domain !== 'boolean') {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, 'RulesSetRequired: domain 必填且为 boolean');
  }
  if (typeof a.value !== 'boolean') {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, 'RulesSetRequired: value 必填且为 boolean');
  }
  return a as unknown as RulesSetRequiredArgs;
}
