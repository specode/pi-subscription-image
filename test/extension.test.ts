import assert from "node:assert/strict";
import test from "node:test";
import { registerSubscriptionImage } from "../src/index.ts";

const PNG_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlmxvQAAAAASUVORK5CYII=";
const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

function jwt() {
	const payload = Buffer.from(
		JSON.stringify({
			"https://api.openai.com/auth": { chatgpt_account_id: "account" },
		}),
	).toString("base64url");
	return `header.${payload}.signature`;
}

function setup(
	provider: "openai-codex" | "xai",
	options: { save?: "none" | "project"; saveFailure?: string } = {},
) {
	let tool: any;
	const calls: string[] = [];
	const pi = {
		registerTool(value: unknown) {
			tool = value;
		},
		registerCommand() {},
		sendUserMessage() {},
	};
	registerSubscriptionImage(pi as any, {
		loadConfig: () => ({ save: options.save ?? "none" }),
		saveGeneratedImage: async () => {
			if (options.saveFailure) throw new Error(options.saveFailure);
			return "/unused";
		},
		generateCodexImage: async () => {
			calls.push("codex");
			return {
				b64: PNG_B64,
				mimeType: "image/png",
				imageId: "image-1",
				status: "completed",
			};
		},
		generateGrokImage: async () => {
			calls.push("grok");
			return { b64: JPEG_B64, mimeType: "image/jpeg" };
		},
	});
	const ctx = {
		cwd: "/workspace",
		model: { provider, id: provider === "xai" ? "grok-4.6" : "gpt-5.6-sol" },
		modelRegistry: {
			getApiKeyForProvider: async (id: string) =>
				id === "openai-codex" ? jwt() : "grok-token",
		},
		sessionManager: {
			getSessionId: () => "session-1",
			getBranch: () => [],
		},
		isProjectTrusted: () => false,
		hasUI: false,
		ui: { notify() {} },
	};
	return { tool, calls, ctx };
}

test("registers the replacement generate_image tool", () => {
	const { tool } = setup("openai-codex");
	assert.equal(tool.name, "generate_image");
	assert.equal(tool.label, "订阅生图");
	assert.equal(tool.executionMode, "parallel");
});

test("routes an openai-codex session to Codex", async () => {
	const { tool, calls, ctx } = setup("openai-codex");
	const result = await tool.execute("call-1", { prompt: "cat", save: "none" }, undefined, undefined, ctx);
	assert.deepEqual(calls, ["codex"]);
	assert.equal(result.details.provider, "codex");
	assert.equal(result.content[1].type, "image");
	assert.equal(result.content[1].mimeType, "image/png");
});

test("routes an xai session to Grok", async () => {
	const { tool, calls, ctx } = setup("xai");
	const result = await tool.execute("call-1", { prompt: "cat", save: "none" }, undefined, undefined, ctx);
	assert.deepEqual(calls, ["grok"]);
	assert.equal(result.details.provider, "grok");
	assert.equal(result.content[1].mimeType, "image/jpeg");
});

test("keeps legacy provider aliases compatible before validation", () => {
	const { tool } = setup("xai");
	assert.deepEqual(tool.prepareArguments({ provider: "openai", prompt: "cat" }), {
		provider: "codex",
		prompt: "cat",
	});
});

test("returns inline images when optional disk persistence fails", async () => {
	const { tool, ctx } = setup("openai-codex", {
		save: "project",
		saveFailure: "disk full",
	});
	const result = await tool.execute(
		"call-1",
		{ prompt: "cat" },
		undefined,
		undefined,
		ctx,
	);
	assert.equal(result.content[1].type, "image");
	assert.deepEqual(result.details.savedPaths, []);
	assert.deepEqual(result.details.saveWarnings, ["disk full"]);
	assert.match(result.content[0].text, /Save warnings: disk full/);
});

test("rejects Grok reference-image editing before provider execution", async () => {
	const { tool, calls, ctx } = setup("xai");
	await assert.rejects(
		tool.execute(
			"call-1",
			{
				prompt: "edit",
				provider: "grok",
				numLastImagesToInclude: 1,
			},
			undefined,
			undefined,
			ctx,
		),
		/supported only by provider=codex/,
	);
	assert.deepEqual(calls, []);
});
