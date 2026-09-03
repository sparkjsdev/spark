import * as THREE from "three";

export function replaceU32DataTexture(
  previous: THREE.DataTexture | undefined,
  retired: THREE.DataTexture | undefined,
  data: Uint32Array,
  width: number,
): {
  texture: THREE.DataTexture;
  retired: THREE.DataTexture | undefined;
} {
  const valuesPerRow = width * 4;
  const rows = Math.ceil(data.length / valuesPerRow);
  if (data.length !== rows * valuesPerRow) {
    throw new Error("Data length does not fill the texture");
  }

  const texture = new THREE.DataTexture(
    data,
    width,
    rows,
    THREE.RGBAIntegerFormat,
    THREE.UnsignedIntType,
  );
  texture.internalFormat = "RGBA32UI";
  texture.needsUpdate = true;

  retired?.dispose();
  return { texture, retired: previous };
}

export function disposeU32DataTextures(
  current: THREE.DataTexture,
  retired?: THREE.DataTexture,
) {
  current.dispose();
  retired?.dispose();
}
