import assert from "node:assert/strict";
import test from "node:test";
import {
	decodeBase64Image,
	normalizeCount,
	parseRetryAfterMs,
	prepareToolArguments,
	resolveProvider,
	withAspectRatioConstraint,
} from "../src/core.ts";

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlmxvQAAAAASUVORK5CYII=",
	"base64",
);

test("maps provider aliases and aspect-ratio arguments", () => {
	assert.deepEqual(
		prepareToolArguments({ provider: "xai", aspect_ratio: "16:9", prompt: "x" }),
		{ provider: "grok", aspectRatio: "16:9", prompt: "x" },
	);
	assert.deepEqual(prepareToolArguments({ provider: "openai" }), {
		provider: "codex",
	});
});

test("routes by explicit provider, reference capability, session, then default", () => {
	assert.equal(resolveProvider({ requested: "grok" }), "grok");
	assert.equal(
		resolveProvider({ requested: "auto", sessionProvider: "xai" }),
		"grok",
	);
	assert.equal(
		resolveProvider({ requested: "auto", sessionProvider: "openai-codex" }),
		"codex",
	);
	assert.equal(
		resolveProvider({
			requested: "auto",
			sessionProvider: "xai",
			requiresCodex: true,
		}),
		"codex",
	);
	assert.equal(
		resolveProvider({
			requested: "auto",
			sessionProvider: "kimi-coding",
			defaultProvider: "grok",
		}),
		"grok",
	);
	assert.throws(
		() => resolveProvider({ requested: "auto", sessionProvider: "kimi-coding" }),
		/defaultProvider/,
	);
});

test("validates image count", () => {
	assert.equal(normalizeCount(undefined), 1);
	assert.equal(normalizeCount(4), 4);
	assert.throws(() => normalizeCount(1.5), /integer/);
	assert.throws(() => normalizeCount(5), /between 1 and 4/);
});

test("adds a Codex aspect-ratio prompt constraint", () => {
	assert.equal(withAspectRatioConstraint("  cat  ", undefined), "cat");
	assert.match(withAspectRatioConstraint("cat", "16:9"), /16:9 aspect ratio/);
});

test("parses retry-after seconds and HTTP dates", () => {
	assert.equal(parseRetryAfterMs("1.5", 0), 1500);
	assert.equal(parseRetryAfterMs("Thu, 01 Jan 1970 00:00:05 GMT", 1000), 4000);
	assert.equal(parseRetryAfterMs("bad", 0), undefined);
});

test("strictly validates returned image base64 and MIME", () => {
	assert.deepEqual(decodeBase64Image(PNG.toString("base64"), "image/png"), PNG);
	assert.throws(
		() => decodeBase64Image(PNG.toString("base64"), "image/jpeg"),
		/expected image\/jpeg/,
	);
	assert.throws(() => decodeBase64Image("not-base64"), /invalid base64/);
});

test("validates multi-megabyte base64 images without recursive regex overflow", () => {
	const largePng = Buffer.alloc(6 * 1024 * 1024);
	PNG.subarray(0, 8).copy(largePng);
	const decoded = decodeBase64Image(largePng.toString("base64"), "image/png");
	assert.equal(decoded.byteLength, largePng.byteLength);
});
