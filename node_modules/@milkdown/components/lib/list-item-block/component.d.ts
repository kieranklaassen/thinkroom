import { type Ref } from 'vue';
import type { ListItemBlockConfig } from './config';
interface Attrs {
    label: string;
    checked: boolean;
    listType: string;
}
type ListItemProps = {
    [P in keyof Attrs]: Ref<Attrs[P]>;
} & {
    config: ListItemBlockConfig;
    readonly: Ref<boolean>;
    selected: Ref<boolean>;
    setAttr: <T extends keyof Attrs>(attr: T, value: Attrs[T]) => void;
    onMount: (div: Element) => void;
};
export declare const ListItem: import("vue").DefineComponent<ListItemProps, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<ListItemProps> & Readonly<{}>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>;
export {};
//# sourceMappingURL=component.d.ts.map