import { $ctx, $view } from '@milkdown/utils';
import { selectColCommand, moveColCommand, selectRowCommand, moveRowCommand, setAlignCommand, deleteSelectedCellsCommand, addColAfterCommand, addColBeforeCommand, addRowAfterCommand, addRowBeforeCommand, tableSchema } from '@milkdown/preset-gfm';
import { findParent } from '@milkdown/prose';
import { TextSelection, NodeSelection } from '@milkdown/prose/state';
import { CellSelection, findTable } from '@milkdown/prose/tables';
import { h, onMounted, onUnmounted, defineComponent, ref, shallowRef, createApp } from 'vue';
import clsx from 'clsx';
import DOMPurify from 'dompurify';
import { editorViewCtx, commandsCtx } from '@milkdown/core';
import { computePosition, offset } from '@floating-ui/dom';
import { throttle } from 'lodash-es';

var __defProp$1 = Object.defineProperty;
var __getOwnPropSymbols$1 = Object.getOwnPropertySymbols;
var __hasOwnProp$1 = Object.prototype.hasOwnProperty;
var __propIsEnum$1 = Object.prototype.propertyIsEnumerable;
var __defNormalProp$1 = (obj, key, value) => key in obj ? __defProp$1(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues$1 = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp$1.call(b, prop))
      __defNormalProp$1(a, prop, b[prop]);
  if (__getOwnPropSymbols$1)
    for (var prop of __getOwnPropSymbols$1(b)) {
      if (__propIsEnum$1.call(b, prop))
        __defNormalProp$1(a, prop, b[prop]);
    }
  return a;
};
function withMeta(plugin, meta) {
  Object.assign(plugin, {
    meta: __spreadValues$1({
      package: "@milkdown/components"
    }, meta)
  });
  return plugin;
}

var __defProp = Object.defineProperty;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
const defaultTableBlockConfig = {
  renderButton: (renderType) => {
    switch (renderType) {
      case "add_row":
        return "+";
      case "add_col":
        return "+";
      case "delete_row":
        return "-";
      case "delete_col":
        return "-";
      case "align_col_left":
        return "left";
      case "align_col_center":
        return "center";
      case "align_col_right":
        return "right";
      case "col_drag_handle":
        return "=";
      case "row_drag_handle":
        return "=";
    }
  }
};
const tableBlockConfig = $ctx(
  __spreadValues({}, defaultTableBlockConfig),
  "tableBlockConfigCtx"
);
withMeta(tableBlockConfig, {
  displayName: "Config<table-block>",
  group: "TableBlock"
});

function keepAlive(..._args) {
}

keepAlive(h);
function Icon({ icon, class: className, onClick }) {
  return /* @__PURE__ */ h(
    "span",
    {
      class: clsx("milkdown-icon", className),
      onPointerdown: onClick,
      innerHTML: icon ? DOMPurify.sanitize(icon.trim()) : void 0
    }
  );
}
Icon.props = {
  icon: {
    type: String,
    required: false
  },
  class: {
    type: String,
    required: false
  },
  onClick: {
    type: Function,
    required: false
  }
};

function prepareDndContext(refs) {
  const {
    dragPreviewRef,
    tableWrapperRef,
    contentWrapperRef,
    yLineHandleRef,
    xLineHandleRef,
    colHandleRef,
    rowHandleRef
  } = refs;
  const preview = dragPreviewRef.value;
  if (!preview) return;
  const wrapper = tableWrapperRef.value;
  if (!wrapper) return;
  const content = contentWrapperRef.value;
  if (!content) return;
  const contentRoot = content.querySelector("tbody");
  if (!contentRoot) return;
  const previewRoot = preview.querySelector("tbody");
  if (!previewRoot) return;
  const yHandle = yLineHandleRef.value;
  if (!yHandle) return;
  const xHandle = xLineHandleRef.value;
  if (!xHandle) return;
  const colHandle = colHandleRef.value;
  if (!colHandle) return;
  const rowHandle = rowHandleRef.value;
  if (!rowHandle) return;
  const context = {
    preview,
    wrapper,
    content,
    contentRoot,
    previewRoot,
    yHandle,
    xHandle,
    colHandle,
    rowHandle
  };
  return context;
}

function clearPreview(previewRoot) {
  while (previewRoot.firstChild) previewRoot.removeChild(previewRoot.firstChild);
}
function renderPreview(axis, preview, previewRoot, tableContent, index) {
  const { width: tableWidth, height: tableHeight } = tableContent.querySelector("tbody").getBoundingClientRect();
  if (axis === "y") {
    const rows = tableContent.querySelectorAll("tr");
    const row = rows[index];
    if (!row) return;
    previewRoot.appendChild(row.cloneNode(true));
    const height = row.getBoundingClientRect().height;
    Object.assign(preview.style, {
      width: `${tableWidth}px`,
      height: `${height}px`
    });
    preview.dataset.show = "true";
    return;
  }
  if (axis === "x") {
    const rows = tableContent.querySelectorAll("tr");
    let width;
    Array.from(rows).forEach((row) => {
      const col = row.children[index];
      if (!col) return;
      if (width === void 0) width = col.getBoundingClientRect().width;
      const tr = col.parentElement.cloneNode(false);
      const clone = col.cloneNode(true);
      tr.appendChild(clone);
      previewRoot.appendChild(tr);
    });
    Object.assign(preview.style, {
      width: `${width}px`,
      height: `${tableHeight}px`
    });
    preview.dataset.show = "true";
    return;
  }
}

