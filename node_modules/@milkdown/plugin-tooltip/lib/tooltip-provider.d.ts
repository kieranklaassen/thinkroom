import type { ComputePositionConfig, Middleware, OffsetOptions, ShiftOptions, VirtualElement } from '@floating-ui/dom';
import type { EditorState } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
export interface TooltipProviderOptions {
    content: HTMLElement;
    debounce?: number;
    shouldShow?: (view: EditorView, prevState?: EditorState) => boolean;
    offset?: OffsetOptions;
    shift?: ShiftOptions;
    middleware?: Middleware[];
    floatingUIOptions?: Partial<ComputePositionConfig>;
    root?: HTMLElement;
}
export declare class TooltipProvider {
    #private;
    element: HTMLElement;
    onShow: () => void;
    onHide: () => void;
    constructor(options: TooltipProviderOptions);
    update: (view: EditorView, prevState?: EditorState) => void;
    destroy: () => void;
    show: (virtualElement?: VirtualElement, editorView?: EditorView) => void;
    hide: () => void;
}
//# sourceMappingURL=tooltip-provider.d.ts.map