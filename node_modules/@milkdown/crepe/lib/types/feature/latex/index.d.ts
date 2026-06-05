import type { KatexOptions } from 'katex';
import type { DefineFeature } from '../shared';
export interface LatexConfig {
    katexOptions: KatexOptions;
    inlineEditConfirm: string;
}
export type LatexFeatureConfig = Partial<LatexConfig>;
export declare const latex: DefineFeature<LatexFeatureConfig>;
//# sourceMappingURL=index.d.ts.map