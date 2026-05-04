import {
  Notice,
  Plugin,
  MarkdownView,
  TFile,
  addIcon,
  normalizePath,
  setIcon,
} from "obsidian";
import { DEFAULT_SETTINGS, VoxSettings, VoxSettingTab } from "./settings";
import { Player, PlayerState } from "./player";
import { stripMarkdown } from "./markdown";
import { createProvider, TtsProvider } from "./tts/provider";
import { OPENAI_VOICES, SPEED_LIMITS } from "./constants";

/**
 * Vox plugin entry point.
 *
 * Responsibilities:
 *   1. Register UI affordances: read ribbon icon, voice/playback popover,
 *      editor menu item, command palette commands.
 *   2. Hold the singleton TTS `Player` and mirror its state in the ribbon
 *      icon + popover controls.
 *   3. Load/save `VoxSettings`, including per-folder voice overrides.
 *
 * The heavy lifting lives in `player.ts`, `markdown.ts`, and `tts/`.
 * This file just wires things together.
 */

const ICON_READ = "vox-read";
const ICON_PAUSE = "vox-pause";
const ICON_PLAY = "vox-play";
const ICON_STOP = "vox-stop";
const DEV_RELOAD_FILES = ["main.js", "styles.css", "manifest.json"];

type PluginManager = {
  disablePlugin(id: string): Promise<void>;
  enablePlugin(id: string): Promise<void>;
};

/** Move HTML `title` to `data-vox-title-stash` on `root` and descendants so the native tooltip does not compete with custom UI. */
function stashNativeTitles(root: HTMLElement) {
  const candidates = [
    root,
    ...Array.from(root.querySelectorAll<HTMLElement>("[title]")),
  ];
  for (const el of [...new Set(candidates)]) {
    const t = el.getAttribute("title");
    if (!t) continue;
    el.setAttribute("data-vox-title-stash", t);
    el.removeAttribute("title");
  }
}

function restoreNativeTitles(root: HTMLElement) {
  const withStash: HTMLElement[] = [];
  if (root.hasAttribute("data-vox-title-stash")) withStash.push(root);
  withStash.push(
    ...Array.from(root.querySelectorAll<HTMLElement>("[data-vox-title-stash]")),
  );
  for (const el of [...new Set(withStash)]) {
    const t = el.getAttribute("data-vox-title-stash");
    if (t) el.setAttribute("title", t);
    else el.removeAttribute("title");
    el.removeAttribute("data-vox-title-stash");
  }
}

