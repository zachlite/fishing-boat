import REGL = require("regl");
import { getTypedDataView } from "./gltf-utils";
import { numComponentsForAccessorType, glEnumLookup } from "./gltf-constants";
import { mat4 } from "gl-matrix";
import { chunkArray } from "./utils";
import { AssetUrl } from "./constants";

async function loadImage(imgpath): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const image = new Image();
    image.src = `${AssetUrl}/${imgpath}`;
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
  });
}

class FragSourceBuilder {
  private uniforms;
  private varyings;

  constructor() {
    this.uniforms = ``;
    this.varyings = ``;
  }

  setUniform(uniforms) {
    this.uniforms += uniforms;
  }

  setVarying(varyings) {
    this.varyings += varyings;
  }

  build(mainSource: string) {
    const precision = `precision mediump float;`;

    const main = `void main () {
        ${mainSource}
      }`;

    return `
      ${precision}
      ${this.uniforms}
      ${this.varyings}
      ${main}
    `;
  }
}

class VertSourceBuilder {
  private uniforms;
  private attributes;
  private varyings;

  constructor() {
    this.uniforms = ``;
    this.attributes = ``;
    this.varyings = ``;
  }

  setAttribute(attributes) {
    this.attributes += attributes;
  }

  setUniform(uniforms) {
    this.uniforms += uniforms;
  }

  setVarying(varyings) {
    this.varyings += varyings;
  }

  build(mainSource: string) {
    const precision = `precision mediump float;`;

    const main = `void main () {
        ${mainSource}
      }`;

    return `
      ${precision}
      ${this.uniforms}
      ${this.attributes}
      ${this.varyings}
      ${main}
    `;
  }
}

interface Material {
  pbrMetallicRoughness: any;
  normalTexture: any;
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
  async function loadMaterialTexture(idx) {
    const texture = manifest.textures[idx];
    const uri = manifest.images[texture.source].uri;
    const image = await loadImage(`${assetNamespace}/${uri}`);

    const samplers = manifest.samplers || [];
    const sampler = samplers[texture.sampler];

    const mag = glEnumLookup[sampler?.magFilter] || "nearest";
    const min = glEnumLookup[sampler?.minFilter] || "nearest";
    const wrapS = glEnumLookup[sampler?.wrapS] || "repeat";
    const wrapT = glEnumLookup[sampler?.wrapT] || "repeat";

    return regl.texture({ data: image, mag, min, wrapS, wrapT, mipmap: true });
  }

  let uniforms: MaterialUniforms = {};

  const {
    baseColorFactor,
    baseColorTexture,
    metallicFactor,
    roughnessFactor,
    metallicRoughnessTexture,
    normalTexture,
    occlusionTexture,
    emissiveTexture,
    emissiveFactor,
  } = material.pbrMetallicRoughness;

  uniforms.baseColorFactor = baseColorFactor || [1, 1, 1, 1];
  uniforms.metallicFactor = metallicFactor || 1;
  uniforms.roughnessFactor = roughnessFactor || 1;
  uniforms.emissiveFactor = emissiveFactor || [0, 0, 0];

