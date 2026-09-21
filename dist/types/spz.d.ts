import type { PackedSplats } from "./PackedSplats";
import { type TranscodeSpzInput } from "./SplatLoader";
export declare function transcodeSpz(input: TranscodeSpzInput): Promise<{
    fileBytes: any;
    clippedCount: number;
}>;
export declare function writeSpz(packedSplats: PackedSplats, maxSh?: number, fractionalBits?: number): {
    fileBytes: Uint8Array<ArrayBufferLike>;
};
