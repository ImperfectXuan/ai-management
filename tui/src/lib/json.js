function parseResult(result) {
  try {
    const obj = JSON.parse(result.stdout);
    if (obj && obj.error && result.code !== 0) return { error: obj.error };
    return { data: obj };
  } catch {
    return { error: `解析失败: ${(result.stderr || result.stdout).trim().slice(0, 200)}` };
  }
}
module.exports = { parseResult };
