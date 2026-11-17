// Brand icons bundled into the Worker (wrangler "Data" rule), so the server serves its own
// favicon with no dependency on the website. Imported lazily from index.js so Node tests,
// which cannot import .png, never load this file.
import icon512 from "../assets/icon-512.png";
import icon192 from "../assets/icon-192.png";
import icon64 from "../assets/icon-64.png";
import favicon from "../assets/favicon.ico";

export const ICON_FILES = {
  "/icon-512.png": [icon512, "image/png"],
  "/icon-192.png": [icon192, "image/png"],
  "/icon-64.png": [icon64, "image/png"],
  "/favicon.ico": [favicon, "image/x-icon"],
  "/apple-touch-icon.png": [icon192, "image/png"],
};
