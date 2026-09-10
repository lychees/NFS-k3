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
import { audio } from './audio/audioEngine';
import {
  grassIntensity,
  initGearbox,
  skidIntensity,
  stepGearbox,
} from './audio/engineModel';
import { clamp } from './utils/math';

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
audio.setMuted(save.muted);
audio.setVolume(save.volume);

// 浏览器自动播放策略：首次用户手势时创建/恢复 AudioContext
const unlockAudio = (): void => audio.unlock();
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

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
let gearbox = initGearbox();
let prevCountdown: string | null = null;
let prevRaceState = race.state;
let thudCooldown = 0;
let prevNitroActive = false;

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
    audio.playSfx('uiSelect');
  },
  onLivery: (patch) => {
    Object.assign(save.livery, patch);
    persistSave(save);
    garagePreview.setAppearance(save.appearance, save.livery);
    garageScreen.refresh(save);
    audio.playSfx('uiSelect');
  },
  onBuy: (key) => {
    if (tryBuy(save, key)) {
      player.setTuning(makeTuning(save.upgrades));
      garageScreen.refresh(save);
      audio.playSfx('uiConfirm');
    }
  },
  onToggleBloom: () => {
    save.bloom = !save.bloom;
    persistSave(save);
    postfx.setBloom(save.bloom);
    garageScreen.refresh(save);
    audio.playSfx('uiSelect');
  },
  onVolume: (delta) => {
    save.volume = clamp(Math.round((save.volume + delta) * 10) / 10, 0, 1);
    persistSave(save);
    audio.setVolume(save.volume);
    garageScreen.refresh(save);
    audio.playSfx('uiSelect');
  },
  onBack: () => {
    audio.playSfx('uiSelect');
    closeGarage();
  },
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
  gearbox = initGearbox();
  prevCountdown = null;
  prevNitroActive = false;
  screens.hideMenu();
  screens.hideResults();
  hud.show();
  hud.setMuted(save.muted);
}

// 初始摆放车辆后回到菜单（背景画面用）
race.startRace(track);
race.toMenu();
screens.showMenu();

screens.onMenuRace(() => {
  if (race.state === 'menu' && !inGarage) {
    audio.playSfx('uiConfirm');
    startRace();
  }
});
screens.onMenuGarage(() => {
  audio.playSfx('uiConfirm');
  openGarage();
});

input.onPress('Enter', () => {
  if (inGarage) return;
  if (race.state === 'menu' || race.state === 'finished') startRace();
  else if (race.state === 'paused') {
    race.resume();
    audio.resumeGame();
  }
});

input.onPress('KeyG', () => {
  if (race.state === 'menu' && !inGarage) {
    audio.playSfx('uiConfirm');
    openGarage();
  }
});

input.onPress('KeyM', () => {
  save.muted = audio.toggleMute();
  persistSave(save);
  hud.setMuted(save.muted);
  garageScreen.refresh(save);
});

input.onPress('Escape', () => {
  if (inGarage) {
    audio.playSfx('uiSelect');
    closeGarage();
    return;
  }
  if (race.state === 'racing' || race.state === 'countdown') {
    race.pause();
    audio.suspendGame();
  } else if (race.state === 'paused') {
    race.resume();
    audio.resumeGame();
  }
});

input.onPress('KeyC', () => {
  if (race.state === 'racing') chaseCam.toggle();
});

window.addEventListener('blur', () => {
  if (race.state === 'racing') {
    race.pause();
    audio.suspendGame();
  }
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
        if (vaN - vbN > 3 && thudCooldown <= 0) {
          audio.playSfx('thud', Math.min(1, (vaN - vbN) / 15));
          thudCooldown = 0.3;
        }
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

// ---------- 声音：每帧参数更新（节点常驻，只调参数） ----------

function updateAudio(dt: number, state: typeof race.state): void {
  thudCooldown = Math.max(0, thudCooldown - dt);
  const racing = state === 'racing';
  const speedRatio = Math.abs(player.state.forwardSpeed) / player.tuning.maxSpeed;
  const gb = stepGearbox(gearbox, speedRatio, dt);
  gearbox = gb.state;
  if (gb.upshifted && racing) audio.playSfx('shift');

  audio.setEngine(gb.rpm, racing ? player.input.throttle : 0, {
    active: true,
    shifting: gearbox.shiftT > 0,
    nitro: player.state.nitroActive,
  });
  audio.setSkid(racing ? skidIntensity(player.state.latSpeed, player.speedKmh) : 0);
  audio.setGrass(racing ? grassIntensity(player.speedKmh, player.onRoad) : 0);

  if (racing && player.wallImpact > 3 && thudCooldown <= 0) {
    audio.playSfx('thud', Math.min(1, player.wallImpact / 12));
    thudCooldown = 0.3;
  }

  // 倒计时蜂鸣：数字变化 3→2→1 短音，GO 长音
  if (state === 'countdown') {
    const c = race.countdownText;
    if (c !== null && c !== prevCountdown) audio.playSfx('countBeep');
    prevCountdown = c;
  }
  if (prevRaceState === 'countdown' && state === 'racing') audio.playSfx('countGo');
  prevRaceState = state;
}

// ---------- 主循环 ----------

const clock = new THREE.Clock();
const startLine = track.sampleAt(0).pos;
let menuTime = 0;

function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (inGarage) {
    audio.setEngine(0.18, 0, { active: false, shifting: false, nitro: false });
    audio.setSkid(0);
    audio.setGrass(0);
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
    updateAudio(dt, state);
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

        // 氮气开启瞬间的喷射嘶声
        if (player.state.nitroActive && !prevNitroActive) audio.playSfx('nitro');
      } else if (!resultsShown) {
        // 玩家冲线：结算 + 积分奖励 + 胜利音
        resultsShown = true;
        const earned = RACE_REWARDS[race.player.position - 1] ?? RACE_REWARDS[3];
        save.credits += earned;
        persistSave(save);
        screens.showResults(race.stats, PLAYER, earned, save.credits);
        audio.playSfx('victory');
      }

      speedLines.setActive(state === 'racing' && player.state.nitroActive);
      prevNitroActive = player.state.nitroActive;
    }

    updateAudio(dt, state);

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
