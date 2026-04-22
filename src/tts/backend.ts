import type { Plugin } from "obsidian";
import type { VoxSettings } from "../settings";
import { BrowserSynthBackend } from "./browser";
import { OpenAIBackend } from "./openai";
import { ElevenLabsBackend } from "./elevenlabs";

/**
 * TTS backend discriminated union.
 *
 * Two kinds are supported:
 *   - `synth`: backend speaks directly (e.g. SpeechSynthesisAPI). It
 *     owns its own queue, pause/resume, and stop.
 *   - `url`: backend synthesises audio per utterance and returns an
 *     object URL. The Player plays it through a shared <audio> element.
 *
 * Adding a new engine: implement one of the two shapes, export it, and
 * wire it into `createBackend`.
 */
export type TtsBackend = SynthBackend | UrlBackend;

export interface SynthBackend {
  kind: "synth";
  /**
   * Speak every sentence in order. `onDone` (if supplied) fires when
   * the final utterance finishes naturally — not when it's cancelled.
   * Lets the Player return to `idle` without polling.
   */
  speakAll(
    sentences: string[],
    voice: string,
    rate: number,
    onDone?: () => void,
  ): Promise<void>;
  pause(): void;
  resume(): void;
  toggle(): void;
  stopAll(): void;
}

export interface UrlBackend {
  kind: "url";
  /**
   * Synthesise one sentence. Should resolve to an object URL pointing
   * to a playable audio blob (MP3/OGG/WAV). The Player is responsible
   * for revoking it after playback ends.
   */
  synthesizeToUrl(sentence: string, voice: string, rate: number): Promise<string>;
}

/**
 * Factory: pick the concrete backend based on user settings. Called
 * from `VoxPlugin.onload` and again from `saveSettings` so the
 * live Player always has a fresh backend that reflects the latest
 * API keys / engine choice without a full plugin reload.
 */
export function createBackend(
  settings: VoxSettings,
  plugin: Plugin,
): TtsBackend {
  switch (settings.engine) {
    case "browser":
      return new BrowserSynthBackend();
    case "openai":
      return new OpenAIBackend(settings, plugin);
    case "elevenlabs":
      return new ElevenLabsBackend(settings, plugin);
  }
}
