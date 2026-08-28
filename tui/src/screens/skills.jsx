// tui/src/screens/skills.jsx
const React = require('react');
const { useState, useEffect } = React;
const { Box, Text, useInput } = require('ink');
const { aiwsJson, runAiws } = require('../lib/aiws');

function Skills() {
  const [skills, setSkills] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [selectedName, setSelectedName] = useState(null);
  const [scope, setScope] = useState('global');
  const [msg, setMsg] = useState('');
  const detail = selectedName ? skills.find((skill) => skill.name === selectedName) ?? null : null;
  const load = async () => {
    const r = await aiwsJson(['skills', 'list']);
    setSkills(r.data?.skills ?? []);
  };
  useEffect(() => { load(); }, []);

  useInput(async (input, key) => {
    if (detail) {
      if (input === 'q' || key.escape) { setSelectedName(null); setMsg(''); }
      if (input === 'l') {
        await runAiws(['skills', 'link', scope, detail.name]);
        await load(); setMsg(`已链接 ${detail.name}（${scope}）`);
      }
      if (input === 'u') {
        await runAiws(['skills', 'unlink', scope, detail.name]);
        await load(); setMsg(`已卸载 ${detail.name}（${scope}）`);
      }
      if (input === 's') setScope((v) => (v === 'global' ? 'project' : 'global'));
    } else {
      if (key.downArrow) setCursor((c) => Math.min(skills.length - 1, c + 1));
      if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
      if (input === '\r' && skills[cursor]) { setSelectedName(skills[cursor].name); setMsg(''); }
      if (input === 'r') await load();
    }
  });

  if (detail) return (
    <Box flexDirection="column">
      <Text bold>{detail.name}</Text>
      <Text>{detail.description}</Text>
      <Box marginTop={1}>
        {Object.entries(detail.link_status ?? {}).map(([t, st]) => {
          // 三态：managed=已链接 / conflict=同名非管理目标 / missing=未链接
          const g = st?.global ?? 'missing';
          const p = st?.project ?? 'missing';
          const linked = g === 'managed' && p === 'managed'
            ? 'global+project'
            : g === 'managed' ? 'global' : p === 'managed' ? 'project' : '未链接';
          const conflict = g === 'conflict' || p === 'conflict';
          return <Text key={t} marginRight={2}>{t}: {linked}{conflict ? '(冲突)' : ''}</Text>;
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>当前操作范围（scope）：{scope}</Text>
      </Box>
      <Text dimColor> l=链接({scope})  u=卸载({scope})  s=切换scope  q/Esc=返回</Text>
      {msg ? <Text color="yellow">{msg}</Text> : null}
    </Box>
  );
  return (
    <Box flexDirection="column">
      <Text bold>技能（Enter=详情  r=刷新）</Text>
      {skills.map((s, i) => (
        <Text key={s.name} color={i === cursor ? 'green' : 'white'} bold={i === cursor}>
          {s.name}  {(s.description || '').slice(0, 50)}
        </Text>
      ))}
      {msg ? <Text color="yellow">{msg}</Text> : null}
    </Box>
  );
}
module.exports = { Skills };
