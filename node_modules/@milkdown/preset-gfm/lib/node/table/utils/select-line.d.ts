import type { Transaction } from '@milkdown/prose/state';
export declare function selectLine(type: 'row' | 'col'): (index: number, pos?: number) => (tr: Transaction) => Transaction;
export declare const selectRow: (index: number, pos?: number) => (tr: Transaction) => Transaction;
export declare const selectCol: (index: number, pos?: number) => (tr: Transaction) => Transaction;
//# sourceMappingURL=select-line.d.ts.map