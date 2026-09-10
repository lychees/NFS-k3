import * as THREE from 'three';
import { Track } from './track/track';
import { buildCurbs, buildGuardrails, buildRoad, buildStartGantry } from './track/trackMesh';
import { createSky, createTerrain, createVegetation } from './track/environment';
import { Car } from './car/car';
import { makeTuning, NITRO_LAP_BONUS } from './car/carPhysics';
import { AIDriver } from './ai/aiDriver';
import { Input } from './race/input';
import { RaceManager } from './race/raceManager';
import { ChaseCamera } from './race/chaseCamera';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { Screens } from './ui/screens';
import {
  loadSave,
  persistSave,
  randomAppearance,
  randomLivery,
  tryBuy,
  RACE_REWARDS,
} from './garage/save';
import { GarageScreen } from './garage/garageScreen';
import { GaragePreview } from './garage/garagePreview';
import { SmokePool } from './fx/smoke';
import { SpeedLines } from './fx/speedLines';
import { PostFX } from './fx/postfx';

const cssColor = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

// ---------- 渲染器 / 场景 ----------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfd9e8, 220, 1100);

const camera = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.1,
  2600,
);

// ---------- 灯光（平行光阴影跟随玩家） ----------

const hemi = new THREE.HemisphereLight(0xbfd9e8, 0x3d4a2f, 0.9);
scene.add(hemi);

const sunDir = new THREE.Vector3(0.55, 0.8, 0.35).normalize();
const sun = new THREE.DirectionalLight(0xffe9c4, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -95;
sun.shadow.camera.right = 95;
sun.shadow.camera.top = 95;
sun.shadow.camera.bottom = -95;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 600;
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);

// ---------- 赛道与环境 ----------

const track = new Track();
const maxAniso = renderer.capabilities.getMaxAnisotropy();

scene.add(createSky());
const terrain = createTerrain(track);
scene.add(terrain.mesh);
scene.add(buildRoad(track, maxAniso));
scene.add(buildCurbs(track));
scene.add(buildGuardrails(track));
scene.add(buildStartGantry(track));
scene.add(createVegetation(terrain));

// ---------- 存档与车辆 ----------

const save = loadSave();

const PLAYER = 0;
const player = new Car('YOU', save.appearance, makeTuning(save.upgrades), save.livery);
const aiCars = [0, 1, 2].map(
  (i) =>
    new Car(
      `AI-${i + 1}`,
      randomAppearance(),
      makeTuning({ engine: 0, tires: 0, nitro: 0 }),
      randomLivery(),
    ),
);
const cars = [player, ...aiCars];
for (const c of cars) scene.add(c.group);

const aiDrivers = aiCars.map((_, i) => new AIDriver(i + 1));
const playerAutopilot = new AIDriver(7);

// ---------- 特效 ----------

const smoke = new SmokePool(scene);
const speedLines = new SpeedLines(document.getElementById('speedlines') as HTMLCanvasElement);
const postfx = new PostFX(renderer, scene, camera);
postfx.setBloom(save.bloom);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 比赛 / UI ----------

const race = new RaceManager(cars, PLAYER);
const input = new Input();
const hud = new Hud();
const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, track);
const screens = new Screens();
const chaseCam = new ChaseCamera();

let resultsShown = false;
let lastPlayerLap = 0;

// ---------- 车库 ----------

const garagePreview = new GaragePreview();
let inGarage = false;

function closeGarage(): void {
  if (!inGarage) return;
  inGarage = false;
  player.rebuildVisual(save.appearance, save.livery);
  player.setTuning(makeTuning(save.upgrades));
  garageScreen.close();
  screens.showMenu();
}

