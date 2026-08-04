// tui/src/screens/dashboard.jsx
const React = require('react');
const { useState, useEffect } = React;
const { Box, Text, useInput } = require('ink');
const { aiwsJson, runAiws } = require('../lib/aiws');

function Dashboard() {
  const [mcp, setMcp] = useState(null);
  const [skills, setSkills] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');

  useEffect(() => { load(); }, []);
  async function load() {
    const [m, s] = await Promise.all([aiwsJson(['mcp', 'list']), aiwsJson(['skills', 'list'])]);
    setMcp(m.data); setSkills(s.data);
  }
  useInput(async (input) => {
    if (input === 's') {
      setBusy(true); const res = await runAiws(['sync']); setBusy(false);
      setLog(res.stderr || res.stdout); await load();
    }
    if (input === 'v') {
      setBusy(true); const res = await runAiws(['validate']); setBusy(false);
      setLog((res.stderr || res.stdout).slice(-1200));
    }
    if (input === 'r') { setLog(''); await load(); }
  });

  const mcpCount = mcp?.servers?.length ?? '-';
  const skillCount = skills?.skills?.length ?? '-';
  return (
    <Box flexDirection="column">
      <Text bold>状态总览</Text>
      <Box flexDirection="row">
        {['Cursor', 'Trae', 'Claude', 'Codex'].map((t) => (
          <Box key={t} borderStyle="round" borderColor="green" flexDirection="column" paddingX={1} marginRight={1}>
            <Text bold>{t}</Text>
            <Text>规则: ✓</Text>
            <Text>技能: {skillCount}</Text>
            <Text>MCP: {mcpCount}</Text>
          </Box>
        ))}
      </Box>
      <Text dimColor> s=同步  v=验证  r=刷新</Text>
      {busy ? <Text color="yellow">运行中...</Text> : null}
      {log ? <Box borderStyle="single" borderColor="gray"><Text>{log}</Text></Box> : null}
    </Box>
  );
}
module.exports = { Dashboard };