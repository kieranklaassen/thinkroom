import type { GroupBuilder } from '../../utils';
import type { DefineFeature } from '../shared';
import type { HeadingOption, TopBarItem } from './config';
interface TopBarConfig {
    headingOptions: HeadingOption[];
    boldIcon: string;
    italicIcon: string;
    strikethroughIcon: string;
    codeIcon: string;
    linkIcon: string;
    imageIcon: string;
    tableIcon: string;
    codeBlockIcon: string;
    mathIcon: string;
    quoteIcon: string;
    hrIcon: string;
    bulletListIcon: string;
    orderedListIcon: string;
    taskListIcon: string;
    chevronDownIcon: string;
    buildTopBar: (builder: GroupBuilder<TopBarItem>) => void;
}
export type TopBarFeatureConfig = Partial<TopBarConfig>;
export declare const topBar: DefineFeature<TopBarFeatureConfig>;
export {};
//# sourceMappingURL=index.d.ts.map