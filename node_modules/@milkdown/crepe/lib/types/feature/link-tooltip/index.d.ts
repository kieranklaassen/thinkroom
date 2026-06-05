import type { DefineFeature } from '../shared';
interface LinkTooltipConfig {
    linkIcon: string;
    editButton: string;
    removeButton: string;
    confirmButton: string;
    inputPlaceholder: string;
    onCopyLink: (link: string) => void;
}
export type LinkTooltipFeatureConfig = Partial<LinkTooltipConfig>;
export declare const linkTooltip: DefineFeature<LinkTooltipFeatureConfig>;
export {};
//# sourceMappingURL=index.d.ts.map