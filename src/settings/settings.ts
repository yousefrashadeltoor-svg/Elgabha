/*
 * Typed settings with persistence (localStorage).
 * Every option in the settings screens lives here. Defaults match the brief's
 * quality tiers; values are validated on load so a corrupted store falls back.
 */

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
export type Lang = 'en' | 'ar';
export type ColorblindMode = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';
export type CrosshairStyle = 'dot' | 'cross' | 'tick' | 'none';
export type TouchLayout = 'twoThumb' | 'threeFinger' | 'fourFinger' | 'claw';
export type GyroMode = 'off' | 'ads' | 'always';
export type AudioOutput = 'speakers' | 'headphones';

export interface GraphicsSettings {
  preset: QualityPreset;
  renderScale: number;       // 0.5 .. 1.5
  dynamicResolution: boolean;
  shadows: boolean;
  shadowQuality: number;     // 512 | 1024 | 2048 | 4096
  viewDistance: number;      // metres
  fov: number;               // degrees
  fpsCap: number;            // 0 = uncapped
  motionBlur: boolean;
  antialias: boolean;
  particles: number;         // multiplier 0..2
  anisotropy: number;
  grassDensity: number;      // 0..2
  decals: number;            // 0..64
  rendererBackend: 'webgl2' | 'webgpu';
}

export interface AudioSettings {
  master: number;
  weapons: number;
  environment: number;
  dialogue: number;
  music: number;
  ui: number;
  outputMode: AudioOutput;
  hrtf: boolean;
  tinnitus: boolean;
}

export interface ControlsSettings {
  mouseSensitivity: number;
  adsSensitivity: number;
  scopeSensitivity: number;
  invertY: boolean;
  toggleAds: boolean;
  toggleSprint: boolean;
  holdBreath: boolean;
}

export interface InterfaceSettings {
  language: Lang;
  hudScale: number;         // 0.6 .. 1.6
  showFps: boolean;
  showProfiler: boolean;
  showDamageNumbers: boolean;
  showHitMarkers: boolean;
  crosshairStyle: CrosshairStyle;
  colorblind: ColorblindMode;
  subtitles: boolean;
  reduceMotion: boolean;
  highContrast: boolean;
  screenShake: boolean;
  impactEffects: boolean;
}

export interface TouchSettings {
  layout: TouchLayout;
  buttonSize: number;
  buttonOpacity: number;
  gyro: GyroMode;
  gyroSensitivity: number;
  gyroSmoothing: number;
}

export interface Settings {
  graphics: GraphicsSettings;
  audio: AudioSettings;
  controls: ControlsSettings;
  interface: InterfaceSettings;
  touch: TouchSettings;
}

const KEY = 'fl1943.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  graphics: {
    preset: 'high', renderScale: 1, dynamicResolution: true, shadows: true,
    shadowQuality: 2048, viewDistance: 500, fov: 78, fpsCap: 0, motionBlur: false,
    antialias: true, particles: 1, anisotropy: 8, grassDensity: 1, decals: 16,
    rendererBackend: 'webgl2',
  },
  audio: {
    master: 0.85, weapons: 1, environment: 0.8, dialogue: 0.9, music: 0.6, ui: 0.8,
    outputMode: 'headphones', hrtf: true, tinnitus: true,
  },
  controls: {
    mouseSensitivity: 1, adsSensitivity: 0.55, scopeSensitivity: 0.35,
    invertY: false, toggleAds: false, toggleSprint: false, holdBreath: true,
  },
  interface: {
    language: 'en', hudScale: 1, showFps: true, showProfiler: false,
    showDamageNumbers: true, showHitMarkers: true, crosshairStyle: 'cross',
    colorblind: 'none', subtitles: true, reduceMotion: false, highContrast: false,
    screenShake: true, impactEffects: true,
  },
  touch: {
    layout: 'twoThumb', buttonSize: 1, buttonOpacity: 0.65,
    gyro: 'ads', gyroSensitivity: 1, gyroSmoothing: 0.4,
  },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function mergeSection<T extends Record<string, unknown>>(base: T, stored: unknown): T {
  if (!isRecord(stored)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(base)) {
    const b = base[k];
    const s = stored[k];
    if (typeof b === 'number' && typeof s === 'number' && Number.isFinite(s)) out[k] = s;
    else if (typeof b === 'boolean' && typeof s === 'boolean') out[k] = s;
    else if (typeof b === 'string' && typeof s === 'string') out[k] = s;
    else if (isRecord(b) && isRecord(s)) out[k] = mergeSection(b, s);
  }
  return out as T;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return structuredClone(DEFAULT_SETTINGS);
    return {
      graphics: mergeSection(DEFAULT_SETTINGS.graphics as unknown as Record<string, unknown>, parsed.graphics) as unknown as GraphicsSettings,
      audio: mergeSection(DEFAULT_SETTINGS.audio as unknown as Record<string, unknown>, parsed.audio) as unknown as AudioSettings,
      controls: mergeSection(DEFAULT_SETTINGS.controls as unknown as Record<string, unknown>, parsed.controls) as unknown as ControlsSettings,
      interface: mergeSection(DEFAULT_SETTINGS.interface as unknown as Record<string, unknown>, parsed.interface) as unknown as InterfaceSettings,
      touch: mergeSection(DEFAULT_SETTINGS.touch as unknown as Record<string, unknown>, parsed.touch) as unknown as TouchSettings,
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function resetSettings(): Settings {
  const s = structuredClone(DEFAULT_SETTINGS);
  saveSettings(s);
  return s;
}

/** Simple listener set so the UI + engine can react to changes. */
type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();
export function subscribeSettings(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function notifySettings(s: Settings): void {
  for (const fn of listeners) fn(s);
}

/* Quality preset tables. */
export interface QualityTable {
  shadows: boolean;
  shadowQuality: number;
  renderScale: number;
  pixelsPerMeter: number;
  particleMul: number;
  decals: number;
  grass: number;
  anisotropy: number;
  antialias: boolean;
  motionBlur: boolean;
}

export const QUALITY_TABLE: Record<QualityPreset, QualityTable> = {
  low: {
    shadows: false, shadowQuality: 512, renderScale: 0.7, pixelsPerMeter: 220,
    particleMul: 0.35, decals: 4, grass: 0.25, anisotropy: 0, antialias: false, motionBlur: false,
  },
  medium: {
    shadows: true, shadowQuality: 1024, renderScale: 0.85, pixelsPerMeter: 300,
    particleMul: 0.6, decals: 8, grass: 0.6, anisotropy: 4, antialias: true, motionBlur: false,
  },
  high: {
    shadows: true, shadowQuality: 2048, renderScale: 1, pixelsPerMeter: 420,
    particleMul: 1, decals: 16, grass: 1, anisotropy: 8, antialias: true, motionBlur: false,
  },
  ultra: {
    shadows: true, shadowQuality: 4096, renderScale: 1.15, pixelsPerMeter: 560,
    particleMul: 1.6, decals: 32, grass: 1.6, anisotropy: 16, antialias: true, motionBlur: true,
  },
};

export function applyPreset(s: Settings, preset: QualityPreset): Settings {
  const t = QUALITY_TABLE[preset];
  return {
    ...s,
    graphics: {
      ...s.graphics,
      preset,
      shadows: t.shadows,
      shadowQuality: t.shadowQuality,
      renderScale: t.renderScale,
      particles: t.particleMul,
      decals: t.decals,
      grassDensity: t.grass,
      anisotropy: t.anisotropy,
      antialias: t.antialias,
      motionBlur: t.motionBlur,
      rendererBackend: 'webgl2',
    },
  };
}
