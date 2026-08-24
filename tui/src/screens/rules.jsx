// tui/src/screens/rules.jsx
const { useState, useEffect, useCallback } = require('react');
const { Box, Text, useInput } = require('ink');
const { listRules, setRequired, PER_FILE_TOOLS } = require('../lib/rules');
const { runAiws } = require('../lib/aiws');

const TOOL_LABELS = { cursor: 'Cursor', trae: 'Trae' };

function Rules() {
  const [rules, setRules] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState('all'); // all|domain|disabled
  const [tool, setTool] = useState('cursor'); // 当前选中的工具
  const [msg, setMsg] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const refresh = useCallback(() => setRules(listRules()), []);

  useEffect(() => { refresh(); }, [refresh]);

  useInput(async (input, key) => {
    if (key.downArrow) setCursor((c) => Math.min(rules.length - 1, c + 1));
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (input === ' ') {
      const r = rules[cursor]; if (!r) return;
      const current = r.requiredByTool?.[tool] ?? false;
      const result = setRequired(r.id, r.domain, !current, tool);
      if (result.ok) {
        setErrMsg('');
        setMsg(`[${TOOL_LABELS[tool]}] ${r.id} → ${!current ? '已应用' : '按需'}`);
        await runAiws(['sync', '--tool', tool]);
      } else {
        setMsg('');
        setErrMsg(`切换失败: ${result.error}`);
      }
      refresh();
    }
    if (input === 'f') setFilter({ all: 'domain', domain: 'disabled', disabled: 'all' }[filter]);
    if (input === 'r') refresh();
    // t 键:在 cursor / trae 间循环切换
    if (input === 't') {
      const idx = PER_FILE_TOOLS.indexOf(tool);
      const next = PER_FILE_TOOLS[(idx + 1) % PER_FILE_TOOLS.length];
      setTool(next);
      setMsg(`已切换工具 → ${TOOL_LABELS[next]}`);
      setErrMsg('');
      setCursor(0);
    }
  });

  // 按当前工具的 required 过滤 + 决定 ☑/☐
  const visible = rules.filter((r) => {
    const req = r.requiredByTool?.[tool] ?? false;
    if (filter === 'all') return true;
    if (filter === 'domain') return r.domain;
    return !req;
  });
  return (
    <Box flexDirection="column">
      <Text bold>规则管理 — 工具: {TOOL_LABELS[tool]}（t 切换，f 过滤，Space 切换装载，r 刷新）</Text>
      {visible.map((r, i) => {
        const req = r.requiredByTool?.[tool] ?? false;
        return (
          <Text key={r.id} color={i === cursor ? 'green' : 'white'} bold={i === cursor}>
            {req ? '☑' : '☐'} {r.id}  {r.scope === 'all' ? '全局' : r.scope} {r.domain ? '[领域]' : ''}
          </Text>
        );
      })}
      {msg ? <Text color="yellow">{msg}</Text> : null}
      {errMsg ? <Text color="red">{errMsg}</Text> : null}
    </Box>
  );
}

module.exports = { Rules };
