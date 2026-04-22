import {
  Notice,
  Plugin,
  MarkdownView,
  TFile,
  addIcon,
  setIcon,
} from "obsidian";
import { DEFAULT_SETTINGS, RhapsodeSettings, RhapsodeSettingTab } from "./settings";
import { Player, PlayerState } from "./player";
import { stripMarkdown } from "./markdown";
import { createBackend, TtsBackend } from "./tts/backend";

/**
 * Rhapsode plugin entry point.
 *
 * Responsibilities:
 *   1. Register UI affordances: read / pause-resume / stop ribbon icons,
 *      editor menu item, command palette commands.
 *   2. Hold the singleton TTS `Player` and a status-bar indicator that
 *      mirrors its state.
 *   3. Load/save `RhapsodeSettings`, including per-folder voice overrides.
 *
 * The heavy lifting lives in `player.ts`, `markdown.ts`, and `tts/`.
 * This file just wires things together.
 */

const ICON_READ = "rhapsode-read";
const ICON_PAUSE = "rhapsode-pause";
const ICON_PLAY = "rhapsode-play";
const ICON_STOP = "rhapsode-stop";

const ICONS: Record<string, string> = {
  [ICON_READ]: `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10 22 C 28 22 40 28 50 36 C 60 28 72 22 90 22 L 90 76 C 72 76 60 82 50 90 C 40 82 28 76 10 76 Z"/>
  <path d="M50 36 L 50 90"/>
</svg>`,
  [ICON_PAUSE]: `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
  <line x1="34" y1="20" x2="34" y2="80"/>
  <line x1="66" y1="20" x2="66" y2="80"/>
</svg>`,
  [ICON_PLAY]: `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M28 18 L 82 50 L 28 82 Z" fill="currentColor"/>
</svg>`,
  [ICON_STOP]: `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
  <rect x="22" y="22" width="56" height="56" rx="6" fill="currentColor"/>
</svg>`,
};

export default class RhapsodePlugin extends Plugin {
  settings!: RhapsodeSettings;
  player!: Player;
  private backend!: TtsBackend;

  // UI elements whose appearance depends on player state. Held as
  // fields so the state listener can mutate them without re-querying.
  private statusEl: HTMLElement | null = null;
  private pauseRibbonEl: HTMLElement | null = null;
  private stopRibbonEl: HTMLElement | null = null;
  private unsubscribeState: (() => void) | null = null;

  async onload() {
    await this.loadSettings();

    for (const [id, svg] of Object.entries(ICONS)) {
      addIcon(id, svg.trim());
    }

    this.backend = createBackend(this.settings, this);
    this.player = new Player(this.backend);

    // ── Ribbon icons ────────────────────────────────────────────
    this.addRibbonIcon(ICON_READ, "Rhapsode: read current note", async () => {
      await this.readActiveNote();
    });

    this.pauseRibbonEl = this.addRibbonIcon(
      ICON_PAUSE,
      "Rhapsode: pause / resume",
      () => this.player.togglePause(),
    );
    // Hidden until playback starts — these controls have no meaning
    // when the player is idle, and an always-visible pause button in
    // the ribbon is visual clutter.
    this.pauseRibbonEl.style.display = "none";

    this.stopRibbonEl = this.addRibbonIcon(
      ICON_STOP,
      "Rhapsode: stop reading",
      () => this.player.stop(),
    );
    this.stopRibbonEl.style.display = "none";

    // ── Status bar ──────────────────────────────────────────────
    // Single clickable pill that shows current playback state.
    // Click behaviour: toggle pause when playing/paused, no-op idle.
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("rhapsode-status");
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
            .setTitle("Rhapsode: read aloud")
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

    this.addSettingTab(new RhapsodeSettingTab(this.app, this));
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

    if (this.pauseRibbonEl) {
      this.pauseRibbonEl.style.display = active ? "" : "none";
      // Swap pause↔play icon so the button's meaning is obvious.
      setIcon(this.pauseRibbonEl, state === "paused" ? ICON_PLAY : ICON_PAUSE);
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
      const icon = this.statusEl.createSpan({ cls: "rhapsode-status-icon" });
      setIcon(icon, state === "playing" ? ICON_PAUSE : ICON_PLAY);
      this.statusEl.createSpan({
        cls: "rhapsode-status-text",
        text: state === "playing" ? " Reading" : " Paused",
      });
    }
  }

  async readActiveNote() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!file) {
      new Notice("Rhapsode: no active note to read.");
      return;
    }
    await this.readFile(file);
  }

  async readFile(file: TFile) {
    this.player.stop();

    const raw = await this.app.vault.cachedRead(file);
    const text = stripMarkdown(raw);
    if (!text.trim()) {
      new Notice("Rhapsode: note is empty after stripping markdown.");
      return;
    }

    const voice = this.resolveVoice(file);

    try {
      await this.player.play(text, voice);
      new Notice(`Rhapsode: reading “${file.basename}”…`);
    } catch (err) {
      console.error("Rhapsode playback failed:", err);
      new Notice(`Rhapsode: ${(err as Error).message}`);
    }
  }

  /**
   * Persona voice selection: folder prefix (longest wins) → frontmatter
   * `voice:` key → global default. Centralised here so backends stay
   * voice-agnostic.
   */
  private resolveVoice(file: TFile): string {
    const overrides = Object.entries(this.settings.folderVoices).sort(
      (a, b) => b[0].length - a[0].length,
    );
    for (const [prefix, voice] of overrides) {
      if (file.path.startsWith(prefix)) return voice;
    }

    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const fmVoice = fm?.voice;
    if (typeof fmVoice === "string" && fmVoice.trim()) return fmVoice.trim();

    return this.settings.defaultVoice;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Rebuild backend so the live Player picks up engine/API-key
    // changes without a full plugin reload.
    this.backend = createBackend(this.settings, this);
    this.player.setBackend(this.backend);
  }
}
