import type { Ctx, MilkdownPlugin } from '@milkdown/ctx';
import type { Command } from '@milkdown/prose/state';
import { type KeymapItem } from '@milkdown/core';
export type Keymap = Record<string, Command | KeymapItem>;
export type $Shortcut = MilkdownPlugin & {
    keymap: Keymap;
};
export declare function $shortcut(shortcut: (ctx: Ctx) => Keymap): $Shortcut;
export declare function $shortcutAsync(shortcut: (ctx: Ctx) => Promise<Keymap>, timerName?: string): import("./utils").WithTimer<$Shortcut>;
//# sourceMappingURL=$shortcut.d.ts.map