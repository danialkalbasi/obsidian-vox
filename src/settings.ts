import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type VoxPlugin from "./main";
import { AudioCache } from "./tts/cache";
import { OPENAI_VOICES, SPEED_LIMITS } from "./constants";
import { VoiceBrowserModal } from "./voice-browser";

export type TtsEngine = "browser" | "elevenlabs" | "openai";

export interface VoxSettings {
  /** Active provider — only one runs at a time. */
  engine: TtsEngine;

  /** Playback rate for `<audio>` and browser synth (1.0 = natural). */
  rate: number;

  /** Per-engine default voices — never mix with API keys. */
  voiceBrowser: string;
  voiceOpenai: string;
  voiceElevenlabs: string;

  elevenlabsApiKey: string;
  openaiApiKey: string;

  elevenlabsModel: string;

  /** Named voice library for ElevenLabs. */
  elevenlabsVoices: Array<{ name: string; id: string }>;

  openaiModel: "tts-1" | "tts-1-hd";
  openaiInstructions: string;

  folderVoicesByEngine: Record<TtsEngine, Record<string, string>>;

  /** Whether to show a notice when playback starts. */
  showStartNotice: boolean;

  cacheEnabled: boolean;

  /** Development helper: reload this plugin when built files change. */
  devReloadEnabled: boolean;
}

export const DEFAULT_SETTINGS: VoxSettings = {
  engine: "elevenlabs",
  rate: 0.85,
  voiceBrowser: "",
  voiceOpenai: "alloy",
  voiceElevenlabs: "",
  elevenlabsApiKey: "",
  openaiApiKey: "",
  elevenlabsModel: "eleven_turbo_v2_5",
  elevenlabsVoices: [],
  openaiModel: "tts-1",
  openaiInstructions: "",
  folderVoicesByEngine: {
    browser: {},
    elevenlabs: {},
    openai: {},
  },
  showStartNotice: true,
  cacheEnabled: false,
  devReloadEnabled: false,
};

function section(containerEl: HTMLElement, title: string, desc?: string) {
  new Setting(containerEl).setName(title).setHeading();
  if (desc) {
    containerEl.createEl("p", { text: desc, cls: "setting-item-description" });
  }
}

export class VoxSettingTab extends PluginSettingTab {
  private plugin: VoxPlugin;

  constructor(app: App, plugin: VoxPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl).setName("Vox").setHeading();

