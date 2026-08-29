import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { extensionForMimeType } from "./core.ts";

function slugify(value: string): string {
	return (
		value
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "image"
	);
}

export async function saveGeneratedImage(options: {
	bytes: Buffer;
	mimeType: string;
	outputDir: string;
	prompt: string;
}): Promise<string> {
	const extension = extensionForMimeType(options.mimeType);
	const filename = `${slugify(options.prompt)}-${randomUUID().slice(0, 8)}.${extension}`;
	const path = join(options.outputDir, filename);
	await withFileMutationQueue(path, async () => {
		await mkdir(options.outputDir, { recursive: true });
		await writeFile(path, options.bytes, { flag: "wx" });
	});
	return path;
}
