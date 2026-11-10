/*
 * Runtime data validator (ADR-004).
 *
 * Fails loudly with the exact JSON path of the first problem. Called once at
 * startup; the cost is irrelevant and the payoff is that a typo in a data file
 * can never silently produce a broken weapon.
 */

import type {
  AmmoData, AttachmentData, AttachmentMods, AudioProfile, BipodData, CharacterData,
  DamageCurve, Faction, FeedType, FireMode, GameData, HeatData, LocalizedText, MapData,
  MapLayer, MissionData, RecoilData, ScopeData, SpreadData, ViewmodelData, WeaponClass,
  WeaponData,
} from './schema';

export class DataError extends Error {
  constructor(public path: string, message: string) {
    super(`data error at ${path}: ${message}`);
    this.name = 'DataError';
  }
}

function req(obj: unknown, path: string, key: string): unknown {
  if (obj === null || typeof obj !== 'object') throw new DataError(path, 'expected object');
  const v = (obj as Record<string, unknown>)[key];
  if (v === undefined || v === null) throw new DataError(`${path}.${key}`, 'missing');
  return v;
}

function opt(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  return (obj as Record<string, unknown>)[key];
}

/** Read a numeric field from an object OR a numeric index from an array. */
function num(obj: unknown, path: string, key: string, min?: number, max?: number): number {
  let v: unknown;
  if (Array.isArray(obj)) {
    const i = Number(key);
    if (!Number.isInteger(i) || i < 0 || i >= obj.length) {
      throw new DataError(`${path}.${key}`, 'index out of range');
    }
    v = obj[i];
  } else {
    v = req(obj, path, key);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new DataError(`${path}.${key}`, `expected finite number, got ${JSON.stringify(v)}`);
  }
  if (min !== undefined && v < min) throw new DataError(`${path}.${key}`, `${v} < min ${min}`);
  if (max !== undefined && v > max) throw new DataError(`${path}.${key}`, `${v} > max ${max}`);
  return v;
}

function str(obj: unknown, path: string, key: string): string {
  const v = req(obj, path, key);
  if (typeof v !== 'string' || v.length === 0) throw new DataError(`${path}.${key}`, 'expected non-empty string');
  return v;
}

function arr(obj: unknown, path: string, key: string, minLen = 0): unknown[] {
  const v = req(obj, path, key);
  if (!Array.isArray(v)) throw new DataError(`${path}.${key}`, 'expected array');
  if (v.length < minLen) throw new DataError(`${path}.${key}`, `expected at least ${minLen} items`);
  return v;
}

function strArr(obj: unknown, path: string, key: string): string[] {
  return arr(obj, path, key).map((s, i) => {
    if (typeof s !== 'string') throw new DataError(`${path}.${key}[${i}]`, 'expected string');
    return s;
  });
}

function loc(obj: unknown, path: string, key: string): LocalizedText {
  const v = req(obj, path, key);
  return { en: str(v, `${path}.${key}`, 'en'), ar: str(v, `${path}.${key}`, 'ar') };
}

function vec3(obj: unknown, path: string, key: string): [number, number, number] {
  const v = arr(obj, path, key, 3);
  if (v.length !== 3) throw new DataError(`${path}.${key}`, 'expected exactly 3 numbers');
  return [
    num(v, `${path}.${key}`, '0'),
    num(v, `${path}.${key}`, '1'),
    num(v, `${path}.${key}`, '2'),
  ];
}

function pair(obj: unknown, path: string, key: string): [number, number] {
  const v = arr(obj, path, key, 2);
  if (v.length !== 2) throw new DataError(`${path}.${key}`, 'expected exactly 2 numbers');
  return [num(v, `${path}.${key}`, '0'), num(v, `${path}.${key}`, '1')];
}

/** A [x, z] world point. */
function point2(p: unknown, path: string): [number, number] {
  if (!Array.isArray(p) || p.length !== 2) throw new DataError(path, 'expected [x, z]');
  return [num(p, path, '0'), num(p, path, '1')];
}

