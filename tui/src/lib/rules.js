// tui/src/lib/rules.js
const fs = require('fs');
const path = require('path');
const { getRoot } = require('./aiws');

// 懒求值:避免模块加载期就调 getRoot(),让单元测试可在 chdir 后无需 reload
// M12 / D3 修复:与 aiws.js 的 getAiwsPath 同源
function rulesDir() {
  return path.join(getRoot(), '.ai-workspace', 'rules');
}
function mappingPath(tool) {
  return path.join(getRoot(), '.ai-workspace', 'adapters', tool, 'mapping.yaml');
}

// 仅 cursor / trae 有 per-rule required;其它工具(claude/codex)走单文件模式
const PER_FILE_TOOLS = ['cursor', 'trae'];

// CRLF 归一:Windows 编辑器/git autocrlf 写入的 mapping 会被 split('\n') 后留下 \r,
// 正则 `^...$` 默认不吞 \r,会全 false。M2(a) 修复:统一在源头归一。
function splitLines(text) {
  if (!text) return [];
  return text.replace(/\r\n/g, '\n').split('\n');
}

function parseFrontmatter(content) {
  const lines = splitLines(content);
  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^---$/.test(lines[i])) {
      if (startIdx < 0) startIdx = i;
      else {
        endIdx = i;
        break;
      }
    }
  }
  if (startIdx < 0 || endIdx < 0) return {};
  const out = {};
  for (let i = startIdx + 1; i < endIdx; i++) {
    const m = lines[i].match(/^(\w[\w-]*):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function getFrontmatterLines(content) {
  const lines = splitLines(content);
  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^---$/.test(lines[i])) {
      if (startIdx < 0) startIdx = i;
      else {
        endIdx = i;
        break;
      }
    }
  }
  if (startIdx < 0 || endIdx < 0) return [];
  return lines.slice(startIdx + 1, endIdx);
}

function stripQuotes(value) {
  if (!value || value.length < 2) return value || '';
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
    return value.slice(1, -1);
  }
  return value;
}

function ruleGlobs(content, scope) {
  const frontmatter = parseFrontmatter(content);
  if (frontmatter.globs) return stripQuotes(frontmatter.globs);

  const frontmatterLines = getFrontmatterLines(content);
  const blockIdx = frontmatterLines.findIndex((line) => /^globs:\s*$/.test(line));
  if (blockIdx >= 0) {
    const exts = [];
    for (let i = blockIdx + 1; i < frontmatterLines.length; i++) {
      const m = frontmatterLines[i].match(/^\s*-\s*["']?(.+?)["']?\s*$/);
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

// 行锚定的 source 查找:避免 `rules/foo.md` 子串误命中 `rules/foo.mdx`
function findSourceLine(lines, rel) {
  const re = new RegExp(`^\\s*-\\s+source:\\s+${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  return lines.findIndex((l) => re.test(l));
}

// 从某工具的 mapping 文本里读某条 source 的 required
function mappingRequired(mapping, rel) {
  if (!mapping) return false;
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

// 纯函数:在 lines 上把 rel 条目的 required 改成 value,返回新 lines
// 复用 setRequired 和 setRequiredBatch;M2(b) 修复:让批量调用只做一次 IO
function applyRequiredChange(lines, rel, value) {
  const i = findSourceLine(lines, rel);
  if (i < 0) {
    return { ok: false, code: 'SourceNotInMapping', error: `规则 ${rel} 不在 mapping 中，无法切换 required` };
  }
  let j = i;
  while (j < lines.length && !lines[j].match(/^\s*required:\s*(true|false)/)) j++;
  if (j >= lines.length) {
    return { ok: false, code: 'RequiredLineMissing', error: `规则 ${rel} 的 mapping 条目缺 required 行，无法切换` };
  }
  const next = lines.slice();
  next[j] = lines[j].replace(/required:\s*(true|false)/, `required: ${value}`);
  return { ok: true, lines: next };
}

function listRules() {
  const dirs = ['', 'domains'];
  // 先把所有 per-file 工具的 mapping 文本读进来
  const mappings = {};
  for (const t of PER_FILE_TOOLS) {
    const mapFile = mappingPath(t);
    mappings[t] = fs.existsSync(mapFile) ? fs.readFileSync(mapFile, 'utf8') : '';
  }
  const rules = [];
  for (const d of dirs) {
    const dir = path.join(rulesDir(), d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const frontmatter = parseFrontmatter(src);
      const scope = frontmatter.scope || 'all';
      const globs = ruleGlobs(src, scope);
      const domain = !!d;
      const rel = domain ? `rules/domains/${f}` : `rules/${f}`;
      const requiredByTool = {
        cursor: mappingRequired(mappings.cursor, rel),
        trae: mappingRequired(mappings.trae, rel),
      };
      rules.push({
        id: f.replace(/\.md$/, ''),
        scope,
        globs,
        requiredByTool,
        domain,
      });
    }
  }
  return rules;
}

function setRequired(id, domain, value, tool) {
  // tool 入参:屏上当前选中的工具,不传时默认 cursor(向后兼容)
  const useTool = tool || 'cursor';
  const rel = domain ? `rules/domains/${id}.md` : `rules/${id}.md`;
  const file = mappingPath(useTool);
  if (!fs.existsSync(file)) {
    return {
      ok: false,
      code: 'MappingMissing',
      error: `${useTool} mapping 文件不存在: ${file}`,
    };
  }
  const lines = splitLines(fs.readFileSync(file, 'utf8'));
  const result = applyRequiredChange(lines, rel, value);
  if (!result.ok) {
    return { ok: false, code: result.code, error: `${useTool}: ${result.error}` };
  }
  fs.writeFileSync(file, result.lines.join('\n'));
  return { ok: true };
}

// 批量 API:一次 readFile + 一次 writeFile,避免 N 次循环读（M2(b) 修复）
// items: [{ id, domain, value }]
function setRequiredBatch(items, tool) {
  const useTool = tool || 'cursor';
  const file = mappingPath(useTool);
  if (!fs.existsSync(file)) {
    return {
      ok: false,
      code: 'MappingMissing',
      error: `${useTool} mapping 文件不存在: ${file}`,
    };
  }
  let lines = splitLines(fs.readFileSync(file, 'utf8'));
  const applied = [];
  for (const { id, domain, value } of items) {
    const rel = domain ? `rules/domains/${id}.md` : `rules/${id}.md`;
    const result = applyRequiredChange(lines, rel, value);
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        error: `${useTool}: ${result.error}`,
        applied,
      };
    }
    lines = result.lines;
    applied.push({ id, value });
  }
  fs.writeFileSync(file, lines.join('\n'));
  return { ok: true, applied };
}

module.exports = { listRules, setRequired, setRequiredBatch, PER_FILE_TOOLS };
