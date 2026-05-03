import type { SynthProvider } from "./provider";

/**
 * Browser SpeechSynthesis provider — uses the Web Speech API's built-in
 * voice synthesizer. Zero cost, no network, works offline. Quality
 * varies by OS (macOS "Samantha" is decent; Windows SAPI voices are
 * notoriously robotic).
 *
 * Used as the default on first install so the plugin has something
 * functional even before the user configures API keys.
 */
export class BrowserSynthProvider implements SynthProvider {
  readonly kind = "synth" as const;
  private utterances: SpeechSynthesisUtterance[] = [];

  speakAll(
    sentences: string[],
    voice: string,
    rate: number,
    onDone?: () => void,
  ): Promise<void> {
    window.speechSynthesis.cancel();
    this.utterances = [];

    const allVoices = window.speechSynthesis.getVoices();
    const chosen = voice
      ? allVoices.find(
          (v) => v.name === voice || v.name.toLowerCase() === voice.toLowerCase(),
        )
      : undefined;

    sentences.forEach((sentence, i) => {
      const u = new SpeechSynthesisUtterance(sentence);
      if (chosen) u.voice = chosen;
      u.rate = rate;
      // Hook the final utterance's `end` event so the Player can
      // transition to idle. `onend` fires on both natural completion
      // and cancel(), so we check `speaking` to distinguish.
      if (i === sentences.length - 1 && onDone) {
        u.onend = () => {
          if (!window.speechSynthesis.speaking) onDone();
        };
      }
      this.utterances.push(u);
      window.speechSynthesis.speak(u);
    });

    return Promise.resolve();
  }

  pause(): void {
    window.speechSynthesis.pause();
  }

  resume(): void {
    window.speechSynthesis.resume();
  }

  toggle(): void {
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    else if (window.speechSynthesis.speaking) window.speechSynthesis.pause();
  }

  stopAll(): void {
    window.speechSynthesis.cancel();
    this.utterances = [];
  }
}
