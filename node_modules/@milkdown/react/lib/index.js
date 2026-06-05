import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
//#region src/use-get-editor.ts
var editorInfoContext = createContext({});
function useGetEditor() {
	const { dom, editor: editorRef, setLoading, editorFactory: getEditor } = useContext(editorInfoContext);
	const domRef = useRef(null);
	useEffect(() => {
		const div = domRef.current;
		if (!getEditor) return;
		if (!div) return;
		dom.current = div;
		const editor = getEditor(div);
		if (!editor) return;
		setLoading(true);
		editor.create().then((editor) => {
			editorRef.current = editor;
		}).finally(() => {
			setLoading(false);
		}).catch(console.error);
		return () => {
			editor.destroy().catch(console.error);
		};
	}, [
		dom,
		editorRef,
		getEditor,
		setLoading
	]);
	return domRef;
}
//#endregion
//#region src/editor.tsx
var Milkdown = () => {
	const domRef = useGetEditor();
	return /* @__PURE__ */ React.createElement("div", {
		"data-milkdown-root": true,
		ref: domRef
	});
};
var MilkdownProvider = ({ children }) => {
	const dom = useRef(void 0);
	const [editorFactory, setEditorFactory] = useState(void 0);
	const editor = useRef(void 0);
	const [loading, setLoading] = useState(true);
	const editorInfoCtx = useMemo(() => ({
		loading,
		dom,
		editor,
		setLoading,
		editorFactory,
		setEditorFactory
	}), [loading, editorFactory]);
	return /* @__PURE__ */ React.createElement(editorInfoContext.Provider, { value: editorInfoCtx }, children);
};
//#endregion
//#region src/use-editor.ts
function useEditor(getEditor, deps = []) {
	const editorInfo = useContext(editorInfoContext);
	const factory = useCallback(getEditor, deps);
	useLayoutEffect(() => {
		editorInfo.setEditorFactory(() => factory);
	}, [editorInfo, factory]);
	return {
		loading: editorInfo.loading,
		get: () => editorInfo.editor.current
	};
}
//#endregion
//#region src/use-instance.ts
function useInstance() {
	const editorInfo = useContext(editorInfoContext);
	const getInstance = useCallback(() => {
		return editorInfo.editor.current;
	}, [editorInfo.editor]);
	return [editorInfo.loading, getInstance];
}
//#endregion
export { Milkdown, MilkdownProvider, useEditor, useInstance };

//# sourceMappingURL=index.js.map