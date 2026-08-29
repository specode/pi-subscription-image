import {
	abortableDelay,
	createRequestSignal,
	retryDelayMs,
	type OutputFormat,
} from "./core.ts";
import type { InputImage } from "./input-images.ts";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
export const CODEX_IMAGE_BACKEND_MODEL = "gpt-image-2";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 120_000;

interface CodexImageResult {
	id: string;
	status: string;
	result: string;
	revisedPrompt?: string;
}

export interface CodexGenerationResult {
	b64: string;
	mimeType: string;
	imageId: string;
	status: string;
	revisedPrompt?: string;
	responseId?: string;
	usage?: unknown;
}

interface ParsedCodexResponse {
	image?: CodexImageResult;
	text: string[];
	responseId?: string;
	usage?: unknown;
}

type CodexSseEvent =
	| { type: "error"; message?: string; code?: string }
	| { type: "response.failed"; response?: { error?: { message?: string } } }
	| { type: "response.created"; response?: { id?: string } }
	| { type: "response.output_text.delta"; delta?: string }
	| {
			type: "response.output_item.done";
			item?: {
				type?: string;
				id?: string | number;
				status?: string;
				result?: string;
				revised_prompt?: string;
			};
	  }
	| { type: "response.completed"; response?: { id?: string; usage?: unknown } };

