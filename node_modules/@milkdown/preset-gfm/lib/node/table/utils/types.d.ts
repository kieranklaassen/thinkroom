import type { Node, ResolvedPos } from '@milkdown/prose/model';
export interface CellPos {
    pos: number;
    start: number;
    node: Node;
}
export type CellSelectionRange = {
    $anchor: ResolvedPos;
    $head: ResolvedPos;
    indexes: number[];
};
//# sourceMappingURL=types.d.ts.map