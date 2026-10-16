// electron/src/core/sync-inputs.ts
// 功能 002 TASK-002-02：CLI 输入描述契约的消费端（design §3）。
// describeSyncInputs 只读调用 `aiws sync --describe-inputs`；loadDescriptorInputs 读取
// 被描述的文件并计算摘要（含读取期间变化检测）；computeUnitFingerprints 组装 HMAC 载荷。
// 查询不创建密钥、不解密 vault；坏 JSON 与不稳定读取显式失败，绝不静默降级为空对象。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ErrorCodes, WorkspaceError } from './errors';
import {
  SyncModule,
  SyncScope,
  SyncTool,
} from '../shared/sync-status';
import {
  SkillsDistributionPlan,
  SkillsLinkStrategy,
  computeEffectiveOutputFingerprint,
  computeSourceFingerprint,
} from './sync-fingerprint';

const DESCRIBE_TIMEOUT_MS = 60_000;

export interface SyncInputEntry {
  path: string;
  type: string;
  selector?: string | null;
}

export interface SkillsPlanEntryFull {
  relativePath: string;
  targetPath: string;
  sourcePath: string;
  sourceVersion: string;
  strategy: SkillsLinkStrategy;
  manifest: string[];
}

export interface SyncSkillsPlan {
  outputKeys: string[];
  entries: SkillsPlanEntryFull[];
  behavior: Record<string, unknown>;
}

export interface SyncMcpDescriptor {
  main: string;
  override?: string | null;
  overrideOrder: string[];
  servers: string[];
}

export interface SyncInputsDescriptor {
  schemaVersion: 1;
  unit: { tool: SyncTool; module: SyncModule; scope: SyncScope };
  executable: boolean;
  reasonCode?: string | null;
  inputs: SyncInputEntry[];
  deps: string[];
  /** 本次分发的物理输出路径（写入锁与 Store 记录的 outputKeys 来源）；不可执行时为空。 */
  outputKeys: string[];
  mcp?: SyncMcpDescriptor;
  skillsPlan?: SyncSkillsPlan;
}

export interface DescribeSyncInputsOptions {
  libraryRoot: string;
  targetRoot: string;
  tool: SyncTool;
  module: SyncModule;
  scope: SyncScope;
  /** 缺省为 <libraryRoot>/.ai-workspace/scripts/aiws */
  cliPath?: string;
  signal?: AbortSignal;
}

function invalid(message: string): WorkspaceError {
  return new WorkspaceError(ErrorCodes.InvalidArgument, message);
}

function syncFailed(message: string): WorkspaceError {
  return new WorkspaceError(ErrorCodes.SyncFailed, message);
}

/** 描述路径必须是库内相对路径：拒绝绝对路径、`..` 与非规范化写法。 */
function resolveWithin(base: string, relative: string, field: string): string {
  if (typeof relative !== 'string' || relative.length === 0 || path.isAbsolute(relative)) {
    throw invalid(`${field} 必须是相对路径：${String(relative)}`);
  }
  if (path.normalize(relative) !== relative || relative.split(path.sep).includes('..')) {
    throw invalid(`${field} 含非法路径段：${relative}`);
  }
  return path.join(base, relative);
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw syncFailed(`描述字段无效：${field}`);
  }
  return value as string[];
}

