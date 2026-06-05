import { type DefaultValue, Editor } from '@milkdown/kit/core';
import { type ListenerManager } from '@milkdown/kit/plugin/listener';
import type { CrepeFeatureConfig } from '../feature';
import type { DefineFeature } from '../feature/shared';
import { CrepeFeature } from '../feature';
export interface CrepeBuilderConfig {
    root?: Node | string | null;
    defaultValue?: DefaultValue;
}
export declare class CrepeBuilder {
    #private;
    constructor({ root, defaultValue }?: CrepeBuilderConfig);
    addFeature: {
        <T extends CrepeFeature>(feature: DefineFeature<CrepeFeatureConfig[T]>, config?: CrepeFeatureConfig[T]): CrepeBuilder;
        <C>(feature: DefineFeature<C>, config?: C): CrepeBuilder;
    };
    create: () => Promise<Editor>;
    destroy: () => Promise<Editor>;
    get editor(): Editor;
    get readonly(): boolean;
    setReadonly: (value: boolean) => this;
    getMarkdown: () => string;
    on: (fn: (api: ListenerManager) => void) => this;
}
//# sourceMappingURL=builder.d.ts.map