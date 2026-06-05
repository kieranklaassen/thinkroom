import type { EditorView } from '@milkdown/kit/prose/view';
import { type ShallowRef } from 'vue';
import type { LatexConfig } from '..';
type LatexTooltipProps = {
    config: Partial<LatexConfig>;
    innerView: ShallowRef<EditorView | null>;
    updateValue: ShallowRef<() => void>;
};
export declare const LatexTooltip: import("vue").DefineComponent<LatexTooltipProps, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<LatexTooltipProps> & Readonly<{}>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>;
export {};
//# sourceMappingURL=component.d.ts.map