import assert from "node:assert/strict";
import test from "node:test";
import { resolveInputImages, selectRecentImages } from "../src/input-images.ts";

const first = { type: "image", data: "first", mimeType: "image/png" };
const second = { type: "image", data: "second", mimeType: "image/jpeg" };

test("selects recent conversation images in chronological order", () => {
	const messages = [
		{ content: [{ type: "text", text: "before" }, first] },
		{ content: [{ type: "text", text: "middle" }] },
		{ content: [second] },
	];
	assert.deepEqual(selectRecentImages(messages, 2), [
		{ data: "first", mimeType: "image/png" },
		{ data: "second", mimeType: "image/jpeg" },
	]);
});

test("resolves recent conversation images", async () => {
	const images = await resolveInputImages({
		numLastImagesToInclude: 1,
		cwd: "/workspace",
		messages: [{ content: [first] }, { content: [second] }],
	});
	assert.deepEqual(images, [{ data: "second", mimeType: "image/jpeg" }]);
});

test("rejects ambiguous and unavailable recent-image inputs", async () => {
	await assert.rejects(
		resolveInputImages({
			referencedImagePaths: ["a.png"],
			numLastImagesToInclude: 1,
			cwd: "/workspace",
			messages: [],
		}),
		/Provide only one/,
	);
	await assert.rejects(
		resolveInputImages({
			numLastImagesToInclude: 1,
			cwd: "/workspace",
			messages: [],
		}),
		/only 0 were available/,
	);
});
