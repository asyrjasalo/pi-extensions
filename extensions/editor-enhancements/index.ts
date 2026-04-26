/**
 * editor-enhancements
 *
 * Composite custom editor that combines:
 * - shell-completions (autocomplete wrapping for !/!! mode)
 * - file-picker (@ opens overlay file browser)
 * - raw-paste alt+v (paste clipboard text "raw" into editor, bypassing large-paste markers)
 *
 * NOTE: This extension intentionally owns ctx.ui.setEditorComponent().
 * Disable other extensions that also call setEditorComponent (shell-completions/, file-picker.ts, raw-paste.ts)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { loadConfig, resolveAutocompleteMaxVisible, resolvePromptsmithShortcut } from "./config.js";
import { EnhancedEditor, patchWithEnhancedFeatures, type EnhancedEditorOptions } from "./enhanced-editor.js";

function resolveDoubleEscapeCommand(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    doubleEscapeCommand: string | null,
): string | null {
    if (!doubleEscapeCommand) return null;

    const hasMatchingExtensionCommand = pi.getCommands().some(
        (command) => command.source === "extension" && command.name === doubleEscapeCommand,
    );

    if (hasMatchingExtensionCommand) {
        return doubleEscapeCommand;
    }

    ctx.ui.notify(
        `editor-enhancements: configured doubleEscapeCommand '/${doubleEscapeCommand}' is not a registered extension command`,
        "warning",
    );
    return null;
}

export default function (pi: ExtensionAPI) {
    let activeContext: ExtensionContext | null = null;
    let activeEditor: { onSubmit?: (text: string) => void; pasteClipboardRawAtCursor(): Promise<void> } | null = null;
    let promptsmithShortcutRegistered = false;

    const attachEditor = (ctx: ExtensionContext) => {
        if (!ctx.hasUI) return;

        activeContext = ctx;
        const config = loadConfig();
        const autocompleteMaxVisible = resolveAutocompleteMaxVisible(ctx.cwd);
        const doubleEscapeCommand = resolveDoubleEscapeCommand(pi, ctx, config.doubleEscapeCommand);

        const editorOptions: EnhancedEditorOptions = {
            doubleEscapeCommand,
            canTriggerDoubleEscapeCommand: () => {
                if (!activeContext) return false;
                return activeContext.isIdle() && !activeContext.hasPendingMessages();
            },
            commandRemap: config.commandRemap,
            autocompleteMaxVisible,
        };

        // Intercept future setEditorComponent calls so enhancements survive
        // when pi-prompt-suggester (or any other extension) replaces the editor.
        const originalSetEditorComponent = ctx.ui.setEditorComponent.bind(ctx.ui);
        let isOurInstall = false;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ctx.ui as any).setEditorComponent = (factory: Parameters<typeof ctx.ui.setEditorComponent>[0]) => {
            if (isOurInstall) {
                originalSetEditorComponent(factory);
                return;
            }
            if (!factory) {
                originalSetEditorComponent(undefined);
                activeEditor = null;
                return;
            }
            originalSetEditorComponent((tui, theme, keybindings) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const base = factory(tui, theme, keybindings) as any;
                patchWithEnhancedFeatures(base, tui, keybindings, ctx.ui, editorOptions);
                activeEditor = base;
                return base;
            });
        };

        isOurInstall = true;
        ctx.ui.setEditorComponent((tui, theme, keybindings) => {
            activeEditor = new EnhancedEditor(tui, theme, keybindings, ctx.ui, editorOptions);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return activeEditor as any;
        });
        isOurInstall = false;
    };

    pi.on("session_start", (_event, ctx) => {
        attachEditor(ctx);

        if (promptsmithShortcutRegistered) return;

        const promptsmithShortcut = resolvePromptsmithShortcut();
        const hasPromptsmithCommand = pi.getCommands().some((command) => command.name === "promptsmith");
        if (!promptsmithShortcut || !hasPromptsmithCommand) return;

        pi.registerShortcut(promptsmithShortcut as Parameters<typeof pi.registerShortcut>[0], {
            description: "Enhance current editor prompt",
            handler: async (shortcutCtx) => {
                if (!shortcutCtx.hasUI) return;
                if (!activeEditor || !activeEditor.onSubmit) {
                    shortcutCtx.ui.notify("Editor not ready", "warning");
                    return;
                }
                activeEditor.onSubmit("/promptsmith");
            },
        });
        promptsmithShortcutRegistered = true;
    });

    // Raw clipboard paste — shortcut configurable via rawPasteShortcut in config.json (default: alt+v)
    const config = loadConfig();
    if (config.rawPasteShortcut) {
        pi.registerShortcut(config.rawPasteShortcut as Parameters<typeof pi.registerShortcut>[0], {
            description: "Paste clipboard text raw into editor (bypasses [paste #..] markers)",
            handler: async (ctx) => {
                if (!ctx.hasUI) return;
                if (!activeEditor) {
                    ctx.ui.notify("Editor not ready", "warning");
                    return;
                }
                await activeEditor.pasteClipboardRawAtCursor();
            },
        });
    }

}
