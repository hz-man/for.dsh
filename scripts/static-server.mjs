// 本地静态文件服务，仅用于无头浏览器截图/自查。
// 用法：node scripts/static-server.mjs [dir] [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 4321);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let filePath = path.join(root, decodeURIComponent(url.pathname));

    // 目录 → index.html；无扩展名 → 尝试补 index.html（对齐静态托管的默认行为）
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch {
      if (!path.extname(filePath)) filePath = path.join(filePath, 'index.html');
    }

    // 防目录穿越
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`static server: http://127.0.0.1:${port}  →  ${root}`);
});
