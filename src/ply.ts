// PLY file format reader

import { USE_COMPILED_PARSER_FUNCTION } from "./defines";

const PLY_PROPERTY_TYPES = [
  "char",
  "uchar",
  "short",
  "ushort",
  "int",
  "uint",
  "float",
  "double",
] as const;
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

// Callback for parseSplats base Gsplat data
export type SplatCallback = (
  index: number,
  x: number,
  y: number,
  z: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  quatX: number,
  quatY: number,
  quatZ: number,
  quatW: number,
  opacity: number,
  r: number,
  g: number,
  b: number,
) => void;

// Callback for parseSplats SH coefficients
export type SplatShCallback = (
  index: number,
  sh1: Float32Array,
  sh2?: Float32Array,
  sh3?: Float32Array,
) => void;

// A PlyReader is used to parse PLY files for Gsplat data.
// It takes a Uint8Array/ArrayBuffer as input fileBytes, parses the text header,
// and provides a method parseData to iterate over the entire binary data
// efficiently, or parseSplats to iterate over Gsplat data.

export class PlyReader {
  fileBytes: Uint8Array;
  header = "";
  littleEndian = true;
  elements: Record<string, PlyElement> = {};
  comments: string[] = [];
  data: DataView | null = null;
  static defaultPointScale = 0.001;

  numSplats = 0;

  // Create a PlyReader from a Uint8Array/ArrayBuffer, no parsing done yet
  constructor({ fileBytes }: { fileBytes: Uint8Array | ArrayBuffer }) {
    this.fileBytes =
      fileBytes instanceof ArrayBuffer ? new Uint8Array(fileBytes) : fileBytes;
  }

  // Identify and parse the PLY text header (assumed to be <64KB in size).
  // this.elements will contain all the elements in the file, typically
  // "vertex" contains the Gsplat data.
  async parseHeader() {
    const bufferStream = new ReadableStream({
      start: (controller: ReadableStreamController<Uint8Array>) => {
        // Assume the header is less than 64KB
        controller.enqueue(this.fileBytes.slice(0, 65536));
        controller.close();
      },
    });
    const decoder = bufferStream
      .pipeThrough(new TextDecoderStream())
      .getReader();

    // Find the end of the text section of the PLY file
    this.header = "";
    const headerTerminator = "end_header\n";
    while (true) {
      const { value, done } = await decoder.read();
      if (done) {
        throw new Error("Failed to read header");
      }

      this.header += value as string;
      const endHeader = this.header.indexOf(headerTerminator);
      if (endHeader >= 0) {
        this.header = this.header.slice(0, endHeader + headerTerminator.length);
        break;
      }
    }
    // Partition the file into header and binary data
    const headerLen = new TextEncoder().encode(this.header).length;
    this.data = new DataView(this.fileBytes.buffer, headerLen);

    this.elements = {};
    let curElement: PlyElement | null = null;
    this.comments = [];

    this.header
      .trim()
      .split("\n")
      .forEach((line: string, lineIndex: number) => {
        const trimmedLine = line.trim();
        if (lineIndex === 0) {
          if (trimmedLine !== "ply") {
            throw new Error("Invalid PLY header");
          }
          return;
        }
        if (trimmedLine.length === 0) {
          return; // Skip empty lines
        }

        const fields = trimmedLine.split(" ");
        switch (fields[0]) {
          case "format":
            if (fields[1] === "binary_little_endian") {
              this.littleEndian = true;
            } else if (fields[1] === "binary_big_endian") {
              this.littleEndian = false;
            } else {
              // ascii formats not supported
              throw new Error(`Unsupported PLY format: ${fields[1]}`);
            }
            if (fields[2] !== "1.0") {
              throw new Error(`Unsupported PLY version: ${fields[2]}`);
            }
            break;
          case "end_header":
            break;
          case "comment":
            this.comments.push(trimmedLine.slice("comment ".length));
            break;
          case "element": {
            const name = fields[1];
            curElement = {
              name,
              count: Number.parseInt(fields[2]),
              properties: {},
            };
            this.elements[name] = curElement;
            break;
          }
          case "property":
            if (curElement == null) {
              throw new Error("Property must be inside an element");
            }
            if (fields[1] === "list") {
              curElement.properties[fields[4]] = {
                isList: true,
                type: fields[3] as PlyPropertyType,
                countType: fields[2] as PlyPropertyType,
              };
            } else {
              curElement.properties[fields[2]] = {
                isList: false,
                type: fields[1] as PlyPropertyType,
              };
            }
            break;
          default:
          // console.warn(`Skipping unsupported PLY keyword: ${fields[0]}`);
        }
      });

    if (this.elements.vertex) {
      this.numSplats = this.elements.vertex.count;
    }
  }

