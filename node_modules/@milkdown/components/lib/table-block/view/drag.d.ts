import type { Ctx } from '@milkdown/ctx';
import type { Refs } from './types';
export declare function useDragHandlers(refs: Refs, ctx?: Ctx, getPos?: () => number | undefined): {
    dragRow: (event: DragEvent) => void;
    dragCol: (event: DragEvent) => void;
};
//# sourceMappingURL=drag.d.ts.map