// tui/src/screens/mcp.jsx
const React = require('react');
const { useState, useEffect } = React;
const { Box, Text, useInput } = require('ink');
const { aiwsJson, runAiws } = require('../lib/aiws');

function Mcp() {
  const [servers, setServers] = useState([]);
  const [mode, setMode] = useState('list'); // list|add|confirm-del
  const [cursor, setCursor] = useState(0);
  const [name, setName] = useState('');
  const [cmd, setCmd] = useState('');
  const [field, setField] = useState('name'); // name|cmd 当前输入字段
  const [msg, setMsg] = useState('');
  const load = async () => {
    const r = await aiwsJson(['mcp', 'list']);
    setServers(r.data?.servers ?? []);
  };
  useEffect(() => { load(); }, []);

  useInput(async (input, key) => {
    if (mode === 'list') {
      if (key.downArrow) setCursor((c) => Math.min(servers.length - 1, c + 1));
      if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
      if (input === 'a') { setMode('add'); setName(''); setCmd(''); setField('name'); }
      if (input === 'd' && servers[cursor]) setMode('confirm-del');
      if (input === 'r') await load();
    } else if (mode === 'confirm-del') {
      if (input === 'y') {
        const s = servers[cursor];
        const res = await runAiws(['mcp', 'remove', s.name]);
        setMsg(res.code === 0 ? `已删除 ${s.name}` : res.stderr.trim());
        await load(); setMode('list');
      }
      if (input === 'n' || input === 'b') setMode('list');
    } else if (mode === 'add') {
      // 简化逐字符输入：name 输入后回车切到 command，再回车提交。
      // 取消键用 b（q 与 App 全局退出冲突——按下 q 会退出整个 TUI）。
      if (input === '\r' && field === 'name' && name) setField('cmd');
      else if (input === '\r' && field === 'cmd' && cmd) {
        const res = await runAiws(['mcp', 'add', name, cmd]);
        setMsg(res.code === 0 ? `已添加 ${name}` : res.stderr.trim());
        await load(); setMode('list');
      }
      if (input === 'b') setMode('list');
      if (input !== '\r' && input !== 'b') {
        if (field === 'name') setName((n) => n + input);
        else setCmd((c) => c + input);
      }
    }
  });

  if (mode === 'add') return (
    <Box flexDirection="column">
      <Text bold>添加 MCP（输入 name 回车 → 输入 command 回车提交，b 取消）</Text>
      <Text>name: {name}</Text>
      <Text>command: {cmd}</Text>
      <Text color="green">{field === 'name' ? '← 正在输入 name' : '← 正在输入 command'}</Text>
    </Box>
  );
  if (mode === 'confirm-del') return (
    <Box flexDirection="column">
      <Text bold>删除 {servers[cursor]?.name}？y=确认 n=取消</Text>
    </Box>
  );
  return (
    <Box flexDirection="column">
      <Text bold>MCP 服务器（a=添加 d=删除 r=刷新）</Text>
      {servers.map((s, i) => (
        <Text key={s.name} color={i === cursor ? 'green' : 'white'} bold={i === cursor}>
          {s.name}  {s.command}
        </Text>
      ))}
      {msg ? <Text color="yellow">{msg}</Text> : null}
    </Box>
  );
}
module.exports = { Mcp };
