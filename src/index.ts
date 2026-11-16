export {
  SparkRenderer,
  type SparkRendererOptions,
} from "./SparkRenderer.js";
export { SplatAccumulator, type GeneratorMapping } from "./SplatAccumulator.js";

export * as dyno from "./dyno.js";

export { RgbaArray, readRgbaArray } from "./RgbaArray.js";

export {
  SplatLoader,
  getSplatFileType,
} from "./SplatLoader.js";
export {
  transcodeSpz,
  writeSpz,
  type SpzWriteVersion,
  type WriteSpzOptions,
  type TranscodeSpzFileInput,
  type TranscodeSpzInput,
} from "./spz.js";

export { PackedSplats, type PackedSplatsOptions } from "./PackedSplats.js";
export { ExtSplats, type ExtSplatsOptions } from "./ExtSplats.js";
export * from "./PagedSplats.js";
export type { PagedSplatsFetcher } from "./PagedSplatsFetcher.js";
export * from "./SplatPager.js";
export {
  SplatGenerator,
  type GsplatGenerator,
  SplatModifier,
  type GsplatModifier,
  SplatTransformer,
} from "./SplatGenerator.js";
export {
  Readback,
  type Rgba8Readback,
  type ReadbackBuffer,
} from "./Readback.js";

export {
  SplatMesh,
  type SplatMeshOptions,
  type SplatMeshContext,
} from "./SplatMesh.js";
export {
  SplatSkinning,
  type SplatSkinningOptions,
  SplatSkinningMode,
} from "./SplatSkinning.js";
export {
  SplatEdit,
  type SplatEditOptions,
  SplatEditSdf,
  type SplatEditSdfOptions,
  SplatEditSdfType,
  SplatEditRgbaBlendMode,
  SplatEdits,
} from "./SplatEdit.js";

export {
  constructGrid,
  constructAxes,
  constructSpherePoints,
  imageSplats,
  textSplats,
} from "./splatConstructors.js";

export * as generators from "./generators.js";
export * as modifiers from "./modifiers.js";

export * from "./SparkXr.js";
export {
  type JointId,
  JointEnum,
  JOINT_IDS,
  NUM_JOINTS,
  JOINT_INDEX,
  JOINT_RADIUS,
  JOINT_SEGMENTS,
  JOINT_SEGMENT_STEPS,
  JOINT_TIPS,
  FINGER_TIPS,
  Hand,
  HANDS,
  type Joint,
  type HandJoints,
  type HandsJoints,
  XrHands,
  HandMovement,
} from "./hands.js";

export { SparkControls, FpsMovement, PointerControls } from "./controls.js";

export {
  isMobile,
  isAndroid,
  isOculus,
  isQuest2,
  isIos,
  isVisionPro,
  flipPixels,
  pixelsToPngUrl,
  toHalf,
  fromHalf,
  floatToUint8,
  floatToSint8,
  Uint8ToFloat,
  Sint8ToFloat,
  setPackedSplat,
  unpackSplat,
} from "./utils.js";
export * as utils from "./utils.js";

export { LN_SCALE_MIN, LN_SCALE_MAX, SplatFileType } from "./defines.js";

export * as defines from "./defines.js";

export {
  SparkPortals,
  type SparkPortalsOptions,
  type PortalPair,
  DISK_PORTAL_FRAGMENT_SHADER,
} from "./SparkPortals.js";
