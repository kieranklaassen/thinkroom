import { type Ref } from 'vue';
type ImageInputProps = {
    src: Ref<string | undefined>;
    selected: Ref<boolean>;
    readonly: Ref<boolean>;
    setLink: (link: string) => void;
    imageIcon?: string;
    uploadButton?: string;
    confirmButton?: string;
    uploadPlaceholderText?: string;
    className?: string;
    onUpload: (file: File) => Promise<string>;
    onImageLoadError?: (event: Event) => void | Promise<void>;
};
export declare const ImageInput: import("vue").DefineComponent<ImageInputProps, {}, {}, {}, {}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<ImageInputProps> & Readonly<{}>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, false, {}, any>;
export {};
//# sourceMappingURL=image-input.d.ts.map