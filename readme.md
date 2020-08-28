- DONE: support more than 1 mesh
- DONE: support interleaved attributes
- DONE: target a node's transform and change it without rebuilding renderers.
- DONE: skinning
- TODO: support more than 1 primitive per mesh
- TODO: pbrMetallicRoughness support
- TODO: support more than 1 buffer.
- TODO: support for non-index geo
- TODO: support more than 1 root node
- TODO: support more than 1 texture per material.

Lights
Materials

## PBR Pipeline: (Metallic-Roughness Material)

support:

- baseColor
- metallicFactor
- roughnessFactor

Factor or Texture support

Spec compliant:

- When factors are specified, use as linear multiplier.
- baseColorTexture uses sRGB transfer function and must be converted to linear space before being used for computation.
- If a primitive specifies aa vertex color using COLOR_0, this value acts an additional linear multiplier to baseColor
- alpha coverage
