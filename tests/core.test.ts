/*
 * Unit tests for the deterministic simulation core.
 * Run with: npm test
 */
import { describe, it, expect } from 'vitest';
import { Rng } from '../src/core/rng';
import { clamp, lerp, angleDelta, dropOverDistance, timeOfFlightDrag, speedAfterDrag, ballisticElevation } from '../src/core/math';
import { World, entityIndex, entityGeneration } from '../src/core/ecs';
import { EventBus } from '../src/core/events';
import { Pool, RingBuffer } from '../src/core/pool';
import { ValueNoise2D } from '../src/world/noise';
import { WeaponController } from '../src/weapons/weapon-controller';
import { loadGameData } from '../src/data';
import { validateWeapon, DataError } from '../src/data/validate';

describe('math', () => {
  it('clamps and lerps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it('computes the shortest angular delta across the wrap point', () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2, 6);
    // 350 deg -> 10 deg is +20 deg, not -340 deg
    const a = (350 * Math.PI) / 180;
    const b = (10 * Math.PI) / 180;
    expect(angleDelta(a, b)).toBeCloseTo((20 * Math.PI) / 180, 6);
  });

  it('drops a bullet over distance', () => {
    // 7.62x54R at 865 m/s over 500 m: t = 0.578 s, drop = 0.5*9.81*t^2 = 1.64 m
    const d = dropOverDistance(500, 865, 9.81);
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(1.8);
  });

  it('solves a ballistic elevation that actually hits', () => {
    const v = 100;
    const g = 9.81;
    const dist = 200;
    const ang = ballisticElevation(dist, 0, v, g);
    expect(Number.isFinite(ang)).toBe(true);
    // Verify by integrating: horizontal reach at that angle should be ~dist.
    const t = (2 * v * Math.sin(ang)) / g;
    const reach = v * Math.cos(ang) * t;
    expect(reach).toBeCloseTo(dist, 0);
  });

  it('models drag time of flight as slower than vacuum', () => {
    const vacuum = 500 / 800;
    const withDrag = timeOfFlightDrag(500, 800, 0.35);
    expect(withDrag).toBeGreaterThan(vacuum);
    expect(speedAfterDrag(500, 800, 0.35)).toBeLessThan(800);
  });
});

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('produces values in [0,1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('shuffles without losing elements', () => {
    const r = new Rng(3);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = r.shuffle(arr.slice());
    expect(out.slice().sort((x, y) => x - y)).toEqual(arr);
  });
});

describe('ecs', () => {
  it('creates, stores and destroys entities', () => {
    const w = new World(16);
    const store = w.store<{ hp: number }>('health', () => ({ hp: 100 }));
    const e = w.create();
    expect(w.isAlive(e)).toBe(true);
    store.add(e).hp = 50;
    expect(store.get(e)?.hp).toBe(50);
    w.destroy(e);
    expect(w.isAlive(e)).toBe(false);
    expect(store.get(e)).toBeUndefined();
  });

  it('detects stale handles after index reuse', () => {
    const w = new World(16);
    const a = w.create();
    w.destroy(a);
    const b = w.create();
    // Same index, different generation.
    expect(entityIndex(a)).toBe(entityIndex(b));
    expect(entityGeneration(a)).not.toBe(entityGeneration(b));
    expect(w.isAlive(a)).toBe(false);
    expect(w.isAlive(b)).toBe(true);
  });

  it('keeps the dense array compact after removal', () => {
    const w = new World(16);
    const store = w.store<{ v: number }>('v', () => ({ v: 0 }));
    const es = [w.create(), w.create(), w.create()];
    es.forEach((e, i) => (store.add(e).v = i));
    w.destroy(es[1]);
    expect(store.size).toBe(2);
    expect(store.get(es[0])?.v).toBe(0);
    expect(store.get(es[2])?.v).toBe(2);
  });
});

