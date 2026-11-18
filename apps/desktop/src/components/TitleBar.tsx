import { Link } from "react-router-dom";
import { copy } from "../lib/copy";

/** Native-looking title strip for the desktop window (drag region when Tauri lands). */
export function TitleBar() {
  return (
    <div className="title-bar" data-tauri-drag-region>
      <Link to="/" className="title-brand">
        {copy.appName}
      </Link>
      <span className="title-tagline">{copy.tagline}</span>
    </div>
  );
}
