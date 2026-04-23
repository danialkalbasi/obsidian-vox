import { splitIntoSentences } from "./markdown";
import type { TtsBackend } from "./tts/backend";

export type PlayerState = "idle" | "playing" | "paused";

export type PlayerStateListener = (state: PlayerState) => void;

/**
 * Player — owns playback state for the plugin.
 *
 * Responsibilities:
 *   - Segment cleaned text into sentences.
 *   - Ask the backend for each sentence's audio (URL for cloud engines,
 *     direct `speak()` for the browser SpeechSynthesis backend).
 *   - Maintain a queue so the user can pause, resume, and stop.
 *   - Emit state transitions (`idle` ↔ `playing` ↔ `paused`) so the UI
 *     layer (ribbon icons, status bar) can stay in sync without polling.
 */
export class Player {
  private backend: TtsBackend;
  private queue: string[] = [];
  private cursor = 0;
  private audio: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private rate = 1.0;
  private tokenCounter = 0;
  private activeToken = 0;

  private state: PlayerState = "idle";
  private listeners: Set<PlayerStateListener> = new Set();

  constructor(backend: TtsBackend) {
    this.backend = backend;
  }

  setBackend(backend: TtsBackend) {
    this.backend = backend;
  }

  setRate(rate: number) {
    this.rate = rate;
  }

  getState(): PlayerState {
    return this.state;
  }

  /**
   * Subscribe to state transitions. Returns an unsubscribe function;
   * the main plugin keeps that around and calls it from `onunload`.
   */
  onStateChange(listener: PlayerStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private setState(next: PlayerState) {
    if (this.state === next) return;
    this.state = next;
    for (const l of this.listeners) l(next);
  }

  private isActive(token: number): boolean {
    return token !== 0 && token === this.activeToken;
  }

  private releaseCurrentAudioUrl() {
    if (!this.currentAudioUrl) return;
    URL.revokeObjectURL(this.currentAudioUrl);
    this.currentAudioUrl = null;
  }

  /**
   * Start playing the given text with the given voice. Stops any
   * currently-playing audio first.
   */
  async play(text: string, voice: string): Promise<void> {
    this.stop();
    const token = ++this.tokenCounter;
    this.activeToken = token;

    this.queue = splitIntoSentences(text);
    this.cursor = 0;
    if (this.queue.length === 0) return;

    if (this.backend.kind === "synth") {
      this.setState("playing");
      // Browser SpeechSynthesis queues utterances internally. We hook
      // the last one's `onend` to transition back to `idle` on natural
      // completion; the backend will emit that callback for us.
      await this.backend.speakAll(this.queue, voice, this.rate, () => {
        if (this.isActive(token)) this.setState("idle");
      });
      return;
    }

    this.audio = new Audio();
    // Keep state in sync with underlying element events: pausing the
    // <audio> outside our API (e.g. OS media-key interception) still
    // updates our state cleanly.
    this.audio.onpause = () => {
      if (this.isActive(token) && this.audio && !this.audio.ended) {
        this.setState("paused");
      }
    };
    this.audio.onplay = () => {
      if (this.isActive(token)) this.setState("playing");
    };
    await this.playNext(token, voice);
  }

  private async playNext(token: number, voice: string): Promise<void> {
    if (!this.isActive(token)) return;
    if (this.cursor >= this.queue.length) {
      // Natural end of queue — only fires for URL backends. Synth
      // backend signals completion via the callback passed to speakAll.
      this.releaseCurrentAudioUrl();
      this.audio = null;
      if (this.isActive(token)) this.setState("idle");
      return;
    }
    if (!this.audio || this.backend.kind !== "url") return;

    const sentence = this.queue[this.cursor++];
    const url = await this.backend.synthesizeToUrl(sentence, voice, this.rate);
    if (!this.isActive(token)) {
      URL.revokeObjectURL(url);
      return;
    }

    this.releaseCurrentAudioUrl();
    this.currentAudioUrl = url;
    this.audio.src = url;

    this.audio.onended = () => {
      this.releaseCurrentAudioUrl();
      if (!this.isActive(token)) return;
      this.playNext(token, voice).catch((err) => {
        console.error("Vox: playback error", err);
        this.setState("idle");
      });
    };

    try {
      await this.audio.play();
    } catch (err) {
      this.releaseCurrentAudioUrl();
      throw err;
    }
    if (this.isActive(token)) this.setState("playing");
  }

  pause() {
    if (this.state !== "playing") return;
    this.audio?.pause();
    if (this.backend.kind === "synth") this.backend.pause();
    this.setState("paused");
  }

  resume() {
    if (this.state !== "paused") return;
    this.audio?.play().catch(() => {});
    if (this.backend.kind === "synth") this.backend.resume();
    this.setState("playing");
  }

  togglePause() {
    if (this.state === "playing") this.pause();
    else if (this.state === "paused") this.resume();
  }

  stop() {
    if (this.state === "idle" && !this.audio && this.queue.length === 0) return;
    this.activeToken = ++this.tokenCounter;
    if (this.audio) {
      this.audio.onpause = null;
      this.audio.onplay = null;
      this.audio.onended = null;
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    this.releaseCurrentAudioUrl();
    if (this.backend.kind === "synth") this.backend.stopAll();
    this.queue = [];
    this.cursor = 0;
    this.setState("idle");
  }
}
