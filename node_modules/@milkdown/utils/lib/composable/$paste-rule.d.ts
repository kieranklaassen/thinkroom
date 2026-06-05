import type { Ctx, MilkdownPlugin } from '@milkdown/ctx';
import { type PasteRule } from '@milkdown/core';
export type $PasteRule = MilkdownPlugin & {
    pasteRule: PasteRule;
};
export declare function $pasteRule(pasteRule: (ctx: Ctx) => PasteRule): $PasteRule;
export declare function $pasteRuleAsync(pasteRule: (ctx: Ctx) => Promise<PasteRule>, timerName?: string): import("./utils").WithTimer<$PasteRule>;
//# sourceMappingURL=$paste-rule.d.ts.map