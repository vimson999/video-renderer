export const msToFrame = (milliseconds: number, fps: number): number =>
  Math.round((milliseconds * fps) / 1_000);
