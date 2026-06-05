import type { Ctx } from '@milkdown/kit/ctx';
import type { Selection } from '@milkdown/kit/prose/state';
import { type Ref, type ShallowRef } from 'vue';
import type { ToolbarFeatureConfig } from '.';
type ToolbarProps = {
    ctx: Ctx;
    hide: () => void;
    show: Ref<boolean>;
    selection: ShallowRef<Selection>;
    config?: ToolbarFeatureConfig;
};
export declare const Toolbar: import("vue").DefineComponent<ToolbarProps, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<ToolbarProps> & Readonly<{}>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>;
export {};
//# sourceMappingURL=component.d.ts.map