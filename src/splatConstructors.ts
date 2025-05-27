import * as THREE from "three";
import { PackedSplats } from "./PackedSplats";
import { SplatMesh } from "./SplatMesh";

export function constructGrid({
  // PackedSplats object to add splats to
  splats,
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
  splats: PackedSplats;
  extents: THREE.Box3;
  stepSize?: number;
  pointRadius?: number;
  pointShadowScale?: number;
  opacity?: number;
  color?: THREE.Color | ((color: THREE.Color, point: THREE.Vector3) => void);
}) {
  const EPSILON = 1.0e-6;
  const center = new THREE.Vector3();
  const scales = new THREE.Vector3();
  const quaternion = new THREE.Quaternion(0, 0, 0, 1);
  if (color == null) {
    color = (color, point) =>
      color.set(
        0.55 + 0.45 * Math.cos(point.x * 1),
        0.55 + 0.45 * Math.cos(point.y * 1),
        0.55 + 0.45 * Math.cos(point.z * 1),
      );
  }
  const pointColor = new THREE.Color();
  for (let z = extents.min.z; z < extents.max.z + EPSILON; z += stepSize) {
    for (let y = extents.min.y; y < extents.max.y + EPSILON; y += stepSize) {
      for (let x = extents.min.x; x < extents.max.x + EPSILON; x += stepSize) {
        center.set(x, y, z);
        for (let layer = 0; layer < 2; ++layer) {
          scales.setScalar(pointRadius * (layer ? 1 : pointShadowScale));
          if (!layer) {
            pointColor.setScalar(0.0);
          } else if (typeof color === "function") {
            color(pointColor, center);
          } else {
            pointColor.copy(color);
          }
          splats.pushSplat(center, scales, quaternion, opacity, pointColor);
        }
      }
    }
  }
}

export function constructAxes({
  // PackedSplats object to add splats to
  splats,
  // scale (Gsplat scale along axis)
  scale = 0.25,
  // radius of the axes (Gsplat scale orthogonal to axis)
  axisRadius = 0.0075,
  // relative size of the "shadow copy" of each Gsplat placed behind it
  axisShadowScale = 2.0,
  // origins of the axes (default single axis at origin)
  origins = [new THREE.Vector3()],
}: {
  splats: PackedSplats;
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
        splats.pushSplat(center, scales, quaternion, opacity, color);
      }
    }
  }
}

export function constructSpherePoints({
  // PackedSplats object to add splats to
  splats,
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
  splats: PackedSplats;
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
    splats.pushSplat(point, scales, quaternion, 1.0, pointColor);
  }
}

export function textSplats({
  // text string to display
  text,
  // browser font to render text with (default: "Arial")
  font,
  // font size in pixels/Gsplats (default: 32)
  fontSize,
  // SplatMesh.recolor tint assuming white Gsplats (default: white)
  color,
  // Individual Gsplat color (default: white)
  rgb,
  // Gsplat radius (default: 0.8 covers 1-unit spacing well)
  dotRadius,
  // text alignment: "left", "center", "right", "start", "end" (default: "start")
  textAlign,
  // line spacing multiplier, lines delimited by "\n" (default: 1.0)
  lineHeight,
  // Coordinate scale in object-space (default: 1.0)
  objectScale,
}: {
  text: string;
  font?: string;
  fontSize?: number;
  color?: THREE.Color;
  rgb?: THREE.Color;
  dotRadius?: number;
  textAlign?: "left" | "center" | "right" | "start" | "end";
  lineHeight?: number;
  objectScale?: number;
}) {
  font = font ?? "Arial";
  fontSize = fontSize ?? 32;
  color = color ?? new THREE.Color(1, 1, 1);
  dotRadius = dotRadius ?? 0.8;
  textAlign = textAlign ?? "start";
  lineHeight = lineHeight ?? 1;
  objectScale = objectScale ?? 1;
  const lines = text.split("\n");

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
  const splats = new PackedSplats();
  const center = new THREE.Vector3();
  const scales = new THREE.Vector3().setScalar(dotRadius * objectScale);
  const quaternion = new THREE.Quaternion(0, 0, 0, 1);
  rgb = rgb ?? new THREE.Color(1, 1, 1);

  let offset = 0;
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      const a = rgba[offset + 3];
      if (a > 0) {
        const opacity = a / 255;
        center.set(x - 0.5 * (width - 1), 0.5 * (height - 1) - y, 0);
        center.multiplyScalar(objectScale);
        splats.pushSplat(center, scales, quaternion, opacity, rgb);
      }
      offset += 4;
    }
  }

  const mesh = new SplatMesh({ packedSplats: splats });
  mesh.recolor = color;
  return mesh;
}

export function imageSplats({
  // URL of the image to convert to splats (example: `url: "./image.png"`)
  url,
  // Radius of each Gsplat, default covers 1-unit spacing well (default: 0.8)
  dotRadius,
  // Subsampling factor for the image. Higher values reduce resolution,
  // for example 2 will halve the width and height by averaging (default: 1)
  subXY,
  // Optional callback function to modify each Gsplat before it's added.
  // Return null to skip adding the Gsplat, or a number to set the opacity
  // and add the Gsplat with parameter values in the objects center, rgba etc. were
  // passed into the forEachSplat callback. Ending the callback in `return opacity;`
  // will retain the original opacity.
  // ((width: number, height: number, index: number, center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number, color: THREE.Color) => number | null)
  forEachSplat,
}: {
  url: string;
  dotRadius?: number;
  subXY?: number;
  forEachSplat?: (
    width: number,
    height: number,
    index: number,
    center: THREE.Vector3,
    scales: THREE.Vector3,
    quaternion: THREE.Quaternion,
    opacity: number,
    color: THREE.Color,
  ) => number | null;
}): SplatMesh {
  dotRadius = dotRadius ?? 0.8;
  subXY = Math.max(1, Math.floor(subXY ?? 1));

  return new SplatMesh({
    constructSplats: async (splats) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onerror = reject;
        img.onload = () => {
          const { width, height } = img;
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Failed to create canvas context"));
            return;
          }
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          const destWidth = Math.round(width / subXY);
          const destHeight = Math.round(height / subXY);
          ctx.drawImage(img, 0, 0, destWidth, destHeight);
          try {
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
                  let opacity = a / 255;
                  rgb.set(
                    rgba[offset + 0] / 255,
                    rgba[offset + 1] / 255,
                    rgba[offset + 2] / 255,
                  );
                  center.set(
                    x - 0.5 * (destWidth - 1),
                    0.5 * (destHeight - 1) - y,
                    0,
                  );
                  scales.setScalar(dotRadius);
                  quaternion.set(0, 0, 0, 1);
                  let push = true;
                  if (forEachSplat) {
                    const maybeOpacity = forEachSplat(
                      destWidth,
                      destHeight,
                      index,
                      center,
                      scales,
                      quaternion,
                      opacity,
                      rgb,
                    );
                    opacity = maybeOpacity ?? opacity;
                    push = maybeOpacity !== null;
                  }
                  if (push) {
                    splats.pushSplat(center, scales, quaternion, opacity, rgb);
                  }
                }
                index += 1;
              }
            }
            resolve();
          } catch (error) {
            reject(error);
          }
        };
        img.src = url;
      });
    },
  });
}
