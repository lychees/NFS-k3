import * as THREE from 'three';
import { Track } from './track/track';
import { TRACK_DEFS, type TrackId } from './track/trackData';
import { buildCurbs, buildGantry, buildGuardrails, buildRoad } from './track/trackMesh';
import { createSky, createTerrain, createVegetation } from './track/environment';
import { Car } from './car/car';
import { Cockpit } from './car/cockpit';
import { makeTuning, NITRO_LAP_BONUS } from './car/carPhysics';
import { AIDriver } from './ai/aiDriver';
import { Input } from './race/input';
import { RaceManager, parkingInput } from './race/raceManager';
import { PursuitManager } from './race/pursuit';
import { ChaseCamera } from './race/chaseCamera';
import { Recorder, type ReplayData, type ReplayEntry } from './replay/recorder';
import { ReplayPlayer } from './replay/replayPlayer';
import { Hud, type HudData } from './ui/hud';
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
import {
  RainFX,
  applyEnvironment,
  makeHeadlightBlob,
  makeHeadlightBlobMaterial,
  rainVolume,
  resolveEnv,
  type EnvRefs,
} from './fx/weather';
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
// 双人 P2 专用相机（单人不渲染它）
const cameraP2 = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.1,
  2600,
);

function applyAspect(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (splitMode) {
    camera.aspect = w / (h / 2);
    cameraP2.aspect = w / (h / 2);
  } else {
    camera.aspect = w / h;
  }
  camera.updateProjectionMatrix();
  cameraP2.updateProjectionMatrix();
}

// ---------- 灯光（平行光阴影跟随 P1） ----------

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
  roadMat: THREE.MeshStandardMaterial;
  glowMats: { mat: THREE.MeshStandardMaterial; base: number }[];
}

const maxAniso = renderer.capabilities.getMaxAnisotropy();
const skyMesh = createSky();
scene.add(skyMesh);
const skyMat = skyMesh.material as THREE.ShaderMaterial;

function buildTrackBundle(id: TrackId): TrackBundle {
  const def = TRACK_DEFS[id];
  const track = new Track(def);
  const group = new THREE.Group();
  const terrain = createTerrain(track);
  group.add(terrain.mesh);
  const road = buildRoad(track, maxAniso);
  group.add(road);
  group.add(buildCurbs(track));
  group.add(buildGuardrails(track));
  group.add(buildGantry(track, 0, "RETRO RUSH '95", false));
  if (!def.closed) group.add(buildGantry(track, 1, 'FINISH', true));
  group.add(createVegetation(terrain, def.vegetation));
  scene.add(group);

  // 环境可调材质登记（发光体：拱门霓虹/横幅，emissiveIntensity > 1.4）
  const glowMats: { mat: THREE.MeshStandardMaterial; base: number }[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && !Array.isArray(o.material)) {
      const m = o.material as THREE.MeshStandardMaterial;
      if (m.emissiveIntensity > 1.4) glowMats.push({ mat: m, base: m.emissiveIntensity });
    }
  });
  return {
    id,
    track,
    group,
    startLine: track.sampleAt(0).pos,
    roadMat: road.material as THREE.MeshStandardMaterial,
    glowMats,
  };
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

const player = new Car('P1', save.appearance, makeTuning(save.upgrades), save.livery);
const player2 = new Car('P2', randomAppearance(), makeTuning({ engine: 1, tires: 1, nitro: 1 }), randomLivery());
const cockpitP1 = new Cockpit();
const cockpitP2 = new Cockpit();
player.installCockpit(cockpitP1);
player2.installCockpit(cockpitP2);
const aiCars = [0, 1, 2].map(
  (i) =>
    new Car(
      `AI-${i + 1}`,
      randomAppearance(),
      makeTuning({ engine: 0, tires: 0, nitro: 0 }),
      randomLivery(),
    ),
);
const allCars = [player, player2, ...aiCars];
for (const c of allCars) scene.add(c.group);

const aiDrivers = aiCars.map((_, i) => new AIDriver(i + 1));
const playerAutopilot = new AIDriver(7);
const player2Autopilot = new AIDriver(8);

// ---------- 特效 ----------

