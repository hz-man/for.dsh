// 还原详情页的可见结构，用于确认页面上"人眼能看到什么"。
// 用法：node scripts/inspect-page.mjs <slug> [...]
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const slugs = process.argv.slice(2);

const text = (s) =>
  (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

for (const slug of slugs) {
  const file = path.join(root, 'dist', 'works', slug, 'index.html');
  let html;
  try {
    html = await readFile(file, 'utf8');
  } catch {
    console.log(`===== /works/${slug}/  ✗ 不存在 =====\n`);
    continue;
  }

  console.log(`===== /works/${slug}/ =====`);
  console.log('h1       :', text((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) ?? [])[1]) || '(无)');

  const summary = (html.match(/class="summary"[^>]*>([\s\S]*?)<\/p>/) ?? [])[1];
  console.log('summary  :', text(summary) || '(空 —— works.json 里 summary 未填)');

  const meta = [...html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)].map(
    (m) => `${text(m[1])}=${text(m[2])}`,
  );
  console.log('元信息   :', meta.join(' | ') || '(无)');

  const videos = [...html.matchAll(/<video[\s\S]*?<\/video>/g)].map((m) => m[0]);
  console.log(`<video>  : ${videos.length} 个`);

  const caps = [...html.matchAll(/<figcaption>([\s\S]*?)<\/figcaption>/g)].map((m) => text(m[1]));
  if (caps.length) {
    console.log(`视频条目 : ${caps.length} 条`);
    for (const [i, cap] of caps.slice(0, 4).entries()) {
      console.log(`           ${String(i + 1).padStart(2)}. ${cap}`);
    }
    if (caps.length > 4) console.log(`           ... 其余 ${caps.length - 4} 条`);
  }

  const imgs = [...html.matchAll(/<img[^>]*>/g)].map((m) => m[0]);
  console.log(`<img>    : ${imgs.length} 个`);
  if (imgs[0]) {
    const src = (imgs[0].match(/src="([^"]+)"/) ?? [])[1];
    const alt = (imgs[0].match(/alt="([^"]*)"/) ?? [])[1];
    console.log(`           首个: alt="${alt}" src=${src}`);
  }

  const empty = html.includes('还没有素材') || html.includes('视频还没处理');
  console.log('占位提示 :', empty ? '有（说明该作品没素材）' : '无');
  console.log('');
}
