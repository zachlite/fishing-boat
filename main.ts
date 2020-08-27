import { mat4, quat, vec3 } from "gl-matrix";
import REGL = require("regl");
import { debug } from "console";
import { chdir } from "process";
import { keyframeValueForTime } from "./src/animation";

const AssetUrl = "http://localhost:8080";

async function fetchglTF(manifestPath, binPath) {
  const manifest = await fetch(`${AssetUrl}/${manifestPath}`).then((response) =>
    response.json()
  );

  const buffer = await fetch(`${AssetUrl}/${binPath}`).then((response) =>
    response.arrayBuffer()
  );

  return { manifest, buffer };
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

const vert = `
  precision mediump float;
  uniform mat4 projection, view, sceneTransform;
  attribute vec3 position, normal;
  attribute vec2 uv;
  varying vec2 vUv;
  void main () {
    gl_Position = projection * view * sceneTransform * vec4(position, 1.0);
  }`;

const frag = `
  precision mediump float;
  uniform vec4 baseColorFactor;
  void main () {
    gl_FragColor = baseColorFactor;
  }
`;

function chunkArray(arr, size) {
  return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  );
}

const numComponentsForAccessorType = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

type AccessorComponentType = 5120 | 5121 | 5122 | 5123 | 5125 | 5126;
type AccessorType =
  | "SCALAR"
  | "VEC2"
  | "VEC3"
  | "VEC4"
  | "MAT2"
  | "MAT3"
  | "MAT4";

interface Accessor {
  bufferView: number;
  byteOffset: number;
  componentType: AccessorComponentType;
  count: number;
  type: AccessorType;
}

const arrayConstructorForComponentType = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};

const glEnumLookup = {
  9729: "linear",
  9986: "nearest mipmap linear",
  10497: "repeat",
};

// a bufferView is interleaved if bytesForComponentType * numComponents > bufferView.byteStride

function getTypedDataView(
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

async function loadImage(imgpath): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const image = new Image();
    image.src = `${AssetUrl}/${imgpath}`;
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
  });
}

function RenderFactory(manifest, buffer, assetNamespace) {
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
        if (primitive.attributes.TEXCOORD_0) {
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

        // how many joints are there?

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
type NodeIdx = number;

function buildLocalTransform(node) {
  if (node.matrix) {
    return node.matrix;
  }
  return mat4.fromRotationTranslationScale(
    mat4.create(),
    node.rotation || quat.create(),
    node.translation || vec3.create(),
    node.scale || vec3.fromValues(1, 1, 1)
  );
}

function buildNodeTransforms(
  nodes,
  nodeIdx,
  parentTransform = mat4.create()
): Record<NodeIdx, mat4> {
  const node = nodes[nodeIdx];
  const localTransform = buildLocalTransform(node);
  const globalTransform = mat4.multiply(
    mat4.create(),
    parentTransform,
    localTransform
  );

  let children = {};
  (node.children || []).forEach((nodeIdx) => {
    children = {
      ...children,
      ...buildNodeTransforms(nodes, nodeIdx, globalTransform),
    };
  });

  return { [nodeIdx]: globalTransform, ...children };
}

interface Animation {
  name: string;
  channels: {
    targetNode: number;
    targetPath: "rotation" | "translation";
    keyframes: any[];
    keyframeValues: any[];
    interpolation: "LINEAR";
  }[];
}

function getAnimations(manifest, buffer): Animation[] {
  if (manifest.animations === undefined || manifest.animations.length === 0)
    return [];

  return manifest.animations.map((animation, idx) => {
    const name = animation.name || `animation_${idx}`;
    const channels = animation.channels.map((channel) => {
      const sampler = animation.samplers[channel.sampler];
      const interpolation = sampler.interpolation;

      const keyframes = Array.from(
        getTypedDataView(buffer, manifest, sampler.input)
      );

      const keyframeValues = chunkArray(
        getTypedDataView(buffer, manifest, sampler.output),
        numComponentsForAccessorType[manifest.accessors[sampler.output].type]
      );

      return {
        targetNode: channel.target.node,
        targetPath: channel.target.path,
        keyframes,
        keyframeValues,
        interpolation,
      };
    });
    return { name, channels };
  });
}

window.onload = async () => {
  const regl = REGL();
  const camera = require("regl-camera")(regl, {
    damping: 0,
  });

  const assetNamespace = "RiggedFigure";
  const glTFfile = "RiggedFigure";
  const binFile = "RiggedFigure0";

  const { manifest, buffer } = await fetchglTF(
    `${assetNamespace}/${glTFfile}.gltf`,
    `${assetNamespace}/${binFile}.bin`
  );

  console.log(manifest, buffer);

  const buildMeshRenderer = RenderFactory(manifest, buffer, assetNamespace);

  let meshRenderers: Record<NodeIdx, REGL.DrawCommand[]> = {};
  for (let i = 0; i < manifest.nodes.length; i++) {
    const node = manifest.nodes[i];
    if (node.mesh === undefined) continue;
    meshRenderers[i] = await Promise.all(
      buildMeshRenderer(regl, node.mesh, node.skin)
    );
  }

  const animations = getAnimations(manifest, buffer);
  const shouldPlayAnimation = animations.length !== 0;
  const activeAnimation = 0; // idx;

  regl.frame((context) => {
    const time = context.time;
    camera(() => {
      regl.clear({ color: [1, 1, 1, 1] });

      if (shouldPlayAnimation) {
        animations[activeAnimation].channels.forEach((channel) => {
          manifest.nodes[channel.targetNode][
            channel.targetPath
          ] = keyframeValueForTime(
            channel.keyframes,
            channel.keyframeValues,
            time
          );
        });
      }

      // build all mesh transforms
      const nodeTransforms = manifest.scenes[0].nodes.reduce((acc, nodeIdx) => {
        acc = { ...acc, ...buildNodeTransforms(manifest.nodes, nodeIdx) };
        return acc;
      }, {});

      Object.entries(meshRenderers).forEach(([nodeIdx, renderers]) => {
        renderers.forEach((renderFn) =>
          renderFn({
            localTransform: nodeTransforms[nodeIdx],
            globalJointTransforms: nodeTransforms,
          })
        );
      });
    });
  });
};