const garageScreen = new GarageScreen({
  onAppearance: (patch) => {
    Object.assign(save.appearance, patch);
    persistSave(save);
    garagePreview.setAppearance(save.appearance, save.livery);
    garageScreen.refresh(save);
  },
  onLivery: (patch) => {
    Object.assign(save.livery, patch);
    persistSave(save);
    garagePreview.setAppearance(save.appearance, save.livery);
    garageScreen.refresh(save);
  },
  onBuy: (key) => {
    if (tryBuy(save, key)) {
      player.setTuning(makeTuning(save.upgrades));
      garageScreen.refresh(save);
    }
  },
  onToggleBloom: () => {
    save.bloom = !save.bloom;
    persistSave(save);
    postfx.setBloom(save.bloom);
    garageScreen.refresh(save);
  },
  onBack: closeGarage,
});

function openGarage(): void {
  if (race.state !== 'menu' || inGarage) return;
  inGarage = true;
  screens.hideMenu();
  garagePreview.setAppearance(save.appearance, save.livery);
  garageScreen.open(save);
}

// ---------- 流程控制 ----------

function startRace(): void {
  player.setTuning(makeTuning(save.upgrades));
  race.startRace(track);
  chaseCam.snapBehind();
  resultsShown = false;
  lastPlayerLap = 0;
  screens.hideMenu();
  screens.hideResults();
  hud.show();
}

// 初始摆放车辆后回到菜单（背景画面用）
race.startRace(track);
race.toMenu();
screens.showMenu();

screens.onMenuRace(() => {
  if (race.state === 'menu' && !inGarage) startRace();
});
screens.onMenuGarage(() => openGarage());

input.onPress('Enter', () => {
  if (inGarage) return;
  if (race.state === 'menu' || race.state === 'finished') startRace();
  else if (race.state === 'paused') race.resume();
});

input.onPress('KeyG', () => {
  if (race.state === 'menu' && !inGarage) openGarage();
});

input.onPress('Escape', () => {
  if (inGarage) {
    closeGarage();
    return;
  }
  if (race.state === 'racing' || race.state === 'countdown') race.pause();
  else if (race.state === 'paused') race.resume();
});

input.onPress('KeyC', () => {
  if (race.state === 'racing') chaseCam.toggle();
});

window.addEventListener('blur', () => {
  if (race.state === 'racing') race.pause();
});

// ---------- 车车间碰撞（圆形截面，等质量弹性近似） ----------

function resolveCarCollisions(): void {
  const MIN_DIST = 2.5;
  const RESTITUTION = 0.35;
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= MIN_DIST || dist < 1e-3) continue;

      const nx = dx / dist;
      const nz = dz / dist;
      const overlap = (MIN_DIST - dist) / 2;
      a.pos.x -= nx * overlap;
      a.pos.z -= nz * overlap;
      b.pos.x += nx * overlap;
      b.pos.z += nz * overlap;
      a.state.x = a.pos.x;
      a.state.z = a.pos.z;
      b.state.x = b.pos.x;
      b.state.z = b.pos.z;

      const vaN = a.state.vx * nx + a.state.vz * nz;
      const vbN = b.state.vx * nx + b.state.vz * nz;
      if (vaN - vbN > 0) {
        const cm = (vaN + vbN) / 2;
        const vaN2 = cm - RESTITUTION * (vaN - cm);
        const vbN2 = cm - RESTITUTION * (vbN - cm);
        a.state.vx += nx * (vaN2 - vaN);
        a.state.vz += nz * (vaN2 - vaN);
        b.state.vx += nx * (vbN2 - vbN);
        b.state.vz += nz * (vbN2 - vbN);
      }
    }
  }
}

// ---------- 漂移 / 扬尘烟雾 ----------

const smokeAcc = cars.map(() => 0);

