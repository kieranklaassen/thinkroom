import type { Ctx } from '@milkdown/kit/ctx';
import type { TopBarFeatureConfig } from '.';
export interface TopBarSelectorOption {
    label: string;
    onSelect: (ctx: Ctx) => void;
}
export interface TopBarSelector {
    options: TopBarSelectorOption[];
    activeLabel: (ctx: Ctx) => string;
    chevronIcon?: string;
}
export type TopBarItem = {
    active: (ctx: Ctx) => boolean;
    icon: string;
    selector?: TopBarSelector;
};
export type HeadingOption = {
    label: string;
    level: number | null;
};
export declare const defaultHeadingOptions: HeadingOption[];
export declare function getCurrentHeading(ctx: Ctx, options?: HeadingOption[]): HeadingOption;
export declare function setHeading(ctx: Ctx, level: number | null): void;
export declare function buildHeadingSelector(headingOptions?: HeadingOption[], chevronIcon?: string): TopBarItem;
export declare function getGroups(config?: TopBarFeatureConfig, ctx?: Ctx): {
    key: string;
    label: string;
    items: Omit<{
        index: number;
        key: string;
        onRun?: (ctx: Ctx) => void;
    } & TopBarItem, "index">[];
}[];
//# sourceMappingURL=config.d.ts.map