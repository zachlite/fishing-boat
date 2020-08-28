import { mat4, quat, vec3 } from "gl-matrix";
import REGL = require("regl");
import { keyframeValueForTime } from "./src/animation";
import { RenderFactory } from "./src/render-factory";
import { getTypedDataView } from "./src/gltf-utils";
import { chunkArray } from "./src/utils";
import { numComponentsForAccessorType } from "./src/gltf-constants";
import { AssetUrl } from "./src/constants";

async function fetchglTF(manifestPath, binPath) {
  const manifest = await fetch(`${AssetUrl}/${manifestPath}`).then((response) =>
    response.json()
  );

  const buffer = await fetch(`${AssetUrl}/${binPath}`).then((response) =>
    response.arrayBuffer()
  );

  return { manifest, buffer };
}

// a bufferView is interleaved if bytesForComponentType * numComponents > bufferView.byteStride

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
  const regl = REGL({ extensions: ["oes_element_index_uint"] });
  const camera = require("regl-camera")(regl, { damping: 0 });

  const assetNamespace = "avocado";
  const glTFfile = "Avocado";
  const binFile = "Avocado";

  const { manifest, buffer } = await fetchglTF(
    `${assetNamespace}/${glTFfile}.gltf`,
    `${assetNamespace}/${binFile}.bin`
  );

  console.log(manifest, buffer);

  const buildMeshRenderer = RenderFactory(manifest, buffer, assetNamespace);

  type MeshRendererRecord = Record<NodeIdx, REGL.DrawCommand[]>;
  const meshRenderers: MeshRendererRecord = await manifest.nodes.reduce(
    async (acc, node, nodeIdx) => {
      if (node.mesh === undefined) return acc;
      const renderersForMesh = await Promise.all(
        buildMeshRenderer(regl, node.mesh, node.skin)
      );
      (await acc)[nodeIdx] = renderersForMesh;
      return acc;
    },
    {}
  );

  const animations = getAnimations(manifest, buffer);
  const shouldPlayAnimation = animations.length !== 0;
  const activeAnimation = 0; // idx;

  // assume directional light
  const LightDirection = [1, 0, 0];
  const LightColor = [1, 1, 1];

  regl.frame((context) => {
    const time = context.time;

    camera((cameraContext) => {
      // console.log(cameraContext.eye, cameraContext.center);
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
