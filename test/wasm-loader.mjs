export async function resolve(specifier, context, nextResolve) {
  if (specifier.includes("?worker")) {
    return {
      shortCircuit: true,
      url: "data:text/javascript,export default class TestWorker {}",
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".wasm?arraybuffer&base64")) {
    const wasmUrl = url.slice(0, url.indexOf("?"));
    return {
      format: "module",
      shortCircuit: true,
      source: `
        import { readFileSync } from "node:fs";
        const bytes = readFileSync(new URL(${JSON.stringify(wasmUrl)}));
        export default Uint8Array.from(bytes).buffer;
      `,
    };
  }
  if (url.endsWith(".glsl")) {
    return {
      format: "module",
      shortCircuit: true,
      source: `
        import { readFileSync } from "node:fs";
        export default readFileSync(new URL(${JSON.stringify(url)}), "utf8");
      `,
    };
  }
  return nextLoad(url, context);
}
