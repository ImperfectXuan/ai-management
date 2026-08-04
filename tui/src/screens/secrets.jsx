// tui/src/screens/secrets.jsx
const React = require('react');
const { useState, useEffect } = React;
const { Box, Text } = require('ink');
const { aiwsJson } = require('../lib/aiws');

function Secrets() {
  const [list, setList] = useState(null);
  const [audit, setAudit] = useState(null);
  const load = async () => {
    const [l, a] = await Promise.all([
      aiwsJson(['secrets', 'list']),
      aiwsJson(['secrets', 'audit']),
    ]);
    setList(l.data); setAudit(a.data);
  };
  useEffect(() => { load(); }, []);

  return (
    <Box flexDirection="column">
      <Text bold>密钥（只读）</Text>
      {list?.vault_ready === false ? (
        <Text color="yellow">vault 未初始化。安装依赖: brew install age oath-toolkit，然后 aiws setup</Text>
      ) : null}
      <Text>vault_ready: {String(list?.vault_ready)}</Text>
      <Text>密钥: {list?.error || '（--json 不解密，密钥枚举需 CLI 手动操作）'}</Text>
      <Box marginTop={1}>
        <Text bold>各工具可用密钥:</Text>
      </Box>
      {(audit?.tools ?? []).map((t) => (
        <Text key={t.tool}>{t.tool}: {t.allowed.length ? t.allowed.join(', ') : '(无)'}</Text>
      ))}
    </Box>
  );
}
module.exports = { Secrets };
