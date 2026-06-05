import type { DefineFeature } from '../shared';
interface ImageBlockConfig {
    onUpload: (file: File) => Promise<string>;
    proxyDomURL: (url: string) => Promise<string> | string;
    inlineImageIcon: string;
    inlineConfirmButton: string;
    inlineUploadButton: string;
    inlineUploadPlaceholderText: string;
    inlineOnUpload: (file: File) => Promise<string>;
    blockImageIcon: string;
    blockConfirmButton: string;
    blockCaptionIcon: string;
    blockUploadButton: string;
    blockCaptionPlaceholderText: string;
    blockUploadPlaceholderText: string;
    blockOnUpload: (file: File) => Promise<string>;
    onImageLoadError: (event: Event) => void | Promise<void>;
    maxWidth: number;
    maxHeight: number;
}
export type ImageBlockFeatureConfig = Partial<ImageBlockConfig>;
export declare const imageBlock: DefineFeature<ImageBlockFeatureConfig>;
export {};
//# sourceMappingURL=index.d.ts.map