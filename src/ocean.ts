import { BRDFReflectanceSource, shadowMapSamplerSource } from "./pbr-shaders";
import { mat4, quat } from "gl-matrix";

const oceanTransform = {
  translation: [0, 0, 0],
  rotaton: [90, 0, 0],
  scale: [1, 1, 1],
};

function createPlane(sx, sy, nx, ny, options) {
  sx = sx || 1;
  sy = sy || sx;
  nx = nx || 1;
  ny = ny || nx;
  var quads = options && options.quads ? options.quads : false;
  var includeUvs = options && options.uvs ? options.uvs : false;

  var positions = [];
  var uvs = [];
  var normals = [];
  var cells = [];

  for (var iy = 0; iy <= ny; iy++) {
    for (var ix = 0; ix <= nx; ix++) {
      var u = ix / nx;
      var v = iy / ny;
      var x = -sx / 2 + u * sx; // starts on the left
      var y = sy / 2 - v * sy; // starts at the top
      positions.push(x, y, 0);
      if (includeUvs) uvs.push(u, 1.0 - v);
      normals.push(0, 0, 1);
      if (iy < ny && ix < nx) {
        if (quads) {
          cells.push(
            iy * (nx + 1) + ix,
            (iy + 1) * (nx + 1) + ix,
            (iy + 1) * (nx + 1) + ix + 1,
            iy * (nx + 1) + ix + 1
          );
        } else {
          cells.push(
            iy * (nx + 1) + ix,
            (iy + 1) * (nx + 1) + ix + 1,
            iy * (nx + 1) + ix + 1
          );
          cells.push(
            (iy + 1) * (nx + 1) + ix + 1,
            iy * (nx + 1) + ix,
            (iy + 1) * (nx + 1) + ix
          );
        }
      }
    }
  }

  return {
    positions: positions,
    normals: normals,
    uvs: uvs,
    cells: cells,
  };
}

export function buildDrawOcean(regl) {
  const plane = createPlane(100, 100, 1000, 1000, null);

  const drawOcean = regl({
    vert: `
      precision mediump float;
      uniform float time;
      uniform mat4 projection, view, model;
      uniform mat4 depthProjection, depthView;
      attribute vec3 position, normal;
      varying vec3 vWorldPos, vNormal;
      varying vec3 vPosDepthSpace; //TODO: will need w component when dealing with point light shadows.
  
      float random (in vec2 st) {
        return fract(sin(dot(st.xy,
                             vec2(12.9898,78.233)))
                     * 43758.5453123);
      }

    
      struct WaveParams {
        float A; // amplitude
        float L; // length
        float S; // speed
        vec2 D; // direction
      };


      float computeWaveHeight(vec3 pos, float time, WaveParams wave) {
        // amplitude:
        float A = wave.A;
        
        // wavelength and frequency:
        float L = wave.L;
        float f = 2.0 / L;

        // speed:
        float Phi = wave.S * f;

        // direction:
        vec2 D = wave.D;

        float sinvalue = sin(dot(normalize(D), pos.xy) * f + (time * Phi));
        float waveHeight = A * sinvalue;

        return waveHeight;
      }

      vec3 gerstnerWave(vec3 pos, float time, WaveParams wave) {
        float f = 2.0 / wave.L;
        float Q = .75 / f * wave.A; // steepness

        float cosTerm = cos(dot(normalize(wave.D), pos.xy) * f + (time * wave.S * f));

        float x = Q * wave.A * wave.D.x * cosTerm;
        float y = Q * wave.A * wave.D.y * cosTerm;
        float z = -computeWaveHeight(pos, time, wave);

        return vec3(x, y, z);
      }

  
      void main () {
        WaveParams w1 = WaveParams(.78, 8.31, 4.0, vec2(1.0, 0.0));
        WaveParams w2 = WaveParams(.68, 6.40, 3.53, vec2(.7, .121));
        WaveParams w3 = WaveParams(0.435, 10.75, 1.82, vec2(1.243, .83));
        WaveParams w4 = WaveParams(0.005, .54, 2.9, vec2(.13, 1.0283));
        WaveParams w5 = WaveParams(0.134, 2.75, 3.4, vec2(.82, .233));

        vec3 wave =  gerstnerWave(position, time, w1)
                + gerstnerWave(position, time, w2)
                + gerstnerWave(position, time, w3)
                + gerstnerWave(position, time, w4)
                + gerstnerWave(position, time, w5);

        wave.x += position.x;
        wave.y += position.y;


        wave.z += random(position.xy) / 80.0;
        vec4 pos = model * vec4(wave, 1.0);

        vWorldPos = pos.xyz / pos.w; 
        vPosDepthSpace = (depthProjection * depthView * pos).xyz;
        vNormal = normal;
        gl_PointSize = 3.0;
        gl_Position = projection * view * pos;
      }
    `,
    frag: `
      precision mediump float;
      #extension GL_OES_standard_derivatives : enable
  
      uniform vec3 lightDirection, eye;
      uniform sampler2D depthSampler;
  
      varying vec3 vPosDepthSpace; //TODO: will need w component when dealing with point light shadows.
      varying vec3 vWorldPos, vNormal;
      const float pi = 3.141592653;
  
      ${BRDFReflectanceSource}
      ${shadowMapSamplerSource}
  
      void main () {
  
        vec4 oceanBaseColor = vec4(0.0, 0.4, 1.0, 1.0);
        vec3 Cdiff = oceanBaseColor.rgb * .96;
        vec3 radiance = vec3(1.0);
        float roughness = 0.2;
        vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
        vec3 V = normalize(eye - vWorldPos);
        vec3 L = normalize(-lightDirection);
        vec3 H = normalize(L + V);
  
        vec3 Lo = SchlickReflectance(N, V, L, H, radiance, Cdiff, roughness);
        vec3 ambient = vec3(.5) * oceanBaseColor.xyz;
  
        float shadow = inShadow(vPosDepthSpace, N, L);
        vec3 color = ambient + (shadow * Lo);
  
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    attributes: {
      position: plane.positions,
      normal: plane.normals,
    },
    uniforms: {
      time: (context, props) => props.time,
      depthSampler: (context, props: any) => props.depthSampler,
      model: mat4.fromRotationTranslationScale(
        mat4.create(),
        quat.fromEuler(
          quat.create(),
          oceanTransform.rotaton[0],
          oceanTransform.rotaton[1],
          oceanTransform.rotaton[2]
        ),
        oceanTransform.translation as any,
        oceanTransform.scale as any
      ),
    },
    elements: plane.cells,
  });

  return drawOcean;
}
