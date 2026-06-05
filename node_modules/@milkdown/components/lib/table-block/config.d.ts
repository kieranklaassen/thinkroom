export type RenderType = 'add_row' | 'add_col' | 'delete_row' | 'delete_col' | 'align_col_left' | 'align_col_center' | 'align_col_right' | 'col_drag_handle' | 'row_drag_handle';
export interface TableBlockConfig {
    renderButton: (renderType: RenderType) => string;
}
export declare const tableBlockConfig: import("@milkdown/utils").$Ctx<{
    renderButton: (renderType: RenderType) => string;
}, "tableBlockConfigCtx">;
//# sourceMappingURL=config.d.ts.map