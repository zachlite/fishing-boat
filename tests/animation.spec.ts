import { keyframeValueForTime } from "../src/animation";
import { vec3 } from "gl-matrix";

describe("animation", () => {
  const keyframes = [1.25, 2.2];
  const keyframeValues = [
    [1, 1, 1],
    [2, 2, 2],
  ] as vec3[];

  test("clamps keyframe values to start when time is less than first keyframe", () => {
    expect(keyframeValueForTime(keyframes, keyframeValues, 0)).toEqual(
      keyframeValues[0]
    );
    expect(
      keyframeValueForTime(keyframes, keyframeValues, keyframes[0])
    ).toEqual(keyframeValues[0]);
  });
  test("clamps keyframe values to end when time is greater than last keyframe", () => {
    expect(keyframeValueForTime(keyframes, keyframeValues, 5)).toEqual(
      keyframeValues[1]
    );
    expect(
      keyframeValueForTime(keyframes, keyframeValues, keyframes[1])
    ).toEqual(keyframeValues[1]);
  });
  test("lerps between keyframe values when time is between two keyframes", () => {
    expect(keyframeValueForTime(keyframes, keyframeValues, 1.75)).toEqual([
      2.8421052631578947,
      2.8421052631578947,
      2.8421052631578947,
    ]);
  });
});
