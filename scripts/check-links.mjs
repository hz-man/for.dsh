// 抽查产物内部一致性：HTML 里引用的图片/视频 URL 是否真的存在于 dist。
// 用法：node scripts/check-links.mjs [baseUrl]
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const pages = await walk(dist);
  let checked = 0;
  const missing = [];

  for (const page of pages) {
    const html = await readFile(page, 'utf8');
    const refs = new Set();

    for (const m of html.matchAll(/(?:src|srcset|poster|href)="([^"]+)"/g)) {
      // srcset 里是多条 "url 1x, url 2x"
      for (const part of m[1].split(',')) {
        const url = part.trim().split(/\s+/)[0];
        if (url.startsWith('/') && !url.startsWith('//')) refs.add(url);
      }
    }

    for (const url of refs) {
      const clean = url.split('?')[0].split('#')[0];
      if (clean.endsWith('/')) continue; // 页面链接交给路由，不在这里查
      checked++;
      if (!(await exists(path.join(dist, clean)))) {
        missing.push({ page: path.relative(dist, page), url });
      }
    }
  }

  console.log(`检查 ${pages.length} 个页面、${checked} 个资源引用`);

  if (!missing.length) {
    console.log('✓ 所有引用的资源都存在于 dist');
    return;
  }

  const byUrl = new Map();
  for (const item of missing) {
    if (!byUrl.has(item.url)) byUrl.set(item.url, []);
    byUrl.get(item.url).push(item.page);
  }

  console.log(`\n✗ ${byUrl.size} 个资源缺失（出现在 ${missing.length} 处引用）：`);
  for (const [url, pages] of [...byUrl].slice(0, 15)) {
    console.log(`  ${url}`);
    console.log(`      出现于: ${[...new Set(pages)].slice(0, 3).join(', ')}`);
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
