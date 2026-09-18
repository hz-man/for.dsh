import { defineCollection, z } from 'astro:content';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 作品清单。
 *
 * 单一真源是 src/data/works.json —— 你只维护那个文件。
 * 素材（图片/视频）由 `pnpm media` 从原始目录整理到 src/assets/<slug>/ 与 public/media/videos/<slug>/，
 * 并把结果写回 works.json 的 images / videos 字段。
 */

const workSchema = z.object({
  slug: z.string(),
  title: z.string(),
  year: z.number().int().min(1900).max(2100),
  category: z.string().default('作品'),
  summary: z.string().default(''),
  client: z.string().optional(),
  role: z.string().optional(),
  tags: z.array(z.string()).default([]),
  featured: z.boolean().default(false),
  draft: z.boolean().default(false),
  order: z.number().default(100),
  /** 原始素材目录（相对项目根），仅供 `pnpm media` 使用，不参与渲染 */
  source: z.string().optional(),
  /** 作品类型：图片集 / 视频 */
  kind: z.enum(['image', 'video']).default('image'),
  /** 详情页顶部优先展示的帧文件名（不含扩展名） */
  highlight: z.array(z.string()).optional(),
  /** 封面帧文件名（不含扩展名），留空取第一帧 */
  cover: z.string().optional(),
  /** 由 `pnpm media` 自动生成：src/assets/<slug>/ 下的图片文件名，不含扩展名 */
  images: z.array(z.string()).default([]),
  /** 由 `pnpm media` 自动生成：public/media/videos/<slug>/ 下的视频文件名 */
  videos: z.array(z.string()).default([]),
});

/**
 * works 集合的 loader 用函数而不是 astro/loaders 的 file()/glob()：
 * 后者会拖入 picomatch，在 Vite 8 的 module runner 里触发
 * "require is not defined"（CJS 包被当 ESM eval）。纯 JSON 读取用不着它。
 */
const works = defineCollection({
  loader: async () => {
    const file = path.join(process.cwd(), 'src', 'data', 'works.json');
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { works: Record<string, unknown>[] };
    // 每条必须带字符串 id；这里直接用 slug，于是 getEntry('works', '1') 可用
    return parsed.works.map((work) => ({ id: String(work.slug), ...work }));
  },
  schema: workSchema,
});

export const collections = { works };