function createDragRowHandler(refs, ctx) {
  return (event) => {
    handleDrag(refs, event, ctx, (context) => {
      updateDragInfo("y", event, context, refs);
      const { preview, content, previewRoot } = context;
      clearPreview(previewRoot);
      const { hoverIndex } = refs;
      const [rowIndex] = hoverIndex.value;
      renderPreview("y", preview, previewRoot, content, rowIndex);
    });
  };
}
function createDragColHandler(refs, ctx) {
  return (event) => {
    handleDrag(refs, event, ctx, (context) => {
      updateDragInfo("x", event, context, refs);
      const { preview, content, previewRoot } = context;
      const { hoverIndex } = refs;
      const [_, colIndex] = hoverIndex.value;
      clearPreview(previewRoot);
      renderPreview("x", preview, previewRoot, content, colIndex);
    });
  };
}
function updateDragInfo(axis, event, context, refs) {
  const { xHandle, yHandle, colHandle, rowHandle, preview } = context;
  xHandle.dataset.displayType = axis === "y" ? "indicator" : "none";
  yHandle.dataset.displayType = axis === "x" ? "indicator" : "none";
  if (axis === "y") {
    colHandle.dataset.show = "false";
    hideButtonGroup(rowHandle);
  } else {
    rowHandle.dataset.show = "false";
    hideButtonGroup(colHandle);
  }
  const { hoverIndex, dragInfo } = refs;
  const [rowIndex, colIndex] = hoverIndex.value;
  dragInfo.value = {
    startCoords: [event.clientX, event.clientY],
    startIndex: axis === "y" ? rowIndex : colIndex,
    endIndex: axis === "y" ? rowIndex : colIndex,
    type: axis === "y" ? "row" : "col"
  };
  preview.dataset.direction = axis === "y" ? "vertical" : "horizontal";
}
function handleDrag(refs, event, ctx, fn) {
  const view = ctx == null ? void 0 : ctx.get(editorViewCtx);
  if (!(view == null ? void 0 : view.editable)) return;
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  const context = prepareDndContext(refs);
  if (!context) return;
  requestAnimationFrame(() => {
    fn(context);
  });
}
function hideButtonGroup(handle) {
  var _a;
  (_a = handle.querySelector(".button-group")) == null ? void 0 : _a.setAttribute("data-show", "false");
}

