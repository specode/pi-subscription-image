import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	loadConfig,
	resolveCodexModel,
	resolveCodexOutputFormat,
	resolveGrokModel,
	resolveGrokQuality,
	resolveGrokResolution,
	resolvePathUnderCwd,
	resolveSaveConfig,
} from "../src/config.ts";

test("resolves latest provider defaults and layered overrides", () => {
	assert.equal(resolveCodexModel(undefined, {}), "gpt-5.6-sol");
	assert.equal(
		resolveCodexModel(undefined, {
			codexRoutingModel: "gpt-legacy",
			providers: { codex: { routingModel: "gpt-configured" } },
		}),
		"gpt-configured",
	);
	assert.equal(resolveCodexOutputFormat(undefined, {}), "png");
	assert.equal(
		resolveCodexOutputFormat(undefined, {
			providers: { codex: { outputFormat: "webp" } },
		}),
		"webp",
	);
	assert.equal(resolveGrokModel(undefined, {}), "grok-imagine-image-2.0");
	assert.equal(
		resolveGrokModel(undefined, {
			grokImageModel: "grok-legacy",
			providers: { grok: { imageModel: "grok-configured" } },
		}),
		"grok-configured",
	);
	assert.equal(resolveGrokResolution(undefined, {}), "1k");
	assert.equal(
		resolveGrokResolution(undefined, {
			providers: { grok: { resolution: "2k" } },
		}),
		"2k",
	);
	assert.equal(resolveGrokQuality(undefined, {}), undefined);
	assert.equal(
		resolveGrokQuality(undefined, {
			providers: { grok: { quality: "medium" } },
		}),
		"medium",
	);
	assert.equal(resolveGrokModel("grok-once", {}), "grok-once");
});

test("deep-merges provider config and lets project legacy keys override global values", () => {
	const root = mkdtempSync(join(tmpdir(), "subscription-image-config-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(join(agentDir, "extensions"), { recursive: true });
	mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
	writeFileSync(
		join(agentDir, "extensions", "subscription-image.json"),
		JSON.stringify({
			providers: {
				codex: { routingModel: "global-codex", outputFormat: "webp" },
				grok: { imageModel: "global-grok", resolution: "2k" },
			},
		}),
	);
	writeFileSync(
		join(cwd, ".pi", "extensions", "subscription-image.json"),
		JSON.stringify({
			grokImageModel: "project-legacy-grok",
			providers: { grok: { quality: "low" } },
		}),
	);
	try {
		const config = loadConfig(cwd, true, agentDir);
		assert.equal(config.providers?.codex?.routingModel, "global-codex");
		assert.equal(config.providers?.codex?.outputFormat, "webp");
		assert.equal(config.providers?.grok?.imageModel, "project-legacy-grok");
		assert.equal(config.providers?.grok?.resolution, "2k");
		assert.equal(config.providers?.grok?.quality, "low");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("resolves configured save locations", () => {
	assert.deepEqual(resolveSaveConfig({ save: "none" }, "/work", {}, "/agent"), {
		mode: "none",
	});
	assert.deepEqual(
		resolveSaveConfig({ save: "project" }, "/work", {}, "/agent"),
		{
			mode: "project",
			outputDir: "/work/.pi/generated-images",
		},
	);
	assert.deepEqual(
		resolveSaveConfig({ save: "global" }, "/work", {}, "/agent"),
		{
			mode: "global",
			outputDir: "/agent/generated-images",
		},
	);
	assert.deepEqual(
		resolveSaveConfig(
			{ save: "custom", saveDir: "assets/generated" },
			"/work",
			{},
			"/agent",
		),
		{ mode: "custom", outputDir: "/work/assets/generated" },
	);
});

test("resolves absolute and workspace-relative paths", () => {
	assert.equal(resolvePathUnderCwd("/work", "images"), "/work/images");
	assert.equal(resolvePathUnderCwd("/work", "/images"), "/images");
});
