// electron/src/core/rule-document.ts
// 规则文档读写：解析 frontmatter 与 Markdown 正文，做字段校验、冲突检测与原子写回。
// 与 rules.ts 的列表/装载逻辑分开，保持单一职责与文件体量可控。
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SUPPORTED_TOOLS, type SupportedTool } from '../shared/tools';
import { ErrorCodes, WorkspaceError } from './errors';

export interface RuleFields {
  title: string;
  description: string;
  scope: string;
  globs: string[];
  tools: SupportedTool[];
}

export interface RuleDocument {
  id: string;
  domain: boolean;
  relativePath: string;
  version: string;
  fields: RuleFields;
  body: string;
}

export interface SaveRuleInput {
  id: string;
  domain: boolean;
  expectedVersion: string;
  fields: RuleFields;
  body: string;
}

export function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// 规则文档读写（desktop-rule-editor）：解析 frontmatter 与正文，安全写回 canonical 文件。
// ---------------------------------------------------------------------------

const RULE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const KNOWN_FIELDS = ['title', 'description', 'scope', 'globs', 'tools'] as const;
type KnownField = (typeof KNOWN_FIELDS)[number];

interface RuleFrontmatterEntry {
  key: string;
  start: number;
  end: number;
  scalar: string;
  list?: string[];
}

interface RuleDocumentParts {
  lines: string[];
  body: string;
  hasFrontmatter: boolean;
}

function hashContent(raw: Buffer): string {
  return 'sha256:' + createHash('sha256').update(raw).digest('hex');
}

function splitRuleDocument(content: string): RuleDocumentParts {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') return { lines: [], body: lines.join('\n'), hasFrontmatter: false };
  const end = lines.findIndex((line, index) => index > 0 && line === '---');
  if (end < 0) return { lines: [], body: lines.join('\n'), hasFrontmatter: false };
  return {
    lines: lines.slice(1, end),
    body: lines.slice(end + 1).join('\n'),
    hasFrontmatter: true,
  };
}

function normalizeRuleBody(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

function parseInlineList(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => stripQuotes(item.trim()))
    .filter(Boolean);
}

/** 解析 frontmatter 行；列表项归属前一个键，未知键原样保留在原始行中。 */
function parseRuleEntries(lines: string[]): RuleFrontmatterEntry[] {
  const entries: RuleFrontmatterEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\w[\w-]*):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const scalar = match[2].trim();
    let end = i;
    let list: string[] | undefined;
    if (scalar === '') {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const item = lines[j].match(/^\s*-\s*(.+?)\s*$/);
        if (!item) break;
        items.push(stripQuotes(item[1]));
        j++;
      }
      if (items.length > 0) {
        list = items;
        end = j - 1;
      }
    }
    entries.push({ key, start: i, end, scalar, list });
    i = end;
  }
  return entries;
}

function invalidField(field: string, reason: string): WorkspaceError {
  return new WorkspaceError(ErrorCodes.InvalidArgument, `规则字段 ${field} 无效：${reason}`);
}

function readKnownField(field: KnownField, entry: RuleFrontmatterEntry): unknown {
  if (field === 'title' || field === 'description' || field === 'scope') {
    if (entry.list) throw invalidField(field, '必须是单行文本');
    return stripQuotes(entry.scalar);
  }
  if (entry.list) return entry.list;
  if (entry.scalar.startsWith('[')) return parseInlineList(entry.scalar);
  return entry.scalar ? [stripQuotes(entry.scalar)] : [];
}

function parseRuleFields(entries: RuleFrontmatterEntry[]): RuleFields {
  const values: Record<KnownField, unknown> = {
    title: '',
    description: '',
    scope: 'all',
    globs: [],
    tools: [],
  };
  for (const field of KNOWN_FIELDS) {
    const matches = entries.filter((entry) => entry.key === field);
    if (matches.length > 1) {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, `规则 frontmatter 中 ${field} 重复出现，请先手动修复`);
    }
    if (matches.length === 1) values[field] = readKnownField(field, matches[0]);
  }
  return {
    title: values.title as string,
    description: values.description as string,
    scope: ((values.scope as string) || 'all'),
    globs: values.globs as string[],
    tools: values.tools as SupportedTool[],
  };
}

