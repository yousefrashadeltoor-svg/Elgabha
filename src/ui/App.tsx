/*
 * App shell: screen router + settings store + game lifecycle.
 *
 * Screens: menu | missions | briefing | settings | diagnostics | credits | game
 * The Game instance is created only when a mission starts and is disposed when
 * the player leaves, so the WebGL context is never leaked.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Game, type HudState } from '../game/game';
import { loadGameData } from '../data';
import { STRINGS, t, dir, type Lang } from '../data/i18n';
import {
  loadSettings, saveSettings, resetSettings, applyPreset, notifySettings,
  type Settings, type QualityPreset,
} from '../settings/settings';
import type { MissionData, MapData } from '../data/schema';
import { Hud } from './Hud';
import { SettingsScreen } from './SettingsScreen';
import { DiagnosticsScreen } from './DiagnosticsScreen';
import { TouchControls } from './TouchControls';

type Screen = 'menu' | 'missions' | 'briefing' | 'settings' | 'diagnostics' | 'credits' | 'game';

const EMPTY_HUD: HudState = {
  health: 100, stamina: 100, ammoInMag: 0, ammoReserve: 0, weaponName: '', weaponClass: '',
  fireMode: 'single', reloading: false, jammed: false, bipod: false, ads: 0, stance: 'stand',
  spread: 0, enemiesAlive: 0, enemiesTotal: 0, kills: 0, objectiveText: '', objectiveProgress: '',
  missionName: '', timeLeft: 0, paused: false, dead: false, hitMarker: 0, damageFlash: 0,
  killFeed: [], fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, bulletsInFlight: 0, entities: 0,
  audioVoices: 0, renderer: 'webgl2', quality: 'high', renderScale: 1, pointerLocked: false,
  showFps: true, showProfiler: false, crosshairStyle: 'cross', hudScale: 1, language: 'en',
  subtitles: true, message: '',
};

export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [screen, setScreen] = useState<Screen>('menu');
  const [mission, setMission] = useState<MissionData | null>(null);
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [events, setEvents] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const [fatal, setFatal] = useState<string | null>(null);
  const gameRef = useRef<Game | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const data = useMemo(() => {
    try {
      return loadGameData();
    } catch (e) {
      return null;
    }
  }, []);

  const lang: Lang = settings.interface.language;
  const tr = useCallback((k: string) => t(k, lang), [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir(lang);
  }, [lang]);

  useEffect(() => {
    if (!data) setFatal('Data validation failed. See console for the exact JSON path.');
  }, [data]);

  const pushEvent = useCallback((msg: string) => {
    setEvents((prev) => [msg, ...prev].slice(0, 40));
  }, []);

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
    notifySettings(next);
    gameRef.current?.applySettings(next);
  }, []);

  const startMission = useCallback(async (m: MissionData) => {
    if (!data) return;
    const map = data.maps.get(m.map);
    if (!map) {
      setFatal(`Mission ${m.id} references unknown map ${m.map}`);
      return;
    }
    setMission(m);
    setScreen('game');
    setLoading(true);
    setLoadPct(10);
    setEvents([]);
    // Let React paint the loading screen before the heavy synchronous build.
    await new Promise((r) => setTimeout(r, 30));
    try {
      setLoadPct(35);
      const container = containerRef.current;
      if (!container) throw new Error('game container missing');
      const game = new Game({
        container,
        settings,
        mission: m,
        map,
        onHud: setHud,
        onEvent: pushEvent,
        onPauseRequest: () => {
          setPaused((p) => {
            const next = !p;
            gameRef.current?.setPaused(next);
            return next;
          });
        },
      });
      gameRef.current = game;
      // Debug handle for the diagnostics screen and automated smoke tests.
      (window as unknown as { __game?: Game }).__game = game;
      setLoadPct(70);
      await game.start();
      setLoadPct(100);
      setLoading(false);
      game.requestPointerLock();
    } catch (e) {
      setLoading(false);
      setFatal(e instanceof Error ? e.message : String(e));
    }
  }, [data, settings, pushEvent]);

  const leaveGame = useCallback(() => {
    gameRef.current?.dispose();
    gameRef.current = null;
    setPaused(false);
    setScreen('missions');
    setHud(EMPTY_HUD);
  }, []);

  // Deep link: ?mission=<id> jumps straight into a mission (also used by the
  // automated smoke test). ?lang=ar|en sets the language.
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (!data || deepLinkDone.current) return;
    deepLinkDone.current = true;
    const params = new URLSearchParams(window.location.search);
    const langParam = params.get('lang');
    if (langParam === 'ar' || langParam === 'en') {
      updateSettings({ ...settings, interface: { ...settings.interface, language: langParam } });
    }
    const missionId = params.get('mission');
    if (missionId) {
      const m = data.missions.get(missionId) ?? [...data.missions.values()][0];
      if (m) void startMission(m);
    }
  }, [data, startMission, settings, updateSettings]);

  useEffect(() => {
    return () => {
      gameRef.current?.dispose();
      gameRef.current = null;
    };
  }, []);

  const resume = useCallback(() => {
    setPaused(false);
    gameRef.current?.setPaused(false);
    gameRef.current?.requestPointerLock();
  }, []);

  const restart = useCallback(() => {
    if (!mission) return;
    gameRef.current?.dispose();
    gameRef.current = null;
    setPaused(false);
    void startMission(mission);
  }, [mission, startMission]);

  if (fatal) {
    return (
      <div className="screen">
        <div className="wrap" style={{ marginTop: 80 }}>
          <div className="title-block">
            <h1>{tr('gameTitle')}</h1>
            <div className="sub">{tr('gameSubtitle')}</div>
          </div>
          <div className="panel" style={{ marginTop: 20, borderColor: 'var(--danger)' }}>
            <h3 style={{ color: 'var(--danger)' }}>Startup error</h3>
            <p className="mono small" style={{ marginTop: 8 }}>{fatal}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      {screen === 'menu' && (
        <MenuScreen
          tr={tr}
          onPlay={() => setScreen('missions')}
          onSettings={() => setScreen('settings')}
          onDiagnostics={() => setScreen('diagnostics')}
          onCredits={() => setScreen('credits')}
          lang={lang}
          onLang={(l) => updateSettings({ ...settings, interface: { ...settings.interface, language: l } })}
        />
      )}

      {screen === 'missions' && data && (
        <MissionScreen
          tr={tr}
          missions={[...data.missions.values()]}
          maps={data.maps}
          onBack={() => setScreen('menu')}
          onStart={(m) => { setMission(m); setScreen('briefing'); }}
        />
      )}

      {screen === 'briefing' && mission && (
        <BriefingScreen
          tr={tr}
          mission={mission}
          onBack={() => setScreen('missions')}
          onDeploy={() => void startMission(mission)}
        />
      )}

      {screen === 'settings' && (
        <SettingsScreen
          tr={tr}
          settings={settings}
          onChange={updateSettings}
          onReset={() => updateSettings(resetSettings())}
          onBack={() => setScreen('menu')}
        />
      )}

      {screen === 'diagnostics' && (
        <DiagnosticsScreen tr={tr} hud={hud} events={events} settings={settings} onBack={() => setScreen('menu')} />
      )}

      {screen === 'credits' && <CreditsScreen tr={tr} onBack={() => setScreen('menu')} />}

      {screen === 'game' && (
        <div className="game-root">
          <div ref={containerRef} className="game-canvas" />
          {loading && (
            <div className="loading">
              <div className="title-block">
                <h1>{tr('gameTitle')}</h1>
                <div className="sub">{mission?.name[lang]}</div>
              </div>
              <div className="bar"><i style={{ width: `${loadPct}%` }} /></div>
              <div className="tip">{tr('loading')}… {loadPct}%</div>
            </div>
          )}
          {!loading && (
            <>
              <Hud hud={hud} tr={tr} lang={lang} />
              <TouchControls settings={settings} game={gameRef} />
              {!hud.pointerLocked && !paused && !hud.dead && (
                <div className="click-catch" onClick={() => gameRef.current?.requestPointerLock()}>
                  <div className="prompt">{tr('clickToPlay')}</div>
                </div>
              )}
              {paused && (
                <PauseScreen
                  tr={tr}
                  onResume={resume}
                  onRestart={restart}
                  onSettings={() => { setPaused(false); gameRef.current?.setPaused(true); setScreen('settings'); }}
                  onQuit={leaveGame}
                />
              )}
              {hud.dead && (
                <div className="banner-overlay">
                  <div className="banner">
                    {tr('killed')}
                    <div className="sub">{tr('missionFailed')}</div>
                  </div>
                  <div className="row" style={{ marginTop: 18, justifyContent: 'center' }}>
                    <button className="primary" onClick={restart}>{tr('restart')}</button>
                    <button onClick={leaveGame}>{tr('quit')}</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- screens ------------------------------- */