function updateSmoke(dt: number): void {
  cars.forEach((car, i) => {
    const lat = Math.abs(car.state.latSpeed);
    const drifting = lat > 4 && car.speedKmh > 25;
    const dust = !car.onRoad && car.speedKmh > 30;
    if (!drifting && !dust) {
      smokeAcc[i] = 0;
      return;
    }
    smokeAcc[i] += dt * (drifting ? Math.min(lat, 12) * 3 : 18);
    const h = car.state.heading;
    const c = Math.cos(h);
    const s = Math.sin(h);
    while (smokeAcc[i] > 1) {
      smokeAcc[i] -= 1;
      for (const lx of [-0.85, 0.85]) {
        const lz = -1.45;
        smoke.spawn(
          car.pos.x + lx * c + lz * s,
          car.pos.y + 0.2,
          car.pos.z - lx * s + lz * c,
          car.state.vx,
          car.state.vz,
          dust,
        );
      }
    }
  });
}

// ---------- 主循环 ----------

const clock = new THREE.Clock();
const startLine = track.sampleAt(0).pos;
let menuTime = 0;

function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (inGarage) {
    garagePreview.update(dt);
    garagePreview.frameCamera(camera);
    postfx.render(garagePreview.scene, camera);
    return;
  }

  const state = race.state;

  if (state === 'menu') {
    menuTime += dt;
    chaseCam.menuOrbit(camera, startLine, menuTime);
    speedLines.setActive(false);
  } else if (state === 'paused') {
    screens.showPause(true);
    speedLines.setActive(false);
  } else {
    screens.showPause(false);

    if (state === 'countdown') {
      race.update(dt, track);
      speedLines.setActive(false);
    } else {
      // racing / finished：车辆物理照常推进
      player.input =
        state === 'racing'
          ? input.getCarInput()
          : playerAutopilot.computeInput(player, track, race.player.progress, race.player.progress, dt);
      aiCars.forEach((car, i) => {
        car.input = aiDrivers[i].computeInput(
          car,
          track,
          race.stats[PLAYER].progress,
          race.stats[i + 1].progress,
          dt,
        );
      });
      for (const car of cars) car.update(dt, track);
      resolveCarCollisions();
      updateSmoke(dt);

      if (state === 'racing') {
        race.update(dt, track);

        // 每过起点线回复一段氮气
        if (race.player.lap > lastPlayerLap) {
          lastPlayerLap = race.player.lap;
          const cap = player.tuning.nitroCapacity;
          player.state.nitroFuel = Math.min(cap, player.state.nitroFuel + cap * NITRO_LAP_BONUS);
        }
      } else if (!resultsShown) {
        // 玩家冲线：结算 + 积分奖励
        resultsShown = true;
        const earned = RACE_REWARDS[race.player.position - 1] ?? RACE_REWARDS[3];
        save.credits += earned;
        persistSave(save);
        screens.showResults(race.stats, PLAYER, earned, save.credits);
      }

      speedLines.setActive(state === 'racing' && player.state.nitroActive);
    }

    chaseCam.update(dt, player, camera, state === 'racing' && player.state.nitroActive);

    const p = race.player;
    hud.update({
      speedKmh: player.speedKmh,
      lap: p.lap,
      position: p.position,
      totalCars: cars.length,
      currentLapTime: state === 'racing' ? race.raceTime - p.lapStartTime : 0,
      lastLapTime: p.lastLapTime,
      bestLapTime: p.bestLapTime,
      countdownText: race.countdownText,
      showGo: race.showGo,
      wrongWay: state === 'racing' && player.state.forwardSpeed < -2,
      nitroRatio: player.nitroRatio,
    });
    minimap.update(
      cars.map((c, i) => ({
        x: c.pos.x,
        z: c.pos.z,
        color: cssColor(c.color),
        isPlayer: i === PLAYER,
      })),
    );
  }

  smoke.update(dt);

  // 阴影框跟随玩家
  sun.position.set(player.pos.x + sunDir.x * 220, player.pos.y + sunDir.y * 220, player.pos.z + sunDir.z * 220);
  sun.target.position.copy(player.pos);
  sun.target.updateMatrixWorld();

  postfx.render(scene, camera);
}

animate();
