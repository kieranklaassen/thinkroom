import type { Ctx } from '@milkdown/kit/ctx';
import type { PluginView } from '@milkdown/kit/prose/state';
import { EditorState } from '@milkdown/kit/prose/state';
import { EditorView } from '@milkdown/kit/prose/view';
import type { LatexConfig } from '..';
export declare class LatexInlineTooltip implements PluginView {
    #private;
    readonly ctx: Ctx;
    constructor(ctx: Ctx, view: EditorView, config: Partial<LatexConfig>);
    update: (view: EditorView, prevState?: EditorState) => void;
    destroy: () => void;
}
//# sourceMappingURL=view.d.ts.map