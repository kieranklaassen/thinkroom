import { AllSelection, TextSelection } from "@milkdown/prose/state";
import { $ctx, $shortcut } from "@milkdown/utils";
//#region src/index.ts
function updateIndent(tr, options) {
	const { doc, selection } = tr;
	if (!doc || !selection) return tr;
	if (!(selection instanceof TextSelection || selection instanceof AllSelection)) return tr;
	const { to } = selection;
	const text = options.type === "space" ? Array(options.size).fill(" ").join("") : "	";
	return tr.insertText(text, to);
}
var indentConfig = $ctx({
	type: "space",
	size: 2
}, "indentConfig");
indentConfig.meta = {
	package: "@milkdown/plugin-indent",
	displayName: "Ctx<indentConfig>"
};
var indentPlugin = $shortcut((ctx) => ({ Tab: (state, dispatch) => {
	const config = ctx.get(indentConfig.key);
	const { tr } = state;
	const _tr = updateIndent(tr, config);
	if (_tr.docChanged) {
		dispatch?.(_tr);
		return true;
	}
	return false;
} }));
indentPlugin.meta = {
	package: "@milkdown/plugin-indent",
	displayName: "Shortcut<indent>"
};
var indent = [indentConfig, indentPlugin];
//#endregion
export { indent, indentConfig, indentPlugin };

//# sourceMappingURL=index.js.map