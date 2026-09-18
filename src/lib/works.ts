import type { ImageMetadata } from 'astro';
import { site } from './site';
import worksData from '../data/works.json';
import mediaData from '../data/media.json';

export type WorkKind = 'image' | 'video';

export interface WorkVideo {
  /** 文件名（含扩展名），位于 public/media/videos/<slug>/ */
  file: string;
  /** 同目录下的封面图文件名 */
  poster?: string;
  /** 秒 */
  duration?: number;
  width?: number;
  height?: number;
  /** 字节 */
  size?: number;
  title?: string;
}

export interface Work {
  slug: string;
  title: string;
  year: number;
  category: string;
  summary: string;
  client?: string;
  role?: string;
  tags: string[];
  featured: boolean;
  draft: boolean;
  order: number;
  kind: WorkKind;
  source?: string;
  highlight?: string[];
  cover?: string;
  /** 素材目录里有哪些图片（文件名不含扩展名），顺序即展示顺序 */
  images: string[];
  videos: WorkVideo[];
}

interface MediaManifest {
  images: Record<string, string[]>;
  videos: Record<string, WorkVideo[]>;
}

/** src/data/media.json 由 `pnpm media` 生成 */
const manifest = mediaData as MediaManifest;

export const videoBase = '/media/videos';

/**
 * 全部作品，已排序、已过滤草稿。
 * 元数据来自 src/data/works.json（单一真源），素材清单来自 src/data/media.json。
 */
export const works: Work[] = (worksData as { works: Partial<Work>[] }).works
  .map(
    (raw): Work => ({
      slug: raw.slug!,
      title: raw.title ?? raw.slug!,
      year: raw.year ?? new Date().getFullYear(),
      category: raw.category ?? '作品',
      summary: raw.summary ?? '',
      client: raw.client,
      role: raw.role,
      tags: raw.tags ?? [],
      featured: raw.featured ?? false,
      draft: raw.draft ?? false,
      order: raw.order ?? 100,
      kind: raw.kind ?? 'image',
      source: raw.source,
      highlight: raw.highlight,
      cover: raw.cover,
      images: manifest.images[raw.slug!] ?? [],
      videos: manifest.videos[raw.slug!] ?? [],
    }),
  )
  .filter((work) => !work.draft)
  .sort((a, b) => a.order - b.order || a.year - b.year);

export function findWork(slug: string): Work | undefined {
  return works.find((work) => work.slug === slug);
}

/** 卡片和页面共用的描述文本，带上年份与类型，利于 SEO */
export function workDescription(work: Work): string {
  return work.summary || `${work.year} 年${work.category}作品：${work.title}。`;
}

export function siteName(): string {
  return site.name;
}

export const workPath = (work: Work): string => `/works/${work.slug}/`;

/** 图片宽高比，供 Gallery 预留空间、避免加载跳动 */
export function aspectOf(image: ImageMetadata): number {
  return image.width / image.height;
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
