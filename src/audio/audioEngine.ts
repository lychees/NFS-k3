import { clamp } from '../utils/math';
import { engineCutoff, engineFreq, engineGain } from './engineModel';

export type SfxName =
  | 'uiSelect'
  | 'uiConfirm'
  | 'countBeep'
  | 'countGo'
  | 'victory'
  | 'nitro'
  | 'thud'
  | 'shift'
  | 'eliminate';

interface NoiseVoice {
  filter: BiquadFilterNode;
  gain: GainNode;
}

interface EngineNodes {
  osc: OscillatorNode;
  sub: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

interface SirenNodes {
  gain: GainNode;
}

/**
 * AudioEngine 单例：AudioContext 生命周期 + 主增益 + 静音。
 * 持续声（引擎/胎响/草地）为常驻节点图，每帧只更新参数；
 * 一次性音效短节点播完自动 disconnect。
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: EngineNodes | null = null;
  private skid: NoiseVoice | null = null;
  private grass: NoiseVoice | null = null;
  private siren: SirenNodes | null = null;
  private rain: NoiseVoice | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private muted = false;
  private volume = 0.8;
  private gameSuspended = false;

  get isMuted(): boolean {
    return this.muted;
  }

  get isRunning(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** 浏览器自动播放策略：必须在用户手势中调用 */
  unlock(): void {
    if (!this.ctx) this.build();
    if (this.ctx && this.ctx.state === 'suspended' && !this.gameSuspended) {
      void this.ctx.resume();
    }
  }

  setMuted(m: boolean): boolean {
    this.muted = m;
    this.applyMaster();
    return this.muted;
  }

