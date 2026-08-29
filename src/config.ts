import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	PROVIDERS,
	SAVE_MODES,
	type Provider,
	type SaveMode,
} from "./core.ts";

export interface SubscriptionImageConfig {
	defaultProvider?: Provider;
	save?: SaveMode;
	saveDir?: string;
	codexRoutingModel?: string;
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

export function loadConfig(
	cwd: string,
	projectTrusted: boolean,
	agentDir = getAgentDir(),
): SubscriptionImageConfig {
	const globalConfig = readConfigFile(
		join(agentDir, "extensions", "subscription-image.json"),
	);
	if (!projectTrusted) return globalConfig;
	const projectConfig = readConfigFile(
		join(cwd, ".pi", "extensions", "subscription-image.json"),
	);
	return { ...globalConfig, ...projectConfig };
}

function configuredProvider(value: string | undefined): Provider | undefined {
	const normalized = value?.trim().toLowerCase();
	return normalized === "codex" || normalized === "grok" ? normalized : undefined;
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
		config.codexRoutingModel?.trim() ||
		"gpt-5.5"
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
		config.grokImageModel?.trim() ||
		"grok-imagine-image-quality"
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
	return warnings;
}
