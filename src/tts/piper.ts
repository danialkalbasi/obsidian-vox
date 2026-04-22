import { requestUrl, type Plugin } from "obsidian";
import type { RhapsodeSettings } from "../settings";
import type { UrlBackend } from "./backend";

/**
 * Piper TTS backend — local neural TTS via Piper's HTTP server.
 *
 * WHY HTTP AND NOT CLI:
 *   The `piper` CLI reloads the voice model on every invocation —
 *   ~300-500ms per sentence on M1, audible as gaps between sentences.
 *   The HTTP server loads the model once and responds in ~50-100ms
 *   thereafter. Plugin code also collapses to a single POST.
 *
 * USER SETUP (one time):
 *   pip install piper-tts[http]
 *   python3 -m piper.download_voices en_US-lessac-medium
 *   python3 -m piper.http_server -m en_US-lessac-medium
 *
 *   The server listens on http://localhost:5000 by default. Keep it
 *   running in a terminal (or a launchd/systemd unit) — Rhapsode hits
 *   it on demand.
 *
 * PER-REQUEST PARAMS (POSTed to `/`):
 *   - text         required
 *   - voice        optional; overrides the server's default voice
 *   - length_scale optional; speaking speed, 1 = natural
 *
 * We use Obsidian's `requestUrl` rather than `fetch` so the same code
 * works on mobile when the server is reachable over the LAN, and so
 * CORS headers from localhost never become a surprise.
 */
export class PiperBackend implements UrlBackend {
  readonly kind = "url" as const;
  private settings: RhapsodeSettings;

  constructor(settings: RhapsodeSettings, _plugin: Plugin) {
    this.settings = settings;
  }

  async synthesizeToUrl(sentence: string, voice: string): Promise<string> {
    const serverUrl = (this.settings.piperServerUrl || "http://localhost:5000")
      .replace(/\/+$/, "");

    // Voice override is optional — if the server was started with
    // `-m <voice>` and we send no voice field, it uses that default.
    const body: Record<string, string | number> = {
      text: sentence,
      length_scale: Math.max(0.25, Math.min(4, 1 / (this.settings.rate || 1))),
    };
    if (voice) body.voice = voice;

    let res;
    try {
      res = await requestUrl({
        url: serverUrl,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        throw: false,
      });
    } catch (err) {
      // Network-level failure (ECONNREFUSED etc.) surfaces here as a
      // thrown error rather than a status code — make it actionable.
      throw new Error(
        `Piper server unreachable at ${serverUrl}. Start it with: python3 -m piper.http_server -m <voice>`,
      );
    }

    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `Piper HTTP server returned ${res.status}: ${res.text?.slice(0, 200) || ""}`,
      );
    }

    const blob = new Blob([res.arrayBuffer], { type: "audio/wav" });
    return URL.createObjectURL(blob);
  }
}
