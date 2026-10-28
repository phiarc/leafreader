export function dragFrames(distance: number, width: number, back: boolean, edge = false) {
  const offset = edge ? -Math.sign(distance) * Math.min(26, Math.abs(distance) * .2) : -Math.max(-width, Math.min(width, distance));
  return { current: offset || 0, adjacent: offset + (back ? -width : width) };
}
export class TrackpadView {
  readonly preview: HTMLDivElement;
  private savedTransform: string;
  private animations: Animation[] = [];
  private offset = 0;
  private disposed = false;
  constructor(private host: HTMLElement, private surface: HTMLElement, readonly back: boolean,
    readonly width: number, private motion: boolean, readonly edge = false) {
    this.savedTransform = surface.style.transform;
    this.preview = document.createElement('div');
    this.preview.className = 'trackpad-preview'; this.preview.setAttribute('aria-hidden', 'true');
    if (host.classList.contains('pdf-paper')) this.preview.classList.add('trackpad-pdf');
    if (motion) { host.classList.add('trackpad-active'); host.append(this.preview); }
    this.update(0);
  }
  setContent(content: HTMLElement) { if (!this.disposed) this.preview.replaceChildren(content); }
  update(distance: number) {
    if (this.disposed || !this.motion) return;
    const frames = dragFrames(distance, this.width, this.back, this.edge);
    this.offset = frames.current;
    this.surface.style.transform = `translate3d(${frames.current}px,0,0)`;
    this.preview.style.transform = `translate3d(${frames.adjacent}px,0,0)`;
    this.host.dataset.swipeDistance = String(distance);
    this.host.dataset.swipeProgress = String(Math.min(1, Math.abs(distance) / this.width));
  }
  async settle(commit: boolean): Promise<boolean> {
    if (this.disposed) return false;
    if (!this.motion) return true;
    const next = this.offset + (this.back ? -this.width : this.width);
    const end = commit ? (this.back ? this.width : -this.width) : 0;
    const nextEnd = commit ? 0 : (this.back ? -this.width : this.width);
    const duration = commit ? Math.max(100, Math.min(190, 190 * (1 - Math.abs(this.offset) / this.width))) : 140;
    const options: KeyframeAnimationOptions = {duration, easing:'cubic-bezier(.2,.75,.25,1)',fill:'forwards'};
    this.animations = [
      this.surface.animate([{transform:`translate3d(${this.offset}px,0,0)`},{transform:`translate3d(${end}px,0,0)`}], options),
      this.preview.animate([{transform:`translate3d(${next}px,0,0)`},{transform:`translate3d(${nextEnd}px,0,0)`}], options)
    ];
    try { await Promise.all(this.animations.map(animation => animation.finished)); return !this.disposed; }
    catch { return false; }
  }
  finishNow() { for (const animation of this.animations) { try { animation.finish(); } catch {} } }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const animation of this.animations) animation.cancel();
    this.surface.style.transform = this.savedTransform;
    this.preview.remove(); this.host.classList.remove('trackpad-active');
    delete this.host.dataset.swipeDistance; delete this.host.dataset.swipeProgress;
  }
}
