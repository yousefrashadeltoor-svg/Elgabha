/*
 * Diagnostics screen. Reports the live renderer/simulation counters the game
 * emits, plus device capabilities and the event log. Everything shown here is
 * measured, never estimated.
 */

import { useMemo, useState } from 'react';
import type { HudState } from '../game/game';
import type { Settings } from '../settings/settings';

interface Props {
  tr: (k: string) => string;
  hud: HudState;
  events: string[];
  settings: Settings;
  onBack: () => void;
}

export function DiagnosticsScreen({ tr, hud, events, settings, onBack }: Props) {
  const [copied, setCopied] = useState(false);

  const device = useMemo(() => {
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; downlink?: number; rtt?: number } };
    return {
      platform: navigator.platform || 'unknown',
      cores: navigator.hardwareConcurrency ?? 0,
      memory: nav.deviceMemory ?? 0,
      touch: 'ontouchstart' in window,
      gamepad: typeof navigator.getGamepads === 'function',
      gyro: typeof (window as unknown as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent !== 'undefined',
      webAudio: typeof AudioContext !== 'undefined',
      storage: typeof localStorage !== 'undefined',
      connection: nav.connection?.effectiveType ?? 'unknown',
      downlink: nav.connection?.downlink ?? 0,
      rtt: nav.connection?.rtt ?? 0,
      screen: `${window.screen.width}×${window.screen.height}`,
      pixelRatio: window.devicePixelRatio,
      standalone: window.matchMedia('(display-mode: standalone)').matches,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
    };
  }, []);

  const report = useMemo(() => {
    return [
      `Frontline 1943 - diagnostics`,
      `renderer: ${hud.renderer}`,
      `quality: ${hud.quality} @ ${hud.renderScale.toFixed(2)}`,
      `fps: ${hud.fps} (${hud.frameMs.toFixed(2)} ms)`,
      `draw calls: ${hud.drawCalls}`,
      `triangles: ${hud.triangles}`,
      `bullets in flight: ${hud.bulletsInFlight}`,
      `entities: ${hud.entities}`,
      `audio voices: ${hud.audioVoices}`,
      `platform: ${device.platform}`,
      `cores: ${device.cores}`,
      `memory: ${device.memory} GB`,
      `screen: ${device.screen} @ ${device.pixelRatio}x`,
      `connection: ${device.connection} (${device.downlink} Mb/s, ${device.rtt} ms)`,
      `touch: ${device.touch}  gamepad: ${device.gamepad}  gyro: ${device.gyro}`,
      `web audio: ${device.webAudio}  storage: ${device.storage}`,
      `--- events ---`,
      ...events,
    ].join('\n');
  }, [hud, device, events]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'frontline-1943-diagnostics.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const budgetOk = hud.frameMs <= 16.67 * 1.25;

  return (
    <div className="screen-scroll">
      <div className="wrap" style={{ paddingTop: 30 }}>
        <div className="row">
          <button className="ghost" onClick={onBack}>{tr('back')}</button>
          <div className="spacer" />
          <h2>{tr('diagnosticsTitle')}</h2>
        </div>

        <div className="panel" style={{ marginTop: 18 }}>
          <div className="row">
            <h3>{tr('diagBudget')}</h3>
            <div className="spacer" />
            <span className={`badge ${budgetOk ? 'ok' : 'warn'}`}>
              {budgetOk ? tr('diagWithinBudget') : tr('diagOverBudget')}
            </span>
          </div>
          <div className="stat-grid" style={{ marginTop: 12 }}>
            <Stat k={tr('diagRenderer')} v={hud.renderer} />
            <Stat k={tr('diagQuality')} v={`${hud.quality} @ ${hud.renderScale.toFixed(2)}`} />
            <Stat k={tr('diagFps')} v={String(hud.fps)} acc />
            <Stat k={tr('diagFrameTime')} v={`${hud.frameMs.toFixed(2)} ms`} />
            <Stat k={tr('diagDrawCalls')} v={String(hud.drawCalls)} />
            <Stat k={tr('diagTriangles')} v={hud.triangles.toLocaleString()} />
            <Stat k={tr('diagBullets')} v={String(hud.bulletsInFlight)} />
            <Stat k={tr('diagEntities')} v={String(hud.entities)} />
            <Stat k={tr('diagAudioVoices')} v={String(hud.audioVoices)} />
          </div>
        </div>

        <div className="panel">
          <h3>{tr('diagDevice')}</h3>
          <div className="stat-grid" style={{ marginTop: 12 }}>
            <Stat k={tr('diagPlatform')} v={device.platform} />
            <Stat k={tr('diagCores')} v={String(device.cores)} />
            <Stat k={tr('diagMemory')} v={device.memory ? `${device.memory} GB` : '—'} />
            <Stat k={tr('diagScreen')} v={`${device.screen} @ ${device.pixelRatio}x`} />
            <Stat k={tr('diagTouch')} v={device.touch ? tr('diagYes') : tr('diagNo')} />
            <Stat k={tr('diagGamepad')} v={device.gamepad ? tr('diagYes') : tr('diagNo')} />
            <Stat k={tr('diagGyro')} v={device.gyro ? tr('diagYes') : tr('diagNo')} />
            <Stat k={tr('diagWebAudio')} v={device.webAudio ? tr('diagYes') : tr('diagNo')} />
            <Stat k={tr('diagStorage')} v={device.storage ? tr('diagYes') : tr('diagNo')} />
            <Stat k={tr('diagNetworkType')} v={device.connection} />
            <Stat k={tr('diagDownlink')} v={`${device.downlink} Mb/s`} />
            <Stat k={tr('diagRtt')} v={`${device.rtt} ms`} />
            <Stat k={tr('diagStandalone')} v={device.standalone ? tr('diagYes') : tr('diagNo')} />
            <Stat k={tr('diagReducedMotion')} v={device.reducedMotion ? tr('diagYes') : tr('diagNo')} />
            <Stat k={tr('diagDarkMode')} v={device.darkMode ? tr('diagYes') : tr('diagNo')} />
          </div>
        </div>

        <div className="panel">
          <div className="row">
            <h3>{tr('diagPerfLog')}</h3>
            <div className="spacer" />
            <button className="ghost" onClick={copy}>{copied ? tr('diagCopied') : tr('diagCopy')}</button>
            <button className="ghost" onClick={download}>{tr('diagExportLog')}</button>
          </div>
          <div className="profiler" style={{ position: 'static', marginTop: 12, maxHeight: 260, overflowY: 'auto' }}>
            {events.length === 0 ? tr('diagNoLog') : events.join('\n')}
          </div>
        </div>

        <div className="panel">
          <h3>{tr('diagWarnings')}</h3>
          <div className="col" style={{ marginTop: 10 }}>
            {hud.fps > 0 && hud.fps < 45 && <Warn text={tr('diagLowFps')} />}
            {hud.drawCalls > 900 && <Warn text={tr('diagHighDrawCalls')} />}
            {!budgetOk && <Warn text={tr('diagStalls')} />}
            {hud.fps >= 45 && hud.drawCalls <= 900 && budgetOk && (
              <span className="small faint">{tr('diagNoWarnings')}</span>
            )}
          </div>
        </div>

        <div className="panel">
          <h3>{tr('diagSettings')}</h3>
          <div className="small mono faint" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(settings, null, 2)}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v, acc }: { k: string; v: string; acc?: boolean }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className={`v${acc ? ' acc' : ''}`}>{v}</div>
    </div>
  );
}

function Warn({ text }: { text: string }) {
  return <span className="badge warn">{text}</span>;
}
