import { type Ctx } from '@milkdown/kit/ctx';
import type { CrepeFeature } from '../feature';
import type { CrepeBuilder } from './builder';
export declare const FeaturesCtx: import("@milkdown/ctx").SliceType<CrepeFeature[], "FeaturesCtx">;
export declare const CrepeCtx: import("@milkdown/ctx").SliceType<CrepeBuilder, "CrepeCtx">;
export declare function useCrepe(ctx: Ctx): CrepeBuilder;
export declare function useCrepeFeatures(ctx: Ctx): import("@milkdown/ctx").Slice<CrepeFeature[], "FeaturesCtx">;
export declare function crepeFeatureConfig(feature: CrepeFeature): (ctx: Ctx) => void;
//# sourceMappingURL=slice.d.ts.map