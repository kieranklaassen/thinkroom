import type { MilkdownPlugin, TimerType } from '@milkdown/ctx';
import type { MarkSchema, NodeSchema } from '@milkdown/transformer';
import { Schema } from '@milkdown/prose/model';
export declare const SchemaReady: TimerType;
export declare const schemaTimerCtx: import("@milkdown/ctx").SliceType<TimerType[], "schemaTimer">;
export declare const schemaCtx: import("@milkdown/ctx").SliceType<Schema<any, any>, "schema">;
export declare const nodesCtx: import("@milkdown/ctx").SliceType<[string, NodeSchema][], "nodes">;
export declare const marksCtx: import("@milkdown/ctx").SliceType<[string, MarkSchema][], "marks">;
export declare const schema: MilkdownPlugin;
//# sourceMappingURL=schema.d.ts.map