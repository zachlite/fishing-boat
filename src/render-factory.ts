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

        // assume pbrmetallicroughness:
        const uniforms: any = {
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

        if (material.pbrMetallicRoughness.baseColorFactor) {
          uniforms.baseColorFactor =
            material.pbrMetallicRoughness.baseColorFactor;
        }
        if (material.pbrMetallicRoughness.baseColorTexture) {
          const texIndex =
            material.pbrMetallicRoughness.baseColorTexture.index || 0;
          const texture = manifest.textures[texIndex];
          const uri = manifest.images[texture.source].uri;
          const image = await loadImage(`${assetNamespace}/${uri}`);

          const samplers = manifest.samplers || [];
          const sampler = samplers[texture.sampler];

          const mag = glEnumLookup[sampler?.magFilter] || "nearest";
          const min = glEnumLookup[sampler?.minFilter] || "nearest";
          const wrapS = glEnumLookup[sampler?.wrapS] || "repeat";
          const wrapT = glEnumLookup[sampler?.wrapT] || "repeat";

          uniforms.tex = regl.texture({
            data: image,
            mag,
            min,
            wrapS,
            wrapT,
            mipmap: true,
          });
        }

        const vertSourceBuilder = new VertSourceBuilder();
        const fragSourceBuilder = new FragSourceBuilder();

        vertSourceBuilder.setUniform("uniform mat4 projection, view;");

        if (attributes.position) {
          vertSourceBuilder.setAttribute("attribute vec3 position;");
        }
        if (attributes.normal) {
          vertSourceBuilder.setAttribute("attribute vec3 normal;");
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

        if (uniforms.baseColorFactor) {
          fragSourceBuilder.setUniform("uniform vec4 baseColorFactor;");
        }

        if (uniforms.sceneTransform) {
          vertSourceBuilder.setUniform("uniform mat4 sceneTransform;");
        }

        if (uniforms.tex) {
          fragSourceBuilder.setUniform("uniform sampler2D tex;");
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

        const localTransform =
          skinIdx !== undefined ? "skinMatrix" : "sceneTransform";

        const vert = vertSourceBuilder.build(`
                  ${skinIdx !== undefined ? skinMatrixSrc : ""}
                  ${attributes.uv ? "vuv = uv;" : ""}
                  gl_Position = projection * view * ${localTransform} * vec4(position, 1.0);
                  `);

        const frag = fragSourceBuilder.build(
          uniforms.tex
            ? `gl_FragColor = texture2D(tex, vuv);`
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
