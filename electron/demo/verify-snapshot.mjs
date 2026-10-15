import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const manifestFile = path.resolve(process.argv[2] ?? 'manifest.json');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
const source = path.join(path.dirname(manifestFile), 'source');
const digest = (content) => createHash('sha256').update(content).digest('hex');
if (digest(JSON.stringify(manifest.files)) !== manifest.sourceHash) throw new Error('清单内容指纹不匹配');
for (const file of manifest.files) {
  if (path.isAbsolute(file.path) || file.path.split(/[\\/]/).includes('..')) throw new Error('清单路径越界');
  const target = path.join(source, file.path);
  const stat = await lstat(target);
  if (!stat.isFile() || (stat.mode & 0o777) !== file.mode || digest(await readFile(target)) !== file.sha256) {
    throw new Error(`源码内容或权限已变化：${file.path}`);
  }
}
console.log(`快照验证通过：${manifest.files.length} 个文件；内容指纹 ${manifest.sourceHash}`);
