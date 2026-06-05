import { type Ref } from 'vue';
import type { LinkTooltipConfig } from '../slices';
type PreviewLinkProps = {
    config: Ref<LinkTooltipConfig>;
    src: Ref<string>;
    onEdit: Ref<() => void>;
    onRemove: Ref<() => void>;
};
export declare const PreviewLink: import("vue").DefineComponent<PreviewLinkProps, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<PreviewLinkProps> & Readonly<{}>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>;
export {};
//# sourceMappingURL=component.d.ts.map