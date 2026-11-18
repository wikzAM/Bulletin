import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The auto-update skeleton (docs/PACKAGING.md, "Updates"): configuration and placeholders only. Updates are OFF
 * in every default build, and no private key may ever be in this repository.
 */

const tauri = resolve(import.meta.dirname, "../../../src-tauri");
interface TauriConfig {
  bundle: { createUpdaterArtifacts?: boolean };
  plugins?: { updater?: { pubkey: string; endpoints: string[] } };
}
const read = (name: string) => JSON.parse(readFileSync(join(tauri, name), "utf8")) as TauriConfig;

describe("updater skeleton", () => {
  it("is off in the default config: no updater plugin section, no updater artifacts", () => {
    const base = read("tauri.conf.json");
    expect(base.plugins?.updater).toBeUndefined();
    expect(base.bundle.createUpdaterArtifacts).toBeUndefined();
  });

  it("keeps the updater config in a separate file that is only merged on purpose", () => {
    const updater = read("tauri.updater.conf.json");
    expect(updater.bundle.createUpdaterArtifacts).toBe(true);
    expect(updater.plugins!.updater!.endpoints).toHaveLength(1);
    // Tauri merges only tauri.conf.json (and tauri.<platform>.conf.json) by itself.
    expect(existsSync(join(tauri, "tauri.windows.conf.json"))).toBe(false);
  });

  it("uses clearly marked placeholders for the public key and the endpoint", () => {
    const { pubkey, endpoints } = read("tauri.updater.conf.json").plugins!.updater!;
    expect(pubkey).toMatch(/PLACEHOLDER/);
    expect(endpoints[0]).toMatch(/^https:\/\//);
    expect(endpoints[0]).toMatch(/PLACEHOLDER/);
    expect(endpoints[0]).toContain("{{current_version}}");
  });

  it("holds no private key material anywhere under src-tauri (outside build output)", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        if (name === "target" || name === "binaries" || name === "gen") return [];
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    for (const file of walk(tauri)) {
      if (/\.(png|ico|icns|exe|dll)$/i.test(file)) continue;
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/untrusted comment: .*secret key/i);
      expect(text, file).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
      expect(text, file).not.toMatch(/TAURI_SIGNING_PRIVATE_KEY\s*[=:]\s*["']?[A-Za-z0-9+/=]{40,}/);
    }
  });

  it("registers the plugin only behind the 'updater' cargo feature", () => {
    const cargo = readFileSync(join(tauri, "Cargo.toml"), "utf8");
    expect(cargo).toMatch(/^updater\s*=\s*\["dep:tauri-plugin-updater"\]/m);
    expect(cargo).toMatch(/tauri-plugin-updater\s*=\s*\{[^}]*optional\s*=\s*true/);
    expect(cargo).toMatch(/^default\s*=\s*\[\]/m);
    const main = readFileSync(join(tauri, "src", "main.rs"), "utf8");
    expect(main).toMatch(/#\[cfg\(feature = "updater"\)\]/);
  });
});
