// 截图客观体检：自带 PNG 解码（Node 内置 zlib），不依赖任何图像库。
// 用法：node scripts/check-shots.mjs
//
// 目的：模型没法"看"图时，用统计特征判断页面是否真的渲染了内容。
//   深色底 (--bg #0d0d0f) 应占主导
//   图片区域会带来大量中灰/彩色像素
//   强调色 (--accent #ff6b35) 应在页面上出现少量像素
//   纯白/纯黑占比过高 → 白屏或渲染失败
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import path from 'node:path';

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('不支持隔行扫描 PNG');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  if (bitDepth !== 8) throw new Error(`只支持 8bit，实际 ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`不支持的颜色类型 ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  // 逐行反滤波
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      const v = line[x];
      let val;
      switch (filter) {
        case 0: val = v; break;
        case 1: val = v + a; break;
        case 2: val = v + b; break;
        case 3: val = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`未知滤波类型 ${filter}`);
      }
      cur[x] = val & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

/** 传比值（0.697），输出 "69.7%" */
const fmt = (ratio) => (ratio * 100).toFixed(1) + '%';

function analyse(img) {
  const { width, height, channels, data } = img;
  const total = width * height;
  let dark = 0;
  let nearWhite = 0;
  let accent = 0;
  let midTone = 0;
  let colorful = 0;
  const buckets = { dark: 0, mid: 0, bright: 0 };

  // 调试探针
  if (process.env.SHOT_DEBUG) {
    console.log(
      `  [debug] data.length=${data.length} 期望=${height * width * channels}` +
        ` 期望含滤波字节=${height * (width * channels + 1)}` +
        ` channels=${channels} px(0,0)=${data[0]},${data[1]},${data[2]}`,
    );
  }

  // 采样步长：大图上每 4 个像素取一个就够统计用
  const step = 2;
  let sampled = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      sampled++;

      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum < 40) {
        dark++;
        buckets.dark++;
      } else if (lum > 235) {
        nearWhite++;
        buckets.bright++;
      } else {
        buckets.mid++;
      }
      if (lum >= 40 && lum <= 200) midTone++;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max - min > 30) colorful++;

      // 强调色 #ff6b35 附近
      if (r > 180 && g > 60 && g < 160 && b < 110) accent++;
    }
  }

  if (process.env.SHOT_DEBUG) {
    console.log(
      `  [debug] sampled=${sampled} dark=${dark} buckets=${JSON.stringify(buckets)}`,
    );
  }

  return {
    total,
    sampled,
    dark: dark / sampled,
    nearWhite: nearWhite / sampled,
    midTone: midTone / sampled,
    colorful: colorful / sampled,
    accent: accent / sampled,
    buckets,
  };
}

/** 调试用：打印亮度直方图，确认解码与统计是否自洽 */
function histogram(img) {
  const { width, height, channels, data } = img;
  const bins = new Array(16).fill(0);
  let sampled = 0;
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * channels;
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      bins[Math.min(15, Math.floor(lum / 16))]++;
      sampled++;
    }
  }
  const lines = bins.map((count, index) => {
    const pct = ((count / sampled) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round((count / sampled) * 60));
    return `    ${String(index * 16).padStart(3)}-${String(index * 16 + 15).padStart(3)}  ${pct.padStart(5)}%  ${bar}`;
  });
  return lines.join('\n');
}

async function main() {
  const shots = ['home.png', 'works.png', 'detail.png', 'video.png'];
  let ok = true;

  for (const name of shots) {
    const file = path.join(process.cwd(), 'shots', name);
    let img;
    try {
      img = decodePng(await readFile(file));
    } catch (err) {
      console.log(`✗ ${name}: ${err.message}`);
      ok = false;
      continue;
    }

    const s = analyse(img);
    console.log(`\n▸ ${name}  (${img.width}×${img.height})`);
    if (process.argv.includes('--hist')) {
      console.log('  亮度直方图（0=黑 255=白）');
      console.log(histogram(img));
    }
    console.log(`  深色像素(亮度<40)   ${fmt(s.dark)}`);
    console.log(`  中灰/图片像素       ${fmt(s.midTone)}`);
    console.log(`  近白像素(>235)      ${fmt(s.nearWhite)}`);
    console.log(`  彩色像素(饱和度高)  ${fmt(s.colorful)}`);
    console.log(`  强调色像素          ${fmt(s.accent)}`);

    // 白屏检测：整页近白占绝大比例说明根本没渲染出深色主题
    if (s.nearWhite > 0.8) {
      console.log('  ✗ 近白占比 >80%，疑似白屏或样式没加载');
      ok = false;
    } else if (s.dark < 0.05 && s.midTone < 0.5) {
      console.log('  ✗ 深色与图片像素都过少，页面可能是空的');
      ok = false;
    } else {
      console.log('  ✓ 有深色底与内容像素，渲染正常');
    }

    // 阈值：正常页面深色底（含卡片/文字区）应占相当比例
    if (s.dark < 0.15) {
      console.log('  ✗ 深色底占比 <15%，深色主题可能没生效');
      ok = false;
    }
  }

  console.log(ok ? '\n✓ 截图检查通过' : '\n✗ 有问题');
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
