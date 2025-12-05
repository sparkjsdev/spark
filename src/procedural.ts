import * as THREE from "three";
import { Splat } from "./Splat";
import {
  DefaultSplatEncoding,
  type ResizableSplatEncoder,
  type SplatEncoder,
} from "./encoding/encoder";

/**
 * Method for constructing a Splat instance from a factory function.
 * The number of splats is not fixed up-front.
 * @param factory The factory to use to generate the splat properties
 * @param options
 * @returns The Splat instance
 */
function construct<T>(
  factory: (splatEncoder: ResizableSplatEncoder<T>) => void,
  options?: {
    /**
     * The splat encoder factory to use
     */
    splatEncoder?: ResizableSplatEncoder<T> | (() => ResizableSplatEncoder<T>);
  },
): Splat {
  const splatEncoderFactory =
    options?.splatEncoder ?? DefaultSplatEncoding.createSplatEncoder;
  const splatEncoder =
    typeof splatEncoderFactory === "function"
      ? splatEncoderFactory()
      : splatEncoderFactory;

  factory(splatEncoder as ResizableSplatEncoder<T>);

  return new Splat(splatEncoder.close());
}

/**
 * Method for constructing a Splat instance with a fixed amount of splats using a factory function.
 * @param numSplats The number of splats the resulting Splat instance should have
 * @param factory The factory to use to generate the splat properties
 * @param options
 * @returns The Splat instance
 */
function constructFixed<T>(
  numSplats: number,
  factory: (splatEncoder: SplatEncoder<T>, numSplats: number) => void,
  options?: {
    /**
     * The splat encoder factory to use.
     */
    splatEncoder?: SplatEncoder<T> | (() => SplatEncoder<T>);
    /**
     * The number of spherical harmonics to allocate for each splat.
     * @default 0
     */
    numSh?: number;
  },
): Splat {
  const splatEncoderFactory =
    options?.splatEncoder ?? DefaultSplatEncoding.createSplatEncoder;
  const splatEncoder =
    typeof splatEncoderFactory === "function"
      ? splatEncoderFactory()
      : splatEncoderFactory;

  const numSh = options?.numSh ?? 0;
  splatEncoder.allocate(numSplats, numSh);
  factory(splatEncoder as ResizableSplatEncoder<T>, numSplats);

  return new Splat(splatEncoder.close());
}

export function constructGrid<T>({
  // PackedSplats object to add splats to
  splatEncoder,
  // min and max box extents of the grid
  extents,
  // step size along each grid axis
  stepSize = 1,
  // spherical radius of each Gsplat
  pointRadius = 0.01,
  // relative size of the "shadow copy" of each Gsplat placed behind it
  pointShadowScale = 2.0,
  // Gsplat opacity
  opacity = 1.0,
  // Gsplat color (THREE.Color) or function to set color for position:
  // ((THREE.Color, THREE.Vector3) => void) (default: RGB-modulated grid)
  color,
}: {
  splatEncoder: SplatEncoder<T>;
  extents: THREE.Box3;
  stepSize?: number;
  pointRadius?: number;
  pointShadowScale?: number;
  opacity?: number;
  color?: THREE.Color | ((color: THREE.Color, point: THREE.Vector3) => void);
}) {
  const EPSILON = 1.0e-6;
  const center = new THREE.Vector3();
  if (color == null) {
    color = (color, point) =>
      color.set(
        0.55 + 0.45 * Math.cos(point.x * 1),
        0.55 + 0.45 * Math.cos(point.y * 1),
        0.55 + 0.45 * Math.cos(point.z * 1),
      );
  }
  const pointColor = new THREE.Color();
  let i = 0;
  for (let z = extents.min.z; z < extents.max.z + EPSILON; z += stepSize) {
    for (let y = extents.min.y; y < extents.max.y + EPSILON; y += stepSize) {
      for (let x = extents.min.x; x < extents.max.x + EPSILON; x += stepSize) {
        center.set(x, y, z);
        for (let layer = 0; layer < 2; ++layer) {
          const scale = pointRadius * (layer ? 1 : pointShadowScale);
          if (!layer) {
            pointColor.setScalar(0.0);
          } else if (typeof color === "function") {
            color(pointColor, center);
          } else {
            pointColor.copy(color);
          }
          splatEncoder.setSplat(
            i++,
            x,
            y,
            z,
            scale,
            scale,
            scale,
            0,
            0,
            0,
            1,
            opacity,
            pointColor.r,
            pointColor.g,
            pointColor.b,
          );
        }
      }
    }
  }
}

