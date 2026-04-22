import { requestUrl, type Plugin } from "obsidian";
import type { VoxSettings } from "../settings";
import type { UrlBackend } from "./backend";

/**
 * ElevenLabs TTS backend (`/v1/text-to-speech/{voice_id}`).
 *
 * Uses the non-streaming endpoint for simplicity (ElevenLabs also
 * offers a streamed variant that returns audio in chunks; worth
 * wiring up later if first-audio latency becomes an issue).
 *
 * Cost reference (2025): roughly $0.30 per 1000 chars on the Starter
 * tier, less on higher plans. A 2000-char note ≈ $0.60.
 *
 * The chosen model defaults to `eleven_turbo_v2_5` in settings —
 * faster and cheaper than `eleven_multilingual_v2` with minimal
 * quality difference for English prose.
 */
export class ElevenLabsBackend implements UrlBackend {
  readonly kind = "url" as const;
  private settings: VoxSettings;

  constructor(settings: VoxSettings, _plugin: Plugin) {
    this.settings = settings;
  }

  async synthesizeToUrl(sentence: string, voice: string, rate = 1.0): Promise<string> {
    if (!this.settings.elevenlabsApiKey) {
      throw new Error(
        "ElevenLabs API key not set — add one in Vox settings.",
      );
    }
    if (!voice) {
      throw new Error(
        "ElevenLabs voice_id not set — add one as the default voice or via folder mapping.",
      );
    }

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`;
    const res = await requestUrl({
      url,
      method: "POST",
      headers: {
        "xi-api-key": this.settings.elevenlabsApiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: sentence,
        model_id: this.settings.elevenlabsModel,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          speed: Math.min(1.2, Math.max(0.7, rate)),
        },
      }),
      throw: false,
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`ElevenLabs TTS failed: ${res.status} ${res.text}`);
    }

    const blob = new Blob([res.arrayBuffer], { type: "audio/mpeg" });
    return URL.createObjectURL(blob);
  }
}
