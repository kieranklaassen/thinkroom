import { type Ref } from 'vue';
import type { LinkTooltipConfig } from '../slices';
type EditLinkProps = {
    config: Ref<LinkTooltipConfig>;
    src: Ref<string>;
    onConfirm: (href: string) => void;
    onCancel: () => void;
};
export declare const EditLink: import("vue").DefineComponent<EditLinkProps, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<EditLinkProps> & Readonly<{}>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>;
export {};
//# sourceMappingURL=component.d.ts.map