import type { Ctx } from '@milkdown/kit/ctx';
import type { ToolbarFeatureConfig } from '.';
export type ToolbarItem = {
    active: (ctx: Ctx) => boolean;
    icon: string;
};
export declare function getGroups(config?: ToolbarFeatureConfig, ctx?: Ctx): {
    key: string;
    label: string;
    items: Omit<{
        index: number;
        key: string;
        onRun?: (ctx: Ctx) => void;
    } & ToolbarItem, "index">[];
}[];
//# sourceMappingURL=config.d.ts.map