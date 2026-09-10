import * as THREE from 'three';

export const ROAD_HALF_WIDTH = 7;
export const RUNOFF_WIDTH = 4.4;
export const TRACK_SAMPLES = 1000;
export const CHECKPOINT_COUNT = 12;
export const TOTAL_LAPS = 3;

// 闭合赛道的控制点（含高度起伏），Catmull-Rom 样条插值
const POINTS: [number, number, number][] = [
  [0, 0, -220],
  [120, 1, -200],
  [210, 4, -120],
  [240, 9, -10],
  [190, 12, 90],
  [230, 7, 180],
  [150, 3, 240],
  [40, 1, 220],
  [-60, 4, 250],
  [-160, 9, 200],
  [-230, 13, 110],
  [-200, 10, 0],
  [-250, 5, -90],
  [-180, 2, -180],
  [-90, 0, -215],
];

export const CONTROL_POINTS: THREE.Vector3[] = POINTS.map(
  ([x, y, z]) => new THREE.Vector3(x, y, z),
);
