// tui/src/screens/skills.jsx
const React = require('react');
const { useState, useEffect } = React;
const { Box, Text, useInput } = require('ink');
const { aiwsJson, runAiws } = require('../lib/aiws');

function Skills() {
  const [skills, setSkills] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [selectedName, setSelectedName] = useState(null);
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
        await runAiws(['skills', 'link', 'global', detail.name]);
        await load(); setMsg(`已链接 ${detail.name}（global）`);
      }
      if (input === 'u') {
        await runAiws(['skills', 'unlink', 'global', detail.name]);
        await load(); setMsg(`已卸载 ${detail.name}（global）`);
      }
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
        {['codex', 'claude', 'cursor', 'trae'].map((t) => {
          const st = detail.link_status?.[t];
          if (!st) return null;
          const scope = st.global && st.project ? 'global+project' : st.global ? 'global' : st.project ? 'project' : '未链接';
          return <Text key={t} marginRight={2}>{t}: {scope}</Text>;
        })}
      </Box>
      <Text dimColor> l=链接(global)  u=卸载(global)  q/Esc=返回</Text>
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