function assertSingleLine(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw invalidField(field, '必须是字符串');
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) throw invalidField(field, '不能为空');
  if (/[\r\n]/.test(value)) throw invalidField(field, '不能包含换行');
  return trimmed;
}

function validateRuleFields(fields: RuleFields): RuleFields {
  if (!fields || typeof fields !== 'object') {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, '规则字段必须是对象');
  }
  const title = assertSingleLine(fields.title, 'title');
  const description = assertSingleLine(fields.description, 'description', true);
  const scope = assertSingleLine(fields.scope, 'scope');
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(scope)) {
    throw invalidField('scope', '只能包含小写字母、数字、连字符与下划线，且以字母或数字开头');
  }
  if (!Array.isArray(fields.globs)) throw invalidField('globs', '必须是字符串数组');
  const globs = fields.globs.map((glob) => assertSingleLine(glob, 'globs'));
  if (!Array.isArray(fields.tools)) throw invalidField('tools', '必须是字符串数组');
  const tools: SupportedTool[] = [];
  for (const tool of fields.tools) {
    if (!SUPPORTED_TOOLS.includes(tool as SupportedTool)) {
      throw invalidField('tools', `不支持的工具 ${JSON.stringify(tool)}`);
    }
    if (!tools.includes(tool as SupportedTool)) tools.push(tool as SupportedTool);
  }
  // 四个工具全选等价于“全工具”语义，省略该键以保持 canonical 写法。
  return { title, description, scope, globs, tools: tools.length === SUPPORTED_TOOLS.length ? [] : tools };
}

function formatScalar(value: string): string {
  const plain = /^[\p{L}\p{N}_./*{},\-()&+ ]+$/u.test(value)
    && !/^(true|false|null|~)$/i.test(value)
    && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)
    && !/:\s/.test(value)
    && !/\s#/.test(value);
  if (plain) return value;
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function renderKnownField(field: KnownField, fields: RuleFields): string[] {
  switch (field) {
    case 'title':
      return fields.title ? [`title: ${formatScalar(fields.title)}`] : [];
    case 'description':
      return fields.description ? [`description: ${formatScalar(fields.description)}`] : [];
    case 'scope':
      return [`scope: ${fields.scope}`];
    case 'globs':
      if (fields.globs.length === 0) return [];
      if (fields.globs.length === 1) return [`globs: ${formatScalar(fields.globs[0])}`];
      return ['globs:', ...fields.globs.map((glob) => `  - ${formatScalar(glob)}`)];
    case 'tools':
      return fields.tools.length > 0 ? [`tools: [${fields.tools.join(', ')}]`] : [];
  }
}

function sameField(field: KnownField, left: RuleFields, right: RuleFields): boolean {
  if (field === 'globs' || field === 'tools') {
    return left[field].length === right[field].length && left[field].every((value, index) => value === right[field][index]);
  }
  return left[field] === right[field];
}

/** 只重写被编辑的已知键；未编辑键、未知键与 id 行逐字节保留。 */
function renderRuleContent(
  originalLines: string[],
  hasFrontmatter: boolean,
  originalFields: RuleFields,
  fields: RuleFields,
  body: string,
): string {
  const changed = new Set<KnownField>(KNOWN_FIELDS.filter((field) => !sameField(field, originalFields, fields)));
  const entries = parseRuleEntries(originalLines);
  const entryAt = new Map(entries.map((entry) => [entry.start, entry]));
  const rendered = new Map<KnownField, string[]>();
  const inserted = new Set<KnownField>();
  for (const field of changed) rendered.set(field, renderKnownField(field, fields));

  const output: string[] = [];
  for (let i = 0; i < originalLines.length; i++) {
    const entry = entryAt.get(i);
    if (!entry) {
      output.push(originalLines[i]);
      continue;
    }
    const known = KNOWN_FIELDS.includes(entry.key as KnownField) && changed.has(entry.key as KnownField);
    if (known) {
      const field = entry.key as KnownField;
      if (!inserted.has(field)) {
        output.push(...(rendered.get(field) ?? []));
        inserted.add(field);
      }
    } else {
      output.push(...originalLines.slice(entry.start, entry.end + 1));
    }
    i = entry.end;
  }
  for (const field of KNOWN_FIELDS) {
    if (changed.has(field) && !inserted.has(field)) output.push(...(rendered.get(field) ?? []));
  }

  const normalizedBody = normalizeRuleBody(body);
  const hasBlock = hasFrontmatter || output.length > 0;
  if (!hasBlock) return normalizedBody ? `${normalizedBody}\n` : '';
  const head = ['---', ...output, '---'].join('\n');
  return normalizedBody ? `${head}\n\n${normalizedBody}\n` : `${head}\n`;
}

function assertRuleId(id: string): void {
  if (!RULE_ID_PATTERN.test(id) || id.includes('..') || id === 'CHANGELOG') {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `非法规则 id：${JSON.stringify(id)}`);
  }
}

function ruleRelativePath(id: string, domain: boolean): string {
  assertRuleId(id);
  return `rules/${domain ? 'domains/' : ''}${id}.md`;
}

function ruleFilePath(root: string, id: string, domain: boolean): string {
  assertRuleId(id);
  const base = path.resolve(root, '.ai-workspace', 'rules', ...(domain ? ['domains'] : []));
  const target = path.resolve(base, `${id}.md`);
  if (path.dirname(target) !== base) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `规则路径越界：${JSON.stringify(id)}`);
  }
  return target;
}

