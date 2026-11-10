/*
 * Settings screen. Every option in Settings is editable here and persisted
 * through the App's updateSettings (which also pushes changes into the live
 * Game instance). Tabs mirror the settings sections.
 */

import { useState } from 'react';
import {
  type Settings, type QualityPreset, type Lang, type ColorblindMode,
  type CrosshairStyle, type TouchLayout, type GyroMode, type AudioOutput,
  applyPreset, QUALITY_TABLE,
} from '../settings/settings';

interface Props {
  tr: (k: string) => string;
  settings: Settings;
  onChange: (s: Settings) => void;
  onReset: () => void;
  onBack: () => void;
}

type Tab = 'graphics' | 'audio' | 'controls' | 'interface' | 'touch' | 'accessibility';

export function SettingsScreen({ tr, settings, onChange, onReset, onBack }: Props) {
  const [tab, setTab] = useState<Tab>('graphics');

  const setG = (patch: Partial<Settings['graphics']>) =>
    onChange({ ...settings, graphics: { ...settings.graphics, ...patch } });
  const setA = (patch: Partial<Settings['audio']>) =>
    onChange({ ...settings, audio: { ...settings.audio, ...patch } });
  const setC = (patch: Partial<Settings['controls']>) =>
    onChange({ ...settings, controls: { ...settings.controls, ...patch } });
  const setI = (patch: Partial<Settings['interface']>) =>
    onChange({ ...settings, interface: { ...settings.interface, ...patch } });
  const setT = (patch: Partial<Settings['touch']>) =>
    onChange({ ...settings, touch: { ...settings.touch, ...patch } });

  const tabs: { id: Tab; label: string }[] = [
    { id: 'graphics', label: tr('graphics') },
    { id: 'audio', label: tr('audio') },
    { id: 'controls', label: tr('controls') },
    { id: 'interface', label: tr('interface') },
    { id: 'touch', label: tr('touch') },
    { id: 'accessibility', label: tr('accessibility') },
  ];

  return (
    <div className="screen-scroll">
      <div className="wrap" style={{ paddingTop: 30 }}>
        <div className="row">
          <button className="ghost" onClick={onBack}>{tr('back')}</button>
          <div className="spacer" />
          <h2>{tr('settings')}</h2>
        </div>

        <div className="tabs" style={{ marginTop: 18 }}>
          {tabs.map((x) => (
            <button key={x.id} className={`tab${tab === x.id ? ' active' : ''}`} onClick={() => setTab(x.id)}>
              {x.label}
            </button>
          ))}
        </div>

        <div className="panel" style={{ marginTop: 14 }}>
          {tab === 'graphics' && (
            <>
              <Row label={tr('quality')} hint="Preset drives shadows, particles, decals and render scale.">
                <select
                  value={settings.graphics.preset}
                  onChange={(e) => onChange(applyPreset(settings, e.target.value as QualityPreset))}
                >
                  {(['low', 'medium', 'high', 'ultra'] as QualityPreset[]).map((p) => (
                    <option key={p} value={p}>{tr(p)}</option>
                  ))}
                </select>
              </Row>
              <Slider label={tr('renderScale')} value={settings.graphics.renderScale} min={0.5} max={1.5} step={0.05}
                onChange={(v) => setG({ renderScale: v })} fmt={(v) => `${v.toFixed(2)}×`} />
              <Toggle label={tr('dynamicRes')} value={settings.graphics.dynamicResolution} onChange={(v) => setG({ dynamicResolution: v })} />
              <Toggle label={tr('shadows')} value={settings.graphics.shadows} onChange={(v) => setG({ shadows: v })} />
              <Row label={tr('shadowQuality')}>
                <select value={settings.graphics.shadowQuality} onChange={(e) => setG({ shadowQuality: Number(e.target.value) })}>
                  {[512, 1024, 2048, 4096].map((q) => <option key={q} value={q}>{q}</option>)}
                </select>
              </Row>
              <Slider label={tr('viewDistance')} value={settings.graphics.viewDistance} min={150} max={1200} step={10}
                onChange={(v) => setG({ viewDistance: v })} fmt={(v) => `${v} m`} />
              <Slider label={tr('fov')} value={settings.graphics.fov} min={60} max={110} step={1}
                onChange={(v) => setG({ fov: v })} fmt={(v) => `${v}°`} />
              <Slider label={tr('fpsCap')} value={settings.graphics.fpsCap} min={0} max={240} step={10}
                onChange={(v) => setG({ fpsCap: v })} fmt={(v) => (v === 0 ? tr('diagUncapped') : `${v}`)} />
              <Toggle label={tr('motionBlur')} value={settings.graphics.motionBlur} onChange={(v) => setG({ motionBlur: v })} />
              <Toggle label={tr('antialias')} value={settings.graphics.antialias} onChange={(v) => setG({ antialias: v })} />
              <Slider label={tr('particles')} value={settings.graphics.particles} min={0} max={2} step={0.1}
                onChange={(v) => setG({ particles: v })} fmt={(v) => `${v.toFixed(1)}×`} />
              <Slider label={tr('anisotropy')} value={settings.graphics.anisotropy} min={0} max={16} step={1}
                onChange={(v) => setG({ anisotropy: v })} fmt={(v) => `${v}×`} />
              <Slider label={tr('grassDensity')} value={settings.graphics.grassDensity} min={0} max={2} step={0.1}
                onChange={(v) => setG({ grassDensity: v })} fmt={(v) => `${v.toFixed(1)}×`} />
              <Slider label={tr('decals')} value={settings.graphics.decals} min={0} max={64} step={4}
                onChange={(v) => setG({ decals: v })} fmt={(v) => `${v}`} />
              <Row label={tr('renderer')} hint="WebGPU is experimental; the game falls back to WebGL2 if it fails.">
                <select value={settings.graphics.rendererBackend} onChange={(e) => setG({ rendererBackend: e.target.value as 'webgl2' | 'webgpu' })}>
                  <option value="webgl2">{tr('webgl2')}</option>
                  <option value="webgpu">{tr('webgpuExperimental')}</option>
                </select>
              </Row>
              <div className="small faint" style={{ marginTop: 10 }}>
                Preset table: {QUALITY_TABLE[settings.graphics.preset].pixelsPerMeter} px/m ·
                {' '}{QUALITY_TABLE[settings.graphics.preset].particleMul.toFixed(2)}× particles
              </div>
            </>
          )}

          {tab === 'audio' && (
            <>
              <Slider label={tr('masterVolume')} value={settings.audio.master} min={0} max={1} step={0.01}
                onChange={(v) => setA({ master: v })} fmt={pct} />
              <Slider label={tr('weaponsVolume')} value={settings.audio.weapons} min={0} max={1} step={0.01}
                onChange={(v) => setA({ weapons: v })} fmt={pct} />
              <Slider label={tr('environmentVolume')} value={settings.audio.environment} min={0} max={1} step={0.01}
                onChange={(v) => setA({ environment: v })} fmt={pct} />
              <Slider label={tr('dialogueVolume')} value={settings.audio.dialogue} min={0} max={1} step={0.01}
                onChange={(v) => setA({ dialogue: v })} fmt={pct} />
              <Slider label={tr('musicVolume')} value={settings.audio.music} min={0} max={1} step={0.01}
                onChange={(v) => setA({ music: v })} fmt={pct} />
              <Slider label={tr('uiVolume')} value={settings.audio.ui} min={0} max={1} step={0.01}
                onChange={(v) => setA({ ui: v })} fmt={pct} />
              <Row label={tr('outputMode')}>
                <select value={settings.audio.outputMode} onChange={(e) => setA({ outputMode: e.target.value as AudioOutput })}>
                  <option value="speakers">{tr('speakers')}</option>
                  <option value="headphones">{tr('headphones')}</option>
                </select>
              </Row>
              <Toggle label={tr('hrtf')} value={settings.audio.hrtf} onChange={(v) => setA({ hrtf: v })} />
              <Toggle label={tr('tinnitus')} value={settings.audio.tinnitus} onChange={(v) => setA({ tinnitus: v })} />
            </>
          )}

          {tab === 'controls' && (
            <>
              <Slider label={tr('mouseSensitivity')} value={settings.controls.mouseSensitivity} min={0.1} max={4} step={0.05}
                onChange={(v) => setC({ mouseSensitivity: v })} fmt={(v) => v.toFixed(2)} />
              <Slider label={tr('adsSensitivity')} value={settings.controls.adsSensitivity} min={0.1} max={1.5} step={0.05}
                onChange={(v) => setC({ adsSensitivity: v })} fmt={(v) => v.toFixed(2)} />
              <Slider label={tr('scopeSensitivity')} value={settings.controls.scopeSensitivity} min={0.05} max={1} step={0.05}
                onChange={(v) => setC({ scopeSensitivity: v })} fmt={(v) => v.toFixed(2)} />
              <Toggle label={tr('invertY')} value={settings.controls.invertY} onChange={(v) => setC({ invertY: v })} />
              <Toggle label={tr('toggleAds')} value={settings.controls.toggleAds} onChange={(v) => setC({ toggleAds: v })} />
              <Toggle label={tr('toggleSprint')} value={settings.controls.toggleSprint} onChange={(v) => setC({ toggleSprint: v })} />
              <Toggle label={tr('holdBreath')} value={settings.controls.holdBreath} onChange={(v) => setC({ holdBreath: v })} />
            </>
          )}

          {tab === 'interface' && (
            <>
              <Row label={tr('language')}>
                <select value={settings.interface.language} onChange={(e) => setI({ language: e.target.value as Lang })}>
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </select>
              </Row>
              <Slider label={tr('hudScale')} value={settings.interface.hudScale} min={0.6} max={1.6} step={0.05}
                onChange={(v) => setI({ hudScale: v })} fmt={(v) => `${v.toFixed(2)}×`} />
              <Toggle label={tr('showFps')} value={settings.interface.showFps} onChange={(v) => setI({ showFps: v })} />
              <Toggle label={tr('showProfiler')} value={settings.interface.showProfiler} onChange={(v) => setI({ showProfiler: v })} />
              <Toggle label={tr('showDamageNumbers')} value={settings.interface.showDamageNumbers} onChange={(v) => setI({ showDamageNumbers: v })} />
              <Toggle label={tr('showHitMarkers')} value={settings.interface.showHitMarkers} onChange={(v) => setI({ showHitMarkers: v })} />
              <Row label={tr('crosshairStyle')}>
                <select value={settings.interface.crosshairStyle} onChange={(e) => setI({ crosshairStyle: e.target.value as CrosshairStyle })}>
                  {(['dot', 'cross', 'tick', 'none'] as CrosshairStyle[]).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Row>
              <Row label={tr('colorblind')}>
                <select value={settings.interface.colorblind} onChange={(e) => setI({ colorblind: e.target.value as ColorblindMode })}>
                  {(['none', 'protanopia', 'deuteranopia', 'tritanopia'] as ColorblindMode[]).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Row>
              <Toggle label={tr('subtitles')} value={settings.interface.subtitles} onChange={(v) => setI({ subtitles: v })} />
            </>
          )}

          {tab === 'touch' && (
            <>
              <Row label={tr('touchLayout')}>
                <select value={settings.touch.layout} onChange={(e) => setT({ layout: e.target.value as TouchLayout })}>
                  {(['twoThumb', 'threeFinger', 'fourFinger', 'claw'] as TouchLayout[]).map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Row>
              <Slider label={tr('buttonSize')} value={settings.touch.buttonSize} min={0.6} max={1.6} step={0.05}
                onChange={(v) => setT({ buttonSize: v })} fmt={(v) => `${v.toFixed(2)}×`} />
              <Slider label={tr('buttonOpacity')} value={settings.touch.buttonOpacity} min={0.2} max={1} step={0.05}
                onChange={(v) => setT({ buttonOpacity: v })} fmt={pct} />
              <Row label={tr('gyroMode')}>
                <select value={settings.touch.gyro} onChange={(e) => setT({ gyro: e.target.value as GyroMode })}>
                  <option value="off">{tr('gyroOff')}</option>
                  <option value="ads">{tr('gyroAds')}</option>
                  <option value="always">{tr('gyroAlways')}</option>
                </select>
              </Row>
              <Slider label={tr('gyroSensitivity')} value={settings.touch.gyroSensitivity} min={0.2} max={3} step={0.05}
                onChange={(v) => setT({ gyroSensitivity: v })} fmt={(v) => v.toFixed(2)} />
              <Slider label={tr('gyroSmoothing')} value={settings.touch.gyroSmoothing} min={0} max={0.95} step={0.05}
                onChange={(v) => setT({ gyroSmoothing: v })} fmt={(v) => v.toFixed(2)} />
            </>
          )}

          {tab === 'accessibility' && (
            <>
              <Toggle label={tr('reduceMotion')} value={settings.interface.reduceMotion} onChange={(v) => setI({ reduceMotion: v })} />
              <Toggle label={tr('highContrast')} value={settings.interface.highContrast} onChange={(v) => setI({ highContrast: v })} />
              <Toggle label={tr('screenShake')} value={settings.interface.screenShake} onChange={(v) => setI({ screenShake: v })} />
              <Toggle label={tr('bloodEffects')} value={settings.interface.impactEffects} onChange={(v) => setI({ impactEffects: v })} />
              <Toggle label={tr('subtitles')} value={settings.interface.subtitles} onChange={(v) => setI({ subtitles: v })} />
            </>
          )}
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <button className="danger" onClick={onReset}>{tr('resetDefaults')}</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="setting">
      <div>
        <div className="label">{label}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      <div className="control">{children}</div>
    </div>
  );
}

function Slider(props: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt: (v: number) => string;
}) {
  return (
    <div className="setting">
      <div className="label">{props.label}</div>
      <div className="control">
        <input
          type="range" min={props.min} max={props.max} step={props.step} value={props.value}
          onChange={(e) => props.onChange(Number(e.target.value))}
        />
        <span className="val">{props.fmt(props.value)}</span>
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="setting">
      <div className="label">{label}</div>
      <div className="control">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      </div>
    </div>
  );
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