const smoke = new SmokePool(scene);
const speedLines = new SpeedLines(document.getElementById('speedlines') as HTMLCanvasElement);
const postfx = new PostFX(renderer, scene, camera);
postfx.setBloom(save.bloom);

window.addEventListener('resize', () => {
  applyAspect();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 比赛 / UI ----------

const race = new RaceManager(allCars, 0);
const input = new Input();
const hud = new Hud(document.getElementById('hud')!);
const hudP1 = new Hud(document.getElementById('hud-p1')!);
const hudP2 = new Hud(document.getElementById('hud-p2')!);
const hudGlobal = document.getElementById('hud-global')!;
const hudMuted = document.getElementById('hud-muted')!;
const hudTopRight = document.getElementById('hud-top-right')!;
const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement);
const screens = new Screens();
const chaseCam = new ChaseCamera();
const chaseCamP2 = new ChaseCamera();
const pursuit = new PursuitManager(scene);
const heatOverlay = document.getElementById('heat-overlay')!;

// ---------- 天气 / 昼夜 ----------

const rainFX = new RainFX(scene);
const headlightBlobMat = makeHeadlightBlobMaterial();
for (const c of [...allCars, ...pursuit.cars]) {
  c.group.add(makeHeadlightBlob(headlightBlobMat));
}

const envRefs: EnvRefs = {
  sun,
  sunDir,
  hemi,
  fog: scene.fog as THREE.Fog,
  skyMat,
  renderer,
  roadMats: (Object.values(bundles) as { roadMat: THREE.MeshStandardMaterial }[]).map((b) => ({
    mat: b.roadMat,
    baseRoughness: 0.95,
  })),
  glowMats: [
    ...bundles.circuit.glowMats,
    ...bundles.sprint.glowMats,
  ],
  headlightMats: [],
  headlightBlobMat,
};

/** 应用当前存档的时间 × 天气（光照/雾/雨粒子/湿滑） */
function applyConditions(): void {
  const preset = resolveEnv(save.lastConditions);
  envRefs.headlightMats = [...allCars, ...pursuit.cars].map((c) => c.headMaterial);
  applyEnvironment(preset, envRefs);
  rainFX.setEnabled(preset.rain);
  audio.setRain(rainVolume(preset.rain));
  for (const c of [...allCars, ...pursuit.cars]) c.wet = preset.rain;
}

applyConditions();

// ---------- 回放 ----------

const recorder = new Recorder();
const chaseCamReplay = new ChaseCamera();
const replayHud = document.getElementById('replay-hud')!;
const replayFollow = document.getElementById('replay-follow')!;
const replaySpeed = document.getElementById('replay-speed')!;
const replayFill = document.getElementById('replay-fill')!;
const replayTime = document.getElementById('replay-time')!;

let replayData: ReplayData | null = null;
let replayPlayer: ReplayPlayer | null = null;
let replaying = false;
/** 回放对应的车辆（与录制顺序一致） */
let replayCars: Car[] = [];
let lastResults: {
  earned: number | null;
  opts: Parameters<typeof screens.showResults>[4];
} | null = null;

function startReplay(): void {
  if (!replayData || replaying) return;
  replaying = true;
  screens.hideResults();
  hud.hide();
  hudGlobal.classList.add('hidden');
  replayHud.classList.remove('hidden');
  // 回放静音（物理/引擎声全部停用，只留 UI 音）
  audio.setEngine(0.18, 0, { active: false, shifting: false, nitro: false });
  audio.setSkid(0);
  audio.setGrass(0);
  audio.setSiren(0);
  replayPlayer = new ReplayPlayer(replayData, replayCars, camera, chaseCamReplay);
  audio.playSfx('uiConfirm');
}

function exitReplay(): void {
  if (!replaying) return;
  replaying = false;
  replayPlayer = null;
  replayHud.classList.add('hidden');
  if (lastResults) {
    screens.showResults(race.stats, 0, lastResults.earned, save.credits, lastResults.opts);
  }
}

function setGlobalHudMuted(m: boolean): void {
  hudMuted.classList.toggle('hidden', !m);
}

// ---------- 模式与阵容 ----------

/** 游戏模式：环道计圈 / 点对点 / 淘汰赛（环道）/ 警察追逐（冲刺道） */
type GameMode = 'circuit' | 'sprint' | 'knockout' | 'hotpursuit';

const bundleIdOf = (m: GameMode): TrackId =>
  m === 'sprint' || m === 'hotpursuit' ? 'sprint' : 'circuit';

let mode: GameMode = save.lastMode === 'knockout' || save.lastMode === 'hotpursuit' ? save.lastMode : save.lastMode === 'sprint' ? 'sprint' : 'circuit';
let bundle = bundles[bundleIdOf(mode)];

/** 双人对局标志（仅 circuit / sprint） */
let splitMode = false;

interface FieldEntry {
  car: Car;
  /** 0 = P1，1 = P2，null = AI */
  human: 0 | 1 | null;
  driver: AIDriver | null;
  lastLap: number;
  lastCheckpoint: number;
}
/** 当前上场阵容（与 race.stats 一一对应） */
let field: FieldEntry[] = [];

function buildField(twoPlayer: boolean): FieldEntry[] {
  if (twoPlayer) {
    return [
      { car: player, human: 0, driver: null, lastLap: 0, lastCheckpoint: 0 },
      { car: player2, human: 1, driver: null, lastLap: 0, lastCheckpoint: 0 },
      { car: aiCars[0], human: null, driver: aiDrivers[0], lastLap: 0, lastCheckpoint: 0 },
      { car: aiCars[1], human: null, driver: aiDrivers[1], lastLap: 0, lastCheckpoint: 0 },
    ];
  }
  return [
    { car: player, human: 0, driver: null, lastLap: 0, lastCheckpoint: 0 },
    { car: aiCars[0], human: null, driver: aiDrivers[0], lastLap: 0, lastCheckpoint: 0 },
    { car: aiCars[1], human: null, driver: aiDrivers[1], lastLap: 0, lastCheckpoint: 0 },
    { car: aiCars[2], human: null, driver: aiDrivers[2], lastLap: 0, lastCheckpoint: 0 },
  ];
}

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

// ---------- 分屏切换 ----------

function enterSplit(): void {
  splitMode = true;
  renderer.setPixelRatio(1); // 双视口渲染两遍场景，降像素比保帧率
  applyAspect();
  hudP1.show();
  hudP2.show();
  hudTopRight.classList.add('split-view');
  chaseCam.snapBehind();
  chaseCamP2.snapBehind();
}

function exitSplit(): void {
  splitMode = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  applyAspect();
  hudP1.hide();
  hudP2.hide();
  hudTopRight.classList.remove('split-view');
}

function renderSplit(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setScissorTest(true);
  // WebGL 视口原点在左下：上半屏 = P1
  renderer.setViewport(0, h / 2, w, h / 2);
  renderer.setScissor(0, h / 2, w, h / 2);
  renderer.render(scene, camera);
  renderer.setViewport(0, 0, w, h / 2);
  renderer.setScissor(0, 0, w, h / 2);
  renderer.render(scene, cameraP2);
  renderer.setScissorTest(false);
}

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

let resultsShown = false;
let newRecord = false;
let bustedRace = false;
let gearbox = initGearbox();
let gearboxP2 = initGearbox();
let lastRpm = 0.18;
let prevCountdown: string | null = null;
let prevRaceState = race.state;
let thudCooldown = 0;
let prevNitroActive = false;
let bannerTimer = 0;
let duelAnnounced = false;

function startRace(nextMode: GameMode, twoPlayer: boolean): void {
  if (nextMode !== mode) applyMode(nextMode);
  applyConditions();
  if (!twoPlayer) {
    save.lastMode = mode;
    persistSave(save);
  }
  player.setTuning(makeTuning(save.upgrades));
  field = buildField(twoPlayer);
  race.startRace(bundle.track, {
    knockout: mode === 'knockout',
    participants: field.map((f) => f.car),
    humans: twoPlayer ? [0, 1] : [0],
  });
  pursuit.setVisible(mode === 'hotpursuit');
  if (mode === 'hotpursuit') pursuit.reset(bundle.track);

  // 只显示上场车辆
  const onField = new Set(field.map((f) => f.car));
  for (const c of allCars) c.group.visible = onField.has(c);

  if (twoPlayer && !splitMode) enterSplit();
  if (!twoPlayer && splitMode) exitSplit();

  // 录制（双人不录制，仅保留最近一场）
  if (!twoPlayer) {
    replayCars = [
      ...field.map((f) => f.car),
      ...(mode === 'hotpursuit' ? pursuit.cars : []),
    ];
    const entries: ReplayEntry[] = replayCars.map((car, i) => ({
      car,
      name: car.name,
      color: car.color,
      parked: () => race.stats[i]?.parked ?? false,
    }));
    recorder.begin(entries);
    replayData = null;
  } else {
    replayData = null;
  }

  resultsShown = false;
  newRecord = false;
  bustedRace = false;
  gearbox = initGearbox();
  gearboxP2 = initGearbox();
  prevCountdown = null;
  prevNitroActive = false;
  bannerTimer = 0;
  duelAnnounced = false;
  hud.hideBanner();
  hudP1.hideBanner();
  hudP2.hideBanner();
  hudP1.setGrace(null);
  hudP2.setGrace(null);
  screens.hideMenu();
  screens.hideResults();
  if (twoPlayer) {
    hudP1.show();
    hudP2.show();
  } else {
    hud.show();
  }
  hudGlobal.classList.remove('hidden');
  setGlobalHudMuted(save.muted);
}

function toMenu(): void {
  if (replaying) exitReplay();
  race.toMenu();
  pursuit.setVisible(false);
  if (splitMode) exitSplit();
  hud.hide();
  hudGlobal.classList.add('hidden');
  screens.showMenu();
  screens.show2PSub(false);
}

// 初始摆放车辆后回到菜单（背景画面用）
field = buildField(false);
race.startRace(bundle.track, { participants: field.map((f) => f.car), humans: [0] });
race.toMenu();
screens.showMenu();

screens.onMenu2P(() => {
  if (race.state === 'menu' && !inGarage) {
    audio.playSfx('uiSelect');
    screens.show2PSub(true);
  }
});
screens.onMenu2PBack(() => {
  audio.playSfx('uiSelect');
  screens.show2PSub(false);
});
screens.onMenuGarage(() => {
  audio.playSfx('uiConfirm');
  openGarage();
});
screens.onReplay(() => startReplay());

// ---------- 比赛设置（时间 × 天气） ----------

const SETUP_NAMES: Record<GameMode, string> = {
  circuit: '环形赛道 CIRCUIT',
  sprint: '点对点 SPRINT',
  knockout: '淘汰赛 KNOCKOUT',
  hotpursuit: '警察追逐 HOT PURSUIT',
};

let setupMode: GameMode = 'circuit';
let setup2P = false;

function openSetup(m: GameMode, twoPlayer: boolean): void {
  setupMode = m;
  setup2P = twoPlayer;
  screens.showSetup(SETUP_NAMES[m], save.lastConditions, {
    onTime: (t) => {
      save.lastConditions.time = t;
      persistSave(save);
      screens.refreshSetup(save.lastConditions);
      audio.playSfx('uiSelect');
    },
    onWeather: (w) => {
      save.lastConditions.weather = w;
      persistSave(save);
      screens.refreshSetup(save.lastConditions);
      audio.playSfx('uiSelect');
    },
    onStart: () => startFromSetup(),
  });
  audio.playSfx('uiSelect');
}

function startFromSetup(): void {
  screens.hideSetup();
  audio.playSfx('uiConfirm');
  startRace(setupMode, setup2P);
}

screens.onMenuRace(() => {
  if (race.state === 'menu' && !inGarage) openSetup('circuit', false);
});
screens.onMenuSprint(() => {
  if (race.state === 'menu' && !inGarage) openSetup('sprint', false);
});
screens.onMenuKnockout(() => {
  if (race.state === 'menu' && !inGarage) openSetup('knockout', false);
});
screens.onMenuHotPursuit(() => {
  if (race.state === 'menu' && !inGarage) openSetup('hotpursuit', false);
});
screens.onMenu2PCircuit(() => openSetup('circuit', true));
screens.onMenu2PSprint(() => openSetup('sprint', true));

input.onPress('Enter', () => {
  if (inGarage || replaying) return;
  if (screens.inSetup) {
    startFromSetup();
    return;
  }
  if (screens.in2PSub) return;
  if (race.state === 'menu') openSetup(save.lastMode, false);
  else if (race.state === 'finished') startRace(mode, splitMode);
  else if (race.state === 'paused') {
    race.resume();
    audio.resumeGame();
  }
});

input.onPress('KeyR', () => {
  if (race.state === 'finished' && !replaying && replayData) startReplay();
});

input.onPress('Space', () => {
  if (replaying) replayPlayer?.togglePause();
});

input.onPress('Tab', () => {
  if (replaying) replayPlayer?.cycleFollow();
});

input.onPress('KeyG', () => {
  if (race.state === 'menu' && !inGarage && !screens.in2PSub) {
    audio.playSfx('uiConfirm');
    openGarage();
  }
});

input.onPress('KeyM', () => {
  save.muted = audio.toggleMute();
  persistSave(save);
  setGlobalHudMuted(save.muted);
  garageScreen.refresh(save);
});

input.onPress('Escape', () => {
  if (replaying) {
    exitReplay();
    return;
  }
  if (inGarage) {
    audio.playSfx('uiSelect');
    closeGarage();
    return;
  }
  if (screens.inSetup) {
    screens.hideSetup();
    screens.showMenu();
    return;
  }
  if (screens.in2PSub) {
    screens.show2PSub(false);
    return;
  }
  if (race.state === 'finished') {
    toMenu();
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
  if (replaying) {
    replayPlayer?.cycleFollow();
    return;
  }
  if (race.state !== 'racing') return;
  chaseCam.toggle();
  if (splitMode) chaseCamP2.toggle(); // 双人同时切视角（简单方案）
});

input.onPress('Digit1', () => {
  if (replaying) {
    replayPlayer?.setSpeed(0.5);
    return;
  }
  if (screens.inSetup) {
    save.lastConditions.time = 'day';
    persistSave(save);
    screens.refreshSetup(save.lastConditions);
    audio.playSfx('uiSelect');
    return;
  }
  if (race.state === 'menu' && !inGarage) {
    if (screens.in2PSub) openSetup('circuit', true);
    else openSetup('circuit', false);
  }
});
input.onPress('Digit2', () => {
  if (replaying) {
    replayPlayer?.setSpeed(1);
    return;
  }
  if (screens.inSetup) {
    save.lastConditions.time = 'sunset';
    persistSave(save);
    screens.refreshSetup(save.lastConditions);
    audio.playSfx('uiSelect');
    return;
  }
  if (race.state === 'menu' && !inGarage) {
    if (screens.in2PSub) openSetup('sprint', true);
    else openSetup('sprint', false);
  }
});
input.onPress('Digit3', () => {
  if (replaying) {
    replayPlayer?.setSpeed(2);
    return;
  }
  if (screens.inSetup) {
    save.lastConditions.time = 'night';
    persistSave(save);
    screens.refreshSetup(save.lastConditions);
    audio.playSfx('uiSelect');
    return;
  }
  if (race.state === 'menu' && !inGarage && !screens.in2PSub) openSetup('knockout', false);
});
input.onPress('Digit4', () => {
  if (screens.inSetup) {
    save.lastConditions.weather = 'clear';
    persistSave(save);
    screens.refreshSetup(save.lastConditions);
    audio.playSfx('uiSelect');
    return;
  }
  if (race.state === 'menu' && !inGarage && !screens.in2PSub) openSetup('hotpursuit', false);
});
input.onPress('Digit5', () => {
  if (screens.inSetup) {
    save.lastConditions.weather = 'rain';
    persistSave(save);
    screens.refreshSetup(save.lastConditions);
    audio.playSfx('uiSelect');
    return;
  }
  if (race.state === 'menu' && !inGarage) screens.show2PSub(!screens.in2PSub);
});

window.addEventListener('blur', () => {
  if (race.state === 'racing') {
    race.pause();
    audio.suspendGame();
  }
});

// ---------- 车车间碰撞（圆形截面，等质量弹性近似） ----------

function resolveCarCollisions(list: Car[]): void {
  const MIN_DIST = 2.5;
  const RESTITUTION = 0.35;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
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

const smokeAcc = new Map<Car, number>();

function updateSmoke(dt: number): void {
  for (const f of field) {
    const car = f.car;
    const lat = Math.abs(car.state.latSpeed);
    const drifting = lat > 4 && car.speedKmh > 25;
    const dust = !car.onRoad && car.speedKmh > 30;
    let acc = smokeAcc.get(car) ?? 0;
    if (!drifting && !dust) {
      smokeAcc.set(car, 0);
      continue;
    }
    acc += dt * (drifting ? Math.min(lat, 12) * 3 : 18);
    const h = car.state.heading;
    const c = Math.cos(h);
    const s = Math.sin(h);
    while (acc > 1) {
      acc -= 1;
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
    smokeAcc.set(car, acc);
  }
}

// ---------- 声音：每帧参数更新（节点常驻，只调参数；双人只出 P1 引擎声） ----------

function updateAudio(dt: number, state: typeof race.state): void {
  thudCooldown = Math.max(0, thudCooldown - dt);
  const racing = state === 'racing';
  const speedRatio = Math.abs(player.state.forwardSpeed) / player.tuning.maxSpeed;
  const gb = stepGearbox(gearbox, speedRatio, dt);
  gearbox = gb.state;
  lastRpm = gb.rpm;
  if (gb.upshifted && racing) audio.playSfx('shift');

  audio.setEngine(gb.rpm, racing ? player.input.throttle : 0, {
    active: true,
    shifting: gearbox.shiftT > 0,
    nitro: player.state.nitroActive,
  });
  audio.setSkid(racing ? skidIntensity(player.state.latSpeed, player.speedKmh) : 0);
  audio.setGrass(racing ? grassIntensity(player.speedKmh, player.onRoad) : 0);
  audio.setSiren(mode === 'hotpursuit' && racing ? pursuit.sirenLevel() : 0);

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

// ---------- HUD 数据装配 ----------

function hudDataFor(idx: number, state: typeof race.state): HudData {
  const st = race.stats[idx];
  const car = field[idx].car;
  return {
    mode: mode === 'hotpursuit' ? 'sprint' : mode,
    speedKmh: car.speedKmh,
    lap: st.lap,
    totalLaps: race.def?.laps ?? 3,
    position: st.position,
    totalCars: field.length,
    currentLapTime: state === 'racing' ? race.raceTime - st.lapStartTime : 0,
    lastLapTime: st.lastLapTime,
    bestLapTime: st.bestLapTime,
    sprintPct: race.finishDist > 0 ? clamp((st.progress / race.finishDist) * 100, 0, 100) : 0,
    sprintKm: Math.max(0, st.progress) / 1000,
    sprintRecord: save.records.sprint,
    carsLeft: race.carsLeft,
    elimCountdown: race.elimTimer,
    countdownText: race.countdownText,
    showGo: race.showGo,
    wrongWay: state === 'racing' && car.state.forwardSpeed < -2,
    nitroRatio: car.nitroRatio,
  };
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
    audio.setSiren(0);
    garagePreview.update(dt);
    garagePreview.frameCamera(camera);
    postfx.render(garagePreview.scene, camera);
    return;
  }

  // 回放模式：录制数据驱动车模，物理/AI/音频全停
  if (replaying && replayPlayer) {
    if (input.isDown('ArrowLeft')) replayPlayer.seekBy(-8 * dt);
    if (input.isDown('ArrowRight')) replayPlayer.seekBy(8 * dt);
    replayPlayer.update(dt);

    const t = replayPlayer.currentTime;
    const dur = replayPlayer.duration;
    const fmt = (s: number): string =>
      `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s * 10) % 10)}`;
    replayFill.style.width = `${dur > 0 ? (t / dur) * 100 : 0}%`;
    replayTime.textContent = `${fmt(t)} / ${fmt(dur)}`;
    replayFollow.textContent = replayPlayer.followName;
    replaySpeed.textContent = `${replayPlayer.speed}×${replayPlayer.playing ? '' : ' ⏸'}`;

    const fc = replayCars[replayPlayer.followIdx] ?? player;
    sun.position.set(fc.pos.x + sunDir.x * 220, fc.pos.y + sunDir.y * 220, fc.pos.z + sunDir.z * 220);
    sun.target.position.copy(fc.pos);
    sun.target.updateMatrixWorld();
    postfx.render(scene, camera);
    return;
  }

  const state = race.state;
  const track = bundle.track;

  if (state === 'menu') {
    menuTime += dt;
    chaseCam.menuOrbit(camera, bundle.startLine, menuTime);
    speedLines.setActive(false);
    heatOverlay.style.opacity = '0';
    heatOverlay.classList.remove('hot');
    updateAudio(dt, state);
    sun.position.set(player.pos.x + sunDir.x * 220, player.pos.y + sunDir.y * 220, player.pos.z + sunDir.z * 220);
    sun.target.position.copy(player.pos);
    sun.target.updateMatrixWorld();
    postfx.render(scene, camera);
    return;
  }

  if (state === 'paused') {
    screens.showPause(true);
    speedLines.setActive(false);
    if (splitMode) renderSplit();
    else postfx.render(scene, camera);
    return;
  }

  screens.showPause(false);

  if (state === 'countdown') {
    race.update(dt, track);
    speedLines.setActive(false);
  } else {
    // racing / finished：车辆物理照常推进
    field.forEach((f, idx) => {
      const st = race.stats[idx];
      if (st?.eliminated) {
        // 被淘汰 AI：刹车靠边，停稳后冻结（淘汰赛）
        if (!st.parked) {
          if (Math.abs(f.car.state.forwardSpeed) > 1) {
            f.car.input = parkingInput(f.car);
          } else {
            st.parked = true;
            f.car.input = { throttle: 0, brake: 1, steer: 0, handbrake: false, nitro: false };
            f.car.state.vx = 0;
            f.car.state.vz = 0;
          }
        }
      } else if (f.human !== null && state === 'racing') {
        f.car.input = splitMode
          ? f.human === 0
            ? input.getCarInputP1()
            : input.getCarInputP2()
          : input.getCarInput();
      } else if (f.human !== null) {
        // 完赛后自动驾驶巡游
        f.car.input = (f.human === 0 ? playerAutopilot : player2Autopilot).computeInput(
          f.car, track, st.progress, st.progress, dt,
        );
      } else {
        f.car.input = f.driver!.computeInput(
          f.car,
          track,
          race.player.progress,
          st?.progress ?? 0,
          dt,
        );
      }
    });
    field.forEach((f, idx) => {
      if (race.stats[idx]?.parked) return;
      f.car.update(dt, track);
    });
    resolveCarCollisions(
      mode === 'hotpursuit' ? [...field.map((f) => f.car), ...pursuit.cars] : field.map((f) => f.car),
    );
    updateSmoke(dt);

    // 警察追逐：警车追捕 / 逮捕判定；被逮捕立即结束
    if (mode === 'hotpursuit') {
      pursuit.update(dt, track, player, race.player.progress, state === 'racing');
      if (state === 'racing' && pursuit.busted) {
        bustedRace = true;
        race.forceFinish();
      }
    }

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

      // 氮气回复：环道每圈 / 冲刺道每检查点（每位人类玩家独立）
      field.forEach((f, idx) => {
        if (f.human === null) return;
        const st = race.stats[idx];
        if (st.lap > f.lastLap) {
          f.lastLap = st.lap;
          const cap = f.car.tuning.nitroCapacity;
          f.car.state.nitroFuel = Math.min(cap, f.car.state.nitroFuel + cap * NITRO_LAP_BONUS);
        }
        if (race.sprint && st.checkpoint > f.lastCheckpoint) {
          f.lastCheckpoint = st.checkpoint;
          const cap = f.car.tuning.nitroCapacity;
          f.car.state.nitroFuel = Math.min(cap, f.car.state.nitroFuel + cap * 0.25);
        }
      });

      // 氮气开启瞬间的喷射嘶声
      if (player.state.nitroActive && !prevNitroActive) audio.playSfx('nitro');

      // 录制本帧（10Hz 内部节流）
      if (!splitMode) recorder.frame(race.raceTime);
    } else if (!resultsShown) {
      // 结算：积分（单人）/ 纪录（单人非淘汰赛/非追逐）/ 音效
      resultsShown = true;
      hud.hideBanner();
      let earned: number | null = null;
      if (!splitMode) {
        earned = bustedRace
          ? 10
          : (RACE_REWARDS[race.player.position - 1] ?? RACE_REWARDS[3]);
        save.credits += earned;
        const finishTime = race.player.finishTime;
        if (!race.knockout && mode !== 'hotpursuit' && finishTime !== null) {
          const prev = save.records[mode as 'circuit' | 'sprint'];
          if (prev === null || finishTime < prev) {
            save.records[mode as 'circuit' | 'sprint'] = finishTime;
            newRecord = true;
            screens.updateRecords(save.records);
          }
        }
        persistSave(save);
      }
      if (!splitMode) {
        recorder.frame(race.raceTime); // 冲线瞬间的尾帧
        replayData = recorder.stop();
      }
      lastResults = {
        earned,
        opts: {
          mode,
          newRecord,
          busted: bustedRace,
          twoPlayer: splitMode,
          p1Pos: race.stats[0]?.position,
          p2Pos: race.stats[1]?.position,
        },
      };
      screens.showResults(race.stats, 0, earned, save.credits, lastResults.opts);
      screens.setReplayAvailable(replayData !== null);
      audio.playSfx(bustedRace ? 'eliminate' : 'victory');
    }

    speedLines.setActive(!splitMode && state === 'racing' && player.state.nitroActive);
    prevNitroActive = player.state.nitroActive;
  }

  updateAudio(dt, state);

  // 事件横幅到时隐藏
  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) hud.hideBanner();
  }

  // 双人宽限提示
  if (splitMode && state === 'racing' && race.graceLeft !== null) {
    const secs = Math.ceil(race.graceLeft);
    hudP1.setGrace(race.stats[0]?.finished ? `等待 P2 完赛： ${secs}s` : null);
    hudP2.setGrace(race.stats[1]?.finished ? `等待 P1 完赛： ${secs}s` : null);
  }

  // 相机 / HUD / 小地图
  if (splitMode) {
    chaseCam.update(dt, player, camera, state === 'racing' && player.state.nitroActive);
    chaseCamP2.update(dt, player2, cameraP2, state === 'racing' && player2.state.nitroActive);
    hudP1.update(hudDataFor(0, state));
    hudP2.update(hudDataFor(1, state));
  } else {
    chaseCam.update(dt, player, camera, state === 'racing' && player.state.nitroActive);
    hud.update(hudDataFor(0, state));
  }

  // 驾驶舱内饰与仪表（仅驾驶舱视角可见；仪表转速复用档位模型）
  cockpitP1.setVisible(chaseCam.mode === 'cockpit');
  cockpitP1.update(dt, player.state.steer, player.speedKmh, lastRpm, player.nitroRatio, player.input.brake > 0);
  if (splitMode) {
    const gb2 = stepGearbox(
      gearboxP2,
      Math.abs(player2.state.forwardSpeed) / player2.tuning.maxSpeed,
      dt,
    );
    gearboxP2 = gb2.state;
    cockpitP2.setVisible(chaseCamP2.mode === 'cockpit');
    cockpitP2.update(dt, player2.state.steer, player2.speedKmh, gb2.rpm, player2.nitroRatio, player2.input.brake > 0);
  } else {
    cockpitP2.setVisible(false);
  }

  // HEAT 警示：警车接近时屏幕红边脉冲
  const heat = mode === 'hotpursuit' && state === 'racing' ? pursuit.heatLevel() : 0;
  heatOverlay.style.opacity = String(heat * 0.9);
  heatOverlay.classList.toggle('hot', heat > 0.05);

  const dots = field.map((f, i) => ({
    x: f.car.pos.x,
    z: f.car.pos.z,
    color: race.stats[i]?.eliminated ? '#8a8a8a' : cssColor(f.car.color),
    isPlayer: f.human === 0,
  }));
  if (mode === 'hotpursuit') {
    for (const pc of pursuit.cars) {
      dots.push({ x: pc.pos.x, z: pc.pos.z, color: '#ff4545', isPlayer: false });
    }
  }
  minimap.update(dots);

  smoke.update(dt);

  // 雨粒子跟随 P1 相机（双人两视口共享同一场雨）
  rainFX.update(dt, camera.position);

  // 阴影框跟随 P1
  sun.position.set(player.pos.x + sunDir.x * 220, player.pos.y + sunDir.y * 220, player.pos.z + sunDir.z * 220);
  sun.target.position.copy(player.pos);
  sun.target.updateMatrixWorld();

  // 渲染：双人双视口直渲（EffectComposer 与 scissor 不兼容，双人关闭 bloom）
  if (splitMode) renderSplit();
  else postfx.render(scene, camera);
}

animate();
