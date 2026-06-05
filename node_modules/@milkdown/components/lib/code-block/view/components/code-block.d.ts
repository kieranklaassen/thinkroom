import type { EditorView as CodeMirror } from '@codemirror/view';
import { type Ref } from 'vue';
import type { CodeBlockConfig } from '../../config';
import type { LanguageInfo } from '../loader';
export type CodeBlockProps = {
    text: Ref<string>;
    selected: Ref<boolean>;
    getReadOnly: () => boolean;
    codemirror: CodeMirror;
    language: Ref<string>;
    getAllLanguages: () => Array<LanguageInfo>;
    setLanguage: (language: string) => void;
    config: Omit<CodeBlockConfig, 'languages' | 'extensions'>;
};
export declare const CodeBlock: import("vue").DefineComponent<CodeBlockProps, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<CodeBlockProps> & Readonly<{}>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>;
//# sourceMappingURL=code-block.d.ts.map