  if (baseColorTexture) {
    uniforms.baseColorTexture = await loadMaterialTexture(
      baseColorTexture.index
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
  function buildMeshRenderFn(regl, meshIdx, skinIdx) {
    const mesh = manifest.meshes[meshIdx];
    const fns: Promise<REGL.DrawCommand>[] = mesh.primitives.map(
      async (primitive) => {
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

        const attributes: any = {
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
          normal: {
            buffer: regl.buffer(
              new Float32Array(
                buffer,
                normalsBufferView.byteOffset,
                normalsBufferView.byteLength / 4
              )
            ),
            offset: normalsAccessor.byteOffset,
            stride: normalsBufferView.byteStride,
          },
        };

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
        // TODO: handle default material

        // assume pbrmetallicroughness:
        let uniforms: { sceneTransform: any } & MaterialUniforms = {
          sceneTransform: (context, props) => props.localTransform,
        };

        if (skinIdx !== undefined) {
          // get inverseBindMatrices
          // get joints and weights
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

          for (let i = 0; i < numJoints; i++) {
            uniforms[`jointMatrix[${i}]`] = jointMatrixFn(i);
          }

          const jointAccessorIdx = primitive.attributes.JOINTS_0;
          const jointAccessor = manifest.accessors[jointAccessorIdx];
          const jointBufferView =
            manifest.bufferViews[jointAccessor.bufferView];

          attributes["joint"] = {
            buffer: regl.buffer(
              new Uint16Array(
                buffer,
                jointBufferView.byteOffset,
                jointBufferView.byteLength / 2
              )
            ),
            offset: jointAccessor.byteOffset,
            stride: jointBufferView.byteStride || 0,
          };

          const weightAccessorIdx = primitive.attributes.WEIGHTS_0;
          const weightAccessor = manifest.accessors[weightAccessorIdx];
          const weightBufferView =
            manifest.bufferViews[weightAccessor.bufferView];

          attributes["weight"] = {
            buffer: regl.buffer(
              new Float32Array(
                buffer,
                weightBufferView.byteOffset,
                weightBufferView.byteLength / 4
              )
            ),
            offset: weightAccessor.byteOffset,
            stride: weightBufferView.byteStride || 0,
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

        // build uniforms based on material properties

        // build shader support for pbrMetallicRougnhness material
        // lights?

        const vertSourceBuilder = new VertSourceBuilder();
        const fragSourceBuilder = new FragSourceBuilder();

        vertSourceBuilder.setUniform("uniform mat4 projection, view;");
        vertSourceBuilder.setVarying("varying vec3 vWorldPos;");
        fragSourceBuilder.setVarying("varying vec3 vWorldPos;");
        fragSourceBuilder.setUniform("uniform vec3 eye;");

        if (attributes.position) {
          vertSourceBuilder.setAttribute("attribute vec3 position;");
        }
        if (attributes.normal) {
          vertSourceBuilder.setAttribute("attribute vec3 normal;");
          vertSourceBuilder.setVarying("varying vec3 vNormal;");
          fragSourceBuilder.setVarying("varying vec3 vNormal;");
        }
        if (attributes.uv) {
          vertSourceBuilder.setAttribute("attribute vec2 uv;");
          vertSourceBuilder.setVarying("varying highp vec2 vuv;");
          fragSourceBuilder.setVarying("varying highp vec2 vuv;");
        }

        if (attributes.joint) {
          vertSourceBuilder.setAttribute("attribute vec4 joint;");
        }

        if (attributes.weight) {
          vertSourceBuilder.setAttribute("attribute vec4 weight;");
        }

        if (uniforms.sceneTransform !== undefined) {
          vertSourceBuilder.setUniform("uniform mat4 sceneTransform;");
        }

        // PBR material data
        fragSourceBuilder.setUniform("uniform vec4 baseColorFactor;");
        fragSourceBuilder.setUniform("uniform float metallicFactor;");
        fragSourceBuilder.setUniform("uniform float roughnessFactor;");
        fragSourceBuilder.setUniform("uniform vec3 emissiveFactor;");

        if (uniforms.baseColorTexture !== undefined) {
          fragSourceBuilder.setUniform("uniform sampler2D baseColorTexture;");
        }
        if (uniforms.metallicRoughnessTexture !== undefined) {
          fragSourceBuilder.setUniform(
            "uniform sampler2D metallicRoughnessTexture;"
          );
        }
        if (uniforms.normalTexture !== undefined) {
          fragSourceBuilder.setUniform("uniform sampler2D normalTexture;");
        }
        if (uniforms.occlusionTexture !== undefined) {
          fragSourceBuilder.setUniform("uniform sampler2D occlusionTexture;");
        }
        if (uniforms.emissiveTexture !== undefined) {
          fragSourceBuilder.setUniform("uniform sampler2D emissiveTexture;");
        }

        if (skinIdx !== undefined) {
          const numJoints = manifest.skins[skinIdx].joints.length;
          vertSourceBuilder.setUniform(
            `uniform mat4 jointMatrix[${numJoints}];`
          );
        }

        const skinMatrixSrc = `
          mat4 skinMatrix = weight.x * jointMatrix[int(joint.x)] +
                            weight.y * jointMatrix[int(joint.y)] +
                            weight.z * jointMatrix[int(joint.z)] +
                            weight.w * jointMatrix[int(joint.w)];
        `;

        // SUPPORT:
        // EmissiveMap
        // OcclusionMap
        // NormalMap

        function buildNormalSrc(texture) {
          return texture
            ? `vec3 N = texture2D(normalTexture, vuv).rgb; N = normalize(N * 2.0 - 1.0);`
            : `vec3 N = normalize(vNormal);`;
        }

        function buildMetallicSrc(texture) {
          return texture
            ? `float metallic = texture2D(metallicRoughnessTexture, vuv).b * metallicFactor;`
            : `float metallic = metallicFactor;`;
        }

        function buildRougnessSrc(texture) {
          return texture
            ? `float roughness = texture2D(metallicRoughnessTexture, vuv).g * roughnessFactor;`
            : `float roughness = roughnessFactor;`;
        }

        function buildBaseColorSrc(texture) {
          return texture
            ? `vec3 baseColor = texture2D(baseColorTexture, vuv) * baseColorFactor;`
            : `vec3 baseColor = baseColorFactor;`;
        }

        const BRDFSrc = `

          // constants:
          vec3 dialectricSpecular = vec3(.04);
          vec3 black = vec3(0.0);

          // Metallic:
          ${buildMetallicSrc(uniforms.metallicRoughnessTexture)}

          // Roughness:
          ${buildRougnessSrc(uniforms.metallicRoughnessTexture)}

          // Base Color:
          ${buildBaseColorSrc(uniforms.baseColorTexture)}

          // Normal:
          ${buildNormalSrc(uniforms.normalTexture)}
          
          vec3 Cdiff = lerp(baseColor.rgb * (1.0 - dialectricSpecular.r), black, metallic);
          vec3 F0 = lerp(dialectricSpecular, baseColor.rgb, metallic);
          float alpha = roughness * roughness;
        

          vec3 LightDir = vec3(1, 0, 0);
          vec3 V = normalize(eye - vWorldPos);
          vec3 L = normalize(LightDir - vWorldPos);
          vec3 H = normalize(L + V);


          // gl_FragColor = kd * f_lambert + ks * f_cooktorrance;


        `;

        const localTransform =
          skinIdx !== undefined ? "skinMatrix" : "sceneTransform";

        const vert = vertSourceBuilder.build(`
                  ${skinIdx !== undefined ? skinMatrixSrc : ""}
                  ${attributes.uv ? "vuv = uv;" : ""}
                  vNormal = normal;
                  vWorldPos = (${localTransform} * vec4(position, 1.0)).xyz;
                  gl_Position = projection * view * ${localTransform} * vec4(position, 1.0);
                  `);

        const frag = fragSourceBuilder.build(
          uniforms.baseColorTexture
            ? `gl_FragColor = texture2D(baseColorTexture, vuv) * baseColorFactor;`
            : `gl_FragColor = baseColorFactor;`
        );

        return regl({
          vert,
          frag,
          attributes,
          uniforms,
          elements: indicesData,
        });
      }
    );
    return fns;
  }

  return buildMeshRenderFn;
}