  toggleMute(): boolean {
    return this.setMuted(!this.muted);
  }

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    this.applyMaster();
  }

  /** 暂停：挂起整个上下文（所有声音冻结） */
  suspendGame(): void {
    this.gameSuspended = true;
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resumeGame(): void {
    this.gameSuspended = false;
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** 每帧更新引擎参数：rpm 0..1，throttle 0..1 */
  setEngine(
    rpm: number,
    throttle: number,
    opts: { active: boolean; shifting: boolean; nitro: boolean },
  ): void {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    const e = this.engine;
    const freq = engineFreq(rpm) * (opts.nitro ? 1.18 : 1);
    e.osc.frequency.setTargetAtTime(freq, t, 0.03);
    e.sub.frequency.setTargetAtTime(freq / 2, t, 0.03);
    e.filter.frequency.setTargetAtTime(
      engineCutoff(rpm, throttle) * (opts.nitro ? 1.35 : 1),
      t,
      0.05,
    );
    const g = opts.active ? engineGain(rpm, throttle, opts.shifting) : 0;
    e.gain.gain.setTargetAtTime(g, t, 0.06);
  }

  /** 胎响强度 0..1 */
  setSkid(intensity: number): void {
    if (!this.ctx || !this.skid) return;
    const t = this.ctx.currentTime;
    this.skid.gain.gain.setTargetAtTime(intensity * 0.4, t, 0.05);
    this.skid.filter.frequency.setTargetAtTime(700 + intensity * 400, t, 0.1);
  }

  /** 草地滚动声强度 0..1 */
  setGrass(intensity: number): void {
    if (!this.ctx || !this.grass) return;
    const t = this.ctx.currentTime;
    this.grass.gain.gain.setTargetAtTime(intensity * 0.22, t, 0.08);
    this.grass.filter.frequency.setTargetAtTime(380 + intensity * 160, t, 0.1);
  }

  /** 警笛音量 0..1（随最近警车距离衰减） */
  setSiren(level: number): void {
    if (!this.ctx || !this.siren) return;
    this.siren.gain.gain.setTargetAtTime(level * 0.12, this.ctx.currentTime, 0.15);
  }

  /** 雨声音量 0..1（雨天启用） */
  setRain(level: number): void {
    if (!this.ctx || !this.rain) return;
    this.rain.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.3);
  }

  playSfx(name: SfxName, intensity = 1): void {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return;
    switch (name) {
      case 'uiSelect':
        this.blip(1250, 0.06, 'square', 0.1);
        break;
      case 'uiConfirm':
        this.blip(900, 0.06, 'square', 0.12);
        this.blip(1400, 0.09, 'square', 0.12, 0.07);
        break;
      case 'countBeep':
        this.blip(440, 0.15, 'square', 0.28);
        break;
      case 'countGo':
        this.blip(880, 0.45, 'square', 0.32);
        this.blip(1760, 0.3, 'sine', 0.12, 0.02);
        break;
      case 'victory': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((f, i) => this.blip(f, i === notes.length - 1 ? 0.4 : 0.15, 'triangle', 0.26, i * 0.15));
        break;
      }
      case 'nitro':
        this.noiseShot(0.55, 0.5 * intensity, (node) => {
          node.frequency.setValueAtTime(1800, this.ctx!.currentTime);
          node.frequency.linearRampToValueAtTime(6500, this.ctx!.currentTime + 0.45);
        }, 'highpass');
        break;
      case 'thud': {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(95, t);
        osc.frequency.exponentialRampToValueAtTime(38, t + 0.16);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.7 * intensity, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.connect(g).connect(this.master);
        osc.start(t);
        osc.stop(t + 0.3);
        osc.onended = () => g.disconnect();
        this.noiseShot(0.12, 0.35 * intensity, null, 'lowpass', 260);
        break;
      }
      case 'shift':
        this.blip(300, 0.05, 'square', 0.14);
        this.blip(180, 0.07, 'square', 0.12, 0.04);
        break;
      case 'eliminate': {
        // 低沉电子下行音 + 噪声垫底
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(210, t);
        osc.frequency.exponentialRampToValueAtTime(52, t + 0.45);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.34, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        osc.connect(lp).connect(g).connect(this.master);
        osc.start(t);
        osc.stop(t + 0.6);
        osc.onended = () => {
          g.disconnect();
          lp.disconnect();
        };
        this.noiseShot(0.25, 0.14, null, 'lowpass', 300);
        break;
      }
    }
  }

  // ---------- 内部 ----------

  private build(): void {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    // 共享白噪声缓冲（2s 循环）
    const len = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // 引擎：锯齿波 + 次谐波方波 → 低通 → 增益（常驻）
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const sub = ctx.createOscillator();
    sub.type = 'square';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    sub.connect(subGain);
    subGain.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.frequency.value = engineFreq(0.18);
    sub.frequency.value = engineFreq(0.18) / 2;
    osc.start();
    sub.start();
    this.engine = { osc, sub, filter, gain };

    this.skid = this.makeNoiseVoice('bandpass', 800, 1.2);
    this.grass = this.makeNoiseVoice('lowpass', 420, 0.8);
    this.rain = this.makeNoiseVoice('bandpass', 1600, 0.4);

    // 警笛：方波载波 + 低频方波 LFO 扫频（双音交替 wail），常驻节点
    const sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'square';
    sirenOsc.frequency.value = 800;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 0.55;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 150;
    lfo.connect(lfoGain);
    lfoGain.connect(sirenOsc.frequency);
    const sirenLp = ctx.createBiquadFilter();
    sirenLp.type = 'lowpass';
    sirenLp.frequency.value = 2400;
    const sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenOsc.connect(sirenLp);
    sirenLp.connect(sirenGain);
    sirenGain.connect(this.master);
    sirenOsc.start();
    lfo.start();
    this.siren = { gain: sirenGain };
  }

  private makeNoiseVoice(type: BiquadFilterType, freq: number, q: number): NoiseVoice {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
    src.start();
    return { filter, gain };
  }

  /** 短促电子音（可指定延时与结尾） */
  private blip(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    osc.onended = () => g.disconnect();
  }

  /** 一次性噪声音效（可选滤波扫频），播完 disconnect */
  private noiseShot(
    dur: number,
    vol: number,
    sweep: ((filter: BiquadFilterNode) => void) | null,
    type: BiquadFilterType,
    freq = 1000,
  ): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = false;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    if (sweep) sweep(filter);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
    src.onended = () => {
      g.disconnect();
      filter.disconnect();
    };
  }

  private applyMaster(): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(
      this.muted ? 0 : this.volume,
      this.ctx.currentTime,
      0.02,
    );
  }
}

export const audio = new AudioEngine();
