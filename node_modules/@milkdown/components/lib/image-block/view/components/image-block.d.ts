import { type Ref } from 'vue';
import type { ImageBlockConfig } from '../../config';
type Attrs = {
    src: string;
    caption: string;
    ratio: number;
};
export type MilkdownImageBlockProps = {
    selected: Ref<boolean>;
    readonly: Ref<boolean>;
    setAttr: <T extends keyof Attrs>(attr: T, value: Attrs[T]) => void;
    config: ImageBlockConfig;
} & {
    [P in keyof Attrs]: Ref<Attrs[P] | undefined>;
};
export declare const MilkdownImageBlock: import("vue").DefineComponent<MilkdownImageBlockProps, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<MilkdownImageBlockProps> & Readonly<{}>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>;
export {};
//# sourceMappingURL=image-block.d.ts.map