/** 校验 CLI 描述输出；结构不符按失败处理，不猜测补默认值。 */
export function validateDescriptor(raw: unknown, expected?: { tool: SyncTool; module: SyncModule; scope: SyncScope }): SyncInputsDescriptor {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw syncFailed('describe-inputs 输出不是对象');
  }
  const doc = raw as Record<string, unknown>;
  if (doc.schemaVersion !== 1) throw syncFailed(`不支持的 describe-inputs schema：${String(doc.schemaVersion)}`);
  const unit = doc.unit as Record<string, unknown> | undefined;
  if (
    !unit || typeof unit.tool !== 'string' || typeof unit.module !== 'string' || typeof unit.scope !== 'string' ||
    !['codex', 'claude', 'cursor', 'trae'].includes(unit.tool) ||
    !['rules', 'skills', 'mcp'].includes(unit.module) ||
    !['project', 'global'].includes(unit.scope)
  ) {
    throw syncFailed('describe-inputs 单元身份无效');
  }
  if (expected && (unit.tool !== expected.tool || unit.module !== expected.module || unit.scope !== expected.scope)) {
    throw syncFailed('describe-inputs 返回的单元身份与请求不匹配');
  }
  if (typeof doc.executable !== 'boolean') throw syncFailed('describe-inputs 缺少 executable');
  const inputs = doc.inputs;
  if (!Array.isArray(inputs)) throw syncFailed('describe-inputs 缺少 inputs');
  for (const entry of inputs as Array<Record<string, unknown>>) {
    if (typeof entry !== 'object' || entry === null || typeof entry.path !== 'string' || typeof entry.type !== 'string') {
      throw syncFailed('describe-inputs 输入条目无效');
    }
  }
  requireStringArray(doc.deps, 'deps');
  requireStringArray(doc.outputKeys, 'outputKeys');
  return doc as unknown as SyncInputsDescriptor;
}

