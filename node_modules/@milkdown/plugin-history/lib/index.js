import { commandsCtx } from "@milkdown/core";
import { history as history$1, redo, undo } from "@milkdown/prose/history";
import { $command, $ctx, $prose, $useKeymap } from "@milkdown/utils";
//#region src/index.ts
function withMeta(plugin, meta) {
	Object.assign(plugin, { meta: {
		package: "@milkdown/plugin-history",
		...meta
	} });
	return plugin;
}
var undoCommand = $command("Undo", () => () => undo);
withMeta(undoCommand, { displayName: "Command<undo>" });
var redoCommand = $command("Redo", () => () => redo);
withMeta(redoCommand, { displayName: "Command<redo>" });
var historyProviderConfig = $ctx({}, "historyProviderConfig");
withMeta(historyProviderConfig, { displayName: "Ctx<historyProviderConfig>" });
var historyProviderPlugin = $prose((ctx) => history$1(ctx.get(historyProviderConfig.key)));
withMeta(historyProviderPlugin, { displayName: "Ctx<historyProviderPlugin>" });
var historyKeymap = $useKeymap("historyKeymap", {
	Undo: {
		shortcuts: "Mod-z",
		command: (ctx) => {
			const commands = ctx.get(commandsCtx);
			return () => commands.call(undoCommand.key);
		}
	},
	Redo: {
		shortcuts: ["Mod-y", "Shift-Mod-z"],
		command: (ctx) => {
			const commands = ctx.get(commandsCtx);
			return () => commands.call(redoCommand.key);
		}
	}
});
withMeta(historyKeymap.ctx, { displayName: "KeymapCtx<history>" });
withMeta(historyKeymap.shortcuts, { displayName: "Keymap<history>" });
var history = [
	historyProviderConfig,
	historyProviderPlugin,
	historyKeymap,
	undoCommand,
	redoCommand
].flat();
//#endregion
export { history, historyKeymap, historyProviderConfig, historyProviderPlugin, redoCommand, undoCommand };

//# sourceMappingURL=index.js.map