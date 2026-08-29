# pi-subscription-image

[简体中文](./README.zh-CN.md)

A [Pi](https://github.com/earendil-works/pi-mono) image generation extension that exposes one `generate_image` tool and uses quota from existing OpenAI Codex and xAI Grok subscription accounts.

## Why

Image extensions often expose provider-specific tools with different parameters and save behavior. This package keeps one stable tool contract, routes by the active Pi session provider, and returns every generated image inline.

## Features

- Reuses Pi's `openai-codex` OAuth login for Codex image generation.
- Reuses Pi's `xai` subscription login for Grok Imagine.
- Provides the `generate_image` tool and `/img` command.
- Automatically routes `openai-codex/*` sessions to Codex and `xai/*` sessions to Grok.
- Lets callers explicitly select `provider=codex` or `provider=grok` from other sessions.
- Supports up to four sequential generations per call.
- Supports Codex reference-image editing with up to five PNG, JPEG, or WebP inputs.
- Preserves `none`, `project`, `global`, and `custom` save modes.
- Returns valid images inline even when optional disk persistence fails.
- Includes strict base64, MIME, timeout, retry, and response validation.
- Does not store credentials or send telemetry.

## Provider capabilities

| Capability | Codex | Grok |
| --- | --- | --- |
| Authentication | Pi `openai-codex` OAuth | Pi `xai` subscription login |
| Text-to-image | Yes | Yes |
| Reference-image editing | Yes, up to five inputs | Not currently exposed |
| Output | PNG, JPEG, WebP | Provider-selected and detected from returned bytes |
| Aspect ratio | Prompt constraint | Native request parameter |
| Resolution | Backend-selected | `1k` or `2k`; default `1k` |
| Quality level | Not currently exposed | `low` or `medium`; Imagine 2.0 only |
| Default model | `gpt-5.6-sol` routing to the currently known `gpt-image-2` backend | `grok-imagine-image-2.0` |

## Installation

Install from npm after the first release:

```bash
pi install npm:@specode/pi-subscription-image
```

Try a local checkout without installing:

```bash
pi --no-extensions --offline -e /path/to/pi-subscription-image
```

Restart Pi or run `/reload` after installation.

## Authentication

Use Pi's normal login flow:

```text
/login
```

- Select **ChatGPT Plus/Pro (Codex)** for Codex.
- Select the **xAI** subscription login for X Premium or SuperGrok.

Check readiness without exposing credentials:

```text
/subscription-image status
```

## Usage

Natural language:

```text
Generate a cinematic 16:9 image of a lunar research station at sunrise.
```

Direct command:

```text
/img a flat vector icon of a red panda
```

The model calls `generate_image`. The public parameters are:

| Parameter | Description |
| --- | --- |
| `prompt` | Required image prompt or edit instruction |
| `provider` | `auto`, `codex`, or `grok` |
| `model` | Codex routing model or Grok Imagine image model |
| `aspectRatio` | Common aspect-ratio constraint |
| `n` | One to four sequential images |
| `outputFormat` | Codex only: `png`, `jpeg`, or `webp`; Grok selects the actual format |
| `resolution` | Grok only: `1k` or `2k`; default `1k` |
| `quality` | Grok Imagine 2.0 only: `low` or `medium`; omitted by default |
| `save` | `none`, `project`, `global`, or `custom` |
| `saveDir` | Directory for `save=custom` |
| `referencedImagePaths` | Codex: up to five local images |
| `numLastImagesToInclude` | Codex: recent conversation images to edit |

Provider aliases are accepted:

- `provider=openai` maps to `codex`.
- `provider=xai` maps to `grok`.
- `aspect_ratio` maps to `aspectRatio` before validation.

## Routing

With `provider=auto` or no provider:

1. Reference-image inputs select Codex.
2. An `openai-codex/*` session selects Codex.
3. An `xai/*` session selects Grok.
4. `defaultProvider` is used when configured.
5. Otherwise the tool asks for an explicit provider instead of spending quota unexpectedly.

## Save behavior

| Mode | Location |
| --- | --- |
| `none` | Inline result only |
| `project` | `<cwd>/.pi/generated-images/` |
| `global` | `~/.pi/agent/generated-images/` |
| `custom` | `saveDir` or configured directory |

The default save mode is `global`.

## Configuration

Global configuration:

```text
~/.pi/agent/extensions/subscription-image.json
```

Trusted project configuration:

```text
<project>/.pi/extensions/subscription-image.json
```

Project values override global values only when project trust is active.

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

Set `providers.grok.quality` to `low` or `medium` when needed. When omitted, the extension does not send the field to xAI. The legacy `codexRoutingModel` and `grokImageModel` keys remain supported. Global and trusted-project `providers.codex` and `providers.grok` blocks are deep-merged independently.

The truly common parameters are `prompt`, `provider`, the per-call `model` override, `aspectRatio`, `n`, `save`, and `saveDir`. Provider-specific capabilities remain explicit: Codex owns `outputFormat` and reference-image inputs; Grok owns `resolution` and `quality`. The extension does not silently rewrite or embellish prompts; only Codex receives a deterministic aspect-ratio constraint appended to the prompt.

Environment overrides:

- `PI_SUBSCRIPTION_IMAGE_PROVIDER`
- `PI_SUBSCRIPTION_IMAGE_SAVE_MODE`
- `PI_SUBSCRIPTION_IMAGE_SAVE_DIR`
- `PI_SUBSCRIPTION_IMAGE_CODEX_MODEL`
- `PI_SUBSCRIPTION_IMAGE_CODEX_OUTPUT_FORMAT`
- `PI_SUBSCRIPTION_IMAGE_GROK_MODEL`
- `PI_SUBSCRIPTION_IMAGE_GROK_RESOLUTION`
- `PI_SUBSCRIPTION_IMAGE_GROK_QUALITY`
- `PI_SUBSCRIPTION_IMAGE_GROK_BASE_URL`

`PI_IMAGE_SAVE_MODE` and `PI_IMAGE_SAVE_DIR` are also accepted.

## Security and service boundaries

- This is an unofficial community extension.
- It reads resolved credentials through Pi's provider registry and never writes them to package-owned storage.
- Prompts and reference images are sent to the selected provider.
- Codex generation uses the ChatGPT Codex Responses backend and its built-in `image_generation` tool.
- Grok generation uses the xAI image generation endpoint.
- Subscription availability, quotas, regional access, and provider terms still apply.
- Backend changes can require a package update.

## Development

```bash
npm install
npm test
npm run smoke
npm run check
```

Pushes to `main` and pull requests run type checking, tests, Pi loading, and package validation. The npm release workflow follows OIDC Trusted Publishing: creating a GitHub release repeats those checks and then publishes without a long-lived npm token.

## License

[MIT](./LICENSE). See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for implementation references and attribution.
