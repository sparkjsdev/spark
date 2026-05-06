import init_wasm from "spark-rs";
import WASM from "spark-rs/spark_rs_bg.wasm?arraybuffer&base64";

export const WASM_MODULE = WebAssembly.compile(WASM);

// Flag indicating if the spark-rs project has been initialized
let initialized = false;

/**
 * Promise for module instantiation, ensuring calls to
 * imports from the spark-rs project can be used.
 */
export const initialization = init_wasm({ module_or_path: WASM_MODULE }).then(
  (_) => {
    initialized = true;
  },
);

/**
 * Indicates if the wasm module instantiation has completed or not.
 */
export function isInitialized() {
  return initialized;
}
