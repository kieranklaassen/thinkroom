import type { DefineFeature } from '../shared';
interface TableConfig {
    addRowIcon: string;
    addColIcon: string;
    deleteRowIcon: string;
    deleteColIcon: string;
    alignLeftIcon: string;
    alignCenterIcon: string;
    alignRightIcon: string;
    colDragHandleIcon: string;
    rowDragHandleIcon: string;
}
export type TableFeatureConfig = Partial<TableConfig>;
export declare const table: DefineFeature<TableFeatureConfig>;
export {};
//# sourceMappingURL=index.d.ts.map