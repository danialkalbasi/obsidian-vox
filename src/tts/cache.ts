import { normalizePath, type Plugin } from "obsidian";

export interface AudioCacheParts {
  engine: "openai" | "elevenlabs";
  model: string;
  voice: string;
  rate: number;
  text: string;
  instructions?: string;
}

export class AudioCache {
  private root: string;
  private ensuredDirs = new Set<string>();

  constructor(private plugin: Plugin) {
    const pluginDir = plugin.manifest.dir ?? `.obsidian/plugins/${plugin.manifest.id}`;
    this.root = normalizePath(`${pluginDir}/cache/v1`);
  }

  async get(parts: AudioCacheParts): Promise<ArrayBuffer | null> {
    const path = await this.pathFor(parts);
    if (!(await this.plugin.app.vault.adapter.exists(path))) return null;
    try {
      return await this.plugin.app.vault.adapter.readBinary(path);
    } catch (err) {
      console.warn("Vox: failed to read cached audio", err);
      return null;
    }
  }

  async set(parts: AudioCacheParts, audio: ArrayBuffer): Promise<void> {
    const path = await this.pathFor(parts);
    try {
      await this.ensureDir(this.dirFor(parts.engine));
      await this.plugin.app.vault.adapter.writeBinary(path, audio);
    } catch (err) {
      console.warn("Vox: failed to write cached audio", err);
    }
  }

  async clear(): Promise<void> {
    if (!(await this.plugin.app.vault.adapter.exists(this.root))) return;
    await this.plugin.app.vault.adapter.rmdir(this.root, true);
    this.ensuredDirs.clear();
  }

  private dirFor(engine: AudioCacheParts["engine"]): string {
    return normalizePath(`${this.root}/${engine}`);
  }

  private async pathFor(parts: AudioCacheParts): Promise<string> {
    const hash = await this.hashParts(parts);
    return normalizePath(`${this.dirFor(parts.engine)}/${hash}.mp3`);
  }

  private async ensureDir(dir: string): Promise<void> {
    if (
      this.ensuredDirs.has(dir) &&
      (await this.plugin.app.vault.adapter.exists(dir))
    ) {
      return;
    }

    const segments = dir.split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const normalized = normalizePath(current);
      if (!(await this.plugin.app.vault.adapter.exists(normalized))) {
        await this.plugin.app.vault.adapter.mkdir(normalized);
      }
    }

    this.ensuredDirs.add(dir);
  }

  private async hashParts(parts: AudioCacheParts): Promise<string> {
    const payload = JSON.stringify({
      engine: parts.engine,
      model: parts.model,
      voice: parts.voice,
      rate: Number(parts.rate.toFixed(3)),
      instructions: parts.instructions?.trim() ?? "",
      text: parts.text,
    });
    const bytes = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
}
