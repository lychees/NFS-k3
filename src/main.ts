import * as THREE from 'three';
import { Track } from './track/track';
import { TRACK_DEFS, type TrackId } from './track/trackData';
import { buildCurbs, buildGantry, buildGuardrails, buildRoad } from './track/trackMesh';
import { createSky, createTerrain, createVegetation } from './track/environment';
import { Car } from './car/car';
import { makeTuning, NITRO_LAP_BONUS } from './car/carPhysics';
import { AIDriver } from './ai/aiDriver';
import { Input } from './race/input';
import { RaceManager, parkingInput } from './race/raceManager';
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

// ---------- 赛道与环境（双赛道，按需切换显示） ----------

interface TrackBundle {
  id: TrackId;
  track: Track;
  group: THREE.Group;
  startLine: THREE.Vector3;
}

const maxAniso = renderer.capabilities.getMaxAnisotropy();
scene.add(createSky());

function buildTrackBundle(id: TrackId): TrackBundle {
  const def = TRACK_DEFS[id];
  const track = new Track(def);
  const group = new THREE.Group();
  const terrain = createTerrain(track);
  group.add(terrain.mesh);
  group.add(buildRoad(track, maxAniso));
  group.add(buildCurbs(track));
  group.add(buildGuardrails(track));
  group.add(buildGantry(track, 0, "RETRO RUSH '95", false));
  if (!def.closed) group.add(buildGantry(track, 1, 'FINISH', true));
  group.add(createVegetation(terrain, def.vegetation));
  scene.add(group);
  return { id, track, group, startLine: track.sampleAt(0).pos };
}

const bundles: Record<TrackId, TrackBundle> = {
  circuit: buildTrackBundle('circuit'),
  sprint: buildTrackBundle('sprint'),
};

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
const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement);
const screens = new Screens();
const chaseCam = new ChaseCamera();

let resultsShown = false;
let lastPlayerLap = 0;
let lastPlayerCheckpoint = 0;
let newRecord = false;
let gearbox = initGearbox();
let prevCountdown: string | null = null;
let prevRaceState = race.state;
let thudCooldown = 0;
let prevNitroActive = false;
let bannerTimer = 0;
let duelAnnounced = false;

// ---------- 赛道模式切换 ----------

/** 游戏模式：环道计圈 / 点对点 / 淘汰赛（淘汰赛在环道上进行） */
type GameMode = 'circuit' | 'sprint' | 'knockout';

const bundleIdOf = (m: GameMode): TrackId => (m === 'sprint' ? 'sprint' : 'circuit');

let mode: GameMode = save.lastMode;
let bundle = bundles[bundleIdOf(mode)];

function applyMode(next: GameMode): void {
  mode = next;
  bundle = bundles[bundleIdOf(mode)];
  for (const id of Object.keys(bundles) as TrackId[]) {
    bundles[id].group.visible = bundles[id] === bundle;
  }
  minimap.loadTrack(bundle.track);
}

applyMode(mode);
screens.updateRecords(save.records);

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

function startRace(nextMode: GameMode): void {
  if (nextMode !== mode) applyMode(nextMode);
  save.lastMode = mode;
  persistSave(save);
  player.setTuning(makeTuning(save.upgrades));
  race.startRace(bundle.track, { knockout: mode === 'knockout' });
  chaseCam.snapBehind();
  resultsShown = false;
  lastPlayerLap = 0;
  lastPlayerCheckpoint = 0;
  newRecord = false;
  gearbox = initGearbox();
  prevCountdown = null;
  prevNitroActive = false;
  bannerTimer = 0;
  duelAnnounced = false;
  hud.hideBanner();
  screens.hideMenu();
  screens.hideResults();
  hud.show();
  hud.setMuted(save.muted);
}

// 初始摆放车辆后回到菜单（背景画面用）
race.startRace(bundle.track);
race.toMenu();
screens.showMenu();

screens.onMenuRace(() => {
  if (race.state === 'menu' && !inGarage) {
    audio.playSfx('uiConfirm');
    startRace('circuit');
  }
});
screens.onMenuSprint(() => {
  if (race.state === 'menu' && !inGarage) {
    audio.playSfx('uiConfirm');
    startRace('sprint');
  }
});
screens.onMenuKnockout(() => {
  if (race.state === 'menu' && !inGarage) {
    audio.playSfx('uiConfirm');
    startRace('knockout');
  }
});
screens.onMenuGarage(() => {
  audio.playSfx('uiConfirm');
  openGarage();
});

input.onPress('Enter', () => {
  if (inGarage) return;
  if (race.state === 'menu' || race.state === 'finished') startRace(save.lastMode);
  else if (race.state === 'paused') {
    race.resume();
    audio.resumeGame();
  }
});

input.onPress('Digit1', () => {
  if (race.state === 'menu' && !inGarage) startRace('circuit');
});

input.onPress('Digit2', () => {
  if (race.state === 'menu' && !inGarage) startRace('sprint');
});

