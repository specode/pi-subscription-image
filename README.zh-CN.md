# pi-subscription-image

[English](./README.md)

一个 [Pi](https://github.com/earendil-works/pi-mono) 图片生成扩展：统一提供 `generate_image` 工具，使用现有 OpenAI Codex 与 xAI Grok 订阅账户额度生成或编辑图片。

## 为什么需要它

不同生图扩展通常会注册不同工具，并使用不同的参数、保存路径和返回格式。这个包提供一个稳定入口，按当前 Pi 会话自动路由，并把生成图片统一以内联图片返回。

## 功能

- 复用 Pi 的 `openai-codex` OAuth 登录生成 Codex 图片。
- 复用 Pi 的 `xai` 订阅登录调用 Grok Imagine。
- 提供 `generate_image` 工具和 `/img` 命令。
- `openai-codex/*` 会话自动选择 Codex，`xai/*` 会话自动选择 Grok。
- 其他模型会话可显式传入 `provider=codex` 或 `provider=grok`。
- 单次调用可顺序生成 1–4 张图片，避免并发消耗配额。
- Codex 支持最多 5 张 PNG、JPEG 或 WebP 参考图编辑。
- 统一支持 `none`、`project`、`global`、`custom` 保存模式。
- 即使可选的磁盘保存失败，仍返回已经生成成功的内联图片。
- 包含严格的 base64、MIME、超时、重试和响应校验。
- 不自行保存凭据，不发送遥测。

## Provider 能力

| 能力 | Codex | Grok |
| --- | --- | --- |
| 认证 | Pi `openai-codex` OAuth | Pi `xai` 订阅登录 |
| 文生图 | 支持 | 支持 |
| 参考图编辑 | 支持，最多 5 张 | 当前未开放 |
| 输出格式 | PNG、JPEG、WebP | JPEG |
| 图片比例 | 写入 Prompt 约束 | 原生请求参数 |
| 默认模型 | `gpt-5.5` 路由，后端 `gpt-image-2` | `grok-imagine-image-quality` |

## 安装

首次发布后可从 npm 安装：

```bash
pi install npm:@specode/pi-subscription-image
```

本地开发阶段可临时试用：

```bash
pi --no-extensions --offline -e /path/to/pi-subscription-image
```

安装后重启 Pi 或执行 `/reload`。

## 登录

使用 Pi 原生登录命令：

```text
/login
```

- Codex：选择 **ChatGPT Plus/Pro (Codex)**。
- Grok：选择 xAI 的 X Premium 或 SuperGrok 订阅登录。

可在不展示凭据的前提下检查状态：

```text
/subscription-image status
```

## 使用

自然语言：

```text
生成一张月球科研站日出时分的电影感 16:9 图片。
```

直接命令：

```text
/img 一枚红熊猫扁平矢量图标
```

模型会调用 `generate_image`，参数如下：

| 参数 | 说明 |
| --- | --- |
| `prompt` | 必填，图片描述或编辑指令 |
| `provider` | `auto`、`codex` 或 `grok` |
| `model` | Codex 路由模型或 Grok Imagine 图片模型 |
| `aspectRatio` | 通用图片比例约束 |
| `n` | 顺序生成 1–4 张 |
| `outputFormat` | Codex 支持 `png`、`jpeg`、`webp`；Grok 仅支持 `jpeg` |
| `resolution` | Grok 当前支持 `1k` |
| `save` | `none`、`project`、`global` 或 `custom` |
| `saveDir` | `save=custom` 时的目录 |
| `referencedImagePaths` | Codex 最多 5 张本地参考图 |
| `numLastImagesToInclude` | Codex 使用最近的会话图片进行编辑 |

支持以下参数别名：

- `provider=openai` 映射为 `codex`。
- `provider=xai` 映射为 `grok`。
- 旧的 `aspect_ratio` 会在校验前映射为 `aspectRatio`。

## 自动路由

没有指定 provider，或使用 `provider=auto` 时：

1. 有参考图输入时选择 Codex。
2. 当前会话为 `openai-codex/*` 时选择 Codex。
3. 当前会话为 `xai/*` 时选择 Grok。
4. 如果配置了 `defaultProvider`，则使用该值。
5. 否则要求显式指定 provider，避免误消耗订阅额度。

## 保存位置

| 模式 | 位置 |
| --- | --- |
| `none` | 只返回内联图片 |
| `project` | `<cwd>/.pi/generated-images/` |
| `global` | `~/.pi/agent/generated-images/` |
| `custom` | `saveDir` 或配置目录 |

默认保存模式为 `global`。

## 配置

全局配置：

```text
~/.pi/agent/extensions/subscription-image.json
```

可信项目配置：

```text
<project>/.pi/extensions/subscription-image.json
```

只有项目处于可信状态时，项目配置才会覆盖全局配置。

```json
{
  "defaultProvider": "codex",
  "save": "global",
  "saveDir": "~/Pictures/generated",
  "codexRoutingModel": "gpt-5.5",
  "grokImageModel": "grok-imagine-image-quality"
}
```

环境变量：

- `PI_SUBSCRIPTION_IMAGE_PROVIDER`
- `PI_SUBSCRIPTION_IMAGE_SAVE_MODE`
- `PI_SUBSCRIPTION_IMAGE_SAVE_DIR`
- `PI_SUBSCRIPTION_IMAGE_CODEX_MODEL`
- `PI_SUBSCRIPTION_IMAGE_GROK_MODEL`
- `PI_SUBSCRIPTION_IMAGE_GROK_BASE_URL`

同时支持 `PI_IMAGE_SAVE_MODE` 和 `PI_IMAGE_SAVE_DIR`。

## 安全和服务边界

- 这是非官方社区扩展。
- 凭据只通过 Pi provider registry 解析，不写入本包自己的存储。
- Prompt 和参考图会发送到选择的 Provider。
- Codex 使用 ChatGPT Codex Responses 后端的内置 `image_generation` 工具。
- Grok 使用 xAI 图片生成接口。
- 订阅可用性、额度、地区限制和服务条款仍由对应 Provider 决定。
- Provider 后端发生变化时，可能需要升级本包。

## 开发

```bash
npm install
npm test
npm run smoke
npm run check
```

推送到 `main` 和 Pull Request 会运行类型检查、测试、Pi 加载 smoke 与包内容校验。npm 发布流程沿用 OIDC Trusted Publishing：创建 GitHub Release 后会重复这些检查，再通过 OIDC 发布，不保存长期 npm token。

## 许可证

[MIT](./LICENSE)。实现参考和第三方归属见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