export function constructAxes<T>({
  // PackedSplats object to add splats to
  splatEncoder,
  // scale (Gsplat scale along axis)
  scale = 0.25,
  // radius of the axes (Gsplat scale orthogonal to axis)
  axisRadius = 0.0075,
  // relative size of the "shadow copy" of each Gsplat placed behind it
  axisShadowScale = 2.0,
  // origins of the axes (default single axis at origin)
  origins = [new THREE.Vector3()],
}: {
  splatEncoder: ResizableSplatEncoder<T>;
  scale?: number;
  axisRadius?: number;
  axisShadowScale?: number;
  origins?: THREE.Vector3[];
}) {
  const center = new THREE.Vector3();
  const scales = new THREE.Vector3();
  const quaternion = new THREE.Quaternion(0, 0, 0, 1);
  const color = new THREE.Color();
  const opacity = 1.0;
  for (const origin of origins) {
    for (let axis = 0; axis < 3; ++axis) {
      center.set(
        origin.x + (axis === 0 ? scale : 0),
        origin.y + (axis === 1 ? scale : 0),
        origin.z + (axis === 2 ? scale : 0),
      );
      for (let layer = 0; layer < 2; ++layer) {
        scales.set(
          (axis === 0 ? scale : axisRadius) * (layer ? 1 : axisShadowScale),
          (axis === 1 ? scale : axisRadius) * (layer ? 1 : axisShadowScale),
          (axis === 2 ? scale : axisRadius) * (layer ? 1 : axisShadowScale),
        );
        color.setRGB(
          layer === 0 ? 0.0 : axis === 0 ? 1.0 : 0.0,
          layer === 0 ? 0.0 : axis === 1 ? 1.0 : 0.0,
          layer === 0 ? 0.0 : axis === 2 ? 1.0 : 0.0,
        );
        splatEncoder.pushSplat(
          center.x,
          center.y,
          center.z,
          scales.x,
          scales.y,
          scales.z,
          quaternion.x,
          quaternion.y,
          quaternion.z,
          quaternion.w,
          opacity,
          color.r,
          color.g,
          color.b,
        );
      }
    }
  }
}

export function constructSpherePoints<T>({
  // PackedSplats object to add splats to
  splatEncoder,
  // center of the sphere (default: origin)
  origin = new THREE.Vector3(),
  // radius of the sphere
  radius = 1.0,
  // maximum depth of recursion for subdividing the sphere
  // Warning: Gsplat count grows exponentially with depth
  maxDepth = 3,
  // filter function to apply to each point, for example to select
  // points in a certain direction or other function ((THREE.Vector3) => boolean)
  // (default: null)
  filter = null,
  // radius of each oriented Gsplat
  pointRadius = 0.02,
  // flatness of each oriented Gsplat
  pointThickness = 0.001,
  // color of each Gsplat (THREE.Color) or function to set color for point:
  // ((THREE.Color, THREE.Vector3) => void) (default: white)
  color = new THREE.Color(1, 1, 1),
}: {
  splatEncoder: ResizableSplatEncoder<T>;
  origin?: THREE.Vector3;
  radius?: number;
  maxDepth?: number;
  filter?: ((point: THREE.Vector3) => boolean) | null;
  pointRadius?: number;
  pointThickness?: number;
  color?: THREE.Color | ((color: THREE.Color, point: THREE.Vector3) => void);
}) {
  const pointsHash: { [key: string]: THREE.Vector3 } = {};

  function addPoint(p: THREE.Vector3) {
    if (filter && !filter(p)) {
      return;
    }
    const key = `${p.x},${p.y},${p.z}`;
    if (!pointsHash[key]) {
      pointsHash[key] = p;
    }
  }

  function recurse(
    depth: number,
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
  ) {
    addPoint(p0);
    addPoint(p1);
    addPoint(p2);
    if (depth >= maxDepth) {
      return;
    }
    const p01 = new THREE.Vector3().addVectors(p0, p1).normalize();
    const p12 = new THREE.Vector3().addVectors(p1, p2).normalize();
    const p20 = new THREE.Vector3().addVectors(p2, p0).normalize();
    recurse(depth + 1, p0, p01, p20);
    recurse(depth + 1, p01, p1, p12);
    recurse(depth + 1, p20, p12, p2);
    recurse(depth + 1, p01, p12, p20);
  }

  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        const p0 = new THREE.Vector3(x, 0, 0);
        const p1 = new THREE.Vector3(0, y, 0);
        const p2 = new THREE.Vector3(0, 0, z);
        recurse(0, p0, p1, p2);
      }
    }
  }

  const points = Object.values(pointsHash);
  const scales = new THREE.Vector3(pointRadius, pointRadius, pointThickness);
  const quaternion = new THREE.Quaternion();
  const pointColor = typeof color === "function" ? new THREE.Color() : color;
  for (const point of points) {
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), point);
    if (typeof color === "function") {
      color(pointColor, point);
    }
    point.multiplyScalar(radius);
    point.add(origin);
    splatEncoder.pushSplat(
      point.x,
      point.y,
      point.z,
      scales.x,
      scales.y,
      scales.z,
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w,
      1.0,
      pointColor.r,
      pointColor.g,
      pointColor.b,
    );
  }
}

