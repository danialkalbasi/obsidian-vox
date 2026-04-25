import { requestUrl } from "obsidian";

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  preview_url: string | null;
}

export async function fetchElevenLabsVoices(apiKey: string): Promise<ElevenLabsVoice[]> {
  const res = await requestUrl({
    url: "https://api.elevenlabs.io/v1/voices",
    headers: { "xi-api-key": apiKey },
    throw: false,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`ElevenLabs returned ${res.status}`);
  }
  const voices = (res.json as { voices: ElevenLabsVoice[] }).voices;
  return voices.sort((a, b) => a.name.localeCompare(b.name));
}