function MenuScreen(props: {
  tr: (k: string) => string;
  onPlay: () => void;
  onSettings: () => void;
  onDiagnostics: () => void;
  onCredits: () => void;
  lang: Lang;
  onLang: (l: Lang) => void;
}) {
  const { tr } = props;
  return (
    <div className="screen-scroll">
      <div className="wrap" style={{ paddingTop: 60 }}>
        <div className="title-block">
          <h1>{tr('gameTitle')}</h1>
          <div className="sub">{tr('gameSubtitle')}</div>
        </div>
        <p className="dim" style={{ marginTop: 14, maxWidth: 560 }}>{tr('tagline')}</p>

        <div className="col" style={{ marginTop: 34, maxWidth: 320 }}>
          <button className="primary" onClick={props.onPlay}>{tr('play')}</button>
          <button onClick={props.onSettings}>{tr('settings')}</button>
          <button onClick={props.onDiagnostics}>{tr('diagnostics')}</button>
          <button onClick={props.onCredits}>{tr('credits')}</button>
        </div>

        <div className="row" style={{ marginTop: 30, gap: 8 }}>
          <span className="small faint">{tr('language')}:</span>
          <button className={props.lang === 'en' ? 'primary' : 'ghost'} onClick={() => props.onLang('en')}>English</button>
          <button className={props.lang === 'ar' ? 'primary' : 'ghost'} onClick={() => props.onLang('ar')}>العربية</button>
        </div>

        <div className="panel" style={{ marginTop: 34, maxWidth: 720 }}>
          <h3>{tr('controls')}</h3>
          <div className="grid c2" style={{ marginTop: 10 }}>
            <KeyRow k="W A S D" v="Move" />
            <KeyRow k="Mouse" v="Look" />
            <KeyRow k="Left click" v="Fire" />
            <KeyRow k="Right click" v="Aim" />
            <KeyRow k="R" v="Reload" />
            <KeyRow k="Ctrl" v="Crouch" />
            <KeyRow k="X" v="Prone" />
            <KeyRow k="Shift" v="Sprint / hold breath" />
            <KeyRow k="F" v="Deploy bipod" />
            <KeyRow k="Space" v="Jump" />
            <KeyRow k="Esc" v="Pause" />
            <KeyRow k="1 / 2" v="Switch weapon" />
          </div>
        </div>
      </div>
    </div>
  );
}

function KeyRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="row" style={{ gap: 10 }}>
      <span className="kbd">{k}</span>
      <span className="small dim">{v}</span>
    </div>
  );
}

function MissionScreen(props: {
  tr: (k: string) => string;
  missions: MissionData[];
  maps: Map<string, MapData>;
  onBack: () => void;
  onStart: (m: MissionData) => void;
}) {
  const { tr } = props;
  return (
    <div className="screen-scroll">
      <div className="wrap" style={{ paddingTop: 40 }}>
        <div className="row">
          <button className="ghost" onClick={props.onBack}>{tr('back')}</button>
          <div className="spacer" />
          <h2>{tr('campaign')}</h2>
        </div>
        <div className="list" style={{ marginTop: 20 }}>
          {props.missions.map((m) => {
            const map = props.maps.get(m.map);
            return (
              <div className="item" key={m.id}>
                <div className="grow">
                  <div className="nm">{m.name.en}</div>
                  <div className="meta">
                    {map?.name.en ?? m.map} · {m.mode} · {m.faction} · {m.enemyCount} enemies
                    {m.timeLimit > 0 ? ` · ${Math.round(m.timeLimit / 60)} min` : ''}
                  </div>
                </div>
                <span className="badge acc">{m.difficulty}</span>
                <button className="primary" onClick={() => props.onStart(m)}>{tr('play')}</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BriefingScreen(props: {
  tr: (k: string) => string;
  mission: MissionData;
  onBack: () => void;
  onDeploy: () => void;
}) {
  const { tr, mission } = props;
  return (
    <div className="screen-scroll">
      <div className="wrap" style={{ paddingTop: 40 }}>
        <div className="row">
          <button className="ghost" onClick={props.onBack}>{tr('back')}</button>
          <div className="spacer" />
          <span className="badge acc">{mission.mode}</span>
        </div>
        <div className="title-block" style={{ marginTop: 18 }}>
          <h1>{mission.name.en}</h1>
          <div className="sub">{mission.faction} · {mission.difficulty}</div>
        </div>
        <div className="panel" style={{ marginTop: 20 }}>
          <h3>{tr('briefing')}</h3>
          <p style={{ marginTop: 10, lineHeight: 1.7 }}>{mission.briefing.en}</p>
        </div>
        <div className="panel">
          <h3>{tr('objectives')}</h3>
          <div className="col" style={{ marginTop: 10 }}>
            {mission.objectives.map((o) => (
              <div className="row" key={o.id} style={{ gap: 10 }}>
                <span className="badge">{o.type}</span>
                <span className="small">{o.text.en}</span>
                {o.count > 0 && <span className="mono small faint">×{o.count}</span>}
              </div>
            ))}
          </div>
        </div>
        <div className="row" style={{ marginTop: 22 }}>
          <button className="primary" onClick={props.onDeploy}>{tr('play')}</button>
        </div>
      </div>
    </div>
  );
}

function PauseScreen(props: {
  tr: (k: string) => string;
  onResume: () => void;
  onRestart: () => void;
  onSettings: () => void;
  onQuit: () => void;
}) {
  const { tr } = props;
  return (
    <div className="banner-overlay">
      <div className="panel" style={{ width: 300 }}>
        <h2 style={{ textAlign: 'center' }}>{tr('paused')}</h2>
        <div className="col" style={{ marginTop: 18 }}>
          <button className="primary" onClick={props.onResume}>{tr('resume')}</button>
          <button onClick={props.onRestart}>{tr('restart')}</button>
          <button onClick={props.onSettings}>{tr('settings')}</button>
          <button className="danger" onClick={props.onQuit}>{tr('quit')}</button>
        </div>
      </div>
    </div>
  );
}

function CreditsScreen(props: { tr: (k: string) => string; onBack: () => void }) {
  const { tr } = props;
  return (
    <div className="screen-scroll">
      <div className="wrap" style={{ paddingTop: 40 }}>
        <div className="row">
          <button className="ghost" onClick={props.onBack}>{tr('back')}</button>
          <div className="spacer" />
          <h2>{tr('credits')}</h2>
        </div>
        <div className="panel" style={{ marginTop: 20 }}>
          <h3>{tr('creditsTextures')}</h3>
          <p className="small dim" style={{ marginTop: 8, lineHeight: 1.7 }}>
            Terrain and surface textures are CC0 (Poly Haven). All weapon, character and
            environment geometry is generated procedurally at runtime — no third-party
            models are shipped. Ballistic data is derived from public historical sources.
          </p>
        </div>
        <div className="panel">
          <h3>{tr('creditsHistorical')}</h3>
          <p className="small dim" style={{ marginTop: 8, lineHeight: 1.7 }}>
            Weapon characteristics (rates of fire, magazine capacities, muzzle velocities)
            are approximations drawn from published reference material for the 1939–1945
            period. This is a work of fiction set against a historical backdrop.
          </p>
        </div>
      </div>
    </div>
  );
}
