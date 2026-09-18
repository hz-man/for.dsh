# 个人作品集

图片 + 视频作品集。**纯静态站**：构建产物是可以直接丢到任何免费托管的 HTML/CSS/图片文件，没有服务器、没有数据库、没有后台。

## 技术栈

| 层 | 选择 | 为什么 |
|---|---|---|
| 框架 | **Astro 7**（`output: 'static'`） | 默认零 JS，内容页产出纯 HTML；图片优化是内置的，不用自己写 sharp 脚本 |
| 图片 | `astro:assets` + sharp | 构建期生成 AVIF/WebP 多尺寸 `srcset`，自动写宽高防抖动 |
| 视频 | ffmpeg 预处理 + 原生 `<video preload="none">` | 自托管；初次加载不下载任何视频字节 |
| 样式 | 原生 CSS + 设计变量 | 无框架依赖，改 `src/styles/tokens.css` 就能换整站观感 |
| 内容 | JSON（`src/data/works.json`） | 单一真源，加作品不用手写模板 |
| 部署 | Vercel / Netlify / GitHub Pages | 静态产物通用 |

> 为什么不用 Next.js：`output: 'export'` 静态导出时 `next/image` 的优化被禁用，等于丢掉最核心的能力。
> 为什么不自托管走 GitHub Pages：仓库有 1GB / 单文件 100MB 限制，放不下视频，用 Vercel 或 Netlify。

## 目录结构

```
图片/ 、视频/            ← 你的原始素材（保持不变，脚本只读）
src/
  data/works.json        ← 作品清单【唯一需要你维护的文件】
  data/media.json        ← 素材清单，由 pnpm media 生成，别手改
  data/site.json         ← 站点名、简介、邮箱、社交链接
  assets/<slug>/         ← 由 pnpm media 从原始目录拷入的图片
  components/            ← WorkCard / Gallery / VideoPlayer
  layouts/Base.astro     ← 页面骨架、导航、SEO meta
  lib/                   ← 读取作品与素材
  pages/                 ← 首页 / works 列表 / works/<slug> 详情 / about / 404
  styles/tokens.css      ← 颜色、字号、间距全部在这里
public/media/videos/<slug>/  ← 压缩后的视频 + 封面帧
scripts/
  media.mjs              ← 素材整理管线（图片拷贝 + 视频压缩 + 抽封面）
  new-work.mjs           ← 添加作品
  install-ffmpeg.mjs     ← 下载 ffmpeg/ffprobe 到 tools/
  check-build.mjs        ← 构建产物体检（SEO 标签、srcset、视频 preload）
  check-links.mjs        ← 校验所有页面引用的资源在 dist 里都存在
  check-shots.mjs        ← 截图像素统计（判断是否白屏/深色主题是否生效）
  probe-images.mjs       ← 用 CDP 问浏览器：图片真的加载了吗
  static-server.mjs      ← 本地静态服务，供上面几个检查脚本使用
tools/                   ← ffmpeg.exe / ffprobe.exe（已 gitignore）
```

## 日常使用

```bash
pnpm install          # 装依赖
pnpm dev              # 本地预览 http://localhost:4321
pnpm build            # 构建到 dist/
pnpm preview          # 本地预览构建产物
```

### 第一次整理素材

```bash
node scripts/install-ffmpeg.mjs   # 装 ffmpeg/ffprobe（约 158MB，只需一次）
pnpm media                        # 图片拷入 src/assets、视频压缩成 web 版并抽封面
pnpm build
```

`pnpm media` 是幂等的，可以随时重跑。可选参数：`--force`（强制重生成）、`--only=<slug>`（只处理一个作品）、`--no-video`（跳过视频）。

### 自检

```bash
node scripts/check-build.mjs                    # 产物结构与 SEO 标签
node scripts/check-links.mjs                    # 资源引用完整性
node scripts/static-server.mjs dist 4321 &      # 起本地服务
node scripts/probe-images.mjs http://127.0.0.1:4321/works/ 9333 --shot=shots/w.png
```

`probe-images.mjs` 需要一个开了调试端口的 Edge/Chrome（它也会自己尝试拉起一个，默认端口 9333）。
它会滚动页面触发懒加载，再报告每张图 `complete / naturalWidth`，是判断"图片到底加载没有"最可靠的手段 —— 单纯截图很容易因为懒加载而误判成"图片没显示"。

### 加一个新作品

