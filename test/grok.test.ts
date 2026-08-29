import assert from "node:assert/strict";
import test from "node:test";
import { generateGrokImage } from "../src/grok.ts";

const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

test("generates a Grok Imagine JPEG with subscription credentials", async () => {
	let url = "";
	let request: RequestInit | undefined;
	const result = await generateGrokImage({
		token: "grok-token",
		prompt: "cat",
		model: "grok-imagine-image-quality",
		aspectRatio: "16:9",
		baseUrl: "https://example.test/v1/",
		fetchImpl: async (input, init) => {
			url = String(input);
			request = init;
			return Response.json({ data: [{ b64_json: JPEG_B64 }] });
		},
	});
	assert.equal(url, "https://example.test/v1/images/generations");
	assert.equal(result.b64, JPEG_B64);
	assert.equal(result.mimeType, "image/jpeg");
	assert.equal(
		(request?.headers as Record<string, string>).Authorization,
		"Bearer grok-token",
	);
	assert.match(String(request?.body), /"aspect_ratio":"16:9"/);
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
				return Response.json(
					{ error: { message: "expired" } },
					{ status: 401 },
				);
			},
		}),
		/Run \/login xai again/,
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
