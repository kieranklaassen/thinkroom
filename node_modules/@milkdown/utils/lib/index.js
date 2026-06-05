import { CommandsReady, InitReady, KeymapReady, SchemaReady, commandsCtx, commandsTimerCtx, createCmdKey, editorStateOptionsCtx, editorStateTimerCtx, editorViewCtx, editorViewTimerCtx, inputRulesCtx, keymapCtx, markViewCtx, marksCtx, nodeViewCtx, nodesCtx, parserCtx, pasteRulesCtx, pasteRulesTimerCtx, prosePluginsCtx, remarkPluginsCtx, schemaCtx, schemaTimerCtx, serializerCtx } from "@milkdown/core";
import { createSlice, createTimer } from "@milkdown/ctx";
import { customAlphabet } from "nanoid";
import { missingMarkInSchema, missingNodeInSchema } from "@milkdown/exception";
import { DOMParser, DOMSerializer, NodeType, Slice } from "@milkdown/prose/model";
import { isTextOnlySlice } from "@milkdown/prose";
import { EditorState } from "@milkdown/prose/state";
//#region src/composable/utils.ts
var nanoid = customAlphabet("abcedfghicklmn", 10);
function addTimer(runner, injectTo, timerName) {
	const timer = createTimer(timerName || nanoid());
	let doneCalled = false;
	const plugin = (ctx) => {
		ctx.record(timer);
		ctx.update(injectTo, (x) => x.concat(timer));
		return async () => {
			const done = () => {
				ctx.done(timer);
				doneCalled = true;
			};
			const cleanup = await runner(ctx, plugin, done);
			if (!doneCalled) ctx.done(timer);
			return () => {
				ctx.update(injectTo, (x) => x.filter((y) => y !== timer));
				ctx.clearTimer(timer);
				if (cleanup) {
					const result = cleanup();
					if (result && "then" in result) result.catch(console.error);
				}
			};
		};
	};
	plugin.timer = timer;
	return plugin;
}
//#endregion
//#region src/composable/$command.ts
function $command(key, cmd) {
	const cmdKey = createCmdKey(key);
	const plugin = (ctx) => async () => {
		plugin.key = cmdKey;
		await ctx.wait(CommandsReady);
		const command = cmd(ctx);
		ctx.get(commandsCtx).create(cmdKey, command);
		plugin.run = (payload) => ctx.get(commandsCtx).call(key, payload);
		return () => {
			ctx.get(commandsCtx).remove(cmdKey);
		};
	};
	return plugin;
}
function $commandAsync(key, cmd, timerName) {
	const cmdKey = createCmdKey(key);
	return addTimer(async (ctx, plugin) => {
		await ctx.wait(CommandsReady);
		const command = await cmd(ctx);
		ctx.get(commandsCtx).create(cmdKey, command);
		plugin.run = (payload) => ctx.get(commandsCtx).call(key, payload);
		plugin.key = cmdKey;
		return () => {
			ctx.get(commandsCtx).remove(cmdKey);
		};
	}, commandsTimerCtx, timerName);
}
//#endregion
//#region src/composable/$input-rule.ts
function $inputRule(inputRule) {
	const plugin = (ctx) => async () => {
		await ctx.wait(SchemaReady);
		const ir = inputRule(ctx);
		ctx.update(inputRulesCtx, (irs) => [...irs, ir]);
		plugin.inputRule = ir;
		return () => {
			ctx.update(inputRulesCtx, (irs) => irs.filter((x) => x !== ir));
		};
	};
	return plugin;
}
function $inputRuleAsync(inputRule, timerName) {
	return addTimer(async (ctx, plugin) => {
		await ctx.wait(SchemaReady);
		const ir = await inputRule(ctx);
		ctx.update(inputRulesCtx, (irs) => [...irs, ir]);
		plugin.inputRule = ir;
		return () => {
			ctx.update(inputRulesCtx, (irs) => irs.filter((x) => x !== ir));
		};
	}, editorStateTimerCtx, timerName);
}
//#endregion
//#region src/composable/$paste-rule.ts
function $pasteRule(pasteRule) {
	const plugin = (ctx) => async () => {
		await ctx.wait(SchemaReady);
		const pr = pasteRule(ctx);
		ctx.update(pasteRulesCtx, (prs) => [...prs, pr]);
		plugin.pasteRule = pr;
		return () => {
			ctx.update(pasteRulesCtx, (prs) => prs.filter((x) => x !== pr));
		};
	};
	return plugin;
}
function $pasteRuleAsync(pasteRule, timerName) {
	return addTimer(async (ctx, plugin) => {
		await ctx.wait(SchemaReady);
		const pr = await pasteRule(ctx);
		ctx.update(pasteRulesCtx, (prs) => [...prs, pr]);
		plugin.pasteRule = pr;
		return () => {
			ctx.update(pasteRulesCtx, (prs) => prs.filter((x) => x !== pr));
		};
	}, pasteRulesTimerCtx, timerName);
}
//#endregion
//#region src/composable/$mark.ts
function $mark(id, schema) {
	const plugin = (ctx) => async () => {
		const markSchema = schema(ctx);
		ctx.update(marksCtx, (ns) => [...ns.filter((n) => n[0] !== id), [id, markSchema]]);
		plugin.id = id;
		plugin.schema = markSchema;
		return () => {
			ctx.update(marksCtx, (ns) => ns.filter(([x]) => x !== id));
		};
	};
	plugin.type = (ctx) => {
		const markType = ctx.get(schemaCtx).marks[id];
		if (!markType) throw missingMarkInSchema(id);
		return markType;
	};
	return plugin;
}
function $markAsync(id, schema, timerName) {
	const plugin = addTimer(async (ctx, plugin, done) => {
		const markSchema = await schema(ctx);
		ctx.update(marksCtx, (ns) => [...ns.filter((n) => n[0] !== id), [id, markSchema]]);
		plugin.id = id;
		plugin.schema = markSchema;
		done();
		return () => {
			ctx.update(marksCtx, (ns) => ns.filter(([x]) => x !== id));
		};
	}, schemaTimerCtx, timerName);
	plugin.type = (ctx) => {
		const markType = ctx.get(schemaCtx).marks[id];
		if (!markType) throw missingMarkInSchema(id);
		return markType;
	};
	return plugin;
}
//#endregion
//#region src/composable/$node.ts
function $node(id, schema) {
	const plugin = (ctx) => async () => {
		const nodeSchema = schema(ctx);
		ctx.update(nodesCtx, (ns) => [...ns.filter((n) => n[0] !== id), [id, nodeSchema]]);
		plugin.id = id;
		plugin.schema = nodeSchema;
		return () => {
			ctx.update(nodesCtx, (ns) => ns.filter(([x]) => x !== id));
		};
	};
	plugin.type = (ctx) => {
		const nodeType = ctx.get(schemaCtx).nodes[id];
		if (!nodeType) throw missingNodeInSchema(id);
		return nodeType;
	};
	return plugin;
}
function $nodeAsync(id, schema, timerName) {
	const plugin = addTimer(async (ctx, plugin, done) => {
		const nodeSchema = await schema(ctx);
		ctx.update(nodesCtx, (ns) => [...ns.filter((n) => n[0] !== id), [id, nodeSchema]]);
		plugin.id = id;
		plugin.schema = nodeSchema;
		done();
		return () => {
			ctx.update(nodesCtx, (ns) => ns.filter(([x]) => x !== id));
		};
	}, schemaTimerCtx, timerName);
	plugin.type = (ctx) => {
		const nodeType = ctx.get(schemaCtx).nodes[id];
		if (!nodeType) throw missingNodeInSchema(id);
		return nodeType;
	};
	return plugin;
}
//#endregion
//#region src/composable/$prose.ts
function $prose(prose) {
	let prosePlugin;
	const plugin = (ctx) => async () => {
		await ctx.wait(SchemaReady);
		prosePlugin = prose(ctx);
		ctx.update(prosePluginsCtx, (ps) => [...ps, prosePlugin]);
		return () => {
			ctx.update(prosePluginsCtx, (ps) => ps.filter((x) => x !== prosePlugin));
		};
	};
	plugin.plugin = () => prosePlugin;
	plugin.key = () => prosePlugin.spec.key;
	return plugin;
}
function $proseAsync(prose, timerName) {
	let prosePlugin;
	const plugin = addTimer(async (ctx) => {
		await ctx.wait(SchemaReady);
		prosePlugin = await prose(ctx);
		ctx.update(prosePluginsCtx, (ps) => [...ps, prosePlugin]);
		return () => {
			ctx.update(prosePluginsCtx, (ps) => ps.filter((x) => x !== prosePlugin));
		};
	}, editorStateTimerCtx, timerName);
	plugin.plugin = () => prosePlugin;
	plugin.key = () => prosePlugin.spec.key;
	return plugin;
}
//#endregion
//#region src/composable/$shortcut.ts
function $shortcut(shortcut) {
	const plugin = (ctx) => async () => {
		await ctx.wait(KeymapReady);
		const km = ctx.get(keymapCtx);
		const keymap = shortcut(ctx);
		const dispose = km.addObjectKeymap(keymap);
		plugin.keymap = keymap;
		return () => {
			dispose();
		};
	};
	return plugin;
}
function $shortcutAsync(shortcut, timerName) {
	return addTimer(async (ctx, plugin) => {
		await ctx.wait(KeymapReady);
		const km = ctx.get(keymapCtx);
		const keymap = await shortcut(ctx);
		const dispose = km.addObjectKeymap(keymap);
		plugin.keymap = keymap;
		return () => {
			dispose();
		};
	}, editorStateTimerCtx, timerName);
}
//#endregion
//#region src/composable/$view.ts
function $view(type, view) {
	const plugin = (ctx) => async () => {
		await ctx.wait(SchemaReady);
		const v = view(ctx);
		if (type.type(ctx) instanceof NodeType) ctx.update(nodeViewCtx, (ps) => [...ps, [type.id, v]]);
		else ctx.update(markViewCtx, (ps) => [...ps, [type.id, v]]);
		plugin.view = v;
		plugin.type = type;
		return () => {
			if (type.type(ctx) instanceof NodeType) ctx.update(nodeViewCtx, (ps) => ps.filter((x) => x[0] !== type.id));
			else ctx.update(markViewCtx, (ps) => ps.filter((x) => x[0] !== type.id));
		};
	};
	return plugin;
}
function $viewAsync(type, view, timerName) {
	return addTimer(async (ctx, plugin) => {
		await ctx.wait(SchemaReady);
		const v = await view(ctx);
		if (type.type(ctx) instanceof NodeType) ctx.update(nodeViewCtx, (ps) => [...ps, [type.id, v]]);
		else ctx.update(markViewCtx, (ps) => [...ps, [type.id, v]]);
		plugin.view = v;
		plugin.type = type;
		return () => {
			if (type.type(ctx) instanceof NodeType) ctx.update(nodeViewCtx, (ps) => ps.filter((x) => x[0] !== type.id));
			else ctx.update(markViewCtx, (ps) => ps.filter((x) => x[0] !== type.id));
		};
	}, editorViewTimerCtx, timerName);
}
//#endregion
//#region src/composable/$ctx.ts
function $ctx(value, name) {
	const slice = createSlice(value, name);
	const plugin = (ctx) => {
		ctx.inject(slice);
		return () => {
			return () => {
				ctx.remove(slice);
			};
		};
	};
	plugin.key = slice;
	return plugin;
}
//#endregion
//#region src/composable/composed/$node-schema.ts
function $nodeSchema(id, schema) {
	const schemaCtx = $ctx(schema, id);
	const nodeSchema = $node(id, (ctx) => {
		return ctx.get(schemaCtx.key)(ctx);
	});
	const result = [schemaCtx, nodeSchema];
	result.id = nodeSchema.id;
	result.node = nodeSchema;
	result.type = (ctx) => nodeSchema.type(ctx);
	result.ctx = schemaCtx;
	result.key = schemaCtx.key;
	result.extendSchema = (handler) => {
		return $nodeSchema(id, handler(schema));
	};
	return result;
}
//#endregion
//#region src/composable/composed/$mark-schema.ts
function $markSchema(id, schema) {
	const schemaCtx = $ctx(schema, id);
	const markSchema = $mark(id, (ctx) => {
		return ctx.get(schemaCtx.key)(ctx);
	});
	const result = [schemaCtx, markSchema];
	result.id = markSchema.id;
	result.mark = markSchema;
	result.type = (ctx) => markSchema.type(ctx);
	result.ctx = schemaCtx;
	result.key = schemaCtx.key;
	result.extendSchema = (handler) => {
		return $markSchema(id, handler(schema));
	};
	return result;
}
//#endregion
//#region src/composable/composed/$use-keymap.ts
function $useKeymap(name, userKeymap) {
	const keymapDef = $ctx(Object.fromEntries(Object.entries(userKeymap).map(([key, { shortcuts, priority }]) => {
		return [key, {
			shortcuts,
			priority
		}];
	})), `${name}Keymap`);
	const shortcuts = $shortcut((ctx) => {
		const keys = ctx.get(keymapDef.key);
		const keymapTuple = Object.entries(userKeymap).flatMap(([key, { command }]) => {
			const target = keys[key];
			const targetKeys = [target.shortcuts].flat();
			const priority = target.priority;
			return targetKeys.map((targetKey) => [targetKey, {
				key: targetKey,
				onRun: command,
				priority
			}]);
		});
		return Object.fromEntries(keymapTuple);
	});
	const result = [keymapDef, shortcuts];
	result.ctx = keymapDef;
	result.shortcuts = shortcuts;
	result.key = keymapDef.key;
	result.keymap = shortcuts.keymap;
	return result;
}
//#endregion
//#region src/composable/composed/$attr.ts
var $nodeAttr = (name, value = () => ({})) => $ctx(value, `${name}Attr`);
var $markAttr = (name, value = () => ({})) => $ctx(value, `${name}Attr`);
//#endregion
//#region src/composable/composed/$remark.ts
function $remark(id, remark, initialOptions) {
	const options = $ctx(initialOptions ?? {}, id);
	const plugin = (ctx) => async () => {
		await ctx.wait(InitReady);
		const remarkPlugin = {
			plugin: remark(ctx),
			options: ctx.get(options.key)
		};
		ctx.update(remarkPluginsCtx, (rp) => [...rp, remarkPlugin]);
		return () => {
			ctx.update(remarkPluginsCtx, (rp) => rp.filter((x) => x !== remarkPlugin));
		};
	};
	const result = [options, plugin];
	result.id = id;
	result.plugin = plugin;
	result.options = options;
	return result;
}
//#endregion
//#region src/macro/call-command.ts
function callCommand(slice, payload) {
	return (ctx) => {
		return ctx.get(commandsCtx).call(slice, payload);
	};
}
//#endregion
//#region src/macro/force-update.ts
function forceUpdate() {
	return (ctx) => {
		const view = ctx.get(editorViewCtx);
		const { tr } = view.state;
		const nextTr = Object.assign(Object.create(tr), tr).setTime(Date.now());
		return view.dispatch(nextTr);
	};
}
//#endregion
//#region src/macro/get-html.ts
function getHTML() {
	return (ctx) => {
		const div = document.createElement("div");
		const schema = ctx.get(schemaCtx);
		const view = ctx.get(editorViewCtx);
		const fragment = DOMSerializer.fromSchema(schema).serializeFragment(view.state.doc.content);
		div.appendChild(fragment);
		return div.innerHTML;
	};
}
//#endregion
//#region src/macro/get-markdown.ts
function getMarkdown(range) {
	return (ctx) => {
		const view = ctx.get(editorViewCtx);
		const schema = ctx.get(schemaCtx);
		const serializer = ctx.get(serializerCtx);
		if (!range) return serializer(view.state.doc);
		const slice = view.state.doc.slice(range.from, range.to, true);
		const doc = schema.topNodeType.createAndFill(null, slice.content);
		if (!doc) {
			console.error("No document found");
			return "";
		}
		return serializer(doc);
	};
}
//#endregion
//#region src/macro/insert.ts
function insert(markdown, inline = false) {
	return (ctx) => {
		const view = ctx.get(editorViewCtx);
		const doc = ctx.get(parserCtx)(markdown);
		if (!doc) return;
		if (!inline) {
			const contentSlice = view.state.selection.content();
			return view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, contentSlice.openStart, contentSlice.openEnd)).scrollIntoView());
		}
		const schema = ctx.get(schemaCtx);
		const dom = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
		const slice = DOMParser.fromSchema(schema).parseSlice(dom);
		const node = isTextOnlySlice(slice);
		if (node) {
			view.dispatch(view.state.tr.replaceSelectionWith(node, true));
			return;
		}
		view.dispatch(view.state.tr.replaceSelection(slice));
	};
}
//#endregion
//#region src/macro/outline.ts
function outline() {
	return (ctx) => {
		const view = ctx.get(editorViewCtx);
		const data = [];
		view.state.doc.descendants((node) => {
			if (node.type.name === "heading" && node.attrs.level) data.push({
				text: node.textContent,
				level: node.attrs.level,
				id: node.attrs.id
			});
		});
		return data;
	};
}
//#endregion
//#region src/macro/replace-all.ts
function replaceAll(markdown, flush = false) {
	return (ctx) => {
		const view = ctx.get(editorViewCtx);
		const doc = ctx.get(parserCtx)(markdown);
		if (!doc) return;
		if (!flush) {
			const { state } = view;
			return view.dispatch(state.tr.replace(0, state.doc.content.size, new Slice(doc.content, 0, 0)));
		}
		const schema = ctx.get(schemaCtx);
		const newOptions = ctx.get(editorStateOptionsCtx)({
			schema,
			doc,
			plugins: ctx.get(prosePluginsCtx)
		});
		const state = EditorState.create(newOptions);
		view.updateState(state);
	};
}
//#endregion
//#region src/macro/set-attr.ts
function setAttr(pos, update) {
	return (ctx) => {
		const view = ctx.get(editorViewCtx);
		const { tr } = view.state;
		const node = tr.doc.nodeAt(pos);
		if (!node) return;
		const nextAttr = update(node.attrs);
		return view.dispatch(tr.setNodeMarkup(pos, void 0, nextAttr));
	};
}
//#endregion
//#region src/macro/markdown-to-slice.ts
function markdownToSlice(markdown) {
	return (ctx) => {
		const doc = ctx.get(parserCtx)(markdown);
		const schema = ctx.get(schemaCtx);
		const dom = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
		return DOMParser.fromSchema(schema).parseSlice(dom);
	};
}
//#endregion
//#region src/macro/insert-pos.ts
function insertPos(markdown, pos, inline = false) {
	return (ctx) => {
		const slice = markdownToSlice(markdown)(ctx);
		const view = ctx.get(editorViewCtx);
		const toPos = view.state.doc.resolve(pos);
		const min = 0;
		const max = view.state.doc.content.size;
		const resolved = inline ? toPos.pos : toPos.after(toPos.depth - 1);
		const to = Math.min(Math.max(resolved, min), max);
		view.dispatch(view.state.tr.replace(resolved, to, slice));
	};
}
//#endregion
//#region src/macro/replace-range.ts
function replaceRange(markdown, range) {
	return (ctx) => {
		const view = ctx.get(editorViewCtx);
		const slice = markdownToSlice(markdown)(ctx);
		view.dispatch(view.state.tr.replace(range.from, range.to, slice));
	};
}
//#endregion
//#region src/pipe.ts
var pipe = (...funcs) => {
	const length = funcs.length;
	let index = length;
	while (index--) if (typeof funcs[index] !== "function") throw new TypeError("Expected a function");
	return (...args) => {
		let index = 0;
		let result = length ? funcs[index](...args) : args[0];
		while (++index < length) result = funcs[index](result);
		return result;
	};
};
//#endregion
export { $command, $commandAsync, $ctx, $inputRule, $inputRuleAsync, $mark, $markAsync, $markAttr, $markSchema, $node, $nodeAsync, $nodeAttr, $nodeSchema, $pasteRule, $pasteRuleAsync, $prose, $proseAsync, $remark, $shortcut, $shortcutAsync, $useKeymap, $view, $viewAsync, addTimer, callCommand, forceUpdate, getHTML, getMarkdown, insert, insertPos, markdownToSlice, nanoid, outline, pipe, replaceAll, replaceRange, setAttr };

//# sourceMappingURL=index.js.map