// ============================================================================
// 下载 ffmpeg / ffprobe 到 tools/
//
// 用法：node scripts/install-ffmpeg.mjs [--force]
//
// 为什么不用 curl / Invoke-WebRequest：本机 PowerShell 的 Schannel 在受限环境下
// 拿不到 TLS 凭证（SEC_E_NO_CREDENTIALS），而 Node 自带 OpenSSL，HTTPS 是通的。
//
// 为什么按顺序试多个源：海外源（gyan.dev / GitHub）在国内可能只有 ~20KB/s，
// 而 npmmirror 是国内的；但镜像上的 ffprobe 不保证存在，所以要能回退。
// ============================================================================
import { createReadStream, createWriteStream, readdirSync } from 'node:fs';
import { mkdir, rm, stat, rename } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const FORCE = process.argv.includes('--force');

const root = path.resolve(import.meta.dirname, '..');
const toolsDir = path.join(root, 'tools');
const tmpDir = path.join(os.tmpdir(), 'portfolio-ffmpeg');

/** 每个工具按优先级排列的下载源 */
const SOURCES = {
  'ffmpeg.exe': [
    'https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.1.1/ffmpeg-win32-x64.gz',
    'https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.1.1/ffmpeg-win32-x64',
    'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  ],
  'ffprobe.exe': [
    'https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.1.1/ffprobe-win32-x64.gz',
    'https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.1.1/ffprobe-win32-x64',
    'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  ],
};

const fmt = (bytes) => (bytes / 1048576).toFixed(1) + ' MB';

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 流式下载，带进度 */
async function download(url, destFile, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const total = Number(res.headers.get('content-length') ?? 0);

  let seen = 0;
  let lastTick = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    seen += chunk.length;
    const now = Date.now();
    if (now - lastTick > 700) {
      lastTick = now;
      const pct = total ? ` ${((seen / total) * 100).toFixed(0)}%` : '';
      process.stdout.write(`\r    ${label}: ${fmt(seen)}${pct}   `);
    }
  });

  await pipeline(body, createWriteStream(destFile));
  process.stdout.write('\r' + ' '.repeat(72) + '\r');
  return destFile;
}

/** 递归找一个文件（zip 解出来的目录结构不确定） */
function findFileSync(dir, name) {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === name.toLowerCase()) return full;
    }
  }
  return null;
}

/** zip 里挑出需要的 exe；用 git 自带的 tar.exe（bsdtar 支持 zip） */
function extractFromZip(zipPath, exeName) {
  const staging = path.join(tmpDir, 'zip');
  const res = spawnSync('tar', ['-xf', zipPath, '-C', staging], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (res.status !== 0) throw new Error('tar 解压 zip 失败');
  const found = findFileSync(staging, exeName);
  if (!found) throw new Error(`zip 里没有 ${exeName}`);
  return found;
}

/** 把下载到的压缩/裸文件转成 tools/<exeName>；成功返回 true */
async function materialize(url, stamp, target) {
  const part = target + '.part';
  const isZip = url.endsWith('.zip');
  const isGz = url.endsWith('.gz');

  if (isZip) {
    const exe = extractFromZip(stamp, path.basename(target));
    await rename(exe, part);
  } else if (isGz) {
    // gz 里直接就是裸二进制
    await pipeline(createReadStream(stamp), createGunzip(), createWriteStream(part));
  } else {
    await pipeline(createReadStream(stamp), createWriteStream(part));
  }

  await rename(part, target);
}

async function fetchTool(exeName) {
  const target = path.join(toolsDir, exeName);

  if (!FORCE && (await exists(target))) {
    console.log(`  ${exeName} 已存在，跳过`);
    return true;
  }

  for (const url of SOURCES[exeName]) {
    const stamp = path.join(tmpDir, encodeURIComponent(url).slice(-60));
    const host = new URL(url).host;
    const kind = url.endsWith('.gz') ? ' (gz)' : url.endsWith('.zip') ? ' (zip)' : '';
    console.log(`  ${exeName} ← ${host}${kind}`);

    try {
      await download(url, stamp, exeName);
      await materialize(url, stamp, target);
      const size = (await stat(target)).size;
      console.log(`    ✓ ${exeName} (${fmt(size)})`);
      await rm(stamp, { force: true });
      return true;
    } catch (err) {
      console.log(`    ✗ ${err.message}`);
      await rm(target + '.part', { force: true });
      await rm(stamp, { force: true });
    }
  }

  return false;
}

async function main() {
  await rm(path.join(tmpDir, 'zip'), { recursive: true, force: true });
  await mkdir(toolsDir, { recursive: true });
  await mkdir(path.join(tmpDir, 'zip'), { recursive: true });

  const ffmpegOk = await fetchTool('ffmpeg.exe');
  const ffprobeOk = await fetchTool('ffprobe.exe');

  if (ffmpegOk) {
    const check = spawnSync(path.join(toolsDir, 'ffmpeg.exe'), ['-version'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    console.log('\n' + (check.stdout ?? '').split('\n')[0]);
  }

  if (!ffmpegOk) {
    console.error(
      '\nffmpeg 安装失败。可手动下载后把 bin/ffmpeg.exe 放进 tools/：\n' +
        '  https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    );
    process.exit(1);
  }

  if (!ffprobeOk) {
    console.warn(
      '\n注意：没装到 ffprobe.exe。视频仍能压缩，但读不到时长/分辨率。\n' +
        '手动补：解压上面那个 zip，把 bin/ffprobe.exe 拷进 tools/ 即可。',
    );
  }

  console.log('\ntools/ 就绪。现在可以运行 pnpm media');
}

main().catch((err) => {
  console.error(`\n失败：${err.stack ?? err.message}`);
  process.exit(1);
});
