// TODO: support skinning
export function buildDepthBufferVert() {
  const src = `
    precision mediump float;
    
    uniform mat4 depthProjection, depthView, modelTransform;
    uniform mat4 sceneTransform;
    attribute vec3 position;
    varying highp float vDepth;

    void main() {
      mat4 model = modelTransform * sceneTransform;
      vec4 pos = depthProjection * depthView * model * vec4(position, 1.0);
      gl_Position = pos;
      vDepth = pos.z;
    }
  `;

  return src;
}

export function buildDepthBufferFrag() {
  const src = `
    precision mediump float;
    uniform sampler2D depthMap;
    varying float vDepth;
    void main() {
      gl_FragColor = vec4(vec3(vDepth), 1.0);
    }
  `;
  return src;
}
