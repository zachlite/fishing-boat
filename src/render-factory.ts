import REGL = require("regl");
import { getTypedDataView } from "./gltf-utils";
import { numComponentsForAccessorType, glEnumLookup } from "./gltf-constants";
import { mat4 } from "gl-matrix";
import { chunkArray } from "./utils";
import { AssetUrl } from "./constants";
import { buildPBRVert, buildPBRFrag } from "./pbr-shaders";
const calcNormals = require("angle-normals");

export async function loadImage(imgpath): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const image = new Image();
    image.src = `${AssetUrl}/${imgpath}`;
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
  });
}

interface Material {
  pbrMetallicRoughness: {
    baseColorTexture?: any;
    baseColorFactor?: [number, number, number, number];
    metallicFactor?: number;
    roughnessFactor?: number;
    metallicRoughnessTexture?: any;
  };
  normalTexture: any;
  emissiveTexture: any;
  occlusionTexture: any;
  emissiveFactor: [number, number, number];
}

interface MaterialUniforms {
  baseColorFactor?: [number, number, number, number];
  baseColorTexture?: REGL.Texture2D;
  metallicFactor?: number;
  roughnessFactor?: number;
  metallicRoughnessTexture?: REGL.Texture2D;
  normalTexture?: REGL.Texture2D;
  occlusionTexture?: REGL.Texture2D;
  emissiveTexture?: REGL.Texture2D;
  emissiveFactor?: [number, number, number];
}

async function buildMaterialUniforms(
  manifest,
  material: Material,
  regl: REGL.Regl,
  assetNamespace: string
): Promise<MaterialUniforms> {
  async function loadMaterialTexture(idx, textureFormat = undefined) {
    const texture = manifest.textures[idx];
    const uri = manifest.images[texture.source].uri;
    const image = await loadImage(`${assetNamespace}/${uri}`);

    const samplers = manifest.samplers || [];
    const sampler = samplers[texture.sampler];

    const mag = glEnumLookup[sampler?.magFilter] || "nearest";
    const min = glEnumLookup[sampler?.minFilter] || "nearest";
    const wrapS = glEnumLookup[sampler?.wrapS] || "repeat";
    const wrapT = glEnumLookup[sampler?.wrapT] || "repeat";

    const mipmap = min === "nearest mipmap linear";

    return regl.texture({
      data: image,
      mag,
      min,
      wrapS,
      wrapT,
      mipmap,
      // format: textureFormat || "rgba",
    });
  }

  let uniforms: MaterialUniforms = {};

  const {
    baseColorFactor,
    baseColorTexture,
    metallicFactor,
    roughnessFactor,
    metallicRoughnessTexture,
  } = material.pbrMetallicRoughness;

  const {
    normalTexture,
    occlusionTexture,
    emissiveTexture,
    emissiveFactor,
  } = material;

  uniforms.baseColorFactor = baseColorFactor || [1, 1, 1, 1];

  uniforms.metallicFactor = metallicFactor === undefined ? 1 : metallicFactor;
  uniforms.roughnessFactor =
    roughnessFactor === undefined ? 1 : roughnessFactor;
  uniforms.emissiveFactor = emissiveFactor || [0, 0, 0];

  if (baseColorTexture) {
    uniforms.baseColorTexture = await loadMaterialTexture(
      baseColorTexture.index,
      "srgb"
    );
  }

  if (metallicRoughnessTexture) {
    uniforms.metallicRoughnessTexture = await loadMaterialTexture(
      metallicRoughnessTexture.index
    );
  }

  if (normalTexture) {
    uniforms.normalTexture = await loadMaterialTexture(normalTexture.index);
  }

  if (occlusionTexture) {
    uniforms.occlusionTexture = await loadMaterialTexture(
      occlusionTexture.index
    );
  }

  if (emissiveTexture) {
    uniforms.emissiveTexture = await loadMaterialTexture(emissiveTexture.index);
  }

  return uniforms;
}

