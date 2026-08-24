// electron/src/core/rules.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SUPPORTED_TOOLS } from './config';
import { ErrorCodes, WorkspaceError } from './errors';

export type SupportedTool = typeof SUPPORTED_TOOLS[number];

// 当前仅 cursor / trae 有 per-rule mapping;其它工具走单文件模式,无 required 维度
export type PerFileTool = 'cursor' | 'trae';
export const PER_FILE_TOOLS: readonly PerFileTool[] = ['cursor', 'trae'];

export interface Rule {
  id: string;
  scope: string;
  globs: string;
  requiredByTool: Record<PerFileTool, boolean>;
  domain: boolean;
}

function splitLines(content: string): string[] {
  return content.replace(/\r\n/g, '\n').split('\n');
}

// 提取并解析 YAML frontmatter；正文中的 `scope:` / `globs:` 行不会被误抓
function parseFrontmatter(content: string): Record<string, string> {
  const lines = splitLines(content);
  let startIdx = -1, endIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^---$/.test(lines[i])) {
      if (startIdx < 0) startIdx = i;
      else { endIdx = i; break; }
    }
  }
  if (startIdx < 0 || endIdx < 0) return {};
  const out: Record<string, string> = {};
  for (let i = startIdx + 1; i < endIdx; i++) {
    const m = lines[i].match(/^(\w[\w-]*):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

// 提取 frontmatter 原始行段，供块形式（如 globs 列表）解析
function getFrontmatterLines(content: string): string[] {
  const lines = splitLines(content);
  let startIdx = -1, endIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^---$/.test(lines[i])) {
      if (startIdx < 0) startIdx = i;
      else { endIdx = i; break; }
    }
  }
  if (startIdx < 0 || endIdx < 0) return [];
  return lines.slice(startIdx + 1, endIdx);
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function ruleGlobs(fileContent: string, scope: string): string {
  const fm = parseFrontmatter(fileContent);
  const inline = fm['globs'];
  if (inline) return stripQuotes(inline);
  const fmLines = getFrontmatterLines(fileContent);
  const blockIdx = fmLines.findIndex((l) => /^globs:\s*$/.test(l));
  if (blockIdx >= 0) {
    const exts: string[] = [];
    for (let i = blockIdx + 1; i < fmLines.length; i++) {
      const m = fmLines[i].match(/^\s*-\s*["']?(.+?)["']?\s*$/);
      if (!m) break;
      exts.push(m[1].replace(/^\*\*\/\*\./, ''));
    }
    if (exts.length) return `**/*.{${exts.join(',')}}`;
  }
  switch (scope) {
    case 'csharp': return '**/*.{cs,csproj,sln}';
    case 'vue': return '**/*.{vue,ts,js,css,scss}';
    default: return '**/*';
  }
}

function mappingRequired(mapping: string, rel: string): boolean {
  const lines = splitLines(mapping);
  const i = findSourceLine(lines, rel);
  if (i < 0) return false;
  for (let j = i + 1; j < lines.length; j++) {
    if (/^\s*-\s+source:/.test(lines[j])) break;
    const m = lines[j].match(/^\s*required:\s*(true|false)/);
    if (m) return m[1] === 'true';
  }
  return false;
}

// 行锚定的 source 查找：避免 `rules/foo.md` 子串误命中 `rules/foo.mdx`
function findSourceLine(lines: string[], rel: string): number {
  const re = new RegExp(`^\\s*-\\s+source:\\s+${escapeRegex(rel)}\\s*$`);
  return lines.findIndex((l) => re.test(l));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hasMappingSource(mapping: string, rel: string): boolean {
  return findSourceLine(splitLines(mapping), rel) >= 0;
}

function assertPerFileTool(tool: string): asserts tool is PerFileTool {
  if (PER_FILE_TOOLS.includes(tool as PerFileTool)) return;
  throw new WorkspaceError(
    ErrorCodes.UnsupportedTool,
    `规则操作仅支持 ${PER_FILE_TOOLS.join('/')}，收到 ${JSON.stringify(tool)}`
  );
}

export async function listRules(root: string): Promise<Rule[]> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const rulesDir = path.join(aiwsDir, 'rules');
  // 读所有 per-file 工具的 mapping
  const mappings: Record<PerFileTool, string> = { cursor: '', trae: '' };
  for (const t of PER_FILE_TOOLS) {
    mappings[t] = await fs
      .readFile(path.join(aiwsDir, 'adapters', t, 'mapping.yaml'), 'utf8')
      .catch(() => '');
  }
  const out: Rule[] = [];
  for (const sub of ['', 'domains']) {
    const dir = path.join(rulesDir, sub);
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    for (const f of files.filter((f) => f.endsWith('.md')).sort()) {
      const content = await fs.readFile(path.join(dir, f), 'utf8');
      const domain = sub === 'domains';
      const rel = domain ? `rules/domains/${f}` : `rules/${f}`;
      const fm = parseFrontmatter(content);
      const scope = fm['scope'] || 'all';
      // per-tool required:从每个工具自己的 mapping 读
      const requiredByTool: Record<PerFileTool, boolean> = {
        cursor: mappingRequired(mappings.cursor, rel),
        trae: mappingRequired(mappings.trae, rel),
      };
      out.push({
        id: f.replace(/\.md$/, ''),
        scope,
        globs: ruleGlobs(content, scope),
        requiredByTool,
        domain,
      });
    }
  }
  return out;
}

export async function setRuleRequired(root: string, tool: string, id: string, domain: boolean, value: boolean): Promise<void> {
  assertPerFileTool(tool);
  const aiwsDir = path.join(root, '.ai-workspace');
  const rel = domain ? `rules/domains/${id}.md` : `rules/${id}.md`;
  const file = path.join(aiwsDir, 'adapters', tool, 'mapping.yaml');
  const mapping = await fs.readFile(file, 'utf8');
  const lines = splitLines(mapping);
  const idx = findSourceLine(lines, rel);
  if (idx < 0) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `规则 ${rel} 不在 ${tool} 的 mapping 中`);
  }
  let j = idx;
  while (j < lines.length && !lines[j].match(/^\s*required:\s*(true|false)/)) j++;
  if (j >= lines.length) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `规则 ${rel} 缺少 required 字段`);
  }
  lines[j] = lines[j].replace(/required:\s*(true|false)/, `required: ${value}`);
  await fs.writeFile(file, lines.join('\n'), 'utf8');
}
