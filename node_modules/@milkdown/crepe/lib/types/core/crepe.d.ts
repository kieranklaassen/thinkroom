import type { CrepeFeatureConfig } from '../feature';
import { CrepeFeature } from '../feature';
import { CrepeBuilder, type CrepeBuilderConfig } from './builder';
export interface CrepeConfig extends CrepeBuilderConfig {
    features?: Partial<Record<CrepeFeature, boolean>>;
    featureConfigs?: CrepeFeatureConfig;
}
export declare class Crepe extends CrepeBuilder {
    static Feature: typeof CrepeFeature;
    constructor({ features, featureConfigs, ...crepeBuilderConfig }?: CrepeConfig);
}
//# sourceMappingURL=crepe.d.ts.map