  parseData(
    elementCallback: (
      element: PlyElement,
    ) =>
      | null
      | ((index: number, item: Record<string, number | number[]>) => void),
  ) {
    // Go through the entire binary data of the PLY file, starting at offset 0
    let offset = 0;
    const data = this.data;
    if (data == null) {
      throw new Error("No data to parse");
    }

    for (const elementName in this.elements) {
      const element = this.elements[elementName];
      const { count, properties } = element;
      const item = createEmptyItem(properties);
      // Construct a parse function
      const parseFn = createParseFn(properties, this.littleEndian);

      // Parse all the items in the element
      const callback = elementCallback(element) ?? (() => {});
      for (let index = 0; index < count; index++) {
        offset = parseFn(data, offset, item);
        callback(index, item);
      }
    }
  }

  // Parse all the Gsplat data in the PLY file in go, invoking the given
  // callbacks for each Gsplat.
  parseSplats(splatCallback: SplatCallback, shCallback?: SplatShCallback) {
    if (this.elements.vertex == null) {
      throw new Error("No vertex element found");
    }

    let isSuperSplat = false;
    const ssChunks: SSChunk[] = [];

    let numSh = 0;
    let sh1Props: number[] = [];
    let sh2Props: number[] = [];
    let sh3Props: number[] = [];
    let sh1: Float32Array | undefined = undefined;
    let sh2: Float32Array | undefined = undefined;
    let sh3: Float32Array | undefined = undefined;

    function prepareSh() {
      // Prepare SH coefficient names and arrays for numSh total SH levels
      const num_f_rest = NUM_SH_TO_NUM_F_REST[numSh];
      sh1Props = new Array(3)
        .fill(null)
        .flatMap((_, k) => [0, 1, 2].map((_, d) => k + (d * num_f_rest) / 3));
      sh2Props = new Array(5)
        .fill(null)
        .flatMap((_, k) =>
          [0, 1, 2].map((_, d) => 3 + k + (d * num_f_rest) / 3),
        );
      sh3Props = new Array(7)
        .fill(null)
        .flatMap((_, k) =>
          [0, 1, 2].map((_, d) => 8 + k + (d * num_f_rest) / 3),
        );
      sh1 = numSh >= 1 ? new Float32Array(3 * 3) : undefined;
      sh2 = numSh >= 2 ? new Float32Array(5 * 3) : undefined;
      sh3 = numSh >= 3 ? new Float32Array(7 * 3) : undefined;
    }

    function ssShCallback(
      index: number,
      item: Record<string, number | number[]>,
    ) {
      // Decode SH for SuperSplat compressed data
      if (!sh1) {
        throw new Error("Missing sh1");
      }
      const sh = item.f_rest as number[];

      for (let i = 0; i < sh1Props.length; i++) {
        sh1[i] = (sh[sh1Props[i]] * 8) / 255 - 4;
      }
      if (sh2) {
        for (let i = 0; i < sh2Props.length; i++) {
          sh2[i] = (sh[sh2Props[i]] * 8) / 255 - 4;
        }
      }
      if (sh3) {
        for (let i = 0; i < sh3Props.length; i++) {
          sh3[i] = (sh[sh3Props[i]] * 8) / 255 - 4;
        }
      }
      shCallback?.(index, sh1, sh2, sh3);
    }

    function initSuperSplat(element: PlyElement) {
      const {
        min_x,
        min_y,
        min_z,
        max_x,
        max_y,
        max_z,
        min_scale_x,
        min_scale_y,
        min_scale_z,
        max_scale_x,
        max_scale_y,
        max_scale_z,
      } = element.properties;
      if (
        !min_x ||
        !min_y ||
        !min_z ||
        !max_x ||
        !max_y ||
        !max_z ||
        !min_scale_x ||
        !min_scale_y ||
        !min_scale_z ||
        !max_scale_x ||
        !max_scale_y ||
        !max_scale_z
      ) {
        throw new Error("Missing PLY chunk properties");
      }

      // SuperSplat chunks are used to quantize splat data, so we need to store them
      isSuperSplat = true;
      return (index: number, item: Record<string, number | number[]>) => {
        const {
          min_x,
          min_y,
          min_z,
          max_x,
          max_y,
          max_z,
          min_scale_x,
          min_scale_y,
          min_scale_z,
          max_scale_x,
          max_scale_y,
          max_scale_z,
          min_r,
          min_g,
          min_b,
          max_r,
          max_g,
          max_b,
        } = item as Record<string, number>;
        ssChunks.push({
          min_x,
          min_y,
          min_z,
          max_x,
          max_y,
          max_z,
          min_scale_x,
          min_scale_y,
          min_scale_z,
          max_scale_x,
          max_scale_y,
          max_scale_z,
          min_r,
          min_g,
          min_b,
          max_r,
          max_g,
          max_b,
        });
      };
    }

    function decodeSuperSplat(element: PlyElement) {
      // Decode SuperSplat compressed data in vertex and sh elements
      if (shCallback && element.name === "sh") {
        numSh = getNumSh(element.properties);
        prepareSh();
        return ssShCallback;
      }
      if (element.name !== "vertex") {
        return null;
      }

      const { packed_position, packed_rotation, packed_scale, packed_color } =
        element.properties;
      if (
        !packed_position ||
        !packed_rotation ||
        !packed_scale ||
        !packed_color
      ) {
        throw new Error(
          "Missing PLY properties: packed_position, packed_rotation, packed_scale, packed_color",
        );
      }

      const SQRT2 = Math.sqrt(2);

      return (index: number, item: Record<string, number | number[]>) => {
        // SuperSplat data are quantized within chunks with 256 Gsplats each
        const chunk = ssChunks[index >>> 8];
        if (chunk == null) {
          throw new Error("Missing PLY chunk");
        }
        const {
          min_x,
          min_y,
          min_z,
          max_x,
          max_y,
          max_z,
          min_scale_x,
          min_scale_y,
          min_scale_z,
          max_scale_x,
          max_scale_y,
          max_scale_z,
          min_r,
          min_g,
          min_b,
          max_r,
          max_g,
          max_b,
        } = chunk;
        const { packed_position, packed_rotation, packed_scale, packed_color } =
          item as Record<string, number>;

        const x =
          (((packed_position >>> 21) & 2047) / 2047) * (max_x - min_x) + min_x;
        const y =
          (((packed_position >>> 11) & 1023) / 1023) * (max_y - min_y) + min_y;
        const z = ((packed_position & 2047) / 2047) * (max_z - min_z) + min_z;

        const r0 = (((packed_rotation >>> 20) & 1023) / 1023 - 0.5) * SQRT2;
        const r1 = (((packed_rotation >>> 10) & 1023) / 1023 - 0.5) * SQRT2;
        const r2 = ((packed_rotation & 1023) / 1023 - 0.5) * SQRT2;
        const rr = Math.sqrt(Math.max(0, 1.0 - r0 * r0 - r1 * r1 - r2 * r2));

        const rOrder = packed_rotation >>> 30;
        const quatX = rOrder === 0 ? r0 : rOrder === 1 ? rr : r1;
        const quatY = rOrder <= 1 ? r1 : rOrder === 2 ? rr : r2;
        const quatZ = rOrder <= 2 ? r2 : rr;
        const quatW = rOrder === 0 ? rr : r0;

        const scaleX = Math.exp(
          (((packed_scale >>> 21) & 2047) / 2047) *
            (max_scale_x - min_scale_x) +
            min_scale_x,
        );
        const scaleY = Math.exp(
          (((packed_scale >>> 11) & 1023) / 1023) *
            (max_scale_y - min_scale_y) +
            min_scale_y,
        );
        const scaleZ = Math.exp(
          ((packed_scale & 2047) / 2047) * (max_scale_z - min_scale_z) +
            min_scale_z,
        );

        const r =
          (((packed_color >>> 24) & 255) / 255) *
            ((max_r ?? 1) - (min_r ?? 0)) +
          (min_r ?? 0);
        const g =
          (((packed_color >>> 16) & 255) / 255) *
            ((max_g ?? 1) - (min_g ?? 0)) +
          (min_g ?? 0);
        const b =
          (((packed_color >>> 8) & 255) / 255) * ((max_b ?? 1) - (min_b ?? 0)) +
          (min_b ?? 0);
        const opacity = (packed_color & 255) / 255;

        splatCallback(
          index,
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
      };
    }

    const elementCallback = (element: PlyElement) => {
      if (element.name === "chunk") {
        // "chunk" could conceivably be used for other formats, and we would
        // ideally check for the comment: Generated by SuperSplat 2.*
        // but gsplat also outputs this format without such a comment.
        // In order to support both, let's assume a "chunk" element should
        // be interpreted as this format.
        return initSuperSplat(element);
      }
      if (isSuperSplat) {
        return decodeSuperSplat(element);
      }

      if (element.name !== "vertex") {
        return null;
      }

      const {
        x,
        y,
        z,
        scale_0,
        scale_1,
        scale_2,
        rot_0,
        rot_1,
        rot_2,
        rot_3,
        opacity,
        f_dc_0,
        f_dc_1,
        f_dc_2,
        red,
        green,
        blue,
        alpha,
      } = element.properties;

      if (!x || !y || !z) {
        throw new Error("Missing PLY properties: x, y, z");
      }
      // Pure point cloud PLY files have no scales or rotations
      const hasScales = scale_0 && scale_1 && scale_2;
      const hasRots = rot_0 && rot_1 && rot_2 && rot_3;
      // Quantization scale factor for argb values
      const alphaDiv = alpha != null ? FIELD_SCALE[alpha.type] : 1;
      const redDiv = red != null ? FIELD_SCALE[red.type] : 1;
      const greenDiv = green != null ? FIELD_SCALE[green.type] : 1;
      const blueDiv = blue != null ? FIELD_SCALE[blue.type] : 1;

      numSh = getNumSh(element.properties);
      prepareSh();

      return (index: number, item: Record<string, number | number[]>) => {
        const scaleX = hasScales
          ? Math.exp(item.scale_0 as number)
          : PlyReader.defaultPointScale;
        const scaleY = hasScales
          ? Math.exp(item.scale_1 as number)
          : PlyReader.defaultPointScale;
        const scaleZ = hasScales
          ? Math.exp(item.scale_2 as number)
          : PlyReader.defaultPointScale;

        const quatX = hasRots ? (item.rot_1 as number) : 0;
        const quatY = hasRots ? (item.rot_2 as number) : 0;
        const quatZ = hasRots ? (item.rot_3 as number) : 0;
        const quatW = hasRots ? (item.rot_0 as number) : 1;

        const op =
          opacity != null
            ? 1.0 / (1.0 + Math.exp(-item.opacity as number))
            : alpha != null
              ? (item.alpha as number) / alphaDiv
              : 1.0;
        const r =
          f_dc_0 != null
            ? (item.f_dc_0 as number) * SH_C0 + 0.5
            : red != null
              ? (item.red as number) / redDiv
              : 1.0;
        const g =
          f_dc_1 != null
            ? (item.f_dc_1 as number) * SH_C0 + 0.5
            : green != null
              ? (item.green as number) / greenDiv
              : 1.0;
        const b =
          f_dc_2 != null
            ? (item.f_dc_2 as number) * SH_C0 + 0.5
            : blue != null
              ? (item.blue as number) / blueDiv
              : 1.0;

        splatCallback(
          index,
          item.x as number,
          item.y as number,
          item.z as number,
          scaleX,
          scaleY,
          scaleZ,
          quatX,
          quatY,
          quatZ,
          quatW,
          op,
          r,
          g,
          b,
        );

        if (shCallback && sh1) {
          const sh = item.f_rest as number[];
          if (sh1) {
            for (let i = 0; i < sh1Props.length; i++) {
              sh1[i] = sh[sh1Props[i]];
            }
          }
          if (sh2) {
            for (let i = 0; i < sh2Props.length; i++) {
              sh2[i] = sh[sh2Props[i]];
            }
          }
          if (sh3) {
            for (let i = 0; i < sh3Props.length; i++) {
              sh3[i] = sh[sh3Props[i]];
            }
          }
          shCallback(index, sh1, sh2, sh3);
        }
      };
    };

    this.parseData(elementCallback);
  }

  // Inject RGBA values into original PLY file, which can be used to modify
  // the color/opacity of the Gsplats and write out the modified PLY file.
  injectRgba(rgba: Uint8Array) {
    // Go through the entire binary data of the PLY file, starting at offset 0
    let offset = 0;
    const data = this.data;
    if (data == null) {
      throw new Error("No parsed data");
    }
    if (rgba.length !== this.numSplats * 4) {
      throw new Error("Invalid RGBA array length");
    }

    for (const elementName in this.elements) {
      const element = this.elements[elementName];
      const { count, properties } = element;
      const parsers = [];

      let rgbaOffset = 0;
      const isVertex = elementName === "vertex";
      if (isVertex) {
        for (const name of ["opacity", "f_dc_0", "f_dc_1", "f_dc_2"]) {
          if (!properties[name] || properties[name].type !== "float") {
            throw new Error(`Can't injectRgba due to property: ${name}`);
          }
        }
      }

      for (const [propertyName, property] of Object.entries(properties)) {
        if (!property.isList) {
          if (isVertex) {
            if (
              propertyName === "f_dc_0" ||
              propertyName === "f_dc_1" ||
              propertyName === "f_dc_2"
            ) {
              const component = Number.parseInt(
                propertyName.slice("f_dc_".length),
              );
              parsers.push(() => {
                // Inject DC coefficients
                const value =
                  (rgba[rgbaOffset + component] / 255 - 0.5) / SH_C0;
                SET_FIELD[property.type](
                  data,
                  offset,
                  this.littleEndian,
                  value,
                );
              });
            } else if (propertyName === "opacity") {
              parsers.push(() => {
                // Inject opacity sigmoid, clamped to [-100, 100]
                const value = Math.max(
                  -100,
                  Math.min(
                    100,
                    -Math.log(1.0 / (rgba[rgbaOffset + 3] / 255) - 1.0),
                  ),
                );
                SET_FIELD[property.type](
                  data,
                  offset,
                  this.littleEndian,
                  value,
                );
              });
            }
          }
          parsers.push(() => {
            offset += FIELD_BYTES[property.type];
          });
        } else {
          parsers.push(() => {
            const length = PARSE_FIELD[property.countType as PlyPropertyType](
              data,
              offset,
              this.littleEndian,
            );
            offset += FIELD_BYTES[property.countType as PlyPropertyType];
            offset += length * FIELD_BYTES[property.type];
          });
        }
      }

      for (let index = 0; index < count; index++) {
        // Go through all the data and field parsers to compute offset
        for (const parser of parsers) {
          parser();
        }
        if (isVertex) {
          rgbaOffset += 4;
        }
      }
    }
  }
}

export const SH_C0 = 0.28209479177387814;

type FieldParser = (
  data: DataView,
  offset: number,
  littleEndian: boolean,
) => number;
type FieldSetter = (
  data: DataView,
  offset: number,
  littleEndian: boolean,
  value: number,
) => void;

const PARSE_FIELD: Record<PlyPropertyType, FieldParser> = {
  char: (data: DataView, offset: number, littleEndian: boolean) => {
    return data.getInt8(offset);
  },
  uchar: (data: DataView, offset: number, littleEndian: boolean) => {
    return data.getUint8(offset);
  },
  short: (data: DataView, offset: number, littleEndian: boolean) => {
    return data.getInt16(offset, littleEndian);
  },
  ushort: (data: DataView, offset: number, littleEndian: boolean) => {
    return data.getUint16(offset, littleEndian);
  },
  int: (data: DataView, offset: number, littleEndian: boolean) => {
    return data.getInt32(offset, littleEndian);
  },
  uint: (data: DataView, offset: number, littleEndian: boolean) => {
    return data.getUint32(offset, littleEndian);
  },
  float: (data: DataView, offset: number, littleEndian: boolean) => {
    return data.getFloat32(offset, littleEndian);
  },
  double: (data: DataView, offset: number, littleEndian: boolean) => {
    return data.getFloat64(offset, littleEndian);
  },
};

const SET_FIELD: Record<PlyPropertyType, FieldSetter> = {
  char: (
    data: DataView,
    offset: number,
    littleEndian: boolean,
    value: number,
  ) => {
    data.setInt8(offset, value);
  },
  uchar: (
    data: DataView,
    offset: number,
    littleEndian: boolean,
    value: number,
  ) => {
    data.setUint8(offset, value);
  },
  short: (
    data: DataView,
    offset: number,
    littleEndian: boolean,
    value: number,
  ) => {
    data.setInt16(offset, value, littleEndian);
  },
  ushort: (
    data: DataView,
    offset: number,
    littleEndian: boolean,
    value: number,
  ) => {
    data.setUint16(offset, value, littleEndian);
  },
  int: (
    data: DataView,
    offset: number,
    littleEndian: boolean,
    value: number,
  ) => {
    data.setInt32(offset, value, littleEndian);
  },
  uint: (
    data: DataView,
    offset: number,
    littleEndian: boolean,
    value: number,
  ) => {
    data.setUint32(offset, value, littleEndian);
  },
  float: (
    data: DataView,
    offset: number,
    littleEndian: boolean,
    value: number,
  ) => {
    data.setFloat32(offset, value, littleEndian);
  },
  double: (
    data: DataView,
    offset: number,
    littleEndian: boolean,
    value: number,
  ) => {
    data.setFloat64(offset, value, littleEndian);
  },
};

const FIELD_BYTES: Record<PlyPropertyType, number> = {
  char: 1,
  uchar: 1,
  short: 2,
  ushort: 2,
  int: 4,
  uint: 4,
  float: 4,
  double: 8,
};

const FIELD_SCALE: Record<PlyPropertyType, number> = {
  char: 127,
  uchar: 255,
  short: 32767,
  ushort: 65535,
  int: 2147483647,
  uint: 4294967295,
  float: 1,
  double: 1,
};

const NUM_F_REST_TO_NUM_SH: Record<number, number> = {
  0: 0,
  9: 1,
  24: 2,
  45: 3,
};
const NUM_SH_TO_NUM_F_REST: Record<number, number> = {
  0: 0,
  1: 9,
  2: 24,
  3: 45,
};

const F_REST_REGEX = /^f_rest_([0-9]{1,2})$/;

function createEmptyItem(
  properties: Record<string, PlyProperty>,
): Record<string, number | number[]> {
  const item: Record<string, number | number[]> = {};
  for (const [propertyName, property] of Object.entries(properties)) {
    // Treat f_rest properties as a single array for performance
    if (F_REST_REGEX.test(propertyName)) {
      item.f_rest = new Array(getNumSh(properties));
    } else {
      item[propertyName] = property.isList ? [] : 0;
    }
  }
  return item;
}

function createParseFn(
  properties: Record<string, PlyProperty>,
  littleEndian: boolean,
) {
  if (USE_COMPILED_PARSER_FUNCTION && safeToCompile(properties)) {
    return createCompiledParserFn(properties, littleEndian);
  }
  return createDynamicParserFn(properties, littleEndian);
}

// Detect if unsafe eval is allowed in the current execution context
const UNSAFE_EVAL_ALLOWED = (() => {
  try {
    new Function("return 42;");
  } catch (e) {
    return false;
  }
  return true;
})();
const PROPERTY_NAME_REGEX = /^[a-zA-Z0-9_]+$/;

function safeToCompile(properties: Record<string, PlyProperty>) {
  if (!UNSAFE_EVAL_ALLOWED) {
    return false;
  }

  for (const [propertyName, property] of Object.entries(properties)) {
    if (!PROPERTY_NAME_REGEX.test(propertyName)) {
      return false;
    }

    if (
      property.isList &&
      !PLY_PROPERTY_TYPES.includes(property.countType as PlyPropertyType)
    ) {
      return false;
    }

    if (!PLY_PROPERTY_TYPES.includes(property.type)) {
      return false;
    }
  }
  return true;
}

function createCompiledParserFn(
  properties: Record<string, PlyProperty>,
  littleEndian: boolean,
) {
  // Construct the parser function source.
  const parserSrc: string[] = ["let list;"];
  for (const [propertyName, property] of Object.entries(properties)) {
    const fRestMatch = propertyName.match(F_REST_REGEX);
    if (fRestMatch) {
      const fRestIndex = +fRestMatch[1];
      parserSrc.push(/*js*/ `
        item.f_rest[${fRestIndex}] = PARSE_FIELD['${property.type}'](data, offset, ${littleEndian});
        offset += ${FIELD_BYTES[property.type]};
      `);
    } else if (!property.isList) {
      parserSrc.push(/*js*/ `
        item['${propertyName}'] = PARSE_FIELD['${property.type}'](data, offset, ${littleEndian});
        offset += ${FIELD_BYTES[property.type]};
      `);
    } else {
      // Property is a list, so parse the count first
      parserSrc.push(/*js*/ `
        list = item['${propertyName}'];
        list.length = PARSE_FIELD['${property.countType}'](data, offset, ${littleEndian});
        offset += ${FIELD_BYTES[property.countType as PlyPropertyType]};
        for (let i = 0; i < list.length; i++) {
          list[i] = PARSE_FIELD['${property.type}'](data, offset, ${littleEndian});
          offset += ${FIELD_BYTES[property.type]};
        }
      `);
    }
  }
  parserSrc.push("return offset;");

  const fn = new Function(
    "data",
    "offset",
    "item",
    "PARSE_FIELD",
    parserSrc.join("\n"),
  );
  return (
    data: DataView,
    offset: number,
    item: Record<string, number | number[]>,
  ) => fn(data, offset, item, PARSE_FIELD);
}

function createDynamicParserFn(
  properties: Record<string, PlyProperty>,
  littleEndian: boolean,
) {
  // Construct an array of parser function to parse each property in an item
  const parsers: Array<
    (
      data: DataView,
      offset: number,
      item: Record<string, number | number[]>,
    ) => number
  > = [];
  for (const [propertyName, property] of Object.entries(properties)) {
    const fRestMatch = propertyName.match(F_REST_REGEX);
    if (fRestMatch) {
      const fRestIndex = +fRestMatch[1];
      parsers.push(
        (
          data: DataView,
          offset: number,
          item: Record<string, number | number[]>,
        ) => {
          (item.f_rest as number[])[fRestIndex] = PARSE_FIELD[property.type](
            data,
            offset,
            littleEndian,
          );
          return offset + FIELD_BYTES[property.type];
        },
      );
    } else if (!property.isList) {
      parsers.push(
        (
          data: DataView,
          offset: number,
          item: Record<string, number | number[]>,
        ) => {
          item[propertyName] = PARSE_FIELD[property.type](
            data,
            offset,
            littleEndian,
          );
          return offset + FIELD_BYTES[property.type];
        },
      );
    } else {
      // Property is a list, so parse the count first
      parsers.push(
        (
          data: DataView,
          offset: number,
          item: Record<string, number | number[]>,
        ) => {
          const list = item[propertyName] as number[];
          list.length = PARSE_FIELD[property.countType as PlyPropertyType](
            data,
            offset,
            littleEndian,
          );
          let currentOffset =
            offset + FIELD_BYTES[property.countType as PlyPropertyType];
          for (let i = 0; i < list.length; i++) {
            list[i] = PARSE_FIELD[property.type](
              data,
              currentOffset,
              littleEndian,
            );
            currentOffset += FIELD_BYTES[property.type];
          }
          return currentOffset;
        },
      );
    }
  }

  return (
    data: DataView,
    offset: number,
    item: Record<string, number | number[]>,
  ) => {
    let currentOffset = offset;
    for (let parserIndex = 0; parserIndex < parsers.length; parserIndex++) {
      currentOffset = parsers[parserIndex](data, currentOffset, item);
    }
    return currentOffset;
  };
}

function getNumSh(properties: Record<string, PlyProperty>) {
  let num_f_rest = 0;
  while (properties[`f_rest_${num_f_rest}`]) {
    num_f_rest += 1;
  }
  const numSh = NUM_F_REST_TO_NUM_SH[num_f_rest];
  if (numSh == null) {
    throw new Error(`Unsupported number of SH coefficients: ${num_f_rest}`);
  }
  return numSh;
}

type SSChunk = {
  min_x: number;
  min_y: number;
  min_z: number;
  max_x: number;
  max_y: number;
  max_z: number;
  min_scale_x: number;
  min_scale_y: number;
  min_scale_z: number;
  max_scale_x: number;
  max_scale_y: number;
  max_scale_z: number;
  min_r?: number;
  min_g?: number;
  min_b?: number;
  max_r?: number;
  max_g?: number;
  max_b?: number;
};
