// 用 Edge 的 DevTools Protocol 直接问浏览器：图片到底加载了没。
// 比截图统计更可靠 —— 拿到的是 img.complete / naturalWidth 的真实值。
//
// 用法：
//   node scripts/probe-images.mjs <url> [debugPort]
//
// 前置：需要一个已开调试端口的 Edge。脚本会自己尝试拉起一个；
// 若端口已被别的实例占用，直接复用（先跑 scripts/start-edge-debug.ps1 也可以）。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:4321/works/';
const port = Number(process.argv[3] ?? 9333);

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findEdge() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('找不到 msedge.exe');
}

async function portAlive() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    return await res.json();
  } catch {
    return null;
  }
}

/** 极简 CDP 客户端，支持 sessionId（attach 到具体页面） */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} 超时`));
        }
      }, 30000);
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true });
    });
    return new Cdp(ws);
  }
}

async function main() {
  let version = await portAlive();
  let child = null;

  if (!version) {
    const edge = findEdge();
    const profile = path.join(os.tmpdir(), `edge-cdp-${port}`);
    child = spawn(
      edge,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--hide-scrollbars',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        '--window-size=1440,3000',
        'about:blank',
      ],
      { stdio: 'ignore', windowsHide: true, detached: false },
    );

    for (let i = 0; i < 30 && !version; i++) {
      await sleep(500);
      version = await portAlive();
    }
  }

  if (!version) {
    child?.kill();
    throw new Error(`连不上 Edge 调试端口 ${port}`);
  }
  console.log(`浏览器: ${version.Browser}\n`);

  const cdp = await Cdp.connect(version.webSocketDebuggerUrl);

  // 新建标签页
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);

  const loaded = new Promise((resolve) => {
    const handler = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.method === 'Page.loadEventFired' && msg.sessionId === sessionId) {
        cdp.ws.removeEventListener('message', handler);
        resolve();
      }
    };
    cdp.ws.addEventListener('message', handler);
  });

  await cdp.send('Page.navigate', { url }, sessionId);
  await loaded;
  console.log(`已加载: ${url}\n`);

  const evaluate = async (expression) => {
    const r = await cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };

  // 滚到底再回顶，触发懒加载
  await evaluate('window.scrollTo(0, document.body.scrollHeight); true');
  await sleep(3500);
  await evaluate('window.scrollTo(0, 0); true');
  await sleep(1500);

  const summary = await evaluate(`
    (() => {
      const imgs = [...document.querySelectorAll('img')];
      const videos = [...document.querySelectorAll('video')];
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return Math.round(r.width) + 'x' + Math.round(r.height);
      };
      return {
        title: document.title,
        bodyHeight: document.body.scrollHeight,
        img: {
          total: imgs.length,
          complete: imgs.filter(i => i.complete).length,
          decoded: imgs.filter(i => i.naturalWidth > 0).length,
          failed: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
          lazy: imgs.filter(i => i.loading === 'lazy').length,
        },
        sample: imgs.slice(0, 5).map(i => ({
          file: (i.currentSrc || i.src).split('/').pop(),
          complete: i.complete,
          natural: i.naturalWidth + 'x' + i.naturalHeight,
          rendered: rect(i),
          loading: i.loading,
        })),
        video: {
          total: videos.length,
          withPoster: videos.filter(v => v.poster).length,
          preload: [...new Set(videos.map(v => v.preload))],
        },
      };
    })()
  `);

  console.log(JSON.stringify(summary, null, 2));

  // 可选：滚动触发懒加载后截全页图，用于像素统计（--shot=path）
  const shotArg = process.argv.find((a) => a.startsWith('--shot='));
  if (shotArg) {
    const shotPath = path.resolve(shotArg.slice('--shot='.length));
    const { data } = await cdp.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true },
      sessionId,
    );
    fs.writeFileSync(shotPath, Buffer.from(data, 'base64'));
    console.log(`\n截图（已触发懒加载）: ${shotPath}`);
  }

  await cdp.send('Target.closeTarget', { targetId });
  cdp.ws.close();
  child?.kill();
}

main().catch((err) => {
  console.error('失败：', err.message);
  process.exit(1);
});
