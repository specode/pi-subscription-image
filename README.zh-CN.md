# pi-subscription-image

[English](./README.md) | [简体中文](./README.zh-CN.md)

在 [Pi](https://github.com/earendil-works/pi-mono) 中直接使用现有的 **OpenAI Codex** 与 **xAI Grok** 订阅额度生成和编辑图片——无需额外购买按量计费的 API Key。

- **统一入口**：提供单一的 `generate_image_with_subscription` 工具与 `/img` 快捷命令，告别碎片化的生图插件。
- **按会话智能路由**：在 `openai-codex/*` 会话下自动使用 Codex，在 `xai/*` 会话下自动使用 Grok；在其他模型会话中也可显式指定 `provider`。
- **支持参考图编辑**：通过 Codex 支持最多传入 5 张本地图片或最近对话中的图片（PNG、JPEG、WebP）进行垫图编辑。
- **稳健的多图顺序生成**：单次可顺序生成 1–4 张图片，避免并发突发扣费；即使后续某张失败或中途取消，已生成的图片仍会内联展示并落盘保存。

---

## 前置依赖

- 已安装 [Pi](https://github.com/earendil-works/pi-mono)
- **Node.js >= 22.19.0**
- 已在 Pi 中通过 `/login` 登录至少一个支持的订阅账号：
  - **ChatGPT Plus / Pro (Codex)**（`openai-codex` OAuth）：用于 Codex 文生图与参考图编辑
  - **X Premium / SuperGrok**（`xai` 订阅登录）：用于 Grok Imagine 文生图

---

## 安装

从 npm 安装：

```bash
pi install npm:@specode/pi-subscription-image
```

或直接从 GitHub 安装：

```bash
pi install git:github.com/specode/pi-subscription-image
```

本地源码免安装试用：

```bash
pi --no-extensions --offline -e /path/to/pi-subscription-image
```

安装完成后重启 Pi 或执行 `/reload`。

---

## 快速开始

1. **登录订阅账号**（如尚未登录）：

```text
/login
```

2. **检查账号就绪状态**（安全检查，不会暴露任何令牌）：

```text
/subscription-image status
```

3. **开始生成图片**（支持 `/img` 命令或自然语言对话）：

```text
/img 一枚红熊猫扁平矢量图标
```

```text
生成一张月球科研站日出时分的电影感 16:9 图片，并把上一张图的配色作为参考。
```

生成的图片会直接在终端对话中内联展示，并默认保存到 `~/.pi/agent/generated-images/`。

---

## 使用与参数说明

### 平台能力对比

| 能力 | OpenAI Codex (`codex`) | xAI Grok (`grok`) |
| --- | --- | --- |
| **认证方式** | Pi `openai-codex` OAuth | Pi `xai` 订阅登录 |
| **文生图** | 支持 | 支持 |
| **参考图编辑** | 支持（最多 5 张 PNG/JPEG/WebP） | 当前未开放 |
| **输出格式** | `png`、`jpeg`、`webp` | 由服务端决定（按返回字节自动识别） |
| **宽高比 (`aspectRatio`)** | 以确定性约束追加到 Prompt | 原生请求参数 |
| **分辨率 (`resolution`)** | 由服务端决定 | `1k`（默认）或 `2k` |
| **质量等级 (`quality`)** | 由服务端决定 | `low` 或 `medium`（仅 Imagine 2.0） |
| **默认模型** | `gpt-5.6-sol`（底层路由至 `gpt-image-2`） | `grok-imagine-image-2.0` |

### 工具参数 (`generate_image_with_subscription`)

| 参数 | 说明 |
| --- | --- |
| `prompt` | **必填。** 图片描述或编辑指令 |
| `provider` | `auto`（默认）、`codex`（别名 `openai`）或 `grok`（别名 `xai`） |
| `model` | 单次调用覆盖模型（Codex 路由模型或 Grok Imagine 模型） |
| `aspectRatio` | 图片宽高比约束（兼容旧别名 `aspect_ratio`） |
| `n` | 顺序生成张数（`1`–`4`） |
| `outputFormat` | **仅 Codex**：`png`、`jpeg` 或 `webp` |
| `referencedImagePaths` | **仅 Codex**：最多 5 张本地参考图路径 |
| `numLastImagesToInclude` | **仅 Codex**：引用最近对话中的前 N 张图片进行编辑 |
| `resolution` | **仅 Grok**：`1k`（默认）或 `2k` |
| `quality` | **仅 Grok Imagine 2.0**：`low` 或 `medium`（默认不发送） |
| `save` | 保存模式：`global`（默认）、`project`、`custom` 或 `none` |
| `saveDir` | `save="custom"` 时的自定义保存目录 |

### 保存位置

| 模式 | 目录路径 |
| --- | --- |
| `global`（默认） | `~/.pi/agent/generated-images/` |
| `project` | `<cwd>/.pi/generated-images/` |
| `custom` | `saveDir` 参数或配置文件指定的目录 |
| `none` | 仅返回内联图片，不写入磁盘 |

---

## 配置

支持全局配置文件 `~/.pi/agent/extensions/subscription-image.json` 与受信任项目配置 `<project>/.pi/extensions/subscription-image.json`（仅当项目受信任时生效并深度合并）：

```json
{
  "defaultProvider": "codex",
  "save": "global",
  "saveDir": "~/Pictures/generated",
  "providers": {
    "codex": {
      "routingModel": "gpt-5.6-sol",
      "outputFormat": "png"
    },
    "grok": {
      "imageModel": "grok-imagine-image-2.0",
      "resolution": "1k"
    }
  }
}
```

- 可按需设置 `providers.grok.quality` 为 `"low"` 或 `"medium"`。
- 兼容旧版顶层键 `codexRoutingModel` 与 `grokImageModel`。

### 环境变量覆盖

- `PI_SUBSCRIPTION_IMAGE_PROVIDER`
- `PI_SUBSCRIPTION_IMAGE_SAVE_MODE`（兼容 `PI_IMAGE_SAVE_MODE`）
- `PI_SUBSCRIPTION_IMAGE_SAVE_DIR`（兼容 `PI_IMAGE_SAVE_DIR`）
- `PI_SUBSCRIPTION_IMAGE_CODEX_MODEL`
- `PI_SUBSCRIPTION_IMAGE_CODEX_OUTPUT_FORMAT`
- `PI_SUBSCRIPTION_IMAGE_GROK_MODEL`
- `PI_SUBSCRIPTION_IMAGE_GROK_RESOLUTION`
- `PI_SUBSCRIPTION_IMAGE_GROK_QUALITY`
- `PI_SUBSCRIPTION_IMAGE_GROK_BASE_URL`

---

## 设计思路与工作原理

### 为什么设计成单一工具？

市面上常见的生图扩展往往为每个厂商注册独立工具，参数命名、落盘策略与返回值格式各不相同。本项目将通用能力收敛为统一的 `generate_image_with_subscription` 契约，同时让平台特有参数（如 Codex 的 `outputFormat`/参考图、Grok 的 `resolution`/`quality`）保持显式透明，绝不在后台静默润色或篡改用户的 Prompt。

### 自动路由优先级

当未指定 `provider` 或传入 `provider="auto"` 时，按以下顺序决定生图后端：

1. **传入了参考图** → 自动选择 **Codex**（仅 Codex 支持垫图编辑）。
2. **当前会话模型为 `openai-codex/*`** → 自动选择 **Codex**。
3. **当前会话模型为 `xai/*`** → 自动选择 **Grok**。
4. **配置了 `defaultProvider`** → 使用配置的默认平台。
5. **以上均不满足** → 提示显式指定 `provider`，避免在未知会话中误扣订阅额度。

### 在 Codemode 脚本中调用

在支持 `outputSchema` / `structuredContent` 的 Pi 版本中，可在 Codemode 脚本里直接调用：

```js
const result = await tools.generate_image_with_subscription({
  prompt: "一只水彩风格的红熊猫",
});
for (const block of result.output) {
  if (block.type === "image") image(block);
  else text(block.text);
}
```

- **返回值结构**：`{ provider, model, output, generationErrors, savedPaths, saveWarnings }`。
- **Codemode 注意事项**：
  - 请始终通过 `image(block)` 渲染图片，**切勿**用 `text()`、`console` 或 `return` 直接打印完整结果或 base64 字符串（Pi codemode 单脚本输出上限为 16 MiB，多张大图 base64 会触发超限失败）。
  - Codex 多图生成建议保留默认落盘并将 `outputFormat` 设为 `"webp"` 或 `"jpeg"`。
  - 生图可能耗时数分钟，请勿设置过短的脚本超时时间。

### 安全与服务边界

- 本项目为非官方社区扩展，实际可用性、配额与地区限制遵循各平台服务条款。
- 凭据仅在内存中通过 Pi provider registry 解析，不落盘、不收集遥测数据。
- 参数校验失败（如 `save="custom"` 未填目录）会在消耗额度前直接拦截。

---

## 本地开发

```bash
npm install
npm test
npm run smoke
npm run check
```

## 许可证

采用 [MIT](./LICENSE) 许可证。实现参考与第三方归属见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
