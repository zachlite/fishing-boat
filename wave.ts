import { vec2 } from "gl-matrix";

export function computeWaveHeight(pos, time) {
  // amplitude:
  const A = 0.1;

  // wavelength and frequency:
  const L = 1.0;
  const f = 2.0 / L;

  // speed:
  const S = 1.0 * f;

  // direction:
  const D = [1, 0];

  const xy = [pos[0], pos[2]];
  const waveHeight =
    A * -Math.sin(vec2.dot(D as any, xy as any) * f + time * S);

  return waveHeight;
}
