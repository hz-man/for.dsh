// 部署前审查：列出 git 会跟踪的全部文件，按顶层目录归类，
// 并明确标出「绝不应该提交」的目录是否混进来了。
//
// 用法：node scripts/git-audit.mjs
import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

/** 这些目录/模式绝不能被提交 */
const FORBIDDEN = [
  { pattern: /^图片\//, why: '原始图片素材（约 500MB）' },
  { pattern: /^视频\//, why: '原始视频素材（约 323MB）' },
  { pattern: /^tools\//, why: 'ffmpeg 二进制（约 158MB）' },
  { pattern: /^node_modules\//, why: '依赖' },
  { pattern: /^dist\//, why: '构建产物' },
  { pattern: /^shots\//, why: '截图片' },
  { pattern: /^\.astro\//, why: 'Astro 生成物' },
  { pattern: /^media-src\//, why: '素材副本' },
];

function decodeGitPath(raw) {
  let p = raw.trim();
  if (p.startsWith('"') && p.endsWith('"')) {
    // git 对非 ASCII 路径会加引号并转义八进制（"a\346\226\207"），用 JSON 解不了八进制，手工还原
    const inner = p.slice(1, -1);
    const bytes = [];
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '\\' && inner[i + 1] === '\\') {
        bytes.push(0x5c);
        i++;
      } else if (inner[i] === '\\' && /[0-7]/.test(inner[i + 1] ?? '')) {
        bytes.push(parseInt(inner.slice(i + 1, i + 4), 8));
        i += 3;
      } else {
        bytes.push(inner.charCodeAt(i));
      }
    }
    return Buffer.from(bytes).toString('utf8');
  }
  return p;
}

const raw = execSync('git status --porcelain --untracked-files=all', {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
});

const entries = raw
  .split('\n')
  .filter((l) => l.trim())
  .map((line) => {
    const status = line.slice(0, 2).trim();
    const p = decodeGitPath(line.slice(3));
    return { status, path: p.replace(/\\/g, '/') };
  });

console.log(`git 可见条目：${entries.length}\n`);

const byTop = new Map();
for (const e of entries) {
  const top = e.path.split('/')[0] + (e.path.includes('/') ? '/' : '');
  byTop.set(top, (byTop.get(top) ?? 0) + 1);
}

console.log('按顶层归类：');
for (const [top, count] of [...byTop].sort((a, b) => b[1] - a[1])) {
  const bad = FORBIDDEN.find((f) => f.pattern.test(top));
  console.log(`  ${String(count).padStart(5)}  ${top}${bad ? `   ✗ 禁止提交（${bad.why}）` : ''}`);
}

console.log('\n禁止项检查：');
let violations = 0;
for (const rule of FORBIDDEN) {
  const hits = entries.filter((e) => rule.pattern.test(e.path));
  if (hits.length) {
    violations += hits.length;
    console.log(`  ✗ ${rule.pattern.source} → ${hits.length} 个文件（${rule.why}）`);
    for (const h of hits.slice(0, 3)) console.log(`      ${h.path}`);
  }
}
if (!violations) console.log('  ✓ 没有禁止项');

// 体积统计
let totalBytes = 0;
let biggest = [];
for (const e of entries) {
  try {
    const size = statSync(path.join(root, e.path)).size;
    totalBytes += size;
    biggest.push({ size, path: e.path });
  } catch {
    /* 已删除 */
  }
}
biggest.sort((a, b) => b.size - a.size);
console.log(`\n可见文件总体积：${(totalBytes / 1048576).toFixed(1)} MB`);
console.log('最大的 6 个：');
for (const b of biggest.slice(0, 6)) {
  console.log(`  ${(b.size / 1048576).toFixed(2).padStart(7)} MB  ${b.path}`);
}

if (violations) {
  console.log(`\n✗ 发现 ${violations} 个不该提交的文件，先修 .gitignore，别提交。`);
  process.exitCode = 1;
} else {
  console.log('\n✓ 审查通过，可以提交');
}
