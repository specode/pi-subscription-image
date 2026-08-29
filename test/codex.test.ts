import assert from "node:assert/strict";
import test from "node:test";
import {
	buildCodexRequestBody,
	extractChatGptAccountId,
	generateCodexImage,
} from "../src/codex.ts";

const PNG_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlmxvQAAAAASUVORK5CYII=";

function jwt(accountId = "account-1") {
	const payload = Buffer.from(
		JSON.stringify({
			"https://api.openai.com/auth": { chatgpt_account_id: accountId },
		}),
	).toString("base64url");
	return `header.${payload}.signature`;
}

function successfulEvents() {
	return [
		{ type: "response.created", response: { id: "response-1" } },
		{
			type: "response.output_item.done",
			item: {
				type: "image_generation_call",
				id: "image-1",
				status: "completed",
				result: PNG_B64,
				revised_prompt: "revised",
			},
		},
		{
			type: "response.completed",
			response: { id: "response-1", usage: { total_tokens: 1 } },
		},
	];
}

function sseResponse(events: Array<Record<string, unknown>> = successfulEvents()) {
	return new Response(
		events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""),
		{ status: 200, headers: { "content-type": "text/event-stream" } },
	);
}

function splitSseResponse() {
	const encoded = new TextEncoder().encode(
		successfulEvents()
			.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`)
			.join(""),
	);
	const splits = [5, 37, 89, encoded.length - 3, encoded.length];
	let start = 0;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const end of splits) {
				controller.enqueue(encoded.slice(start, end));
				start = end;
			}
			controller.close();
		},
	});
	return new Response(stream, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

test("extracts the ChatGPT account id from Codex OAuth JWT", () => {
	assert.equal(extractChatGptAccountId(jwt()), "account-1");
	assert.throws(() => extractChatGptAccountId("not-a-jwt"), /valid JWT/);
});

test("builds a single image_generation request with reference images", () => {
	const body = buildCodexRequestBody({
		prompt: "edit this",
		model: "gpt-5.5",
		outputFormat: "webp",
		sessionId: "session-1",
		inputImages: [{ data: "abc", mimeType: "image/png" }],
	});
	assert.deepEqual(body.tools, [{ type: "image_generation", output_format: "webp" }]);
	assert.equal(body.parallel_tool_calls, false);
	const reference = body.input[0].content[1] as { image_url: string };
	assert.match(reference.image_url, /^data:image\/png;base64,/);
});

test("generates through Codex and sends subscription headers", async () => {
	let request: RequestInit | undefined;
	const result = await generateCodexImage({
		token: jwt(),
		accountId: "account-1",
		prompt: "cat",
		model: "gpt-5.5",
		outputFormat: "png",
		sessionId: "session-1",
		fetchImpl: async (_url, init) => {
			request = init;
			return sseResponse();
		},
	});
	assert.equal(result.b64, PNG_B64);
	assert.equal(result.mimeType, "image/png");
	assert.equal(result.responseId, "response-1");
	assert.equal(result.revisedPrompt, "revised");
	assert.equal((request?.headers as Record<string, string>)["chatgpt-account-id"], "account-1");
	assert.match(String(request?.body), /image_generation/);
});

test("parses Codex SSE boundaries split across stream chunks", async () => {
	const result = await generateCodexImage({
		token: jwt(),
		accountId: "account-1",
		prompt: "cat",
		model: "gpt-5.5",
		outputFormat: "png",
		sessionId: "session-1",
		fetchImpl: async () => splitSseResponse(),
	});
	assert.equal(result.imageId, "image-1");
});

test("retries Codex 429 responses", async () => {
	let calls = 0;
	const result = await generateCodexImage({
		token: jwt(),
		accountId: "account-1",
		prompt: "cat",
		model: "gpt-5.5",
		outputFormat: "png",
		sessionId: "session-1",
		fetchImpl: async () => {
			calls += 1;
			if (calls === 1) {
				return new Response("rate limited", {
					status: 429,
					headers: { "retry-after": "0" },
				});
			}
			return sseResponse();
		},
	});
	assert.equal(calls, 2);
	assert.equal(result.imageId, "image-1");
});

test("does not retry non-transient Codex response.failed errors", async () => {
	let calls = 0;
	await assert.rejects(
		generateCodexImage({
			token: jwt(),
			accountId: "account-1",
			prompt: "cat",
			model: "gpt-5.5",
			outputFormat: "png",
			sessionId: "session-1",
			fetchImpl: async () => {
				calls += 1;
				return sseResponse([
					{
						type: "response.failed",
						response: { error: { message: "content policy refusal" } },
					},
				]);
			},
		}),
		/Codex response failed: content policy refusal/,
	);
	assert.equal(calls, 1);
});

test("honors parent cancellation before a Codex request", async () => {
	const controller = new AbortController();
	controller.abort();
	let calls = 0;
	await assert.rejects(
		generateCodexImage({
			token: jwt(),
			accountId: "account-1",
			prompt: "cat",
			model: "gpt-5.5",
			outputFormat: "png",
			sessionId: "session-1",
			signal: controller.signal,
			fetchImpl: async () => {
				calls += 1;
				return sseResponse();
			},
		}),
		/cancelled/,
	);
	assert.equal(calls, 0);
});
