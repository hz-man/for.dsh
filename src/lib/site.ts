import data from '../data/site.json';

/**
 * 站点信息。直接 JSON import 而不是走 content collection：
 * 单文件、单对象，不需要集合那一层，也让 Base 布局无需 await。
 */
export interface SocialLink {
  label: string;
  href: string;
}

export interface SiteInfo {
  name: string;
  tagline: string;
  description: string;
  email?: string;
  socials: SocialLink[];
}

export const site = data as SiteInfo;
