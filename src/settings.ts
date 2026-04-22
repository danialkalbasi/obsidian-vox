import { App, PluginSettingTab, Setting } from "obsidian";
import type RhapsodePlugin from "./main";

export type TtsEngine = "browser" | "elevenlabs" | "openai" | "piper";

export interface RhapsodeSettings {
  /** Which TTS backend to use. `browser` uses the free built-in
   *  SpeechSynthesis API (works offline, low quality). */
  engine: TtsEngine;

  /** Default voice identifier, meaning depends on the engine:
   *   - browser: a voice `name` from speechSynthesis.getVoices()
   *   - elevenlabs: a voice_id (e.g. "21m00Tcm4TlvDq8ikWAM")
   *   - openai: one of "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer"
   *   - piper: a voice model filename (e.g. "en_US-lessac-medium") */
  defaultVoice: string;

  /** Playback rate multiplier (1.0 = natural). Applied on the <audio>
   *  element as `playbackRate`. */
  rate: number;

  /** API keys for cloud engines. Stored in data.json inside the plugin
   *  folder; treat as you would any other local secret. */
  elevenlabsApiKey: string;
  openaiApiKey: string;

  /** Model tier when using elevenlabs (monolingual vs multilingual). */
  elevenlabsModel: string;

  /** OpenAI TTS model — "tts-1" (fast) or "tts-1-hd" (better quality). */
  openaiModel: "tts-1" | "tts-1-hd";

  /**
   * URL of a running Piper HTTP server, e.g. http://localhost:5000.
   * Start one with `python3 -m piper.http_server -m <voice>`.
   */
  piperServerUrl: string;

  /**
   * Folder-prefix → voice-id map for persona overrides.
   * Example: { "Philosophy/": "epictetus-voice-id" }
   * Longest prefix wins when multiple match.
   */
  folderVoices: Record<string, string>;

  /** Cache generated audio to disk (by note-hash) to avoid re-billing. */
  cacheEnabled: boolean;
}

export const DEFAULT_SETTINGS: RhapsodeSettings = {
  engine: "browser",
  defaultVoice: "",
  rate: 1.0,
  elevenlabsApiKey: "",
  openaiApiKey: "",
  elevenlabsModel: "eleven_turbo_v2_5",
  openaiModel: "tts-1",
  piperServerUrl: "http://localhost:5000",
  folderVoices: {},
  cacheEnabled: true,
};

/**
 * Settings tab — reachable from Obsidian's Community Plugins settings.
 * Layout is intentionally flat (one vertical list of controls) rather
 * than tabbed sub-sections; the surface area is small enough that
 * extra structure would just add friction.
 */
export class RhapsodeSettingTab extends PluginSettingTab {
  private plugin: RhapsodePlugin;