function fromText<T>(
  text: string,
  options?: {
    /**
     * browser font to render text with
     * @default Arial
     */
    font?: string;
    /**
     * font size in pixels/Gsplats
     * @default 32
     */
    fontSize?: number;
    /**
     * Individual Gsplat color (default: white)
     * @default white
     */
    color?: THREE.Color;
    /**
     * Gsplat radius
     * @default 0.8 covers 1-unit spacing well
     */
    dotRadius?: number;
    /**
     * text alignment, one of "left", "center", "right", "start", "end"
     * @default start
     */
    textAlign?: "left" | "center" | "right" | "start" | "end";
    /**
     * line spacing multiplier, lines delimited by "\n"
     * @default 1.0
     */
    lineHeight?: number;
    /**
     * Coordinate scale in object-space
     * @default 1.0
     */
    objectScale?: number;
    /**
     * The splat encoder factory to use
     */
    splatEncoder?: ResizableSplatEncoder<T> | (() => ResizableSplatEncoder<T>);
  },
): Splat {
  const font = options?.font ?? "Arial";
  const fontSize = options?.fontSize ?? 32;
  const color = options?.color ?? new THREE.Color(1, 1, 1);
  const dotRadius = options?.dotRadius ?? 0.8;
  const textAlign = options?.textAlign ?? "start";
  const lineHeight = options?.lineHeight ?? 1;
  const objectScale = options?.objectScale ?? 1;
  const lines = text.split("\n");
  const splatEncoderFactory =
    options?.splatEncoder ?? DefaultSplatEncoding.createSplatEncoder;
  const splatEncoder =
    typeof splatEncoderFactory === "function"
      ? splatEncoderFactory()
      : splatEncoderFactory;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create canvas context");
  }

  ctx.font = `${fontSize}px ${font}`;
  ctx.textAlign = textAlign;
  const metrics = ctx.measureText("");
  const fontHeight =
    metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;

  let minLeft = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let minTop = Number.POSITIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;
  for (let line = 0; line < lines.length; ++line) {
    const metrics = ctx.measureText(lines[line]);
    const y = fontHeight * lineHeight * line;
    minLeft = Math.min(minLeft, -metrics.actualBoundingBoxLeft);
    maxRight = Math.max(maxRight, metrics.actualBoundingBoxRight);
    minTop = Math.min(minTop, y - metrics.actualBoundingBoxAscent);
    maxBottom = Math.max(maxBottom, y + metrics.actualBoundingBoxDescent);
  }
  const originLeft = Math.floor(minLeft);
  const originTop = Math.floor(minTop);
  const width = Math.ceil(maxRight) - originLeft;
  const height = Math.ceil(maxBottom) - originTop;
  canvas.width = width;
  canvas.height = height;

  ctx.font = `${fontSize}px ${font}`;
  ctx.textAlign = textAlign;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#FFFFFF";
  for (let i = 0; i < lines.length; ++i) {
    const y = fontHeight * lineHeight * i - originTop;
    ctx.fillText(lines[i], -originLeft, y);
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  const rgba = new Uint8Array(imageData.data.buffer);
  const center = new THREE.Vector3();
  const scales = new THREE.Vector3().setScalar(dotRadius * objectScale);
  const quaternion = new THREE.Quaternion(0, 0, 0, 1);

  let offset = 0;
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      const a = rgba[offset + 3];
      if (a > 0) {
        const opacity = a / 255;
        center.set(x - 0.5 * (width - 1), 0.5 * (height - 1) - y, 0);
        center.multiplyScalar(objectScale);
        splatEncoder.pushSplat(
          center.x,
          center.y,
          center.z,
          scales.x,
          scales.y,
          scales.z,
          quaternion.x,
          quaternion.y,
          quaternion.z,
          quaternion.w,
          opacity,
          color.r,
          color.g,
          color.b,
        );
      }
      offset += 4;
    }
  }

  return new Splat(splatEncoder.close());
}

