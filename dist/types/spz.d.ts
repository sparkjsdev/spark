import { PackedSplats } from './PackedSplats';
import { TranscodeSpzInput } from './SplatLoader';
export declare function transcodeSpz(input: TranscodeSpzInput): Promise<{
    fileBytes: any;
    clippedCount: number;
}>;
export declare function writeSpz(packedSplats: PackedSplats, maxSh?: number, fractionalBits?: number): {
    fileBytes: Uint8Array<ArrayBufferLike>;
};
