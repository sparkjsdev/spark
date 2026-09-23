import { ExtSplats } from "./ExtSplats";
import { PackedSplats } from "./PackedSplats";
import type { SplatFileType } from "./defines";
export type SpzWriteVersion = 2 | 3;
export type TranscodeSpzFileInput = {
    fileBytes: Uint8Array;
    fileType?: SplatFileType;
    pathOrUrl?: string;
    transform?: {
        translate?: number[];
        quaternion?: number[];
        scale?: number;
    };
};
export type TranscodeSpzInput = {
    inputs: TranscodeSpzFileInput[];
    maxSh?: number;
    clipXyz?: {
        min: number[];
        max: number[];
    };
    fractionalBits?: number;
    opacityThreshold?: number;
    version?: SpzWriteVersion;
};
export declare function transcodeSpz(input: TranscodeSpzInput): Promise<{
    fileBytes: any;
    clippedCount: number;
}>;
export type WriteSpzOptions = {
    maxSh?: number;
    fractionalBits?: number;
    version?: SpzWriteVersion;
};
export declare function writeSpz(splats: PackedSplats | ExtSplats, maxSh?: number, fractionalBits?: number): Promise<{
    fileBytes: Uint8Array;
}>;
export declare function writeSpz(splats: PackedSplats | ExtSplats, options?: WriteSpzOptions): Promise<{
    fileBytes: Uint8Array;
}>;
