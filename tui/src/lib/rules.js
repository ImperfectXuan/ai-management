// tui/src/lib/rules.js
const fs = require('fs');
const path = require('path');
const { getRoot } = require('./aiws');

const RULES = path.join(getRoot(), '.ai-workspace', 'rules');
const MAPPING = (tool) => path.join(getRoot(), '.ai-workspace', 'adapters', tool, 'mapping.yaml');

function listRules() {
  const dirs = ['', 'domains'];
  const rules = [];
  for (const d of dirs) {
    const dir = path.join(RULES, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const scope = (src.match(/^scope:\s*(.+)$/m) || [])[1] || 'all';
      const globs = (src.match(/^globs:\s*(.+)$/m) || [])[1] || '';
      rules.push({ id: f.replace(/\.md$/, ''), scope, globs, required: false, domain: !!d });
    }
  }
  // 从 mapping 读 required
  for (const r of rules) {
    const rel = r.domain ? `rules/domains/${r.id}.md` : `rules/${r.id}.md`;
    const map = fs.existsSync(MAPPING('cursor')) ? fs.readFileSync(MAPPING('cursor'), 'utf8') : '';
    const re = new RegExp(`- source: ${rel.replace(/\./g, '\\.')}\\n(?:.*\\n)*?\\s*required:\\s*(true|false)`);
    const m = (map.match(re) || [])[1];
    if (m) r.required = m === 'true';
  }
  return rules;
}

function setRequired(id, domain, value) {
  const rel = domain ? `rules/domains/${id}.md` : `rules/${id}.md`;
  const file = MAPPING('cursor');
  let map = fs.readFileSync(file, 'utf8');
  // 找到该 source 条目下的 required 行
  const lines = map.split('\n');
  let i = lines.findIndex((l) => l.includes(`source: ${rel}`));
  if (i < 0) return false;
  while (i < lines.length && !lines[i].includes('required:')) i++;
  if (i >= lines.length) return false;
  lines[i] = lines[i].replace(/required:\s*(true|false)/, `required: ${value}`);
  fs.writeFileSync(file, lines.join('\n'));
  return true;
}

module.exports = { listRules, setRequired };
