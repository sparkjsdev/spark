import { unzipSync } from "fflate";

// Custom magic number for (unzipped) and decoded SOG files
const HEADER = new Uint8Array([0x53, 0x4f, 0x47, 0x53]);

const temp = new Uint8Array(4);
const dataView = new DataView(temp.buffer);
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

type ImageData = { width: number; height: number; rgba: Uint8Array };

export function unzipAndDecodeImages(zipSize: number) {
  const data = new Uint8Array(zipSize);
  let processed = 0;

  return new TransformStream({
    start(controller) {
      controller.enqueue(HEADER);
    },
    async transform(chunk, controller) {
      const chunkData = await chunk;
      data.set(chunkData, processed);
      processed += chunkData.length;
    },
    async flush(controller) {
      const unzipped = unzipSync(data);

      const promises: Array<Promise<void>> = [];
      for (const fileName in unzipped) {
        if (fileName.endsWith(".webp")) {
          promises.push(
            decodeImage(unzipped[fileName].buffer as ArrayBuffer).then(
              (imageData) => enqueueImage(controller, fileName, imageData),
            ),
          );
        } else {
          enqueueFile(controller, fileName, unzipped[fileName]);
        }
      }

      await Promise.allSettled(promises);
    },
  });
}

export function fetchAndDecodeImages(url: string) {
  // Strip the file name
  const baseUrl = url.substring(0, url.lastIndexOf("/"));

  return new ReadableStream({
    async start(controller) {
      // Fetch the meta.json file
      const arrayBuffer = await (await fetch(url)).arrayBuffer();
      const json = JSON.parse(textDecoder.decode(arrayBuffer));
      const refFiles = [
        ...json.means.files,
        ...json.scales.files,
        ...json.quats.files,
        ...json.sh0.files,
        ...(json.shN?.files ?? []),
      ];

      // Start outputting
      controller.enqueue(HEADER);
      enqueueFile(controller, "meta.json", new Uint8Array(arrayBuffer));

      const promises = refFiles.map(async (imageFile) => {
        const response = await fetch(`${baseUrl}/${imageFile}`);
        const arrayBuffer = await response.arrayBuffer();
        const imageData = await decodeImage(arrayBuffer);

        enqueueImage(controller, imageFile, imageData);
      });

      await Promise.allSettled(promises);
      controller.close();
    },
  });
}

function enqueueFileName(
  controller:
    | ReadableStreamDefaultController
    | TransformStreamDefaultController,
  fileName: string,
) {
  const encodedFileName = textEncoder.encode(fileName);
  dataView.setUint16(0, encodedFileName.byteLength, true);
  controller.enqueue(temp.slice(0, 2));
  controller.enqueue(encodedFileName);
}

function enqueueFile(
  controller:
    | ReadableStreamDefaultController
    | TransformStreamDefaultController,
  fileName: string,
  data: Uint8Array,
) {
  enqueueFileName(controller, fileName);

  dataView.setUint32(0, data.byteLength, true);
  controller.enqueue(temp.slice());
  controller.enqueue(data);
}

function enqueueImage(
  controller:
    | ReadableStreamDefaultController
    | TransformStreamDefaultController,
  fileName: string,
  imageData: ImageData,
) {
  enqueueFileName(controller, fileName);

  // byte size
  dataView.setUint32(0, imageData.rgba.byteLength + 8, true);
  controller.enqueue(temp.slice());

  // width
  dataView.setUint32(0, imageData.width, true);
  controller.enqueue(temp.slice());
  // height
  dataView.setUint32(0, imageData.height, true);
  controller.enqueue(temp.slice());
  // rgba
  controller.enqueue(imageData.rgba);
}

// WebGL context for reading raw pixel data of WebP images
let offscreenGlContext: WebGL2RenderingContext | null = null;

export async function decodeImage(fileBytes: ArrayBuffer) {
  if (!offscreenGlContext) {
    const canvas = new OffscreenCanvas(1, 1);
    offscreenGlContext = canvas.getContext("webgl2");
    if (!offscreenGlContext) {
      throw new Error("Failed to create WebGL2 context");
    }
  }

  const imageBlob = new Blob([fileBytes]);
  const bitmap = await createImageBitmap(imageBlob, {
    premultiplyAlpha: "none",
  });

  const gl = offscreenGlContext;
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );

  const data = new Uint8Array(bitmap.width * bitmap.height * 4);
  gl.readPixels(
    0,
    0,
    bitmap.width,
    bitmap.height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    data,
  );

  gl.deleteTexture(texture);
  gl.deleteFramebuffer(framebuffer);

  return { rgba: data, width: bitmap.width, height: bitmap.height };
}
