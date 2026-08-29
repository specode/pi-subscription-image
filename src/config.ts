import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	GROK_QUALITIES,
	GROK_RESOLUTIONS,
	OUTPUT_FORMATS,
	PROVIDERS,
	SAVE_MODES,
	type GrokQuality,
	type GrokResolution,
	type OutputFormat,
	type Provider,
	type SaveMode,
} from "./core.ts";

export const DEFAULT_CODEX_ROUTING_MODEL = "gpt-5.6-sol";
export const DEFAULT_GROK_IMAGE_MODEL = "grok-imagine-image-2.0";

export interface SubscriptionImageConfig {
	defaultProvider?: Provider;
	save?: SaveMode;
	saveDir?: string;
	providers?: {
		codex?: {
			routingModel?: string;
			outputFormat?: OutputFormat;
		};
		grok?: {
			imageModel?: string;
			resolution?: GrokResolution;
			quality?: GrokQuality;
		};
	};
	/** @deprecated Use providers.codex.routingModel. */
	codexRoutingModel?: string;
	/** @deprecated Use providers.grok.imageModel. */
	grokImageModel?: string;
}

export interface SaveConfig {
	mode: SaveMode;
	outputDir?: string;
}

function readConfigFile(path: string): SubscriptionImageConfig {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function normalizeConfigLayer(
	config: SubscriptionImageConfig,
): SubscriptionImageConfig {
	const legacyCodex = config.codexRoutingModel?.trim();
	const legacyGrok = config.grokImageModel?.trim();
	return {
		...config,
		providers: {
			...config.providers,
			codex: {
				...(legacyCodex ? { routingModel: legacyCodex } : {}),
				...config.providers?.codex,
			},
			grok: {
				...(legacyGrok ? { imageModel: legacyGrok } : {}),
				...config.providers?.grok,
			},
		},
	};
}

function mergeConfigLayers(
	globalConfig: SubscriptionImageConfig,
	projectConfig: SubscriptionImageConfig,
): SubscriptionImageConfig {
	return {
		...globalConfig,
		...projectConfig,
		providers: {
			...globalConfig.providers,
			...projectConfig.providers,
			codex: {
				...globalConfig.providers?.codex,
				...projectConfig.providers?.codex,
			},
			grok: {
				...globalConfig.providers?.grok,
				...projectConfig.providers?.grok,
			},
		},
	};
}

export function loadConfig(
	cwd: string,
	projectTrusted: boolean,
	agentDir = getAgentDir(),
): SubscriptionImageConfig {
	const globalConfig = normalizeConfigLayer(
		readConfigFile(join(agentDir, "extensions", "subscription-image.json")),
	);
	if (!projectTrusted) return globalConfig;
	const projectConfig = normalizeConfigLayer(
		readConfigFile(join(cwd, ".pi", "extensions", "subscription-image.json")),
	);
	return mergeConfigLayers(globalConfig, projectConfig);
}

function configuredProvider(value: string | undefined): Provider | undefined {
	const normalized = value?.trim().toLowerCase();
	return normalized === "codex" || normalized === "grok"
		? normalized
		: undefined;
}

function configuredOutputFormat(
	value: string | undefined,
): OutputFormat | undefined {
	const normalized = value?.trim().toLowerCase();
	return (OUTPUT_FORMATS as readonly string[]).includes(normalized ?? "")
		? (normalized as OutputFormat)
		: undefined;
}

function configuredGrokResolution(
	value: string | undefined,
): GrokResolution | undefined {
	const normalized = value?.trim().toLowerCase();
	return (GROK_RESOLUTIONS as readonly string[]).includes(normalized ?? "")
		? (normalized as GrokResolution)
		: undefined;
}

function configuredGrokQuality(
	value: string | undefined,
): GrokQuality | undefined {
	const normalized = value?.trim().toLowerCase();
	return (GROK_QUALITIES as readonly string[]).includes(normalized ?? "")
		? (normalized as GrokQuality)
		: undefined;
}

export function resolveDefaultProvider(
	config: SubscriptionImageConfig,
): Provider | undefined {
	return (
		configuredProvider(process.env.PI_SUBSCRIPTION_IMAGE_PROVIDER) ??
		configuredProvider(config.defaultProvider)
	);
}

export function resolveCodexModel(
	model: string | undefined,
	config: SubscriptionImageConfig,
): string {
	return (
		model?.trim() ||
		process.env.PI_SUBSCRIPTION_IMAGE_CODEX_MODEL?.trim() ||
		config.providers?.codex?.routingModel?.trim() ||
		config.codexRoutingModel?.trim() ||
		DEFAULT_CODEX_ROUTING_MODEL
	);
}

export function resolveCodexOutputFormat(
	outputFormat: OutputFormat | undefined,
	config: SubscriptionImageConfig,
): OutputFormat {
	return (
		outputFormat ??
		configuredOutputFormat(
			process.env.PI_SUBSCRIPTION_IMAGE_CODEX_OUTPUT_FORMAT,
		) ??
		configuredOutputFormat(config.providers?.codex?.outputFormat) ??
		"png"
	);
}

export function resolveGrokModel(
	model: string | undefined,
	config: SubscriptionImageConfig,
): string {
	return (
		model?.trim() ||
		process.env.PI_SUBSCRIPTION_IMAGE_GROK_MODEL?.trim() ||
		process.env.PI_GROK_CLI_IMAGINE_MODEL?.trim() ||
		config.providers?.grok?.imageModel?.trim() ||
		config.grokImageModel?.trim() ||
		DEFAULT_GROK_IMAGE_MODEL
	);
}

export function resolveGrokResolution(
	resolution: GrokResolution | undefined,
	config: SubscriptionImageConfig,
): GrokResolution {
	return (
		resolution ??
		configuredGrokResolution(process.env.PI_SUBSCRIPTION_IMAGE_GROK_RESOLUTION) ??
		configuredGrokResolution(config.providers?.grok?.resolution) ??
		"1k"
	);
}

export function resolveGrokQuality(
	quality: GrokQuality | undefined,
	config: SubscriptionImageConfig,
): GrokQuality | undefined {
	return (
		quality ??
		configuredGrokQuality(process.env.PI_SUBSCRIPTION_IMAGE_GROK_QUALITY) ??
		configuredGrokQuality(config.providers?.grok?.quality)
	);
}

function isSaveMode(value: string | undefined): value is SaveMode {
	return Boolean(value && (SAVE_MODES as readonly string[]).includes(value));
}

export function resolvePathUnderCwd(cwd: string, path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	return isAbsolute(path) ? path : resolve(cwd, path);
}

export function resolveSaveConfig(
	params: { save?: SaveMode; saveDir?: string },
	cwd: string,
	config: SubscriptionImageConfig,
	agentDir = getAgentDir(),
): SaveConfig {
	const envMode = (
		process.env.PI_SUBSCRIPTION_IMAGE_SAVE_MODE ||
		process.env.PI_IMAGE_SAVE_MODE ||
		""
	).toLowerCase();
	const requested = params.save || envMode || config.save || "global";
	const mode = isSaveMode(requested) ? requested : "global";

	switch (mode) {
		case "none":
			return { mode };
		case "project":
			return { mode, outputDir: join(cwd, ".pi", "generated-images") };
		case "global":
			return { mode, outputDir: join(agentDir, "generated-images") };
		case "custom": {
			const directory =
				params.saveDir ||
				process.env.PI_SUBSCRIPTION_IMAGE_SAVE_DIR ||
				process.env.PI_IMAGE_SAVE_DIR ||
				config.saveDir;
			if (!directory?.trim()) {
				throw new Error(
					"save=custom requires saveDir or PI_SUBSCRIPTION_IMAGE_SAVE_DIR.",
				);
			}
			return { mode, outputDir: resolvePathUnderCwd(cwd, directory) };
		}
	}
}

export function validateConfig(config: SubscriptionImageConfig): string[] {
	const warnings: string[] = [];
	if (
		config.defaultProvider !== undefined &&
		!(PROVIDERS as readonly string[]).includes(config.defaultProvider)
	) {
		warnings.push(`Ignoring invalid defaultProvider: ${config.defaultProvider}`);
	}
	if (config.save !== undefined && !isSaveMode(config.save)) {
		warnings.push(`Ignoring invalid save mode: ${config.save}`);
	}
	const outputFormat = config.providers?.codex?.outputFormat;
	if (
		outputFormat !== undefined &&
		!(OUTPUT_FORMATS as readonly string[]).includes(outputFormat)
	) {
		warnings.push(`Ignoring invalid Codex output format: ${outputFormat}`);
	}
	const resolution = config.providers?.grok?.resolution;
	if (
		resolution !== undefined &&
		!(GROK_RESOLUTIONS as readonly string[]).includes(resolution)
	) {
		warnings.push(`Ignoring invalid Grok resolution: ${resolution}`);
	}
	const quality = config.providers?.grok?.quality;
	if (
		quality !== undefined &&
		!(GROK_QUALITIES as readonly string[]).includes(quality)
	) {
		warnings.push(`Ignoring invalid Grok quality: ${quality}`);
	}
	return warnings;
}
