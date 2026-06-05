import { commandsCtx, editorViewCtx, remarkStringifyOptionsCtx } from "@milkdown/core";
import { findNodeInSelection, findSelectedNodeOfType, markRule } from "@milkdown/prose";
import { joinBackward, setBlockType, toggleMark, wrapIn } from "@milkdown/prose/commands";
import { $command, $ctx, $inputRule, $markAttr, $markSchema, $node, $nodeAttr, $nodeSchema, $prose, $remark, $useKeymap } from "@milkdown/utils";
import { Fragment, Node } from "@milkdown/prose/model";
import { expectDomTypeError } from "@milkdown/exception";
import { Plugin, PluginKey, Selection, TextSelection } from "@milkdown/prose/state";
import { InputRule, textblockTypeInputRule, wrappingInputRule } from "@milkdown/prose/inputrules";
import { visitParents } from "unist-util-visit-parents";
import { liftListItem, sinkListItem, splitListItem } from "@milkdown/prose/schema-list";
import { AddMarkStep, ReplaceStep, findWrapping } from "@milkdown/prose/transform";
import { visit } from "unist-util-visit";
import remarkInlineLinks from "remark-inline-links";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
//#region src/__internal__/serialize-text.ts
function serializeText(state, node) {
	if (!(node.childCount >= 1 && node.lastChild?.type.name === "hardbreak")) {
		state.next(node.content);
		return;
	}
	const contentArr = [];
	node.content.forEach((n, _, i) => {
		if (i === node.childCount - 1) return;
		contentArr.push(n);
	});
	state.next(Fragment.fromArray(contentArr));
}
//#endregion
//#region src/__internal__/with-meta.ts
function withMeta(plugin, meta) {
	Object.assign(plugin, { meta: {
		package: "@milkdown/preset-commonmark",
		...meta
	} });
	return plugin;
}
//#endregion
//#region src/mark/emphasis.ts
var emphasisAttr = $markAttr("emphasis");
withMeta(emphasisAttr, {
	displayName: "Attr<emphasis>",
	group: "Emphasis"
});
var emphasisSchema = $markSchema("emphasis", (ctx) => ({
	attrs: { marker: {
		default: ctx.get(remarkStringifyOptionsCtx).emphasis || "*",
		validate: "string"
	} },
	parseDOM: [
		{ tag: "i" },
		{ tag: "em" },
		{
			style: "font-style",
			getAttrs: (value) => value === "italic"
		}
	],
	toDOM: (mark) => ["em", ctx.get(emphasisAttr.key)(mark)],
	parseMarkdown: {
		match: (node) => node.type === "emphasis",
		runner: (state, node, markType) => {
			state.openMark(markType, { marker: node.marker });
			state.next(node.children);
			state.closeMark(markType);
		}
	},
	toMarkdown: {
		match: (mark) => mark.type.name === "emphasis",
		runner: (state, mark) => {
			state.withMark(mark, "emphasis", void 0, { marker: mark.attrs.marker });
		}
	}
}));
withMeta(emphasisSchema.mark, {
	displayName: "MarkSchema<emphasis>",
	group: "Emphasis"
});
withMeta(emphasisSchema.ctx, {
	displayName: "MarkSchemaCtx<emphasis>",
	group: "Emphasis"
});
var toggleEmphasisCommand = $command("ToggleEmphasis", (ctx) => () => {
	return toggleMark(emphasisSchema.type(ctx));
});
withMeta(toggleEmphasisCommand, {
	displayName: "Command<toggleEmphasisCommand>",
	group: "Emphasis"
});
var emphasisStarInputRule = $inputRule((ctx) => {
	return markRule(/(?:^|[^*])\*([^*]+)\*$/, emphasisSchema.type(ctx), {
		getAttr: () => ({ marker: "*" }),
		updateCaptured: ({ fullMatch, start }) => !fullMatch.startsWith("*") ? {
			fullMatch: fullMatch.slice(1),
			start: start + 1
		} : {}
	});
});
withMeta(emphasisStarInputRule, {
	displayName: "InputRule<emphasis>|Star",
	group: "Emphasis"
});
var emphasisUnderscoreInputRule = $inputRule((ctx) => {
	return markRule(/\b_(?![_\s])(.*?[^_\s])_\b/, emphasisSchema.type(ctx), {
		getAttr: () => ({ marker: "_" }),
		updateCaptured: ({ fullMatch, start }) => !fullMatch.startsWith("_") ? {
			fullMatch: fullMatch.slice(1),
			start: start + 1
		} : {}
	});
});
withMeta(emphasisUnderscoreInputRule, {
	displayName: "InputRule<emphasis>|Underscore",
	group: "Emphasis"
});
var emphasisKeymap = $useKeymap("emphasisKeymap", { ToggleEmphasis: {
	shortcuts: "Mod-i",
	command: (ctx) => {
		const commands = ctx.get(commandsCtx);
		return () => commands.call(toggleEmphasisCommand.key);
	}
} });
withMeta(emphasisKeymap.ctx, {
	displayName: "KeymapCtx<emphasis>",
	group: "Emphasis"
});
withMeta(emphasisKeymap.shortcuts, {
	displayName: "Keymap<emphasis>",
	group: "Emphasis"
});
//#endregion
//#region src/mark/strong.ts
var strongAttr = $markAttr("strong");
withMeta(strongAttr, {
	displayName: "Attr<strong>",
	group: "Strong"
});
var strongSchema = $markSchema("strong", (ctx) => ({
	attrs: { marker: {
		default: ctx.get(remarkStringifyOptionsCtx).strong || "*",
		validate: "string"
	} },
	parseDOM: [
		{
			tag: "b",
			getAttrs: (node) => node.style.fontWeight != "normal" && null
		},
		{ tag: "strong" },
		{
			style: "font-style",
			getAttrs: (value) => value === "bold"
		},
		{
			style: "font-weight=400",
			clearMark: (m) => m.type.name == "strong"
		},
		{
			style: "font-weight",
			getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null
		}
	],
	toDOM: (mark) => ["strong", ctx.get(strongAttr.key)(mark)],
	parseMarkdown: {
		match: (node) => node.type === "strong",
		runner: (state, node, markType) => {
			state.openMark(markType, { marker: node.marker });
			state.next(node.children);
			state.closeMark(markType);
		}
	},
	toMarkdown: {
		match: (mark) => mark.type.name === "strong",
		runner: (state, mark) => {
			state.withMark(mark, "strong", void 0, { marker: mark.attrs.marker });
		}
	}
}));
withMeta(strongSchema.mark, {
	displayName: "MarkSchema<strong>",
	group: "Strong"
});
withMeta(strongSchema.ctx, {
	displayName: "MarkSchemaCtx<strong>",
	group: "Strong"
});
var toggleStrongCommand = $command("ToggleStrong", (ctx) => () => {
	return toggleMark(strongSchema.type(ctx));
});
withMeta(toggleStrongCommand, {
	displayName: "Command<toggleStrongCommand>",
	group: "Strong"
});
var strongInputRule = $inputRule((ctx) => {
	return markRule(/(?<![\w:/])(?:\*\*|__)([^*_]+?)(?:\*\*|__)(?![\w/])$/, strongSchema.type(ctx), { getAttr: (match) => {
		return { marker: match[0].startsWith("*") ? "*" : "_" };
	} });
});
withMeta(strongInputRule, {
	displayName: "InputRule<strong>",
	group: "Strong"
});
var strongKeymap = $useKeymap("strongKeymap", { ToggleBold: {
	shortcuts: ["Mod-b"],
	command: (ctx) => {
		const commands = ctx.get(commandsCtx);
		return () => commands.call(toggleStrongCommand.key);
	}
} });
withMeta(strongKeymap.ctx, {
	displayName: "KeymapCtx<strong>",
	group: "Strong"
});
withMeta(strongKeymap.shortcuts, {
	displayName: "Keymap<strong>",
	group: "Strong"
});
//#endregion
//#region src/mark/inline-code.ts
var inlineCodeAttr = $markAttr("inlineCode");
withMeta(inlineCodeAttr, {
	displayName: "Attr<inlineCode>",
	group: "InlineCode"
});
var inlineCodeSchema = $markSchema("inlineCode", (ctx) => ({
	priority: 100,
	code: true,
	parseDOM: [{ tag: "code" }],
	toDOM: (mark) => ["code", ctx.get(inlineCodeAttr.key)(mark)],
	parseMarkdown: {
		match: (node) => node.type === "inlineCode",
		runner: (state, node, markType) => {
			state.openMark(markType);
			state.addText(node.value);
			state.closeMark(markType);
		}
	},
	toMarkdown: {
		match: (mark) => mark.type.name === "inlineCode",
		runner: (state, mark, node) => {
			state.withMark(mark, "inlineCode", node.text || "");
			return true;
		}
	}
}));
withMeta(inlineCodeSchema.mark, {
	displayName: "MarkSchema<inlineCode>",
	group: "InlineCode"
});
withMeta(inlineCodeSchema.ctx, {
	displayName: "MarkSchemaCtx<inlineCode>",
	group: "InlineCode"
});
var toggleInlineCodeCommand = $command("ToggleInlineCode", (ctx) => () => (state, dispatch) => {
	const { selection, tr } = state;
	if (selection.empty) return false;
	const { from, to } = selection;
	if (state.doc.rangeHasMark(from, to, inlineCodeSchema.type(ctx))) {
		dispatch?.(tr.removeMark(from, to, inlineCodeSchema.type(ctx)));
		return true;
	}
	Object.keys(state.schema.marks).filter((x) => x !== inlineCodeSchema.type.name).map((name) => state.schema.marks[name]).forEach((t) => {
		tr.removeMark(from, to, t);
	});
	dispatch?.(tr.addMark(from, to, inlineCodeSchema.type(ctx).create()));
	return true;
});
withMeta(toggleInlineCodeCommand, {
	displayName: "Command<toggleInlineCodeCommand>",
	group: "InlineCode"
});
var inlineCodeInputRule = $inputRule((ctx) => {
	return markRule(/(?:`)([^`]+)(?:`)$/, inlineCodeSchema.type(ctx));
});
withMeta(inlineCodeInputRule, {
	displayName: "InputRule<inlineCodeInputRule>",
	group: "InlineCode"
});
var inlineCodeKeymap = $useKeymap("inlineCodeKeymap", { ToggleInlineCode: {
	shortcuts: "Mod-e",
	command: (ctx) => {
		const commands = ctx.get(commandsCtx);
		return () => commands.call(toggleInlineCodeCommand.key);
	}
} });
withMeta(inlineCodeKeymap.ctx, {
	displayName: "KeymapCtx<inlineCode>",
	group: "InlineCode"
});
withMeta(inlineCodeKeymap.shortcuts, {
	displayName: "Keymap<inlineCode>",
	group: "InlineCode"
});
//#endregion
//#region src/mark/link.ts
var linkAttr = $markAttr("link");
withMeta(linkAttr, {
	displayName: "Attr<link>",
	group: "Link"
});
var linkSchema = $markSchema("link", (ctx) => ({
	attrs: {
		href: { validate: "string" },
		title: {
			default: null,
			validate: "string|null"
		}
	},
	parseDOM: [{
		tag: "a[href]",
		getAttrs: (dom) => {
			if (!(dom instanceof HTMLElement)) throw expectDomTypeError(dom);
			return {
				href: dom.getAttribute("href"),
				title: dom.getAttribute("title")
			};
		}
	}],
	toDOM: (mark) => ["a", {
		...ctx.get(linkAttr.key)(mark),
		...mark.attrs
	}],
	parseMarkdown: {
		match: (node) => node.type === "link",
		runner: (state, node, markType) => {
			const url = node.url;
			const title = node.title;
			state.openMark(markType, {
				href: url,
				title
			});
			state.next(node.children);
			state.closeMark(markType);
		}
	},
	toMarkdown: {
		match: (mark) => mark.type.name === "link",
		runner: (state, mark) => {
			state.withMark(mark, "link", void 0, {
				title: mark.attrs.title,
				url: mark.attrs.href
			});
		}
	}
}));
withMeta(linkSchema.mark, {
	displayName: "MarkSchema<link>",
	group: "Link"
});
var toggleLinkCommand = $command("ToggleLink", (ctx) => (payload = {}) => toggleMark(linkSchema.type(ctx), payload));
withMeta(toggleLinkCommand, {
	displayName: "Command<toggleLinkCommand>",
	group: "Link"
});
var updateLinkCommand = $command("UpdateLink", (ctx) => (payload = {}) => (state, dispatch) => {
	if (!dispatch) return false;
	let node;
	let pos = -1;
	const { selection } = state;
	const { from, to } = selection;
	state.doc.nodesBetween(from, from === to ? to + 1 : to, (n, p) => {
		if (linkSchema.type(ctx).isInSet(n.marks)) {
			node = n;
			pos = p;
			return false;
		}
	});
	if (!node) return false;
	const mark = node.marks.find(({ type }) => type === linkSchema.type(ctx));
	if (!mark) return false;
	const start = pos;
	const end = pos + node.nodeSize;
	const { tr } = state;
	const linkMark = linkSchema.type(ctx).create({
		...mark.attrs,
		...payload
	});
	if (!linkMark) return false;
	dispatch(tr.removeMark(start, end, mark).addMark(start, end, linkMark).setSelection(new TextSelection(tr.selection.$anchor)).scrollIntoView());
	return true;
});
withMeta(updateLinkCommand, {
	displayName: "Command<updateLinkCommand>",
	group: "Link"
});
//#endregion
//#region src/node/doc.ts
var docSchema = $node("doc", () => ({
	content: "block+",
	parseMarkdown: {
		match: ({ type }) => type === "root",
		runner: (state, node, type) => {
			state.injectRoot(node, type);
		}
	},
	toMarkdown: {
		match: (node) => node.type.name === "doc",
		runner: (state, node) => {
			state.openNode("root");
			state.next(node.content);
		}
	}
}));
withMeta(docSchema, {
	displayName: "NodeSchema<doc>",
	group: "Doc"
});
//#endregion
//#region src/plugin/remark-preserve-empty-line.ts
function visitEmptyLine(ast) {
	return visitParents(ast, (node) => node.type === "html" && [
		"<br />",
		"<br>",
		"<br >",
		"<br/>"
	].includes(node.value?.trim()), (node, parents) => {
		if (!parents.length) return;
		const parent = parents[parents.length - 1];
		if (!parent) return;
		const index = parent.children.indexOf(node);
		if (index === -1) return;
		parent.children.splice(index, 1);
	}, true);
}
var remarkPreserveEmptyLinePlugin = $remark("remark-preserve-empty-line", () => () => visitEmptyLine);
withMeta(remarkPreserveEmptyLinePlugin.plugin, {
	displayName: "Remark<remarkPreserveEmptyLine>",
	group: "Remark"
});
withMeta(remarkPreserveEmptyLinePlugin.options, {
	displayName: "RemarkConfig<remarkPreserveEmptyLine>",
	group: "Remark"
});
//#endregion
//#region src/node/paragraph.ts
var paragraphAttr = $nodeAttr("paragraph");
withMeta(paragraphAttr, {
	displayName: "Attr<paragraph>",
	group: "Paragraph"
});
var paragraphSchema = $nodeSchema("paragraph", (ctx) => ({
	content: "inline*",
	group: "block",
	parseDOM: [{ tag: "p" }],
	toDOM: (node) => [
		"p",
		ctx.get(paragraphAttr.key)(node),
		0
	],
	parseMarkdown: {
		match: (node) => node.type === "paragraph",
		runner: (state, node, type) => {
			state.openNode(type);
			if (node.children) state.next(node.children);
			else state.addText(node.value || "");
			state.closeNode();
		}
	},
	toMarkdown: {
		match: (node) => node.type.name === "paragraph",
		runner: (state, node) => {
			const lastNode = ctx.get(editorViewCtx).state?.doc.lastChild;
			state.openNode("paragraph");
			if ((!node.content || node.content.size === 0) && node !== lastNode && shouldPreserveEmptyLine(ctx)) state.addNode("html", void 0, "<br />");
			else serializeText(state, node);
			state.closeNode();
		}
	}
}));
function shouldPreserveEmptyLine(ctx) {
	let shouldPreserveEmptyLine = false;
	try {
		ctx.get(remarkPreserveEmptyLinePlugin.id);
		shouldPreserveEmptyLine = true;
	} catch {
		shouldPreserveEmptyLine = false;
	}
	return shouldPreserveEmptyLine;
}
withMeta(paragraphSchema.node, {
	displayName: "NodeSchema<paragraph>",
	group: "Paragraph"
});
withMeta(paragraphSchema.ctx, {
	displayName: "NodeSchemaCtx<paragraph>",
	group: "Paragraph"
});
var turnIntoTextCommand = $command("TurnIntoText", (ctx) => () => setBlockType(paragraphSchema.type(ctx)));
withMeta(turnIntoTextCommand, {
	displayName: "Command<turnIntoTextCommand>",
	group: "Paragraph"
});
var paragraphKeymap = $useKeymap("paragraphKeymap", { TurnIntoText: {
	shortcuts: "Mod-Alt-0",
	command: (ctx) => {
		const commands = ctx.get(commandsCtx);
		return () => commands.call(turnIntoTextCommand.key);
	}
} });
withMeta(paragraphKeymap.ctx, {
	displayName: "KeymapCtx<paragraph>",
	group: "Paragraph"
});
withMeta(paragraphKeymap.shortcuts, {
	displayName: "Keymap<paragraph>",
	group: "Paragraph"
});
//#endregion
//#region src/node/heading.ts
var headingIndex = Array(6).fill(0).map((_, i) => i + 1);
function defaultHeadingIdGenerator(node) {
	return node.textContent.toLowerCase().trim().replace(/\s+/g, "-");
}
var headingIdGenerator = $ctx(defaultHeadingIdGenerator, "headingIdGenerator");
withMeta(headingIdGenerator, {
	displayName: "Ctx<HeadingIdGenerator>",
	group: "Heading"
});
var headingAttr = $nodeAttr("heading");
withMeta(headingAttr, {
	displayName: "Attr<heading>",
	group: "Heading"
});
var headingSchema = $nodeSchema("heading", (ctx) => {
	const getId = ctx.get(headingIdGenerator.key);
	return {
		content: "inline*",
		group: "block",
		defining: true,
		attrs: {
			id: {
				default: "",
				validate: "string"
			},
			level: {
				default: 1,
				validate: "number"
			}
		},
		parseDOM: headingIndex.map((x) => ({
			tag: `h${x}`,
			getAttrs: (node) => {
				if (!(node instanceof HTMLElement)) throw expectDomTypeError(node);
				return {
					level: x,
					id: node.id
				};
			}
		})),
		toDOM: (node) => {
			return [
				`h${node.attrs.level}`,
				{
					...ctx.get(headingAttr.key)(node),
					id: node.attrs.id || getId(node)
				},
				0
			];
		},
		parseMarkdown: {
			match: ({ type }) => type === "heading",
			runner: (state, node, type) => {
				const depth = node.depth;
				state.openNode(type, { level: depth });
				state.next(node.children);
				state.closeNode();
			}
		},
		toMarkdown: {
			match: (node) => node.type.name === "heading",
			runner: (state, node) => {
				state.openNode("heading", void 0, { depth: node.attrs.level });
				serializeText(state, node);
				state.closeNode();
			}
		}
	};
});
withMeta(headingSchema.node, {
	displayName: "NodeSchema<heading>",
	group: "Heading"
});
withMeta(headingSchema.ctx, {
	displayName: "NodeSchemaCtx<heading>",
	group: "Heading"
});
var wrapInHeadingInputRule = $inputRule((ctx) => {
	return textblockTypeInputRule(/^(?<hashes>#+)\s$/, headingSchema.type(ctx), (match) => {
		const x = match.groups?.hashes?.length || 0;
		const { $from } = ctx.get(editorViewCtx).state.selection;
		const node = $from.node();
		if (node.type.name === "heading") {
			let level = Number(node.attrs.level) + Number(x);
			if (level > 6) level = 6;
			return { level };
		}
		return { level: x };
	});
});
withMeta(wrapInHeadingInputRule, {
	displayName: "InputRule<wrapInHeadingInputRule>",
	group: "Heading"
});
var wrapInHeadingCommand = $command("WrapInHeading", (ctx) => {
	return (level) => {
		level ??= 1;
		if (level < 1) return setBlockType(paragraphSchema.type(ctx));
		return setBlockType(headingSchema.type(ctx), { level });
	};
});
withMeta(wrapInHeadingCommand, {
	displayName: "Command<wrapInHeadingCommand>",
	group: "Heading"
});
var downgradeHeadingCommand = $command("DowngradeHeading", (ctx) => () => (state, dispatch, view) => {
	const { $from } = state.selection;
	const node = $from.node();
	if (node.type !== headingSchema.type(ctx) || !state.selection.empty || $from.parentOffset !== 0) return false;
	const level = node.attrs.level - 1;
	if (!level) return setBlockType(paragraphSchema.type(ctx))(state, dispatch, view);
	dispatch?.(state.tr.setNodeMarkup(state.selection.$from.before(), void 0, {
		...node.attrs,
		level
	}));
	return true;
});
withMeta(downgradeHeadingCommand, {
	displayName: "Command<downgradeHeadingCommand>",
	group: "Heading"
});
var headingKeymap = $useKeymap("headingKeymap", {
	TurnIntoH1: {
		shortcuts: "Mod-Alt-1",
		command: (ctx) => {
			const commands = ctx.get(commandsCtx);
			return () => commands.call(wrapInHeadingCommand.key, 1);
		}
	},
	TurnIntoH2: {
		shortcuts: "Mod-Alt-2",
		command: (ctx) => {
			const commands = ctx.get(commandsCtx);
			return () => commands.call(wrapInHeadingCommand.key, 2);
		}
	},
	TurnIntoH3: {
		shortcuts: "Mod-Alt-3",
		command: (ctx) => {
			const commands = ctx.get(commandsCtx);
			return () => commands.call(wrapInHeadingCommand.key, 3);
		}
	},
	TurnIntoH4: {
		shortcuts: "Mod-Alt-4",
		command: (ctx) => {
			const commands = ctx.get(commandsCtx);
			return () => commands.call(wrapInHeadingCommand.key, 4);
		}
	},
	TurnIntoH5: {
		shortcuts: "Mod-Alt-5",
		command: (ctx) => {
			const commands = ctx.get(commandsCtx);
			return () => commands.call(wrapInHeadingCommand.key, 5);
		}
	},
	TurnIntoH6: {
		shortcuts: "Mod-Alt-6",
		command: (ctx) => {
			const commands = ctx.get(commandsCtx);
			return () => commands.call(wrapInHeadingCommand.key, 6);
		}
	},
	DowngradeHeading: {
		shortcuts: ["Delete", "Backspace"],
		command: (ctx) => {
			const commands = ctx.get(commandsCtx);
			return () => commands.call(downgradeHeadingCommand.key);
		}
	}
});
withMeta(headingKeymap.ctx, {
	displayName: "KeymapCtx<heading>",
	group: "Heading"
});
withMeta(headingKeymap.shortcuts, {
	displayName: "Keymap<heading>",
	group: "Heading"
});
//#endregion
//#region src/node/blockquote.ts
var blockquoteAttr = $nodeAttr("blockquote");
withMeta(blockquoteAttr, {
	displayName: "Attr<blockquote>",
	group: "Blockquote"
});
var blockquoteSchema = $nodeSchema("blockquote", (ctx) => ({
	content: "block+",
	group: "block",
	defining: true,
	parseDOM: [{ tag: "blockquote" }],
	toDOM: (node) => [
		"blockquote",
		ctx.get(blockquoteAttr.key)(node),
		0
	],
	parseMarkdown: {
		match: ({ type }) => type === "blockquote",
		runner: (state, node, type) => {
			state.openNode(type).next(node.children).closeNode();
		}
	},
	toMarkdown: {
		match: (node) => node.type.name === "blockquote",
		runner: (state, node) => {
			state.openNode("blockquote").next(node.content).closeNode();
		}
	}
}));
withMeta(blockquoteSchema.node, {
	displayName: "NodeSchema<blockquote>",
	group: "Blockquote"
});
withMeta(blockquoteSchema.ctx, {
	displayName: "NodeSchemaCtx<blockquote>",
	group: "Blockquote"
});
var wrapInBlockquoteInputRule = $inputRule((ctx) => wrappingInputRule(/^\s*>\s$/, blockquoteSchema.type(ctx)));
withMeta(wrapInBlockquoteInputRule, {
	displayName: "InputRule<wrapInBlockquoteInputRule>",
	group: "Blockquote"
});
var wrapInBlockquoteCommand = $command("WrapInBlockquote", (ctx) => () => wrapIn(blockquoteSchema.type(ctx)));
withMeta(wrapInBlockquoteCommand, {
	displayName: "Command<wrapInBlockquoteCommand>",
	group: "Blockquote"
});
var blockquoteKeymap = $useKeymap("blockquoteKeymap", { WrapInBlockquote: {
	shortcuts: "Mod-Shift-b",
	command: (ctx) => {
		const commands = ctx.get(commandsCtx);
		return () => commands.call(wrapInBlockquoteCommand.key);
	}
} });
withMeta(blockquoteKeymap.ctx, {
	displayName: "KeymapCtx<blockquote>",
	group: "Blockquote"
});
withMeta(blockquoteKeymap.shortcuts, {
	displayName: "Keymap<blockquote>",
	group: "Blockquote"
});
//#endregion
//#region src/node/code-block.ts
var codeBlockAttr = $nodeAttr("codeBlock", () => ({
	pre: {},
	code: {}
}));
withMeta(codeBlockAttr, {
	displayName: "Attr<codeBlock>",
	group: "CodeBlock"
});
var codeBlockSchema = $nodeSchema("code_block", (ctx) => {
	return {
		content: "text*",
		group: "block",
		marks: "",
		defining: true,
		code: true,
		attrs: { language: {
			default: "",
			validate: "string"
		} },
		parseDOM: [{
			tag: "pre",
			preserveWhitespace: "full",
			getAttrs: (dom) => {
				if (!(dom instanceof HTMLElement)) throw expectDomTypeError(dom);
				return { language: dom.dataset.language };
			}
		}],
		toDOM: (node) => {
			const attr = ctx.get(codeBlockAttr.key)(node);
			const language = node.attrs.language;
			const languageAttrs = language && language.length > 0 ? { "data-language": language } : void 0;
			return [
				"pre",
				{
					...attr.pre,
					...languageAttrs
				},
				[
					"code",
					attr.code,
					0
				]
			];
		},
		parseMarkdown: {
			match: ({ type }) => type === "code",
			runner: (state, node, type) => {
				const language = node.lang ?? "";
				const value = node.value;
				state.openNode(type, { language });
				if (value) state.addText(value);
				state.closeNode();
			}
		},
		toMarkdown: {
			match: (node) => node.type.name === "code_block",
			runner: (state, node) => {
				state.addNode("code", void 0, node.content.firstChild?.text || "", { lang: node.attrs.language });
			}
		}
	};
});
withMeta(codeBlockSchema.node, {
	displayName: "NodeSchema<codeBlock>",
	group: "CodeBlock"
});
withMeta(codeBlockSchema.ctx, {
	displayName: "NodeSchemaCtx<codeBlock>",
	group: "CodeBlock"
});
var createCodeBlockInputRule = $inputRule((ctx) => textblockTypeInputRule(/^```(?<language>[a-z]*)?[\s\n]$/, codeBlockSchema.type(ctx), (match) => ({ language: match.groups?.language ?? "" })));
withMeta(createCodeBlockInputRule, {
	displayName: "InputRule<createCodeBlockInputRule>",
	group: "CodeBlock"
});
var createCodeBlockCommand = $command("CreateCodeBlock", (ctx) => (language = "") => setBlockType(codeBlockSchema.type(ctx), { language }));
withMeta(createCodeBlockCommand, {
	displayName: "Command<createCodeBlockCommand>",
	group: "CodeBlock"
});
var updateCodeBlockLanguageCommand = $command("UpdateCodeBlockLanguage", () => ({ pos, language } = {
	pos: -1,
	language: ""
}) => (state, dispatch) => {
	if (pos >= 0) {
		dispatch?.(state.tr.setNodeAttribute(pos, "language", language));
		return true;
	}
	return false;
});
withMeta(updateCodeBlockLanguageCommand, {
	displayName: "Command<updateCodeBlockLanguageCommand>",
	group: "CodeBlock"
});
var codeBlockKeymap = $useKeymap("codeBlockKeymap", { CreateCodeBlock: {
	shortcuts: "Mod-Alt-c",
	command: (ctx) => {
		const commands = ctx.get(commandsCtx);
		return () => commands.call(createCodeBlockCommand.key);
	}
} });
withMeta(codeBlockKeymap.ctx, {
	displayName: "KeymapCtx<codeBlock>",
	group: "CodeBlock"
});
withMeta(codeBlockKeymap.shortcuts, {
	displayName: "Keymap<codeBlock>",
	group: "CodeBlock"
});
//#endregion
//#region src/node/image.ts
var imageAttr = $nodeAttr("image");
withMeta(imageAttr, {
	displayName: "Attr<image>",
	group: "Image"
});
var imageSchema = $nodeSchema("image", (ctx) => {
	return {
		inline: true,
		group: "inline",
		selectable: true,
		draggable: true,
		marks: "",
		atom: true,
		defining: true,
		isolating: true,
		attrs: {
			src: {
				default: "",
				validate: "string"
			},
			alt: {
				default: "",
				validate: "string"
			},
			title: {
				default: "",
				validate: "string"
			}
		},
		parseDOM: [{
			tag: "img[src]",
			getAttrs: (dom) => {
				if (!(dom instanceof HTMLElement)) throw expectDomTypeError(dom);
				return {
					src: dom.getAttribute("src") || "",
					alt: dom.getAttribute("alt") || "",
					title: dom.getAttribute("title") || dom.getAttribute("alt") || ""
				};
			}
		}],
		toDOM: (node) => {
			return ["img", {
				...ctx.get(imageAttr.key)(node),
				...node.attrs
			}];
		},
		parseMarkdown: {
			match: ({ type }) => type === "image",
			runner: (state, node, type) => {
				const url = node.url;
				const alt = node.alt;
				const title = node.title;
				state.addNode(type, {
					src: url,
					alt,
					title
				});
			}
		},
		toMarkdown: {
			match: (node) => node.type.name === "image",
			runner: (state, node) => {
				state.addNode("image", void 0, void 0, {
					title: node.attrs.title,
					url: node.attrs.src,
					alt: node.attrs.alt
				});
			}
		}
	};
});
withMeta(imageSchema.node, {
	displayName: "NodeSchema<image>",
	group: "Image"
});
withMeta(imageSchema.ctx, {
	displayName: "NodeSchemaCtx<image>",
	group: "Image"
});
var insertImageCommand = $command("InsertImage", (ctx) => (payload = {}) => (state, dispatch) => {
	if (!dispatch) return true;
	const { src = "", alt = "", title = "" } = payload;
	const node = imageSchema.type(ctx).create({
		src,
		alt,
		title
	});
	if (!node) return true;
	dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
	return true;
});
withMeta(insertImageCommand, {
	displayName: "Command<insertImageCommand>",
	group: "Image"
});
var updateImageCommand = $command("UpdateImage", (ctx) => (payload = {}) => (state, dispatch) => {
	const nodeWithPos = findSelectedNodeOfType(state.selection, imageSchema.type(ctx));
	if (!nodeWithPos) return false;
	const { node, pos } = nodeWithPos;
	const newAttrs = { ...node.attrs };
	const { src, alt, title } = payload;
	if (src !== void 0) newAttrs.src = src;
	if (alt !== void 0) newAttrs.alt = alt;
	if (title !== void 0) newAttrs.title = title;
	dispatch?.(state.tr.setNodeMarkup(pos, void 0, newAttrs).scrollIntoView());
	return true;
});
withMeta(updateImageCommand, {
	displayName: "Command<updateImageCommand>",
	group: "Image"
});
var insertImageInputRule = $inputRule((ctx) => new InputRule(/!\[(?<alt>.*?)]\((?<filename>.*?)\s*(?="|\))"?(?<title>[^"]+)?"?\)/, (state, match, start, end) => {
	const [matched, alt, src = "", title] = match;
	if (matched) return state.tr.replaceWith(start, end, imageSchema.type(ctx).create({
		src,
		alt,
		title
	}));
	return null;
}));
withMeta(insertImageInputRule, {
	displayName: "InputRule<insertImageInputRule>",
	group: "Image"
});
//#endregion
//#region src/node/hardbreak.ts
var hardbreakAttr = $nodeAttr("hardbreak", (node) => {
	return {
		"data-type": "hardbreak",
		"data-is-inline": node.attrs.isInline
	};
});
withMeta(hardbreakAttr, {
	displayName: "Attr<hardbreak>",
	group: "Hardbreak"
});
var hardbreakSchema = $nodeSchema("hardbreak", (ctx) => ({
	inline: true,
	group: "inline",
	attrs: { isInline: {
		default: false,
		validate: "boolean"
	} },
	selectable: false,
	parseDOM: [{ tag: "br" }, {
		tag: "span[data-type=\"hardbreak\"]",
		getAttrs: () => ({ isInline: true })
	}],
	toDOM: (node) => node.attrs.isInline ? [
		"span",
		ctx.get(hardbreakAttr.key)(node),
		" "
	] : ["br", ctx.get(hardbreakAttr.key)(node)],
	parseMarkdown: {
		match: ({ type }) => type === "break",
		runner: (state, node, type) => {
			state.addNode(type, { isInline: Boolean(node.data?.isInline) });
		}
	},
	leafText: () => "\n",
	toMarkdown: {
		match: (node) => node.type.name === "hardbreak",
		runner: (state, node) => {
			if (node.attrs.isInline) state.addNode("text", void 0, "\n");
			else state.addNode("break");
		}
	}
}));
withMeta(hardbreakSchema.node, {
	displayName: "NodeSchema<hardbreak>",
	group: "Hardbreak"
});
withMeta(hardbreakSchema.ctx, {
	displayName: "NodeSchemaCtx<hardbreak>",
	group: "Hardbreak"
});
var insertHardbreakCommand = $command("InsertHardbreak", (ctx) => () => (state, dispatch) => {
	const { selection, tr } = state;
	if (!(selection instanceof TextSelection)) return false;
	if (selection.empty) {
		const node = selection.$from.node();
		if (node.childCount > 0 && node.lastChild?.type.name === "hardbreak") {
			dispatch?.(tr.replaceRangeWith(selection.to - 1, selection.to, state.schema.node("paragraph")).setSelection(Selection.near(tr.doc.resolve(selection.to))).scrollIntoView());
			return true;
		}
	}
	dispatch?.(tr.setMeta("hardbreak", true).replaceSelectionWith(hardbreakSchema.type(ctx).create()).scrollIntoView());
	return true;
});
withMeta(insertHardbreakCommand, {
	displayName: "Command<insertHardbreakCommand>",
	group: "Hardbreak"
});
var hardbreakKeymap = $useKeymap("hardbreakKeymap", { InsertHardbreak: {
	shortcuts: "Shift-Enter",
	command: (ctx) => {
		const commands = ctx.get(commandsCtx);
		return () => commands.call(insertHardbreakCommand.key);
	}
} });
withMeta(hardbreakKeymap.ctx, {
	displayName: "KeymapCtx<hardbreak>",
	group: "Hardbreak"
});
withMeta(hardbreakKeymap.shortcuts, {
	displayName: "Keymap<hardbreak>",
	group: "Hardbreak"
});
//#endregion
//#region src/node/hr.ts
var hrAttr = $nodeAttr("hr");
withMeta(hrAttr, {
	displayName: "Attr<hr>",
	group: "Hr"
});
var hrSchema = $nodeSchema("hr", (ctx) => ({
	group: "block",
	parseDOM: [{ tag: "hr" }],
	toDOM: (node) => ["hr", ctx.get(hrAttr.key)(node)],
	parseMarkdown: {
		match: ({ type }) => type === "thematicBreak",
		runner: (state, _, type) => {
			state.addNode(type);
		}
	},
	toMarkdown: {
		match: (node) => node.type.name === "hr",
		runner: (state) => {
			state.addNode("thematicBreak");
		}
	}
}));
withMeta(hrSchema.node, {
	displayName: "NodeSchema<hr>",
	group: "Hr"
});
withMeta(hrSchema.ctx, {
	displayName: "NodeSchemaCtx<hr>",
	group: "Hr"
});
var insertHrInputRule = $inputRule((ctx) => new InputRule(/^(?:---|___\s|\*\*\*\s)$/, (state, match, start, end) => {
	const { tr } = state;
	if (match[0]) tr.replaceWith(start - 1, end, hrSchema.type(ctx).create());
	return tr;
}));
withMeta(insertHrInputRule, {
	displayName: "InputRule<insertHrInputRule>",
	group: "Hr"
});
var insertHrCommand = $command("InsertHr", (ctx) => () => (state, dispatch) => {
	if (!dispatch) return true;
	const paragraph = paragraphSchema.node.type(ctx).create();
	const { tr, selection } = state;
	const { from } = selection;
	const node = hrSchema.type(ctx).create();
	if (!node) return true;
	const _tr = tr.replaceSelectionWith(node).insert(from, paragraph);
	const sel = Selection.findFrom(_tr.doc.resolve(from), 1, true);
	if (!sel) return true;
	dispatch(_tr.setSelection(sel).scrollIntoView());
	return true;
});
withMeta(insertHrCommand, {
	displayName: "Command<insertHrCommand>",
	group: "Hr"
});
//#endregion
//#region src/node/bullet-list.ts
var bulletListAttr = $nodeAttr("bulletList");
withMeta(bulletListAttr, {
	displayName: "Attr<bulletList>",
	group: "BulletList"
});
var bulletListSchema = $nodeSchema("bullet_list", (ctx) => {
	return {
		content: "listItem+",
		group: "block",
		attrs: { spread: {
			default: false,
			validate: "boolean"
		} },
		parseDOM: [{
			tag: "ul",
			getAttrs: (dom) => {
				if (!(dom instanceof HTMLElement)) throw expectDomTypeError(dom);
				return { spread: dom.dataset.spread === "true" };
			}
		}],
		toDOM: (node) => {
			return [
				"ul",
				{
					...ctx.get(bulletListAttr.key)(node),
					"data-spread": node.attrs.spread
				},
				0
			];
		},
		parseMarkdown: {
			match: ({ type, ordered }) => type === "list" && !ordered,
			runner: (state, node, type) => {
				const spread = node.spread != null ? `${node.spread}` : "false";
				state.openNode(type, { spread }).next(node.children).closeNode();
			}
		},
		toMarkdown: {
			match: (node) => node.type.name === "bullet_list",
			runner: (state, node) => {
				state.openNode("list", void 0, {
					ordered: false,
					spread: node.attrs.spread
				}).next(node.content).closeNode();
			}
		}
	};
});
withMeta(bulletListSchema.node, {
	displayName: "NodeSchema<bulletList>",
	group: "BulletList"
});
withMeta(bulletListSchema.ctx, {
	displayName: "NodeSchemaCtx<bulletList>",
	group: "BulletList"
});
var wrapInBulletListInputRule = $inputRule((ctx) => wrappingInputRule(/^\s*([-+*])\s$/, bulletListSchema.type(ctx)));
withMeta(wrapInBulletListInputRule, {
	displayName: "InputRule<wrapInBulletListInputRule>",
	group: "BulletList"
});
var wrapInBulletListCommand = $command("WrapInBulletList", (ctx) => () => wrapIn(bulletListSchema.type(ctx)));
withMeta(wrapInBulletListCommand, {
	displayName: "Command<wrapInBulletListCommand>",
	group: "BulletList"
});
var bulletListKeymap = $useKeymap("bulletListKeymap", { WrapInBulletList: {
	shortcuts: "Mod-Alt-8",
	command: (ctx) => {
		const commands = ctx.get(commandsCtx);
		return () => commands.call(wrapInBulletListCommand.key);
	}
} });
withMeta(bulletListKeymap.ctx, {
	displayName: "KeymapCtx<bulletListKeymap>",
	group: "BulletList"
});
withMeta(bulletListKeymap.shortcuts, {
	displayName: "Keymap<bulletListKeymap>",
	group: "BulletList"
});
//#endregion
//#region src/node/ordered-list.ts
var orderedListAttr = $nodeAttr("orderedList");
withMeta(orderedListAttr, {
	displayName: "Attr<orderedList>",
	group: "OrderedList"
});
var orderedListSchema = $nodeSchema("ordered_list", (ctx) => ({
	content: "listItem+",
	group: "block",
	attrs: {
		order: {
			default: 1,
			validate: "number"
		},
		spread: {
			default: false,
			validate: "boolean"
		}
	},
	parseDOM: [{
		tag: "ol",
		getAttrs: (dom) => {
			if (!(dom instanceof HTMLElement)) throw expectDomTypeError(dom);
			return {
				spread: dom.dataset.spread,
				order: dom.hasAttribute("start") ? Number(dom.getAttribute("start")) : 1
			};
		}
	}],
	toDOM: (node) => [
		"ol",
		{
			...ctx.get(orderedListAttr.key)(node),
			...node.attrs.order === 1 ? {} : { start: node.attrs.order },
			"data-spread": node.attrs.spread
		},
		0
	],
	parseMarkdown: {
		match: ({ type, ordered }) => type === "list" && !!ordered,
		runner: (state, node, type) => {
			const spread = node.spread != null ? `${node.spread}` : "true";
			state.openNode(type, {
				spread,
				order: node.start ?? 1
			}).next(node.children).closeNode();
		}
	},
	toMarkdown: {
		match: (node) => node.type.name === "ordered_list",
		runner: (state, node) => {
			state.openNode("list", void 0, {
				ordered: true,
				start: node.attrs.order ?? 1,
				spread: node.attrs.spread === "true"
			});
			state.next(node.content);
			state.closeNode();
		}
	}
}));
withMeta(orderedListSchema.node, {
	displayName: "NodeSchema<orderedList>",
	group: "OrderedList"
});
withMeta(orderedListSchema.ctx, {
	displayName: "NodeSchemaCtx<orderedList>",
	group: "OrderedList"
});
var wrapInOrderedListInputRule = $inputRule((ctx) => wrappingInputRule(/^\s*(\d+)\.\s$/, orderedListSchema.type(ctx), (match) => ({ order: Number(match[1]) }), (match, node) => node.childCount + node.attrs.order === Number(match[1])));
withMeta(wrapInOrderedListInputRule, {
	displayName: "InputRule<wrapInOrderedListInputRule>",
	group: "OrderedList"
});
var wrapInOrderedListCommand = $command("WrapInOrderedList", (ctx) => () => wrapIn(orderedListSchema.type(ctx)));
withMeta(wrapInOrderedListCommand, {
	displayName: "Command<wrapInOrderedListCommand>",
	group: "OrderedList"
});
var orderedListKeymap = $useKeymap("orderedListKeymap", { WrapInOrderedList: {
	shortcuts: "Mod-Alt-7",
	command: (ctx) => {
		const commands = ctx.get(commandsCtx);
		return () => commands.call(wrapInOrderedListCommand.key);
	}
} });
withMeta(orderedListKeymap.ctx, {
	displayName: "KeymapCtx<orderedList>",
	group: "OrderedList"
});
withMeta(orderedListKeymap.shortcuts, {
	displayName: "Keymap<orderedList>",
	group: "OrderedList"
});
//#endregion
//#region src/node/list-item.ts
var listItemAttr = $nodeAttr("listItem");
withMeta(listItemAttr, {
	displayName: "Attr<listItem>",
	group: "ListItem"
});
var listItemSchema = $nodeSchema("list_item", (ctx) => ({
	group: "listItem",
	content: "paragraph block*",
	attrs: {
		label: {
			default: "•",
			validate: "string"
		},
		listType: {
			default: "bullet",
			validate: "string"
		},
		spread: {
			default: true,
			validate: "boolean"
		}
	},
	defining: true,
	parseDOM: [{
		tag: "li",
		getAttrs: (dom) => {
			if (!(dom instanceof HTMLElement)) throw expectDomTypeError(dom);
			return {
				label: dom.dataset.label,
				listType: dom.dataset.listType,
				spread: dom.dataset.spread === "true"
			};
		}
	}],
	toDOM: (node) => [
		"li",
		{
			...ctx.get(listItemAttr.key)(node),
			"data-label": node.attrs.label,
			"data-list-type": node.attrs.listType,
			"data-spread": node.attrs.spread
		},
		0
	],
	parseMarkdown: {
		match: ({ type }) => type === "listItem",
		runner: (state, node, type) => {
			const label = node.label != null ? `${node.label}.` : "•";
			const listType = node.label != null ? "ordered" : "bullet";
			const spread = node.spread != null ? `${node.spread}` : "true";
			state.openNode(type, {
				label,
				listType,
				spread
			});
			state.next(node.children);
			state.closeNode();
		}
	},
	toMarkdown: {
		match: (node) => node.type.name === "list_item",
		runner: (state, node) => {
			state.openNode("listItem", void 0, { spread: node.attrs.spread });
			state.next(node.content);
			state.closeNode();
		}
	}
}));
withMeta(listItemSchema.node, {
	displayName: "NodeSchema<listItem>",
	group: "ListItem"
});
withMeta(listItemSchema.ctx, {
	displayName: "NodeSchemaCtx<listItem>",
	group: "ListItem"
});
var sinkListItemCommand = $command("SinkListItem", (ctx) => () => sinkListItem(listItemSchema.type(ctx)));
withMeta(sinkListItemCommand, {
	displayName: "Command<sinkListItemCommand>",
	group: "ListItem"
});
var liftListItemCommand = $command("LiftListItem", (ctx) => () => liftListItem(listItemSchema.type(ctx)));
withMeta(liftListItemCommand, {
	displayName: "Command<liftListItemCommand>",
	group: "ListItem"
});
var splitListItemCommand = $command("SplitListItem", (ctx) => () => splitListItem(listItemSchema.type(ctx)));
withMeta(splitListItemCommand, {
	displayName: "Command<splitListItemCommand>",
	group: "ListItem"
});
function liftFirstListItem(ctx) {
	return (state, dispatch, view) => {
		const { selection } = state;
		if (!(selection instanceof TextSelection)) return false;
		const { empty, $from } = selection;
		if (!empty || $from.parentOffset !== 0) return false;
		if ($from.node(-1).type !== listItemSchema.type(ctx)) return false;
		return joinBackward(state, dispatch, view);
	};
}
var liftFirstListItemCommand = $command("LiftFirstListItem", (ctx) => () => liftFirstListItem(ctx));
withMeta(liftFirstListItemCommand, {
	displayName: "Command<liftFirstListItemCommand>",
	group: "ListItem"
});
var listItemKeymap = $useKeymap("listItemKeymap", {
	NextListItem: {
		shortcuts: "Enter",
		command: (ctx) => {
			const commands = ctx.get(commandsCtx);
			return () => commands.call(splitListItemCommand.key);
		}
	},
	SinkListItem: {
		shortcuts: ["Tab", "Mod-]"],
		command: (ctx) => {
			const commands = ctx.get(commandsCtx);
			return () => commands.call(sinkListItemCommand.key);
		}
	},
	LiftListItem: {
		shortcuts: ["Shift-Tab", "Mod-["],
		command: (ctx) => {
			const commands = ctx.get(commandsCtx);
			return () => commands.call(liftListItemCommand.key);
		}
	},
	LiftFirstListItem: {
		shortcuts: ["Backspace", "Delete"],
		command: (ctx) => {
			const commands = ctx.get(commandsCtx);
			return () => commands.call(liftFirstListItemCommand.key);
		}
	}
});
withMeta(listItemKeymap.ctx, {
	displayName: "KeymapCtx<listItem>",
	group: "ListItem"
});
withMeta(listItemKeymap.shortcuts, {
	displayName: "Keymap<listItem>",
	group: "ListItem"
});
//#endregion
//#region src/node/text.ts
var textSchema = $node("text", () => ({
	group: "inline",
	parseMarkdown: {
		match: ({ type }) => type === "text",
		runner: (state, node) => {
			state.addText(node.value);
		}
	},
	toMarkdown: {
		match: (node) => node.type.name === "text",
		runner: (state, node) => {
			state.addNode("text", void 0, node.text);
		}
	}
}));
withMeta(textSchema, {
	displayName: "NodeSchema<text>",
	group: "Text"
});
//#endregion
//#region src/node/html.ts
var htmlAttr = $nodeAttr("html");
withMeta(htmlAttr, {
	displayName: "Attr<html>",
	group: "Html"
});
var htmlSchema = $nodeSchema("html", (ctx) => {
	return {
		atom: true,
		group: "inline",
		inline: true,
		attrs: { value: {
			default: "",
			validate: "string"
		} },
		toDOM: (node) => {
			const span = document.createElement("span");
			const attr = {
				...ctx.get(htmlAttr.key)(node),
				"data-value": node.attrs.value,
				"data-type": "html"
			};
			span.textContent = node.attrs.value;
			return [
				"span",
				attr,
				node.attrs.value
			];
		},
		parseDOM: [{
			tag: "span[data-type=\"html\"]",
			getAttrs: (dom) => {
				return { value: dom.dataset.value ?? "" };
			}
		}],
		parseMarkdown: {
			match: ({ type }) => Boolean(type === "html"),
			runner: (state, node, type) => {
				state.addNode(type, { value: node.value });
			}
		},
		toMarkdown: {
			match: (node) => node.type.name === "html",
			runner: (state, node) => {
				state.addNode("html", void 0, node.attrs.value);
			}
		}
	};
});
withMeta(htmlSchema.node, {
	displayName: "NodeSchema<html>",
	group: "Html"
});
withMeta(htmlSchema.ctx, {
	displayName: "NodeSchemaCtx<html>",
	group: "Html"
});
//#endregion
//#region src/composed/schema.ts
var schema = [
	docSchema,
	paragraphAttr,
	paragraphSchema,
	headingIdGenerator,
	headingAttr,
	headingSchema,
	hardbreakAttr,
	hardbreakSchema,
	blockquoteAttr,
	blockquoteSchema,
	codeBlockAttr,
	codeBlockSchema,
	hrAttr,
	hrSchema,
	imageAttr,
	imageSchema,
	bulletListAttr,
	bulletListSchema,
	orderedListAttr,
	orderedListSchema,
	listItemAttr,
	listItemSchema,
	emphasisAttr,
	emphasisSchema,
	strongAttr,
	strongSchema,
	inlineCodeAttr,
	inlineCodeSchema,
	linkAttr,
	linkSchema,
	htmlAttr,
	htmlSchema,
	textSchema
].flat();
//#endregion
//#region src/composed/inputrules.ts
var inputRules = [
	wrapInBlockquoteInputRule,
	wrapInBulletListInputRule,
	wrapInOrderedListInputRule,
	createCodeBlockInputRule,
	insertHrInputRule,
	wrapInHeadingInputRule
].flat();
var markInputRules = [
	emphasisStarInputRule,
	emphasisUnderscoreInputRule,
	inlineCodeInputRule,
	strongInputRule
];
//#endregion
//#region src/commands/index.ts
var isMarkSelectedCommand = $command("IsMarkSelected", () => (markType) => (state) => {
	if (!markType) return false;
	const { doc, selection } = state;
	return doc.rangeHasMark(selection.from, selection.to, markType);
});
var isNodeSelectedCommand = $command("IsNoteSelected", () => (nodeType) => (state) => {
	if (!nodeType) return false;
	return findNodeInSelection(state, nodeType).hasNode;
});
var clearTextInCurrentBlockCommand = $command("ClearTextInCurrentBlock", () => () => (state, dispatch) => {
	let tr = state.tr;
	const { $from, $to } = tr.selection;
	const { pos: from } = $from;
	const { pos: right } = $to;
	const left = from - $from.node().content.size;
	if (left < 0) return false;
	tr = tr.deleteRange(left, right);
	dispatch?.(tr);
	return true;
});
var setBlockTypeCommand = $command("SetBlockType", () => (payload) => (state, dispatch) => {
	const { nodeType, attrs = null } = payload ?? {};
	if (!nodeType) return false;
	const tr = state.tr;
	const { from, to } = tr.selection;
	try {
		tr.setBlockType(from, to, nodeType, attrs);
	} catch {
		return false;
	}
	dispatch?.(tr);
	return true;
});
var wrapInBlockTypeCommand = $command("WrapInBlockType", () => (payload) => (state, dispatch) => {
	const { nodeType, attrs = null } = payload ?? {};
	if (!nodeType) return false;
	let tr = state.tr;
	try {
		const { $from, $to } = tr.selection;
		const blockRange = $from.blockRange($to);
		const wrapping = blockRange && findWrapping(blockRange, nodeType, attrs);
		if (!wrapping) return false;
		tr = tr.wrap(blockRange, wrapping);
	} catch {
		return false;
	}
	dispatch?.(tr);
	return true;
});
var addBlockTypeCommand = $command("AddBlockType", () => (payload) => (state, dispatch) => {
	const { nodeType, attrs = null } = payload ?? {};
	if (!nodeType) return false;
	const tr = state.tr;
	try {
		const node = nodeType instanceof Node ? nodeType : nodeType.createAndFill(attrs);
		if (!node) return false;
		tr.replaceSelectionWith(node);
	} catch {
		return false;
	}
	dispatch?.(tr);
	return true;
});
var selectTextNearPosCommand = $command("SelectTextNearPos", () => (payload) => (state, dispatch) => {
	const { pos } = payload ?? {};
	if (pos == null) return false;
	const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
	const tr = state.tr;
	try {
		const $pos = state.doc.resolve(clamp(pos, 0, state.doc.content.size));
		tr.setSelection(TextSelection.near($pos));
	} catch {
		return false;
	}
	dispatch?.(tr.scrollIntoView());
	return true;
});
//#endregion
//#region src/composed/commands.ts
var commands = [
	turnIntoTextCommand,
	wrapInBlockquoteCommand,
	wrapInHeadingCommand,
	downgradeHeadingCommand,
	createCodeBlockCommand,
	insertHardbreakCommand,
	insertHrCommand,
	insertImageCommand,
	updateImageCommand,
	wrapInOrderedListCommand,
	wrapInBulletListCommand,
	sinkListItemCommand,
	splitListItemCommand,
	liftListItemCommand,
	liftFirstListItemCommand,
	toggleEmphasisCommand,
	toggleInlineCodeCommand,
	toggleStrongCommand,
	toggleLinkCommand,
	updateLinkCommand,
	isMarkSelectedCommand,
	isNodeSelectedCommand,
	clearTextInCurrentBlockCommand,
	setBlockTypeCommand,
	wrapInBlockTypeCommand,
	addBlockTypeCommand,
	selectTextNearPosCommand
];
//#endregion
//#region src/composed/keymap.ts
var keymap = [
	blockquoteKeymap,
	codeBlockKeymap,
	hardbreakKeymap,
	headingKeymap,
	listItemKeymap,
	orderedListKeymap,
	bulletListKeymap,
	paragraphKeymap,
	emphasisKeymap,
	inlineCodeKeymap,
	strongKeymap
].flat();
//#endregion
//#region src/plugin/remark-add-order-in-list-plugin.ts
var remarkAddOrderInListPlugin = $remark("remarkAddOrderInList", () => () => (tree) => {
	visit(tree, "list", (node) => {
		if (node.ordered) {
			const start = node.start ?? 1;
			node.children.forEach((child, index) => {
				child.label = index + start;
			});
		}
	});
});
withMeta(remarkAddOrderInListPlugin.plugin, {
	displayName: "Remark<remarkAddOrderInListPlugin>",
	group: "Remark"
});
withMeta(remarkAddOrderInListPlugin.options, {
	displayName: "RemarkConfig<remarkAddOrderInListPlugin>",
	group: "Remark"
});
//#endregion
//#region src/plugin/remark-line-break.ts
var remarkLineBreak = $remark("remarkLineBreak", () => () => (tree) => {
	const find = /[\t ]*(?:\r?\n|\r)/g;
	visit(tree, "text", (node, index, parent) => {
		if (!node.value || typeof node.value !== "string") return;
		const result = [];
		let start = 0;
		find.lastIndex = 0;
		let match = find.exec(node.value);
		while (match) {
			const position = match.index;
			if (start !== position) result.push({
				type: "text",
				value: node.value.slice(start, position)
			});
			result.push({
				type: "break",
				data: { isInline: true }
			});
			start = position + match[0].length;
			match = find.exec(node.value);
		}
		if (!(result.length > 0 && parent && typeof index === "number")) return;
		if (start < node.value.length) result.push({
			type: "text",
			value: node.value.slice(start)
		});
		parent.children.splice(index, 1, ...result);
		return index + result.length;
	});
});
withMeta(remarkLineBreak.plugin, {
	displayName: "Remark<remarkLineBreak>",
	group: "Remark"
});
withMeta(remarkLineBreak.options, {
	displayName: "RemarkConfig<remarkLineBreak>",
	group: "Remark"
});
//#endregion
//#region src/plugin/remark-inline-link-plugin.ts
var remarkInlineLinkPlugin = $remark("remarkInlineLink", () => remarkInlineLinks);
withMeta(remarkInlineLinkPlugin.plugin, {
	displayName: "Remark<remarkInlineLinkPlugin>",
	group: "Remark"
});
withMeta(remarkInlineLinkPlugin.options, {
	displayName: "RemarkConfig<remarkInlineLinkPlugin>",
	group: "Remark"
});
//#endregion
//#region src/plugin/remark-html-transformer.ts
var isParent = (node) => !!node.children;
var isHTML = (node) => node.type === "html";
function flatMapWithDepth(ast, fn) {
	return transform(ast, 0, null)[0];
	function transform(node, index, parent) {
		if (isParent(node)) {
			const out = [];
			for (let i = 0, n = node.children.length; i < n; i++) {
				const nthChild = node.children[i];
				if (nthChild) {
					const xs = transform(nthChild, i, node);
					if (xs) for (let j = 0, m = xs.length; j < m; j++) {
						const item = xs[j];
						if (item) out.push(item);
					}
				}
			}
			node.children = out;
		}
		return fn(node, index, parent);
	}
}
var BLOCK_CONTAINER_TYPES = [
	"root",
	"blockquote",
	"listItem"
];
var remarkHtmlTransformer = $remark("remarkHTMLTransformer", () => () => (tree) => {
	flatMapWithDepth(tree, (node, _index, parent) => {
		if (!isHTML(node)) return [node];
		if (parent && BLOCK_CONTAINER_TYPES.includes(parent.type)) {
			node.children = [{ ...node }];
			delete node.value;
			node.type = "paragraph";
		}
		return [node];
	});
});
withMeta(remarkHtmlTransformer.plugin, {
	displayName: "Remark<remarkHtmlTransformer>",
	group: "Remark"
});
withMeta(remarkHtmlTransformer.options, {
	displayName: "RemarkConfig<remarkHtmlTransformer>",
	group: "Remark"
});
//#endregion
//#region src/plugin/remark-marker-plugin.ts
var remarkMarker = $remark("remarkMarker", () => () => (tree, file) => {
	const getMarker = (node) => {
		return file.value.charAt(node.position.start.offset);
	};
	visit(tree, (node) => ["strong", "emphasis"].includes(node.type), (node) => {
		node.marker = getMarker(node);
	});
});
withMeta(remarkMarker.plugin, {
	displayName: "Remark<remarkMarker>",
	group: "Remark"
});
withMeta(remarkMarker.options, {
	displayName: "RemarkConfig<remarkMarker>",
	group: "Remark"
});
//#endregion
//#region src/plugin/inline-nodes-cursor-plugin.ts
var inlineNodesCursorPlugin = $prose(() => {
	let lock = false;
	const inlineNodesCursorPlugin = new Plugin({
		key: new PluginKey("MILKDOWN_INLINE_NODES_CURSOR"),
		state: {
			init() {
				return false;
			},
			apply(tr) {
				if (!tr.selection.empty) return false;
				const pos = tr.selection.$from;
				const left = pos.nodeBefore;
				const right = pos.nodeAfter;
				if (left && right && left.isInline && !left.isText && right.isInline && !right.isText) return true;
				return false;
			}
		},
		props: {
			handleDOMEvents: {
				compositionend: (view, e) => {
					if (lock) {
						lock = false;
						requestAnimationFrame(() => {
							if (inlineNodesCursorPlugin.getState(view.state)) {
								const from = view.state.selection.from;
								e.preventDefault();
								view.dispatch(view.state.tr.insertText(e.data || "", from));
							}
						});
						return true;
					}
					return false;
				},
				compositionstart: (view) => {
					if (inlineNodesCursorPlugin.getState(view.state)) lock = true;
					return false;
				},
				beforeinput: (view, e) => {
					if (inlineNodesCursorPlugin.getState(view.state) && e instanceof InputEvent && e.data && !lock) {
						const from = view.state.selection.from;
						e.preventDefault();
						view.dispatch(view.state.tr.insertText(e.data || "", from));
						return true;
					}
					return false;
				}
			},
			decorations(state) {
				if (inlineNodesCursorPlugin.getState(state)) {
					const position = state.selection.$from.pos;
					const left = document.createElement("span");
					const leftDec = Decoration.widget(position, left, { side: -1 });
					const right = document.createElement("span");
					const rightDec = Decoration.widget(position, right);
					setTimeout(() => {
						left.contentEditable = "true";
						right.contentEditable = "true";
					});
					return DecorationSet.create(state.doc, [leftDec, rightDec]);
				}
				return DecorationSet.empty;
			}
		}
	});
	return inlineNodesCursorPlugin;
});
withMeta(inlineNodesCursorPlugin, {
	displayName: "Prose<inlineNodesCursorPlugin>",
	group: "Prose"
});
//#endregion
//#region src/plugin/hardbreak-clear-mark-plugin.ts
var hardbreakClearMarkPlugin = $prose((ctx) => {
	return new Plugin({
		key: new PluginKey("MILKDOWN_HARDBREAK_MARKS"),
		appendTransaction: (trs, _oldState, newState) => {
			if (!trs.length) return;
			const [tr] = trs;
			if (!tr) return;
			const [step] = tr.steps;
			if (tr.getMeta("hardbreak")) {
				if (!(step instanceof ReplaceStep)) return;
				const { from } = step;
				return newState.tr.setNodeMarkup(from, hardbreakSchema.type(ctx), void 0, []);
			}
			if (step instanceof AddMarkStep) {
				let _tr = newState.tr;
				const { from, to } = step;
				newState.doc.nodesBetween(from, to, (node, pos) => {
					if (node.type === hardbreakSchema.type(ctx)) _tr = _tr.setNodeMarkup(pos, hardbreakSchema.type(ctx), void 0, []);
				});
				return _tr;
			}
		}
	});
});
withMeta(hardbreakClearMarkPlugin, {
	displayName: "Prose<hardbreakClearMarkPlugin>",
	group: "Prose"
});
//#endregion
//#region src/plugin/hardbreak-filter-plugin.ts
var hardbreakFilterNodes = $ctx(["table", "code_block"], "hardbreakFilterNodes");
withMeta(hardbreakFilterNodes, {
	displayName: "Ctx<hardbreakFilterNodes>",
	group: "Prose"
});
var hardbreakFilterPlugin = $prose((ctx) => {
	const notIn = ctx.get(hardbreakFilterNodes.key);
	return new Plugin({
		key: new PluginKey("MILKDOWN_HARDBREAK_FILTER"),
		filterTransaction: (tr, state) => {
			const isInsertHr = tr.getMeta("hardbreak");
			const [step] = tr.steps;
			if (isInsertHr && step) {
				const { from } = step;
				const $from = state.doc.resolve(from);
				let curDepth = $from.depth;
				let canApply = true;
				while (curDepth > 0) {
					if (notIn.includes($from.node(curDepth).type.name)) canApply = false;
					curDepth--;
				}
				return canApply;
			}
			return true;
		}
	});
});
withMeta(hardbreakFilterPlugin, {
	displayName: "Prose<hardbreakFilterPlugin>",
	group: "Prose"
});
//#endregion
//#region src/plugin/sync-heading-id-plugin.ts
var syncHeadingIdPlugin = $prose((ctx) => {
	const headingIdPluginKey = new PluginKey("MILKDOWN_HEADING_ID");
	const updateId = (view) => {
		if (view.composing) return;
		const getId = ctx.get(headingIdGenerator.key);
		const tr = view.state.tr.setMeta("addToHistory", false);
		let found = false;
		const idMap = {};
		view.state.doc.descendants((node, pos) => {
			if (node.type === headingSchema.type(ctx)) {
				if (node.textContent.trim().length === 0) return;
				const attrs = node.attrs;
				let id = getId(node);
				if (idMap[id]) {
					idMap[id] += 1;
					id += `-#${idMap[id]}`;
				} else idMap[id] = 1;
				if (attrs.id !== id) {
					found = true;
					tr.setMeta(headingIdPluginKey, true).setNodeMarkup(pos, void 0, {
						...attrs,
						id
					});
				}
			}
		});
		if (found) view.dispatch(tr);
	};
	return new Plugin({
		key: headingIdPluginKey,
		view: (view) => {
			updateId(view);
			return { update: (view, prevState) => {
				if (view.state.doc.eq(prevState.doc)) return;
				updateId(view);
			} };
		}
	});
});
withMeta(syncHeadingIdPlugin, {
	displayName: "Prose<syncHeadingIdPlugin>",
	group: "Prose"
});
//#endregion
//#region src/plugin/sync-list-order-plugin.ts
var syncListOrderPlugin = $prose((ctx) => {
	const syncOrderLabel = (transactions, _oldState, newState) => {
		if (!newState.selection || transactions.some((tr) => tr.getMeta("addToHistory") === false || !tr.isGeneric)) return null;
		const orderedListType = orderedListSchema.type(ctx);
		const bulletListType = bulletListSchema.type(ctx);
		const listItemType = listItemSchema.type(ctx);
		const handleNodeItem = (attrs, index, order = 1) => {
			let changed = false;
			const expectedLabel = `${index + order}.`;
			if (attrs.label !== expectedLabel) {
				attrs.label = expectedLabel;
				changed = true;
			}
			return changed;
		};
		let tr = newState.tr;
		let needDispatch = false;
		newState.doc.descendants((node, pos, parent, index) => {
			if (node.type === bulletListType) {
				const base = node.maybeChild(0);
				if (base?.type === listItemType && base.attrs.listType === "ordered") {
					needDispatch = true;
					tr.setNodeMarkup(pos, orderedListType, { spread: "true" });
					node.descendants((child, pos, _parent, index) => {
						if (child.type === listItemType) {
							const attrs = { ...child.attrs };
							if (handleNodeItem(attrs, index)) tr = tr.setNodeMarkup(pos, void 0, attrs);
						}
						return false;
					});
				}
			} else if (node.type === listItemType && parent?.type === orderedListType) {
				const attrs = { ...node.attrs };
				let changed = false;
				if (attrs.listType !== "ordered") {
					attrs.listType = "ordered";
					changed = true;
				}
				if (parent?.maybeChild(0)) changed = handleNodeItem(attrs, index, parent?.attrs.order ?? 1);
				if (changed) {
					tr = tr.setNodeMarkup(pos, void 0, attrs);
					needDispatch = true;
				}
			}
		});
		return needDispatch ? tr.setMeta("addToHistory", false) : null;
	};
	return new Plugin({
		key: new PluginKey("MILKDOWN_KEEP_LIST_ORDER"),
		appendTransaction: syncOrderLabel
	});
});
withMeta(syncListOrderPlugin, {
	displayName: "Prose<syncListOrderPlugin>",
	group: "Prose"
});
//#endregion
//#region src/composed/plugins.ts
var plugins = [
	hardbreakClearMarkPlugin,
	hardbreakFilterNodes,
	hardbreakFilterPlugin,
	inlineNodesCursorPlugin,
	remarkAddOrderInListPlugin,
	remarkInlineLinkPlugin,
	remarkLineBreak,
	remarkHtmlTransformer,
	remarkMarker,
	remarkPreserveEmptyLinePlugin,
	syncHeadingIdPlugin,
	syncListOrderPlugin
].flat();
//#endregion
//#region src/index.ts
var commonmark = [
	schema,
	inputRules,
	markInputRules,
	commands,
	keymap,
	plugins
].flat();
//#endregion
export { addBlockTypeCommand, blockquoteAttr, blockquoteKeymap, blockquoteSchema, bulletListAttr, bulletListKeymap, bulletListSchema, clearTextInCurrentBlockCommand, codeBlockAttr, codeBlockKeymap, codeBlockSchema, commands, commonmark, createCodeBlockCommand, createCodeBlockInputRule, docSchema, downgradeHeadingCommand, emphasisAttr, emphasisKeymap, emphasisSchema, emphasisStarInputRule, emphasisUnderscoreInputRule, hardbreakAttr, hardbreakClearMarkPlugin, hardbreakFilterNodes, hardbreakFilterPlugin, hardbreakKeymap, hardbreakSchema, headingAttr, headingIdGenerator, headingKeymap, headingSchema, hrAttr, hrSchema, htmlAttr, htmlSchema, imageAttr, imageSchema, inlineCodeAttr, inlineCodeInputRule, inlineCodeKeymap, inlineCodeSchema, inlineNodesCursorPlugin, inputRules, insertHardbreakCommand, insertHrCommand, insertHrInputRule, insertImageCommand, insertImageInputRule, isMarkSelectedCommand, isNodeSelectedCommand, keymap, liftFirstListItemCommand, liftListItemCommand, linkAttr, linkSchema, listItemAttr, listItemKeymap, listItemSchema, markInputRules, orderedListAttr, orderedListKeymap, orderedListSchema, paragraphAttr, paragraphKeymap, paragraphSchema, plugins, remarkAddOrderInListPlugin, remarkHtmlTransformer, remarkInlineLinkPlugin, remarkLineBreak, remarkMarker, remarkPreserveEmptyLinePlugin, schema, selectTextNearPosCommand, setBlockTypeCommand, sinkListItemCommand, splitListItemCommand, strongAttr, strongInputRule, strongKeymap, strongSchema, syncHeadingIdPlugin, syncListOrderPlugin, textSchema, toggleEmphasisCommand, toggleInlineCodeCommand, toggleLinkCommand, toggleStrongCommand, turnIntoTextCommand, updateCodeBlockLanguageCommand, updateImageCommand, updateLinkCommand, wrapInBlockTypeCommand, wrapInBlockquoteCommand, wrapInBlockquoteInputRule, wrapInBulletListCommand, wrapInBulletListInputRule, wrapInHeadingCommand, wrapInHeadingInputRule, wrapInOrderedListCommand, wrapInOrderedListInputRule };

//# sourceMappingURL=index.js.map