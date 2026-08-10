// electron/src/core/rules.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface Rule {
  id: string;
  scope: string;
  globs: string;
  required: boolean;
  domain: boolean;
}

export function ruleGlobs(fileContent: string, scope: string): string {
  const inline = fileContent.match(/^globs:\s*(.+)$/m)?.[1]?.trim();
  if (inline) return stripQuotes(inline);
  const lines = fileContent.split('\n');
  const blockIdx = lines.findIndex((l) => /^globs:\s*$/.test(l));
  if (blockIdx >= 0) {
    const exts: string[] = [];
    for (let i = blockIdx + 1; i < lines.length; i++) {
      const m = lines[i].match(/^\s*-\s*["']?(.+?)["']?\s*$/);
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

function mappingRequired(mapping: string, rel: string): boolean {
  const lines = mapping.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`source: ${rel}`)) {
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s*- source:/.test(lines[j])) break;
        const m = lines[j].match(/^\s*required:\s*(true|false)/);
        if (m) return m[1] === 'true';
      }
      return false;
    }
  }
  return false;
}

export async function listRules(root: string): Promise<Rule[]> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const rulesDir = path.join(aiwsDir, 'rules');
  const mapping = await fs.readFile(path.join(aiwsDir, 'adapters', 'cursor', 'mapping.yaml'), 'utf8').catch(() => '');
  const out: Rule[] = [];
  for (const sub of ['', 'domains']) {
    const dir = path.join(rulesDir, sub);
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    for (const f of files.filter((f) => f.endsWith('.md')).sort()) {
      const content = await fs.readFile(path.join(dir, f), 'utf8');
      const domain = sub === 'domains';
      const rel = domain ? `rules/domains/${f}` : `rules/${f}`;
      const scope = (content.match(/^scope:\s*(.+)$/m)?.[1] || 'all').trim();
      out.push({
        id: f.replace(/\.md$/, ''),
        scope,
        globs: ruleGlobs(content, scope),
        required: mappingRequired(mapping, rel),
        domain,
      });
    }
  }
  return out;
}

export async function setRuleRequired(root: string, tool: string, id: string, domain: boolean, value: boolean): Promise<void> {
  const aiwsDir = path.join(root, '.ai-workspace');
  const rel = domain ? `rules/domains/${id}.md` : `rules/${id}.md`;
  const file = path.join(aiwsDir, 'adapters', tool, 'mapping.yaml');
  const mapping = await fs.readFile(file, 'utf8');
  const lines = mapping.split('\n');
  const idx = lines.findIndex((l) => l.includes(`source: ${rel}`));
  if (idx < 0) throw new Error(`规则 ${rel} 不在 ${tool} 的 mapping 中`);
  let j = idx;
  while (j < lines.length && !lines[j].match(/^\s*required:\s*(true|false)/)) j++;
  if (j >= lines.length) throw new Error(`规则 ${rel} 缺少 required 字段`);
  lines[j] = lines[j].replace(/required:\s*(true|false)/, `required: ${value}`);
  await fs.writeFile(file, lines.join('\n'), 'utf8');
}
