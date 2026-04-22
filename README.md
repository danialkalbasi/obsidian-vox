# Rhapsode

> A *rhapsode* was a Greek reciter of epic poetry — literally, a stitcher of songs.

Rhapsode reads your Obsidian notes aloud with neural text-to-speech. Different folders can have different voices, so your philosophy notes can sound different from your dream journal.

## What works today (v0.1.0)

- **Ribbon button** + command palette entry + file-menu item to read the current note
- **Browser TTS** backend (free, offline, works out of the box)
- **OpenAI TTS** backend (cheap, high quality, needs an API key)
- **ElevenLabs** backend (premium voices, needs an API key)
- **Piper TTS** backend (local neural TTS via HTTP server — no network cost, no data leaves your machine)
- **Per-folder persona voices** (longest prefix wins)
- **Per-note voice override** via frontmatter `voice: <voice-id>`
- **Playback rate** slider (0.6× to 2×)
- **Pause / stop** — ribbon icons + status-bar indicator appear only during playback

## Using Piper (local, free, private)

```sh
pip install piper-tts[http]
python3 -m piper.download_voices en_US-lessac-medium
python3 -m piper.http_server -m en_US-lessac-medium
```

Leave that terminal running. In Rhapsode settings → Engine: Piper → default URL `http://localhost:5000` works out of the box.

## Planned

- **Caching** — hash-keyed audio cache so unchanged notes don't re-bill the cloud APIs
- **Highlight-as-reads** — colour the current sentence while audio plays
- **Section-level playback** — click a paragraph to start reading from there

## Development

```bash
npm install
npm run dev
```

The plugin is already located inside your vault's `.obsidian/plugins/rhapsode/` folder, so Obsidian will find it. Enable it in **Settings → Community plugins**.

Build for release:

```bash
npm run build
```

## Configuration

**Settings → Rhapsode:**

- **Engine** — browser / openai / elevenlabs / piper
- **Default voice** — system voice name, OpenAI voice (`alloy`, `nova`, …), or ElevenLabs `voice_id`
- **API keys** — for the respective cloud engines
- **Playback rate**
- **Folder → voice mapping** — e.g. `Philosophy/` → `epictetus-voice-id`

Per-note override via YAML frontmatter:

```yaml
---
voice: "nova"
---
```
