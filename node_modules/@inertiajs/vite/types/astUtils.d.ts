/**
 * AST Utilities for Inertia Code Transforms
 *
 * Parses JavaScript/TypeScript code using Vite's built-in `parseAst` (Rollup's parser)
 * and provides methods to find Inertia-specific patterns like `createInertiaApp()` calls,
 * framework detection, and property extraction.
 */
import type { CallExpression, ExpressionStatement, Property, SimpleCallExpression } from 'estree';
import type { FrameworkConfig } from './types';
/**
 * ESTree nodes augmented with the `start`/`end` positions Rollup's parser adds.
 */
export type NodeWithPos<T> = T & {
    start: number;
    end: number;
};
/** A top-level `createInertiaApp()` expression statement with position info. */
export interface InertiaStatement {
    statement: NodeWithPos<ExpressionStatement>;
    call: NodeWithPos<SimpleCallExpression>;
}
/** Position info for the first argument of a `createInertiaApp()` call. */
export interface InertiaCallOptions {
    start: number;
    end: number;
    isEmpty: boolean;
}
/** Wraps a parsed AST with methods to find Inertia-specific patterns. */
export declare class ParsedCode {
    private ast;
    private constructor();
    /** Returns null if parsing fails (e.g. non-JS file content). */
    static from(code: string): ParsedCode | null;
    get importSources(): string[];
    detectFramework(frameworks: Record<string, FrameworkConfig>): {
        name: string;
        config: FrameworkConfig;
    } | null;
    /**
     * Find a top-level `createInertiaApp()` expression statement, ignoring any
     * `await`, `void`, or `.then()`/`.catch()` wrappers around it.
     *
     * Does not match `export default createInertiaApp()`.
     */
    get inertiaStatement(): InertiaStatement | null;
    /**
     * Unwrap an expression to find a `createInertiaApp()` call inside it.
     * Strips away `await`, `void`, and `.then()`/`.catch()` chains.
     */
    private unwrapInertiaCall;
    /** Find a top-level `createServer()` call (not nested in exports). */
    get createServerStatement(): NodeWithPos<ExpressionStatement> | null;
    /**
     * Find all `createInertiaApp()` calls, including those nested inside exports.
     */
    get inertiaCalls(): CallExpression[];
    get pagesProperty(): NodeWithPos<Property> | null;
    /** Find a `createInertiaApp()` call that has no `pages` or `resolve` property yet. */
    get callWithoutResolver(): {
        callEnd: number;
        options?: InertiaCallOptions;
    } | null;
    private isInertiaCall;
    private walkAst;
}
/**
 * Supports regular strings and simple template literals without expressions.
 */
export declare function extractString(node: Property['value']): string | undefined;
/** Each element is passed through `extractString`, non-strings are skipped. */
export declare function extractStringArray(node: Property['value']): string[] | undefined;
export declare function extractBoolean(node: Property['value']): boolean | undefined;
