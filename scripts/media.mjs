// ============================================================================
// 素材整理管线：pnpm media
//
// 做三件事，全部可重复运行（幂等）：
//   1. 图片：把「图片/<folder>/*.png」按自然序拷成 src/assets/<slug>/001.png …（补零，避免排序混乱）
//   2. 视频：需要 ffmpeg 时，压缩成 web 友好的 MP4 + 抽出首帧 poster，输出到 public/media/videos/<slug>/
//   3. 把结果写回 src/data/media.json，供站点读取（works.json 保持你手写的内容不变）
//
// 参数：
//   --force      已存在的产出也重新生成
//   --only=<slug> 只处理某个作品
//   --no-video   跳过视频处理
// ============================================================================
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readdir, copyFile, writeFile, stat, rm, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const SKIP_VIDEO = args.includes('--no-video');
const ONLY = args.find((a) => a.startsWith('--only='))?.slice('--only='.length);

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn(...a);

// ---------------------------------------------------------------- ffmpeg 定位
function findTool(name) {
  const local = path.join(root, 'tools');
  if (existsSync(local)) {
    const stack = [local];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name.toLowerCase() === `${name}.exe`) return full;
      }
    }
  }
  const which = spawnSync('where', [name], { encoding: 'utf8', windowsHide: true });
  const first = which.stdout?.split(/\r?\n/).find(Boolean);
  return first ?? null;
}

