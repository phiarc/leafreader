// Wheel deltas are CSS pixels. Native macOS phase events give an exact gesture
// boundary; browser previews use idle detection only when phases aren't present.
export class TrackpadPager {
  sequence = 0;
  lastTime = -Infinity;
  distance = 0;
  active = false;
  committed = false;
  explicit = false;
  ended = false;
  constructor() { this.reset(); }
  reset() {
    this.sequence++; this.lastTime = -Infinity; this.distance = 0;
    this.active = false; this.committed = false; this.explicit = false; this.ended = false;
  }
  begin(now = 0, explicit = true) {
    this.reset(); this.explicit = explicit; this.active = true; this.lastTime = now;
  }
  end(cancelled = false) {
    this.active = false; this.ended = true;
    return { commit: !cancelled && this.committed, distance: this.distance };
  }
  handle(event, now, width = 740) {
    const result = (consume, turn = null) => ({ consume, turn, distance: this.distance,
      progress: Math.min(1, Math.abs(this.distance) / Math.max(1, width)), sequence: this.sequence });
    if (event.ctrlKey || event.metaKey) return result(false);
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1;
    const x = event.deltaX * scale; const y = event.deltaY * scale;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return result(false);
    if (!this.explicit && now - this.lastTime > 180) this.reset();
    if (!this.active) {
      if (this.ended && (this.explicit || now - this.lastTime <= 180)) {
        const horizontal = Math.abs(x) > Math.abs(y); if (horizontal) this.lastTime = now;
        return result(horizontal);
      }
      if (Math.abs(x) < 1.5 || Math.abs(x) <= Math.abs(y) * 1.15) return result(false);
      this.begin(now, false);
    }
    this.lastTime = now;
    if (this.committed) return result(true);
    // Reverse deltas first bring the sheet back toward the starting position.
    this.distance += x;
    const threshold = Math.min(110, Math.max(48, width * .18));
    if (Math.abs(this.distance) >= threshold) {
      this.committed = true;
      return result(true, this.distance > 0 ? 'next' : 'previous');
    }
    return result(true);
  }
}
