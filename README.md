# Vox

Vox reads your Obsidian notes aloud with neural text-to-speech. Different folders can have different voices, so your philosophy notes can sound different from your dream journal.

## Features

- **Ribbon button** — morphs between speaker / pause / play while audio is active; a separate stop button appears during playback
- **Hover voice picker** — hover the ribbon icon to pick a voice on the fly without touching settings
- **Status bar indicator** — clickable pill shows "Reading" / "Paused"; hidden when idle
- **Command palette** — Read active note / Stop / Toggle play–pause
- **File menu** — right-click any note → Vox: read aloud
- **Three TTS backends** — Browser (free, offline), OpenAI, ElevenLabs
- **Per-engine speed control** — each backend has its own range
- **Per-folder persona voices** — longest prefix wins; stored per-engine
- **Per-note voice override** via frontmatter `voice: <id>`
- **Tone control** (OpenAI) — preset delivery styles (calm, conversational, storytelling, …)
- **Voice library** (ElevenLabs) — save name + ID pairs as clickable chips; click to set default, × to remove

## Backends

| Engine | Quality | Cost | Requires |
|---|---|---|---|
| Browser | System voices | Free | Nothing |
| OpenAI | High | ~$0.015 / 1k chars | API key |
| ElevenLabs | Premium | Per-character plan | API key + voice IDs |

### OpenAI voices
alloy · ash · ballad · cedar · coral · echo · fable · marin · nova · onyx · sage · shimmer · verse

### ElevenLabs models
- **Turbo v2.5** — low latency, English-first
- **Multilingual v2** — broader language support

## Configuration

**Settings → Vox:**

- **Engine** — browser / openai / elevenlabs
- **Speed** — slider (range varies by engine)
- **Voice / API key** — shown only for the active engine
- **Tone** (OpenAI) — delivery style preset
- **Voices** (ElevenLabs) — add name + voice ID pairs
- **Folder voices** — map a folder prefix to a voice id for the active engine

Per-note override via YAML frontmatter:

```yaml
---
voice: "nova"
---
```

## Development

```bash
npm install
npm run dev
```

The plugin should live inside your vault at `.obsidian/plugins/vox/`. Enable it under **Settings → Community plugins**.

Build for release:

```bash
npm run build
```

Type-check only:

```bash
npm run typecheck
```

## Roadmap

- **Audio caching** — hash-keyed cache so unchanged notes don't re-bill cloud APIs
- **Highlight as reads** — colour the current sentence during playback
- **Section-level playback** — click a paragraph to start reading from there
