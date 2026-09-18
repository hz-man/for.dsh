// 校验构建产物里的绝对地址是否正确（canonical / og:url / sitemap）。
// 用法：node scripts/check-urls.mjs [期望域名]
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const expected = process.argv[2] ?? null;

const attr = (html, re) => (html.match(re) ?? [])[1] ?? '(缺失)';

async function main() {
  const files = {
    home: path.join(root, 'dist', 'index.html'),
    detail: path.join(root, 'dist', 'works', '1', 'index.html'),
    sitemap: path.join(root, 'dist', 'sitemap-0.xml'),
  };

  let ok = true;
  const home = await readFile(files.home, 'utf8');
  const detail = await readFile(files.detail, 'utf8');

  console.log('首页');
  console.log('  canonical :', attr(home, /rel="canonical" href="([^"]+)"/));
  console.log('  og:url    :', attr(home, /property="og:url" content="([^"]+)"/));
  console.log('  og:image  :', attr(home, /property="og:image" content="([^"]+)"/));

  console.log('\n详情页 /works/1/');
  console.log('  canonical :', attr(detail, /rel="canonical" href="([^"]+)"/));
  console.log('  og:image  :', attr(detail, /property="og:image" content="([^"]+)"/));

  let sitemapLocs = [];
  try {
    const sitemap = await readFile(files.sitemap, 'utf8');
    sitemapLocs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    console.log('\nsitemap');
    console.log('  条目数    :', sitemapLocs.length);
    for (const loc of sitemapLocs.slice(0, 3)) console.log('             ' + loc);
  } catch {
    console.log('\nsitemap-0.xml 不存在');
    ok = false;
  }

  // 全站不应再出现占位域名
  const all = home + detail + sitemapLocs.join('');
  if (/example\.com/.test(all)) {
    console.log('\n✗ 产物里仍有 example.com 占位域名');
    ok = false;
  } else {
    console.log('\n✓ 没有残留的 example.com 占位域名');
  }

  if (expected) {
    const hits = [home, detail, sitemapLocs.join('')].filter((t) => t.includes(expected)).length;
    if (hits === 3) {
      console.log(`✓ canonical / og:url / sitemap 都指向 ${expected}`);
    } else {
      console.log(`✗ 只有 ${hits}/3 处指向 ${expected}`);
      ok = false;
    }
  }

  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
