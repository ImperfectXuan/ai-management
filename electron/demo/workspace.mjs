import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

async function put(root, file, text) {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
}

/** 每次使用全新的临时目录，不覆盖既有演示或真实工具配置。 */
export async function prepareDemo() {
  const base = await mkdtemp(path.join(tmpdir(), 'aiws-demo-'));
  const repo = path.join(base, '总库');
  const target = path.join(base, '应用项目');
  const home = path.join(base, 'home');
  const profile = path.join(base, 'profile');
  const sourceA = path.join(base, '来源项目-A');
  const sourceB = path.join(base, '来源项目-B');
  await mkdir(repo);
  await mkdir(target);
  await mkdir(home);
  await mkdir(profile);
  for (const name of ['scripts', 'adapters']) {
    await cp(path.join(projectRoot, '.ai-workspace', name), path.join(repo, '.ai-workspace', name), { recursive: true });
  }
  // 只创建虚构样例；不复制真实 MCP、vault、工具全局目录或已有收编批次。
  await put(repo, '.ai-workspace/config/workspace.json', json({ version: '1.0', tools: ['codex', 'claude', 'cursor', 'trae'], default_scope: 'project', secrets: { enabled: false } }));
  await put(repo, '.ai-workspace/mcp/mcp.json', json({ servers: {} }));
  await put(repo, '.ai-workspace/rules/00-core.md', '---\nid: 00-core\ntitle: 演示核心规则\nscope: all\n---\n# 演示核心规则\n\n所有修改必须先验证，再报告结果。\n');
  await mkdir(path.join(repo, '.ai-workspace/rules/domains'), { recursive: true });
  for (const tool of ['codex', 'claude', 'cursor', 'trae']) {
    await put(repo, `.ai-workspace/adapters/${tool}/mapping.yaml`, `tool: ${tool}\nversion: ">=1"\nincludes_support: false\nrules:\n  - source: rules/00-core.md\n    required: true\n`);
  }
  await put(repo, '.ai-workspace/memory/context/project.md', '---\nid: project\ntitle: 演示项目\n---\n# 演示项目\n\n这是用于本机演示的独立总库。\n');
  await put(repo, '.ai-workspace/skills/demo-check/SKILL.md', '---\nname: demo-check\ndescription: 演示验证步骤\n---\n# 演示验证\n\n检查规则是否已分发到选定工具。\n');
  const shared = '---\nid: coding-guide\ntitle: 编程规范\nscope: all\n---\n# 编程规范\n\n函数保持简短，命名表达意图。\n';
  await put(sourceA, '.cursor/rules/coding-guide.mdc', shared);
  await put(sourceB, '.trae/rules/same-content.md', shared);
  await put(sourceB, '.trae/rules/00-core.md', '---\nid: 00-core\ntitle: 演示核心规则\nscope: all\n---\n# 演示核心规则\n\n本来源要求跳过所有测试。\n');
  await put(sourceA, '.cursor/skills/source-check/SKILL.md', '---\nname: source-check\ndescription: 来源项目的验证技能\n---\n# 来源验证\n\n验证构建与回归测试。\n');
  await put(sourceA, '.cursor/skills/source-check/run.sh', '#!/bin/sh\nprintf "demo only\\n"\n');
  await put(sourceA, '.cursor/mcp.json', json({ mcpServers: { 'demo-files': { command: 'node', args: ['demo-server.js'] } } }));
  await put(repo, '.gitignore', '.ai-workspace/intake/\n.agents/\n.cursor/\n.trae/\n.codex/\n');
  execFileSync('git', ['init', '--quiet', repo]);
  await put(profile, 'repos.json', json({ repos: [{ id: 'demo-library', path: target, name: '演示应用项目', addedAt: '2026-10-15T00:00:00Z' }] }));
  await put(profile, 'content-library.json', json({ path: repo }));
  const result = { base, repo, target, home, profile, sourceA, sourceB };
  await put(base, 'demo.json', json(result));
  await put(base, '演示路径.txt', `内容库：${repo}\n应用项目：${target}\n来源 A：${sourceA}\n来源 B：${sourceB}\n\n来源 A 选 cursor/project，来源 B 选 trae/project。\n同名冲突建议选择“忽略”，其余安全候选可选择“新增”。\nMCP 为虚构配置，仅演示配置分发，不启动服务器。\n`);
  return result;
}
