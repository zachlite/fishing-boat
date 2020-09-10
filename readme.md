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

Known PBR Issues

- Fresnel
- Normal map, tangent space?
- Linear vs sRGB

Normal TODO:

- the avocado model had bad normals - i needed to recalculated them
- Before computing the TBN matrix, the normal needed to brought into world space.

Boat Diorama:

- water, waves, reflections
- point lights

## Boat Scene Todo:

- Boat height respects wave
- ship lights
- Gerstner waves
- Boat roll and pitch respects wave normal
- skybox
- ripples

DONE:

- buoy and buoy shadow
