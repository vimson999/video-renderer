# CLI 使用说明

开发目录中使用 `npm run cli --`；执行 `npm run build` 后也可直接调用 `node dist/src/index.js`。

```bash
npm run cli -- validate --input /path/to/package --report /path/to/validation-report.json
npm run cli -- studio --input /path/to/package --port 3101
npm run cli -- render --input /path/to/package --output /path/to/output --concurrency 2
```

stdout 是单行 JSON 或帮助文本，错误诊断写入 stderr；不会输出完整旁白或字幕内容。

## 输出策略

渲染输出目录必须不存在或为空，没有隐式覆盖。工具先取得该输出目录专属锁，在同级临时目录完成 MP4、校验报告和渲染报告，全部成功后才整体原子发布。失败不会留下名为 `rough-cut.mp4` 的半成品。同一输出目录只能有一个任务，不同输出目录可并行。

`render-report.json` 包含频道/视频/运行身份、渲染器与契约版本、输入包稳定 SHA-256、分辨率、帧率、时长、编码、并发度、起止时间、耗时、文件大小、成片 SHA-256 和校验摘要。

## 并行模型

**任务级并行**是同时启动多个 CLI 进程，例如两个频道各渲染一个视频。每个任务拥有独立的暂存目录、锁、props 和输出。

**帧级并发**是单个任务的 `--concurrency`，控制 Remotion 同时渲染多少帧。两个任务各设置 2，不等于总并发仍为 2；它们会共同消耗 CPU 和内存。先从每任务 1–2 开始。

Studio 也支持并行，但每个实例必须指定不同的 `--port`。

## 退出码

| 代码 | 含义 |
|---:|---|
| 0 | 成功 |
| 2 | 参数、输入或 Schema/时间线校验失败 |
| 3 | 输出目录非空或输出锁冲突 |
| 4 | 输入音频/图片无法读取或解码 |
| 5 | Studio 启动或运行失败（包括端口冲突） |
| 6 | Remotion 渲染失败 |
| 7 | 成片技术探测失败 |
