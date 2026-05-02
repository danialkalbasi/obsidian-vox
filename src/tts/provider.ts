import type { Plugin } from "obsidian";
import type { VoxSettings } from "../settings";
import { BrowserSynthProvider } from "./browser";
import { OpenAIProvider } from "./openai";
import { ElevenLabsProvider } from "./elevenlabs";

/**
 * TTS provider discriminated union.
 *
 * Two kinds are supported:
 *   - `synth`: provider speaks directly (e.g. SpeechSynthesisAPI). It
 *     owns its own queue, pause/resume, and stop.
 *   - `url`: provider synthesises audio per utterance and returns an
 *     object URL. The Player plays it through a shared <audio> element.
 *
 * Adding a new engine: implement one of the two shapes, export it, and
 * wire it into `createProvider`.
 */
export type TtsProvider = SynthProvider | UrlProvider;

export interface SynthProvider {
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

export interface UrlProvider {
  kind: "url";
  /**
   * Synthesise one sentence. Should resolve to an object URL pointing
   * to a playable audio blob (MP3/OGG/WAV). The Player is responsible
   * for revoking it after playback ends.
   */
  synthesizeToUrl(sentence: string, voice: string, rate: number): Promise<string>;
}

/**
 * Factory: pick the concrete provider based on user settings. Called
 * from `VoxPlugin.onload` and again from `saveSettings` so the
 * live Player always has a fresh provider that reflects the latest
 * API keys / engine choice without a full plugin reload.
 */
export function createProvider(
  settings: VoxSettings,
  plugin: Plugin,
): TtsProvider {
  switch (settings.engine) {
    case "browser":
      return new BrowserSynthProvider();
    case "openai":
      return new OpenAIProvider(settings, plugin);
    case "elevenlabs":
      return new ElevenLabsProvider(settings, plugin);
  }
}
