import type { ComputePositionConfig, Middleware, OffsetOptions, Placement } from '@floating-ui/dom';
import type { Ctx } from '@milkdown/ctx';
import type { EditorState } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import type { ActiveNode } from './types';
export interface DeriveContext {
    ctx: Ctx;
    active: ActiveNode;
    editorDom: HTMLElement;
    blockDom: HTMLElement;
}
export interface BlockProviderOptions {
    ctx: Ctx;
    content: HTMLElement;
    shouldShow?: (view: EditorView, prevState?: EditorState) => boolean;
    getOffset?: (deriveContext: DeriveContext) => OffsetOptions;
    getPosition?: (deriveContext: DeriveContext) => Omit<DOMRect, 'toJSON'>;
    getPlacement?: (deriveContext: DeriveContext) => Placement;
    middleware?: Middleware[];
    floatingUIOptions?: Partial<ComputePositionConfig>;
    root?: HTMLElement;
}
export declare class BlockProvider {
    #private;
    get active(): Readonly<{
        $pos: import("prosemirror-model").ResolvedPos;
        node: import("prosemirror-model").Node;
        el: HTMLElement;
    }> | null;
    constructor(options: BlockProviderOptions);
    update: () => void;
    destroy: () => void;
    show: (active: ActiveNode) => void;
    hide: () => void;
}
//# sourceMappingURL=block-provider.d.ts.map