import { mat4 } from "gl-matrix";

const primitiveCube = require("primitive-cube");
const cube = primitiveCube();

export function buildDrawDepthCamera(regl, depthCameraEye, depthDim) {
  const debugDrawDepthCamera = regl({
    vert: `
      precision mediump float;
      uniform mat4 projection, view, translation, scale, targetTo;
      attribute vec3 position;
      void main() {
        gl_Position = projection * view * translation * targetTo * scale * vec4(position, 1.0);
      }
    `,

    frag: `
      precision mediump float;
      void main() {
        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
      }
    `,
    attributes: {
      position: cube.positions,
    },
    uniforms: {
      translation: mat4.fromTranslation([], depthCameraEye),
      scale: mat4.fromScaling([], [depthDim * 2, depthDim * 2, depthDim * 2]),
      targetTo: mat4.targetTo([], depthCameraEye, [0, 0, 0], [0, 1, 0]),
    },
    elements: cube.cells,
    primitive: "lines",
  });
  return debugDrawDepthCamera;
}
