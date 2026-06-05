import { type Ref } from 'vue';
import type { InlineImageConfig } from '../config';
type Attrs = {
    src: string;
    alt: string;
    title: string;
};
type MilkdownImageInlineProps = {
    selected: Ref<boolean>;
    readonly: Ref<boolean>;
    setAttr: <T extends keyof Attrs>(attr: T, value: Attrs[T]) => void;
    config: InlineImageConfig;
} & {
    [P in keyof Attrs]: Ref<Attrs[P] | undefined>;
};
export declare const MilkdownImageInline: import("vue").DefineComponent<MilkdownImageInlineProps, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<MilkdownImageInlineProps> & Readonly<{}>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>;
export {};
//# sourceMappingURL=image-inline.d.ts.map