```bash
# 1. 把素材放进一个目录，例如 图片/17/
# 2. 登记（slug 同时是网址路径和素材目录名）
pnpm new -- --slug=my-work --source="图片/17" --title="我的作品" --year=2025
# 3. 整理 + 构建
pnpm media --only=my-work
pnpm build
```

视频作品用 `--kind=video`（目录里检测到视频会自动判定）。

## 部署

推到 Vercel 或 Netlify，构建命令 `pnpm build`，输出目录 `dist`。

**上线前必改** `astro.config.mjs` 里的 `site`，换成真实域名 —— sitemap 和社交分享的绝对地址依赖它。

## 常见问题

**`pnpm media` 报"未找到 ffmpeg"**
视频会被跳过，图片照常处理。跑 `node scripts/install-ffmpeg.mjs` 即可。
海外源（gyan.dev）在国内可能只有 ~20KB/s，脚本会优先走 npmmirror 的 gz 二进制。

**页面显示"素材待整理"**
说明 `src/data/media.json` 里还没有这个作品的记录。跑 `pnpm media`。

**视频太大 / 想换压缩参数**
改 `scripts/media.mjs` 里的 `-crf`（数值越小画质越好体积越大，23 是平衡点）和 `scale` 限高限宽。

**图片质量 / 大小想调**
改 `src/components/WorkCard.astro` 与 `Gallery.astro` 里的 `quality`（当前 74）。注意两处的 `widths` 档位要保持一致，否则同一张图会生成两套产物、构建变慢、体积翻倍。

**想换配色**
只改 `src/styles/tokens.css` 顶部的变量，其它地方没有写死颜色。

**构建报 `spawn EPERM`**
esbuild 需要启动子进程并用管道通信。受限沙箱会拒绝，放宽权限或在普通终端里跑即可。

**构建报遥测写入失败（EPERM，指向 AppData）**
`package.json` 的脚本已带 `ASTRO_TELEMETRY_DISABLED=1` 规避。如果你绕过 pnpm 直接调用 `astro`，记得自己带上这个环境变量。

**中文路径**
本项目位于中文目录下，Node 模块解析、Astro 构建、sharp 图片处理均已实测可用。如果某个工具报路径错误，优先怀疑它而不是本项目。

## 已知约束

- `public/media/videos/` 里的压缩视频会进 git。当前 22 条共约 71MB；如果总量继续变大，考虑 Git LFS 或对象存储。
- 素材目录 `图片/`、`视频/` 不进 git（见 `.gitignore`），只提交处理后的成品。
- 详情页没有做点击放大（lightbox）。要加的话在 `Gallery.astro` 上加一个 `<dialog>` 即可，不影响现有结构。
- `src/assets/` 里的来源图已转成 WebP（508MB → 21MB）。这是**有损**转换，原始素材仍在 `图片/` 目录；若要重新生成，跑 `pnpm media` 然后 `node scripts/optimize-sources.mjs --write`。

## 部署

已部署到 Vercel：**https://for-dsh.vercel.app**

- 仓库：https://github.com/hz-man/for.dsh （**必须保持 Public**，Vercel 免费版连不了私有仓库）
- 推送到 `main` 分支会自动触发重新部署
- 构建配置由 `vercel.json` 锁定，不依赖 Vercel 的自动探测

**改域名时**：改 `astro.config.mjs` 的 `site` 再推送，否则 canonical / sitemap / og:url 会指向旧地址。改完用 `node scripts/check-urls.mjs <新域名>` 验证。

**注意 `pnpm-workspace.yaml`**：里面的 `allowBuilds` 必须放行 `esbuild` 和 `sharp`。如果被拦下，`pnpm install` 会以 `ERR_PNPM_IGNORED_BUILDS` 退出码 1，**Vercel 会直接判定构建失败**（本地可能察觉不到，因为二进制可能已缓存）。

## 当前构建实测（供参考）

| 指标 | 数值 |
|---|---|
| 页面数 | 22（首页 + 列表 + 18 个作品 + 关于 + 404） |
| 图片素材 | 133 张（16 组），3–6MB PNG → 9–58KB WebP |
| 视频素材 | 22 条，原始 323MB → 约 71MB |
| 仓库体积 | 92.5MB（原始素材 1.4GB 已排除） |
| dist 总大小 | 约 106MB（视频 71MB + 优化图片 35MB + HTML 0.3MB） |
| 索引页首屏 | 只加载 2 张图（其余 lazy），无任何视频字节 |