/** 只读调用 CLI 描述器；退出非零或 stdout 非合法 JSON 均显式失败。 */
export async function describeSyncInputs(opts: DescribeSyncInputsOptions): Promise<SyncInputsDescriptor> {
  const cli = opts.cliPath ?? path.join(opts.libraryRoot, '.ai-workspace/scripts/aiws');
  const aiwsDir = path.join(opts.libraryRoot, '.ai-workspace');
  const args = [
    'sync', '--describe-inputs',
    '--tool', opts.tool, '--only', opts.module, '--scope', opts.scope,
  ];
  if (opts.signal?.aborted) throw new WorkspaceError(ErrorCodes.SyncCancelled, '输入描述已取消');

  const child = spawn(cli, args, {
    cwd: opts.targetRoot,
    env: {
      ...process.env,
      AIWS_ROOT: opts.targetRoot,
      AIWS_SOURCE_DIR: aiwsDir,
      AIWS_RUNTIME_DIR: path.dirname(cli),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });

  const result = await new Promise<{ code: number | null; timedOut: boolean }>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, timedOut: true });
    }, DESCRIBE_TIMEOUT_MS);
    const onAbort = () => { child.kill('SIGKILL'); };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ code, timedOut: false });
    });
  });

  if (opts.signal?.aborted) throw new WorkspaceError(ErrorCodes.SyncCancelled, '输入描述已取消');
  if (result.timedOut) throw syncFailed('describe-inputs 超时');
  if (result.code !== 0) {
    throw syncFailed(`describe-inputs 失败（退出码 ${result.code ?? '未知'}）：${stderr.trim().split('\n').slice(-3).join(' | ')}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw syncFailed('describe-inputs 输出不是有效 JSON');
  }
  return validateDescriptor(parsed, { tool: opts.tool, module: opts.module, scope: opts.scope });
}

export interface StableReadResult {
  content: Buffer;
  sha256: string;
  executable: boolean;
}

export interface StableReadHooks {
  stat?: (file: string) => Promise<{ size: number; mtimeMs: number; mode: number }>;
  read?: (file: string) => Promise<Buffer>;
}

/**
 * 稳定读取：读取前后各 stat 一次，size/mtime 变化即失败（design §3.4）。
 * hooks 仅用于测试注入读取期间变化；生产路径不传。
 */
export async function readStableFile(file: string, hooks?: StableReadHooks): Promise<StableReadResult> {
  const stat = hooks?.stat ?? (async (target: string) => {
    const s = await fs.stat(target);
    return { size: s.size, mtimeMs: s.mtimeMs, mode: s.mode };
  });
  const read = hooks?.read ?? (async (target: string) => fs.readFile(target));
  const before = await stat(file);
  const content = await read(file);
  const after = await stat(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw syncFailed(`文件在读取期间发生变化：${file}；请重试同步`);
  }
  return {
    content,
    sha256: createHash('sha256').update(content).digest('hex'),
    executable: (after.mode & 0o111) !== 0,
  };
}

export interface LoadDescriptorOptions {
  /** 内容库根；inputs 相对 <aiwsDir> 解析，aiwsDir 默认 <libraryRoot>/.ai-workspace */
  libraryRoot: string;
  /** CLI 运行时脚本目录；deps 相对它解析 */
  scriptsDir: string;
  /** 追加依赖（如 Desktop 侧 links.ts）；绝对路径，参与 generatorDeps */
  extraDepFiles?: string[];
}

export interface LoadedFileInput {
  path: string;
  type: string;
  sha256: string;
  executable: boolean;
  /** JSON 类型输入的解析结构（design §3.1：按解析后结构计算；坏 JSON 保持 undefined 回退字节哈希）。 */
  parsedJson?: unknown;
}

export interface LoadedDescriptorInputs {
  files: LoadedFileInput[];
  deps: Array<{ path: string; sha256: string }>;
  /** MCP：主/覆盖按 CLI 相同语义合并、按键投影后的 servers 结构 */
  mcpServers?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 复刻 jq `*` 合并语义：对象递归、数组/标量整体替换。 */
export function mergeServerObjects(base: unknown, override: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
      out[key] = key in base ? mergeServerObjects(base[key], value) : value;
    }
    return out;
  }
  return override;
}

async function parseJsonBuffer(content: Buffer, label: string): Promise<unknown> {
  try {
    return JSON.parse(content.toString('utf8'));
  } catch {
    throw syncFailed(`${label} 不是有效 JSON；来源可能在描述后被修改，请重试`);
  }
}

/** 读取描述中列出的文件与依赖；MCP 额外做合并与按键投影。skills 内容已在 CLI 清单中摘要。 */
export async function loadDescriptorInputs(
  descriptor: SyncInputsDescriptor,
  opts: LoadDescriptorOptions,
): Promise<LoadedDescriptorInputs> {
  const aiwsDir = path.join(opts.libraryRoot, '.ai-workspace');
  const files: LoadedDescriptorInputs['files'] = [];
  const contents = new Map<string, Buffer>();

  for (const entry of descriptor.inputs) {
    const file = resolveWithin(aiwsDir, entry.path, 'inputs[].path');
    const read = await readStableFile(file);
    contents.set(entry.path, read.content);
    const loadedFile: LoadedFileInput = {
      path: entry.path, type: entry.type, sha256: read.sha256, executable: read.executable,
    };
    if (entry.type === 'workspace_config') {
      try {
        loadedFile.parsedJson = JSON.parse(read.content.toString('utf8'));
      } catch {
        // workspace.json 对 CLI 是宽松输入；坏 JSON 回退字节哈希（保守失效），不降级为空对象。
      }
    }
    files.push(loadedFile);
  }
  files.sort((a, b) => (a.path === b.path ? a.type.localeCompare(b.type) : a.path.localeCompare(b.path)));

  const deps: LoadedDescriptorInputs['deps'] = [];
  for (const rel of descriptor.deps) {
    const file = resolveWithin(opts.scriptsDir, rel, 'deps[]');
    const read = await readStableFile(file);
    deps.push({ path: rel, sha256: read.sha256 });
  }
  for (const extra of opts.extraDepFiles ?? []) {
    const read = await readStableFile(extra);
    deps.push({ path: extra, sha256: read.sha256 });
  }
  deps.sort((a, b) => a.path.localeCompare(b.path));

  let mcpServers: unknown;
  if (descriptor.mcp) {
    const mainRaw = await parseJsonBuffer(contents.get(descriptor.mcp.main) ?? Buffer.alloc(0), `MCP 主配置 ${descriptor.mcp.main}`);
    let merged: unknown = mainRaw;
    if (descriptor.mcp.override) {
      const overrideRaw = await parseJsonBuffer(
        contents.get(descriptor.mcp.override) ?? Buffer.alloc(0),
        `MCP 覆盖配置 ${descriptor.mcp.override}`,
      );
      const mainServers = isPlainObject(mainRaw) ? (mainRaw as Record<string, unknown>).servers : undefined;
      const overrideServers = isPlainObject(overrideRaw) ? (overrideRaw as Record<string, unknown>).servers : undefined;
      if (!isPlainObject(mainServers) || !isPlainObject(overrideServers)) {
        throw syncFailed('MCP 配置缺少 servers 对象');
      }
      merged = { servers: mergeServerObjects(mainServers, overrideServers) };
    }
    const servers = isPlainObject(merged) ? (merged as Record<string, unknown>).servers : undefined;
    if (!isPlainObject(servers)) throw syncFailed('MCP 合并结果缺少 servers 对象');
    const projected: Record<string, unknown> = {};
    for (const name of descriptor.mcp.servers) {
      if (!(name in servers)) {
        throw syncFailed(`MCP 描述列出的 server 在配置中不存在：${name}；来源可能已变化`);
      }
      projected[name] = servers[name];
    }
    mcpServers = projected;
  }

  return { files, deps, mcpServers };
}

export interface UnitFingerprints {
  sourceFingerprint: string;
  /** 仅 skills 单元；用于共享输出等价判定（design §2.3）。 */
  effectiveOutputFingerprint?: string;
}

/**
 * 组装并计算单元指纹（design §3.1）：
 * 载荷 = unit + 行为 + 实际输入清单（含 MCP 合并结构 / skills 清单）+ 生成器依赖摘要。
 */
export function computeUnitFingerprints(
  keyBytes: Buffer,
  descriptor: SyncInputsDescriptor,
  loaded: LoadedDescriptorInputs,
): UnitFingerprints {
  if (!descriptor.executable) {
    throw invalid(`单元当前不可执行（${descriptor.reasonCode ?? 'unknown'}），不得计算成功指纹`);
  }

  const inputs: unknown[] = [];
  for (const file of loaded.files) {
    // MCP 主/覆盖文件的语义贡献完全由合并投影后的 servers 结构承载；
    // 字节哈希会把"对象键重排"误判为变化，违背 design §3.1 的按解析结构计算。
    if (file.type === 'mcp_main' || file.type === 'mcp_override') continue;
    if (file.type === 'workspace_config' && file.parsedJson !== undefined) {
      inputs.push({ path: file.path, type: file.type, config: file.parsedJson });
    } else {
      inputs.push({ path: file.path, type: file.type, sha256: file.sha256, executable: file.executable });
    }
  }

  if (descriptor.skillsPlan) {
    const entries = [...descriptor.skillsPlan.entries].sort((a, b) =>
      a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
    for (const entry of entries) {
      inputs.push({ type: 'skill', relativePath: entry.relativePath, manifest: entry.manifest });
    }
  }

  if (descriptor.mcp) {
    inputs.push({ type: 'mcp_effective_servers', servers: loaded.mcpServers });
  }

  const sourceFingerprint = computeSourceFingerprint(keyBytes, {
    unit: descriptor.unit,
    inputs,
    behavior: descriptor.skillsPlan?.behavior ?? null,
    generatorDeps: loaded.deps.map((dep) => ({ path: dep.path, sha256: dep.sha256 })),
  });

  let effectiveOutputFingerprint: string | undefined;
  if (descriptor.skillsPlan) {
    const plan: SkillsDistributionPlan = {
      outputKeys: descriptor.skillsPlan.outputKeys,
      entries: descriptor.skillsPlan.entries.map((entry) => ({
        relativePath: entry.relativePath,
        targetPath: entry.targetPath,
        sourcePath: entry.sourcePath,
        sourceVersion: entry.sourceVersion,
        strategy: entry.strategy,
      })),
      behavior: descriptor.skillsPlan.behavior,
    };
    effectiveOutputFingerprint = computeEffectiveOutputFingerprint(keyBytes, plan);
  }

  return { sourceFingerprint, effectiveOutputFingerprint };
}
