// 把 src/assets/<slug>/ 里的 PNG/JPG 源图就地转成 WebP，用于缩减仓库体积。
//
// 为什么需要这一步：
//   Astro 需要在构建时读取"源图"来生成多尺寸变体，所以 src/assets/ 必须进 git。
//   但这批素材是 1536×2048、每张 3-6MB 的 PNG，133 张就是约 500MB。
//   转成 WebP 后同样尺寸仍有 8-10 倍压缩，且这是有损的。
//
// 保真度说明（重要）：
//   此操作不可逆。转换前请确认原始素材仍在 图片/ 目录里（那份没被改动）。
//   若要完全避免有损，改用 Git LFS 承载 PNG，而不是跑这个脚本。
//
// 用法：
//   node scripts/optimize-sources.mjs           # 预演，只报告
//   node scripts/optimize-sources.mjs --write   # 实际转换并删除原文件
//   node scripts/optimize-sources.mjs --write --quality=90
import { readdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const quality = Number(args.find((a) => a.startsWith('--quality='))?.slice(10) ?? 82);

const root = path.resolve(import.meta.dirname, '..');
const assetsDir = path.join(root, 'src', 'assets');
const SOURCE_EXT = new Set(['.png', '.jpg', '.jpeg']);

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

async function findSources(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await findSources(full)));
    else if (SOURCE_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

async function main() {
  const files = await findSources(assetsDir);
  if (!files.length) {
    console.log('src/assets/ 里没有 PNG/JPG，无需处理。');
    return;
  }

  let before = 0;
  let after = 0;
  let converted = 0;
  const failures = [];

  for (const file of files) {
    const srcSize = (await stat(file)).size;
    before += srcSize;

    const target = file.replace(/\.(png|jpe?g)$/i, '.webp');

    // 已有同名 webp 就直接跳过
    try {
      const existing = await stat(target);
      after += existing.size;
      continue;
    } catch {
      /* 不存在，继续 */
    }

    const buf = await readFile(file);
    const image = sharp(buf);
    const meta = await image.metadata();

    const out = await image
      .webp({ quality, effort: 5 })
      .toBuffer();

    if (!WRITE) {
      after += out.length;
      converted++;
      continue;
    }

    await writeFile(target, out);
    await rm(file, { force: true });
    after += out.length;
    converted++;

    const ratio = ((1 - out.length / srcSize) * 100).toFixed(0);
    console.log(
      `  ${path.relative(root, file).padEnd(34)} ` +
        `${mb(srcSize).padStart(9)} → ${mb(out.length).padStart(8)}  (-${ratio}%)  ` +
        `${meta.width}×${meta.height}`,
    );
  }

  console.log(`\n${WRITE ? '已转换' : '预演'}：${converted} 张`);
  console.log(`体积：${mb(before)} → ${mb(after)}` + (before ? `  (-${((1 - after / before) * 100).toFixed(0)}%)` : ''));

  if (!WRITE) {
    console.log('\n这是预演。确认无误后加 --write 实际执行（会删除原 PNG，不可逆）。');
    console.log('原始素材仍在 图片/ 目录，未受影响。');
  }

  if (failures.length) {
    console.log(`\n失败 ${failures.length} 个：`);
    for (const f of failures.slice(0, 5)) console.log('  ' + f);
  }
}

main().catch((err) => {
  console.error('失败：', err.stack ?? err.message);
  process.exit(1);
});