function findNodeIndex(parent, child) {
  for (let i = 0; i < parent.childCount; i++) {
    if (parent.child(i) === child) return i;
  }
  return -1;
}
function findPointerIndex(event, view) {
  var _a, _b, _c;
  if (!view) return;
  try {
    const posAtCoords = view.posAtCoords({
      left: event.clientX,
      top: event.clientY
    });
    if (!posAtCoords) return;
    const pos = posAtCoords == null ? void 0 : posAtCoords.inside;
    if (pos == null || pos < 0) return;
    const $pos = view.state.doc.resolve(pos);
    const node = view.state.doc.nodeAt(pos);
    if (!node) return;
    const cellType = ["table_cell", "table_header"];
    const rowType = ["table_row", "table_header_row"];
    const cell = cellType.includes(node.type.name) ? node : (_a = findParent((node2) => cellType.includes(node2.type.name))($pos)) == null ? void 0 : _a.node;
    const row = (_b = findParent((node2) => rowType.includes(node2.type.name))(
      $pos
    )) == null ? void 0 : _b.node;
    const table = (_c = findParent((node2) => node2.type.name === "table")($pos)) == null ? void 0 : _c.node;
    if (!cell || !row || !table) return;
    const columnIndex = findNodeIndex(row, cell);
    const rowIndex = findNodeIndex(table, row);
    return [rowIndex, columnIndex];
  } catch (e) {
    return void 0;
  }
}
function getRelatedDOM(contentWrapperRef, [rowIndex, columnIndex]) {
  const content = contentWrapperRef.value;
  if (!content) return;
  const rows = content.querySelectorAll("tr");
  const row = rows[rowIndex];
  if (!row) return;
  const firstRow = rows[0];
  if (!firstRow) return;
  const headerCol = firstRow.children[columnIndex];
  if (!headerCol) return;
  const col = row.children[columnIndex];
  if (!col) return;
  return {
    row,
    col,
    headerCol
  };
}
function recoveryStateBetweenUpdate(refs, view, node) {
  if (!node) return;
  if (!view) return;
  const { selection } = view.state;
  if (!(selection instanceof CellSelection)) return;
  const { $from } = selection;
  const table = findTable($from);
  if (!table || table.node !== node) return;
  if (selection.isColSelection()) {
    const { $head } = selection;
    const colIndex = $head.index($head.depth - 1);
    computeColHandlePositionByIndex({
      refs,
      index: [0, colIndex],
      before: (handleDOM) => {
        var _a;
        (_a = handleDOM.querySelector(".button-group")) == null ? void 0 : _a.setAttribute("data-show", "true");
      }
    });
    return;
  }
  if (selection.isRowSelection()) {
    const { $head } = selection;
    const rowNode = findParent(
      (node2) => node2.type.name === "table_row" || node2.type.name === "table_header_row"
    )($head);
    if (!rowNode) return;
    const rowIndex = findNodeIndex(table.node, rowNode.node);
    computeRowHandlePositionByIndex({
      refs,
      index: [rowIndex, 0],
      before: (handleDOM) => {
        var _a;
        if (rowIndex > 0)
          (_a = handleDOM.querySelector(".button-group")) == null ? void 0 : _a.setAttribute("data-show", "true");
      }
    });
  }
}
function computeColHandlePositionByIndex({
  refs,
  index,
  before,
  after
}) {
  const { contentWrapperRef, colHandleRef, hoverIndex } = refs;
  const colHandle = colHandleRef.value;
  if (!colHandle) return;
  hoverIndex.value = index;
  const dom = getRelatedDOM(contentWrapperRef, index);
  if (!dom) return;
  const { headerCol: col } = dom;
  colHandle.dataset.show = "true";
  if (before) before(colHandle);
  computePosition(col, colHandle, { placement: "top" }).then(({ x, y }) => {
    Object.assign(colHandle.style, {
      left: `${x}px`,
      top: `${y}px`
    });
    if (after) after(colHandle);
  }).catch(console.error);
}
function computeRowHandlePositionByIndex({
  refs,
  index,
  before,
  after
}) {
  const { contentWrapperRef, rowHandleRef, hoverIndex } = refs;
  const rowHandle = rowHandleRef.value;
  if (!rowHandle) return;
  hoverIndex.value = index;
  const dom = getRelatedDOM(contentWrapperRef, index);
  if (!dom) return;
  const { row } = dom;
  rowHandle.dataset.show = "true";
  if (before) before(rowHandle);
  computePosition(row, rowHandle, { placement: "left" }).then(({ x, y }) => {
    Object.assign(rowHandle.style, {
      left: `${x}px`,
      top: `${y}px`
    });
    if (after) after(rowHandle);
  }).catch(console.error);
}

function findDragOverElement(elements, pointer, axis) {
  const startProp = axis === "x" ? "left" : "top";
  const endProp = axis === "x" ? "right" : "bottom";
  const lastIndex = elements.length - 1;
  const index = elements.findIndex((el, index2) => {
    const rect = el.getBoundingClientRect();
    const boundaryStart = rect[startProp];
    const boundaryEnd = rect[endProp];
    if (boundaryStart <= pointer && pointer <= boundaryEnd) return true;
    if (index2 === lastIndex && pointer > boundaryEnd) return true;
    if (index2 === 0 && pointer < boundaryStart) return true;
    return false;
  });
  const element = elements[index];
  return element ? [element, index] : void 0;
}
function getDragOverColumn(table, pointerX) {
  const firstRow = table.querySelector("tr");
  if (!firstRow) return;
  const cells = Array.from(firstRow.children);
  return findDragOverElement(cells, pointerX, "x");
}
function getDragOverRow(table, pointerY) {
  const rows = Array.from(table.querySelectorAll("tr"));
  return findDragOverElement(rows, pointerY, "y");
}