describe('events', () => {
  it('delivers to subscribers and unsubscribes', () => {
    const bus = new EventBus<{ ping: number }>();
    let got = 0;
    const off = bus.on('ping', (n) => (got += n));
    bus.emit('ping', 2);
    bus.emit('ping', 3);
    expect(got).toBe(5);
    off();
    bus.emit('ping', 10);
    expect(got).toBe(5);
  });

  it('survives a listener unsubscribing during dispatch', () => {
    const bus = new EventBus<{ x: number }>();
    let count = 0;
    const off = bus.on('x', () => {
      count++;
      off();
    });
    bus.emit('x', 1);
    bus.emit('x', 1);
    expect(count).toBe(1);
  });
});

describe('pool', () => {
  it('reuses released objects', () => {
    const p = new Pool<{ n: number }>(() => ({ n: 0 }), (o) => (o.n = 0), 2);
    const a = p.acquire();
    a.n = 9;
    p.release(a);
    const b = p.acquire();
    expect(b.n).toBe(0);
    expect(p.liveCount).toBe(1);
  });

  it('ring buffer keeps the newest entries', () => {
    const rb = new RingBuffer<number>(3, () => 0);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    rb.push(4);
    expect(rb.at(0)).toBe(4);
    expect(rb.at(2)).toBe(2);
    expect(rb.length).toBe(3);
  });
});

describe('noise', () => {
  it('is deterministic and bounded', () => {
    const a = new ValueNoise2D(42);
    const b = new ValueNoise2D(42);
    for (let i = 0; i < 50; i++) {
      const x = i * 0.37;
      const y = i * 0.11;
      expect(a.noise(x, y)).toBe(b.noise(x, y));
      const v = a.noise(x, y);
      expect(v).toBeGreaterThanOrEqual(-1.001);
      expect(v).toBeLessThanOrEqual(1.001);
    }
  });

  it('fbm stays in range', () => {
    const n = new ValueNoise2D(1);
    for (let i = 0; i < 100; i++) {
      const v = n.fbm(i * 0.05, i * 0.07, 5);
      expect(v).toBeGreaterThanOrEqual(-1.001);
      expect(v).toBeLessThanOrEqual(1.001);
    }
  });
});

describe('data validation', () => {
  it('loads and cross-references the whole dataset', () => {
    const data = loadGameData();
    expect(data.weapons.size).toBeGreaterThanOrEqual(20);
    expect(data.ammo.size).toBeGreaterThanOrEqual(8);
    expect(data.characters.size).toBeGreaterThanOrEqual(10);
    expect(data.maps.size).toBeGreaterThanOrEqual(1);
    expect(data.missions.size).toBeGreaterThanOrEqual(1);
  });

  it('every weapon references an existing ammo type', () => {
    const data = loadGameData();
    for (const w of data.weapons.values()) {
      expect(data.ammo.has(w.ammoType), `${w.id} -> ${w.ammoType}`).toBe(true);
    }
  });

  it('every character loadout references existing weapons', () => {
    const data = loadGameData();
    for (const c of data.characters.values()) {
      for (const id of c.loadout) {
        expect(data.weapons.has(id), `${c.id} -> ${id}`).toBe(true);
      }
    }
  });

  it('every mission references an existing map', () => {
    const data = loadGameData();
    for (const m of data.missions.values()) {
      expect(data.maps.has(m.map), `${m.id} -> ${m.map}`).toBe(true);
    }
  });

  it('rejects a weapon with a missing field, naming the path', () => {
    const bad = { id: 'x', name: { en: 'X', ar: 'X' }, faction: 'soviet', class: 'rifle' };
    expect(() => validateWeapon(bad, 'test')).toThrow(DataError);
    try {
      validateWeapon(bad, 'test');
    } catch (e) {
      // The validator reports the first missing field it reaches, with its path.
      expect((e as DataError).path).toMatch(/^test\./);
    }
  });

  it('rejects an unknown weapon class', () => {
    const data = loadGameData();
    const w = data.weapons.get('kar98k')!;
    const bad = { ...w, class: 'laser' };
    expect(() => validateWeapon(bad, 'test')).toThrow(/unknown value/);
  });
});

