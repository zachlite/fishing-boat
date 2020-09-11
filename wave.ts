import { debug } from "console";
import { quat, vec2, vec3 } from "gl-matrix";

function computeWaveHeight(pos, time, wave: Wave) {
  // amplitude:
  const A = wave.amplitude;

  // wavelength and frequency:
  const L = wave.length;
  const f = 2.0 / L;

  // speed:
  const Phi = wave.speed * f;

  // direction:
  const D = wave.direction;

  const waveHeight =
    A * -Math.sin(vec2.dot(D as any, pos as any) * f + time * Phi);

  return waveHeight;
}

interface Wave {
  amplitude: number;
  length: number;
  speed: number;
  direction: [number, number];
}

/// pos is xz!
function computeGerstnerWave(pos, time, wave: Wave): [number, number, number] {
  const f = 2.0 / wave.length;
  const Q = (0.75 / f) * wave.amplitude;

  const cosTerm = Math.cos(
    vec2.dot(vec2.normalize([] as any, wave.direction), pos) * f +
      time * wave.speed * f
  );

  return [
    Q * wave.amplitude * wave.direction[0] * cosTerm,
    -computeWaveHeight(pos, time, wave),
    Q * wave.amplitude * wave.direction[1] * cosTerm,
  ];
}

export function computeWaveHeightAndNormal(pos, time) {
  const waves: Wave[] = [
    { amplitude: 0.78, length: 8.31, speed: 4, direction: [1.0, 0.0] },
    { amplitude: 0.68, length: 6.4, speed: 3.53, direction: [0.7, 0.121] },
    { amplitude: 0.435, length: 10.75, speed: 1.82, direction: [1.243, 0.83] },
    { amplitude: 0.134, length: 2.75, speed: 3.4, direction: [0.82, 0.233] },
    { amplitude: 0.005, length: 0.54, speed: 2.9, direction: [0.13, 1.0283] },
  ];

  let wave = [0, 0, 0] as any;

  waves.forEach((waveconfig) => {
    vec3.add(wave, wave, computeGerstnerWave(pos, time, waveconfig));
  });

  const height = wave[1];

  const normal = wave;
  normal[0] /= 5;
  normal[2] /= 5;
  normal[1] = 1;

  vec3.normalize(normal, normal);

  return { height, normal };
}

export function computeRotationFromWaveNormal(normal, rotationFromWave) {
  const cross = vec3.cross([] as any, normal, [0, 1, 0]);
  const waveDotUp = vec3.dot(normal, [0, 1, 0]);

  rotationFromWave[0] = cross[0];
  rotationFromWave[1] = cross[1];
  rotationFromWave[2] = cross[2];
  rotationFromWave[3] =
    Math.sqrt(
      Math.pow(vec3.len(normal), 2) * Math.pow(vec3.len([0, 1, 0]), 2)
    ) + waveDotUp;

  quat.normalize(rotationFromWave, rotationFromWave);
  return rotationFromWave;
}