    new Setting(containerEl)
      .setName("Provider")
      .setDesc("Which service reads your notes aloud.")
      .addDropdown((dd) =>
        dd
          .addOption("elevenlabs", "Voice library")
          .addOption("openai", "Generated voices")
          .addOption("browser", "Browser (free, no account needed)")
          .setValue(s.engine)
          .onChange(async (value) => {
            s.engine = value as TtsEngine;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    const [minSpeed, maxSpeed, step] = SPEED_LIMITS[s.engine];
    const clampedRate = Math.min(maxSpeed, Math.max(minSpeed, s.rate));
    new Setting(containerEl)
      .setName("Speed")
      .setDesc(`Playback speed. 1.0 is normal. Range: ${minSpeed}x – ${maxSpeed}x.`)
      .addSlider((sl) =>
        sl
          .setLimits(minSpeed, maxSpeed, step)
          .setValue(clampedRate)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.rate = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Show start notification")
      .setDesc('Show a notice like "vox: reading ..." when playback begins.')
      .addToggle((tg) =>
        tg.setValue(s.showStartNotice).onChange(async (value) => {
          s.showStartNotice = value;
          await this.plugin.saveSettings();
        }),
      );

    // ── Provider-specific settings ────────────────────────────────
    if (s.engine === "browser") {
      section(containerEl, "Browser");
      new Setting(containerEl)
        .setName("Voice")
        .setDesc("Name of the voice to use, e.g. Samantha or alex on macOS. Leave blank for the system default.")
        .addText((t) =>
          t
            .setPlaceholder("Samantha")
            .setValue(s.voiceBrowser)
            .onChange(async (v) => {
              s.voiceBrowser = v;
              await this.plugin.saveSettings();
            }),
        );
    }

    if (s.engine === "openai") {
      section(containerEl, "OpenAI");
      new Setting(containerEl)
        .setName("API key")
        .setDesc("Paste your key here.")
        .addText((t) =>
          t
            .setPlaceholder("Paste your API key")
            .setValue(s.openaiApiKey)
            .onChange(async (v) => {
              s.openaiApiKey = v;
              await this.plugin.saveSettings();
            }),
        );
      new Setting(containerEl)
        .setName("Model")
        .setDesc("Standard is faster, hd sounds better.")
        .addDropdown((dd) =>
          dd
            .addOption("tts-1", "Standard")
            .addOption("tts-1-hd", "HD")
            .setValue(s.openaiModel)
            .onChange(async (v) => {
              s.openaiModel = v as "tts-1" | "tts-1-hd";
              await this.plugin.saveSettings();
            }),
        );
      new Setting(containerEl)
        .setName("Voice")
        .setDesc("The character of the voice.")
        .addDropdown((dd) => {
          for (const v of OPENAI_VOICES) {
            dd.addOption(v, v);
          }
          return dd
            .setValue(s.voiceOpenai)
            .onChange(async (v) => {
              s.voiceOpenai = v;
              await this.plugin.saveSettings();
            });
        });
      new Setting(containerEl)
        .setName("Tone")
        .setDesc("How the voice delivers the text.")
        .addDropdown((dd) => {
          const tones: Record<string, string> = {
            "": "(none)",
            "Speak in a calm and warm tone.": "Calm and warm",
            "Speak in a natural, conversational tone.": "Conversational",
            "Speak like a professional news anchor.": "News anchor",
            "Speak in a storytelling tone, with natural pacing and expression.": "Storytelling",
            "Speak in an energetic and upbeat tone.": "Energetic",
          };
          for (const [val, label] of Object.entries(tones)) {
            dd.addOption(val, label);
          }
          return dd
            .setValue(s.openaiInstructions)
            .onChange(async (v) => {
              s.openaiInstructions = v;
              await this.plugin.saveSettings();
            });
        });
    }

    if (s.engine === "elevenlabs") {
      section(containerEl, "ElevenLabs");
      new Setting(containerEl)
        .setName("API key")
        .setDesc("Paste your key here. Find it in your profile settings.")
        .addText((t) =>
          t
            .setPlaceholder("Paste your API key")
            .setValue(s.elevenlabsApiKey)
            .onChange(async (v) => {
              s.elevenlabsApiKey = v;
              await this.plugin.saveSettings();
            }),
        );
      new Setting(containerEl)
        .setName("Model")
        .setDesc("Turbo v2.5 is faster. Multilingual v2 supports more languages.")
        .addDropdown((dd) =>
          dd
            .addOption("eleven_turbo_v2_5", "Turbo v2.5")
            .addOption("eleven_multilingual_v2", "Multilingual v2")
            .setValue(s.elevenlabsModel)
            .onChange(async (v) => {
              s.elevenlabsModel = v;
              await this.plugin.saveSettings();
            }),
        );
      // Add voice row
      section(containerEl, "Voices");

      const browseSetting = new Setting(containerEl)
        .setName("Browse voices")
        .setDesc("Search the full voice library, preview, and add in one step.")
        .addButton((b) =>
          b
            .setButtonText("Browse voices")
            .setCta()
            .setDisabled(!s.elevenlabsApiKey)
            .onClick(() => new VoiceBrowserModal(this.plugin, () => this.display()).open()),
        );

      // Saved voices as chips — click to set as default, × to remove
      if (s.elevenlabsVoices.length > 0) {
        const tags = browseSetting.settingEl.createDiv({ cls: "vox-voice-tags" });
        for (const voice of s.elevenlabsVoices) {
          const isDefault = s.voiceElevenlabs === voice.id;
          const chip = tags.createSpan({
            cls: "vox-voice-chip" + (isDefault ? " vox-voice-chip--active" : ""),
            title: isDefault ? "Default" : "Click to set as default",
          });
          chip.createSpan({ text: voice.name, cls: "vox-voice-chip-name" });
          chip.addEventListener("click", (e) => {
            if ((e.target as HTMLElement).closest(".vox-voice-chip-remove")) return;
            s.voiceElevenlabs = voice.id;
            void this.plugin.saveSettings().then(
              () => this.display(),
              (err) => console.error("Vox: failed to save ElevenLabs voice", err),
            );
          });
          const x = chip.createSpan({ cls: "vox-voice-chip-remove", text: "×" });
          x.addEventListener("click", () => {
            s.elevenlabsVoices = s.elevenlabsVoices.filter((v) => v.id !== voice.id);
            if (s.voiceElevenlabs === voice.id) s.voiceElevenlabs = s.elevenlabsVoices[0]?.id ?? "";
            void this.plugin.saveSettings().then(
              () => this.display(),
              (err) => console.error("Vox: failed to remove ElevenLabs voice", err),
            );
          });
        }
      }
    }

    // ── Cache ────────────────────────────────────────────────────
    if (s.engine === "openai" || s.engine === "elevenlabs") {
      new Setting(containerEl)
        .setName("Cache audio")
        .setDesc("Reuse generated audio for identical text, voice, model, tone, and speed.")
        .addToggle((tg) =>
          tg.setValue(s.cacheEnabled).onChange(async (v) => {
            s.cacheEnabled = v;
            await this.plugin.saveSettings();
          }),
        )
        .addButton((button) =>
          button.setButtonText("Clear").onClick(async () => {
            await new AudioCache(this.plugin).clear();
            new Notice("Vox: audio cache cleared.");
          }),
        );
    }

    // ── Folder personas ──────────────────────────────────────────
    section(containerEl, "Folder voices");

    const folderVoices = s.folderVoicesByEngine[s.engine];
    const elevenlabsVoiceOptions = s.engine === "elevenlabs" && s.elevenlabsVoices.length > 0
      ? s.elevenlabsVoices
      : null;

    for (const prefix of Object.keys(folderVoices)) {
      const setting = new Setting(containerEl).setName(prefix);
      if (elevenlabsVoiceOptions) {
        setting.addDropdown((dd) => {
          for (const v of elevenlabsVoiceOptions) dd.addOption(v.id, v.name);
          return dd.setValue(folderVoices[prefix]).onChange(async (v) => {
            folderVoices[prefix] = v;
            await this.plugin.saveSettings();
          });
        });
      } else {
        setting.addText((t) =>
          t.setValue(folderVoices[prefix]).onChange(async (v) => {
            folderVoices[prefix] = v;
            await this.plugin.saveSettings();
          }),
        );
      }
      setting.addExtraButton((b) =>
        b.setIcon("trash").setTooltip("Remove").onClick(async () => {
          delete folderVoices[prefix];
          await this.plugin.saveSettings();
          this.display();
        }),
      );
    }

    let newPrefix = "";
    let newVoice = elevenlabsVoiceOptions?.[0]?.id ?? "";
    const addFolderSetting = new Setting(containerEl)
      .setName("Add folder mapping")
      .setDesc("Map a folder prefix to a voice. The longest matching prefix wins. Override per note with voice: \"name\" in frontmatter.")
      .addText((t) => t.setPlaceholder("Philosophy/").onChange((v) => (newPrefix = v)));
    if (elevenlabsVoiceOptions) {
      addFolderSetting.addDropdown((dd) => {
        for (const v of elevenlabsVoiceOptions) dd.addOption(v.id, v.name);
        return dd.setValue(newVoice).onChange((v) => (newVoice = v));
      });
    } else {
      addFolderSetting.addText((t) => t.setPlaceholder("Voice ID").onChange((v) => (newVoice = v)));
    }
    addFolderSetting.addButton((b) =>
      b.setButtonText("Add").onClick(async () => {
        if (!newPrefix || !newVoice) return;
        folderVoices[newPrefix] = newVoice;
        await this.plugin.saveSettings();
        this.display();
      }),
    );

    section(containerEl, "Development");
    new Setting(containerEl)
      .setName("Auto-reload while developing")
      .setDesc("Reload the plugin when a built file changes.")
      .addToggle((tg) =>
        tg.setValue(s.devReloadEnabled).onChange(async (value) => {
          s.devReloadEnabled = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
