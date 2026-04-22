import {
  Notice,
  Plugin,
  MarkdownView,
  TFile,
  addIcon,
  setIcon,
} from "obsidian";
import { DEFAULT_SETTINGS, VoxSettings, VoxSettingTab } from "./settings";
import { Player, PlayerState } from "./player";
import { stripMarkdown } from "./markdown";
import { createBackend, TtsBackend } from "./tts/backend";

/**
 * Vox plugin entry point.
 *
 * Responsibilities:
 *   1. Register UI affordances: read / pause-resume / stop ribbon icons,
 *      editor menu item, command palette commands.
 *   2. Hold the singleton TTS `Player` and a status-bar indicator that
 *      mirrors its state.
 *   3. Load/save `VoxSettings`, including per-folder voice overrides.
 *
 * The heavy lifting lives in `player.ts`, `markdown.ts`, and `tts/`.
 * This file just wires things together.
 */

const ICON_READ = "vox-read";
const ICON_PAUSE = "vox-pause";
const ICON_PLAY = "vox-play";
const ICON_STOP = "vox-stop";

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
  private backend!: TtsBackend;

  // UI elements whose appearance depends on player state. Held as
  // fields so the state listener can mutate them without re-querying.
  private statusEl: HTMLElement | null = null;
  private readRibbonEl: HTMLElement | null = null;
  private stopRibbonEl: HTMLElement | null = null;
  private unsubscribeState: (() => void) | null = null;
  private pendingVoice: string | null = null;
  private voicePickerEl: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();

    for (const [id, svg] of Object.entries(ICONS)) {
      addIcon(id, svg.trim());
    }

    this.backend = createBackend(this.settings, this);
    this.player = new Player(this.backend);

    // ── Ribbon icons ────────────────────────────────────────────
    // Single morphing icon: speaker (idle) → pause (playing) → play (paused).
    // A separate stop icon appears only while active.
    this.readRibbonEl = this.addRibbonIcon(ICON_READ, "Vox: read current note", () => {
      if (this.player.getState() === "idle") {
        this.readActiveNote();
      } else {
        this.player.togglePause();
      }
    });
    this.readRibbonEl.addClass("vox-ribbon");
    this.registerVoicePicker(this.readRibbonEl);

    this.stopRibbonEl = this.addRibbonIcon(
      ICON_STOP,
      "Vox: stop reading",
      () => this.player.stop(),
    );
    this.stopRibbonEl.addClass("vox-ribbon");
    this.stopRibbonEl.style.display = "none";

    // ── Status bar ──────────────────────────────────────────────
    // Single clickable pill that shows current playback state.
    // Click behaviour: toggle pause when playing/paused, no-op idle.
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("vox-status");
    this.statusEl.addEventListener("click", () => {
      if (this.player.getState() !== "idle") this.player.togglePause();
    });

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

    this.addSettingTab(new VoxSettingTab(this.app, this));
  }

  async onunload() {
    this.unsubscribeState?.();
    this.player?.stop();
  }

  /**
   * Repaint the status bar + pause ribbon icon to reflect player state.
   * Called synchronously by the Player's state-change event.
   */
  private renderState(state: PlayerState) {
    const active = state !== "idle";

    if (this.readRibbonEl) {
      const icon = state === "idle" ? ICON_READ : state === "playing" ? ICON_PAUSE : ICON_PLAY;
      const label = state === "idle" ? "Vox: read current note" : state === "playing" ? "Vox: pause" : "Vox: resume";
      setIcon(this.readRibbonEl, icon);
      this.readRibbonEl.setAttribute("aria-label", label);
    }

    if (this.stopRibbonEl) {
      this.stopRibbonEl.style.display = active ? "" : "none";
    }

    if (this.statusEl) {
      this.statusEl.empty();
      if (!active) {
        // Hidden when nothing's happening — no visual noise.
        this.statusEl.style.display = "none";
        return;
      }
      this.statusEl.style.display = "";
      const icon = this.statusEl.createSpan({ cls: "vox-status-icon" });
      setIcon(icon, state === "playing" ? ICON_PAUSE : ICON_PLAY);
      this.statusEl.createSpan({
        cls: "vox-status-text",
        text: state === "playing" ? " Reading" : " Paused",
      });
    }
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
      new Notice("Vox: note is empty after stripping markdown.");
      return;
    }

    const voice = this.pendingVoice ?? this.resolveVoice(file);
    this.pendingVoice = null;

    try {
      this.player.setRate(this.settings.rate);
      await this.player.play(text, voice);
      new Notice(`Vox: reading "${file.basename}"...`);
    } catch (err) {
      console.error("Vox playback failed:", err);
      new Notice(`Vox: ${(err as Error).message}`);
    }
  }

  private registerVoicePicker(anchor: HTMLElement) {
    let closeTimer: number;

    const getVoices = (): { label: string; id: string }[] => {
      const { engine, elevenlabsVoices } = this.settings;
      if (engine === "elevenlabs") {
        return elevenlabsVoices.map((v) => ({ label: v.name, id: v.id }));
      }
      if (engine === "openai") {
        return ["alloy","ash","ballad","cedar","coral","echo","fable","marin","nova","onyx","sage","shimmer","verse"]
          .map((v) => ({ label: v, id: v }));
      }
      return [];
    };

    const closePicker = () => {
      this.voicePickerEl?.remove();
      this.voicePickerEl = null;
      const label = anchor.getAttribute("data-vox-label");
      if (label) anchor.setAttribute("aria-label", label);
    };

    const openPicker = () => {
      if (this.player.getState() !== "idle") return;
      const voices = getVoices();
      if (voices.length === 0) return;

      // Stash the current aria-label and clear it so Obsidian's native
      // tooltip doesn't appear alongside the picker.
      if (!anchor.getAttribute("data-vox-label")) {
        anchor.setAttribute("data-vox-label", anchor.getAttribute("aria-label") ?? "");
      }
      anchor.removeAttribute("aria-label");

      closePicker();
      const picker = document.body.createEl("div", { cls: "vox-voice-picker" });
      this.voicePickerEl = picker;

      const activeId = this.pendingVoice ?? this.settings.voiceElevenlabs ?? this.settings.voiceOpenai;
      for (const voice of voices) {
        const item = picker.createEl("div", {
          cls: "vox-voice-picker-item" + (voice.id === activeId ? " vox-voice-picker-item--active" : ""),
          text: voice.label,
        });
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this.pendingVoice = voice.id;
          closePicker();
          this.readActiveNote();
        });
      }

      const rect = anchor.getBoundingClientRect();
      picker.style.left = `${rect.right + 4}px`;
      picker.style.top = `${rect.top}px`;

      picker.addEventListener("mouseenter", () => clearTimeout(closeTimer));
      picker.addEventListener("mouseleave", () => {
        closeTimer = window.setTimeout(closePicker, 150);
      });
    };

    anchor.addEventListener("mouseenter", () => {
      clearTimeout(closeTimer);
      openPicker();
    });
    anchor.addEventListener("mouseleave", () => {
      closeTimer = window.setTimeout(closePicker, 150);
    });
  }

  /**
   * Persona voice selection: folder prefix (longest wins) → frontmatter
   * `voice:` key → global default. Centralised here so backends stay
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
    const fmVoice = fm?.voice;
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
    const merged = Object.assign(
      {},
      DEFAULT_SETTINGS,
      raw ?? {},
    ) as VoxSettings & {
      defaultVoice?: string;
      folderVoices?: Record<string, string>;
    };

    merged.folderVoicesByEngine = {
      ...DEFAULT_SETTINGS.folderVoicesByEngine,
      ...(raw?.folderVoicesByEngine ?? {}),
    };

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
    this.backend = createBackend(this.settings, this);
    this.player.setBackend(this.backend);
    this.player.setRate(this.settings.rate);
  }
}
