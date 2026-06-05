import type { Extension } from '@codemirror/state';
import { type CodeBlockConfig } from '@milkdown/kit/component/code-block';
import type { DefineFeature } from '../shared';
interface CodeMirrorConfig extends CodeBlockConfig {
    theme: Extension;
    previewToggleIcon: (previewOnlyMode: boolean) => string;
    previewToggleText: (previewOnlyMode: boolean) => string;
}
export type CodeMirrorFeatureConfig = Partial<CodeMirrorConfig>;
export declare const codeMirror: DefineFeature<CodeMirrorFeatureConfig>;
export {};
//# sourceMappingURL=index.d.ts.map