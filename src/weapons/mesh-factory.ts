/*
 * Mesh factory for weapons: procedural low-poly WW2 weapons built from
 * primitives (ADR-005). Each weapon gets a recognisable silhouette from:
 * barrel + receiver + stock + magazine + sights, plus attachment mounts.
 * The result is a single THREE.Group used by the viewmodel.
 */

import * as THREE from 'three';
import type { WeaponData } from '../data/schema';

const WOOD = 0x5a442c;
const STEEL = 0x3a3f46;
const DARK = 0x2b2e33;
const BRASS = 0xa3935a;

export function buildWeaponMesh(w: WeaponData): THREE.Group {
  const g = new THREE.Group();
  // MeshLambertMaterial is used for the viewmodel: it responds to the rig's
  // dedicated lights but needs no environment map, so the weapon reads as wood
  // and steel instead of a black silhouette. Metalness on a standard material
  // with no envMap is what made it look unlit.
  const wood = new THREE.MeshLambertMaterial({ color: WOOD });
  const steel = new THREE.MeshLambertMaterial({ color: STEEL });
  const dark = new THREE.MeshLambertMaterial({ color: DARK });
  const brass = new THREE.MeshLambertMaterial({ color: BRASS });

  const mk = (
    geo: THREE.BufferGeometry, mat: THREE.Material,
    x: number, y: number, z: number, rx = 0, ry = 0, rz = 0,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };

  const len = w.length ?? 1.1;

  switch (w.class) {
    case 'rifle':
    case 'sniper': {
      const isSniper = w.class === 'sniper';
      // barrel
      mk(new THREE.CylinderGeometry(0.012, 0.012, len * 0.55, 10).rotateX(Math.PI / 2), steel, 0, 0.01, -len * 0.55 / 2);
      // receiver
      mk(new THREE.BoxGeometry(0.045, 0.05, len * 0.34), steel, 0, 0.02, len * 0.12);
      // stock
      mk(new THREE.BoxGeometry(0.04, 0.09, len * 0.3), wood, 0, 0.005, len * 0.28);
      // forestock
      mk(new THREE.BoxGeometry(0.038, 0.045, len * 0.22), wood, 0, 0, -len * 0.12);
      // bolt handle (sniper)
      if (isSniper) mk(new THREE.CylinderGeometry(0.008, 0.008, 0.04, 6).rotateZ(Math.PI / 2), dark, 0.04, 0.075, len * 0.17);
      // magazine
      mk(new THREE.BoxGeometry(0.03, 0.06, 0.05), dark, 0, -0.04, 0.06);
      // front sight blade
      mk(new THREE.BoxGeometry(0.006, 0.02, 0.01), dark, 0, 0.045, -len * 0.40);
      // rear sight + mount
      mk(new THREE.BoxGeometry(0.02, 0.014, 0.012), dark, 0, 0.045, len * 0.14);
      if (isSniper) {
        // scope
        const scope = mk(new THREE.CylinderGeometry(0.016, 0.016, len * 0.18, 10).rotateX(Math.PI / 2), dark, 0, 0.085, len * 0.05);
        void scope;
      }
      break;
    }
    case 'smg': {
      mk(new THREE.CylinderGeometry(0.011, 0.011, len * 0.5, 8).rotateX(Math.PI / 2), steel, 0, 0.01, -len * 0.5 / 2);
      mk(new THREE.BoxGeometry(0.04, 0.045, len * 0.3), steel, 0, 0.02, len * 0.1);
      // stock (folding / wire)
      mk(new THREE.BoxGeometry(0.03, 0.03, len * 0.28), dark, 0, 0.045, len * 0.26);
      // mag angled forward
      const mag = mk(new THREE.BoxGeometry(0.025, 0.12, 0.045), dark, 0, -0.05, len * 0.02);
      mag.rotation.x = 0.5;
      // stubby front grip
      mk(new THREE.BoxGeometry(0.03, 0.08, 0.03), dark, 0, -0.02, -len * 0.26);
      break;
    }
    case 'lmg':
    case 'mmg': {
      mk(new THREE.CylinderGeometry(0.014, 0.014, len * 0.62, 10).rotateX(Math.PI / 2), steel, 0, 0.02, -len * 0.62 / 2);
      // receiver (long, boxy)
      mk(new THREE.BoxGeometry(0.05, 0.06, len * 0.34), steel, 0, 0.03, len * 0.12);
      // cooling jacket suggestion
      mk(new THREE.CylinderGeometry(0.022, 0.022, len * 0.5, 12).rotateX(Math.PI / 2), dark, 0, 0.02, -len * 0.52 / 2);
      // belt feed tray
      mk(new THREE.BoxGeometry(0.06, 0.022, 0.05), dark, 0, 0.075, len * 0.02);
      // bipod
      const bipod = mk(new THREE.BoxGeometry(0.008, 0.16, 0.008), dark, -0.02, -0.06, -len * 0.2);
      bipod.rotation.x = -0.7;
      const bipod2 = mk(new THREE.BoxGeometry(0.008, 0.16, 0.008), dark, 0.02, -0.06, -len * 0.2);
      bipod2.rotation.x = -0.7;
      // carry handle
      mk(new THREE.BoxGeometry(0.02, 0.05, 0.02), dark, 0, 0.09, 0);
      break;
    }
    case 'pistol': {
      mk(new THREE.BoxGeometry(0.028, 0.045, len * 0.5), steel, 0, 0.01, -len * 0.15);
      mk(new THREE.BoxGeometry(0.026, 0.06, 0.04), dark, 0, -0.02, -len * 0.06);
      mk(new THREE.BoxGeometry(0.024, 0.05, 0.024), dark, 0, -0.04, -len * 0.1);
      break;
    }
    default:
      mk(new THREE.CylinderGeometry(0.013, 0.013, len * 0.55, 10).rotateX(Math.PI / 2), steel, 0, 0.01, -len * 0.55 / 2);
      mk(new THREE.BoxGeometry(0.045, 0.05, len * 0.3), wood, 0, 0.02, len * 0.12);
      break;
  }

  // Primary finish: subtle vertical gradient via cloned roughness — cheap.
  return g;
}

export function disposeWeaponMesh(g: THREE.Group): void {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | undefined;
    mat?.dispose();
  });
}