const WEAPON_CLASSES: WeaponClass[] = ['rifle', 'sniper', 'smg', 'lmg', 'mmg', 'pistol', 'at', 'melee', 'throwable', 'launcher'];
const FIRE_MODES: FireMode[] = ['single', 'auto', 'burst'];
const FEEDS: FeedType[] = ['internal', 'box', 'drum', 'belt', 'pan', 'stripper', 'single'];
const FACTIONS: Faction[] = ['soviet', 'german', 'shared'];
const RETICLES: ScopeData['reticle'][] = ['post', 'crosshair', 'chevron', 'german-post'];
const WEATHERS: MapData['weather'][] = ['clear', 'overcast', 'snow', 'rain', 'fog'];
const MODES: MissionData['mode'][] = ['assault', 'defend', 'recon', 'escort', 'destroy', 'tdm', 'conquest', 'training'];
const OBJ_TYPES: MissionData['objectives'][number]['type'][] = ['capture', 'destroy', 'reach', 'survive', 'eliminate'];
const DIFFICULTIES: MissionData['difficulty'][] = ['recruit', 'regular', 'veteran', 'elite'];
const ROLES: CharacterData['role'][] = ['rifleman', 'smg', 'mg', 'sniper', 'officer', 'medic', 'engineer', 'scout'];

function oneOf<T extends string>(v: string, allowed: readonly T[], path: string): T {
  if (!allowed.includes(v as T)) throw new DataError(path, `unknown value "${v}" (allowed: ${allowed.join(', ')})`);
  return v as T;
}

