import { mat4, quat, vec3 } from "gl-matrix";
import { RenderFactory } from "./render-factory";
import { getTypedDataView } from "./gltf-utils";
import { chunkArray } from "./utils";
import { numComponentsForAccessorType } from "./gltf-constants";
import REGL from "regl";
import { keyframeValueForTime } from "./animation";

type RenderArgs = {
  animationName?: string;
  animationTime?: number;
  modelTransform: mat4;
};

type Renderable = (args: RenderArgs) => void;

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

export async function createRenderable(
  regl,
  manifest,
  buffer,
  assetNamespace
): Promise<Renderable> {
  const buildMeshRenderer = RenderFactory(manifest, buffer, assetNamespace);

  type MeshRendererRecord = Record<NodeIdx, REGL.DrawCommand[]>;
  // TODO: make this sync.  fetch textures, and pass to renderFactory.
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
  // const shouldPlayAnimation = animations.length !== 0;
  // const activeAnimation = 0; // idx;

  return (args: RenderArgs) => {
    if (args.animationName !== undefined) {
      const animation = animations.find((a) => a.name === args.animationName);
      if (!animation) throw new Error("animation not found");
      animation.channels.forEach((channel) => {
        manifest.nodes[channel.targetNode][
          channel.targetPath
        ] = keyframeValueForTime(
          channel.keyframes,
          channel.keyframeValues,
          args.animationTime || 0
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
          modelTransform: args.modelTransform,
          localTransform: nodeTransforms[nodeIdx],
          globalJointTransforms: nodeTransforms,
        })
      );
    });
  };
}
