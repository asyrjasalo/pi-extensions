import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type EditorEnhancementsConfig = {
    doubleEscapeCommand?: string | null;
    commandRemap?: Record<string, string>;
    rawPasteShortcut?: string | null;
};

export type EditorEnhancementsRuntimeConfig = {
    doubleEscapeCommand: string | null;
    commandRemap: Record<string, string>;
    rawPasteShortcut: string | null;
};

const AUTOCOMPLETE_MIN_VISIBLE = 3;
const AUTOCOMPLETE_MAX_VISIBLE = 20;

const DEFAULT_CONFIG: EditorEnhancementsRuntimeConfig = {
    doubleEscapeCommand: null,
    commandRemap: {},
    rawPasteShortcut: "alt+v",
};

export function normalizeCommandName(value: unknown): string | null {
    if (typeof value !== "string") return null;

    const trimmed = value.trim();
    if (!trimmed) return null;

    const normalized = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
    return normalized || null;
}

export function normalizeCommandRemap(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};

    const result: Record<string, string> = {};
    for (const [from, to] of Object.entries(value as Record<string, unknown>)) {
        const normalizedFrom = normalizeCommandName(from);
        const normalizedTo = normalizeCommandName(to);
        if (normalizedFrom && normalizedTo) {
            result[normalizedFrom] = normalizedTo;
        }
    }
    return result;
}

export function normalizeShortcut(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().toLowerCase();
    return trimmed || null;
}

export function loadConfig(): EditorEnhancementsRuntimeConfig {
    const extensionDir = path.dirname(fileURLToPath(import.meta.url));
    const configPath = path.join(extensionDir, "config.json");

    if (!fs.existsSync(configPath)) {
        return DEFAULT_CONFIG;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as EditorEnhancementsConfig;
        return {
            doubleEscapeCommand: normalizeCommandName(parsed.doubleEscapeCommand),
            commandRemap: normalizeCommandRemap(parsed.commandRemap),
            rawPasteShortcut: normalizeShortcut(parsed.rawPasteShortcut),
        };
    } catch {
        return DEFAULT_CONFIG;
    }
}

function parseAutocompleteMaxVisible(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const rounded = Math.round(value);
    return Math.min(
        AUTOCOMPLETE_MAX_VISIBLE,
        Math.max(AUTOCOMPLETE_MIN_VISIBLE, rounded),
    );
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
    try {
        const text = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // Ignore malformed/missing settings; fallback to defaults.
    }
    return undefined;
}

export function resolveAutocompleteMaxVisible(cwd: string): number | undefined {
    const globalSettingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
    const projectSettingsPath = path.join(cwd, ".pi", "settings.json");

    const globalSettings = readJsonObject(globalSettingsPath);
    const projectSettings = readJsonObject(projectSettingsPath);

    const globalValue = parseAutocompleteMaxVisible(globalSettings?.autocompleteMaxVisible);
    const projectValue = parseAutocompleteMaxVisible(projectSettings?.autocompleteMaxVisible);

    return projectValue ?? globalValue;
}
