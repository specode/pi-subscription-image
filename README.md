# pi-subscription-image

[English](./README.md) | [简体中文](./README.zh-CN.md)

Generate and edit images in [Pi](https://github.com/earendil-works/pi-mono) using quota from your existing **OpenAI Codex** and **xAI Grok** subscription accounts — without separate API keys or per-image billing.

- **Single unified tool** — exposes one `generate_image_with_subscription` tool and `/img` command across providers.
- **Smart session routing** — automatically routes `openai-codex/*` sessions to Codex and `xai/*` sessions to Grok, or lets you pick a provider explicitly from any model session.
- **Reference-image editing** — edit up to 5 local or recent conversation images (PNG, JPEG, WebP) via Codex.
- **Resilient multi-image generation** — generates 1–4 images sequentially; if a later image fails or is cancelled, earlier images are still returned inline and saved to disk.

---

## Requirements

- [Pi](https://github.com/earendil-works/pi-mono) installed
- **Node.js >= 22.19.0**
- At least one supported subscription logged in via `/login`:
  - **ChatGPT Plus / Pro (Codex)** (`openai-codex` OAuth) for Codex image generation & editing
  - **X Premium / SuperGrok** (`xai` subscription login) for Grok Imagine

---

## Installation

Install from npm:

```bash
pi install npm:@specode/pi-subscription-image
```

Or install directly from GitHub:

```bash
pi install git:github.com/specode/pi-subscription-image
```

Try a local checkout without installing:

```bash
pi --no-extensions --offline -e /path/to/pi-subscription-image
```

Restart Pi or run `/reload` after installation.

---

## Quick Start

1. **Authenticate** in Pi if you haven't already:

```text
/login
```

2. **Check provider readiness** (verifies login status without exposing credentials):

```text
/subscription-image status
```

3. **Generate an image** with `/img` or natural language:

```text
/img a flat vector icon of a red panda
```

```text
Generate a cinematic 16:9 image of a lunar research station at sunrise.
```

Generated images are rendered inline in the conversation and saved to `~/.pi/agent/generated-images/` by default.

---

## Usage & Parameters

### Provider Capabilities at a Glance

| Capability | OpenAI Codex (`codex`) | xAI Grok (`grok`) |
| --- | --- | --- |
| **Pi Login** | `openai-codex` OAuth | `xai` subscription login |
| **Text-to-Image** | Yes | Yes |
| **Reference-Image Editing** | Yes (up to 5 images) | Not currently exposed |
| **Output Format** | `png`, `jpeg`, `webp` | Auto-detected from returned bytes |
| **Aspect Ratio** | Appended as a prompt constraint | Native request parameter |
| **Resolution** | Backend-selected | `1k` (default) or `2k` |
| **Quality Level** | Backend-selected | `low` or `medium` (Imagine 2.0 only) |
| **Default Model** | `gpt-5.6-sol` (`gpt-image-2` backend) | `grok-imagine-image-2.0` |

### Tool Parameters (`generate_image_with_subscription`)

| Parameter | Description |
| --- | --- |
| `prompt` | **Required.** Image description or editing instruction |
| `provider` | `auto` (default), `codex` (alias: `openai`), or `grok` (alias: `xai`) |
| `model` | Per-call model override (Codex routing model or Grok Imagine model) |
| `aspectRatio` | Aspect-ratio constraint (alias: `aspect_ratio`) |
| `n` | Number of sequential images to generate (`1`–`4`) |
| `outputFormat` | **Codex only:** `png`, `jpeg`, or `webp` |
| `referencedImagePaths` | **Codex only:** Up to 5 local image paths (`png`, `jpeg`, `webp`) |
| `numLastImagesToInclude` | **Codex only:** Include recent conversation images as editing references |
| `resolution` | **Grok only:** `1k` (default) or `2k` |
| `quality` | **Grok Imagine 2.0 only:** `low` or `medium` (omitted by default) |
| `save` | `global` (default), `project`, `custom`, or `none` |
| `saveDir` | Target directory when `save="custom"` |

### Save Locations

| Mode | Directory |
| --- | --- |
| `global` (default) | `~/.pi/agent/generated-images/` |
| `project` | `<cwd>/.pi/generated-images/` |
| `custom` | Path specified by `saveDir` or config |
| `none` | Returned inline only (no disk write) |

---

## Configuration

Create a global config at `~/.pi/agent/extensions/subscription-image.json` or a trusted-project config at `<project>/.pi/extensions/subscription-image.json` (project values override global values only when the project is trusted):

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

- Optional: set `providers.grok.quality` to `"low"` or `"medium"`.
- Legacy top-level keys (`codexRoutingModel`, `grokImageModel`) remain supported, and `providers.codex` / `providers.grok` blocks are deep-merged independently.

### Environment Variables

- `PI_SUBSCRIPTION_IMAGE_PROVIDER`
- `PI_SUBSCRIPTION_IMAGE_SAVE_MODE` (or `PI_IMAGE_SAVE_MODE`)
- `PI_SUBSCRIPTION_IMAGE_SAVE_DIR` (or `PI_IMAGE_SAVE_DIR`)
- `PI_SUBSCRIPTION_IMAGE_CODEX_MODEL`
- `PI_SUBSCRIPTION_IMAGE_CODEX_OUTPUT_FORMAT`
- `PI_SUBSCRIPTION_IMAGE_GROK_MODEL`
- `PI_SUBSCRIPTION_IMAGE_GROK_RESOLUTION`
- `PI_SUBSCRIPTION_IMAGE_GROK_QUALITY`
- `PI_SUBSCRIPTION_IMAGE_GROK_BASE_URL`

---

## Architecture & Design

### Why One Unified Tool?

Many image extensions register separate provider-specific tools with incompatible arguments and file-saving rules. `pi-subscription-image` exposes a single stable contract (`generate_image_with_subscription`), keeps shared parameters unified (`prompt`, `provider`, `model`, `aspectRatio`, `n`, `save`, `saveDir`), and leaves provider-specific capabilities explicit without silently rewriting or embellishing your prompts.

### Automatic Provider Routing

When `provider` is omitted or set to `"auto"`, the extension resolves the backend in this order:

1. **Reference images present** → routes to **Codex** (since reference editing is Codex-only).
2. **Active session is `openai-codex/*`** → routes to **Codex**.
3. **Active session is `xai/*`** → routes to **Grok**.
4. **`defaultProvider` configured** → uses the configured default.
5. **Otherwise** → prompts for an explicit provider instead of spending quota on the wrong account.

### Calling from Codemode Scripts

On Pi versions supporting `outputSchema` / `structuredContent`, codemode scripts can invoke the tool directly:

```js
const result = await tools.generate_image_with_subscription({
  prompt: "A red panda in watercolor",
});
for (const block of result.output) {
  if (block.type === "image") image(block);
  else text(block.text);
}
```

- **Return shape**: `{ provider, model, output, generationErrors, savedPaths, saveWarnings }`.
- **Best practices for Codemode**:
  - Render image blocks with `image(block)` — do **not** pass the raw result or base64 data into `text()`, `console.log`, or `return`, as Pi codemode caps total script output at 16 MiB.
  - Keep disk saving enabled and prefer `outputFormat: "webp"` or `"jpeg"` when generating multiple Codex images.
  - Avoid short script timeouts, as image generation can take several minutes.

### Security & Service Boundaries

- Unofficial community extension; provider terms, quotas, and regional restrictions apply.
- Credentials are read strictly from Pi's provider registry in memory and never stored by this package; no telemetry is sent.
- Codex uses the ChatGPT Codex Responses backend (`image_generation` tool); Grok uses the xAI image generation endpoint.

---

## Development

```bash
npm install
npm test
npm run smoke
npm run check
```

## License

[MIT](./LICENSE). See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for implementation references and attribution.
