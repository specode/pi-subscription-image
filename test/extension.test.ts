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
	options: {
		save?: "none" | "project";
		saveFailure?: string;
		config?: Record<string, unknown>;
	} = {},
) {
	let tool: any;
	const calls: string[] = [];
	const requests: { codex?: any; grok?: any } = {};
	const pi = {
		registerTool(value: unknown) {
			tool = value;
		},
		registerCommand() {},
		sendUserMessage() {},
	};
	registerSubscriptionImage(pi as any, {
		loadConfig: () => ({ save: options.save ?? "none", ...options.config }),
		saveGeneratedImage: async () => {
			if (options.saveFailure) throw new Error(options.saveFailure);
			return "/unused";
		},
		generateCodexImage: async (request) => {
			calls.push("codex");
			requests.codex = request;
			return {
				b64: PNG_B64,
				mimeType: "image/png",
				imageId: "image-1",
				status: "completed",
			};
		},
		generateGrokImage: async (request) => {
			calls.push("grok");
			requests.grok = request;
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
	return { tool, calls, requests, ctx };
}

test("registers the generate_image_with_subscription tool", () => {
	const { tool } = setup("openai-codex");
	assert.equal(tool.name, "generate_image_with_subscription");
	assert.equal(tool.label, "Image Generation");
	assert.match(tool.description, /quota from existing .* subscription accounts/);
	assert.equal(tool.executionMode, "parallel");
});

test("routes an openai-codex session to the latest Codex routing model", async () => {
	const { tool, calls, requests, ctx } = setup("openai-codex");
	const result = await tool.execute(
		"call-1",
		{ prompt: "cat", save: "none" },
		undefined,
		undefined,
		ctx,
	);
	assert.deepEqual(calls, ["codex"]);
	assert.equal(requests.codex.model, "gpt-5.6-sol");
	assert.equal(requests.codex.outputFormat, "png");
	assert.equal(result.details.provider, "codex");
	assert.equal(result.details.routingModel, "gpt-5.6-sol");
	assert.equal(result.details.backendImageModel, "gpt-image-2");
	assert.equal(result.content[1].type, "image");
	assert.equal(result.content[1].mimeType, "image/png");
});

test("routes an xai session to Grok Imagine 2.0 with explicit native options", async () => {
	const { tool, calls, requests, ctx } = setup("xai");
	const result = await tool.execute(
		"call-1",
		{
			prompt: "cat",
			resolution: "2k",
			quality: "medium",
			save: "none",
		},
		undefined,
		undefined,
		ctx,
	);
	assert.deepEqual(calls, ["grok"]);
	assert.equal(requests.grok.model, "grok-imagine-image-2.0");
	assert.equal(requests.grok.resolution, "2k");
	assert.equal(requests.grok.quality, "medium");
	assert.equal(result.details.provider, "grok");
	assert.equal(result.details.imageModel, "grok-imagine-image-2.0");
	assert.equal(result.details.resolution, "2k");
	assert.equal(result.details.quality, "medium");
	assert.equal(result.details.outputFormat, "jpeg");
	assert.equal(result.details.items[0].byteSize, 4);
	assert.match(result.content[0].text, /Output format: jpeg/);
	assert.equal(result.content[1].mimeType, "image/jpeg");
});

test("maps provider aliases before validation", () => {
	const { tool } = setup("xai");
	assert.deepEqual(
		tool.prepareArguments({ provider: "openai", prompt: "cat" }),
		{
			provider: "codex",
			prompt: "cat",
		},
	);
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

test("rejects provider-specific parameters before execution", async () => {
	const codex = setup("openai-codex");
	await assert.rejects(
		codex.tool.execute(
			"call-1",
			{ prompt: "cat", provider: "codex", quality: "medium" },
			undefined,
			undefined,
			codex.ctx,
		),
		/quality is currently supported only by provider=grok/,
	);
	assert.deepEqual(codex.calls, []);

	const grok = setup("xai");
	await assert.rejects(
		grok.tool.execute(
			"call-1",
			{ prompt: "cat", provider: "grok", outputFormat: "jpeg" },
			undefined,
			undefined,
			grok.ctx,
		),
		/outputFormat is supported only by provider=codex/,
	);
	assert.deepEqual(grok.calls, []);
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