export function validateWeapon(raw: unknown, path: string): WeaponData {
  const id = str(raw, path, 'id');
  const cls = oneOf(str(raw, path, 'class'), WEAPON_CLASSES, `${path}.class`);
  const faction = oneOf(str(raw, path, 'faction'), FACTIONS, `${path}.faction`);

  const fireModes = arr(raw, path, 'fireModes', 1).map((m, i) =>
    oneOf(String(m), FIRE_MODES, `${path}.fireModes[${i}]`));

  const feed = oneOf(str(raw, path, 'feed'), FEEDS, `${path}.feed`);

  const dmg = req(raw, path, 'damage');
  const damage: DamageCurve = {
    near: num(dmg, `${path}.damage`, 'near', 1),
    far: num(dmg, `${path}.damage`, 'far', 1),
    nearRange: num(dmg, `${path}.damage`, 'nearRange', 0),
    farRange: num(dmg, `${path}.damage`, 'farRange', 1),
  };
  if (damage.farRange <= damage.nearRange) {
    throw new DataError(`${path}.damage.farRange`, 'must exceed nearRange');
  }

  const rec = req(raw, path, 'recoil');
  const recoil: RecoilData = {
    vertical: num(rec, `${path}.recoil`, 'vertical', 0),
    horizontal: num(rec, `${path}.recoil`, 'horizontal', 0),
    punch: num(rec, `${path}.recoil`, 'punch', 0),
    recovery: num(rec, `${path}.recoil`, 'recovery', 0, 1),
    pattern: arr(rec, `${path}.recoil`, 'pattern', 1).map((v, i) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new DataError(`${path}.recoil.pattern[${i}]`, 'expected finite number');
      }
      return v;
    }),
  };

  const sp = req(raw, path, 'spread');
  const spread: SpreadData = {
    hip: num(sp, `${path}.spread`, 'hip', 0),
    ads: num(sp, `${path}.spread`, 'ads', 0),
    move: num(sp, `${path}.spread`, 'move', 0),
    crouch: num(sp, `${path}.spread`, 'crouch', 0, 1),
    prone: num(sp, `${path}.spread`, 'prone', 0, 1),
    perShot: num(sp, `${path}.spread`, 'perShot', 0),
    max: num(sp, `${path}.spread`, 'max', 0),
  };

  const aud = req(raw, path, 'audio');
  const audio: AudioProfile = {
    mech: num(aud, `${path}.audio`, 'mech', 0),
    crack: num(aud, `${path}.audio`, 'crack', 0),
    body: num(aud, `${path}.audio`, 'body', 0),
    tail: num(aud, `${path}.audio`, 'tail', 0),
    pitch: num(aud, `${path}.audio`, 'pitch', 0.1),
    duration: num(aud, `${path}.audio`, 'duration', 0.01),
  };

  const vm = req(raw, path, 'viewmodel');
  const viewmodel: ViewmodelData = {
    scale: num(vm, `${path}.viewmodel`, 'scale', 0.01),
    offset: vec3(vm, `${path}.viewmodel`, 'offset'),
    rot: vec3(vm, `${path}.viewmodel`, 'rot'),
    boltCycle: num(vm, `${path}.viewmodel`, 'boltCycle', 0),
    magTravel: num(vm, `${path}.viewmodel`, 'magTravel', 0),
  };

  let bipod: BipodData | undefined;
  const b = opt(raw, 'bipod');
  if (b) {
    bipod = {
      deployTime: num(b, `${path}.bipod`, 'deployTime', 0),
      recoilMul: num(b, `${path}.bipod`, 'recoilMul', 0, 1),
      spreadMul: num(b, `${path}.bipod`, 'spreadMul', 0, 1),
      yawLimit: num(b, `${path}.bipod`, 'yawLimit', 1),
    };
  }

  let heat: HeatData | undefined;
  const h = opt(raw, 'heat');
  if (h) {
    heat = {
      perShot: num(h, `${path}.heat`, 'perShot', 0),
      coolRate: num(h, `${path}.heat`, 'coolRate', 0),
      jamAt: num(h, `${path}.heat`, 'jamAt', 0, 1),
      barrelChange: num(h, `${path}.heat`, 'barrelChange', 0),
    };
  }

  let scope: ScopeData | undefined;
  const s = opt(raw, 'scope');
  if (s) {
    scope = {
      magnification: num(s, `${path}.scope`, 'magnification', 1),
      zeroRange: num(s, `${path}.scope`, 'zeroRange', 1),
      reticle: oneOf(str(s, `${path}.scope`, 'reticle'), RETICLES, `${path}.scope.reticle`),
    };
  }

  return {
    id,
    name: loc(raw, path, 'name'),
    faction,
    class: cls,
    caliber: str(raw, path, 'caliber'),
    ammoType: str(raw, path, 'ammoType'),
    muzzleVelocity: num(raw, path, 'muzzleVelocity', 1),
    dragK: num(raw, path, 'dragK', 0),
    gravityScale: num(raw, path, 'gravityScale', 0),
    damage,
    penetration: num(raw, path, 'penetration', 0),
    fireModes,
    rpm: num(raw, path, 'rpm', 1),
    feed,
    capacity: num(raw, path, 'capacity', 1),
    reloadTactical: num(raw, path, 'reloadTactical', 0),
    reloadEmpty: num(raw, path, 'reloadEmpty', 0),
    reloadPerRound: num(raw, path, 'reloadPerRound', 0),
    weight: num(raw, path, 'weight', 0.1),
    length: num(raw, path, 'length', 0.05),
    adsTime: num(raw, path, 'adsTime', 0.01),
    drawTime: num(raw, path, 'drawTime', 0.01),
    holsterTime: num(raw, path, 'holsterTime', 0.01),
    recoil,
    spread,
    bipod,
    heat,
    scope,
    sockets: strArr(raw, path, 'sockets'),
    audio,
    viewmodel,
    tracerEvery: num(raw, path, 'tracerEvery', 0),
    years: pair(raw, path, 'years'),
    notes: str(raw, path, 'notes'),
    source: str(raw, path, 'source'),
  };
}

export function validateAmmo(raw: unknown, path: string): AmmoData {
  const tracer = opt(raw, 'tracerColor');
  return {
    id: str(raw, path, 'id'),
    name: loc(raw, path, 'name'),
    caliber: str(raw, path, 'caliber'),
    mass: num(raw, path, 'mass', 0.1),
    velocity: num(raw, path, 'velocity', 1),
    bc: num(raw, path, 'bc', 0.01),
    tracerColor: typeof tracer === 'string' ? tracer : undefined,
    notes: str(raw, path, 'notes'),
  };
}

