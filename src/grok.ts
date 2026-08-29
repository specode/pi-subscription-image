import {
	abortableDelay,
	createRequestSignal,
	decodeBase64Image,
	mimeFromBytes,
	retryDelayMs,
	type AspectRatio,
	type GrokQuality,
	type GrokResolution,
} from "./core.ts";

const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 120_000;

export interface GrokGenerationResult {
	b64: string;
	mimeType: "image/png" | "image/jpeg" | "image/webp";
}

function retryable(status: number): boolean {
	return (
		status === 408 ||
		status === 409 ||
		status === 425 ||
		status === 429 ||
		status >= 500
	);
}

async function responseError(response: Response): Promise<string> {
	const text = await response.text().catch(() => "");
	if (!text) return "";
	try {
		const parsed = JSON.parse(text) as {
			error?: { message?: string };
			message?: string;
		};
		return parsed.error?.message ?? parsed.message ?? text;
	} catch {
		return text;
	}
}

function grokHttpError(status: number, detail: string): Error {
	const suffix = detail ? `: ${detail.slice(0, 500)}` : "";
	if (status === 401 || status === 403) {
		return new Error(
			`Grok Imagine rejected the subscription credentials (HTTP ${status}). Run /login xai again${suffix}`,
		);
	}
	if (status === 429) {
		return new Error(`Grok Imagine rate limited the request (HTTP 429)${suffix}`);
	}
	return new Error(`Grok Imagine request failed (HTTP ${status})${suffix}`);
}

export async function generateGrokImage(options: {
	token: string;
	prompt: string;
	model: string;
	aspectRatio?: AspectRatio;
	resolution?: GrokResolution;
	quality?: GrokQuality;
	baseUrl?: string;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
}): Promise<GrokGenerationResult> {
	if (
		options.quality !== undefined &&
		!options.model.startsWith("grok-imagine-image-2")
	) {
		throw new Error(
			"Grok quality is supported only by grok-imagine-image-2.0 models.",
		);
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const baseUrl = (
		options.baseUrl ??
		process.env.PI_SUBSCRIPTION_IMAGE_GROK_BASE_URL ??
		process.env.PI_GROK_CLI_IMAGINE_BASE_URL ??
		"https://api.x.ai/v1"
	).replace(/\/+$/, "");

	for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
		if (options.signal?.aborted)
			throw new Error("Image generation was cancelled.");
		const request = createRequestSignal(options.signal, REQUEST_TIMEOUT_MS);
		let retryAfter: string | null = null;
		try {
			const response = await fetchImpl(`${baseUrl}/images/generations`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${options.token}`,
					"content-type": "application/json",
					accept: "application/json",
					"user-agent": "pi-subscription-image/0.1",
				},
				body: JSON.stringify({
					model: options.model,
					prompt: options.prompt,
					n: 1,
					aspect_ratio: options.aspectRatio ?? "1:1",
					resolution: options.resolution ?? "1k",
					...(options.quality ? { quality: options.quality } : {}),
					response_format: "b64_json",
				}),
				signal: request.signal,
			});
			if (!response.ok) {
				const detail = await responseError(response);
				if (attempt <= MAX_RETRIES && retryable(response.status)) {
					retryAfter = response.headers.get("retry-after");
				} else {
					throw grokHttpError(response.status, detail);
				}
			} else {
				const parsed = (await response.json()) as {
					data?: Array<{ b64_json?: unknown }>;
				};
				const b64 = parsed.data?.[0]?.b64_json;
				if (typeof b64 !== "string" || !b64) {
					throw new Error(
						"Grok Imagine returned a malformed response: missing image data.",
					);
				}
				let mimeType: ReturnType<typeof mimeFromBytes>;
				try {
					mimeType = mimeFromBytes(decodeBase64Image(b64));
				} catch (error) {
					throw new Error(
						`Grok Imagine returned a malformed image: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				if (
					mimeType !== "image/png" &&
					mimeType !== "image/jpeg" &&
					mimeType !== "image/webp"
				) {
					throw new Error(
						"Grok Imagine returned a malformed response: unsupported image format.",
					);
				}
				return { b64, mimeType };
			}
		} catch (error) {
			if (options.signal?.aborted)
				throw new Error("Image generation was cancelled.");
			if (error instanceof Error && error.message.startsWith("Grok Imagine")) {
				throw error;
			}
			if (attempt > MAX_RETRIES) {
				throw new Error(
					`Grok Imagine network request failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		} finally {
			request.cleanup();
		}
		await abortableDelay(retryDelayMs(attempt, retryAfter), options.signal);
	}
	throw new Error("Grok Imagine request failed after all retries.");
}
