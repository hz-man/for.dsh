import type { ImageMetadata } from 'astro';

/**
 * 素材目录清单。
 *
 * Astro 在构建时静态分析这个 glob，所以每个素材文件都会被登记为可优化图片，
 * 但只有真正渲染出来的那些才会生成产物 —— 137 张图不会全部产出多套尺寸。
 *
 * 目录约定：src/assets/<slug>/<任意文件名>.{png,jpg,jpeg,webp,avif}
 * 排序由 works.json 的 images 数组（`pnpm media` 生成）决定，读不到清单时回退到按文件名排序。
 */
const files = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/*/*.{png,jpg,jpeg,webp,avif,gif}',
  { eager: true },
);

const bySlug = new Map<string, Map<string, ImageMetadata>>();

for (const [filePath, mod] of Object.entries(files)) {
  // ../assets/<slug>/<filename>
  const match = /^\.\.\/assets\/([^/]+)\/(.+)$/.exec(filePath);
  if (!match) continue;
  const [, slug, fileName] = match;
  const name = fileName.replace(/\.[^.]+$/, '');

  if (!bySlug.has(slug)) bySlug.set(slug, new Map());
  bySlug.get(slug)!.set(name, mod.default);
}

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export interface WorkImage {
  name: string;
  image: ImageMetadata;
}

/**
 * 取某个作品的全部图片，顺序 = works.json 里 images 的顺序。
 * 素材目录不存在时返回空数组，构建不会因此失败。
 */
export function getImages(slug: string, order?: string[]): WorkImage[] {
  const map = bySlug.get(slug);
  if (!map) return [];

  if (!order?.length) {
    return [...map.entries()]
      .sort((a, b) => collator.compare(a[0], b[0]))
      .map(([name, image]) => ({ name, image }));
  }

  const result: WorkImage[] = [];
  for (const name of order) {
    const image = map.get(name);
    if (image) result.push({ name, image });
  }
  return result;
}

export function hasImages(slug: string): boolean {
  return (bySlug.get(slug)?.size ?? 0) > 0;
}

/**
 * 详情页展示顺序：highlight 里点名的帧排到最前，其余保持原顺序。
 */
export function getHighlighted(
  slug: string,
  order: string[] | undefined,
  highlight: string[] | undefined,
): WorkImage[] {
  const all = getImages(slug, order);
  if (!highlight?.length) return all;

  const picked: WorkImage[] = [];
  for (const name of highlight) {
    const hit = all.find((item) => item.name === name);
    if (hit && !picked.includes(hit)) picked.push(hit);
  }
  return [...picked, ...all.filter((item) => !picked.includes(item))];
}

/** 封面：优先用 frontmatter 指定的文件名，否则取第一张 */
export function getCover(
  slug: string,
  order: string[] | undefined,
  cover: string | undefined,
): WorkImage | undefined {
  const all = getImages(slug, order);
  if (!all.length) return undefined;
  if (cover) {
    const hit = all.find((item) => item.name === cover);
    if (hit) return hit;
  }
  return all[0];
}
