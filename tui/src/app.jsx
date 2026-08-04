const React = require('react');
const { useState, useEffect } = React;
const { Box, Text, useInput } = require('ink');

const TABS = ['仪表盘', '规则', 'MCP', '技能', '密钥', '生效规则'];

function App() {
  const [tab, setTab] = useState(0);
  useInput((input) => {
    if (input === 'q') process.exit(0);
    if (input >= '1' && input <= '6') setTab(Number(input) - 1);
  });
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">AI Workspace TUI</Text>
      </Box>
      <Box marginTop={1}>
        <Text>当前页: {TABS[tab]}（占位，后续任务实现）</Text>
      </Box>
      <Box marginTop={1} borderStyle="single" borderColor="gray">
        {TABS.map((t, i) => (
          <Text key={t} color={i === tab ? 'green' : 'white'} bold={i === tab}>
            {i === tab ? ` ${t} ` : ` ${t} `}
          </Text>
        ))}
      </Box>
      <Text dimColor> 1-6 切换 | q 退出 | r 刷新 | ? 帮助</Text>
    </Box>
  );
}

module.exports = { App };
