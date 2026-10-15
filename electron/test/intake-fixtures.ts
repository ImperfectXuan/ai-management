// electron/test/intake-fixtures.ts
// Desktop 收编测试共用的临时夹具：临时总库（含真实 CLI 引擎副本）、临时来源、临时 HOME。
// 不触碰真实仓库、真实全局配置或真实凭据。
import { createHash } from 'node:crypto';
import { promises as fsp, mkdtempSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IntakeSourceSelection } from '../src/shared/intake-types';

const TEST_DIR = __dirname;
export const REAL_SCRIPTS = path.resolve(TEST_DIR, '..', '..', '.ai-workspace', 'scripts');

export const sandbox = mkdtempSync(path.join(tmpdir(), 'aiws-intake-fx-'));

/** 隔离 HOME：global scope 路径派生自 $HOME，避免读到宿主机真实工具目录 */
export function isolateHome(): string {
  const home = mkdtempSync(path.join(sandbox, 'home-'));
  process.env.HOME = home;
  return home;
}

export async function sha256Tree(dir: string): Promise<string> {
  const entries: string[] = [];
  async function walk(cur: string): Promise<void> {
    const items = await fsp.readdir(cur, { withFileTypes: true });
    for (const it of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(cur, it.name);
      if (it.isDirectory()) await walk(full);
      else entries.push(`${path.relative(dir, full)}:${createHash('sha256').update(await fsp.readFile(full)).digest('hex')}`);
    }
  }
  await walk(dir);
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

/** 临时总库：复制真实 CLI 引擎，使其成为已初始化的 AI Workspace */
export async function makeRepo(): Promise<string> {
  const root = mkdtempSync(path.join(sandbox, 'repo-'));
  const aiws = path.join(root, '.ai-workspace');
  await fsp.cp(REAL_SCRIPTS, path.join(aiws, 'scripts'), { recursive: true });
  chmodSync(path.join(aiws, 'scripts', 'aiws'), 0o755);
  await fsp.mkdir(path.join(aiws, 'rules', 'domains'), { recursive: true });
  await fsp.mkdir(path.join(aiws, 'skills'), { recursive: true });
  await fsp.mkdir(path.join(aiws, 'mcp'), { recursive: true });
  for (const tool of ['cursor', 'trae', 'claude', 'codex']) {
    await fsp.mkdir(path.join(aiws, 'adapters', tool), { recursive: true });
    await fsp.writeFile(
      path.join(aiws, 'adapters', tool, 'mapping.yaml'),
      `tool: ${tool}\nversion: ">=1"\nincludes_support: false\nrules:\n  - source: rules/00-core.md\n    required: true\n`
    );
  }
  await fsp.writeFile(
    path.join(aiws, 'rules', '00-core.md'),
    '---\nid: 00-core\ntitle: 核心原则\nglobs: "**/*"\n---\n# 核心原则\n\n原文。\n'
  );
  await fsp.writeFile(
    path.join(aiws, 'mcp', 'mcp.json'),
    '{"servers":{"fs":{"command":"npx","args":["-y","fs"],"env":{"API_KEY":"${secret:fs_key}"}}}}'
  );
  return root;
}

/** 来源项目：没有 .ai-workspace，也不是 git 仓库 */
export async function makeSource(name: string): Promise<string> {
  const root = mkdtempSync(path.join(sandbox, name));
  await fsp.mkdir(path.join(root, '.cursor', 'rules'), { recursive: true });
  await fsp.mkdir(path.join(root, '.cursor', 'skills', 'new-skill'), { recursive: true });
  await fsp.mkdir(path.join(root, '.trae', 'skills', 'broken-skill'), { recursive: true });
  await fsp.writeFile(
    path.join(root, '.cursor', 'rules', 'newrule.mdc'),
    '---\nid: newrule\ntitle: 新规则\nglobs: "**/*.ts"\n---\n# 新规则\n\n来自来源。\n'
  );
  await fsp.writeFile(
    path.join(root, '.cursor', 'rules', '00-core.mdc'),
    '---\nid: 00-core\ntitle: 核心原则\nglobs: "**/*.ts"\n---\n# 核心原则\n\n来源改过。\n'
  );
  await fsp.writeFile(
    path.join(root, '.cursor', 'skills', 'new-skill', 'SKILL.md'),
    '---\nname: new-skill\n---\n# New Skill\n'
  );
  await fsp.writeFile(path.join(root, '.cursor', 'skills', 'new-skill', 'run.sh'), '#!/bin/sh\necho hi\n');
  await fsp.writeFile(path.join(root, '.cursor', 'mcp.json'),
    '{"mcpServers":{"fresh":{"command":"npx","args":["-y","fresh-server"],"env":{"API_KEY":"${secret:fresh_key}"}}}}');
  // 无法解析：缺 SKILL.md
  await fsp.writeFile(path.join(root, '.trae', 'skills', 'broken-skill', 'README.md'), 'not a skill\n');
  return root;
}

export const sourcesOf = (srcA: string, srcB: string, extra: string[] = []): IntakeSourceSelection[] => [
  { path: srcA, tool: 'cursor', scope: 'project' },
  { path: srcB, tool: 'trae', scope: 'project' },
  ...extra.map((p) => ({ path: p, tool: 'cursor' as const, scope: 'project' as const })),
];

export async function cleanupSandbox(): Promise<void> {
  await fsp.rm(sandbox, { recursive: true, force: true });
}
