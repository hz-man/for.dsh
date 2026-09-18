// 构建产物体检：不依赖浏览器，直接检查生成的 HTML 里关键元素是否齐全。
// 用法：node scripts/check-build.mjs
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

const pick = (html, re) => (html.match(re) ?? [])[1] ?? '(缺失)';

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else total += (await stat(full)).size;
  }
  return total;
}

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

async function main() {
  const pages = ['index.html', 'works/index.html', 'works/1/index.html', 'about/index.html'];
  let ok = true;

  for (const page of pages) {
    const file = path.join(dist, page);
    let html;
    try {
      html = await readFile(file, 'utf8');
    } catch {
      console.log(`✗ ${page} 不存在`);
      ok = false;
      continue;
    }

    const title = pick(html, /<title>(.*?)<\/title>/);
    const desc = pick(html, /<meta name="description" content="(.*?)"/);
    const canonical = pick(html, /rel="canonical" href="(.*?)"/);
    const imgs = [...html.matchAll(/<img[^>]*>/g)].map((m) => m[0]);
    const withSrcset = imgs.filter((t) => /srcset=/.test(t)).length;
    const lazy = imgs.filter((t) => /loading="lazy"/).test ? imgs.filter((t) => /loading="lazy"/.test(t)).length : 0;
    const formats = new Set(
      imgs.map((t) => (t.match(/\.(webp|avif|png|jpe?g)/i) ?? [])[1]?.toLowerCase()).filter(Boolean),
    );

    console.log(`\n▸ ${page}`);
    console.log(`  title      ${title}`);
    console.log(`  description ${desc}`);
    console.log(`  canonical  ${canonical}`);
    console.log(`  <img>      ${imgs.length} 个，其中 ${withSrcset} 个带 srcset，${lazy} 个 lazy`);
    console.log(`  图片格式   ${[...formats].join(', ') || '无'}`);

    if (title === '(缺失)' || canonical === '(缺失)') ok = false;
    if (imgs.length > 0 && withSrcset === 0) {
      console.log('  ⚠ 有图片但没有任何 srcset —— 响应式优化没生效');
      ok = false;
    }
  }

  // 详情页单独检查：视频页与图片页结构不同
  for (const slug of ['used-car-feed', 'ai-modeling']) {
    const file = path.join(dist, 'works', slug, 'index.html');
    try {
      const html = await readFile(file, 'utf8');
      const videos = [...html.matchAll(/<video[^>]*>/g)].map((m) => m[0]);
      const none = videos.filter((t) => /preload="none"/.test(t)).length;
      const posters = videos.filter((t) => /poster=/.test(t)).length;
      console.log(`\n▸ works/${slug}/index.html`);
      console.log(`  <video>    ${videos.length} 个，preload="none" ${none} 个，带 poster ${posters} 个`);
      if (videos.length && none !== videos.length) {
        console.log('  ⚠ 有视频没设 preload="none"，首屏会预下载视频');
        ok = false;
      }
    } catch {
      console.log(`\n▸ works/${slug}/index.html  ✗ 不存在`);
      ok = false;
    }
  }

  const astroAssets = path.join(dist, '_astro');
  let variants = 0;
  let assetBytes = 0;
  let heavy = [];
  try {
    const files = await readdir(astroAssets);
    variants = files.length;
    assetBytes = await dirSize(astroAssets);
    // 判据分两种：
    //  - PNG 超过 400KB：几乎一定是"原图直出"（ImageMetadata.src 被当 og:image 用），是错误
    //  - 其它格式超过 1.2MB：只是尺寸较大，属正常，这里仅提示
    for (const name of files) {
      const full = path.join(astroAssets, name);
      const size = (await stat(full)).size;
      const isPng = name.toLowerCase().endsWith('.png');
      if (isPng && size > 400 * 1024) heavy.push({ name, size, fatal: true });
      else if (size > 1.2 * 1024 * 1024) heavy.push({ name, size, fatal: false });
    }
  } catch {
    /* 没有 _astro 目录 */
  }

  console.log(`\n─── 汇总 ───`);
  console.log(`dist 总大小      ${mb(await dirSize(dist))}`);
  console.log(`_astro 产物      ${variants} 个文件 / ${mb(assetBytes)}`);

  if (heavy.length) {
    const fatal = heavy.filter((h) => h.fatal);
    console.log(`\n${fatal.length ? '⚠' : 'ℹ'} ${heavy.length} 个产物偏大（最大的几个）：`);
    for (const item of heavy.sort((a, b) => b.size - a.size).slice(0, 5)) {
      console.log(`    ${mb(item.size).padStart(9)}  ${item.name}${item.fatal ? '  ← PNG 原图直出' : ''}`);
    }
    if (fatal.length) {
      console.log('  这是错误：检查是不是把 ImageMetadata.src 当 og:image 用了，');
      console.log('  应该像 [slug].astro 那样用 getImage() 生成小尺寸分享图。');
      ok = false;
    } else {
      console.log('  （正常范围：高分辨率 WebP 的两倍图，浏览器只按需取用）');
    }
  }

  console.log(ok ? '\n✓ 检查通过' : '\n✗ 有问题，见上面的 ⚠');

  if (!ok) process.exitCode = 1;
}

main();
