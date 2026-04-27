"use client";
/**
 * Side-effect import of @material/web components so they register their
 * custom elements before any page mounts. Mounted once in RootLayout.
 *
 * We import a curated subset (not /all.js) to keep the bundle lean —
 * @material/web ships ~150KB ungzipped if you pull everything; this list
 * is what the dashboard actually uses.
 */
import "@material/web/button/filled-button.js";
import "@material/web/button/outlined-button.js";
import "@material/web/button/text-button.js";
import "@material/web/button/elevated-button.js";
import "@material/web/iconbutton/icon-button.js";
import "@material/web/icon/icon.js";
import "@material/web/chips/assist-chip.js";
import "@material/web/chips/filter-chip.js";
import "@material/web/chips/input-chip.js";
import "@material/web/chips/chip-set.js";
import "@material/web/divider/divider.js";
import "@material/web/list/list.js";
import "@material/web/list/list-item.js";
import "@material/web/progress/circular-progress.js";
import "@material/web/progress/linear-progress.js";
import "@material/web/switch/switch.js";
import "@material/web/textfield/filled-text-field.js";
import "@material/web/textfield/outlined-text-field.js";
import "@material/web/select/filled-select.js";
import "@material/web/select/select-option.js";

export function M3Register() {
  return null;
}
