import { Node, type Attrs, type MarkType, type NodeType } from '@milkdown/prose/model';
export declare const isMarkSelectedCommand: import("@milkdown/utils").$Command<MarkType>;
export declare const isNodeSelectedCommand: import("@milkdown/utils").$Command<NodeType>;
export declare const clearTextInCurrentBlockCommand: import("@milkdown/utils").$Command<unknown>;
export declare const setBlockTypeCommand: import("@milkdown/utils").$Command<{
    nodeType: NodeType;
    attrs?: Attrs | null;
}>;
export declare const wrapInBlockTypeCommand: import("@milkdown/utils").$Command<{
    nodeType: NodeType;
    attrs?: Attrs | null;
}>;
export declare const addBlockTypeCommand: import("@milkdown/utils").$Command<{
    nodeType: NodeType | Node;
    attrs?: Attrs | null;
}>;
export declare const selectTextNearPosCommand: import("@milkdown/utils").$Command<{
    pos?: number;
}>;
//# sourceMappingURL=index.d.ts.map