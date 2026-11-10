/*
 * Fixed-timestep game loop with render interpolation.
 *
 * Simulation runs at a fixed DT (default 1/60) so physics and weapon timing are
 * deterministic. Rendering happens once per animation frame and receives an
 * `alpha` in [0,1) to interpolate between the previous and current sim state.
 *
 * Spiral-of-death guard: at most MAX_STEPS catch-up steps per frame; beyond that
 * the accumulator is clamped and we report a `stall` so the profiler can show it.
 */

export interface LoopCallbacks {
  /** Advance the simulation by exactly `dt` seconds. */
  fixedUpdate(dt: number, tick: number): void;
  /** Render with interpolation factor `alpha` in [0,1). */
  render(alpha: number, frameDt: number): void;
  /** Called when the loop cannot keep up (for diagnostics). */
  onStall?(droppedSeconds: number): void;
}

export class GameLoop {
  readonly dt: number;
  private readonly maxSteps: number;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private tick = 0;

  /** Rolling frame-time stats (seconds). */
  frameMs = 0;
  avgFrameMs = 16.7;
  minFrameMs = 16.7;
  maxFrameMs = 16.7;
  fps = 60;
  /** 1% low FPS over the sampling window. */
  fps1Low = 60;
  stalledSeconds = 0;

  private samples: number[] = [];
  private sampleAcc = 0;

  constructor(private cb: LoopCallbacks, hz = 60, maxSteps = 5) {
    this.dt = 1 / hz;
    this.maxSteps = maxSteps;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentTick(): number {
    return this.tick;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);

    let frameDt = (now - this.last) / 1000;
    this.last = now;
    if (frameDt > 0.25) frameDt = 0.25; // tab was backgrounded
    this.frameMs = frameDt * 1000;

    this.acc += frameDt;

    let steps = 0;
    while (this.acc >= this.dt && steps < this.maxSteps) {
      this.cb.fixedUpdate(this.dt, this.tick++);
      this.acc -= this.dt;
      steps++;
    }

    if (this.acc >= this.dt) {
      // Could not catch up: drop the backlog and report it.
      const dropped = this.acc - this.dt;
      this.stalledSeconds += dropped;
      this.acc = this.dt * 0.5;
      this.cb.onStall?.(dropped);
    }

    const alpha = this.acc / this.dt;
    this.cb.render(alpha, frameDt);

    this.sample(frameDt);
  };

  private sample(frameDt: number): void {
    this.samples.push(frameDt);
    this.sampleAcc += frameDt;
    if (this.sampleAcc >= 0.5) {
      const n = this.samples.length;
      let sum = 0;
      let mn = Infinity;
      let mx = 0;
      for (let i = 0; i < n; i++) {
        const s = this.samples[i];
        sum += s;
        if (s < mn) mn = s;
        if (s > mx) mx = s;
      }
      this.avgFrameMs = (sum / n) * 1000;
      this.minFrameMs = mn * 1000;
      this.maxFrameMs = mx * 1000;
      this.fps = 1000 / this.avgFrameMs;

      // 1% low: mean of the slowest 1% of frames in the window.
      const sorted = this.samples.slice().sort((a, b) => b - a);
      const k = Math.max(1, Math.floor(n * 0.01));
      let slow = 0;
      for (let i = 0; i < k; i++) slow += sorted[i];
      this.fps1Low = 1000 / ((slow / k) * 1000);

      this.samples.length = 0;
      this.sampleAcc = 0;
    }
  }
}