// ------------------------------------------------------------------ 工具函数
async function listFiles(dir, kinds) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full, kinds)));
    } else if (kinds.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  // 以相对路径排序，保证 images/ 子目录里的文件也有确定顺序
  return files.sort((a, b) => collator.compare(path.relative(dir, a), path.relative(dir, b)));
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function probeVideo(ffprobe, file) {
  const res = spawnSync(
    ffprobe,
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,duration',
      '-show_entries', 'format=duration',
      '-of', 'json',
      file,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (res.status !== 0) return {};
  try {
    const json = JSON.parse(res.stdout);
    const stream = json.streams?.[0] ?? {};
    const duration = Number(stream.duration ?? json.format?.duration);
    return {
      width: Number(stream.width) || undefined,
      height: Number(stream.height) || undefined,
      duration: Number.isFinite(duration) ? duration : undefined,
    };
  } catch {
    return {};
  }
}

// -------------------------------------------------------------------- 图片处理
async function processImages(work, manifest) {
  const sourceDir = path.join(root, work.source);
  if (!existsSync(sourceDir)) {
    warn(`  ! 跳过：素材目录不存在 ${work.source}`);
    return [];
  }

  const files = await listFiles(sourceDir, IMAGE_EXT);
  if (!files.length) {
    // 视频目录里当然没有图片，这是正常情况，不算警告
    log(`  （无图片）`);
    return [];
  }

  const targetDir = path.join(root, 'src', 'assets', work.slug);
  await mkdir(targetDir, { recursive: true });

  const digits = Math.max(3, String(files.length).length);
  const names = [];

  for (const [index, file] of files.entries()) {
    const name = String(index + 1).padStart(digits, '0');
    const ext = path.extname(file).toLowerCase();
    const target = path.join(targetDir, `${name}${ext}`);
    const existing = existsSync(target);

    if (!existing || FORCE) {
      await copyFile(file, target);
    }
    names.push(name);
  }

  // 清掉上次生成、这次不再需要的文件（比如源图删了几张）
  const keep = new Set(files.map((_, i) => String(i + 1).padStart(digits, '0')));
  for (const entry of await readdir(targetDir)) {
    const base = entry.replace(/\.[^.]+$/, '');
    if (!keep.has(base)) {
      await rm(path.join(targetDir, entry), { force: true });
    }
  }

  manifest.images[work.slug] = names;
  log(`  图片 ${files.length} 张 → src/assets/${work.slug}/`);
  return names;
}

// -------------------------------------------------------------------- 视频处理
async function processVideos(work, manifest, ffmpeg, ffprobe) {
  const sourceDir = path.join(root, work.source);
  if (!existsSync(sourceDir)) {
    warn(`  ! 跳过：素材目录不存在 ${work.source}`);
    return [];
  }

  const files = await listFiles(sourceDir, VIDEO_EXT);
  if (!files.length) {
    // 图片目录里没有视频是常态；只有 ffmpeg 缺失才是需要提醒的问题
    log(`  （无视频）`);
    return [];
  }

  if (!ffmpeg || !ffprobe) {
    warn(
      `  ! 未找到 ffmpeg，跳过 ${files.length} 个视频。` +
        `\n    先运行：node scripts/install-ffmpeg.mjs`,
    );
    return [];
  }

  const targetDir = path.join(root, 'public', 'media', 'videos', work.slug);
  await mkdir(targetDir, { recursive: true });

  const digits = Math.max(3, String(files.length).length);
  const videos = [];

  for (const [index, file] of files.entries()) {
    const name = String(index + 1).padStart(digits, '0');
    const outName = `${name}.mp4`;
    const posterName = `${name}.jpg`;
    const outPath = path.join(targetDir, outName);
    const posterPath = path.join(targetDir, posterName);

    const meta = probeVideo(ffprobe, file);

    if (!existsSync(outPath) || FORCE) {
      // 目标：浏览器可直接播、体积可控。
      // 竖屏限高 1280、横屏限宽 1920，min() 保证不会把小视频放大。
      // -2 让另一边自动取偶数（H.264 要求），CRF 23 + faststart 支持边下边播。
      const isPortrait = Boolean(meta.width && meta.height && meta.height > meta.width);
      const vf = isPortrait
        ? `scale=-2:'min(1280,ih)':flags=lanczos`
        : `scale='min(1920,iw)':-2:flags=lanczos`;
      const res = spawnSync(
        ffmpeg,
        [
          '-y', '-hide_banner', '-loglevel', 'error',
          '-i', file,
          '-vf', vf,
          '-c:v', 'libx264', '-preset', 'slow', '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '128k',
          '-movflags', '+faststart',
          outPath,
        ],
        { encoding: 'utf8', windowsHide: true },
      );
      if (res.status !== 0) {
        warn(`  ! 压缩失败：${path.basename(file)} — ${(res.stderr || '').trim().split('\n').pop()}`);
        continue;
      }
    }

    if (!existsSync(posterPath) || FORCE) {
      // 抽第 1 秒的帧做封面：第 0 帧常常是黑场
      const res = spawnSync(
        ffmpeg,
        [
          '-y', '-hide_banner', '-loglevel', 'error',
          '-ss', '1', '-i', file,
          '-frames:v', '1', '-q:v', '3',
          posterPath,
        ],
        { encoding: 'utf8', windowsHide: true },
      );
      if (res.status !== 0) {
        warn(`  ! 抽封面失败：${path.basename(file)}`);
      }
    }

    const size = existsSync(outPath) ? (await stat(outPath)).size : undefined;
    const srcSize = (await stat(file)).size;

    videos.push({
      file: outName,
      poster: existsSync(posterPath) ? posterName : undefined,
      ...meta,
      size,
      title: path.basename(file, path.extname(file)),
    });

    const mb = (n) => (n / 1048576).toFixed(1);
    log(
      `  视频 ${name}: ${mb(srcSize)}MB → ${size ? mb(size) + 'MB' : '?'}` +
        (meta.duration ? ` (${meta.duration.toFixed(1)}s)` : ''),
    );
  }

  manifest.videos[work.slug] = videos;
  return videos;
}

// ------------------------------------------------------------------------ 主流程
async function main() {
  const worksFile = path.join(root, 'src', 'data', 'works.json');
  const mediaFile = path.join(root, 'src', 'data', 'media.json');

  const worksData = JSON.parse(await readFile(worksFile, 'utf8'));
  const allWorks = worksData.works;
  const targets = ONLY ? allWorks.filter((w) => w.slug === ONLY) : allWorks;

  if (!targets.length) {
    warn(`没有匹配的作品（--only=${ONLY}）`);
    return;
  }

  const previous = await readJson(mediaFile, { images: {}, videos: {} });
  /** @type {{images: Record<string,string[]>, videos: Record<string,any[]>}} */
  const manifest = { images: { ...previous.images }, videos: { ...previous.videos } };

  const ffmpeg = findTool('ffmpeg');
  const ffprobe = findTool('ffprobe');
  if (!ffmpeg) log('提示：未找到 ffmpeg，本次只整理图片。装法见 scripts/install-ffmpeg.mjs');

  log(`处理 ${targets.length} 个作品${FORCE ? '（强制重生成）' : ''}\n`);

  for (const work of targets) {
    log(`▸ ${work.slug}  ${work.title ?? ''}`);
    if (!work.source) {
      warn('  ! 没有配置 source，跳过');
      continue;
    }
    await processImages(work, manifest);
    if (!SKIP_VIDEO) await processVideos(work, manifest, ffmpeg, ffprobe);
    log('');
  }

  await writeFile(mediaFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const imageCount = Object.values(manifest.images).reduce((n, arr) => n + arr.length, 0);
  const videoCount = Object.values(manifest.videos).reduce((n, arr) => n + arr.length, 0);
  log(`完成：${Object.keys(manifest.images).length} 组图片（${imageCount} 张）、${videoCount} 条视频`);
  log(`清单已写入 src/data/media.json — 现在可以运行 pnpm build`);
}

main().catch((err) => {
  console.error(`\n失败：${err.stack ?? err.message}`);
  process.exit(1);
});
