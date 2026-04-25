import type { TtsEngine } from "./settings";

export const OPENAI_VOICES = [
  "alloy", "ash", "ballad", "cedar", "coral", "echo",
  "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse",
] as const;

export const SPEED_LIMITS: Record<TtsEngine, [min: number, max: number, step: number]> = {
  elevenlabs: [0.7, 1.2, 0.05],
  openai:     [0.25, 4.0, 0.05],
  browser:    [0.6, 2.0, 0.05],
};