function createDragOverHandler(refs) {
  return throttle((e) => {
    const context = prepareDndContext(refs);
    if (!context) return;
    const { preview, content, contentRoot, xHandle, yHandle } = context;
    const { dragInfo, hoverIndex } = refs;
    if (preview.dataset.show === "false") return;
    const dom = getRelatedDOM(refs.contentWrapperRef, hoverIndex.value);
    if (!dom) return;
    const firstRow = contentRoot.querySelector("tr");
    if (!firstRow) return;
    const info = dragInfo.value;
    if (!info) return;
    if (!contentRoot.offsetParent) return;
    const wrapperOffsetTop = contentRoot.offsetParent.offsetTop;
    const wrapperOffsetLeft = contentRoot.offsetParent.offsetLeft;
    if (info.type === "col") {
      const width = dom.col.getBoundingClientRect().width;
      const { left, width: fullWidth } = contentRoot.getBoundingClientRect();
      const leftGap = wrapperOffsetLeft - left;
      const previewLeft = e.clientX + leftGap - width / 2;
      const [startX] = info.startCoords;
      const direction = startX < e.clientX ? "right" : "left";
      preview.style.top = `${wrapperOffsetTop}px`;
      const previewLeftOffset = previewLeft < left + leftGap - 20 ? left + leftGap - 20 : previewLeft > left + fullWidth + leftGap - width + 20 ? left + fullWidth + leftGap - width + 20 : previewLeft;
      preview.style.left = `${previewLeftOffset}px`;
      const dragOverColumn = getDragOverColumn(contentRoot, e.clientX);
      if (dragOverColumn) {
        const [col, index] = dragOverColumn;
        const yHandleWidth = yHandle.getBoundingClientRect().width;
        const contentBoundary = content.getBoundingClientRect();
        info.endIndex = index;
        computePosition(col, yHandle, {
          placement: direction === "left" ? "left" : "right",
          middleware: [offset(direction === "left" ? -1 * yHandleWidth : 0)]
        }).then(({ x }) => {
          yHandle.dataset.show = "true";
          Object.assign(yHandle.style, {
            height: `${contentBoundary.height}px`,
            left: `${x}px`,
            top: `${wrapperOffsetTop}px`
          });
        }).catch(console.error);
      }
    } else if (info.type === "row") {
      const height = dom.row.getBoundingClientRect().height;
      const { top, height: fullHeight } = contentRoot.getBoundingClientRect();
      const topGap = wrapperOffsetTop - top;
      const previewTop = e.clientY + topGap - height / 2;
      const [_, startY] = info.startCoords;
      const direction = startY < e.clientY ? "down" : "up";
      const previewTopOffset = previewTop < top + topGap - 20 ? top + topGap - 20 : previewTop > top + fullHeight + topGap - height + 20 ? top + fullHeight + topGap - height + 20 : previewTop;
      preview.style.top = `${previewTopOffset}px`;
      preview.style.left = `${wrapperOffsetLeft}px`;
      const dragOverRow = getDragOverRow(contentRoot, e.clientY);
      if (dragOverRow) {
        const [row, index] = dragOverRow;
        const xHandleHeight = xHandle.getBoundingClientRect().height;
        const contentBoundary = content.getBoundingClientRect();
        info.endIndex = index;
        computePosition(row, xHandle, {
          placement: direction === "up" ? "top" : "bottom",
          middleware: [offset(direction === "up" ? -1 * xHandleHeight : 0)]
        }).then(({ y }) => {
          xHandle.dataset.show = "true";
          Object.assign(xHandle.style, {
            width: `${contentBoundary.width}px`,
            top: `${y}px`
          });
        }).catch(console.error);
      }
    }
  }, 20);
}

function useDragHandlers(refs, ctx, getPos) {
  const { dragPreviewRef, yLineHandleRef, xLineHandleRef, dragInfo } = refs;
  const dragRow = createDragRowHandler(refs, ctx);
  const dragCol = createDragColHandler(refs, ctx);
  const onDragEnd = () => {
    const preview = dragPreviewRef.value;
    if (!preview) return;
    if (preview.dataset.show === "false") return;
    const previewRoot = preview == null ? void 0 : preview.querySelector("tbody");
    while (previewRoot == null ? void 0 : previewRoot.firstChild)
      previewRoot == null ? void 0 : previewRoot.removeChild(previewRoot.firstChild);
    if (preview) preview.dataset.show = "false";
  };
  const onDrop = () => {
    var _a;
    const preview = dragPreviewRef.value;
    if (!preview) return;
    const yHandle = yLineHandleRef.value;
    if (!yHandle) return;
    const xHandle = xLineHandleRef.value;
    if (!xHandle) return;
    const info = dragInfo.value;
    if (!info) return;
    if (!ctx) return;
    if (preview.dataset.show === "false") return;
    const colHandle = refs.colHandleRef.value;
    if (!colHandle) return;
    const rowHandle = refs.rowHandleRef.value;
    if (!rowHandle) return;
    yHandle.dataset.show = "false";
    xHandle.dataset.show = "false";
    if (info.startIndex === info.endIndex) return;
    const commands = ctx.get(commandsCtx);
    const payload = {
      from: info.startIndex,
      to: info.endIndex,
      pos: ((_a = getPos == null ? void 0 : getPos()) != null ? _a : 0) + 1
    };
    if (info.type === "col") {
      commands.call(selectColCommand.key, {
        pos: payload.pos,
        index: info.startIndex
      });
      commands.call(moveColCommand.key, payload);
      const index = [0, info.endIndex];
      computeColHandlePositionByIndex({
        refs,
        index
      });
    } else {
      commands.call(selectRowCommand.key, {
        pos: payload.pos,
        index: info.startIndex
      });
      commands.call(moveRowCommand.key, payload);
      const index = [info.endIndex, 0];
      computeRowHandlePositionByIndex({
        refs,
        index
      });
    }
    requestAnimationFrame(() => {
      ctx.get(editorViewCtx).focus();
    });
  };
  const onDragOver = createDragOverHandler(refs);
  onMounted(() => {
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragend", onDragEnd);
    window.addEventListener("drop", onDrop);
  });
  onUnmounted(() => {
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("dragend", onDragEnd);
    window.removeEventListener("drop", onDrop);
  });
  return {
    dragRow,
    dragCol
  };
}

