// 诊断 .gitignore 为什么没匹配上中文目录名。
// 用法：node scripts/diagnose-gitignore.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const raw = readFileSync('.gitignore');

console.log('=== .gitignore 头部字节 ===');
console.log('前 6 字节:', [...raw.subarray(0, 6)].map((b) => '0x' + b.toString(16).padStart(2, '0')).join(' '));
const hasBom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
console.log('有 UTF-8 BOM :', hasBom);
console.log('（BOM 会让第一行规则失效，因为规则前多了 \\uFEFF 字符）');

console.log('\n=== 逐行列出（显示不可见字符）===');
const lines = raw.toString('utf8').split(/\r?\n/);
lines.forEach((line, i) => {
  const codes = [...line].slice(0, 24).map((c) => {
    const cp = c.codePointAt(0);
    return cp > 126 || cp < 32 ? `\\u${cp.toString(16).padStart(4, '0')}` : c;
  });
  const marker = /图片|视频/.test(line) ? '   ← 中文规则' : '';
  console.log(`  ${String(i + 1).padStart(2)}: ${JSON.stringify(line).slice(0, 46).padEnd(48)}${marker}`);
  if (marker) console.log(`      原始码点: ${codes.join('')}`);
});

console.log('\n=== 问 git：这些路径被哪条规则忽略？===');
const probes = ['图片/1/4.png', '视频/二手车信息流/1.mp4', 'tools/ffmpeg.exe', 'shots/home.png'];
for (const p of probes) {
  try {
    const out = execFileSync('git', ['check-ignore', '-v', '--', p], { encoding: 'utf8' }).trim();
    console.log(`  ✓ 已忽略  ${p}`);
    console.log(`      ${out}`);
  } catch {
    console.log(`  ✗ 未忽略  ${p}   ← 会被提交`);
  }
}

console.log('\n=== git 是否认为它有 .gitignore ===');
try {
  const ls = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--directory'], {
    encoding: 'utf8',
  });
  const dirs = ls.split('\n').filter(Boolean);
  console.log('未被忽略的顶层条目：');
  for (const d of dirs) console.log('   ', JSON.stringify(d));
} catch (err) {
  console.log('查询失败:', err.message);
}
