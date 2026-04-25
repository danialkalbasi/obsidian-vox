import { Modal, setIcon } from "obsidian";
import type VoxPlugin from "./main";
import { fetchElevenLabsVoices, type ElevenLabsVoice } from "./tts/elevenlabs-voices";

const LABEL_ORDER = ["gender", "age", "accent", "use case", "description"] as const;

export class VoiceBrowserModal extends Modal {
  private plugin: VoxPlugin;
  private onAdd: () => void;
  private voices: ElevenLabsVoice[] = [];
  private query = "";
  private listEl: HTMLElement | null = null;
  private previewAudio: HTMLAudioElement | null = null;
  private previewingId: string | null = null;

  constructor(plugin: VoxPlugin, onAdd: () => void) {
    super(plugin.app);
    this.plugin = plugin;
    this.onAdd = onAdd;
  }

  async onOpen() {
    this.modalEl.addClass("vox-browser-modal");
    this.titleEl.setText("Browse voices");

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vox-browser");

    // Search
    const searchInput = contentEl.createEl("input", {
      cls: "vox-browser-search",
      type: "text",
      placeholder: "Search by name, accent, gender…",
    });
    searchInput.addEventListener("input", () => {
      this.query = searchInput.value;
      this.renderList();
    });

    this.listEl = contentEl.createDiv({ cls: "vox-browser-list" });
    const loadingEl = this.listEl.createDiv({ cls: "vox-browser-state", text: "Loading voices…" });

    try {
      this.voices = await fetchElevenLabsVoices(this.plugin.settings.elevenlabsApiKey);
      loadingEl.remove();
      this.renderList();
      searchInput.focus();
    } catch (err) {
      loadingEl.setText(`Could not load voices: ${(err as Error).message}`);
      loadingEl.addClass("vox-browser-state--error");
    }
  }

  onClose() {
    this.stopPreview();
    this.contentEl.empty();
  }

  private isAdded(voiceId: string): boolean {
    return this.plugin.settings.elevenlabsVoices.some((v) => v.id === voiceId);
  }

  private renderList() {
    if (!this.listEl) return;
    const q = this.query.trim().toLowerCase();
    const filtered = q
      ? this.voices.filter(
          (v) =>
            v.name.toLowerCase().includes(q) ||
            Object.values(v.labels).some((l) => l.toLowerCase().includes(q)),
        )
      : this.voices;

    this.listEl.empty();

    if (filtered.length === 0) {
      this.listEl.createDiv({ cls: "vox-browser-state", text: "No voices match your search." });
      return;
    }

    filtered.forEach((voice, i) => this.renderRow(this.listEl!, voice, i));
  }

  private renderRow(container: HTMLElement, voice: ElevenLabsVoice, index: number) {
    const added = this.isAdded(voice.voice_id);
    const row = container.createDiv({
      cls: "vox-browser-row" + (added ? " vox-browser-row--added" : ""),
    });
    row.dataset.voiceId = voice.voice_id;

    // Avatar — reuse the popover gradient palette
    const avatar = row.createDiv({
      cls: `vox-browser-avatar vox-voice-picker-avatar--${index % 10}`,
    });
    setIcon(avatar, "audio-lines");

    // Body
    const body = row.createDiv({ cls: "vox-browser-body" });
    body.createDiv({ cls: "vox-browser-name", text: voice.name });
    const labelText = LABEL_ORDER.map((k) => voice.labels[k]).filter(Boolean).join(" · ");
    if (labelText) {
      body.createDiv({ cls: "vox-browser-labels", text: labelText });
    }

    // Actions
    const actions = row.createDiv({ cls: "vox-browser-actions" });

    if (voice.preview_url) {
      const previewBtn = actions.createEl("button", {
        cls: "vox-browser-btn vox-browser-btn--icon",
        attr: { "aria-label": "Preview voice" },
      });
      setIcon(previewBtn, this.previewingId === voice.voice_id ? "square" : "play");
      previewBtn.addEventListener("click", () => this.togglePreview(voice, previewBtn));
    }

    const addBtn = actions.createEl("button", {
      cls: "vox-browser-btn " + (added ? "vox-browser-btn--done" : "vox-browser-btn--add"),
      text: added ? "Added" : "Add",
    });
    addBtn.disabled = added;

    if (!added) {
      addBtn.addEventListener("click", async () => {
        this.plugin.settings.elevenlabsVoices.push({ name: voice.name, id: voice.voice_id });
        if (!this.plugin.settings.voiceElevenlabs) {
          this.plugin.settings.voiceElevenlabs = voice.voice_id;
        }
        await this.plugin.saveSettings();
        this.onAdd();
        row.addClass("vox-browser-row--added");
        addBtn.textContent = "Added";
        addBtn.className = "vox-browser-btn vox-browser-btn--done";
        addBtn.disabled = true;
      });
    }
  }

  private togglePreview(voice: ElevenLabsVoice, btn: HTMLButtonElement) {
    if (this.previewingId === voice.voice_id) {
      this.stopPreview();
      return;
    }
    this.stopPreview();
    this.previewingId = voice.voice_id;
    setIcon(btn, "square");
    btn.setAttribute("aria-label", "Stop preview");

    this.previewAudio = new Audio(voice.preview_url!);
    this.previewAudio.onended = () => this.stopPreview();
    this.previewAudio.play().catch(() => this.stopPreview());
  }

  private stopPreview() {
    if (this.previewAudio) {
      this.previewAudio.pause();
      this.previewAudio.src = "";
      this.previewAudio = null;
    }
    if (this.previewingId) {
      const row = this.listEl?.querySelector(`[data-voice-id="${this.previewingId}"]`);
      const btn = row?.querySelector<HTMLButtonElement>(".vox-browser-btn--icon");
      if (btn) {
        setIcon(btn, "play");
        btn.setAttribute("aria-label", "Preview voice");
      }
      this.previewingId = null;
    }
  }
}
