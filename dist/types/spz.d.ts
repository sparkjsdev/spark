import type { PackedSplats } from "./PackedSplats";
import { type TranscodeSpzInput } from "./SplatLoader";
export type SpzWriteVersion = 2 | 3;
export declare function transcodeSpz(input: TranscodeSpzInput): Promise<{
    fileBytes: any;
    clippedCount: number;
}>;
export type WriteSpzOptions = {
    maxSh?: number;
    fractionalBits?: number;
    version?: SpzWriteVersion;
};
export declare function writeSpz(packedSplats: PackedSplats, maxSh?: number, fractionalBits?: number): {
    fileBytes: Uint8Array;
};
export declare function writeSpz(packedSplats: PackedSplats, options?: WriteSpzOptions): {
    fileBytes: Uint8Array;
};