input.onPress('Digit3', () => {
  if (race.state === 'menu' && !inGarage) startRace('knockout');
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
  const track = bundle.track;

  if (state === 'menu') {
    menuTime += dt;
    chaseCam.menuOrbit(camera, bundle.startLine, menuTime);
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
        const st = race.stats[i + 1];
        if (st.eliminated) {
          // 被淘汰 AI：刹车靠边，停稳后冻结
          if (!st.parked) {
            if (Math.abs(car.state.forwardSpeed) > 1) {
              car.input = parkingInput(car);
            } else {
              st.parked = true;
              car.input = { throttle: 0, brake: 1, steer: 0, handbrake: false, nitro: false };
              car.state.vx = 0;
              car.state.vz = 0;
            }
          }
        } else {
          car.input = aiDrivers[i].computeInput(
            car,
            track,
            race.stats[PLAYER].progress,
            race.stats[i + 1].progress,
            dt,
          );
        }
      });
      cars.forEach((car, idx) => {
        if (race.stats[idx]?.parked) return;
        car.update(dt, track);
      });
      resolveCarCollisions();
      updateSmoke(dt);

      if (state === 'racing') {
        race.update(dt, track);

        // 淘汰事件：大字横幅 + 音效；剩 2 车决赛圈提示
        if (race.elimEvents.length > 0) {
          for (const e of race.elimEvents) {
            hud.showBanner(`ELIMINATED: ${e.name}`);
            bannerTimer = 2.6;
            audio.playSfx('eliminate');
          }
          race.elimEvents.length = 0;
        }
        if (race.finalDuel && !duelAnnounced) {
          duelAnnounced = true;
          hud.showBanner('FINAL DUEL!');
          bannerTimer = 2.6;
          audio.playSfx('countGo');
        }

        // 氮气回复：环道每圈 / 冲刺道每检查点
        if (race.player.lap > lastPlayerLap) {
          lastPlayerLap = race.player.lap;
          const cap = player.tuning.nitroCapacity;
          player.state.nitroFuel = Math.min(cap, player.state.nitroFuel + cap * NITRO_LAP_BONUS);
        }
        if (race.sprint && race.player.checkpoint > lastPlayerCheckpoint) {
          lastPlayerCheckpoint = race.player.checkpoint;
          const cap = player.tuning.nitroCapacity;
          player.state.nitroFuel = Math.min(cap, player.state.nitroFuel + cap * 0.25);
        }

        // 氮气开启瞬间的喷射嘶声
        if (player.state.nitroActive && !prevNitroActive) audio.playSfx('nitro');
      } else if (!resultsShown) {
        // 玩家冲线/夺冠/被淘汰：结算 + 积分 + 纪录 + 胜利音
        resultsShown = true;
        hud.hideBanner();
        const earned = RACE_REWARDS[race.player.position - 1] ?? RACE_REWARDS[3];
        save.credits += earned;
        const finishTime = race.player.finishTime;
        if (!race.knockout && finishTime !== null) {
          const prev = save.records[mode as 'circuit' | 'sprint'];
          if (prev === null || finishTime < prev) {
            save.records[mode as 'circuit' | 'sprint'] = finishTime;
            newRecord = true;
            screens.updateRecords(save.records);
          }
        }
        persistSave(save);
        screens.showResults(race.stats, PLAYER, earned, save.credits, {
          mode,
          newRecord,
        });
        audio.playSfx(race.player.position === 1 ? 'victory' : 'eliminate');
      }

      speedLines.setActive(state === 'racing' && player.state.nitroActive);
      prevNitroActive = player.state.nitroActive;
    }

    updateAudio(dt, state);

    // 事件横幅到时隐藏
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) hud.hideBanner();
    }

    chaseCam.update(dt, player, camera, state === 'racing' && player.state.nitroActive);

    const p = race.player;
    hud.update({
      mode,
      speedKmh: player.speedKmh,
      lap: p.lap,
      totalLaps: race.def?.laps ?? 3,
      position: p.position,
      totalCars: cars.length,
      currentLapTime: state === 'racing' ? race.raceTime - p.lapStartTime : 0,
      lastLapTime: p.lastLapTime,
      bestLapTime: p.bestLapTime,
      sprintPct: race.finishDist > 0 ? clamp((p.progress / race.finishDist) * 100, 0, 100) : 0,
      sprintKm: Math.max(0, p.progress) / 1000,
      sprintRecord: save.records.sprint,
      carsLeft: race.carsLeft,
      elimCountdown: race.elimTimer,
      countdownText: race.countdownText,
      showGo: race.showGo,
      wrongWay: state === 'racing' && player.state.forwardSpeed < -2,
      nitroRatio: player.nitroRatio,
    });
    minimap.update(
      cars.map((c, i) => ({
        x: c.pos.x,
        z: c.pos.z,
        color: race.stats[i]?.eliminated ? '#8a8a8a' : cssColor(c.color),
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
