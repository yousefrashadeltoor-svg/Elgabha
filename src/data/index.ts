/*
 * Data loader. Imports every JSON file, validates it, cross-references it, and
 * returns an immutable GameData. Throws DataError on the first problem.
 */

import type { GameData } from './schema';
import {
  crossValidate, validateAmmo, validateAttachment, validateCharacter,
  validateMap, validateMission, validateWeapon,
} from './validate';

import weaponsRaw from './weapons.json';
import ammoRaw from './ammo.json';
import attachmentsRaw from './attachments.json';
import charactersRaw from './characters.json';
import mapsRaw from './maps.json';
import missionsRaw from './missions.json';

let cached: GameData | null = null;

export function loadGameData(): GameData {
  if (cached) return cached;

  const weapons = new Map();
  (weaponsRaw as unknown[]).forEach((w, i) => {
    const v = validateWeapon(w, `weapons[${i}]`);
    if (weapons.has(v.id)) throw new Error(`duplicate weapon id ${v.id}`);
    weapons.set(v.id, v);
  });

  const ammo = new Map();
  (ammoRaw as unknown[]).forEach((a, i) => {
    const v = validateAmmo(a, `ammo[${i}]`);
    if (ammo.has(v.id)) throw new Error(`duplicate ammo id ${v.id}`);
    ammo.set(v.id, v);
  });

  const attachments = new Map();
  (attachmentsRaw as unknown[]).forEach((a, i) => {
    const v = validateAttachment(a, `attachments[${i}]`);
    if (attachments.has(v.id)) throw new Error(`duplicate attachment id ${v.id}`);
    attachments.set(v.id, v);
  });

  const characters = new Map();
  (charactersRaw as unknown[]).forEach((c, i) => {
    const v = validateCharacter(c, `characters[${i}]`);
    if (characters.has(v.id)) throw new Error(`duplicate character id ${v.id}`);
    characters.set(v.id, v);
  });

  const maps = new Map();
  (mapsRaw as unknown[]).forEach((m, i) => {
    const v = validateMap(m, `maps[${i}]`);
    if (maps.has(v.id)) throw new Error(`duplicate map id ${v.id}`);
    maps.set(v.id, v);
  });

  const missions = new Map();
  (missionsRaw as unknown[]).forEach((m, i) => {
    const v = validateMission(m, `missions[${i}]`);
    if (missions.has(v.id)) throw new Error(`duplicate mission id ${v.id}`);
    missions.set(v.id, v);
  });

  const data: GameData = { weapons, ammo, attachments, characters, maps, missions };
  crossValidate(data);
  cached = data;
  return data;
}

/** Weapons a player can select in the training range, grouped for the UI. */
export function weaponsByFaction(data: GameData, faction: 'soviet' | 'german' | 'shared') {
  return [...data.weapons.values()].filter((w) => w.faction === faction);
}

export function attachmentsForWeapon(data: GameData, weaponId: string) {
  const w = data.weapons.get(weaponId);
  if (!w) return [];
  return [...data.attachments.values()].filter(
    (a) => w.sockets.includes(a.socket) && (a.fits.length === 0 || a.fits.includes(weaponId)),
  );
}
