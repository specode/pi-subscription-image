import assert from "node:assert/strict";
import test from "node:test";
import { generateGrokImage } from "../src/grok.ts";

const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
const PNG_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlmxvQAAAAASUVORK5CYII=";

test("sends Grok Imagine 2.0 options and detects the returned image format", async () => {
	let url = "";
	let request: RequestInit | undefined;
	const result = await generateGrokImage({
		token: "grok-token",
		prompt: "cat",
		model: "grok-imagine-image-2.0",
		aspectRatio: "16:9",
		resolution: "2k",
		quality: "medium",
		baseUrl: "https://example.test/v1/",
		fetchImpl: async (input, init) => {
			url = String(input);
			request = init;
			return Response.json({ data: [{ b64_json: PNG_B64 }] });
		},
	});
	assert.equal(url, "https://example.test/v1/images/generations");
	assert.equal(result.b64, PNG_B64);
	assert.equal(result.mimeType, "image/png");
	assert.equal(
		(request?.headers as Record<string, string>).Authorization,
		"Bearer grok-token",
	);
	assert.deepEqual(JSON.parse(String(request?.body)), {
		model: "grok-imagine-image-2.0",
		prompt: "cat",
		n: 1,
		aspect_ratio: "16:9",
		resolution: "2k",
		quality: "medium",
		response_format: "b64_json",
	});
});

test("omits quality when it is not requested", async () => {
	let body = "";
	await generateGrokImage({
		token: "grok-token",
		prompt: "cat",
		model: "grok-imagine-image-2.0",
		fetchImpl: async (_input, init) => {
			body = String(init?.body);
			return Response.json({ data: [{ b64_json: JPEG_B64 }] });
		},
	});
	assert.equal(JSON.parse(body).quality, undefined);
	assert.equal(JSON.parse(body).resolution, "1k");
});

test("rejects quality for pre-2.0 Grok models", async () => {
	await assert.rejects(
		generateGrokImage({
			token: "grok-token",
			prompt: "cat",
			model: "grok-imagine-image-quality",
			quality: "medium",
			fetchImpl: async () => Response.json({ data: [{ b64_json: JPEG_B64 }] }),
		}),
		/supported only by grok-imagine-image-2\.0/,
	);
});

test("retries a Grok 429 response", async () => {
	let calls = 0;
	const result = await generateGrokImage({
		token: "grok-token",
		prompt: "cat",
		model: "grok-imagine-image-quality",
		fetchImpl: async () => {
			calls += 1;
			if (calls === 1) {
				return Response.json(
					{ error: { message: "slow down" } },
					{ status: 429, headers: { "retry-after": "0" } },
				);
			}
			return Response.json({ data: [{ b64_json: JPEG_B64 }] });
		},
	});
	assert.equal(calls, 2);
	assert.equal(result.b64, JPEG_B64);
});

test("maps Grok authentication failures without retrying", async () => {
	let calls = 0;
	await assert.rejects(
		generateGrokImage({
			token: "expired-token",
			prompt: "cat",
			model: "grok-imagine-image-quality",
			fetchImpl: async () => {
				calls += 1;
				return Response.json({ error: { message: "expired" } }, { status: 401 });
			},
		}),
		/Run \/login xai again/,
	);
	assert.equal(calls, 1);
});

test("rejects malformed Grok image data without retrying", async () => {
	let calls = 0;
	await assert.rejects(
		generateGrokImage({
			token: "grok-token",
			prompt: "cat",
			model: "grok-imagine-image-2.0",
			fetchImpl: async () => {
				calls += 1;
				return Response.json({ data: [{ b64_json: "not-base64" }] });
			},
		}),
		/malformed image/,
	);
	assert.equal(calls, 1);
});

test("rejects malformed Grok success responses", async () => {
	await assert.rejects(
		generateGrokImage({
			token: "grok-token",
			prompt: "cat",
			model: "grok-imagine-image-quality",
			fetchImpl: async () => Response.json({ data: [{}] }),
		}),
		/malformed response/,
	);
});
