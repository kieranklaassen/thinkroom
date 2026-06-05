import type { Mark } from '@milkdown/prose/model';
export interface LinkToolTipState {
    mode: 'preview' | 'edit';
}
export declare const linkTooltipState: import("@milkdown/utils").$Ctx<{
    mode: "preview" | "edit";
}, "linkTooltipStateCtx">;
export interface LinkTooltipAPI {
    addLink: (from: number, to: number) => void;
    editLink: (mark: Mark, from: number, to: number) => void;
    removeLink: (from: number, to: number) => void;
}
export declare const linkTooltipAPI: import("@milkdown/utils").$Ctx<{
    addLink: (from: number, to: number) => void;
    editLink: (mark: Mark, from: number, to: number) => void;
    removeLink: (from: number, to: number) => void;
}, "linkTooltipAPICtx">;
export interface LinkTooltipConfig {
    linkIcon: string;
    editButton: string;
    confirmButton: string;
    removeButton: string;
    onCopyLink: (link: string) => void;
    inputPlaceholder: string;
}
export declare const linkTooltipConfig: import("@milkdown/utils").$Ctx<{
    linkIcon: string;
    editButton: string;
    confirmButton: string;
    removeButton: string;
    onCopyLink: (link: string) => void;
    inputPlaceholder: string;
}, "linkTooltipConfigCtx">;
//# sourceMappingURL=slices.d.ts.map