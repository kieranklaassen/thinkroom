// src/index.ts
import { Mark } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
function createVirtualCursor(options) {
  var _a;
  const skipWarning = (_a = options == null ? void 0 : options.skipWarning) != null ? _a : false;
  let _cursor = typeof document === "undefined" ? null : document.createElement("div");
  return new Plugin({
    key,
    view: (view) => {
      if (skipWarning !== true) {
        checkInclusive(view.state.schema, skipWarning || []);
      }
      const doc = view.dom.ownerDocument;
      _cursor = _cursor || document.createElement("div");
      const cursor = _cursor;
      const update = () => {
        updateCursor(view, cursor);
      };
      let observer;
      if (window.ResizeObserver) {
        observer = new window.ResizeObserver(() => update());
        observer.observe(view.dom);
      }
      doc.addEventListener("selectionchange", update);
      return {
        update: () => {
          update();
        },
        destroy: () => {
          doc.removeEventListener("selectionchange", update);
          if (observer) {
            observer.unobserve(view.dom);
          }
        }
      };
    },
    props: {
      handleKeyDown: (view, event) => {
        var _a2;
        const { selection } = view.state;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || !["ArrowLeft", "ArrowRight"].includes(event.key) || !isTextSelection(selection) || !selection.empty)
          return false;
        const $pos = selection.$head;
        const [marksBefore, marksAfter] = getMarksAround($pos);
        const marks = view.state.storedMarks || $pos.marks();
        if (marksBefore && marksAfter && !Mark.sameSet(marksBefore, marksAfter)) {
          if (event.key === "ArrowLeft" && !Mark.sameSet(marksBefore, marks)) {
            view.dispatch(view.state.tr.setStoredMarks(marksBefore));
            return true;
          }
          if (event.key === "ArrowRight" && !Mark.sameSet(marksAfter, marks)) {
            view.dispatch(view.state.tr.setStoredMarks(marksAfter));
            return true;
          }
        }
        if (event.key === "ArrowLeft" && $pos.textOffset === 1) {
          view.dispatch(
            view.state.tr.setSelection(TextSelection.create(view.state.doc, $pos.pos - 1)).setStoredMarks($pos.marks())
          );
          return true;
        }
        if (event.key === "ArrowRight" && $pos.textOffset + 1 === ((_a2 = $pos.parent.maybeChild($pos.index())) == null ? void 0 : _a2.nodeSize)) {
          view.dispatch(
            view.state.tr.setSelection(TextSelection.create(view.state.doc, $pos.pos + 1)).setStoredMarks($pos.marks())
          );
          return true;
        }
        return false;
      },
      decorations: (state) => {
        if (!_cursor || !isTextSelection(state.selection) || !state.selection.empty)
          return;
        return DecorationSet.create(state.doc, [
          Decoration.widget(0, _cursor, {
            key: "prosemirror-virtual-cursor"
          })
        ]);
      },
      attributes: {
        class: "virtual-cursor-enabled"
      }
    }
  });
}
var key = new PluginKey("prosemirror-virtual-cursor");
function getCursorRect(view, toStart) {
  var _a;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount)
    return null;
  const range = (_a = selection == null ? void 0 : selection.getRangeAt(0)) == null ? void 0 : _a.cloneRange();
  if (!range)
    return null;
  range.collapse(toStart);
  const rects = range.getClientRects();
  const rect = (rects == null ? void 0 : rects.length) ? rects[rects.length - 1] : null;
  if (rect == null ? void 0 : rect.height)
    return rect;
  return view.coordsAtPos(view.state.selection.head);
}
function getMarksAround($pos) {
  const index = $pos.index();
  const after = $pos.parent.maybeChild(index);
  let before = $pos.textOffset ? after : null;
  if (!before && index > 0)
    before = $pos.parent.maybeChild(index - 1);
  return [before == null ? void 0 : before.marks, after == null ? void 0 : after.marks];
}
function isTextSelection(selection) {
  return selection && typeof selection === "object" && "$cursor" in selection;
}
function updateCursor(view, cursor) {
  if (!view || !view.dom || view.isDestroyed || !cursor)
    return;
  const { state, dom } = view;
  const { selection } = state;
  if (!isTextSelection(selection))
    return;
  const cursorRect = getCursorRect(view, selection.$head === selection.$from);
  if (!cursorRect)
    return cursor;
  const editorRect = dom.getBoundingClientRect();
  let className = "prosemirror-virtual-cursor";
  const $pos = state.selection.$head;
  const [marksBefore, marksAfter] = getMarksAround($pos);
  const marks = state.storedMarks || $pos.marks();
  if (selection.$cursor && marksBefore && marksAfter && marks && !Mark.sameSet(marksBefore, marksAfter)) {
    if (Mark.sameSet(marksBefore, marks))
      className += " prosemirror-virtual-cursor-left";
    else if (Mark.sameSet(marksAfter, marks))
      className += " prosemirror-virtual-cursor-right";
  }
  cursor.className = className;
  restartAnimation(cursor, "prosemirror-virtual-cursor-animation");
  cursor.style.height = `${cursorRect.bottom - cursorRect.top}px`;
  cursor.style.left = `${cursorRect.left - editorRect.left}px`;
  cursor.style.top = `${cursorRect.top - editorRect.top}px`;
}
function restartAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}
function checkInclusive(schema, skipWarning) {
  for (const [mark, type] of Object.entries(schema.marks)) {
    if (type.spec.inclusive === false && !skipWarning.includes(mark)) {
      console.warn(
        `[prosemirror-virtual-cursor] Virtual cursor does not work well with marks that have inclusive set to false. Please consider removing the inclusive option from the "${mark}" mark or adding it to the "skipWarning" option.`
      );
    }
  }
}
export {
  createVirtualCursor
};