function useOperation(refs, ctx, getPos) {
  const {
    xLineHandleRef,
    contentWrapperRef,
    colHandleRef,
    rowHandleRef,
    hoverIndex,
    lineHoverIndex
  } = refs;
  const onAddRow = () => {
    var _a, _b, _c;
    if (!ctx) return;
    const xHandle = xLineHandleRef.value;
    if (!xHandle) return;
    const [rowIndex] = lineHoverIndex.value;
    if (rowIndex < 0) return;
    if (!ctx.get(editorViewCtx).editable) return;
    const rows = Array.from(
      (_b = (_a = contentWrapperRef.value) == null ? void 0 : _a.querySelectorAll("tr")) != null ? _b : []
    );
    const commands = ctx.get(commandsCtx);
    const pos = ((_c = getPos == null ? void 0 : getPos()) != null ? _c : 0) + 1;
    if (rows.length === rowIndex) {
      commands.call(selectRowCommand.key, { pos, index: rowIndex - 1 });
      commands.call(addRowAfterCommand.key);
    } else {
      commands.call(selectRowCommand.key, { pos, index: rowIndex });
      commands.call(addRowBeforeCommand.key);
    }
    commands.call(selectRowCommand.key, { pos, index: rowIndex });
    xHandle.dataset.show = "false";
  };
  const onAddCol = () => {
    var _a, _b, _c, _d;
    if (!ctx) return;
    const xHandle = xLineHandleRef.value;
    if (!xHandle) return;
    const [_, colIndex] = lineHoverIndex.value;
    if (colIndex < 0) return;
    if (!ctx.get(editorViewCtx).editable) return;
    const cols = Array.from(
      (_c = (_b = (_a = contentWrapperRef.value) == null ? void 0 : _a.querySelector("tr")) == null ? void 0 : _b.children) != null ? _c : []
    );
    const commands = ctx.get(commandsCtx);
    const pos = ((_d = getPos == null ? void 0 : getPos()) != null ? _d : 0) + 1;
    if (cols.length === colIndex) {
      commands.call(selectColCommand.key, { pos, index: colIndex - 1 });
      commands.call(addColAfterCommand.key);
    } else {
      commands.call(selectColCommand.key, { pos, index: colIndex });
      commands.call(addColBeforeCommand.key);
    }
    commands.call(selectColCommand.key, { pos, index: colIndex });
  };
  const selectCol = () => {
    var _a, _b;
    if (!ctx) return;
    const [_, colIndex] = hoverIndex.value;
    const commands = ctx.get(commandsCtx);
    const pos = ((_a = getPos == null ? void 0 : getPos()) != null ? _a : 0) + 1;
    commands.call(selectColCommand.key, { pos, index: colIndex });
    const buttonGroup = (_b = colHandleRef.value) == null ? void 0 : _b.querySelector(".button-group");
    if (buttonGroup)
      buttonGroup.dataset.show = buttonGroup.dataset.show === "true" ? "false" : "true";
  };
  const selectRow = () => {
    var _a, _b;
    if (!ctx) return;
    const [rowIndex, _] = hoverIndex.value;
    const commands = ctx.get(commandsCtx);
    const pos = ((_a = getPos == null ? void 0 : getPos()) != null ? _a : 0) + 1;
    commands.call(selectRowCommand.key, { pos, index: rowIndex });
    const buttonGroup = (_b = rowHandleRef.value) == null ? void 0 : _b.querySelector(".button-group");
    if (buttonGroup && rowIndex > 0)
      buttonGroup.dataset.show = buttonGroup.dataset.show === "true" ? "false" : "true";
  };
  const deleteSelected = (e) => {
    if (!ctx) return;
    if (!ctx.get(editorViewCtx).editable) return;
    e.preventDefault();
    e.stopPropagation();
    const commands = ctx.get(commandsCtx);
    commands.call(deleteSelectedCellsCommand.key);
    requestAnimationFrame(() => {
      ctx.get(editorViewCtx).focus();
    });
  };
  const onAlign = (direction) => (e) => {
    if (!ctx) return;
    if (!ctx.get(editorViewCtx).editable) return;
    e.preventDefault();
    e.stopPropagation();
    const commands = ctx.get(commandsCtx);
    commands.call(setAlignCommand.key, direction);
    requestAnimationFrame(() => {
      ctx.get(editorViewCtx).focus();
    });
  };
  return {
    onAddRow,
    onAddCol,
    selectCol,
    selectRow,
    deleteSelected,
    onAlign
  };
}

