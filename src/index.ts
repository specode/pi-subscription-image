import { StringEnum } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import {
	CODEX_IMAGE_BACKEND_MODEL,
	generateCodexImage,
	extractChatGptAccountId,
} from "./codex.ts";
import {
	loadConfig,
	resolveCodexModel,
	resolveCodexOutputFormat,
	resolveDefaultProvider,
	resolveGrokModel,
	resolveGrokQuality,
	resolveGrokResolution,
	resolveSaveConfig,
	validateConfig,
	type SubscriptionImageConfig,
} from "./config.ts";
import {
	ASPECT_RATIOS,
	decodeBase64Image,
	GROK_QUALITIES,
	GROK_RESOLUTIONS,
	normalizeCount,
	OUTPUT_FORMATS,
	outputFormatForMimeType,
	prepareToolArguments,
	PROVIDERS,
	resolveProvider,
	SAVE_MODES,
	withAspectRatioConstraint,
	type AspectRatio,
	type GrokQuality,
	type GrokResolution,
	type OutputFormat,
	type Provider,
} from "./core.ts";
import { generateGrokImage } from "./grok.ts";
import { MAX_EDIT_IMAGES, resolveInputImages } from "./input-images.ts";
import { saveGeneratedImage } from "./save.ts";

const TOOL_PARAMS = Type.Object({
	prompt: Type.String({
		description:
			"Image description or edit instruction. Be specific about subject, composition, style, text, and constraints.",
	}),
	provider: Type.Optional(
		StringEnum(PROVIDERS, {
			description:
				"Subscription backend. auto follows openai-codex/xai session providers; reference-image edits select codex.",
		}),
	),
	model: Type.Optional(
		Type.String({
			description:
				"Provider-specific override: Codex routing model or Grok Imagine image model.",
		}),
	),
	aspectRatio: Type.Optional(StringEnum(ASPECT_RATIOS)),
	n: Type.Optional(
		Type.Integer({
			description: "Number of images to generate sequentially (1-4). Default: 1.",
			minimum: 1,
			maximum: 4,
		}),
	),
	outputFormat: Type.Optional(
		StringEnum(OUTPUT_FORMATS, {
			description:
				"Codex-only output format. Grok Imagine selects the returned image format.",
		}),
	),
	resolution: Type.Optional(
		StringEnum(GROK_RESOLUTIONS, {
			description: "Grok-only image resolution. Default: 1k.",
		}),
	),
	quality: Type.Optional(
		StringEnum(GROK_QUALITIES, {
			description:
				"Grok Imagine 2.0-only quality level. Omitted by default so the provider decides.",
		}),
	),
	save: Type.Optional(StringEnum(SAVE_MODES)),
	saveDir: Type.Optional(
		Type.String({
			description:
				"Directory when save=custom. Relative paths resolve under the current workspace.",
		}),
	),
	referencedImagePaths: Type.Optional(
		Type.Array(Type.String(), {
			maxItems: MAX_EDIT_IMAGES,
			description:
				"Codex only: up to five local PNG, JPEG, or WebP images to edit.",
		}),
	),
	numLastImagesToInclude: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: MAX_EDIT_IMAGES,
			description:
				"Codex only: include the most recent one to five conversation images for editing.",
		}),
	),
});

type ToolParams = Static<typeof TOOL_PARAMS>;

interface GeneratedImage {
	b64: string;
	bytes: Buffer;
	mimeType: string;
	status?: string;
	responseId?: string;
	imageId?: string;
	revisedPrompt?: string;
	usage?: unknown;
}

interface GeneratedBatch {
	images: GeneratedImage[];
	model: string;
	inputImageCount: number;
	resolution?: GrokResolution;
	quality?: GrokQuality;
}

export interface SubscriptionImageDependencies {
	generateCodexImage: typeof generateCodexImage;
	generateGrokImage: typeof generateGrokImage;
	saveGeneratedImage: typeof saveGeneratedImage;
	loadConfig: typeof loadConfig;
}

const DEFAULT_DEPENDENCIES: SubscriptionImageDependencies = {
	generateCodexImage,
	generateGrokImage,
	saveGeneratedImage,
	loadConfig,
};

function branchMessages(ctx: ExtensionContext): unknown[] {
	const messages: unknown[] = [];
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "message") messages.push(entry.message);
		if (entry.type === "custom_message") messages.push(entry);
	}
	return messages;
}

async function credentialAvailable(
	ctx: ExtensionContext,
	provider: "openai-codex" | "xai",
): Promise<boolean> {
	try {
		return Boolean(await ctx.modelRegistry.getApiKeyForProvider(provider));
	} catch {
		return false;
	}
}

function hasReferenceInputs(params: ToolParams): boolean {
	return Boolean(
		params.referencedImagePaths?.length ||
			params.numLastImagesToInclude !== undefined,
	);
}

