export interface ImageBlockConfig {
    imageIcon: string | undefined;
    captionIcon: string | undefined;
    uploadButton: string | undefined;
    confirmButton: string | undefined;
    uploadPlaceholderText: string;
    captionPlaceholderText: string;
    onUpload: (file: File) => Promise<string>;
    proxyDomURL?: (url: string) => Promise<string> | string;
    onImageLoadError?: (event: Event) => void | Promise<void>;
    maxWidth?: number;
    maxHeight?: number;
}
export declare const defaultImageBlockConfig: ImageBlockConfig;
export declare const imageBlockConfig: import("@milkdown/utils").$Ctx<ImageBlockConfig, "imageBlockConfigCtx">;
//# sourceMappingURL=config.d.ts.map