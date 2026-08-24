// tui/src/screens/effective.jsx
const React = require('react');
const { useState } = React;
const fs = require('fs');
const path = require('path');
const { Box, Text, useInput } = require('ink');
const { getRoot } = require('../lib/aiws');

// 懒求值:避免模块加载期就调 getRoot(),让测试可在 chdir 后无需 reload
// M12 / D3 修复
function toolDir(tool) {
  return path.join(getRoot(), tool === 'Cursor' ? '.cursor' : '.trae', 'rules');
}

function Effective() {
  const [tool, setTool] = useState('Cursor');
  const [cursor, setCursor] = useState(0);
  const dir = toolDir(tool);
  const files = (() => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.mdc') || f.endsWith('.md'))
      .sort();
  })();
  const cur = cursor >= files.length ? null : files[cursor];

  useInput((input, key) => {
    if (input === 't') { setTool((t) => (t === 'Cursor' ? 'Trae' : 'Cursor')); setCursor(0); }
    if (key.downArrow) setCursor((c) => Math.min(files.length - 1, c + 1));
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
  });

  const front = cur ? fs.readFileSync(path.join(dir, cur), 'utf8').split('---')[1] || '' : '';
  return (
    <Box flexDirection="column">
      <Text bold>生效规则（{tool}，t 切换 Cursor/Trae）</Text>
      {files.map((f, i) => (
        <Text key={f} color={i === cursor ? 'green' : 'white'} bold={i === cursor}>{f}</Text>
      ))}
      {files.length === 0 ? <Text dimColor>未找到生成文件（先运行 aiws sync）</Text> : null}
      {cur ? <Box borderStyle="single" borderColor="gray" paddingX={1}><Text>{front.trim()}</Text></Box> : null}
    </Box>
  );
}
module.exports = { Effective };
