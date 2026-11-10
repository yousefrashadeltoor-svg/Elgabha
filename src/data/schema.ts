/*
 * Data schemas (ADR-004).
 *
 * Every tunable in the game lives in src/data/*.json. These types describe the
 * shape; validate.ts checks the actual JSON at startup and throws with the exact
 * JSON path of the first problem, so a typo fails loudly instead of silently
 * producing a weapon that does nothing.
 */

export type Faction = 'soviet' | 'german' | 'shared';

export type WeaponClass =
  | 'rifle' | 'sniper' | 'smg' | 'lmg' | 'mmg' | 'pistol'
  | 'at' | 'melee' | 'throwable' | 'launcher';

export type FireMode = 'single' | 'auto' | 'burst';

export type FeedType = 'internal' | 'box' | 'drum' | 'belt' | 'pan' | 'stripper' | 'single';

export interface LocalizedText {
  en: string;
  ar: string;
}

export interface DamageCurve {
  /** Damage at and inside `nearRange`. */
  near: number;
  /** Damage at and beyond `farRange`. */
  far: number;
  nearRange: number;
  farRange: number;
}

export interface RecoilData {
  /** Degrees of upward camera kick per shot. */
  vertical: number;
  /** Degrees of horizontal camera kick per shot (random within +/- this). */
  horizontal: number;
  /** Multiplier applied to the aim punch (weapon displacement) per shot. */
  punch: number;
  /** Fraction of recoil recovered per second once firing stops. */
  recovery: number;
  /**
   * Deterministic horizontal drift pattern, cycled per shot index.
   * Values are multipliers in [-1, 1] applied to `horizontal`.
   */
  pattern: number[];
}

export interface SpreadData {
  /** Base cone half-angle in degrees when hip firing while still. */
  hip: number;
  /** Base cone half-angle in degrees when aiming down sights while still. */
  ads: number;
  /** Added degrees while moving at full sprint. */
  move: number;
  /** Multiplier while crouched. */
  crouch: number;
  /** Multiplier while prone. */
  prone: number;
  /** Degrees added per shot. */
  perShot: number;
  /** Ceiling for the accumulated spread. */
  max: number;
}

export interface BipodData {
  deployTime: number;
  /** Recoil multiplier when deployed. */
  recoilMul: number;
  /** Spread multiplier when deployed. */
  spreadMul: number;
  /** Yaw limit in degrees when deployed. */
  yawLimit: number;
}

export interface HeatData {
  /** Heat added per shot (0..1 scale). */
  perShot: number;
  /** Heat lost per second. */
  coolRate: number;
  /** Heat at which the weapon jams. */
  jamAt: number;
  /** Seconds to change the barrel. */
  barrelChange: number;
}

export interface ScopeData {
  magnification: number;
  /** Metres the scope is zeroed at by default. */
  zeroRange: number;
  reticle: 'post' | 'crosshair' | 'chevron' | 'german-post';
}

export interface AudioProfile {
  /** Relative level of the close mechanical transient. */
  mech: number;
  /** Relative level of the supersonic crack. */
  crack: number;
  /** Relative level of the body/low-end. */
  body: number;
  /** Relative level of the tail/reverb send. */
  tail: number;
  /** Base pitch multiplier for the report. */
  pitch: number;
  /** Seconds of the report envelope. */
  duration: number;
}

export interface ViewmodelData {
  scale: number;
  offset: [number, number, number];
  rot: [number, number, number];
  /** Seconds for one bolt cycle. 0 for weapons without a manual action. */
  boltCycle: number;
  /** Seconds for the magazine to travel out and back. */
  magTravel: number;
}

export interface WeaponData {
  id: string;
  name: LocalizedText;
  faction: Faction;
  class: WeaponClass;
  caliber: string;
  ammoType: string;

  muzzleVelocity: number;
  dragK: number;
  gravityScale: number;

  damage: DamageCurve;
  /** Penetration in millimetres of rolled homogeneous armour equivalent. */
  penetration: number;

  fireModes: FireMode[];
  rpm: number;

  feed: FeedType;
  capacity: number;
  reloadTactical: number;
  reloadEmpty: number;
  /** Seconds per individual round when loading one at a time. */
  reloadPerRound: number;

