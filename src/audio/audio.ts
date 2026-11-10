/*
 * Audio system: Web Audio graph with buses (master/weapons/environment/
 * dialogue/music/ui), HRTF spatialisation, distance attenuation, and the
 * post-explosion tinnitus effect. All sounds are synthesised procedurally
 * (no external audio files) so the build ships with zero audio licensing.
 */

import type { AudioSettings } from '../settings/settings';
import { clamp } from '../core/math';

export type Bus = 'weapons' | 'environment' | 'dialogue' | 'music' | 'ui';

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses = new Map<Bus, GainNode>();
  private listener: AudioListener | null = null;
  private tinnitusGain: GainNode | null = null;
  private tinnitusOsc: OscillatorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private voices = 0;
  private maxVoices = 48;
  private settings: AudioSettings;
  private started = false;

  constructor(settings: AudioSettings) {
    this.settings = settings;
  }

  get isRunning(): boolean {
    return this.ctx?.state === 'running';
  }

  get state(): string {
    return this.ctx?.state ?? 'suspended';
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 0;
  }

  get latency(): number {
    return (this.ctx?.baseLatency ?? 0) * 1000;
  }

  get channelCount(): number {
    return this.ctx?.destination.maxChannelCount ?? 2;
  }

  get activeVoices(): number {
    return this.voices;
  }

  async resume(): Promise<void> {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state !== 'running') {
      await this.ctx.resume();
    }
  }

  init(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = this.settings.master;
    this.master.connect(this.ctx.destination);

    for (const b of ['weapons', 'environment', 'dialogue', 'music', 'ui'] as Bus[]) {
      const g = this.ctx.createGain();
      g.gain.value = this.busVolume(b);
      g.connect(this.master);
      this.buses.set(b, g);
    }

    // Tinnitus: a soft high tone gated by a gain node.
    this.tinnitusGain = this.ctx.createGain();
    this.tinnitusGain.gain.value = 0;
    this.tinnitusGain.connect(this.master);
    this.tinnitusOsc = this.ctx.createOscillator();
    this.tinnitusOsc.type = 'sine';
    this.tinnitusOsc.frequency.value = 4200;
    this.tinnitusOsc.connect(this.tinnitusGain);
    this.tinnitusOsc.start();

    // White-noise buffer for gunshots / explosions.
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    this.started = true;
  }

  private busVolume(b: Bus): number {
    switch (b) {
      case 'weapons': return this.settings.weapons;
      case 'environment': return this.settings.environment;
      case 'dialogue': return this.settings.dialogue;
      case 'music': return this.settings.music;
      case 'ui': return this.settings.ui;
    }
  }

  applySettings(s: AudioSettings): void {
    this.settings = s;
    if (!this.ctx || !this.master) return;
    this.master.gain.value = s.master;
    for (const b of ['weapons', 'environment', 'dialogue', 'music', 'ui'] as Bus[]) {
      this.buses.get(b)?.gain.setTargetAtTime(this.busVolume(b), this.ctx.currentTime, 0.02);
    }
  }

  /** Update the listener pose (position + forward/up vectors). */
  setListener(pos: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number }, up: { x: number; y: number; z: number }): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = forward.x; l.forwardY.value = forward.y; l.forwardZ.value = forward.z;
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
    } else {
      (l as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(pos.x, pos.y, pos.z);
      (l as unknown as { setOrientation: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void }).setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  private panner(pos: { x: number; y: number; z: number }): PannerNode | null {
    if (!this.ctx) return null;
    const p = this.ctx.createPanner();
    p.panningModel = this.settings.hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 4;
    p.maxDistance = 400;
    p.rolloffFactor = 1.1;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    return p;
  }

  /** A gunshot: noise burst + low thump, spatialised. */
  gunshot(pos: { x: number; y: number; z: number }, caliber: number, suppressed = false): void {
    if (!this.ctx || !this.noiseBuffer) return;
    if (this.voices >= this.maxVoices) return;
    const t = this.ctx.currentTime;
    const bus = this.buses.get('weapons')!;
    const panner = this.panner(pos);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = suppressed ? 900 : 1600 + caliber * 40;
    bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    const peak = suppressed ? 0.12 : clamp(0.5 - caliber * 0.01, 0.15, 0.6);
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (suppressed ? 0.08 : 0.22));
    src.connect(bp).connect(g);
    if (panner) g.connect(panner).connect(bus);
    else g.connect(bus);
    src.start(t);
    src.stop(t + 0.3);
    this.voices++;
    src.onended = () => { this.voices--; };

    // low thump
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(peak * 0.6, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(og);
    if (panner) og.connect(panner);
    else og.connect(bus);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** Explosion: big noise + rumble + optional tinnitus. */
  explosion(pos: { x: number; y: number; z: number }, distance: number): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const bus = this.buses.get('environment')!;
    const panner = this.panner(pos);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    src.connect(lp).connect(g);
    if (panner) g.connect(panner).connect(bus);
    else g.connect(bus);
    src.start(t);
    src.stop(t + 1.2);

    if (this.settings.tinnitus && distance < 22 && this.tinnitusGain) {
      const amt = clamp(1 - distance / 22, 0, 1) * 0.06;
      this.tinnitusGain.gain.cancelScheduledValues(t);
      this.tinnitusGain.gain.setValueAtTime(amt, t);
      this.tinnitusGain.gain.exponentialRampToValueAtTime(0.0001, t + 6);
    }
  }

  /** Footstep: short filtered noise. */
  footstep(pos: { x: number; y: number; z: number }, loud: boolean): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const bus = this.buses.get('environment')!;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = loud ? 900 : 500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(loud ? 0.14 : 0.07, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(bp).connect(g).connect(bus);
    src.start(t);
    src.stop(t + 0.15);
  }

  /** UI click. */
  ui(kind: 'click' | 'confirm' | 'error' = 'click'): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const bus = this.buses.get('ui')!;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = kind === 'confirm' ? 660 : kind === 'error' ? 180 : 440;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** Ambient wind loop (very quiet, non-spatial). */
  startAmbient(): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const bus = this.buses.get('environment')!;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = this.ctx.createGain();
    g.gain.value = 0.03;
    src.connect(lp).connect(g).connect(bus);
    src.start();
  }

  dispose(): void {
    this.tinnitusOsc?.stop();
    this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }

  get hasStarted(): boolean {
    return this.started;
  }
}
