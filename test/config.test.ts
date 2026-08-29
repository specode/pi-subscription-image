import assert from "node:assert/strict";
import test from "node:test";
import {
	resolveCodexModel,
	resolveGrokModel,
	resolvePathUnderCwd,
	resolveSaveConfig,
} from "../src/config.ts";

test("resolves provider-specific model defaults and overrides", () => {
	assert.equal(resolveCodexModel(undefined, {}), "gpt-5.5");
	assert.equal(
		resolveCodexModel(undefined, { codexRoutingModel: "gpt-custom" }),
		"gpt-custom",
	);
	assert.equal(resolveGrokModel(undefined, {}), "grok-imagine-image-quality");
	assert.equal(resolveGrokModel("grok-fast", {}), "grok-fast");
});

test("preserves legacy save locations", () => {
	assert.deepEqual(resolveSaveConfig({ save: "none" }, "/work", {}, "/agent"), {
		mode: "none",
	});
	assert.deepEqual(resolveSaveConfig({ save: "project" }, "/work", {}, "/agent"), {
		mode: "project",
		outputDir: "/work/.pi/generated-images",
	});
	assert.deepEqual(resolveSaveConfig({ save: "global" }, "/work", {}, "/agent"), {
		mode: "global",
		outputDir: "/agent/generated-images",
	});
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