const ICONS: Record<string, string> = {
  [ICON_READ]: `
<svg viewBox="0 0 25 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M10.0052 4.65867C11.4562 3.36887 13.75 4.39892 13.75 6.34034V17.6598C13.75 19.6012 11.4562 20.6313 10.0052 19.3415L6.80862 16.5001H4.75C3.50736 16.5001 2.5 15.4927 2.5 14.2501V9.75009C2.5 8.50745 3.50736 7.50009 4.75 7.50009H6.80858L10.0052 4.65867ZM12.25 6.34034C12.25 5.6932 11.4854 5.34985 11.0017 5.77978L7.592 8.81064C7.45472 8.93268 7.27742 9.00009 7.09373 9.00009H4.75C4.33579 9.00009 4 9.33587 4 9.75009V14.2501C4 14.6643 4.33579 15.0001 4.75 15.0001H7.09377C7.27745 15.0001 7.45475 15.0675 7.59204 15.1895L11.0017 18.2204C11.4854 18.6503 12.25 18.3069 12.25 17.6598V6.34034Z" fill="currentColor"/>
  <path d="M17.0769 15.1644C18.6384 13.4253 18.6384 10.5756 17.0769 8.83653C16.8001 8.52833 16.8256 8.05414 17.1338 7.7774C17.442 7.50066 17.9162 7.52617 18.193 7.83437C20.2664 10.1435 20.2664 13.8574 18.193 16.1665C17.9162 16.4747 17.442 16.5002 17.1338 16.2235C16.8256 15.9468 16.8001 15.4726 17.0769 15.1644Z" fill="currentColor"/>
  <path d="M14.9853 10.6534C15.6729 11.4179 15.6729 12.5831 14.9853 13.3476C14.7084 13.6556 14.7335 14.1298 15.0415 14.4068C15.3495 14.6838 15.8237 14.6586 16.1007 14.3506C17.3011 13.0157 17.3011 10.9852 16.1007 9.65036C15.8237 9.34236 15.3495 9.31721 15.0415 9.59418C14.7335 9.87115 14.7084 10.3454 14.9853 10.6534Z" fill="currentColor"/>
</svg>`,
  [ICON_PAUSE]: `
<svg viewBox="0 0 25 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M7 3.25C5.75736 3.25 4.75 4.25736 4.75 5.5V18.4999C4.75 19.7426 5.75736 20.75 7 20.75H8.75C9.99264 20.75 11 19.7426 11 18.4999V5.5C11 4.25736 9.99264 3.25 8.75 3.25H7ZM6.25 5.5C6.25 5.08579 6.58579 4.75 7 4.75H8.75C9.16421 4.75 9.5 5.08579 9.5 5.5V18.4999C9.5 18.9142 9.16421 19.2499 8.75 19.2499H7C6.58579 19.2499 6.25 18.9142 6.25 18.4999V5.5Z" fill="currentColor"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M16.25 3.25C15.0074 3.25 14 4.25736 14 5.5V18.4999C14 19.7426 15.0074 20.75 16.25 20.75H18C19.2426 20.75 20.25 19.7426 20.25 18.4999V5.5C20.25 4.25736 19.2426 3.25 18 3.25H16.25ZM15.5 5.5C15.5 5.08579 15.8358 4.75 16.25 4.75H18C18.4142 4.75 18.75 5.08579 18.75 5.5V18.4999C18.75 18.9142 18.4142 19.2499 18 19.2499H16.25C15.8358 19.2499 15.5 18.9142 15.5 18.4999V5.5Z" fill="currentColor"/>
</svg>`,
  [ICON_PLAY]: `
<svg viewBox="0 0 25 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M19.4357 13.9174C20.8659 13.0392 20.8659 10.9608 19.4357 10.0826L9.55234 4.01389C8.05317 3.09335 6.125 4.17205 6.125 5.93128L6.125 18.0688C6.125 19.828 8.05317 20.9067 9.55234 19.9861L19.4357 13.9174ZM18.6508 11.3609C19.1276 11.6536 19.1276 12.3464 18.6508 12.6391L8.76745 18.7079C8.26772 19.0147 7.625 18.6552 7.625 18.0688L7.625 5.93128C7.625 5.34487 8.26772 4.9853 8.76745 5.29215L18.6508 11.3609Z" fill="currentColor"/>
</svg>`,
  [ICON_STOP]: `
<svg viewBox="0 0 25 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M10.5 7.75C9.25736 7.75 8.25 8.75736 8.25 10V14C8.25 15.2426 9.25736 16.25 10.5 16.25H14.5C15.7426 16.25 16.75 15.2426 16.75 14V10C16.75 8.75736 15.7426 7.75 14.5 7.75H10.5ZM9.75 10C9.75 9.58579 10.0858 9.25 10.5 9.25H14.5C14.9142 9.25 15.25 9.58579 15.25 10V14C15.25 14.4142 14.9142 14.75 14.5 14.75H10.5C10.0858 14.75 9.75 14.4142 9.75 14V10Z" fill="currentColor"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M12.5 2C6.97715 2 2.5 6.47715 2.5 12C2.5 17.5228 6.97715 22 12.5 22C18.0228 22 22.5 17.5228 22.5 12C22.5 6.47715 18.0228 2 12.5 2ZM4 12C4 7.30558 7.80558 3.5 12.5 3.5C17.1944 3.5 21 7.30558 21 12C21 16.6944 17.1944 20.5 12.5 20.5C7.80558 20.5 4 16.6944 4 12Z" fill="currentColor"/>
</svg>`,
};

export default class VoxPlugin extends Plugin {
  settings!: VoxSettings;
  player!: Player;
  private provider!: TtsProvider;