describe('weapon controller', () => {
  const data = loadGameData();
  const ammoFor = (id: string) => data.ammo.get(data.weapons.get(id)!.ammoType)!;

  it('fires a bolt-action rifle once per trigger pull', () => {
    const w = new WeaponController(data.weapons.get('kar98k')!, 50, ammoFor('kar98k'));
    const start = w.magazineLeft;
    // One pull: press for 2 frames, release, then wait out the bolt.
    let shots = 0;
    for (let i = 0; i < 2; i++) if (w.update(1 / 60, true, 0, 0, false, false)) shots++;
    for (let i = 0; i < 2; i++) w.update(1 / 60, false, 0, 0, false, false);
    for (let i = 0; i < 60; i++) w.update(1 / 60, false, 0, 0, false, false);
    expect(shots).toBe(1);
    expect(w.magazineLeft).toBe(start - 1);
  });

  it('does not fire a second round while the bolt is cycling', () => {
    const w = new WeaponController(data.weapons.get('kar98k')!, 50, ammoFor('kar98k'));
    let shots = 0;
    // Hold the trigger down continuously for 0.5 s (less than the bolt cycle).
    for (let i = 0; i < 30; i++) if (w.update(1 / 60, true, 0, 0, false, false)) shots++;
    expect(shots).toBe(1);
  });

  it('fires an SMG at its cyclic rate', () => {
    const w = new WeaponController(data.weapons.get('ppsh41')!, 200, ammoFor('ppsh41'));
    let shots = 0;
    for (let i = 0; i < 60; i++) if (w.update(1 / 60, true, 0, 0, false, false)) shots++;
    // 900 rpm = 15 rounds per second; allow +/-1 for frame boundary.
    expect(shots).toBeGreaterThanOrEqual(14);
    expect(shots).toBeLessThanOrEqual(16);
  });

  it('reloads to full capacity and draws from reserve', () => {
    const w = new WeaponController(data.weapons.get('kar98k')!, 50, ammoFor('kar98k'));
    for (let i = 0; i < 5; i++) {
      for (let i2 = 0; i2 < 2; i2++) w.update(1 / 60, true, 0, 0, false, false);
      for (let i2 = 0; i2 < 2; i2++) w.update(1 / 60, false, 0, 0, false, false);
      for (let i2 = 0; i2 < 60; i2++) w.update(1 / 60, false, 0, 0, false, false);
    }
    expect(w.magazineLeft).toBe(0);
    w.startReload();
    for (let i = 0; i < 600; i++) w.update(1 / 60, false, 0, 0, false, false);
    expect(w.magazineLeft).toBe(5);
    expect(w.reserve).toBe(45);
  });

  it('reduces spread when the bipod is deployed', () => {
    const w = new WeaponController(data.weapons.get('mg42')!, 500, ammoFor('mg42'));
    const hip = w.currentSpread(0, false, false, 0);
    w.toggleBipod();
    const deployed = w.currentSpread(0, false, false, 0);
    expect(deployed).toBeLessThan(hip);
  });

  it('accumulates heat and jams after sustained fire', () => {
    // The MG42 barrel is rated for roughly 200 rounds before it must be changed,
    // so the test fires several belts' worth and expects a jam.
    const w = new WeaponController(data.weapons.get('mg42')!, 2000, ammoFor('mg42'));
    let jammed = false;
    for (let i = 0; i < 60 * 90 && !jammed; i++) {
      // The controller never auto-reloads (that is the player's job), so the
      // test reloads whenever the belt runs dry, exactly as a gunner would.
      if (w.magazineLeft === 0 && !w.isReloading) w.startReload();
      w.update(1 / 60, true, 0, 0, false, false);
      if (w.phase === 'overheated') jammed = true;
    }
    expect(jammed).toBe(true);
    expect(w.heat).toBeGreaterThan(0.5);
  });

  it('never exceeds magazine capacity', () => {
    const w = new WeaponController(data.weapons.get('ppsh41')!, 200, ammoFor('ppsh41'));
    for (let i = 0; i < 60 * 10; i++) w.update(1 / 60, true, 0, 0, false, false);
    expect(w.magazineLeft).toBeGreaterThanOrEqual(0);
    expect(w.magazineLeft).toBeLessThanOrEqual(71);
  });
});
