export function buildPBRVert(attributes, uniforms, numJoints = 0) {
  // prettier-ignore
  const source = `
    precision mediump float;
    
    uniform mat4 projection, view, modelTransform;
    ${uniforms.sceneTransform ? `uniform mat4 sceneTransform;` : ``}
    ${numJoints > 0 ? `uniform mat4 jointMatrix[${numJoints}]` : ``}

    attribute vec3 position;
    attribute vec3 normal;
    ${attributes.uv ? `attribute vec2 uv;` : ``}
    ${attributes.aTangent ? `attribute vec4 aTangent;` : ``}
    ${attributes.joint ? `attribute vec4 joint;` : ``}
    ${attributes.weight ? `attribute vec4 weight;` : ``}

    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying mat3 v_TBN;
    ${attributes.uv ? `varying vec2 vuv;` : ``}

    void main() {
      ${numJoints > 0 ? `
      mat4 skinMatrix = weight.x * jointMatrix[int(joint.x)] +
                        weight.y * jointMatrix[int(joint.y)] +
                        weight.z * jointMatrix[int(joint.z)] +
                        weight.w * jointMatrix[int(joint.w)];
      ` : ``}

      mat4 localTransform = ${numJoints > 0 ? `skinMatrix;` : `sceneTransform;`}
      mat4 model = modelTransform * localTransform;

      
      ${attributes.aTangent ? `
      vec3 T = normalize(vec3(model * aTangent));
      vec3 N = normalize(vec3(model * vec4(normal, 0.0)));
      vec3 B = normalize(cross(N, T));
      v_TBN = mat3(T,B,N);
      ` : ``}
      
      ${attributes.uv ? `vuv = uv;` : ``}
      vNormal = mat3(model) * normal;
      vec4 pos = model * vec4(position, 1.0);
      vWorldPos = vec3(pos.xyz) / pos.w;
      gl_Position = projection * view * pos;
    }
  `;

  return source;
}

export function buildPBRFrag(attributes, uniforms) {
  console.log(uniforms);
  // prettier-ignore
  const source = `

    precision mediump float;
    #extension GL_OES_standard_derivatives : enable

    const float pi = 3.141592653;
    const float GAMMA = 2.2;
    const float INV_GAMMA = 1.0 / GAMMA;

    uniform vec3 eye;
    uniform vec3 lightDirection;
    uniform vec4 baseColorFactor;
    uniform float metallicFactor;
    uniform float roughnessFactor;
    uniform vec3 emissiveFactor;

    varying vec2 vuv;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    varying mat3 v_TBN;


    ${uniforms.baseColorTexture ? `uniform sampler2D baseColorTexture;` : ``}
    ${uniforms.metallicRoughnessTexture? `uniform sampler2D metallicRoughnessTexture;` : ``}
    ${uniforms.normalTexture? `uniform sampler2D normalTexture;` : ``}
    ${uniforms.occlusionTexture? `uniform sampler2D occlusionTexture;` : ``}
    ${uniforms.emissiveTexture? `uniform sampler2D emissiveTexture;` : ``}


    float FresnelSchlick(float VdotH) {
      return pow(1.0 - VdotH, 5.0);
    }

    float MicrofacetDistribution(float NdotH, float a) {
      float a2     = a*a;
      float NdotH2 = NdotH*NdotH;
      float num   = a2;
      float denom = (NdotH2 * (a2 - 1.0) + 1.0);
      denom = pi * denom * denom;
      return num / max(denom, .00001);
    }
    
    float GeometrySchlickGGX(float NdotV, float roughness) {
      float r = (roughness + 1.0);
      float k = (r*r) / 8.0;

      float nom   = NdotV;
      float denom = NdotV * (1.0 - k) + k;

      return nom / denom;
    }

    float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
      float NdotV = max(dot(N, V), 0.0);
      float NdotL = max(dot(N, L), 0.0);
      float ggx2 = GeometrySchlickGGX(NdotV, roughness);
      float ggx1 = GeometrySchlickGGX(NdotL, roughness);
      return ggx1 * ggx2;
    }

    vec3 linearTosRGB(vec3 color) {
      return pow(color, vec3(INV_GAMMA));
    }
    
    vec3 sRGBToLinear(vec3 srgbIn) {
      return vec3(pow(srgbIn.xyz, vec3(GAMMA)));
    }

    vec4 sRGBToLinear(vec4 srgbIn) {
      return vec4(sRGBToLinear(srgbIn.xyz), srgbIn.w);
    }

    vec3 getNormal() {
      ${attributes.aTangent ? `
        vec3 N = texture2D(normalTexture, vuv).rgb;
        N = v_TBN * normalize(N * 2.0 - 1.0);
      `: `
        // vec3 N = normalize(vNormal);
        vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
      `}
      return N;
    }

    float getMetallic() {
      ${uniforms.metallicRoughnessTexture 
        ? `float metallic = texture2D(metallicRoughnessTexture, vuv).b * metallicFactor;` 
        : `float metallic = metallicFactor;`
      }
      return metallic;
    }

    float getRoughness() {
      ${uniforms.metallicRoughnessTexture
        ? `float roughness = texture2D(metallicRoughnessTexture, vuv).g * roughnessFactor;`
        : `float roughness = roughnessFactor;`
      }
      return roughness;
    }

    vec4 getBaseColor() {
      ${uniforms.baseColorTexture
        ? `vec4 baseColor = baseColorFactor;
           baseColor *= sRGBToLinear(texture2D(baseColorTexture, vuv));`
        : `vec4 baseColor = baseColorFactor;`
      }
      return baseColor;
    }

    void main() {
      vec4 baseColor = getBaseColor();
      float metallic = getMetallic();
      float roughness = getRoughness();

      vec3 ambient = vec3(.1) * baseColor.rgb;
      vec3 radiance = vec3(5.0); // assumed lightColor
      
      vec3 dialectricSpecular = vec3(.04);
      vec3 black = vec3(0.0);
      
      vec3 Cdiff = mix(baseColor.rgb * (1.0 - dialectricSpecular.r), black, metallic);
      vec3 F0 = mix(dialectricSpecular, baseColor.rgb, metallic);
      float alpha = roughness * roughness;
      
      vec3 N = getNormal();
      vec3 V = normalize(eye - vWorldPos);
      vec3 L = normalize(-lightDirection);
      vec3 H = normalize(L + V);

      float VdotH = clamp(dot(V, H), 0.0, 1.0);
      float NdotL = clamp(dot(N, L), 0.0, 1.0);
      float NdotV = clamp(dot(N, V), 0.0, 1.0);
      float NdotH = clamp(dot(N, H), 0.0, 1.0);

      float G = GeometrySmith(N, V, L, roughness);
      float D = MicrofacetDistribution(NdotH, alpha);
      float F = FresnelSchlick(VdotH);

      float fspecular = F * G * D / max(4.0 * NdotL * NdotV, .0001);
      vec3 diffuse = Cdiff / pi;
      vec3 fdiffuse = (1.0 - F) * diffuse;
      vec3 Lo = (fdiffuse + fspecular) * radiance * NdotL;
      
      vec3 color = ambient + Lo;

      // gamma correction
      color = linearTosRGB(color);

      gl_FragColor = vec4(color, 1.0);
    }
  `
  return source;
}
