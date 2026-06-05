import type { Ctx } from '@milkdown/ctx';
import type { Node } from '@milkdown/prose/model';
import type { EditorView } from '@milkdown/prose/view';
import { type Ref } from 'vue';
import type { TableBlockConfig } from '../config';
type TableBlockProps = {
    view: EditorView;
    ctx: Ctx;
    getPos: () => number | undefined;
    config: TableBlockConfig;
    onMount: (div: Element) => void;
    node: Ref<Node>;
};
export declare const TableBlock: import("vue").DefineComponent<TableBlockProps, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<TableBlockProps> & Readonly<{}>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>;
export {};
//# sourceMappingURL=component.d.ts.map