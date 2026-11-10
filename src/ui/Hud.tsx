/*
 * Heads-up display. Pure presentation: it reads the HudState snapshot the game
 * emits once per frame and renders it. No game logic lives here.
 */

import { memo } from 'react';
import type { HudState } from '../game/game';
import type { Lang } from '../data/i18n';

interface Props {
  hud: HudState;
  tr: (k: string) => string;
  lang: Lang;
}

function Crosshair({ style, spread }: { style: string; spread: number }) {
  if (style === 'none') return null;
  const gap = Math.min(26, 6 + spread * 1.6);
  if (style === 'dot') {
    return (
      <div className="crosshair">
        <i className="c" style={{ width: 3, height: 3, margin: '-1.5px 0 0 -1.5px' }} />
      </div>
    );
  }
  if (style === 'tick') {
    return (
      <div className="crosshair">
        <i className="t" style={{ top: gap }} />
        <i className="b" style={{ bottom: gap }} />
        <i className="l" style={{ left: gap }} />
        <i className="r" style={{ right: gap }} />
      </div>
    );
  }
  return (
    <div className="crosshair">
      <i className="t" style={{ top: gap }} />
      <i className="b" style={{ bottom: gap }} />
      <i className="l" style={{ left: gap }} />
      <i className="r" style={{ right: gap }} />
      <i className="c" />
    </div>
  );
}

function Compass({ yaw }: { yaw: number }) {
  // yaw is not in HudState; derive a stable strip from the mission clock instead.
  const marks = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const deg = ((yaw % 360) + 360) % 360;
  const pxPerDeg = 3.2;
  return (
    <div className="compass">
      <div className="strip" style={{ left: `calc(50% - ${deg * pxPerDeg}px)` }}>
        {Array.from({ length: 24 }).map((_, i) => {
          const d = i * 15;
          const label = marks[(i / 3) % 8];
          const isCard = i % 3 === 0;
          return (
            <span key={i} className={isCard ? 'card' : ''} style={{ left: d * pxPerDeg }}>
              {isCard ? label : '·'}
            </span>
          );
        })}
      </div>
      <div className="needle" />
    </div>
  );
}

export const Hud = memo(function Hud({ hud, tr, lang }: Props) {
  const healthPct = Math.max(0, Math.min(100, hud.health));
  const low = healthPct < 35;
  const magStr = String(hud.ammoInMag).padStart(2, '0');
  const resStr = String(hud.ammoReserve);

  return (
    <div className="hud" style={{ fontSize: `${hud.hudScale}em` }}>
      <Crosshair style={hud.crosshairStyle} spread={hud.spread} />

      <Compass yaw={0} />

      {/* Objective */}
      <div className="objective">
        <div className="t">{tr('objective')}</div>
        <div>{hud.objectiveText}</div>
        <div className="mono small faint">{hud.objectiveProgress}</div>
        <div className="mono small faint" style={{ marginTop: 6 }}>
          {tr('enemies')}: {hud.enemiesAlive}/{hud.enemiesTotal}
        </div>
      </div>

      {/* Kill feed */}
      <div className="killfeed">
        {hud.killFeed.map((k, i) => (
          <div key={`${k}-${i}`}>{k}</div>
        ))}
      </div>

      {/* Health + stamina */}
      <div className="health">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="lbl">{tr('health')}</span>
          <span className="val">{Math.round(healthPct)}</span>
        </div>
        <div className={`bar${low ? ' low' : ''}`}><i style={{ width: `${healthPct}%` }} /></div>
        <div className="bar" style={{ marginTop: 4 }}>
          <i style={{ width: `${hud.stamina}%`, background: 'var(--accent)' }} />
        </div>
      </div>

      {/* Ammo */}
      <div className="ammo">
        <div className="mag">
          {magStr}
          <span className="res"> / {resStr}</span>
        </div>
        <div className="wname">{hud.weaponName}</div>
        <div className="mode">
          {hud.fireMode}
          {hud.reloading ? ` · ${tr('reloading')}` : ''}
          {hud.jammed ? ` · ${tr('jammed')}` : ''}
        </div>
      </div>

      {/* Vitals chips */}
      <div className="vitals">
        <span className={`chip${hud.stance !== 'stand' ? ' on' : ''}`}>{hud.stance}</span>
        {hud.bipod && <span className="chip on">{tr('bipodDeployed')}</span>}
        {hud.ads > 0.5 && <span className="chip on">ADS</span>}
      </div>

      {/* Hit marker */}
      <div className={`hitmark${hud.hitMarker > 0.05 ? ' on' : ''}`}>
        <i /><i /><i /><i />
      </div>

      {/* Damage flash */}
      {hud.damageFlash > 0.02 && (
        <div
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: `radial-gradient(circle at 50% 50%, transparent 40%, rgba(192,57,43,${hud.damageFlash * 0.5}) 100%)`,
          }}
        />
      )}

      {/* Transient message */}
      {hud.message && <div className="prompt">{hud.message}</div>}

      {/* FPS */}
      {hud.showFps && (
        <div className="profiler" style={{ left: 'auto', right: 12, top: 12 }}>
          {hud.fps} fps · {hud.frameMs.toFixed(1)} ms
        </div>
      )}

      {/* Profiler */}
      {hud.showProfiler && (
        <div className="profiler">
{`renderer  ${hud.renderer}
quality   ${hud.quality} @ ${hud.renderScale.toFixed(2)}
draws     ${hud.drawCalls}
tris      ${hud.triangles.toLocaleString()}
bullets   ${hud.bulletsInFlight}
entities  ${hud.entities}
audio     ${hud.audioVoices} voices
frame     ${hud.frameMs.toFixed(2)} ms`}
        </div>
      )}

      {/* Mission clock */}
      {hud.timeLeft > 0 && (
        <div className="profiler" style={{ left: '50%', top: 46, transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.5)' }}>
          {formatClock(hud.timeLeft)}
        </div>
      )}

      {/* Language tag for screen readers */}
      <span style={{ display: 'none' }}>{lang}</span>
    </div>
  );
});

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