function validateProviderParameters(
	provider: Provider,
	params: ToolParams,
): void {
	if (provider === "grok") {
		if (hasReferenceInputs(params)) {
			throw new Error(
				"Reference-image editing is currently supported only by provider=codex.",
			);
		}
		if (params.outputFormat !== undefined) {
			throw new Error(
				"outputFormat is supported only by provider=codex; Grok Imagine selects the returned image format.",
			);
		}
		return;
	}
	if (params.resolution !== undefined) {
		throw new Error("resolution is currently supported only by provider=grok.");
	}
	if (params.quality !== undefined) {
		throw new Error("quality is currently supported only by provider=grok.");
	}
}

async function generateWithCodex(options: {
	params: ToolParams;
	config: SubscriptionImageConfig;
	ctx: ExtensionContext;
	signal?: AbortSignal;
	dependencies: SubscriptionImageDependencies;
}): Promise<GeneratedBatch> {
	const token =
		await options.ctx.modelRegistry.getApiKeyForProvider("openai-codex");
	if (!token) {
		throw new Error(
			"Missing openai-codex credentials. Run /login and select ChatGPT Plus/Pro (Codex).",
		);
	}
	const accountId = extractChatGptAccountId(token);
	const inputImages = await resolveInputImages({
		referencedImagePaths: options.params.referencedImagePaths,
		numLastImagesToInclude: options.params.numLastImagesToInclude,
		cwd: options.ctx.cwd,
		messages: branchMessages(options.ctx),
	});
	const model = resolveCodexModel(options.params.model, options.config);
	const outputFormat = resolveCodexOutputFormat(
		options.params.outputFormat as OutputFormat | undefined,
		options.config,
	);
	const count = normalizeCount(options.params.n);
	const prompt = withAspectRatioConstraint(
		options.params.prompt,
		options.params.aspectRatio as AspectRatio | undefined,
	);
	const images: GeneratedImage[] = [];
	for (let index = 0; index < count; index++) {
		const result = await options.dependencies.generateCodexImage({
			token,
			accountId,
			prompt,
			model,
			outputFormat,
			sessionId: options.ctx.sessionManager.getSessionId(),
			inputImages,
			signal: options.signal,
		});
		images.push({
			...result,
			bytes: decodeBase64Image(result.b64, result.mimeType),
		});
	}
	return { images, model, inputImageCount: inputImages.length };
}

async function generateWithGrok(options: {
	params: ToolParams;
	config: SubscriptionImageConfig;
	ctx: ExtensionContext;
	signal?: AbortSignal;
	dependencies: SubscriptionImageDependencies;
}): Promise<GeneratedBatch> {
	const token = await options.ctx.modelRegistry.getApiKeyForProvider("xai");
	if (!token) {
		throw new Error(
			"Missing xAI credentials. Run /login xai and choose your X Premium or SuperGrok subscription.",
		);
	}
	const model = resolveGrokModel(options.params.model, options.config);
	const resolution = resolveGrokResolution(
		options.params.resolution as GrokResolution | undefined,
		options.config,
	);
	const quality = resolveGrokQuality(
		options.params.quality as GrokQuality | undefined,
		options.config,
	);
	const count = normalizeCount(options.params.n);
	const images: GeneratedImage[] = [];
	for (let index = 0; index < count; index++) {
		const result = await options.dependencies.generateGrokImage({
			token,
			prompt: options.params.prompt.trim(),
			model,
			aspectRatio: (options.params.aspectRatio ?? "1:1") as AspectRatio,
			resolution,
			quality,
			signal: options.signal,
		});
		images.push({
			...result,
			bytes: decodeBase64Image(result.b64, result.mimeType),
		});
	}
	return { images, model, inputImageCount: 0, resolution, quality };
}