export function validateAttachment(raw: unknown, path: string): AttachmentData {
  const modsRaw = opt(raw, 'mods');
  const mods: AttachmentMods = {};
  if (modsRaw && typeof modsRaw === 'object') {
    const keys: (keyof AttachmentMods)[] = [
      'adsTime', 'recoilVertical', 'recoilHorizontal', 'spreadAds', 'spreadHip', 'weight', 'drawTime',
    ];
    for (const k of keys) {
      const v = (modsRaw as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v)) mods[k] = v;
    }
  }

  let scope: ScopeData | undefined;
  const s = opt(raw, 'scope');
  if (s) {
    scope = {
      magnification: num(s, `${path}.scope`, 'magnification', 1),
      zeroRange: num(s, `${path}.scope`, 'zeroRange', 1),
      reticle: oneOf(str(s, `${path}.scope`, 'reticle'), RETICLES, `${path}.scope.reticle`),
    };
  }

  return {
    id: str(raw, path, 'id'),
    name: loc(raw, path, 'name'),
    socket: str(raw, path, 'socket'),
    fits: strArr(raw, path, 'fits'),
    mods,
    scope,
    mesh: str(raw, path, 'mesh'),
    years: pair(raw, path, 'years'),
    notes: str(raw, path, 'notes'),
  };
}

export function validateCharacter(raw: unknown, path: string): CharacterData {
  const sp = req(raw, path, 'speeds');
  const va = req(raw, path, 'variation');
  return {
    id: str(raw, path, 'id'),
    name: loc(raw, path, 'name'),
    faction: oneOf(str(raw, path, 'faction'), FACTIONS, `${path}.faction`),
    role: oneOf(str(raw, path, 'role'), ROLES, `${path}.role`),
    speeds: {
      walk: num(sp, `${path}.speeds`, 'walk', 0.1),
      sprint: num(sp, `${path}.speeds`, 'sprint', 0.1),
      crouch: num(sp, `${path}.speeds`, 'crouch', 0.1),
      prone: num(sp, `${path}.speeds`, 'prone', 0.1),
    },
    health: num(raw, path, 'health', 1),
    loadout: strArr(raw, path, 'loadout'),
    variation: {
      face: num(va, `${path}.variation`, 'face', 0),
      hair: num(va, `${path}.variation`, 'hair', 0),
      build: num(va, `${path}.variation`, 'build', 0),
      height: num(va, `${path}.variation`, 'height', 0),
    },
    uniform: str(raw, path, 'uniform'),
    headgear: str(raw, path, 'headgear'),
    notes: str(raw, path, 'notes'),
  };
}

