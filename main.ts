import { mat4, quat, glMatrix, vec3 } from "gl-matrix";
import REGL = require("regl");
import { keyframeValueForTime } from "./src/animation";
import { AssetUrl } from "./src/constants";
import {
  loadMeshPrimitives,
  buildRenderer,
  buildNodeTransforms,
} from "./src/renderable";
import {
  buildPBRVert,
  buildPBRFrag,
  BRDFReflectanceSource,
  shadowMapSamplerSource,
} from "./src/pbr-shaders";
import {
  buildDepthBufferVert,
  buildDepthBufferFrag,
} from "./src/depth-buffer-shaders";
import { buildDrawOcean } from "./src/ocean";
import { buildDrawDepthCamera } from "./src/debug-depth-camera";
import { computeWaveHeight } from "./wave";

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

window.onload = async () => {
  // const canvas = document.getElementById("canvas") as any;
  // const context = canvas.getContext("webgl", { antialias: true });
  const regl = REGL({
    extensions: [
      "oes_element_index_uint",
      "EXT_sRGB",
      "OES_standard_derivatives",
    ],
  });
  const camera = require("regl-camera")(regl, {
    damping: 0,
    // center: [0, 1, 0],
  });

  const assetNamespace = "fishing_boat";
  const glTFfile = "scene";
  const binFile = "scene";

  const { manifest, buffer } = await fetchglTF(
    `${assetNamespace}/${glTFfile}.gltf`,
    `${assetNamespace}/${binFile}.bin`
  );

  console.log(manifest, buffer);

  // assume directional light

  const transform = {
    translation: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.01, 0.01, 0.01],
  };

  const calcModelTransform = (transform) =>
    mat4.fromRotationTranslationScale(
      mat4.create(),
      quat.fromEuler(
        quat.create(),
        transform.rotation[0],
        transform.rotation[1],
        transform.rotation[2]
      ),
      transform.translation as any,
      transform.scale as any
    );

  const projection = mat4.create();
  const lookAt = mat4.create();
  const cameraTransform = {
    eye: [100, 100, 0.00001],
    look: [0, 0, 0],
    up: [0, 1, 0],
  };
  const cameraContext = regl({
    context: {
      projection: function (context) {
        return mat4.perspective(
          projection,
          glMatrix.toRadian(45),
          context.viewportWidth / context.viewportHeight,
          0.01,
          1000
        );
      },
      view: mat4.lookAt(
        lookAt,
        cameraTransform.eye as any,
        cameraTransform.look as any,
        cameraTransform.up as any
      ),
      eye: cameraTransform.eye,
    },
    uniforms: {
      projection: regl.context("projection" as any),
      view: regl.context("view" as any),
      eye: regl.context("eye" as any),
    },
  });

  const lightContext = regl({
    context: {
      lightDirection: (context, props: any) => {
        return props.lightDirection;
      },
    },
    uniforms: {
      lightDirection: regl.context("lightDirection" as any),
    },
  });

  // TODO: decouple depth camera eye from light direction.

  const lightDirection = [1, -1, 1];
  const depthCameraEye = vec3.scale([], lightDirection, -1);
  depthCameraEye[2] += 0.00001;

  // 'createRenderable' is too high level
  // I need to be able to render to different targets, and the gltf loader shouldn't assume what target I'm rendering to.
  const boatPrimitives = await loadMeshPrimitives(
    regl,
    manifest,
    buffer,
    assetNamespace
  );

  const nodeTransforms = manifest.scenes[0].nodes.reduce((acc, nodeIdx) => {
    acc = { ...acc, ...buildNodeTransforms(manifest.nodes, nodeIdx) };
    return acc;
  }, {});

  const res = 8192;
  const depthBuffer = regl.framebuffer({
    width: res,
    height: res,
    depth: true,
  });

  const depthBufferRenderer = buildRenderer(
    regl,
    boatPrimitives,
    {
      vertBuilder: buildDepthBufferVert,
      fragBuilder: buildDepthBufferFrag,
    },
    depthBuffer
  );

  const pbrRenderer = buildRenderer(
    regl,
    boatPrimitives,
    {
      vertBuilder: buildPBRVert,
      fragBuilder: buildPBRFrag,
    },
    null,
    { depthSampler: (context, props) => props.depthSampler }
  );

  const depthDim = 5;
  const depthProjection = mat4.ortho(
    mat4.create(),
    -depthDim,
    depthDim,
    -depthDim,
    depthDim,
    -depthDim,
    depthDim
  );

  const depthView = mat4.lookAt(
    mat4.create(),
    depthCameraEye,
    [0, 0, 0],
    [0, 1, 0]
  );

  const depthCameraContext = regl({
    context: {
      depthProjection: (context, props: any) => props.depthProjection,
      depthView: (context, props) => props.depthView,
    },
    uniforms: {
      depthProjection: regl.context("depthProjection" as any),
      depthView: regl.context("depthView" as any),
    },
  });

  let debugState = {
    drawDepthCamera: false,
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "d") {
      debugState.drawDepthCamera = !debugState.drawDepthCamera;
    }
  });

  const drawOcean = buildDrawOcean(regl);
  const debugDrawDepthCamera = buildDrawDepthCamera(
    regl,
    depthCameraEye,
    depthDim
  );

  regl.frame((context) => {
    const time = context.time;

    regl.clear({ color: [0, 0, 0, 1], depth: 1 });
    regl.clear({
      color: [1, 1, 1, 1],
      depth: 1,
      framebuffer: depthBuffer,
    });

    // compute the wave height at the boat's xz.
    transform.translation[1] = computeWaveHeight(transform.translation, time);
    // transform.rotation[1] = Math.cos(time);
    // transform.rotation[0] = Math.sin(time);
    // transform.rotation[2] = Math.cos(time);
    const modelTransform = calcModelTransform(transform);

    camera((c) => {
      lightContext({ lightDirection }, () => {
        depthCameraContext({ depthProjection, depthView }, () => {
          if (debugState.drawDepthCamera) {
            debugDrawDepthCamera();
          }

          // TODO: I hate this API
          // bad separation of concerns between glTF and rendering.
          depthBufferRenderer(modelTransform, nodeTransforms);

          pbrRenderer(modelTransform, nodeTransforms, {
            depthSampler: depthBuffer,
          });

          drawOcean({ depthSampler: depthBuffer, time });
        });
      });
    });
  });
};
