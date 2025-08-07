declare const PLY_PROPERTY_TYPES: readonly ["char", "uchar", "short", "ushort", "int", "uint", "float", "double"];
export type PlyPropertyType = (typeof PLY_PROPERTY_TYPES)[number];
export type PlyElement = {
    name: string;
    count: number;
    properties: Record<string, PlyProperty>;
};
export type PlyProperty = {
    isList: boolean;
    type: PlyPropertyType;
    countType?: PlyPropertyType;
};
export type SplatCallback = (index: number, x: number, y: number, z: number, scaleX: number, scaleY: number, scaleZ: number, quatX: number, quatY: number, quatZ: number, quatW: number, opacity: number, r: number, g: number, b: number) => void;
export type SplatShCallback = (index: number, sh1: Float32Array, sh2?: Float32Array, sh3?: Float32Array) => void;
export declare class PlyReader {
    fileBytes: Uint8Array;
    header: string;
    littleEndian: boolean;
    elements: Record<string, PlyElement>;
    comments: string[];
    data: DataView | null;
    static defaultPointScale: number;
    numSplats: number;
    constructor({ fileBytes }: {
        fileBytes: Uint8Array | ArrayBuffer;
    });
    parseHeader(): Promise<void>;
    parseData(elementCallback: (element: PlyElement) => null | ((index: number, item: Record<string, number | number[]>) => void)): void;
    parseSplats(splatCallback: SplatCallback, shCallback?: SplatShCallback): void;
    injectRgba(rgba: Uint8Array): void;
}
export declare const SH_C0 = 0.28209479177387814;
export {};
