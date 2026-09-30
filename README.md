# video-renderer

一个独立于内容仓库的本机视频渲染工具。内容项目只需提供图片、旁白、SRT 和时间线组成的便携包；本工具负责校验、Remotion Studio 预览和 1080×1920、30fps 的 H.264 MP4 粗剪。

## 环境与安装

- Node.js 22 或更高版本；
- macOS、Linux 或 Windows；
- 首次运行 Remotion 时可能需要联网下载其受控 Chromium；
- 不要求全局安装 Remotion 或 FFmpeg，本项目锁定全部依赖，并为旧版 macOS 提供项目内 FFmpeg。

```bash
git clone https://github.com/vimson999/video-renderer.git
cd video-renderer
npm ci
```

## 快速开始

把 `{{OUTPUT_DIR}}` 替换成一个不存在或为空的目录。下面的标记区由验收测试原样执行。

<!-- quick-start:start -->
```bash
npm run schemas
npm run cli -- validate --input examples/vertical-basic
npm run cli -- render --input examples/vertical-basic --output {{OUTPUT_DIR}} --concurrency 2
```
<!-- quick-start:end -->

成功输出包含：

```text
{{OUTPUT_DIR}}/
├── rough-cut.mp4
├── validation-report.json
└── render-report.json
```

打开可视化预览：

```bash
npm run cli -- studio --input examples/vertical-basic --port 3101
```

两个频道可以使用不同输出目录和 Studio 端口并行运行：

```bash
npm run cli -- render --input /project-a/package --output /project-a/output --concurrency 1 &
npm run cli -- render --input /project-b/package --output /project-b/output --concurrency 1 &
wait
```

`examples/` 只包含可再分发的演示素材；真实频道素材、旁白和生产输出应保留在各自内容仓库，不提交到本工具仓库。

## 文档

- [输入包契约](docs/render-package.md)
- [CLI 与并行模型](docs/cli.md)
- [故障排查](docs/troubleshooting.md)

重新生成演示图片和旁白：`npm run example:assets`。
