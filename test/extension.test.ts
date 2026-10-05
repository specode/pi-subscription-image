import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
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
		generationFailure?: { call: number; message: string; before?: () => void };
		onSave?: () => void;
	} = {},
) {
	let tool: any;
	const calls: string[] = [];
	const saves: unknown[] = [];
	const requests: { codex?: any; grok?: any } = {};
	const maybeFailGeneration = () => {
		const failure = options.generationFailure;
		if (failure?.call !== calls.length) return;
		failure.before?.();
		throw new Error(failure.message);
	};
	const pi = {
		registerTool(value: unknown) {
			tool = value;
		},
		registerCommand() {},
		sendUserMessage() {},
	};
	registerSubscriptionImage(pi as any, {
		loadConfig: () => ({ save: options.save ?? "none", ...options.config }),
		saveGeneratedImage: async (request) => {
			saves.push(request);
			options.onSave?.();
			if (options.saveFailure) throw new Error(options.saveFailure);
			return "/unused";
		},
		generateCodexImage: async (request) => {
			calls.push("codex");
			requests.codex = request;
			maybeFailGeneration();
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
			maybeFailGeneration();
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
	return { tool, calls, requests, saves, ctx };
}

test("registers the generate_image_with_subscription tool", () => {
	const { tool } = setup("openai-codex");
	assert.equal(tool.name, "generate_image_with_subscription");
	assert.equal(tool.label, "Image Generation");
	assert.match(tool.description, /quota from existing .* subscription accounts/);
	assert.equal(tool.executionMode, "parallel");
	assert.ok(tool.outputSchema);
	assert.match(tool.description, /image\(block\)/);
});

for (const provider of ["openai-codex", "xai"] as const) {
	test(`${provider} returns schema-valid image blocks for codemode without saving`, async () => {
		const { tool, calls, ctx } = setup(provider);
		const result = await tool.execute(
			"call-codemode", { prompt: "cat", n: 2, save: "none" },
			undefined, undefined, ctx,
		);
		// Codemode receives structuredContent through a JSON boundary, not content/details.
		const structured = JSON.parse(JSON.stringify(result.structuredContent));
		assert.equal(Value.Check(tool.outputSchema, structured), true);
		assert.equal(structured.provider, provider === "xai" ? "grok" : "codex");
		assert.equal(structured.model, result.details.model);
		assert.deepEqual(structured.output, result.content);
		assert.deepEqual(structured.generationErrors, []);
		assert.deepEqual(structured.savedPaths, []);
		assert.deepEqual(structured.saveWarnings, []);
		assert.equal(calls.length, 2);
		assert.equal(structured.output[0].type, "text");
		assert.equal(structured.output.length, 3);
		for (const block of structured.output.slice(1)) {
			assert.deepEqual(block, {
				type: "image",
				data: provider === "xai" ? JPEG_B64 : PNG_B64,
				mimeType: provider === "xai" ? "image/jpeg" : "image/png",
			});
		}
	});
}

test("includes saved paths in structured results without copying image data into details", async () => {
	const { tool, ctx } = setup("openai-codex", { save: "project" });
	const result = await tool.execute(
		"call-saved", { prompt: "cat" }, undefined, undefined, ctx,
	);
	assert.ok(Value.Check(tool.outputSchema, result.structuredContent));
	assert.deepEqual(result.structuredContent.savedPaths, ["/unused"]);
	assert.deepEqual(result.structuredContent.saveWarnings, []);
	assert.ok(!JSON.stringify(result.details).includes(PNG_B64));
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
	assert.ok(Value.Check(tool.outputSchema, result.structuredContent));
	assert.deepEqual(result.structuredContent.output, result.content);
	assert.deepEqual(result.structuredContent.savedPaths, []);
	assert.deepEqual(result.structuredContent.saveWarnings, ["disk full"]);
});

for (const provider of ["openai-codex", "xai"] as const) {
	test(`${provider} returns already generated images when a later image fails`, async () => {
		const { tool, calls, ctx } = setup(provider, {
			generationFailure: { call: 3, message: "quota exhausted" },
		});
		const result = await tool.execute(
			"call-partial", { prompt: "cat", n: 4, save: "project" },
			undefined, undefined, ctx,
		);
		assert.equal(calls.length, 3);
		assert.equal(result.content.length, 3);
		assert.match(result.content[0].text, /Generated 2 of 4 requested image\(s\)/);
		assert.match(result.content[0].text, /Generation errors: Image 3\/4 failed/);
		assert.ok(Value.Check(tool.outputSchema, result.structuredContent));
		assert.deepEqual(result.structuredContent.generationErrors, [
			"Image 3/4 failed; returning 2 generated image(s): quota exhausted",
		]);
		assert.deepEqual(result.structuredContent.savedPaths, ["/unused", "/unused"]);
		assert.equal(result.details.requestedCount, 4);
		assert.equal(result.details.generatedCount, 2);
		assert.deepEqual(
			result.details.generationErrors,
			result.structuredContent.generationErrors,
		);
	});
}

test("rejects when the first image fails", async () => {
	const { tool, calls, ctx } = setup("openai-codex", {
		generationFailure: { call: 1, message: "quota exhausted" },
	});
	await assert.rejects(
		tool.execute("call-1", { prompt: "cat", n: 2, save: "none" }, undefined, undefined, ctx),
		/quota exhausted/,
	);
	assert.deepEqual(calls, ["codex"]);
});

test("rejects cancellation after saving images already generated", async () => {
	const controller = new AbortController();
	const { tool, calls, saves, ctx } = setup("openai-codex", {
		generationFailure: {
			call: 2,
			message: "Image generation was cancelled.",
			before: () => controller.abort(),
		},
	});
	await assert.rejects(
		tool.execute(
			"call-1", { prompt: "cat", n: 3, save: "project" },
			controller.signal, undefined, ctx,
		),
		/cancelled/,
	);
	assert.equal(calls.length, 2);
	assert.equal(saves.length, 1);
});

test("rejects cancellation that arrives while the last image is saved", async () => {
	const controller = new AbortController();
	const { tool, calls, saves, ctx } = setup("openai-codex", {
		onSave: () => controller.abort(),
	});
	await assert.rejects(
		tool.execute(
			"call-1", { prompt: "cat", save: "project" },
			controller.signal, undefined, ctx,
		),
		/cancelled/,
	);
	assert.equal(calls.length, 1);
	assert.equal(saves.length, 1);
});

test("rejects an incomplete custom save configuration before spending quota", async () => {
	const keys = ["PI_SUBSCRIPTION_IMAGE_SAVE_DIR", "PI_IMAGE_SAVE_DIR"];
	const saved = keys.map((key) => process.env[key]);
	for (const key of keys) delete process.env[key];
	try {
		const { tool, calls, ctx } = setup("openai-codex");
		await assert.rejects(
			tool.execute("call-1", { prompt: "cat", save: "custom" }, undefined, undefined, ctx),
			/save=custom requires saveDir/,
		);
		assert.deepEqual(calls, []);
	} finally {
		keys.forEach((key, index) => {
			if (saved[index] === undefined) delete process.env[key];
			else process.env[key] = saved[index];
		});
	}
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
