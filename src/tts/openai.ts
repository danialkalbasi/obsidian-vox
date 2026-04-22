import { requestUrl, type Plugin } from "obsidian";
import type { VoxSettings } from "../settings";
import type { UrlBackend } from "./backend";

/**
 * OpenAI TTS backend (`/v1/audio/speech`).
 *
 * Endpoint returns the full synthesized audio as a single MP3 response.
 * No per-sentence streaming, but latency is low enough (~300-800ms for
 * a short sentence on tts-1) that sequential synthesis feels instant.
 *
 * Uses Obsidian's `requestUrl` instead of `fetch` so it works on mobile
 * and avoids CORS constraints that would apply to the renderer process.
 *
 * Cost reference (2025): tts-1 = $15 / 1M chars, tts-1-hd = $30 / 1M.
 * A typical 2000-char note costs $0.03-0.06.
 */
export class OpenAIBackend implements UrlBackend {
  readonly kind = "url" as const;
  private settings: VoxSettings;

  constructor(settings: VoxSettings, _plugin: Plugin) {
    this.settings = settings;
  }

  async synthesizeToUrl(sentence: string, voice: string, rate = 1.0): Promise<string> {
    if (!this.settings.openaiApiKey) {
      throw new Error("OpenAI API key not set — add one in Vox settings.");
    }

    const res = await requestUrl({
      url: "https://api.openai.com/v1/audio/speech",
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.settings.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.settings.openaiModel,
        voice: voice || "alloy",
        input: sentence,
        format: "mp3",
        speed: rate,
        ...(this.settings.openaiInstructions?.trim()
          ? { instructions: this.settings.openaiInstructions.trim() }
          : {}),
      }),
      throw: false,
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`OpenAI TTS failed: ${res.status} ${res.text}`);
    }

    const blob = new Blob([res.arrayBuffer], { type: "audio/mpeg" });
    return URL.createObjectURL(blob);
  }
}
