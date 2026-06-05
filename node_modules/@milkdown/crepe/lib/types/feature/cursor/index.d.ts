import type { DefineFeature } from '../shared';
interface CursorConfig {
    color: string | false;
    width: number;
    virtual: boolean;
}
export type CursorFeatureConfig = Partial<CursorConfig>;
export declare const cursor: DefineFeature<CursorFeatureConfig>;
export {};
//# sourceMappingURL=index.d.ts.map