import type { Ctx } from '@milkdown/kit/ctx';
import type { BlockEditFeatureConfig } from '../index';
import type { SlashMenuItem } from './utils';
import { type MenuItemGroup } from '../../../utils/group-builder';
export declare function getGroups(filter?: string, config?: BlockEditFeatureConfig, ctx?: Ctx): {
    groups: MenuItemGroup<SlashMenuItem>[];
    size: number;
};
//# sourceMappingURL=config.d.ts.map