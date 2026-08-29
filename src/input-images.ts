import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mimeFromBytes } from "./core.ts";

export const MAX_EDIT_IMAGES = 5;
const MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024;

export interface InputImage {
	data: string;
	mimeType: string;
}

export function selectRecentImages(messages: unknown[], count: number): InputImage[] {
	const images: InputImage[] = [];
	for (let index = messages.length - 1; index >= 0 && images.length < count; index--) {
		const message = messages[index] as { content?: unknown };
		if (!Array.isArray(message?.content)) continue;
		for (
			let contentIndex = message.content.length - 1;
			contentIndex >= 0 && images.length < count;
			contentIndex--
		) {
			const block = message.content[contentIndex] as {
				type?: unknown;
				data?: unknown;
				mimeType?: unknown;
			};
			if (
				block?.type === "image" &&
				typeof block.data === "string" &&
				typeof block.mimeType === "string"
			) {
				images.push({ data: block.data, mimeType: block.mimeType });
			}
		}
	}
	return images.reverse();
}

export async function resolveInputImages(options: {
	referencedImagePaths?: string[];
	numLastImagesToInclude?: number;
	cwd: string;
	messages: unknown[];
}): Promise<InputImage[]> {
	const paths = options.referencedImagePaths ?? [];
	if (paths.length && options.numLastImagesToInclude !== undefined) {
		throw new Error(
			"Provide only one of referencedImagePaths or numLastImagesToInclude.",
		);
	}
	if (paths.length > MAX_EDIT_IMAGES) {
		throw new Error(`referencedImagePaths accepts at most ${MAX_EDIT_IMAGES} paths.`);
	}
	if (paths.length) {
		return Promise.all(
			paths.map(async (path) => {
				const normalized = path.startsWith("@") ? path.slice(1) : path;
				const absolutePath = resolve(options.cwd, normalized);
				let bytes: Buffer;
				try {
					bytes = await readFile(absolutePath);
				} catch (error) {
					throw new Error(
						`Unable to read referenced image at ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				if (bytes.length > MAX_INPUT_IMAGE_BYTES) {
					throw new Error(`Referenced image exceeds 20 MB: ${absolutePath}`);
				}
				const mimeType = mimeFromBytes(bytes);
				if (!mimeType) {
					throw new Error(`Referenced image is unsupported: ${absolutePath}`);
				}
				return { data: bytes.toString("base64"), mimeType };
			}),
		);
	}
	if (options.numLastImagesToInclude !== undefined) {
		const count = options.numLastImagesToInclude;
		if (!Number.isInteger(count) || count < 1 || count > MAX_EDIT_IMAGES) {
			throw new Error(
				`numLastImagesToInclude must be between 1 and ${MAX_EDIT_IMAGES}.`,
			);
		}
		const images = selectRecentImages(options.messages, count);
		if (images.length !== count) {
			throw new Error(
				`Requested the last ${count} conversation images, but only ${images.length} were available.`,
			);
		}
		return images;
	}
	return [];
}
