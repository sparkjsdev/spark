/* tslint:disable */
/* eslint-disable */
export function sort_splats(num_splats: number, readback: Uint16Array, ordering: Uint32Array): number;
export function sort32_splats(num_splats: number, readback: Uint32Array, ordering: Uint32Array): number;
export function raycast_splats(origin_x: number, origin_y: number, origin_z: number, dir_x: number, dir_y: number, dir_z: number, near: number, far: number, num_splats: number, packed_splats: Uint32Array, raycast_ellipsoid: boolean, ln_scale_min: number, ln_scale_max: number): Float32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly raycast_splats: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: any, k: number, l: number, m: number) => any;
  readonly sort32_splats: (a: number, b: any, c: any) => number;
  readonly sort_splats: (a: number, b: any, c: any) => number;
  readonly __wbindgen_export_0: WebAssembly.Table;
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
