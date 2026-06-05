import type { DefineFeature } from '../shared';
interface PlaceholderConfig {
    text: string;
    mode: 'doc' | 'block';
}
export type PlaceholderFeatureConfig = Partial<PlaceholderConfig>;
export declare const placeholderConfig: import("@milkdown/utils").$Ctx<PlaceholderConfig, "placeholderConfigCtx">;
export declare const placeholderPlugin: import("@milkdown/utils").$Prose;
export declare const placeholder: DefineFeature<PlaceholderFeatureConfig>;
export {};
//# sourceMappingURL=index.d.ts.map