  weight: number;
  length: number;
  adsTime: number;
  drawTime: number;
  holsterTime: number;

  recoil: RecoilData;
  spread: SpreadData;
  bipod?: BipodData;
  heat?: HeatData;
  scope?: ScopeData;

  sockets: string[];
  audio: AudioProfile;
  viewmodel: ViewmodelData;

  tracerEvery: number;
  years: [number, number];
  notes: string;
  source: string;
}

export interface AmmoData {
  id: string;
  name: LocalizedText;
  caliber: string;
  /** Mass in grams. */
  mass: number;
  /** Muzzle velocity in m/s for the reference barrel. */
  velocity: number;
  /** Ballistic coefficient (G1-ish), used to derive drag. */
  bc: number;
  /** Tracer colour when this round is a tracer. */
  tracerColor?: string;
  notes: string;
}

export interface AttachmentMods {
  adsTime?: number;
  recoilVertical?: number;
  recoilHorizontal?: number;
  spreadAds?: number;
  spreadHip?: number;
  weight?: number;
  drawTime?: number;
}

export interface AttachmentData {
  id: string;
  name: LocalizedText;
  socket: string;
  /** Weapon ids this fits. Empty = fits any weapon with the socket. */
  fits: string[];
  /** Stat deltas applied on equip. */
  mods: AttachmentMods;
  scope?: ScopeData;
  /** Visual mesh key for the attachment model. */
  mesh: string;
  years: [number, number];
  notes: string;
}

export type CharacterRole =
  | 'rifleman' | 'smg' | 'mg' | 'sniper' | 'officer' | 'medic' | 'engineer' | 'scout';

export interface CharacterData {
  id: string;
  name: LocalizedText;
  faction: Faction;
  role: CharacterRole;
  /** Base movement speeds in m/s. */
  speeds: { walk: number; sprint: number; crouch: number; prone: number };
  health: number;
  /** Loadout weapon ids. */
  loadout: string[];
  /** Cosmetic variation indices (face, hair, build, height). */
  variation: { face: number; hair: number; build: number; height: number };
  /** Uniform/equipment keys resolved by the character builder. */
  uniform: string;
  headgear: string;
  notes: string;
}

export interface MapLayer {
  texture: string;
  tile: number;
  slopeMin: number;
  slopeMax: number;
  heightMin: number;
  heightMax: number;
}

export interface MapData {
  id: string;
  name: LocalizedText;
  /** Terrain size in metres. */
  size: number;
  /** Heightmap resolution (vertices per side). */
  resolution: number;
  /** Terrain seed for deterministic generation. */
  seed: number;
  /** Texture layer ids from the CC0 set, with world-space tiling in metres. */
  layers: MapLayer[];
  buildings: { type: string; x: number; z: number; rot: number; scale: number }[];
  trenches: { points: [number, number][]; width: number; depth: number }[];
  props: { type: string; x: number; z: number; rot: number }[];
  spawns: { faction: Faction; points: [number, number][] }[];
  objectives: { id: string; name: LocalizedText; x: number; z: number; radius: number }[];
  weather: 'clear' | 'overcast' | 'snow' | 'rain' | 'fog';
  timeOfDay: number;
  notes: string;
}

export type MissionMode =
  | 'assault' | 'defend' | 'recon' | 'escort' | 'destroy' | 'tdm' | 'conquest' | 'training';

export type ObjectiveType = 'capture' | 'destroy' | 'reach' | 'survive' | 'eliminate';

export type Difficulty = 'recruit' | 'regular' | 'veteran' | 'elite';

export interface MissionData {
  id: string;
  name: LocalizedText;
  map: string;
  mode: MissionMode;
  faction: Faction;
  briefing: LocalizedText;
  objectives: { id: string; text: LocalizedText; type: ObjectiveType; target: string; count: number }[];
  enemyCount: number;
  allyCount: number;
  difficulty: Difficulty;
  timeLimit: number;
  notes: string;
}

/** The whole validated dataset, assembled at startup. */
export interface GameData {
  weapons: Map<string, WeaponData>;
  ammo: Map<string, AmmoData>;
  attachments: Map<string, AttachmentData>;
  characters: Map<string, CharacterData>;
  maps: Map<string, MapData>;
  missions: Map<string, MissionData>;
}
