import type { Ctx } from '@milkdown/ctx';
import type { Node } from '@milkdown/prose/model';
import type { EditorView, NodeView, NodeViewConstructor, ViewMutationRecord } from '@milkdown/prose/view';
import { type App, type ShallowRef } from 'vue';
export declare class TableNodeView implements NodeView {
    #private;
    ctx: Ctx;
    node: Node;
    view: EditorView;
    getPos: () => number | undefined;
    dom: HTMLElement;
    contentDOM: HTMLElement;
    app: App;
    nodeRef: ShallowRef<Node>;
    constructor(ctx: Ctx, node: Node, view: EditorView, getPos: () => number | undefined);
    update(node: Node): boolean;
    stopEvent(e: Event): boolean;
    ignoreMutation(mutation: ViewMutationRecord): boolean;
    destroy(): void;
}
export declare const tableBlockView: import("@milkdown/utils").$View<import("@milkdown/utils").$Node, NodeViewConstructor>;
//# sourceMappingURL=view.d.ts.map