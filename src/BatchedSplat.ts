import * as THREE from "three";
import {
  type IterableSplatData,
  type SortContext,
  Splat,
  type SplatData,
} from "./Splat";
import { CpuSplatSorter, type SplatOrdering } from "./SplatSorter";
import { isIterableSplatData } from "./SplatUtils";
import type { TransformRange } from "./defines";
import { DefaultSplatEncoding } from "./encoding/encoder";

/**
 * Specialized Splat class for combining multiple splats in one draw call.
 * All splats are sorted allowing for overlapping splats, while each instance
 * retains its own transform matrix.
 */
export class BatchedSplat extends Splat {
  readonly maxInstanceCount: number;
  private readonly batchedSplatData: BatchedSplatData;

  private matricesArray: Float32Array;
  private matricesTexture: THREE.DataTexture;

  constructor(maxInstanceCount: number) {
    const batchingTextureUniform: THREE.IUniform = {
      value: null as THREE.Texture | null,
    };
    const batchedSplatData = new BatchedSplatData(batchingTextureUniform);
    super(batchedSplatData, { sorter: new CpuSplatSorter() });
    this.batchedSplatData = batchedSplatData;

    this.maxInstanceCount = maxInstanceCount;
    let size = Math.sqrt(this.maxInstanceCount * 4); // 4 pixels needed for 1 matrix
    size = Math.ceil(size / 4) * 4;
    size = Math.max(size, 4);

    this.matricesArray = new Float32Array(size * size * 4); // 4 floats per RGBA pixel
    this.matricesTexture = new THREE.DataTexture(
      this.matricesArray,
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    batchingTextureUniform.value = this.matricesTexture;

    // Disable frustum culling as the transform of BatchedSplat is ignored
    // in favour of the individual instance transform matrices.
    this.frustumCulled = false;
  }

  addSplat(splat: Splat) {
    const splatData = splat.splatData;
    if (!isIterableSplatData(splatData)) {
      throw new Error(
        "Splat can't be added to BatchedSplat as its splat data is not iterable",
      );
    }

    this.addSplatData(splatData);
    const index = this.batchedSplatData.instanceCount - 1;
    splat.updateMatrixWorld();
    this.setMatrixAt(index, splat.matrixWorld);
  }

  addSplatData(splatData: IterableSplatData) {
    this.batchedSplatData.addSplatData(splatData);
    this.batchedSplatData.setupMaterial(this.material);
    this.needsUpdate = true;
  }

  removeSplatData(splatData: IterableSplatData) {
    this.batchedSplatData.removeSplatData(splatData);
    this.batchedSplatData.setupMaterial(this.material);
    this.needsUpdate = true;
  }

  setMatrixAt(instanceId: number, matrix: THREE.Matrix4) {
    matrix.toArray(this.matricesArray, instanceId * 16);
    this.matricesTexture.needsUpdate = true;
    this.needsUpdate = true;
    return this;
  }

  getTransformRanges(): Array<TransformRange> {
    const result: Array<TransformRange> = [];

    let start = 0;
    for (let i = 0; i < this.batchedSplatData.instanceCount; i++) {
      const numSplats = this.batchedSplatData.sources[i].numSplats;
      result.push({
        start,
        end: start + numSplats,
        matrix: [...this.matricesArray.slice(i * 16, (i + 1) * 16)],
      });
      start += numSplats;
    }

    return result;
  }

  protected onSortComplete(context: SortContext, result: SplatOrdering) {
    // Include object index into ordering array
    for (let i = 0; i < result.activeSplats; i++) {
      const splatIndex = result.ordering[i];
      const objectIndex = this.batchedSplatData.getInstanceIndexFor(splatIndex);
      result.ordering[i] = splatIndex | (objectIndex << 26);
    }
    super.onSortComplete(context, result);
  }

  dispose(): void {
    super.dispose();
    this.batchedSplatData.dispose();
  }
}

/**
 * SplatData implementation that allows combining multiple individual
 * splat data sources into one for batched draw calls.
 */
class BatchedSplatData implements SplatData {
  private splatData: SplatData;
  sources: Array<IterableSplatData> = [];
  private batchingTextureUniform: THREE.IUniform<THREE.Texture>;

  constructor(batchingTextureUniform: THREE.IUniform<THREE.Texture>) {
    this.splatData = this.recreate();
    this.batchingTextureUniform = batchingTextureUniform;
  }

  private recreate(): SplatData {
    const numSh = this.sources[0]?.numSh ?? 0;
    const numSplats = this.sources.reduce(
      (sum, source) => sum + source.numSplats,
      0,
    );

    const splatEncoder = DefaultSplatEncoding.createSplatEncoder();
    splatEncoder.allocate(numSplats, numSh);

    let splatIndex = 0;
    for (const source of this.sources) {
      source.iterateSplats(
        (
          _,
          x,
          y,
          z,
          scaleX,
          scaleY,
          scaleZ,
          quatX,
          quatY,
          quatZ,
          quatW,
          opacity,
          r,
          g,
          b,
          sh,
        ) => {
          splatEncoder.setSplat(
            splatIndex,
            x,
            y,
            z,
            scaleX,
            scaleY,
            scaleZ,
            quatX,
            quatY,
            quatZ,
            quatW,
            opacity,
            r,
            g,
            b,
          );
          if (sh) {
            splatEncoder.setSplatSh(splatIndex, sh);
          }
          splatIndex++;
        },
      );
    }

    this.splatData?.dispose();
    this.splatData = splatEncoder.close();

    return this.splatData;
  }

  get instanceCount() {
    return this.sources.length;
  }

  getInstanceIndexFor(splatIndex: number): number {
    let instanceIndex = 0;
    let instanceEnd = this.sources[instanceIndex].numSplats;
    while (splatIndex >= instanceEnd) {
      instanceIndex++;
      instanceEnd += this.sources[instanceIndex].numSplats;
    }
    return instanceIndex;
  }

  addSplatData(source: IterableSplatData) {
    this.sources.push(source);
    this.recreate();
  }

  removeSplatData(source: IterableSplatData) {
    if (this.sources.indexOf(source)) {
      this.sources.splice(this.sources.indexOf(source), 1);
      this.recreate();
    }
  }

  get maxSplats() {
    return this.splatData.maxSplats;
  }

  get numSplats() {
    return this.splatData.numSplats;
  }

  get numSh() {
    return this.splatData.numSh;
  }

  setupMaterial(material: THREE.ShaderMaterial) {
    this.splatData.setupMaterial(material);
    if (!("batchingTexture" in material.uniforms)) {
      material.uniforms.batchingTexture = this.batchingTextureUniform;
    }
    material.defines.USE_BATCHING = true;
  }

  iterateCenters(
    callback: (index: number, x: number, y: number, z: number) => void,
  ) {
    this.splatData.iterateCenters(callback);
  }

  dispose(): void {
    // Only dispose the combined splat. The other splat sources aren't owned by this instance.
    this.splatData.dispose();
  }
}
