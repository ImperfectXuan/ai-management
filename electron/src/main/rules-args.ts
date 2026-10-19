// electron/src/main/rules-args.ts
// IPC RulesSetRequired 入参校验（M6 修复）
// 抽成独立文件是为了让 main 进程之外的测试也能覆盖。
// ipc.ts 顶层有 `app.getPath('userData')` 副作用,直接 import 会 crash,
// 把纯函数单独成文件就绕开了这个加载期副作用。
import { WorkspaceError, ErrorCodes } from '../core/errors';
import { PER_FILE_TOOLS, type SaveRuleInput } from '../core/rules';
import { SUPPORTED_TOOLS, type SupportedTool } from '../shared/tools';

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

function requireObject(value: unknown, channel: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `${channel}: args 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, channel: string, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new WorkspaceError(
      ErrorCodes.InvalidArgument,
      `${channel}: ${field} 必填且为${allowEmpty ? '' : '非空'}字符串`
    );
  }
  return value;
}

function requireBoolean(value: unknown, channel: string, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `${channel}: ${field} 必填且为 boolean`);
  }
  return value;
}

function requireStringArray(value: unknown, channel: string, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `${channel}: ${field} 必须是字符串数组`);
  }
  return value as string[];
}

export interface RulesGetArgs {
  id: string;
  domain: boolean;
}

export function validateRulesGetArgs(args: unknown): RulesGetArgs {
  const a = requireObject(args, 'RulesGet');
  return {
    id: requireString(a.id, 'RulesGet', 'id'),
    domain: requireBoolean(a.domain, 'RulesGet', 'domain'),
  };
}

/** 校验 IPC 入参形状；字段取值语义由 core saveRule 负责。 */
export function validateRulesSaveArgs(args: unknown): SaveRuleInput {
  const a = requireObject(args, 'RulesSave');
  const fields = requireObject(a.fields, 'RulesSave');
  requireStringArray(fields.globs, 'RulesSave', 'fields.globs');
  const tools = requireStringArray(fields.tools, 'RulesSave', 'fields.tools');
  for (const tool of tools) {
    if (!SUPPORTED_TOOLS.includes(tool as SupportedTool)) {
      throw new WorkspaceError(ErrorCodes.UnsupportedTool, `RulesSave: fields.tools 含不支持的工具 ${JSON.stringify(tool)}`);
    }
  }
  return {
    id: requireString(a.id, 'RulesSave', 'id'),
    domain: requireBoolean(a.domain, 'RulesSave', 'domain'),
    expectedVersion: requireString(a.expectedVersion, 'RulesSave', 'expectedVersion'),
    body: requireString(a.body, 'RulesSave', 'body', true),
    fields: {
      title: requireString(fields.title, 'RulesSave', 'fields.title'),
      description: requireString(fields.description, 'RulesSave', 'fields.description', true),
      scope: requireString(fields.scope, 'RulesSave', 'fields.scope'),
      globs: fields.globs as string[],
      tools: tools as SupportedTool[],
    },
  };
}
