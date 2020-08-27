export type AccessorComponentType = 5120 | 5121 | 5122 | 5123 | 5125 | 5126;
export type AccessorType =
  | "SCALAR"
  | "VEC2"
  | "VEC3"
  | "VEC4"
  | "MAT2"
  | "MAT3"
  | "MAT4";

export interface Accessor {
  bufferView: number;
  byteOffset: number;
  componentType: AccessorComponentType;
  count: number;
  type: AccessorType;
}