  constructor(app: App, plugin: RhapsodePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Rhapsode" });
    containerEl.createEl("p", {
      text: "Reads your notes aloud. Pick a backend, drop in an API key if needed, and assign persona voices per folder.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Engine")
      .setDesc(
        "Which text-to-speech backend to use. Browser = free, offline, robotic. ElevenLabs / OpenAI = paid API, natural voices. Piper = local neural TTS (not yet wired up).",
      )
      .addDropdown((dd) =>
        dd
          .addOption("browser", "Browser SpeechSynthesis (free)")
          .addOption("openai", "OpenAI TTS")
          .addOption("elevenlabs", "ElevenLabs")
          .addOption("piper", "Piper (local, desktop only)")
          .setValue(this.plugin.settings.engine)
          .onChange(async (value) => {
            this.plugin.settings.engine = value as TtsEngine;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName("Default voice")
      .setDesc(this.voiceHintForEngine(this.plugin.settings.engine))
      .addText((t) =>
        t
          .setPlaceholder(this.voicePlaceholder(this.plugin.settings.engine))
          .setValue(this.plugin.settings.defaultVoice)
          .onChange(async (v) => {
            this.plugin.settings.defaultVoice = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Playback rate")
      .setDesc("1.0 is natural. 1.5 is brisk. 0.8 for contemplative reading.")
      .addSlider((s) =>
        s
          .setLimits(0.6, 2.0, 0.05)
          .setValue(this.plugin.settings.rate)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.rate = v;
            await this.plugin.saveSettings();
          }),
      );

    // ── API keys (only shown when relevant) ───────────────────────
    if (this.plugin.settings.engine === "elevenlabs") {
      new Setting(containerEl)
        .setName("ElevenLabs API key")
        .setDesc("From elevenlabs.io → Profile → API Key.")
        .addText((t) =>
          t
            .setPlaceholder("sk_...")
            .setValue(this.plugin.settings.elevenlabsApiKey)
            .onChange(async (v) => {
              this.plugin.settings.elevenlabsApiKey = v;
              await this.plugin.saveSettings();
            }),
        );
      new Setting(containerEl)
        .setName("ElevenLabs model")
        .addDropdown((dd) =>
          dd
            .addOption("eleven_turbo_v2_5", "Turbo v2.5 (fast, cheap)")
            .addOption("eleven_multilingual_v2", "Multilingual v2 (best quality)")
            .setValue(this.plugin.settings.elevenlabsModel)
            .onChange(async (v) => {
              this.plugin.settings.elevenlabsModel = v;
              await this.plugin.saveSettings();
            }),
        );
    }

    if (this.plugin.settings.engine === "piper") {
      new Setting(containerEl)
        .setName("Piper server URL")
        .setDesc(
          "Rhapsode talks to a local Piper HTTP server. One-time setup: `pip install piper-tts[http]`, then in any terminal run `python3 -m piper.download_voices en_US-lessac-medium` and `python3 -m piper.http_server -m en_US-lessac-medium`. Leave that terminal running. Default URL works if you started the server on the default port.",
        )
        .addText((t) =>
          t
            .setPlaceholder("http://localhost:5000")
            .setValue(this.plugin.settings.piperServerUrl)
            .onChange(async (v) => {
              this.plugin.settings.piperServerUrl = v;
              await this.plugin.saveSettings();
            }),
        );
    }

    if (this.plugin.settings.engine === "openai") {
      new Setting(containerEl)
        .setName("OpenAI API key")
        .setDesc("From platform.openai.com → API keys.")
        .addText((t) =>
          t
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.openaiApiKey)
            .onChange(async (v) => {
              this.plugin.settings.openaiApiKey = v;
              await this.plugin.saveSettings();
            }),
        );
      new Setting(containerEl)
        .setName("OpenAI TTS model")
        .addDropdown((dd) =>
          dd
            .addOption("tts-1", "tts-1 (fast, cheap)")
            .addOption("tts-1-hd", "tts-1-hd (better quality)")
            .setValue(this.plugin.settings.openaiModel)
            .onChange(async (v) => {
              this.plugin.settings.openaiModel = v as "tts-1" | "tts-1-hd";
              await this.plugin.saveSettings();
            }),
        );
    }

    // ── Caching ───────────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Cache generated audio")
      .setDesc(
        "Saves generated audio to .obsidian/plugins/rhapsode/cache/ keyed by note content hash. Prevents re-billing cloud TTS when the note hasn't changed.",
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.cacheEnabled).onChange(async (v) => {
          this.plugin.settings.cacheEnabled = v;
          await this.plugin.saveSettings();
        }),
      );

    // ── Persona voices per folder ─────────────────────────────────
    containerEl.createEl("h3", { text: "Persona voices per folder" });
    containerEl.createEl("p", {
      text: "Assign a different voice to each folder prefix. The longest matching prefix wins. You can also set a `voice:` key in a note's frontmatter to override per-note.",
      cls: "setting-item-description",
    });

    const folderVoices = this.plugin.settings.folderVoices;
    for (const prefix of Object.keys(folderVoices)) {
      new Setting(containerEl)
        .setName(prefix)
        .addText((t) =>
          t.setValue(folderVoices[prefix]).onChange(async (v) => {
            folderVoices[prefix] = v;
            await this.plugin.saveSettings();
          }),
        )
        .addExtraButton((b) =>
          b
            .setIcon("trash")
            .setTooltip("Remove")
            .onClick(async () => {
              delete folderVoices[prefix];
              await this.plugin.saveSettings();
              this.display();
            }),
        );
    }

    let newPrefix = "";
    let newVoice = "";
    new Setting(containerEl)
      .setName("Add folder mapping")
      .addText((t) => t.setPlaceholder("Philosophy/").onChange((v) => (newPrefix = v)))
      .addText((t) => t.setPlaceholder("voice-id").onChange((v) => (newVoice = v)))
      .addButton((b) =>
        b.setButtonText("Add").onClick(async () => {
          if (!newPrefix || !newVoice) return;
          folderVoices[newPrefix] = newVoice;
          await this.plugin.saveSettings();
          this.display();
        }),
      );
  }

  private voiceHintForEngine(engine: TtsEngine): string {
    switch (engine) {
      case "browser":
        return "System voice name, e.g. 'Samantha', 'Alex', 'Daniel'. Leave blank for the system default.";
      case "elevenlabs":
        return "ElevenLabs voice_id (22-char string from your ElevenLabs voice library).";
      case "openai":
        return "One of: alloy, echo, fable, onyx, nova, shimmer.";
      case "piper":
        return "Voice name (e.g. en_US-lessac-medium). Leave blank to use whatever voice the Piper server was launched with.";
    }
  }

  private voicePlaceholder(engine: TtsEngine): string {
    switch (engine) {
      case "browser":
        return "Samantha";
      case "elevenlabs":
        return "21m00Tcm4TlvDq8ikWAM";
      case "openai":
        return "alloy";
      case "piper":
        return "en_US-lessac-medium";
    }
  }
}
