export declare const WASM_MODULE: Promise<WebAssembly.Module>;
/**
 * Promise for module instantiation, ensuring calls to
 * imports from the spark-rs project can be used.
 */
export declare const initialization: Promise<void>;
/**
 * Indicates if the wasm module instantiation has completed or not.
 */
export declare function isInitialized(): boolean;
