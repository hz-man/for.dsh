// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 静态输出：构建产物是纯 HTML/CSS/图片，可直接丢给 Vercel / Netlify / GitHub Pages。
// 部署到自定义域名后，把下面的 site 改成真实域名，sitemap 和绝对 URL 才会正确。
export default defineConfig({
  site: 'https://example.com',
  output: 'static',

  // Astro 7 默认 'jsx' 会按 JSX 规则吃掉行内元素之间的空格，
  // 中文排版对空格敏感，这里显式回到 HTML 规则，避免"图 1图 2"这种粘连。
  compressHTML: true,

  integrations: [sitemap()],

  image: {
    // 构建期生成响应式图片时的默认输出格式。
    // 源图是 PNG 截图/渲染图，转 AVIF/WebP 体积能降一个数量级。
    responsiveStyles: true,
  },

  build: {
    // 图片和视频同域，内联小图反而拖慢首屏。
    inlineStylesheets: 'auto',
  },

  devToolbar: {
    enabled: false,
  },
});
