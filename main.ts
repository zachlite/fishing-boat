import { mat4, quat, vec3 } from "gl-matrix";
import REGL = require("regl");
import { debug } from "console";
import { chdir } from "process";

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
  function buildMeshRenderFn(regl, meshIdx) {
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

        if (uniforms.baseColorFactor) {
          fragSourceBuilder.setUniform("uniform vec4 baseColorFactor;");
        }

        if (uniforms.sceneTransform) {
          vertSourceBuilder.setUniform("uniform mat4 sceneTransform;");
        }

        if (uniforms.tex) {
          fragSourceBuilder.setUniform("uniform sampler2D tex;");
        }

        const vert = vertSourceBuilder.build(`
                  ${attributes.uv ? "vuv = uv;" : ""}
                  gl_Position = projection * view * sceneTransform * vec4(position, 1.0);
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

function buildMeshTransforms(
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
      ...buildMeshTransforms(nodes, nodeIdx, globalTransform),
    };
  });

  return { [nodeIdx]: globalTransform, ...children };
}

window.onload = async () => {
  const regl = REGL();
  const camera = require("regl-camera")(regl, {
    damping: 0,
  });

  const assetNamespace = "CesiumMilkTruck";
  const glTFfile = "CesiumMilkTruck";
  const binFile = "CesiumMilkTruck_data";

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
    meshRenderers[i] = await Promise.all(buildMeshRenderer(regl, node.mesh));
  }

  regl.frame(() => {
    camera(() => {
      regl.clear({ color: [1, 1, 1, 1] });

      // build all mesh transforms
      const rootNodeIdx = manifest.scenes[0].nodes[0];
      const meshTransforms = buildMeshTransforms(manifest.nodes, rootNodeIdx);

      Object.entries(meshRenderers).forEach(([nodeIdx, renderers]) => {
        renderers.forEach((renderFn) =>
          renderFn({ localTransform: meshTransforms[nodeIdx] })
        );
      });
    });
  });
};