  // UI elements whose appearance depends on player state. Held as fields
  // so the state listener can mutate them without re-querying.
  private readRibbonEl: HTMLElement | null = null;
  private unsubscribeState: (() => void) | null = null;
  private pendingVoice: string | null = null;
  private voicePickerEl: HTMLElement | null = null;
  private tooltipObserver: MutationObserver | null = null;
  private timerInterval: number | null = null;
  private timerEl: HTMLElement | null = null;
  private voicePickerCloseTimer: number | null = null;
  private speedSaveTimer: number | null = null;
  private devReloadInterval: number | null = null;
  private devReloadSnapshot: Record<string, string> = {};
  private devReloading = false;

  async onload() {
    await this.loadSettings();

    for (const [id, svg] of Object.entries(ICONS)) {
      addIcon(id, svg.trim());
    }

    this.provider = createProvider(this.settings, this);
    this.player = new Player(this.provider);

    // ── Ribbon icons ────────────────────────────────────────────
    // Single icon: click reads when idle; during playback, controls live
    // in the popover so pause/stop stay grouped with voice controls.
    this.readRibbonEl = this.addRibbonIcon(ICON_READ, "Vox: read current note", () => {
      if (this.player.getState() === "idle") {
        void this.readActiveNote().catch((err) => {
          console.error("Vox: failed to read active note", err);
        });
      } else {
        this.openVoicePicker(this.readRibbonEl);
      }
    });
    this.readRibbonEl.addClass("vox-ribbon");
    this.registerVoicePicker(this.readRibbonEl);

    // ── Commands (palette + hotkeys) ────────────────────────────
    this.addCommand({
      id: "read-active-note",
      name: "Read active note aloud",
      callback: async () => {
        await this.readActiveNote();
      },
    });

    this.addCommand({
      id: "stop-reading",
      name: "Stop reading",
      callback: () => this.player.stop(),
    });

    this.addCommand({
      id: "toggle-play-pause",
      name: "Toggle play / pause",
      callback: () => this.player.togglePause(),
    });

    // ── File menu entry ─────────────────────────────────────────
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) => {
          item
            .setTitle("Vox: read aloud")
            .setIcon(ICON_READ)
            .onClick(async () => {
              await this.readFile(file);
            });
        });
      }),
    );

    // Subscribe once, paint initial state.
    this.unsubscribeState = this.player.onStateChange((s) =>
      this.renderState(s),
    );
    void this.configureDevReload();

    this.addSettingTab(new VoxSettingTab(this.app, this));
  }

  onunload() {
    this.unsubscribeState?.();
    this.player?.stop();
    if (this.voicePickerCloseTimer !== null) {
      window.clearTimeout(this.voicePickerCloseTimer);
      this.voicePickerCloseTimer = null;
    }
    if (this.speedSaveTimer !== null) {
      window.clearTimeout(this.speedSaveTimer);
      this.speedSaveTimer = null;
      void this.saveData(this.settings).catch((err) => {
        console.error("Vox: failed to flush settings on unload", err);
      });
    }
    this.stopTimer();
    this.stopDevReload();
    this.closeVoicePicker();
    this.stopSuppressingRibbonTooltip();
  }

  private pluginDir(): string {
    return normalizePath(
      this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`,
    );
  }

  private pluginManager(): PluginManager | null {
    const maybeApp = this.app as typeof this.app & {
      plugins?: Partial<PluginManager>;
    };
    const plugins = maybeApp.plugins;
    if (
      typeof plugins?.disablePlugin !== "function" ||
      typeof plugins?.enablePlugin !== "function"
    ) {
      return null;
    }
    return plugins as PluginManager;
  }

  private async statReloadFiles(): Promise<Record<string, string>> {
    const next: Record<string, string> = {};
    for (const file of DEV_RELOAD_FILES) {
      const path = normalizePath(`${this.pluginDir()}/${file}`);
      const stat = await this.app.vault.adapter.stat(path);
      next[file] = stat ? `${stat.mtime}:${stat.size}` : "missing";
    }
    return next;
  }

  private async reloadPlugin() {
    if (this.devReloading) return;
    const manager = this.pluginManager();
    if (!manager) {
      console.warn("Vox: Obsidian plugin manager is unavailable for auto-reload.");
      return;
    }

    this.devReloading = true;
    this.stopDevReload();
    new Notice("Vox: reloading plugin...");
    await manager.disablePlugin(this.manifest.id);
    await manager.enablePlugin(this.manifest.id);
  }

  private stopDevReload() {
    if (this.devReloadInterval !== null) {
      window.clearInterval(this.devReloadInterval);
      this.devReloadInterval = null;
    }
  }

  async configureDevReload() {
    this.stopDevReload();
    this.devReloadSnapshot = {};
    if (!this.settings.devReloadEnabled) return;

    this.devReloadSnapshot = await this.statReloadFiles();
    this.devReloadInterval = window.setInterval(() => {
      this.statReloadFiles()
        .then((next) => {
          const changed = DEV_RELOAD_FILES.some(
            (file) => next[file] !== this.devReloadSnapshot[file],
          );
          if (!changed) return;
          this.devReloadSnapshot = next;
          void this.reloadPlugin();
        })
        .catch((err) => {
          console.warn("Vox: dev auto-reload check failed", err);
        });
    }, 800);
  }

  private hideMatchingRibbonTooltips(label: string) {
    const normalized = label.trim();
    if (!normalized) return;

    for (const tooltip of Array.from(
      activeDocument.body.querySelectorAll<HTMLElement>(".tooltip"),
    )) {
      if (tooltip.getAttribute("data-vox-hidden-tooltip") === "true") continue;
      if (tooltip.textContent?.trim() !== normalized) continue;
      tooltip.setAttribute("data-vox-hidden-tooltip", "true");
      tooltip.addClass("vox-hidden-tooltip");
    }
  }

  private startSuppressingRibbonTooltip(label: string) {
    this.stopSuppressingRibbonTooltip();
    const normalized = label.trim();
    if (!normalized) return;

    this.hideMatchingRibbonTooltips(normalized);
    this.tooltipObserver = new MutationObserver(() => {
      this.hideMatchingRibbonTooltips(normalized);
    });
    this.tooltipObserver.observe(activeDocument.body, {
      childList: true,
      subtree: true,
    });
  }

  private stopSuppressingRibbonTooltip() {
    this.tooltipObserver?.disconnect();
    this.tooltipObserver = null;

    for (const tooltip of Array.from(
      activeDocument.body.querySelectorAll<HTMLElement>(
        '.tooltip[data-vox-hidden-tooltip="true"]',
      ),
    )) {
      tooltip.removeClass("vox-hidden-tooltip");
      tooltip.removeAttribute("data-vox-hidden-tooltip");
    }
  }

  private formatElapsed(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  private updateTimer() {
    this.timerEl?.setText(this.formatElapsed(this.player.getElapsedSeconds()));
  }

  private startTimer() {
    this.stopTimer();
    this.updateTimer();
    this.timerInterval = window.setInterval(() => this.updateTimer(), 1000);
  }

  private stopTimer() {
    if (this.timerInterval !== null) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.timerEl = null;
  }

  private normalizeSettings(
    raw: (Record<string, unknown> & {
      defaultVoice?: string;
      folderVoices?: Record<string, string>;
      folderVoicesByEngine?: Partial<
        Record<VoxSettings["engine"], Record<string, string>>
      >;
    }) | null,
  ): VoxSettings & {
    defaultVoice?: string;
    folderVoices?: Record<string, string>;
  } {
    const merged = Object.assign(
      {},
      DEFAULT_SETTINGS,
      raw ?? {},
    ) as VoxSettings & {
      defaultVoice?: string;
      folderVoices?: Record<string, string>;
    };

    const engines: VoxSettings["engine"][] = ["browser", "elevenlabs", "openai"];
    const isEngine = (value: unknown): value is VoxSettings["engine"] =>
      typeof value === "string" && engines.includes(value as VoxSettings["engine"]);
    const isOpenAiVoice = (
      value: unknown,
    ): value is (typeof OPENAI_VOICES)[number] =>
      typeof value === "string" &&
      OPENAI_VOICES.includes(value as (typeof OPENAI_VOICES)[number]);
    const asVoiceMap = (value: unknown): Record<string, string> => {
      if (!value || typeof value !== "object") return {};
      return Object.fromEntries(
        Object.entries(value).filter(
          ([key, voice]) => typeof key === "string" && typeof voice === "string",
        ),
      );
    };

    merged.engine = isEngine(raw?.engine) ? raw.engine : DEFAULT_SETTINGS.engine;

    const [minSpeed, maxSpeed] = SPEED_LIMITS[merged.engine];
    const rate =
      typeof raw?.rate === "number" && Number.isFinite(raw.rate)
        ? raw.rate
        : DEFAULT_SETTINGS.rate;
    merged.rate = Math.min(maxSpeed, Math.max(minSpeed, rate));

    merged.voiceBrowser =
      typeof raw?.voiceBrowser === "string"
        ? raw.voiceBrowser
        : DEFAULT_SETTINGS.voiceBrowser;
    merged.voiceOpenai =
      isOpenAiVoice(raw?.voiceOpenai)
        ? raw.voiceOpenai
        : DEFAULT_SETTINGS.voiceOpenai;
    merged.voiceElevenlabs =
      typeof raw?.voiceElevenlabs === "string"
        ? raw.voiceElevenlabs
        : DEFAULT_SETTINGS.voiceElevenlabs;

    merged.elevenlabsApiKey =
      typeof raw?.elevenlabsApiKey === "string"
        ? raw.elevenlabsApiKey
        : DEFAULT_SETTINGS.elevenlabsApiKey;
    merged.openaiApiKey =
      typeof raw?.openaiApiKey === "string"
        ? raw.openaiApiKey
        : DEFAULT_SETTINGS.openaiApiKey;
    merged.elevenlabsModel =
      raw?.elevenlabsModel === "eleven_turbo_v2_5" ||
      raw?.elevenlabsModel === "eleven_multilingual_v2"
        ? raw.elevenlabsModel
        : DEFAULT_SETTINGS.elevenlabsModel;
    merged.openaiModel =
      raw?.openaiModel === "tts-1" || raw?.openaiModel === "tts-1-hd"
        ? raw.openaiModel
        : DEFAULT_SETTINGS.openaiModel;
    merged.openaiInstructions =
      typeof raw?.openaiInstructions === "string"
        ? raw.openaiInstructions
        : DEFAULT_SETTINGS.openaiInstructions;
    merged.showStartNotice =
      typeof raw?.showStartNotice === "boolean"
        ? raw.showStartNotice
        : DEFAULT_SETTINGS.showStartNotice;
    merged.cacheEnabled =
      typeof raw?.cacheEnabled === "boolean"
        ? raw.cacheEnabled
        : DEFAULT_SETTINGS.cacheEnabled;
    merged.devReloadEnabled =
      typeof raw?.devReloadEnabled === "boolean"
        ? raw.devReloadEnabled
        : DEFAULT_SETTINGS.devReloadEnabled;

    merged.elevenlabsVoices = Array.isArray(raw?.elevenlabsVoices)
      ? raw.elevenlabsVoices.flatMap((voice) => {
          if (!voice || typeof voice !== "object") return [];
          const candidate = voice as { name?: unknown; id?: unknown };
          return typeof candidate.name === "string" && typeof candidate.id === "string"
            ? [{ name: candidate.name, id: candidate.id }]
            : [];
        })
      : DEFAULT_SETTINGS.elevenlabsVoices;

    merged.folderVoicesByEngine = {
      browser: asVoiceMap(raw?.folderVoicesByEngine?.browser),
      elevenlabs: asVoiceMap(raw?.folderVoicesByEngine?.elevenlabs),
      openai: asVoiceMap(raw?.folderVoicesByEngine?.openai),
    };

    return merged;
  }

  /**
   * Repaint the ribbon icon to reflect player state. Called synchronously by
   * the Player's state-change event.
   */
  private renderState(state: PlayerState) {
    if (this.readRibbonEl) {
      const icon = state === "idle" ? ICON_READ : state === "playing" ? ICON_PAUSE : ICON_PLAY;
      const label = state === "idle" ? "Vox: read current note" : "Vox: playback controls";
      setIcon(this.readRibbonEl, icon);
      this.readRibbonEl.setAttribute("aria-label", label);
    }

    if (state === "playing") this.startTimer();
    else this.stopTimer();

    if (this.voicePickerEl) this.openVoicePicker(this.readRibbonEl);
  }

  async readActiveNote() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!file) {
      new Notice("Vox: no active note to read.");
      return;
    }
    await this.readFile(file);
  }

  async readFile(file: TFile) {
    this.player.stop();

    const raw = await this.app.vault.cachedRead(file);
    const text = stripMarkdown(raw);
    if (!text.trim()) {
      new Notice("The note is empty after stripping markdown.");
      return;
    }

    const voice = this.pendingVoice ?? this.resolveVoice(file);
    this.pendingVoice = null;

    try {
      this.player.setRate(this.settings.rate);
      await this.player.play(text, voice);
      if (this.settings.showStartNotice) {
        new Notice(`Vox: reading "${file.basename}"...`);
      }
    } catch (err) {
      console.error("Vox playback failed:", err);
      new Notice(`Vox: ${(err as Error).message}`);
    }
  }

  private getVoices(): { label: string; id: string }[] {
    const { engine, elevenlabsVoices } = this.settings;
    if (engine === "elevenlabs") {
      return elevenlabsVoices.map((v) => ({ label: v.name, id: v.id }));
    }
    if (engine === "openai") {
      return OPENAI_VOICES.map((v) => ({ label: v, id: v }));
    }
    return [];
  }

  private getDefaultVoice(): string {
    if (this.settings.engine === "elevenlabs")
      return this.settings.voiceElevenlabs;
    if (this.settings.engine === "openai") return this.settings.voiceOpenai;
    return this.settings.voiceBrowser;
  }

  private async setDefaultVoice(voice: string) {
    if (this.settings.engine === "elevenlabs") {
      this.settings.voiceElevenlabs = voice;
    } else if (this.settings.engine === "openai") {
      this.settings.voiceOpenai = voice;
    } else {
      this.settings.voiceBrowser = voice;
    }
    await this.saveSettings();
  }

  private selectVoice(voice: string) {
    this.pendingVoice = voice;
    this.setDefaultVoice(voice).catch((err) => {
      console.error("Vox: failed to save default voice", err);
    });
    this.closeVoicePicker();
    void this.readActiveNote().catch((err) => {
      console.error("Vox: failed to read active note", err);
    });
  }

  private providerLabel(): string {
    switch (this.settings.engine) {
      case "elevenlabs":
        return "ElevenLabs";
      case "openai":
        return "OpenAI";
      case "browser":
        return "Browser";
    }
  }

  private closeVoicePicker() {
    const anchor = this.readRibbonEl;
    this.voicePickerEl?.remove();
    this.voicePickerEl = null;
    const label = anchor?.getAttribute("data-vox-label");
    if (anchor && label) anchor.setAttribute("aria-label", label);
    this.stopSuppressingRibbonTooltip();
    if (anchor) restoreNativeTitles(anchor);
  }

  private renderPlaybackControls(picker: HTMLElement, state: PlayerState) {
    if (state === "idle") return;

    const playback = picker.createDiv({
      cls: "vox-voice-picker-playback" + (state === "playing" ? " vox-voice-picker-playback--playing" : ""),
    });
    const copy = playback.createDiv({ cls: "vox-voice-picker-playback-copy" });
    copy.createDiv({
      cls: "vox-voice-picker-playback-title",
      text: state === "playing" ? "Reading" : "Paused",
    });
    this.timerEl = copy.createDiv({ cls: "vox-voice-picker-timer" });
    this.updateTimer();

    const controls = playback.createDiv({ cls: "vox-voice-picker-controls" });
    const toggleButton = controls.createEl("button", {
      cls: "vox-voice-picker-control-button",
      attr: {
        "aria-label": state === "playing" ? "Pause" : "Resume",
        title: state === "playing" ? "Pause" : "Resume",
      },
    });
    setIcon(toggleButton, state === "playing" ? ICON_PAUSE : ICON_PLAY);
    toggleButton.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    toggleButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.player.togglePause();
    });

    const stopButton = controls.createEl("button", {
      cls: "vox-voice-picker-control-button vox-voice-picker-control-button--danger",
      attr: { "aria-label": "Stop", title: "Stop" },
    });
    setIcon(stopButton, ICON_STOP);
    stopButton.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    stopButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.player.stop();
      this.closeVoicePicker();
    });
  }

  private openVoicePicker(anchor: HTMLElement | null) {
    if (!anchor) return;
    const voices = this.getVoices();

    this.closeVoicePicker();

    // Stash aria-label + HTML title and clear them so Obsidian's / the
    // browser's native tooltip doesn't appear alongside the picker.
    anchor.setAttribute("data-vox-label", anchor.getAttribute("aria-label") ?? "");
    const label = anchor.getAttribute("data-vox-label") ?? "";
    anchor.removeAttribute("aria-label");
    stashNativeTitles(anchor);
    this.startSuppressingRibbonTooltip(label);

    const picker = activeDocument.body.createDiv({ cls: "vox-voice-picker" });
    this.voicePickerEl = picker;

    const header = picker.createDiv({ cls: "vox-voice-picker-header" });
    const titleWrap = header.createDiv();
    titleWrap.createDiv({ cls: "vox-voice-picker-kicker", text: this.providerLabel() });
    titleWrap.createDiv({ cls: "vox-voice-picker-title", text: "Select a voice" });

    const state = this.player.getState();
    this.renderPlaybackControls(picker, state);

    const voicesWrap = picker.createDiv({ cls: "vox-voice-picker-list" });
    const defaultVoice = this.getDefaultVoice();
    const activeId = this.pendingVoice ?? defaultVoice;
    if (voices.length === 0) {
      voicesWrap.createDiv({
        cls: "vox-voice-picker-empty",
        text:
          this.settings.engine === "elevenlabs"
            ? "No voices yet. Add an ElevenLabs voice in settings."
            : "No voices available for this provider.",
      });
    }

    voices.forEach((voice, index) => {
      const isDefault = voice.id === defaultVoice;
      const item = voicesWrap.createDiv({
        cls:
          "vox-voice-picker-item" +
          (voice.id === activeId ? " vox-voice-picker-item--active" : ""),
      });
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");

      const avatar = item.createDiv({
        cls: `vox-voice-picker-avatar vox-voice-picker-avatar--${index % 10}`,
      });
      setIcon(avatar, "audio-lines");

      const body = item.createDiv({ cls: "vox-voice-picker-item-body" });
      body.createDiv({ cls: "vox-voice-picker-name", text: voice.label });
      if (isDefault) {
        body.createDiv({ cls: "vox-voice-picker-meta", text: "Default" });
      }

      const checkEl = item.createDiv({ cls: "vox-voice-picker-item-check" });
      setIcon(checkEl, "check");

      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.selectVoice(voice.id);
      });
      item.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        this.selectVoice(voice.id);
      });
    });

    const [minSpeed, maxSpeed, step] = SPEED_LIMITS[this.settings.engine];
    const speed = Math.min(maxSpeed, Math.max(minSpeed, this.settings.rate));
    const speedWrap = picker.createDiv({ cls: "vox-voice-picker-speed" });
    const speedHeader = speedWrap.createDiv({ cls: "vox-voice-picker-speed-header" });
    speedHeader.createSpan({ text: "Speed" });
    const speedValue = speedHeader.createSpan({
      cls: "vox-voice-picker-speed-value",
      text: `${speed.toFixed(2)}x`,
    });
    const speedSlider = speedWrap.createEl("input", {
      type: "range",
      cls: "vox-voice-picker-speed-slider",
    });
    speedSlider.min = String(minSpeed);
    speedSlider.max = String(maxSpeed);
    speedSlider.step = String(step);
    speedSlider.value = String(speed);
    speedSlider.addEventListener("input", () => {
      const next = Number(speedSlider.value);
      this.settings.rate = next;
      this.player.setRate(next);
      speedValue.setText(`${next.toFixed(2)}x`);
      if (this.speedSaveTimer !== null) window.clearTimeout(this.speedSaveTimer);
      this.speedSaveTimer = window.setTimeout(() => {
        this.saveSettings().catch((err) => {
          console.error("Vox: failed to save speed", err);
        });
      }, 250);
    });

    picker.addClass("vox-voice-picker--hidden");
    requestAnimationFrame(() => {
      if (!this.voicePickerEl) return;
      const rect = anchor.getBoundingClientRect();
      const gap = 10;
      const left =
        rect.right + gap + picker.offsetWidth > window.innerWidth
          ? Math.max(gap, rect.left - picker.offsetWidth - gap)
          : rect.right + gap;
      const top = Math.min(
        Math.max(gap, rect.top),
        window.innerHeight - picker.offsetHeight - gap,
      );
      picker.style.left = `${left}px`;
      picker.style.top = `${top}px`;
      picker.removeClass("vox-voice-picker--hidden");
    });

    picker.addEventListener("mouseenter", () => {
      if (this.voicePickerCloseTimer !== null)
        window.clearTimeout(this.voicePickerCloseTimer);
    });
    picker.addEventListener("mouseleave", () => {
      this.voicePickerCloseTimer = window.setTimeout(
        () => this.closeVoicePicker(),
        150,
      );
    });
  }

  private registerVoicePicker(anchor: HTMLElement) {
    anchor.addEventListener("mouseenter", () => {
      if (this.voicePickerCloseTimer !== null)
        window.clearTimeout(this.voicePickerCloseTimer);
      this.openVoicePicker(anchor);
    });
    anchor.addEventListener("mouseleave", () => {
      this.voicePickerCloseTimer = window.setTimeout(
        () => this.closeVoicePicker(),
        150,
      );
    });
  }

  /**
   * Persona voice selection: folder prefix (longest wins) → frontmatter
   * `voice:` key → global default. Centralised here so providers stay
   * voice-agnostic.
   */
  private resolveVoice(file: TFile): string {
    const overrides = Object.entries(
      this.settings.folderVoicesByEngine[this.settings.engine] ?? {},
    ).sort(
      (a, b) => b[0].length - a[0].length,
    );
    for (const [prefix, voice] of overrides) {
      if (file.path.startsWith(prefix)) return voice;
    }

    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const fmVoice =
      fm && typeof fm === "object" && "voice" in fm
        ? (fm as { voice?: unknown }).voice
        : null;
    if (typeof fmVoice === "string" && fmVoice.trim()) return fmVoice.trim();

    switch (this.settings.engine) {
      case "browser":
        return this.settings.voiceBrowser;
      case "openai":
        return this.settings.voiceOpenai;
      case "elevenlabs":
        return this.settings.voiceElevenlabs;
    }
  }

  async loadSettings() {
    const raw = (await this.loadData()) as
      | (Record<string, unknown> & {
          defaultVoice?: string;
          folderVoices?: Record<string, string>;
          folderVoicesByEngine?: Partial<
            Record<
              VoxSettings["engine"],
              Record<string, string>
            >
          >;
        })
      | null;
    const merged = this.normalizeSettings(raw);

    if (
      typeof merged.defaultVoice === "string" &&
      merged.defaultVoice.length > 0
    ) {
      const eng = merged.engine;
      const leg = merged.defaultVoice;
      const isEmpty = (v: string | undefined) => !v || v.length === 0;
      if (eng === "browser" && isEmpty(merged.voiceBrowser))
        merged.voiceBrowser = leg;
      if (eng === "openai" && isEmpty(merged.voiceOpenai))
        merged.voiceOpenai = leg;
      if (eng === "elevenlabs" && isEmpty(merged.voiceElevenlabs))
        merged.voiceElevenlabs = leg;
    }
    delete merged.defaultVoice;

    if (
      raw?.folderVoices &&
      typeof raw.folderVoices === "object" &&
      Object.keys(raw.folderVoices).length > 0
    ) {
      const engine = merged.engine;
      const existing = merged.folderVoicesByEngine[engine] ?? {};
      merged.folderVoicesByEngine[engine] = {
        ...raw.folderVoices,
        ...existing,
      };
    }
    delete merged.folderVoices;

    this.settings = merged;
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.provider = createProvider(this.settings, this);
    this.player.setProvider(this.provider);
    this.player.setRate(this.settings.rate);
    await this.configureDevReload();
  }
}