export function RenderFactory(manifest, buffer, assetNamespace) {
  function buildJointMatrixUniforms(skinIdx) {
    const skin = manifest.skins[skinIdx];
    const numJoints = manifest.skins[skinIdx].joints.length;
    const ibmAccessor = skin.inverseBindMatrices;
    const inverseBindMatrices = chunkArray(
      getTypedDataView(buffer, manifest, ibmAccessor),
      numComponentsForAccessorType["MAT4"]
    );

    function jointMatrixFn(jointIdx) {
      return (context, props) => {
        const jointMatrix = mat4.create();
        mat4.multiply(
          jointMatrix,
          props.globalJointTransforms[skin.joints[jointIdx]],
          inverseBindMatrices[jointIdx]
        );
        return jointMatrix;
      };
    }

    let uniforms = {};

    for (let i = 0; i < numJoints; i++) {
      uniforms[`jointMatrix[${i}]`] = jointMatrixFn(i);
    }

    return uniforms;
  }

  function buildJointAttributes(regl, primitive) {
    const jointAccessorIdx = primitive.attributes.JOINTS_0;
    const jointAccessor = manifest.accessors[jointAccessorIdx];
    const jointBufferView = manifest.bufferViews[jointAccessor.bufferView];

    const weightAccessorIdx = primitive.attributes.WEIGHTS_0;
    const weightAccessor = manifest.accessors[weightAccessorIdx];
    const weightBufferView = manifest.bufferViews[weightAccessor.bufferView];

    return {
      joint: {
        buffer: regl.buffer(
          new Uint16Array(
            buffer,
            jointBufferView.byteOffset,
            jointBufferView.byteLength / 2
          )
        ),
        offset: jointAccessor.byteOffset,
        stride: jointBufferView.byteStride || 0,
      },
      weight: {
        buffer: regl.buffer(
          new Float32Array(
            buffer,
            weightBufferView.byteOffset,
            weightBufferView.byteLength / 4
          )
        ),
        offset: weightAccessor.byteOffset,
        stride: weightBufferView.byteStride || 0,
      },
    };
  }

  function buildRenderFn(regl, meshIdx, skinIdx) {
    const mesh = manifest.meshes[meshIdx];
    const fns = mesh.primitives.map(async (primitive) => {
      const normalAccessorIdx = primitive.attributes.NORMAL;
      const positionAccessorIdx = primitive.attributes.POSITION;
      const indicesAccessorIdx = primitive.indices;
      const indicesData = getTypedDataView(
        buffer,
        manifest,
        indicesAccessorIdx
      );

      const positionAccessor = manifest.accessors[positionAccessorIdx];
      const positionBufferView =
        manifest.bufferViews[positionAccessor.bufferView];

      const normalsAccessor = manifest.accessors[normalAccessorIdx];
      const normalsBufferView =
        manifest.bufferViews[normalsAccessor.bufferView];

      const positionsChunked = chunkArray(
        new Float32Array(
          buffer,
          positionBufferView.byteOffset,
          positionBufferView.byteLength / 4
        ),
        3
      );

      let attributes: any = {
        position: {
          buffer: regl.buffer(
            new Float32Array(
              buffer,
              positionBufferView.byteOffset,
              positionBufferView.byteLength / 4
            )
          ),
          offset: positionAccessor.byteOffset,
          stride: positionBufferView.byteStride,
        },
        // normal: calcNormals(chunkArray(indicesData, 3), positionsChunked),
        normal: {
          buffer: regl.buffer(
            new Float32Array(
              buffer,
              positionBufferView.byteOffset,
              positionBufferView.byteLength / 4
            )
          ),
          offset: normalsAccessor.byteOffset,
          stride: normalsBufferView.byteStride,
        },
      };

      if (primitive.attributes.TANGENT !== undefined) {
        const tangentAccessorIdx = primitive.attributes.TANGENT;
        const tangentAccessor = manifest.accessors[tangentAccessorIdx];
        const tangentBufferView =
          manifest.bufferViews[tangentAccessor.bufferView];
        attributes["aTangent"] = {
          buffer: regl.buffer(
            new Float32Array(
              buffer,
              tangentBufferView.byteOffset,
              tangentBufferView.byteLength / 4
            )
          ),
          offset: tangentAccessor.byteOffset,
          stride: tangentBufferView.byteStride,
        };
      }

      // uvs
      if (primitive.attributes.TEXCOORD_0 !== undefined) {
        const uvAccessorIdx = primitive.attributes.TEXCOORD_0;
        const uvAccessor = manifest.accessors[uvAccessorIdx];
        const uvBufferView = manifest.bufferViews[uvAccessor.bufferView];
        attributes["uv"] = {
          buffer: regl.buffer(
            new Float32Array(
              buffer,
              uvBufferView.byteOffset,
              uvBufferView.byteLength / 4
            )
          ),
          offset: uvAccessor.byteOffset,
          stride: uvBufferView.byteStride,
        };
      }

      /// material
      const materialIdx = primitive.material;
      const material = manifest.materials[materialIdx];

      let uniforms: {
        sceneTransform: any;
        modelTransform: any;
      } & MaterialUniforms = {
        sceneTransform: (context, props) => props.localTransform,
        modelTransform: (context, props) => props.modelTransform,
      };

      if (skinIdx !== undefined) {
        // build joint matrix
        uniforms = { ...uniforms, ...buildJointMatrixUniforms(skinIdx) };

        // set joint and weight attributes
        attributes = {
          ...attributes,
          ...buildJointAttributes(regl, primitive),
        };
      }

      uniforms = {
        ...uniforms,
        ...(await buildMaterialUniforms(
          manifest,
          material,
          regl,
          assetNamespace
        )),
      };

      return {
        attributes,
        uniforms,
        elements: indicesData,
      };
    });
    return fns;
  }

  return buildRenderFn;
}