type FromImageOptions<T> = {
  /**
   * Radius of each Gsplat, default covers 1-unit spacing well
   * @default 0.8
   */
  dotRadius?: number;
  /**
   * Subsampling factor for the image. Higher values reduce resolution,
   * for example 2 will halve the width and height by averaging
   * @default 1
   */
  subXY?: number;
  /**
   * The splat encoder factory to use
   */
  splatEncoder?: ResizableSplatEncoder<T> | (() => ResizableSplatEncoder<T>);
};

function fromImage<T>(
  img: HTMLImageElement,
  options?: FromImageOptions<T>,
): Splat {
  const dotRadius = options?.dotRadius ?? 0.8;
  const subXY = Math.max(1, Math.floor(options?.subXY ?? 1));
  const splatEncoderFactory =
    options?.splatEncoder ?? DefaultSplatEncoding.createSplatEncoder;
  const splatEncoder =
    typeof splatEncoderFactory === "function"
      ? splatEncoderFactory()
      : splatEncoderFactory;

  const { width, height } = img;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create canvas context");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const destWidth = Math.round(width / subXY);
  const destHeight = Math.round(height / subXY);
  ctx.drawImage(img, 0, 0, destWidth, destHeight);

  const imageData = ctx.getImageData(0, 0, destWidth, destHeight);
  const rgba = new Uint8Array(imageData.data.buffer);

  const center = new THREE.Vector3();
  const scales = new THREE.Vector3().setScalar(dotRadius);
  const quaternion = new THREE.Quaternion(0, 0, 0, 1);
  const rgb = new THREE.Color();

  let index = 0;
  for (let y = 0; y < destHeight; ++y) {
    for (let x = 0; x < destWidth; ++x) {
      const offset = index * 4;
      const a = rgba[offset + 3];
      if (a > 0) {
        const opacity = a / 255;
        rgb.set(
          rgba[offset + 0] / 255,
          rgba[offset + 1] / 255,
          rgba[offset + 2] / 255,
        );
        center.set(x - 0.5 * (destWidth - 1), 0.5 * (destHeight - 1) - y, 0);
        scales.setScalar(dotRadius);
        quaternion.set(0, 0, 0, 1);
        splatEncoder.pushSplat(
          center.x,
          center.y,
          center.z,
          scales.x,
          scales.y,
          scales.z,
          quaternion.x,
          quaternion.y,
          quaternion.z,
          quaternion.w,
          opacity,
          rgb.r,
          rgb.g,
          rgb.b,
        );
      }
      index += 1;
    }
  }

  return new Splat(splatEncoder.close());
}

async function fromImageUrl<T>(
  url: string,
  options?: FromImageOptions<T>,
): Promise<Splat> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  const loadPromise = new Promise((resolve, reject) => {
    img.onerror = reject;
    img.onload = resolve;
  });
  img.src = url;

  await loadPromise;

  return fromImage(img, options);
}

// @ts-ignore
const SplatClass = Splat as Record<string, unknown>;

SplatClass.fromText = fromText;
SplatClass.fromImage = fromImage;
SplatClass.fromImageUrl = fromImageUrl;
SplatClass.construct = construct;
SplatClass.constructFixed = constructFixed;
