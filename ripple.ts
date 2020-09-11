import { mat4, quat, vec2, vec3 } from "gl-matrix";
import {
  computeRotationFromWaveNormal,
  computeWaveHeightAndNormal,
} from "./wave";

const primitivePlane = require("primitive-plane");
const plane = primitivePlane();

export function buildDrawRipple(regl, image) {
  return regl({
    vert: `
      precision mediump float;
      uniform mat4 projection, view, model;
      attribute vec3 position;
      attribute vec2 uv;
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projection * view * model * vec4(position, 1.0);
      }
    
    `,
    frag: `
      precision mediump float;
      uniform sampler2D imageSampler;
      uniform float alpha;
      varying vec2 vUv;

      void main(){
        vec4 color = texture2D(imageSampler, vUv);
        if (color.a < .5) {
          discard;
        }
        color.a = alpha;
        gl_FragColor = color;
      }
    `,
    uniforms: {
      imageSampler: regl.texture(image),
      model: (context, props) => props.transform,
      alpha: (context, props) => props.alpha,
    },
    attributes: {
      position: plane.positions,
      uv: plane.uvs,
    },
    blend: {
      enable: true,
      func: {
        srcRGB: "src alpha",
        srcAlpha: 1,
        dstRGB: "one minus src alpha",
        dstAlpha: 1,
      },
      equation: {
        rgb: "add",
        alpha: "add",
      },
      color: [0, 0, 0, 0],
    },
    elements: plane.cells,
  });
}

export interface Ripple {
  lifetime: number;
  age: number;
  endScale: vec3;
  alpha: number;
  transform: any;
  waveRotation: quat;
}

// build a ripple with a random lifetime
// lerp alpha by lifetime
// lerp scale by that lifetime
export function updateRipple(ripple: Ripple, dt: number, globalTime: number) {
  ripple.age += dt;
  const t = ripple.age / ripple.lifetime;
  const alpha = vec2.lerp([], [1, 0], [0, 0], t)[0];
  const scale = vec3.lerp([], [1, 1, 1], ripple.endScale, t);

  ripple.alpha = alpha;
  ripple.transform.scale = scale;

  if (t > 1.1) {
    // recycle
    ripple.age = 0;
    ripple.alpha = 1.0;
    ripple.transform.scale = [1, 1, 1];
  }

  const pos = [
    ripple.transform.translation[0],
    ripple.transform.translation[2],
  ];
  const waveEffect = computeWaveHeightAndNormal(pos, globalTime);
  ripple.transform.translation[1] = waveEffect.height;

  ripple.waveRotation = computeRotationFromWaveNormal(
    waveEffect.normal,
    ripple.waveRotation
  );

  return ripple;
}

export function createRipple(): Ripple {
  return {
    lifetime: Math.random() * 2 + 2,
    age: 0,
    endScale: [5, 5, 10],
    alpha: 1,
    transform: {
      translation: [0, 3, 0],
      rotation: [90, 0, 0],
      scale: [1, 1, 1],
    },
    waveRotation: [0, 0, 0, 0],
  };
}

export function calcRippleTransformMatrix(ripple: Ripple) {
  return mat4.fromRotationTranslationScale(
    mat4.create(),

    quat.multiply(
      [],
      ripple.waveRotation,
      quat.fromEuler(
        quat.create(),
        ripple.transform.rotation[0],
        ripple.transform.rotation[1],
        ripple.transform.rotation[2]
      )
    ),
    ripple.transform.translation as any,
    ripple.transform.scale as any
  );
}
