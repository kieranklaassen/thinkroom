type IconProps = {
    icon?: string | null;
    class?: string;
    onClick?: (event: PointerEvent) => void;
};
export declare function Icon({ icon, class: className, onClick }: IconProps): import("vue/jsx-runtime").JSX.Element;
export declare namespace Icon {
    var props: {
        icon: {
            type: StringConstructor;
            required: boolean;
        };
        class: {
            type: StringConstructor;
            required: boolean;
        };
        onClick: {
            type: FunctionConstructor;
            required: boolean;
        };
    };
}
export {};
//# sourceMappingURL=icon.d.ts.map