import type { Ctx } from '@milkdown/kit/ctx';
import { type Ref } from 'vue';
import type { BlockEditFeatureConfig } from '..';
type MenuProps = {
    ctx: Ctx;
    show: Ref<boolean>;
    filter: Ref<string>;
    hide: () => void;
    config?: BlockEditFeatureConfig;
};
export declare const Menu: import("vue").DefineComponent<MenuProps, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<MenuProps> & Readonly<{}>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>;
export {};
//# sourceMappingURL=component.d.ts.map