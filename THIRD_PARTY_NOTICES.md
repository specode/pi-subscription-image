# Third-party notices

This project contains an independently maintained implementation informed by the following open-source Pi extensions. Their public tool contracts, request flows, retry behavior, and validation strategies were used as implementation references; no upstream package is loaded at runtime.

## pi-codex-image-gen

- Source: https://github.com/jvm/pi-mono/tree/main/packages/pi-codex-image-gen
- License: Apache License 2.0
- Referenced areas: Codex OAuth credential resolution, Codex Responses `image_generation` request shape, SSE parsing, reference-image handling, and image validation.

The upstream package also includes assets derived from OpenAI Codex. Those assets are not included in this package, so its asset-specific `NOTICE` entries do not apply to this distribution. A copy of the Apache License 2.0 is included at [`LICENSES/Apache-2.0.txt`](./LICENSES/Apache-2.0.txt).

## pi-grok-cli

- Copyright (c) 2026 kenryu42
- Source: https://github.com/kenryu42/pi-grok-cli
- License: MIT
- Referenced areas: Grok Imagine request shape, retry policy, aspect-ratio normalization, and response validation.

This package retains the required copyright attribution and includes the upstream license text at [`LICENSES/pi-grok-cli-MIT.txt`](./LICENSES/pi-grok-cli-MIT.txt).

## Local modifications

The implementation in this package unifies provider routing, parameter compatibility, save behavior, inline image results, configuration, and tests under a single `generate_image` tool. It does not bundle either upstream extension or their authentication stores.
