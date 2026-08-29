import assert from "node:assert/strict";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { saveGeneratedImage } from "../src/save.ts";

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlmxvQAAAAASUVORK5CYII=",
	"base64",
);

test("saves unique images inside an isolated Mozi test directory", async () => {
	const root = join(
		homedir(),
		".cache",
		"mozi",
		"tmp",
		`pi-subscription-image-test-${process.pid}-${Date.now()}`,
	);
	await mkdir(root, { recursive: true });
	try {
		const first = await saveGeneratedImage({
			bytes: PNG,
			mimeType: "image/png",
			outputDir: root,
			prompt: "Golden Retriever",
		});
		const second = await saveGeneratedImage({
			bytes: PNG,
			mimeType: "image/png",
			outputDir: root,
			prompt: "Golden Retriever",
		});
		assert.notEqual(first, second);
		assert.match(first, /golden-retriever-[a-f0-9]{8}\.png$/);
		await access(first);
		assert.deepEqual(await readFile(first), PNG);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