export async function readRuleDocument(root: string, id: string, domain: boolean): Promise<RuleDocument> {
  const target = ruleFilePath(root, id, domain);
  const relativePath = ruleRelativePath(id, domain);
  let raw: Buffer;
  try {
    raw = await fs.readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, `规则不存在：${relativePath}`);
    }
    throw error;
  }
  const parts = splitRuleDocument(raw.toString('utf8'));
  return {
    id,
    domain,
    relativePath,
    version: hashContent(raw),
    fields: parseRuleFields(parseRuleEntries(parts.lines)),
    body: normalizeRuleBody(parts.body),
  };
}

export async function saveRule(root: string, input: SaveRuleInput): Promise<{ version: string }> {
  const target = ruleFilePath(root, input.id, input.domain);
  const relativePath = ruleRelativePath(input.id, input.domain);
  const fields = validateRuleFields(input.fields);
  if (typeof input.body !== 'string') {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, '规则正文必须是字符串');
  }
  if (typeof input.expectedVersion !== 'string' || input.expectedVersion.length === 0) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, '缺少规则内容版本，无法检测外部修改');
  }

  let raw: Buffer;
  try {
    raw = await fs.readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new WorkspaceError(ErrorCodes.InvalidArgument, `规则不存在：${relativePath}`);
    }
    throw error;
  }
  if (hashContent(raw) !== input.expectedVersion) {
    throw new WorkspaceError(ErrorCodes.InvalidArgument, `规则文件已被外部修改：${relativePath}；请重新加载后再保存`);
  }

  const parts = splitRuleDocument(raw.toString('utf8'));
  const originalFields = parseRuleFields(parseRuleEntries(parts.lines));
  const content = renderRuleContent(parts.lines, parts.hasFrontmatter, originalFields, fields, input.body);
  const stat = await fs.stat(target);
  // 临时文件与目标同目录，rename 才能保持原子替换；失败时绝不触碰原文件。
  const temp = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, content, { mode: stat.mode & 0o777 });
    await fs.rename(temp, target);
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined);
    throw new WorkspaceError(
      ErrorCodes.InvalidArgument,
      `保存规则失败：${relativePath}；${(error as Error).message}`
    );
  }
  return { version: hashContent(Buffer.from(content, 'utf8')) };
}
