import type { Slice } from '@milkdown/prose/model';
import type { EditorView } from '@milkdown/prose/view';
import { type MilkdownPlugin } from '@milkdown/ctx';
export type PasteRule = {
    run: (slice: Slice, view: EditorView, isPlainText: boolean) => Slice;
    priority?: number;
};
export declare const pasteRulesCtx: import("@milkdown/ctx").SliceType<PasteRule[], "pasteRule">;
export declare const pasteRulesTimerCtx: import("@milkdown/ctx").SliceType<import("@milkdown/ctx").TimerType[], "pasteRuleTimer">;
export declare const PasteRulesReady: import("@milkdown/ctx").TimerType;
export declare const pasteRule: MilkdownPlugin;
//# sourceMappingURL=paste-rule.d.ts.map