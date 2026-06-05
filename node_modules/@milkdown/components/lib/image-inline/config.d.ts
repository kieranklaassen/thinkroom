export interface InlineImageConfig {
    imageIcon: string | undefined;
    uploadButton: string | undefined;
    confirmButton: string | undefined;
    uploadPlaceholderText: string;
    onUpload: (file: File) => Promise<string>;
    proxyDomURL?: (url: string) => Promise<string> | string;
}
export declare const defaultInlineImageConfig: InlineImageConfig;
export declare const inlineImageConfig: import("@milkdown/utils").$Ctx<InlineImageConfig, "inlineImageConfigCtx">;
//# sourceMappingURL=config.d.ts.map