// Shared helper: load the app scripts (minus init block) into a VM context.
// Replaces the old pattern of extracting inline <script> from index.html.
import fs from "node:fs";

const appScript = fs.readFileSync("crashla.js", "utf8")
  .split("// --- Init ---")[0];

const dataScript = fs.readFileSync("incidents.js", "utf8") + "\n" +
  fs.readFileSync("vmt.js", "utf8");

export { appScript, dataScript };
