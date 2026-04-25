import { requestUrl, type Plugin } from "obsidian";
import type { VoxSettings } from "../settings";
import type { UrlBackend } from "./backend";
import { AudioCache, type AudioCacheParts } from "./cache";
import { SPEED_LIMITS } from "../constants";

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
  private cache: AudioCache;

  constructor(settings: VoxSettings, plugin: Plugin) {
    this.settings = settings;
    this.cache = new AudioCache(plugin);
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

    const [minSpeed, maxSpeed] = SPEED_LIMITS.elevenlabs;
    const speed = Math.min(maxSpeed, Math.max(minSpeed, rate));
    const cacheParts: AudioCacheParts = {
      engine: "elevenlabs",
      model: this.settings.elevenlabsModel,
      voice,
      rate: speed,
      text: sentence,
    };

    if (this.settings.cacheEnabled) {
      const cached = await this.cache.get(cacheParts);
      if (cached) return this.toObjectUrl(cached);
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
          speed,
        },
      }),
      throw: false,
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`ElevenLabs TTS failed: ${res.status} ${res.text}`);
    }

    if (this.settings.cacheEnabled) {
      await this.cache.set(cacheParts, res.arrayBuffer);
    }

    return this.toObjectUrl(res.arrayBuffer);
  }

  private toObjectUrl(audio: ArrayBuffer): string {
    const blob = new Blob([audio], { type: "audio/mpeg" });
    return URL.createObjectURL(blob);
  }
}
