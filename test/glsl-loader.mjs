import { readFile } from "node:fs/promises";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "spark-rs") {
    return {
      shortCircuit: true,
      url: "spark-rs:module",
    };
  }

  if (specifier === "spark-rs/spark_rs_bg.wasm?arraybuffer&base64") {
    return {
      shortCircuit: true,
      url: "spark-rs:wasm",
    };
  }

  if (specifier.endsWith("?worker&inline")) {
    return {
      shortCircuit: true,
      url: "spark:worker",
    };
  }

  if (specifier.endsWith(".glsl")) {
    return {
      shortCircuit: true,
      url: new URL(specifier, context.parentURL).href,
    };
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === "spark-rs:module") {
    return {
      format: "module",
      shortCircuit: true,
      source: `
        const unimplemented = () => {
          throw new Error("spark-rs test shim should not be executed");
        };
        export default async function init_wasm() {}
        export const sort_splats = unimplemented;
        export const sort32_splats = unimplemented;
        export const decode_to_gsplatarray = unimplemented;
        export const decode_to_csplatarray = unimplemented;
        export const decode_to_packedsplats = unimplemented;
        export const new_lod_tree = unimplemented;
        export const new_shared_lod_tree = unimplemented;
        export const init_lod_tree = unimplemented;
        export const dispose_lod_tree = unimplemented;
        export const traverse_lod_trees = unimplemented;
        export const dynamic_traverse_lod_trees = unimplemented;
        export const tiny_lod_packedsplats = unimplemented;
        export const bhatt_lod_packedsplats = unimplemented;
        export const update_lod_trees = unimplemented;
        export const decode_to_extsplats = unimplemented;
        export const tiny_lod_extsplats = unimplemented;
        export const bhatt_lod_extsplats = unimplemented;
        export const get_lod_tree_level = unimplemented;
        export const get_raycast_buffer = unimplemented;
        export const get_raycast_buffer2 = unimplemented;
        export const raycast_ext_buffers = unimplemented;
        export const raycast_packed_buffer = unimplemented;
        export const decode_rad_header = unimplemented;
      `,
    };
  }

  if (url === "spark-rs:wasm") {
    return {
      format: "module",
      shortCircuit: true,
      source: "export default new Uint8Array([0,97,115,109,1,0,0,0]).buffer;",
    };
  }

  if (url === "spark:worker") {
    return {
      format: "module",
      shortCircuit: true,
      source: `
        export default class BundledWorker {
          postMessage() {}
          terminate() {}
        }
      `,
    };
  }

  if (url.endsWith(".glsl")) {
    const source = await readFile(new URL(url), "utf8");

    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(source)};`,
    };
  }

  return nextLoad(url, context);
}