function createPointerMoveHandler(refs, view) {
  return throttle((e) => {
    if (!(view == null ? void 0 : view.editable)) return;
    const {
      contentWrapperRef,
      yLineHandleRef,
      xLineHandleRef,
      colHandleRef,
      rowHandleRef,
      hoverIndex,
      lineHoverIndex
    } = refs;
    const yHandle = yLineHandleRef.value;
    if (!yHandle) return;
    const xHandle = xLineHandleRef.value;
    if (!xHandle) return;
    const content = contentWrapperRef.value;
    if (!content) return;
    const rowHandle = rowHandleRef.value;
    if (!rowHandle) return;
    const colHandle = colHandleRef.value;
    if (!colHandle) return;
    const index = findPointerIndex(e, view);
    if (!index) return;
    const dom = getRelatedDOM(contentWrapperRef, index);
    if (!dom) return;
    const [rowIndex, colIndex] = index;
    const boundary = dom.col.getBoundingClientRect();
    const closeToBoundaryLeft = Math.abs(e.clientX - boundary.left) < 8;
    const closeToBoundaryRight = Math.abs(boundary.right - e.clientX) < 8;
    const closeToBoundaryTop = Math.abs(e.clientY - boundary.top) < 8;
    const closeToBoundaryBottom = Math.abs(boundary.bottom - e.clientY) < 8;
    const closeToBoundary = closeToBoundaryLeft || closeToBoundaryRight || closeToBoundaryTop || closeToBoundaryBottom;
    const rowButtonGroup = rowHandle.querySelector(".button-group");
    const colButtonGroup = colHandle.querySelector(".button-group");
    if (rowButtonGroup) rowButtonGroup.dataset.show = "false";
    if (colButtonGroup) colButtonGroup.dataset.show = "false";
    if (closeToBoundary) {
      const contentBoundary = content.getBoundingClientRect();
      rowHandle.dataset.show = "false";
      colHandle.dataset.show = "false";
      xHandle.dataset.displayType = "tool";
      yHandle.dataset.displayType = "tool";
      const yHandleWidth = yHandle.getBoundingClientRect().width;
      const xHandleHeight = xHandle.getBoundingClientRect().height;
      if (closeToBoundaryLeft || closeToBoundaryRight) {
        lineHoverIndex.value[1] = closeToBoundaryLeft ? colIndex : colIndex + 1;
        computePosition(dom.col, yHandle, {
          placement: closeToBoundaryLeft ? "left" : "right",
          middleware: [offset(closeToBoundaryLeft ? -1 * yHandleWidth : 0)]
        }).then(({ x }) => {
          yHandle.dataset.show = "true";
          Object.assign(yHandle.style, {
            height: `${contentBoundary.height}px`,
            left: `${x}px`
          });
        }).catch(console.error);
      } else {
        yHandle.dataset.show = "false";
      }
      if (index[0] !== 0 && (closeToBoundaryTop || closeToBoundaryBottom)) {
        lineHoverIndex.value[0] = closeToBoundaryTop ? rowIndex : rowIndex + 1;
        computePosition(dom.row, xHandle, {
          placement: closeToBoundaryTop ? "top" : "bottom",
          middleware: [offset(closeToBoundaryTop ? -1 * xHandleHeight : 0)]
        }).then(({ y }) => {
          xHandle.dataset.show = "true";
          Object.assign(xHandle.style, {
            width: `${contentBoundary.width}px`,
            top: `${y}px`
          });
        }).catch(console.error);
      } else {
        xHandle.dataset.show = "false";
      }
      return;
    }
    lineHoverIndex.value = [-1, -1];
    yHandle.dataset.show = "false";
    xHandle.dataset.show = "false";
    rowHandle.dataset.show = "true";
    colHandle.dataset.show = "true";
    computeRowHandlePositionByIndex({
      refs,
      index
    });
    computeColHandlePositionByIndex({
      refs,
      index
    });
    hoverIndex.value = index;
  }, 20);
}
function createPointerLeaveHandler(refs) {
  return () => {
    const { rowHandleRef, colHandleRef, yLineHandleRef, xLineHandleRef } = refs;
    setTimeout(() => {
      const rowHandle = rowHandleRef.value;
      if (!rowHandle) return;
      const colHandle = colHandleRef.value;
      if (!colHandle) return;
      const yHandle = yLineHandleRef.value;
      if (!yHandle) return;
      const xHandle = xLineHandleRef.value;
      if (!xHandle) return;
      rowHandle.dataset.show = "false";
      colHandle.dataset.show = "false";
      yHandle.dataset.show = "false";
      xHandle.dataset.show = "false";
    }, 200);
  };
}
function usePointerHandlers(refs, view) {
  const pointerMove = createPointerMoveHandler(refs, view);
  const pointerLeave = createPointerLeaveHandler(refs);
  return {
    pointerMove,
    pointerLeave
  };
}

