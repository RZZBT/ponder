export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class IntStack {
  private items: number[] = [];
  push(value: number): void {
    this.items.push(value);
  }
}
