/*
 * Adaptive quality control: TUNING.md prescribes the target frame time,
 * a dynamic-resolution window, and automatic preset downgrades after
 * sustained load. This module measures the rolling average and emits
 * events the Diagnostics screen records.
 */

import type { QualityPreset, Settings, QualityTable } from '../settings/settings';
import { QUALITY_TABLE } from '../settings/settings';
import { clamp, lerp } from '../core/math';

export const TARGET_MS = 16.67;        // 60 fps
export const DYNAMIC_MIN = 0.55;       // render-scale floor
export const DYNAMIC_MAX = 1.15;

export interface QualityState {
  preset: QualityPreset;
  dynamicScale: number;
  sustainedMs: number;
  downgrades: number;
  lastDowngradeAt: number;
}

export class AutoQuality {
  state: QualityState = {
    preset: 'high',
    dynamicScale: 1,
    sustainedMs: 16.67,
    downgrades: 0,
    lastDowngradeAt: 0,
  };
  private history: number[] = [];
  private onEvent: (msg: string) => void;

  constructor(private settings: Settings, onEvent: (msg: string) => void) {
    this.onEvent = onEvent;
    this.state.preset = settings.graphics.preset;
  }

  get table(): QualityTable {
    return QUALITY_TABLE[this.state.preset];
  }

  /** Feed a frame time (ms). Returns the current effective render scale. */
  update(frameMs: number): number {
    this.history.push(frameMs);
    if (this.history.length > 90) this.history.shift();
    const avg = this.history.reduce((a, b) => a + b, 0) / Math.max(1, this.history.length);
    this.state.sustainedMs = avg;

    if (this.settings.graphics.dynamicResolution) {
      const err = TARGET_MS - avg;
      this.state.dynamicScale = clamp(
        this.state.dynamicScale * (1 + err * 0.012),
        DYNAMIC_MIN,
        DYNAMIC_MAX,
      );
    } else {
      this.state.dynamicScale = this.settings.graphics.renderScale;
    }

    // Auto-downgrade only after sustained load (60+ frames over budget).
    const overBudget = this.history.filter((f) => f > TARGET_MS * 1.25).length;
    if (this.history.length >= 90 && overBudget > 60 && this.state.preset !== 'low') {
      const order: QualityPreset[] = ['ultra', 'high', 'medium', 'low'];
      const idx = order.indexOf(this.state.preset);
      if (idx < order.length - 1) {
        this.state.preset = order[idx + 1];
        this.state.downgrades++;
        this.state.lastDowngradeAt = performance.now();
        this.onEvent('auto-quality: lowered to ' + this.state.preset);
      }
    } else if (
      this.history.length >= 90 &&
      this.history.filter((f) => f > TARGET_MS * 1.25).length < 10 &&
      this.state.preset !== this.settings.graphics.preset &&
      this.state.preset !== 'ultra'
    ) {
      const order: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];
      const idx = order.indexOf(this.state.preset);
      if (idx < order.length - 1) {
        const next = order[idx + 1];
        if (order.indexOf(next) <= order.indexOf(this.settings.graphics.preset)) {
          this.state.preset = next;
          this.onEvent('auto-quality: raised to ' + next);
        }
      }
    }
    return this.state.dynamicScale * this.settings.graphics.renderScale;
  }

  lerpScale(target: number): void {
    this.state.dynamicScale = lerp(this.state.dynamicScale, target, 0.1);
  }

  /** One-shot recommended preset for a device (based on hardware class). */
  static recommend(deviceMemoryGB: number, cores: number, hasAppleSilicon: boolean): QualityPreset {
    if (hasAppleSilicon || (deviceMemoryGB >= 8 && cores >= 8)) return 'high';
    if (deviceMemoryGB >= 4 && cores >= 4) return 'medium';
    return 'low';
  }
}
