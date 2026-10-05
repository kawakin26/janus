/* tslint:disable */
/* eslint-disable */

export function detectFileFormat(data: Uint8Array): any;

export function isJwcFile(data: Uint8Array): boolean;

export function isJwwFile(data: Uint8Array): boolean;

export function readCadDocument(data: Uint8Array): any;

export function readDocument(data: Uint8Array): any;

export function readDxfDocument(data: Uint8Array, explode_inserts: boolean, max_block_nesting: number, jwc_coordinates?: string | null, text_em_scale?: number | null): any;

export function readDxfString(data: Uint8Array, explode_inserts: boolean, max_block_nesting: number, jwc_coordinates?: string | null, target_version?: string | null, text_em_scale?: number | null): string;

export function readHeader(data: Uint8Array): any;

export function readJwcDocument(data: Uint8Array): any;

export function readJwcHeader(data: Uint8Array): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly detectFileFormat: (a: number, b: number) => [number, number, number];
    readonly isJwcFile: (a: number, b: number) => number;
    readonly isJwwFile: (a: number, b: number) => number;
    readonly readCadDocument: (a: number, b: number) => [number, number, number];
    readonly readDocument: (a: number, b: number) => [number, number, number];
    readonly readDxfDocument: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly readDxfString: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly readHeader: (a: number, b: number) => [number, number, number];
    readonly readJwcDocument: (a: number, b: number) => [number, number, number];
    readonly readJwcHeader: (a: number, b: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