keepAlive(h);
const TableBlock = defineComponent({
  props: {
    view: {
      type: Object,
      required: true
    },
    ctx: {
      type: Object,
      required: true
    },
    getPos: {
      type: Function,
      required: true
    },
    config: {
      type: Object,
      required: true
    },
    onMount: {
      type: Function,
      required: true
    },
    node: {
      type: Object,
      required: true
    }
  },
  setup({ view, node, ctx, getPos, config, onMount }) {
    const contentWrapperRef = ref();
    const contentWrapperFunctionRef = (div) => {
      if (div == null) return;
      if (div instanceof HTMLElement) {
        contentWrapperRef.value = div;
        onMount(div);
      } else {
        contentWrapperRef.value = void 0;
      }
    };
    const colHandleRef = ref();
    const rowHandleRef = ref();
    const xLineHandleRef = ref();
    const yLineHandleRef = ref();
    const tableWrapperRef = ref();
    const dragPreviewRef = ref();
    const hoverIndex = ref([0, 0]);
    const lineHoverIndex = ref([-1, -1]);
    const dragInfo = ref();
    const refs = {
      dragPreviewRef,
      tableWrapperRef,
      contentWrapperRef,
      yLineHandleRef,
      xLineHandleRef,
      colHandleRef,
      rowHandleRef,
      hoverIndex,
      lineHoverIndex,
      dragInfo
    };
    const { pointerLeave, pointerMove } = usePointerHandlers(refs, view);
    const { dragRow, dragCol } = useDragHandlers(refs, ctx, getPos);
    const {
      onAddRow,
      onAddCol,
      selectCol,
      selectRow,
      deleteSelected,
      onAlign
    } = useOperation(refs, ctx, getPos);
    onMounted(() => {
      requestAnimationFrame(() => {
        if (view.editable) recoveryStateBetweenUpdate(refs, view, node.value);
      });
    });
    return () => {
      return /* @__PURE__ */ h(
        "div",
        {
          onDragstart: (e) => e.preventDefault(),
          onDragover: (e) => e.preventDefault(),
          onDragleave: (e) => e.preventDefault(),
          onPointermove: pointerMove,
          onPointerleave: pointerLeave
        },
        /* @__PURE__ */ h(
          "div",
          {
            "data-show": "false",
            contenteditable: "false",
            draggable: "true",
            "data-role": "col-drag-handle",
            class: "handle cell-handle",
            onDragstart: dragCol,
            onClick: selectCol,
            onPointerdown: (e) => e.stopPropagation(),
            onPointermove: (e) => e.stopPropagation(),
            ref: colHandleRef
          },
          /* @__PURE__ */ h(Icon, { icon: config.renderButton("col_drag_handle") }),
          /* @__PURE__ */ h(
            "div",
            {
              "data-show": "false",
              class: "button-group",
              onPointermove: (e) => e.stopPropagation()
            },
            /* @__PURE__ */ h("button", { type: "button", onPointerdown: onAlign("left") }, /* @__PURE__ */ h(Icon, { icon: config.renderButton("align_col_left") })),
            /* @__PURE__ */ h("button", { type: "button", onPointerdown: onAlign("center") }, /* @__PURE__ */ h(Icon, { icon: config.renderButton("align_col_center") })),
            /* @__PURE__ */ h("button", { type: "button", onPointerdown: onAlign("right") }, /* @__PURE__ */ h(Icon, { icon: config.renderButton("align_col_right") })),
            /* @__PURE__ */ h("button", { type: "button", onPointerdown: deleteSelected }, /* @__PURE__ */ h(Icon, { icon: config.renderButton("delete_col") }))
          )
        ),
        /* @__PURE__ */ h(
          "div",
          {
            "data-show": "false",
            contenteditable: "false",
            draggable: "true",
            "data-role": "row-drag-handle",
            class: "handle cell-handle",
            onDragstart: dragRow,
            onClick: selectRow,
            onPointerdown: (e) => e.stopPropagation(),
            onPointermove: (e) => e.stopPropagation(),
            ref: rowHandleRef
          },
          /* @__PURE__ */ h(Icon, { icon: config.renderButton("row_drag_handle") }),
          /* @__PURE__ */ h(
            "div",
            {
              "data-show": "false",
              class: "button-group",
              onPointermove: (e) => e.stopPropagation()
            },
            /* @__PURE__ */ h("button", { type: "button", onPointerdown: deleteSelected }, /* @__PURE__ */ h(Icon, { icon: config.renderButton("delete_row") }))
          )
        ),
        /* @__PURE__ */ h("div", { class: "table-wrapper", ref: tableWrapperRef }, /* @__PURE__ */ h(
          "div",
          {
            "data-show": "false",
            class: "drag-preview",
            "data-direction": "vertical",
            ref: dragPreviewRef
          },
          /* @__PURE__ */ h("table", null, /* @__PURE__ */ h("tbody", null))
        ), /* @__PURE__ */ h(
          "div",
          {
            "data-show": "false",
            contenteditable: "false",
            "data-display-type": "tool",
            "data-role": "x-line-drag-handle",
            class: "handle line-handle",
            onPointermove: (e) => e.stopPropagation(),
            ref: xLineHandleRef
          },
          /* @__PURE__ */ h("button", { type: "button", onClick: onAddRow, class: "add-button" }, /* @__PURE__ */ h(Icon, { icon: config.renderButton("add_row") }))
        ), /* @__PURE__ */ h(
          "div",
          {
            "data-show": "false",
            contenteditable: "false",
            "data-display-type": "tool",
            "data-role": "y-line-drag-handle",
            class: "handle line-handle",
            onPointermove: (e) => e.stopPropagation(),
            ref: yLineHandleRef
          },
          /* @__PURE__ */ h("button", { type: "button", onClick: onAddCol, class: "add-button" }, /* @__PURE__ */ h(Icon, { icon: config.renderButton("add_col") }))
        ), /* @__PURE__ */ h("table", { ref: contentWrapperFunctionRef, class: "children" }))
      );
    };
  }
});

