import { Plugin } from 'prosemirror-state';

interface VirtualCursorOptions {
    /**
     * An array of ProseMirror mark names that should be ignored when checking the
     * [`inclusive`](https://prosemirror.net/docs/ref/#model.MarkSpec.inclusive)
     * attribute. You can also set this to `true` to skip the warning altogether.
     */
    skipWarning?: string[] | true;
}
declare function createVirtualCursor(options?: VirtualCursorOptions): Plugin;

export { VirtualCursorOptions, createVirtualCursor };