function decodeJwtPayload(token: string): Record<string, unknown> {
	const parts = token.split(".");
	if (parts.length !== 3 || !parts[1]) {
		throw new Error(
			"OpenAI Codex credentials are not a valid JWT. Run /login for openai-codex again.",
		);
	}
	try {
		return JSON.parse(
			Buffer.from(parts[1], "base64url").toString("utf8"),
		) as Record<string, unknown>;
	} catch (error) {
		throw new Error(
			`Failed to decode OpenAI Codex credentials: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function extractChatGptAccountId(token: string): string {
	const payload = decodeJwtPayload(token);
	const authClaims = payload[JWT_CLAIM_PATH];
	if (!authClaims || typeof authClaims !== "object") {
		throw new Error(
			"OpenAI Codex credentials do not contain ChatGPT auth claims. Run /login for openai-codex again.",
		);
	}
	const accountId = (authClaims as Record<string, unknown>).chatgpt_account_id;
	if (typeof accountId !== "string" || !accountId) {
		throw new Error(
			"OpenAI Codex credentials do not contain chatgpt_account_id. Run /login for openai-codex again.",
		);
	}
	return accountId;
}

export function buildCodexRequestBody(options: {
	prompt: string;
	model: string;
	outputFormat: OutputFormat;
	sessionId: string;
	inputImages?: InputImage[];
}) {
	return {
		model: options.model,
		store: false,
		stream: true,
		prompt_cache_key: options.sessionId,
		instructions:
			"You are generating bitmap image assets. Call the image_generation tool exactly once. Do not answer with only text unless image generation is unavailable.",
		input: [
			{
				role: "user",
				content: [
					{ type: "input_text", text: options.prompt },
					...(options.inputImages ?? []).map((image) => ({
						type: "input_image",
						image_url: `data:${image.mimeType};base64,${image.data}`,
					})),
				],
			},
		],
		tools: [{ type: "image_generation", output_format: options.outputFormat }],
		tool_choice: "auto",
		parallel_tool_calls: false,
		text: { verbosity: "low" },
	};
}

class CodexResponseError extends Error {
	readonly retryable: boolean;

	constructor(message: string, retryable: boolean) {
		super(`Codex ${message}`);
		this.name = "CodexResponseError";
		this.retryable = retryable;
	}
}

function isRetryableErrorText(errorText: string): boolean {
	return /rate.?limit|overloaded|service.?unavailable|upstream.?connect|connection.?refused|temporar(?:y|ily)/i.test(
		errorText,
	);
}

function handleCodexEvent(
	event: CodexSseEvent,
	parsed: ParsedCodexResponse,
): void {
	switch (event.type) {
		case "error": {
			const detail = event.message || event.code || "unknown error";
			throw new CodexResponseError(
				`error: ${detail}`,
				isRetryableErrorText(detail),
			);
		}
		case "response.failed": {
			const detail = event.response?.error?.message || "unknown response failure";
			throw new CodexResponseError(
				`response failed: ${detail}`,
				isRetryableErrorText(detail),
			);
		}
		case "response.created":
			if (event.response?.id) parsed.responseId = event.response.id;
			break;
		case "response.output_text.delta":
			if (typeof event.delta === "string") parsed.text.push(event.delta);
			break;
		case "response.output_item.done":
			if (event.item?.type === "image_generation_call") {
				if (!event.item.result) {
					throw new CodexResponseError(
						"image_generation_call did not contain image data.",
						false,
					);
				}
				parsed.image = {
					id: String(event.item.id || "image_generation"),
					status: event.item.status || "completed",
					result: event.item.result,
					revisedPrompt: event.item.revised_prompt,
				};
			}
			break;
		case "response.completed":
			if (event.response?.id) parsed.responseId = event.response.id;
			if (event.response?.usage) parsed.usage = event.response.usage;
			break;
	}
}

function eventBoundary(
	buffer: string,
): { index: number; length: number } | undefined {
	const lf = buffer.indexOf("\n\n");
	const crlf = buffer.indexOf("\r\n\r\n");
	if (lf === -1 && crlf === -1) return undefined;
	if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
	return { index: lf, length: 2 };
}

function parseSseBlock(block: string): CodexSseEvent | undefined {
	const data = block
		.replace(/\r\n/g, "\n")
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trim())
		.join("\n")
		.trim();
	if (!data || data === "[DONE]") return undefined;
	return JSON.parse(data) as CodexSseEvent;
}

export async function parseCodexSse(
	response: Response,
	signal?: AbortSignal,
): Promise<ParsedCodexResponse> {
	if (!response.body)
		throw new Error("Codex response did not include a stream body.");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const parsed: ParsedCodexResponse = { text: [] };
	let buffer = "";
	try {
		while (true) {
			if (signal?.aborted) {
				throw signal.reason instanceof Error
					? signal.reason
					: new Error("Image request was aborted.");
			}
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let boundary = eventBoundary(buffer);
			while (boundary) {
				const block = buffer.slice(0, boundary.index);
				buffer = buffer.slice(boundary.index + boundary.length);
				const event = parseSseBlock(block);
				if (event) handleCodexEvent(event, parsed);
				boundary = eventBoundary(buffer);
			}
		}
		buffer += decoder.decode();
		const remaining = parseSseBlock(buffer);
		if (remaining) handleCodexEvent(remaining, parsed);
	} finally {
		try {
			await reader.cancel();
		} catch {
			// The stream may already be closed.
		}
		reader.releaseLock();
	}
	return parsed;
}

function isRetryableStatus(status: number, errorText: string): boolean {
	if ([429, 500, 502, 503, 504].includes(status)) return true;
	return isRetryableErrorText(errorText);
}

function mimeForFormat(format: OutputFormat): string {
	return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

export async function generateCodexImage(options: {
	token: string;
	accountId: string;
	prompt: string;
	model: string;
	outputFormat: OutputFormat;
	sessionId: string;
	inputImages?: InputImage[];
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
}): Promise<CodexGenerationResult> {
	const body = JSON.stringify(buildCodexRequestBody(options));
	const fetchImpl = options.fetchImpl ?? fetch;
	for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
		if (options.signal?.aborted)
			throw new Error("Image generation was cancelled.");
		const request = createRequestSignal(options.signal, REQUEST_TIMEOUT_MS);
		let retryAfter: string | null = null;
		try {
			const response = await fetchImpl(CODEX_RESPONSES_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${options.token}`,
					"chatgpt-account-id": options.accountId,
					originator: "pi",
					"OpenAI-Beta": "responses=experimental",
					accept: "text/event-stream",
					"content-type": "application/json",
					"user-agent": "pi-subscription-image/0.1",
				},
				body,
				signal: request.signal,
			});
			if (!response.ok) {
				const errorText = await response.text();
				if (
					attempt <= MAX_RETRIES &&
					isRetryableStatus(response.status, errorText)
				) {
					retryAfter = response.headers.get("retry-after");
				} else {
					throw new CodexResponseError(
						`image request failed (${response.status}): ${errorText.slice(0, 1000)}`,
						false,
					);
				}
			} else {
				const parsed = await parseCodexSse(response, request.signal);
				if (!parsed.image) {
					const text = parsed.text.join("").trim();
					throw new CodexResponseError(
						text
							? `did not return an image. Response text: ${text}`
							: "stream ended before an image was returned.",
						!text,
					);
				}
				return {
					b64: parsed.image.result,
					mimeType: mimeForFormat(options.outputFormat),
					imageId: parsed.image.id,
					status: parsed.image.status,
					revisedPrompt: parsed.image.revisedPrompt,
					responseId: parsed.responseId,
					usage: parsed.usage,
				};
			}
		} catch (error) {
			if (options.signal?.aborted)
				throw new Error("Image generation was cancelled.");
			if (error instanceof CodexResponseError) {
				if (!error.retryable || attempt > MAX_RETRIES) throw error;
			} else if (request.signal.aborted) {
				if (attempt > MAX_RETRIES) {
					const detail =
						request.signal.reason instanceof Error
							? request.signal.reason.message
							: "Image request timed out.";
					throw new Error(`Codex image request timed out: ${detail}`);
				}
			} else if (attempt > MAX_RETRIES) {
				throw new Error(
					`Codex image network request failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		} finally {
			request.cleanup();
		}
		await abortableDelay(retryDelayMs(attempt, retryAfter), options.signal);
	}
	throw new Error("Codex image request failed after all retries.");
}
