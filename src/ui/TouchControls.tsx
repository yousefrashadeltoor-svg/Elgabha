/*
 * Touch controls. Rendered only on touch-capable devices. Writes directly into
 * the InputManager's touch fields (the same Intent contract the keyboard uses),
 * so the simulation never knows which device produced the input.
 *
 * Layouts: twoThumb | threeFinger | fourFinger | claw
 * Gyro: off | ads | always (DeviceOrientation, permission-gated on iOS).
 */

import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../settings/settings';
import type { Game } from '../game/game';

interface Props {
  settings: Settings;
  game: React.MutableRefObject<Game | null>;
}

export function TouchControls({ settings, game }: Props) {
  const [isTouch, setIsTouch] = useState(false);
  const [gyroOn, setGyroOn] = useState(false);
  const stickRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const lookRef = useRef<HTMLDivElement | null>(null);
  const activeStick = useRef<number | null>(null);
  const activeLook = useRef<number | null>(null);
  const lastLook = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const gyroPrev = useRef<{ beta: number; gamma: number } | null>(null);

  useEffect(() => {
    setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  // Gyro: feed deltas into the input manager each frame.
  useEffect(() => {
    if (!isTouch || settings.touch.gyro === 'off') return;
    let raf = 0;
    const onOrient = (e: DeviceOrientationEvent) => {
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      const prev = gyroPrev.current;
      if (prev) {
        const dx = (gamma - prev.gamma) * settings.touch.gyroSensitivity;
        const dy = (beta - prev.beta) * settings.touch.gyroSensitivity;
        const s = 1 - settings.touch.gyroSmoothing;
        const input = (game.current as unknown as { input?: { gyroLookX: number; gyroLookY: number } } | null)?.input;
        if (input) {
          input.gyroLookX += dx * s;
          input.gyroLookY += dy * s;
        }
      }
      gyroPrev.current = { beta, gamma };
    };
    window.addEventListener('deviceorientation', onOrient);
    return () => {
      window.removeEventListener('deviceorientation', onOrient);
      cancelAnimationFrame(raf);
    };
  }, [isTouch, settings.touch.gyro, settings.touch.gyroSensitivity, settings.touch.gyroSmoothing, game]);

  const requestGyro = async () => {
    const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (D?.requestPermission) {
      try {
        const res = await D.requestPermission();
        setGyroOn(res === 'granted');
      } catch {
        setGyroOn(false);
      }
    } else {
      setGyroOn(true);
    }
  };

  if (!isTouch) return null;

  const size = 96 * settings.touch.buttonSize;
  const opacity = settings.touch.buttonOpacity;

  const input = () => (game.current as unknown as { input?: Record<string, unknown> } | null)?.input;

  const onStickStart = (e: React.PointerEvent) => {
    activeStick.current = e.pointerId;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    moveStick(e);
  };
  const moveStick = (e: React.PointerEvent) => {
    if (activeStick.current !== e.pointerId || !stickRef.current) return;
    const r = stickRef.current.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2);
    let dy = (e.clientY - cy) / (r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const inp = input();
    if (inp) {
      inp.touchMoveX = dx;
      inp.touchMoveY = dy;
    }
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(${dx * 34}%, ${dy * 34}%)`;
    }
  };
  const onStickEnd = (e: React.PointerEvent) => {
    if (activeStick.current !== e.pointerId) return;
    activeStick.current = null;
    const inp = input();
    if (inp) { inp.touchMoveX = 0; inp.touchMoveY = 0; }
    if (knobRef.current) knobRef.current.style.transform = 'translate(0,0)';
  };

  const onLookStart = (e: React.PointerEvent) => {
    activeLook.current = e.pointerId;
    lastLook.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onLookMove = (e: React.PointerEvent) => {
    if (activeLook.current !== e.pointerId) return;
    const dx = e.clientX - lastLook.current.x;
    const dy = e.clientY - lastLook.current.y;
    lastLook.current = { x: e.clientX, y: e.clientY };
    const inp = input();
    if (inp) {
      inp.touchLookX = (inp.touchLookX as number) + dx;
      inp.touchLookY = (inp.touchLookY as number) + dy;
    }
  };
  const onLookEnd = (e: React.PointerEvent) => {
    if (activeLook.current === e.pointerId) activeLook.current = null;
  };

  const hold = (field: string, value: boolean) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      const inp = input();
      if (inp) inp[field] = value;
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      const inp = input();
      if (inp) inp[field] = false;
    },
    onPointerCancel: () => {
      const inp = input();
      if (inp) inp[field] = false;
    },
  });

  const tap = (field: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      const inp = input();
      if (inp) inp[field] = true;
    },
  });

  const showReload = settings.touch.layout !== 'twoThumb';
  const showProne = settings.touch.layout === 'fourFinger' || settings.touch.layout === 'claw';

  return (
    <div className="touch">
      {/* Look zone (right half) */}
      <div
        ref={lookRef}
        className="lookzone"
        style={{ left: '40%' }}
        onPointerDown={onLookStart}
        onPointerMove={onLookMove}
        onPointerUp={onLookEnd}
        onPointerCancel={onLookEnd}
      />

      {/* Movement stick */}
      <div
        ref={stickRef}
        className="stick"
        style={{ left: 24, bottom: 24, width: size * 1.4, height: size * 1.4, opacity }}
        onPointerDown={onStickStart}
        onPointerMove={moveStick}
        onPointerUp={onStickEnd}
        onPointerCancel={onStickEnd}
      >
        <div ref={knobRef} className="knob" />
      </div>

      {/* Fire */}
      <div
        className="tc"
        style={{ right: 24, bottom: 30, width: size, height: size, opacity }}
        {...hold('touchFire', true)}
      >Fire</div>

      {/* Aim */}
      <div
        className="tc"
        style={{ right: 24 + size + 12, bottom: 30, width: size * 0.8, height: size * 0.8, opacity }}
        {...hold('touchAim', true)}
      >Aim</div>

      {/* Reload */}
      {showReload && (
        <div
          className="tc sq"
          style={{ right: 24, bottom: 30 + size + 12, width: size * 0.7, height: size * 0.7, opacity }}
          {...tap('touchReloadPressed')}
        >R</div>
      )}

      {/* Sprint */}
      <div
        className="tc sq"
        style={{ left: 24 + size * 1.4 + 12, bottom: 24, width: size * 0.7, height: size * 0.7, opacity }}
        {...hold('touchSprint', true)}
      >Run</div>

      {/* Crouch */}
      <div
        className="tc sq"
        style={{ left: 24, bottom: 24 + size * 1.4 + 12, width: size * 0.7, height: size * 0.7, opacity }}
        {...hold('touchCrouch', true)}
      >Crouch</div>

      {/* Prone (advanced layouts) */}
      {showProne && (
        <div
          className="tc sq"
          style={{ left: 24 + size * 0.7 + 12, bottom: 24 + size * 1.4 + 12, width: size * 0.7, height: size * 0.7, opacity }}
          {...hold('touchProne', true)}
        >Prone</div>
      )}

      {/* Gyro permission */}
      {settings.touch.gyro !== 'off' && !gyroOn && (
        <div
          className="tc sq"
          style={{ right: 24, top: 90, width: size * 0.9, height: size * 0.6, opacity }}
          onPointerDown={(e) => { e.preventDefault(); void requestGyro(); }}
        >Gyro</div>
      )}
    </div>
  );
}
