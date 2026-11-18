import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export function appDataDirectory(
  env: NodeJS.Dict<string> = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  const paths = platform === "win32" ? win32 : posix;
  const override = env.BULLETIN_DATA_DIR?.trim();
  if (override) return paths.resolve(override);
  if (platform === "win32") {
    return paths.join(env.LOCALAPPDATA?.trim() || paths.join(home, "AppData", "Local"), "Bulletin");
  }
  if (platform === "darwin") return paths.join(home, "Library", "Application Support", "Bulletin");
  const xdg = env.XDG_DATA_HOME?.trim() ?? "";
  return paths.join(paths.isAbsolute(xdg) ? xdg : paths.join(home, ".local", "share"), "Bulletin");
}