export function registerSubscriptionImage(
	pi: ExtensionAPI,
	dependencies: SubscriptionImageDependencies = DEFAULT_DEPENDENCIES,
): void {
	pi.registerTool({
		name: "generate_image",
		label: "Image Generation",
		description:
			"Generate or edit raster images using quota from existing OpenAI Codex or xAI Grok subscription accounts. The provider follows the active openai-codex/xai session unless explicitly selected. Codex supports reference-image editing; Grok currently supports text-to-image only.",
		promptSnippet:
			"Generate or edit images using quota from Codex or Grok subscription accounts",
		promptGuidelines: [
			"Use generate_image when the user asks to generate, draw, edit, or create a raster image.",
			"Do not call generate_image without a clear image request because it uses quota from the selected subscription account.",
			"Let generate_image follow the current openai-codex/xai session provider unless the user explicitly requests Codex or Grok.",
			"Use provider=codex when reference-image editing is requested.",
		],
		parameters: TOOL_PARAMS,
		prepareArguments: (args) => prepareToolArguments(args) as ToolParams,
		executionMode: "parallel",
		async execute(_toolCallId, params: ToolParams, signal, onUpdate, ctx) {
			const prompt = params.prompt.trim();
			if (!prompt) throw new Error("prompt is required.");

			const projectTrusted =
				typeof ctx.isProjectTrusted === "function" && ctx.isProjectTrusted();
			const config = dependencies.loadConfig(ctx.cwd, projectTrusted);
			for (const warning of validateConfig(config)) {
				if (ctx.hasUI) ctx.ui.notify(`[image-generation] ${warning}`, "warning");
			}
			const provider = resolveProvider({
				requested: params.provider,
				sessionProvider: ctx.model?.provider,
				defaultProvider: resolveDefaultProvider(config),
				requiresCodex: hasReferenceInputs(params),
			});
			validateProviderParameters(provider, params);
			const count = normalizeCount(params.n);

			onUpdate?.({
				content: [
					{
						type: "text",
						text: `Requesting ${count} image(s) from ${provider} using subscription account quota...`,
					},
				],
				details: { provider, count },
			});

			const generated =
				provider === "codex"
					? await generateWithCodex({ params, config, ctx, signal, dependencies })
					: await generateWithGrok({ params, config, ctx, signal, dependencies });
			const saveConfig = resolveSaveConfig(params, ctx.cwd, config);
			const savedPaths: string[] = [];
			const saveWarnings: string[] = [];
			for (const image of generated.images) {
				if (saveConfig.mode === "none" || !saveConfig.outputDir) continue;
				try {
					const path = await dependencies.saveGeneratedImage({
						bytes: image.bytes,
						mimeType: image.mimeType,
						outputDir: saveConfig.outputDir,
						prompt,
					});
					savedPaths.push(path);
				} catch (error) {
					saveWarnings.push(error instanceof Error ? error.message : String(error));
				}
			}

			const outputFormats = [
				...new Set(
					generated.images.map((image) => outputFormatForMimeType(image.mimeType)),
				),
			];
			const content: Array<
				| { type: "text"; text: string }
				| { type: "image"; data: string; mimeType: string }
			> = [
				{
					type: "text",
					text: [
						`Generated ${generated.images.length} image(s) via ${provider}/${generated.model} using subscription account quota.`,
						provider === "codex"
							? `Backend image model: ${CODEX_IMAGE_BACKEND_MODEL}.`
							: undefined,
						generated.resolution ? `Resolution: ${generated.resolution}.` : undefined,
						generated.quality ? `Quality: ${generated.quality}.` : undefined,
						`Output format${outputFormats.length === 1 ? "" : "s"}: ${outputFormats.join(", ")}.`,
						savedPaths.length ? `Saved: ${savedPaths.join(", ")}.` : undefined,
						saveWarnings.length
							? `Save warnings: ${saveWarnings.join("; ")}.`
							: undefined,
					]
						.filter(Boolean)
						.join(" "),
				},
			];
			for (const image of generated.images) {
				content.push({ type: "image", data: image.b64, mimeType: image.mimeType });
			}

			return {
				content,
				details: {
					provider,
					model: generated.model,
					routingModel: provider === "codex" ? generated.model : undefined,
					imageModel: provider === "grok" ? generated.model : undefined,
					backendImageModel:
						provider === "codex" ? CODEX_IMAGE_BACKEND_MODEL : generated.model,
					requestedCount: count,
					generatedCount: generated.images.length,
					aspectRatio:
						provider === "grok" ? (params.aspectRatio ?? "1:1") : params.aspectRatio,
					resolution: generated.resolution,
					quality: generated.quality,
					outputFormat: outputFormats.length === 1 ? outputFormats[0] : undefined,
					outputFormats,
					inputImageCount: generated.inputImageCount,
					saveMode: saveConfig.mode,
					savedPaths,
					saveWarnings,
					items: generated.images.map((image) => ({
						mimeType: image.mimeType,
						byteSize: image.bytes.byteLength,
						status: image.status,
						responseId: image.responseId,
						imageId: image.imageId,
						revisedPrompt: image.revisedPrompt,
						usage: image.usage,
					})),
				},
			};
		},
	});

	pi.registerCommand("img", {
		description:
			"Generate an image using Codex or Grok subscription account quota",
		handler: async (args, ctx) => {
			const prompt = args.trim();
			if (!prompt) {
				ctx.ui.notify("Usage: /img <prompt>", "error");
				return;
			}
			await pi.sendUserMessage(
				`Use generate_image to create an image with this prompt: ${prompt}`,
			);
		},
	});

	pi.registerCommand("subscription-image", {
		description:
			"Check image generation readiness for Codex and Grok subscription accounts",
		handler: async (args, ctx) => {
			if (args.trim() && args.trim().toLowerCase() !== "status") {
				ctx.ui.notify("Usage: /subscription-image [status]", "error");
				return;
			}
			const [codexReady, grokReady] = await Promise.all([
				credentialAvailable(ctx, "openai-codex"),
				credentialAvailable(ctx, "xai"),
			]);
			ctx.ui.notify(
				`Image Generation: Codex ${codexReady ? "ready" : "login required"}; Grok ${grokReady ? "ready" : "login required"}`,
				codexReady || grokReady ? "info" : "warning",
			);
		},
	});
}

export default function subscriptionImage(pi: ExtensionAPI): void {
	registerSubscriptionImage(pi);
}
