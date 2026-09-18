// ============================================================================
// 添加新作品：pnpm new -- --slug=<slug> --source="图片/17" [--title="标题"] [--kind=image|video]
//
// 只做一件事：往 src/data/works.json 里追加一条记录，并把 order 排到最后。
// 素材目录存在性会被检查，但不会拷贝任何文件 —— 拷文件交给 `pnpm media`。
// ============================================================================
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const worksFile = path.join(root, 'src', 'data', 'works.json');

const args = process.argv.slice(2);
const get = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const slug = get('slug');
const source = get('source');
const title = get('title');
const year = Number(get('year') ?? new Date().getFullYear());
const category = get('category');
const kind = get('kind');

if (!slug || !source) {
  console.error(
    '用法：pnpm new -- --slug=my-work --source="图片/17" [--title="作品名"] [--year=2025] [--category=视频] [--kind=image|video]',
  );
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error(`slug 只能用小写字母、数字和连字符（当前："${slug}"）`);
  process.exit(1);
}

const data = JSON.parse(await readFile(worksFile, 'utf8'));

if (data.works.some((w) => w.slug === slug)) {
  console.error(`slug "${slug}" 已存在，换一个。`);
  process.exit(1);
}

if (!existsSync(path.join(root, source))) {
  console.error(`素材目录不存在：${source}\n先创建它并把文件放进去，再用正确的路径重跑。`);
  process.exit(1);
}

// 粗略判断类型：目录里有视频文件就当视频作品（可用 --kind 覆盖）
const VIDEO_EXT = ['.mp4', '.mov', '.m4v', '.webm', '.mkv'];
const { readdir } = await import('node:fs/promises');
const entries = await readdir(path.join(root, source), { recursive: true });
const hasVideo = entries.some((e) =>
  VIDEO_EXT.includes(path.extname(String(e)).toLowerCase()),
);

const resolvedKind = kind ?? (hasVideo ? 'video' : 'image');
const maxOrder = data.works.reduce((max, w) => Math.max(max, w.order ?? 0), 0);

data.works.push({
  slug,
  title: title ?? slug,
  year,
  category: category ?? (resolvedKind === 'video' ? '视频' : '图片'),
  source,
  kind: resolvedKind,
  summary: '',
  tags: [],
  featured: false,
  draft: false,
  order: maxOrder + 1,
});

await writeFile(worksFile, JSON.stringify(data, null, 2) + '\n', 'utf8');

console.log(`已添加：${slug}（${resolvedKind}，${year}）→ 素材来源 ${source}`);
console.log('下一步：');
console.log(`  pnpm media --only=${slug}      # 整理素材`);
console.log('  pnpm dev                       # 本地预览');
console.log(`  或者直接编辑 src/data/works.json 补上标题、简介、标签`);
