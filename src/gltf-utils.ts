import {
  numComponentsForAccessorType,
  arrayConstructorForComponentType,
} from "./gltf-constants";
import { Accessor } from "./gltf-types";

export function getTypedDataView(
  buffer: ArrayBuffer,
  manifest,
  accessorIndex: number
) {
  const accessor: Accessor = manifest.accessors[accessorIndex];
  const bufferView = manifest.bufferViews[accessor.bufferView];
  return new arrayConstructorForComponentType[accessor.componentType](
    buffer,
    (accessor.byteOffset || 0) + (bufferView.byteOffset || 0),
    accessor.count * numComponentsForAccessorType[accessor.type]
  );
}
