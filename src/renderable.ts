import { mat4, quat, vec3 } from "gl-matrix";
import { RenderFactory } from "./render-factory";
import { getTypedDataView } from "./gltf-utils";
import { chunkArray } from "./utils";
import { numComponentsForAccessorType } from "./gltf-constants";
import REGL = require("regl");

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

export function buildNodeTransforms(
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
type MeshPrimitivesRecord = Record<
  NodeIdx,
  { uniforms: any; attributes: any; elements: any }[]
>;

export async function loadMeshPrimitives(
  regl,
  manifest,
  buffer,
  assetNamespace
): Promise<MeshPrimitivesRecord> {
  // TODO: this renderFactory / render naming convention no longer applies...
  const buildRenderFn = RenderFactory(manifest, buffer, assetNamespace);

  // TODO: make this sync.  fetch textures, and pass to renderFactory.
  const meshPrimitives = await manifest.nodes.reduce(
    async (acc, node, nodeIdx) => {
      if (node.mesh === undefined) return acc;
      const renderers = await Promise.all(
        buildRenderFn(regl, node.mesh, node.skin)
      );
      (await acc)[nodeIdx] = renderers;
      return acc;
    },
    {}
  );

  return meshPrimitives;

  // const animations = getAnimations(manifest, buffer);
  // const shouldPlayAnimation = animations.length !== 0;
  // const activeAnimation = 0; // idx;
  // if (args.animationName !== undefined) {
  //   const animation = animations.find((a) => a.name === args.animationName);
  //   if (!animation) throw new Error("animation not found");
  //   animation.channels.forEach((channel) => {
  //     manifest.nodes[channel.targetNode][
  //       channel.targetPath
  //     ] = keyframeValueForTime(
  //       channel.keyframes,
  //       channel.keyframeValues,
  //       args.animationTime || 0
  //     );
  //   });
  // }
}

export function buildRenderer(
  regl,
  meshes: MeshPrimitivesRecord,
  shaders,
  framebuffer = null,
  customUniforms = {}
) {
  // collect renderers per node
  const renderFns: Record<NodeIdx, REGL.DrawCommand[]> = Object.keys(
    meshes
  ).reduce((acc, nodeId) => {
    acc[nodeId] = meshes[nodeId].flatMap((primitive) => {
      const { attributes, elements } = primitive;
      const uniforms = { ...primitive.uniforms, ...customUniforms };
      return regl({
        vert: shaders.vertBuilder(attributes, uniforms, 0), // TODO: figure out num joints.
        frag: shaders.fragBuilder(attributes, uniforms),
        attributes,
        uniforms,
        elements,
        framebuffer,
      });
    });

    return acc;
  }, {});

  // return a function that invokes them
  return (modelTransform, nodeTransforms, uniforms = {}) => {
    Object.entries(renderFns).forEach(([nodeIdx, renderers]) => {
      renderers.forEach((renderFn) =>
        renderFn({
          modelTransform,
          localTransform: nodeTransforms[nodeIdx],
          globalJointTransforms: nodeTransforms,
          ...uniforms,
        })
      );
    });
  };
}
