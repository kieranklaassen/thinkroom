import type { LanguageDescription } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
export interface CodeBlockConfig {
    extensions: Extension[];
    languages: LanguageDescription[];
    expandIcon: string;
    searchIcon: string;
    clearSearchIcon: string;
    searchPlaceholder: string;
    noResultText: string;
    copyText: string;
    copyIcon: string;
    onCopy?: (text: string) => void;
    renderLanguage: (language: string, selected: boolean) => string;
    renderPreview: (language: string, content: string, applyPreview: (value: null | string | HTMLElement) => void) => void | null | string | HTMLElement;
    previewToggleButton: (previewOnlyMode: boolean) => string;
    previewLabel: string;
    previewOnlyByDefault?: boolean;
    previewLoading: string | HTMLElement;
}
export declare const defaultConfig: CodeBlockConfig;
export declare const codeBlockConfig: import("@milkdown/utils").$Ctx<CodeBlockConfig, "codeBlockConfigCtx">;
//# sourceMappingURL=config.d.ts.map