var __typeError = (msg) => {
  throw TypeError(msg);
};
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var _TableNodeView_instances, handleClick_fn;
class TableNodeView {
  constructor(ctx, node, view, getPos) {
    this.ctx = ctx;
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    __privateAdd(this, _TableNodeView_instances);
    const dom = document.createElement("div");
    dom.className = "milkdown-table-block";
    const contentDOM = document.createElement("tbody");
    this.contentDOM = contentDOM;
    contentDOM.setAttribute("data-content-dom", "true");
    contentDOM.classList.add("content-dom");
    this.nodeRef = shallowRef(node);
    const app = createApp(TableBlock, {
      view,
      ctx,
      getPos,
      config: ctx.get(tableBlockConfig.key),
      onMount: (div) => {
        div.appendChild(contentDOM);
      },
      node: this.nodeRef
    });
    app.mount(dom);
    this.app = app;
    this.dom = dom;
  }
  update(node) {
    if (node.type !== this.node.type) return false;
    if (node.sameMarkup(this.node) && node.content.eq(this.node.content))
      return false;
    this.node = node;
    this.nodeRef.value = node;
    return true;
  }
  stopEvent(e) {
    if (e.type === "drop" || e.type.startsWith("drag")) return true;
    if (e.type === "mousedown" || e.type === "pointerdown") {
      if (e.target instanceof Element && e.target.closest("button")) return true;
      const target = e.target;
      if (target instanceof HTMLElement && (target.closest("th") || target.closest("td"))) {
        const event = e;
        return __privateMethod(this, _TableNodeView_instances, handleClick_fn).call(this, event);
      }
    }
    return false;
  }
  ignoreMutation(mutation) {
    if (!this.dom || !this.contentDOM) return true;
    if (mutation.type === "selection") return false;
    if (this.contentDOM === mutation.target && mutation.type === "attributes")
      return true;
    if (this.contentDOM.contains(mutation.target)) return false;
    return true;
  }
  destroy() {
    this.app.unmount();
    this.dom.remove();
    this.contentDOM.remove();
  }
}
_TableNodeView_instances = new WeakSet();
handleClick_fn = function(event) {
  const view = this.view;
  if (!view.editable) return false;
  const { state, dispatch } = view;
  const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!pos) return false;
  const $pos = state.doc.resolve(pos.inside);
  const node = findParent(
    (node2) => node2.type.name === "table_cell" || node2.type.name === "table_header"
  )($pos);
  if (!node) return false;
  if (state.selection instanceof TextSelection) {
    const currentNode = findParent(
      (node2) => node2.type.name === "table_cell" || node2.type.name === "table_header"
    )(state.selection.$from);
    if ((currentNode == null ? void 0 : currentNode.node) === node.node) return false;
  }
  const { from } = node;
  const selection = NodeSelection.create(state.doc, from + 1);
  if (state.selection.eq(selection)) return false;
  if (state.selection instanceof CellSelection) {
    setTimeout(() => {
      dispatch(state.tr.setSelection(selection).scrollIntoView());
    }, 20);
  } else {
    requestAnimationFrame(() => {
      dispatch(state.tr.setSelection(selection).scrollIntoView());
    });
  }
  return true;
};
const tableBlockView = $view(
  tableSchema.node,
  (ctx) => {
    return (initialNode, view, getPos) => {
      return new TableNodeView(ctx, initialNode, view, getPos);
    };
  }
);
withMeta(tableBlockView, {
  displayName: "NodeView<table-block>",
  group: "TableBlock"
});

const tableBlock = [tableBlockConfig, tableBlockView];

export { TableNodeView, tableBlock, tableBlockConfig, tableBlockView };
//# sourceMappingURL=index.js.map
