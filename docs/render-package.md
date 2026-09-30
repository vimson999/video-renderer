# 输入包契约

输入包是可移动、可归档的目录，所有路径都相对于包根目录：

```text
render-package/
├── manifest.json
├── timeline.json
├── narration.wav
├── subtitle.srt
└── assets/
    ├── shot-001.png
    └── shot-002.png
```

## manifest.json

| 字段 | 版本 1 要求 |
|---|---|
| `schemaVersion` | 固定为 `1.0` |
| `channelId` | 非空、稳定的频道标识 |
| `videoId` | 非空、频道内稳定的视频标识 |
| `runId` | 非空、一次制作尝试/修订的唯一标识 |
| `profile` | 固定为 `vertical-basic` |
| `width` / `height` / `fps` | 固定为 `1080` / `1920` / `30` |
| `timeline` | 时间线 JSON 的相对路径 |
| `audio` | 单条旁白 WAV 的相对路径 |
| `subtitles` | SRT 的相对路径 |

不允许额外字段。所有引用经过真实路径校验，`..`、绝对路径和通过符号链接逃出包根目录的路径都会被拒绝。

## timeline.json

`shots` 至少包含一个镜头。每个镜头必须给出：

- `id`：包内唯一；
- `startMs`、`endMs`：毫秒，首镜头从 0 开始，相邻镜头首尾连续且不得重叠；
- `asset`：可解码 PNG/JPEG 的相对路径；
- `fit`：`cover` 或 `contain`；
- `motion.preset`：`none`、`slow-zoom-in`、`slow-zoom-out`、`pan-left`、`pan-right`；
- `motion.intensity`：0 到 1；
- `transitionOut`：`cut`（时长 0）或正时长 `crossfade`。

交叉淡化是出镜头末尾的叠加元数据，不会缩短总时间线。最后一个镜头必须使用时长为 0 的 `cut`。

## 音频与字幕时间

- 最后镜头结束时间与实际旁白时长差值不得超过 **100ms**；
- SRT 必须按时间递增且不得重叠；
- 最后一条字幕最多只能超出旁白 **100ms**；
- 时间最终按 30fps 转成整数帧，任何变成 0 帧的镜头或转场都会失败。

正式 JSON Schema 位于 `contracts/`，运行 `npm run schemas` 可从代码契约重新生成。
