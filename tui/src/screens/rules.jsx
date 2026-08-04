// tui/src/screens/rules.jsx
const React = require('react');
const { useState, useEffect, useCallback } = React;
const { Box, Text, useInput } = require('ink');
const { listRules, setRequired } = require('../lib/rules');
const { runAiws } = require('../lib/aiws');

function Rules() {
  const [rules, setRules] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState('all'); // all|domain|disabled
  const [msg, setMsg] = useState('');
  const refresh = useCallback(() => setRules(listRules()), []);

  useEffect(() => { refresh(); }, [refresh]);

  useInput(async (input, key) => {
    if (key.downArrow) setCursor((c) => Math.min(rules.length - 1, c + 1));
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (input === ' ') {
      const r = rules[cursor]; if (!r) return;
      setRequired(r.id, r.domain, !r.required);
      setMsg(`切换 ${r.id} → ${!r.required ? '已应用' : '按需'}`);
      await runAiws(['sync', '--tool', 'cursor']);
      refresh();
    }
    if (input === 'f') setFilter({ all: 'domain', domain: 'disabled', disabled: 'all' }[filter]);
    if (input === 'r') refresh();
  });

  const visible = rules.filter((r) =>
    filter === 'all' ? true : filter === 'domain' ? r.domain : !r.required);
  return (
    <Box flexDirection="column">
      <Text bold>规则管理（过滤: {filter}，f 切换，Space 切换装载，r 刷新）</Text>
      {visible.map((r, i) => (
        <Text key={r.id} color={i === cursor ? 'green' : 'white'} bold={i === cursor}>
          {r.required ? '☑' : '☐'} {r.id}  {r.scope === 'all' ? '全局' : r.scope} {r.domain ? '[领域]' : ''}
        </Text>
      ))}
      {msg ? <Text color="yellow">{msg}</Text> : null}
    </Box>
  );
}
module.exports = { Rules };
