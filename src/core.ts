export const PROVIDERS = ["auto", "codex", "grok"] as const;
export const ASPECT_RATIOS = [
	"1:1",
	"3:4",
	"4:3",
	"9:16",
	"16:9",
	"2:3",
	"3:2",
	"9:19.5",
	"19.5:9",
] as const;
export const OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;
export const GROK_RESOLUTIONS = ["1k", "2k"] as const;
export const GROK_QUALITIES = ["low", "medium"] as const;
export const SAVE_MODES = ["none", "project", "global", "custom"] as const;

export type Provider = Exclude<(typeof PROVIDERS)[number], "auto">;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
export type GrokResolution = (typeof GROK_RESOLUTIONS)[number];
export type GrokQuality = (typeof GROK_QUALITIES)[number];
export type SaveMode = (typeof SAVE_MODES)[number];

const PROVIDER_ALIASES: Record<string, (typeof PROVIDERS)[number]> = {
	openai: "codex",
	"openai-codex": "codex",
	xai: "grok",
	"grok-cli": "grok",
};

export interface ResolveProviderOptions {
	requested?: string;
	sessionProvider?: string;
	defaultProvider?: Provider;
	requiresCodex?: boolean;
}

export function prepareToolArguments(args: unknown): unknown {
	if (!args || typeof args !== "object" || Array.isArray(args)) return args;
	const input = { ...(args as Record<string, unknown>) };
	if (typeof input.provider === "string") {
		const normalized = input.provider.trim().toLowerCase();
		input.provider = PROVIDER_ALIASES[normalized] ?? normalized;
	}
	if (
		input.aspectRatio === undefined &&
		typeof input.aspect_ratio === "string"
	) {
		input.aspectRatio = input.aspect_ratio;
	}
	delete input.aspect_ratio;
	return input;
}

export function resolveProvider(options: ResolveProviderOptions): Provider {
	const requested = options.requested?.trim().toLowerCase() || "auto";
	if (requested === "codex" || requested === "grok") return requested;
	if (requested !== "auto") {
		throw new Error(`Unknown subscription image provider: ${options.requested}`);
	}
	if (options.requiresCodex) return "codex";

	const session = options.sessionProvider?.trim().toLowerCase();
	if (session === "openai-codex") return "codex";
	if (session === "xai") return "grok";
	if (options.defaultProvider) return options.defaultProvider;

	const current = session || "none";
	throw new Error(
		`The current session provider (${current}) does not select a subscription image backend. Pass provider=codex or provider=grok, or configure defaultProvider.`,
	);
}

export function normalizeCount(value: number | undefined): number {
	if (value === undefined) return 1;
	if (
		!Number.isFinite(value) ||
		!Number.isInteger(value) ||
		value < 1 ||
		value > 4
	) {
		throw new Error("n must be an integer between 1 and 4.");
	}
	return value;
}

export function withAspectRatioConstraint(
	prompt: string,
	aspectRatio: AspectRatio | undefined,
): string {
	const normalized = prompt.trim();
	if (!aspectRatio) return normalized;
	return `${normalized}\n\nComposition requirement: create the image at a ${aspectRatio} aspect ratio.`;
}

export function parseRetryAfterMs(
	value: string | null,
	nowMs = Date.now(),
	maximumMs = 30_000,
): number | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
		const milliseconds = Number(trimmed) * 1000;
		return Number.isFinite(milliseconds)
			? Math.min(milliseconds, maximumMs)
			: undefined;
	}
	const dateMs = Date.parse(trimmed);
	if (!Number.isFinite(dateMs) || dateMs <= nowMs) return undefined;
	return Math.min(dateMs - nowMs, maximumMs);
}

export function retryDelayMs(
	attempt: number,
	retryAfter: string | null,
	random = Math.random,
	nowMs = Date.now(),
): number {
	const serverDelay = parseRetryAfterMs(retryAfter, nowMs);
	if (serverDelay !== undefined) {
		return Math.floor(Math.min(serverDelay * (1 + random() * 0.1), 30_000));
	}
	const exponential = Math.min(750 * 2 ** Math.max(0, attempt - 1), 30_000);
	return Math.floor(exponential * (0.9 + random() * 0.2));
}

export function abortableDelay(
	milliseconds: number,
	signal?: AbortSignal,
): Promise<void> {
	if (signal?.aborted)
		return Promise.reject(new Error("Image generation was cancelled."));
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(finish, milliseconds);
		function cleanup() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
		}
		function finish() {
			cleanup();
			resolve();
		}
		function abort() {
			cleanup();
			reject(new Error("Image generation was cancelled."));
		}
		signal?.addEventListener("abort", abort, { once: true });
	});
}

export function createRequestSignal(
	parent: AbortSignal | undefined,
	timeoutMs: number,
) {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(new Error("Image request timed out.")),
		timeoutMs,
	);
	const abort = () =>
		controller.abort(
			parent?.reason ?? new Error("Image generation was cancelled."),
		);
	if (parent?.aborted) abort();
	else parent?.addEventListener("abort", abort, { once: true });
	return {
		signal: controller.signal,
		cleanup() {
			clearTimeout(timeout);
			parent?.removeEventListener("abort", abort);
		},
	};
}

export function mimeFromBytes(bytes: Buffer): string | undefined {
	if (
		bytes.length >= 8 &&
		bytes
			.subarray(0, 8)
			.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
	) {
		return "image/png";
	}
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff
	) {
		return "image/jpeg";
	}
	if (
		bytes.length >= 12 &&
		bytes.toString("ascii", 0, 4) === "RIFF" &&
		bytes.toString("ascii", 8, 12) === "WEBP"
	) {
		return "image/webp";
	}
	return undefined;
}

export function decodeBase64Image(
	base64Data: string,
	expectedMimeType?: string,
): Buffer {
	const value = base64Data.trim();
	if (!value || value.length % 4 !== 0) {
		throw new Error("The image provider returned invalid base64 data.");
	}
	const bytes = Buffer.from(value, "base64");
	if (!bytes.length || bytes.toString("base64") !== value) {
		throw new Error("The image provider returned invalid base64 data.");
	}
	const actualMimeType = mimeFromBytes(bytes);
	if (!actualMimeType)
		throw new Error("The image provider returned an unsupported image format.");
	if (expectedMimeType && actualMimeType !== expectedMimeType) {
		throw new Error(
			`The image provider returned ${actualMimeType}, expected ${expectedMimeType}.`,
		);
	}
	return bytes;
}

export function outputFormatForMimeType(mimeType: string): OutputFormat {
	switch (mimeType) {
		case "image/png":
			return "png";
		case "image/jpeg":
			return "jpeg";
		case "image/webp":
			return "webp";
		default:
			throw new Error(`Unsupported image MIME type: ${mimeType}`);
	}
}

export function extensionForMimeType(mimeType: string): string {
	const format = outputFormatForMimeType(mimeType);
	return format === "jpeg" ? "jpg" : format;
}
