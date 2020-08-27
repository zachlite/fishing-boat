import { vec3, vec4, quat } from "gl-matrix";

/**
 * lerp between keyframe values
 * @param t0 keyframe start time
 * @param t1 keyframe end time
 * @param elapsed time elapsed since t0.  0 <= elapsed <= (t1 - t0)
 * @param v0 keyframe value corresponding to t0
 * @param v1 keyframe value corresponding to t1
 */
function lerpKeyFrames(t0, t1, elapsed, v0, v1) {
  const t = elapsed / (t1 - t0);

  // handle vec3
  if (v0.length === 3) {
    return vec3.lerp([] as any, v0, v1, t);
  }

  // handle quats
  return quat.slerp([] as any, v0, v1, t);
}

export function keyframeValueForTime(
  keyframes: number[],
  keyframeValues: vec4[] | vec3[],
  time: number
) {
  if (time <= keyframes[0]) {
    return keyframeValues[0];
  }

  if (time >= keyframes[keyframes.length - 1]) {
    return keyframeValues[keyframes.length - 1];
  }

  // find the keyframes we are between and lerp
  // for each keyframe,
  for (let i = 0; i < keyframes.length; i++) {
    if (time >= keyframes[i] && time < keyframes[i + 1]) {
      return lerpKeyFrames(
        keyframes[i],
        keyframes[i + 1],
        time - keyframes[i],
        keyframeValues[i],
        keyframeValues[i + 1]
      );
    }
  }

  throw new Error("could not find keyframes");
}
