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
    elements: plane.cells,
  });
}
