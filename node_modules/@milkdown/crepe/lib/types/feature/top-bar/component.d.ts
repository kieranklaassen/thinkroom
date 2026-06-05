import type { Ctx } from '@milkdown/kit/ctx';
import { type Ref } from 'vue';
import type { TopBarFeatureConfig } from '.';
type TopBarProps = {
    ctx: Ctx;
    version: Ref<number>;
    config?: TopBarFeatureConfig;
};
export declare const TopBar: import("vue").DefineComponent<TopBarProps, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<TopBarProps> & Readonly<{}>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>;
export {};
//# sourceMappingURL=component.d.ts.map