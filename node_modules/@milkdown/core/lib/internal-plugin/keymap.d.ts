import type { Command } from '@milkdown/prose/state';
import { type Ctx, type MilkdownPlugin, type SliceType } from '@milkdown/ctx';
export type KeymapItem = {
    key: string;
    onRun: (ctx: Ctx) => Command;
    priority?: number;
};
export type KeymapKey = SliceType<KeymapItem>;
export declare class KeymapManager {
    #private;
    setCtx: (ctx: Ctx) => void;
    get ctx(): Ctx | null;
    add: (keymap: KeymapItem) => () => void;
    addObjectKeymap: (keymaps: Record<string, Command | KeymapItem>) => () => void;
    addBaseKeymap: () => () => void;
    build: () => Record<string, Command>;
}
export declare const keymapCtx: SliceType<KeymapManager, "keymap">;
export declare const keymapTimerCtx: SliceType<import("@milkdown/ctx").TimerType[], "keymapTimer">;
export declare const KeymapReady: import("@milkdown/ctx").TimerType;
export declare const keymap: MilkdownPlugin;
//# sourceMappingURL=keymap.d.ts.map