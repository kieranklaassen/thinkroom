import { type Ref } from 'vue';
import type { CodeBlockProps } from './code-block';
type PreviewPanelProps = Pick<CodeBlockProps, 'text' | 'language' | 'config'> & {
    previewOnlyMode: Ref<boolean>;
    preview: Ref<string | HTMLElement | null>;
};
export declare const PreviewPanel: import("vue").DefineComponent<PreviewPanelProps, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<PreviewPanelProps> & Readonly<{}>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>;
export {};
//# sourceMappingURL=preview-panel.d.ts.map