export function validateMap(raw: unknown, path: string): MapData {
  const layers: MapLayer[] = arr(raw, path, 'layers', 1).map((l, i) => ({
    texture: str(l, `${path}.layers[${i}]`, 'texture'),
    tile: num(l, `${path}.layers[${i}]`, 'tile', 0.1),
    slopeMin: num(l, `${path}.layers[${i}]`, 'slopeMin', 0, 1),
    slopeMax: num(l, `${path}.layers[${i}]`, 'slopeMax', 0, 1),
    heightMin: num(l, `${path}.layers[${i}]`, 'heightMin'),
    heightMax: num(l, `${path}.layers[${i}]`, 'heightMax'),
  }));

  const buildings = arr(raw, path, 'buildings').map((b, i) => ({
    type: str(b, `${path}.buildings[${i}]`, 'type'),
    x: num(b, `${path}.buildings[${i}]`, 'x'),
    z: num(b, `${path}.buildings[${i}]`, 'z'),
    rot: num(b, `${path}.buildings[${i}]`, 'rot'),
    scale: num(b, `${path}.buildings[${i}]`, 'scale', 0.1),
  }));

  const trenches = arr(raw, path, 'trenches').map((t, i) => ({
    points: arr(t, `${path}.trenches[${i}]`, 'points', 2).map((p, j) =>
      point2(p, `${path}.trenches[${i}].points[${j}]`)),
    width: num(t, `${path}.trenches[${i}]`, 'width', 0.5),
    depth: num(t, `${path}.trenches[${i}]`, 'depth', 0.2),
  }));

  const props = arr(raw, path, 'props').map((p, i) => ({
    type: str(p, `${path}.props[${i}]`, 'type'),
    x: num(p, `${path}.props[${i}]`, 'x'),
    z: num(p, `${path}.props[${i}]`, 'z'),
    rot: num(p, `${path}.props[${i}]`, 'rot'),
  }));

  const spawns = arr(raw, path, 'spawns', 1).map((s, i) => ({
    faction: oneOf(str(s, `${path}.spawns[${i}]`, 'faction'), FACTIONS, `${path}.spawns[${i}].faction`),
    points: arr(s, `${path}.spawns[${i}]`, 'points').map((p, j) =>
      point2(p, `${path}.spawns[${i}].points[${j}]`)),
  }));

  const objectives = arr(raw, path, 'objectives').map((o, i) => ({
    id: str(o, `${path}.objectives[${i}]`, 'id'),
    name: loc(o, `${path}.objectives[${i}]`, 'name'),
    x: num(o, `${path}.objectives[${i}]`, 'x'),
    z: num(o, `${path}.objectives[${i}]`, 'z'),
    radius: num(o, `${path}.objectives[${i}]`, 'radius', 1),
  }));

  return {
    id: str(raw, path, 'id'),
    name: loc(raw, path, 'name'),
    size: num(raw, path, 'size', 50),
    resolution: num(raw, path, 'resolution', 16),
    seed: num(raw, path, 'seed'),
    layers,
    buildings,
    trenches,
    props,
    spawns,
    objectives,
    weather: oneOf(str(raw, path, 'weather'), WEATHERS, `${path}.weather`),
    timeOfDay: num(raw, path, 'timeOfDay', 0, 24),
    notes: str(raw, path, 'notes'),
  };
}

export function validateMission(raw: unknown, path: string): MissionData {
  const objectives = arr(raw, path, 'objectives', 1).map((o, i) => ({
    id: str(o, `${path}.objectives[${i}]`, 'id'),
    text: loc(o, `${path}.objectives[${i}]`, 'text'),
    type: oneOf(str(o, `${path}.objectives[${i}]`, 'type'), OBJ_TYPES, `${path}.objectives[${i}].type`),
    target: str(o, `${path}.objectives[${i}]`, 'target'),
    count: num(o, `${path}.objectives[${i}]`, 'count', 0),
  }));

  return {
    id: str(raw, path, 'id'),
    name: loc(raw, path, 'name'),
    map: str(raw, path, 'map'),
    mode: oneOf(str(raw, path, 'mode'), MODES, `${path}.mode`),
    faction: oneOf(str(raw, path, 'faction'), FACTIONS, `${path}.faction`),
    briefing: loc(raw, path, 'briefing'),
    objectives,
    enemyCount: num(raw, path, 'enemyCount', 0),
    allyCount: num(raw, path, 'allyCount', 0),
    difficulty: oneOf(str(raw, path, 'difficulty'), DIFFICULTIES, `${path}.difficulty`),
    timeLimit: num(raw, path, 'timeLimit', 0),
    notes: str(raw, path, 'notes'),
  };
}

/** Cross-reference check: every id a record points at must exist. */
export function crossValidate(data: GameData): void {
  for (const [id, w] of data.weapons) {
    if (!data.ammo.has(w.ammoType)) {
      throw new DataError(`weapons.${id}.ammoType`, `unknown ammo "${w.ammoType}"`);
    }
  }
  for (const [id, a] of data.attachments) {
    for (const w of a.fits) {
      if (!data.weapons.has(w)) throw new DataError(`attachments.${id}.fits`, `unknown weapon "${w}"`);
    }
  }
  for (const [id, c] of data.characters) {
    for (const w of c.loadout) {
      if (!data.weapons.has(w)) throw new DataError(`characters.${id}.loadout`, `unknown weapon "${w}"`);
    }
  }
  for (const [id, m] of data.missions) {
    if (!data.maps.has(m.map)) throw new DataError(`missions.${id}.map`, `unknown map "${m.map}"`);
  }
}
