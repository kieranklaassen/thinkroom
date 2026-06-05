import type { Ctx } from '@milkdown/kit/ctx';
type MenuItem<T> = {
    index: number;
    key: string;
    onRun?: (ctx: Ctx) => void;
} & T;
type WithRange<T, HasIndex extends true | false = true> = HasIndex extends true ? T & {
    range: [start: number, end: number];
} : T;
export type MenuItemGroup<T, HasIndex extends true | false = true> = WithRange<{
    key: string;
    label: string;
    items: HasIndex extends true ? MenuItem<T>[] : Omit<MenuItem<T>, 'index'>[];
}, HasIndex>;
export declare class GroupBuilder<T> {
    #private;
    clear: () => this;
    addGroup: (key: string, label: string) => {
        group: {
            key: string;
            label: string;
            items: Omit<MenuItem<T>, "index">[];
        };
        addItem: (key: string, item: Omit<MenuItem<T>, "key" | "index">) => /*elided*/ any;
        clear: () => /*elided*/ any;
    };
    getGroup: (key: string) => {
        group: {
            key: string;
            label: string;
            items: Omit<MenuItem<T>, "index">[];
        };
        addItem: (key: string, item: Omit<MenuItem<T>, "key" | "index">) => /*elided*/ any;
        clear: () => /*elided*/ any;
    };
    build: () => {
        key: string;
        label: string;
        items: Omit<MenuItem<T>, "index">[];
    }[];
}
export {};
//# sourceMappingURL=group-builder.d.ts.map