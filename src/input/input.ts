/*
 * Input system: keyboard, mouse (pointer lock), gamepad, touch joystick,
 * and gyroscope. Produces a plain Intent struct every frame; the simulation
 * consumes intents only (deterministic contract for future netcode).
 */

import type { ControlsSettings } from '../settings/settings';

export type KeyAction =
  | 'forward' | 'back' | 'left' | 'right'
  | 'fire' | 'aim' | 'reload' | 'jump' | 'crouch' | 'prone' | 'sprint'
  | 'bipod' | 'weapon1' | 'weapon2' | 'melee' | 'inventory' | 'pause' | 'holdBreath' | 'walk';

export const DEFAULT_BINDS: Record<KeyAction, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  fire: 'Mouse0', aim: 'Mouse2', reload: 'KeyR', jump: 'Space',
  crouch: 'ControlLeft', prone: 'KeyX', sprint: 'ShiftLeft', bipod: 'KeyF',
  weapon1: 'Digit1', weapon2: 'Digit2', melee: 'KeyV', inventory: 'Tab',
  pause: 'Escape', holdBreath: 'ShiftLeft', walk: 'KeyCapsLock',
};

export function isMouseBind(code: string): boolean {
  return code.startsWith('Mouse');
}

export interface Intent {
  moveX: number;   // -1..1 (strafe)
  moveY: number;   // -1..1 (forward positive)
  lookX: number;
  lookY: number;
  fire: boolean;
  firePressed: boolean;
  aim: boolean;
  aimPressed: boolean;
  reloadPressed: boolean;
  jumpPressed: boolean;
  crouch: boolean;
  prone: boolean;
  sprint: boolean;
  walk: boolean;
  bipodPressed: boolean;
  meleePressed: boolean;
  inventoryPressed: boolean;
  pausePressed: boolean;
  holdBreath: boolean;
  switchWeapon: number; // -1 prev, +1 next, 0 none
}

export function emptyIntent(): Intent {
  return {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0,
    fire: false, firePressed: false, aim: false, aimPressed: false,
    reloadPressed: false, jumpPressed: false, crouch: false, prone: false,
    sprint: false, walk: false, bipodPressed: false, meleePressed: false,
    inventoryPressed: false, pausePressed: false, holdBreath: false, switchWeapon: 0,
  };
}

export class InputManager {
  private keys = new Set<string>();
  private prevKeys = new Set<string>();
  private pointerLocked = false;
  private lookX = 0;
  private lookY = 0;
  private switchWheel = 0;
  readonly binds: Record<KeyAction, string> = { ...DEFAULT_BINDS };
  private canvas: HTMLCanvasElement | null = null;

  /** Touch state (set by the TouchControls React component). */
  touchMoveX = 0;
  touchMoveY = 0;
  touchLookX = 0;
  touchLookY = 0;
  touchFire = false;
  touchAim = false;
  touchReloadPressed = false;
  touchSprint = false;
  touchCrouch = false;
  touchProne = false;

  /** Gyro look delta in degrees (fed every frame when active). */
  gyroLookX = 0;
  gyroLookY = 0;

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === this.binds.pause) e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.lookX += e.movementX;
    this.lookY += e.movementY;
  };
  private onMouseDown = (e: MouseEvent): void => {
    if (this.pointerLocked) this.keys.add(`Mouse${e.button}`);
  };
  private onMouseUp = (e: MouseEvent): void => {
    this.keys.delete(`Mouse${e.button}`);
  };
  private onLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (!this.pointerLocked) this.keys.clear();
  };
  private onWheel = (e: WheelEvent): void => {
    this.switchWheel += Math.sign(e.deltaY);
  };
  private onBlur = (): void => {
    this.keys.clear();
  };

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas?.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.canvas = null;
  }

  requestPointerLock(): void {
    this.canvas?.requestPointerLock();
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  isDown(action: KeyAction): boolean {
    return this.keys.has(this.binds[action]);
  }

  rebind(action: KeyAction, code: string): boolean {
    // Reject bindings that would collide with movement-critical keys (except mouse).
    for (const [a, c] of Object.entries(this.binds)) {
      if (a !== action && c === code && !isMouseBind(code)) return false;
    }
    this.binds[action] = code;
    return true;
  }

  pausePressed(): boolean {
    return this.keys.has(this.binds.pause);
  }

  consumeFrame(controls: ControlsSettings, scale = 1): Intent {
    const it = emptyIntent();
    const k = this.keys;
    const prev = this.prevKeys;
    const pressed = (a: KeyAction): boolean => k.has(this.binds[a]);
    const justPressed = (a: KeyAction): boolean => pressed(a) && !prev.has(this.binds[a]);

    const fwd = (pressed('forward') ? 1 : 0) - (pressed('back') ? 1 : 0);
    const strafe = (pressed('right') ? 1 : 0) - (pressed('left') ? 1 : 0);
    it.moveX = strafe;
    it.moveY = fwd;
    if (Math.abs(this.touchMoveX) > 0.15 || Math.abs(this.touchMoveY) > 0.15) {
      it.moveX = this.touchMoveX;
      it.moveY = -this.touchMoveY;
    }
    it.fire = pressed('fire') || this.touchFire;
    it.firePressed = justPressed('fire');
    it.aim = pressed('aim') || this.touchAim;
    it.aimPressed = justPressed('aim');
    it.reloadPressed = justPressed('reload') || this.touchReloadPressed;
    this.touchReloadPressed = false;
    it.jumpPressed = justPressed('jump');
    it.crouch = pressed('crouch') || this.touchCrouch;
    it.prone = pressed('prone') || this.touchProne;
    it.sprint = pressed('sprint') || this.touchSprint;
    it.walk = pressed('walk');
    it.bipodPressed = justPressed('bipod');
    it.meleePressed = justPressed('melee');
    it.inventoryPressed = justPressed('inventory');
    it.pausePressed = justPressed('pause');
    it.holdBreath = pressed('holdBreath');

    if (pressed('weapon1')) this.switchWheel += 100;
    if (pressed('weapon2')) this.switchWheel -= 100;
    it.switchWeapon = this.switchWheel;
    this.switchWheel = 0;

    const mouse = this.lookX;
    const mouseY = this.lookY;
    this.lookX = 0;
    this.lookY = 0;

    const gx = this.gyroLookX;
    const gy = this.gyroLookY;
    this.gyroLookX = 0;
    this.gyroLookY = 0;

    it.lookX = (mouse + this.touchLookX + gx) * scale;
    it.lookY = (mouseY + this.touchLookY + gy) * scale * (controls.invertY ? -1 : 1);
    this.touchLookX = 0;
    this.touchLookY = 0;

    this.prevKeys = new Set(k);
    return it;
  }

  rebindState(): void {
    this.prevKeys = new Set(this.keys);
  }
}
