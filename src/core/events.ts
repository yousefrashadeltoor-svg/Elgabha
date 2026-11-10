/*
 * Typed event bus. Systems publish; presentation layers subscribe.
 * Listeners are stored in a Map of arrays; emit iterates a copy only when the
 * listener set changed during dispatch (rare), so the hot path stays allocation-free.
 */

export type Handler<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private map = new Map<keyof Events, Handler<never>[]>();
  private dirty = false;

  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    let list = this.map.get(type);
    if (!list) {
      list = [];
      this.map.set(type, list);
    }
    list.push(fn as Handler<never>);
    this.dirty = true;
    return () => this.off(type, fn);
  }

  once<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, fn: Handler<Events[K]>): void {
    const list = this.map.get(type);
    if (!list) return;
    const i = list.indexOf(fn as Handler<never>);
    if (i >= 0) {
      list.splice(i, 1);
      this.dirty = true;
    }
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.map.get(type);
    if (!list || list.length === 0) return;
    if (this.dirty) {
      this.dirty = false;
      const snapshot = list.slice();
      for (let i = 0; i < snapshot.length; i++) (snapshot[i] as Handler<Events[K]>)(payload);
      return;
    }
    for (let i = 0; i < list.length; i++) (list[i] as Handler<Events[K]>)(payload);
  }

  clear(): void {
    this.map.clear();
    this.dirty = true;
  }
}
