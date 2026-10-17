/** Keep the isolated public demo faithful without coupling Docker to backend files. */
import { readFile, mkdir, writeFile } from "node:fs/promises";

const source = new URL("../../backend/app/static/widget.js", import.meta.url);
const snapshot = new URL("../public/demo/widget/script.js", import.meta.url);
const original = await readFile(source);
if (process.argv.includes("--check")) {
  if (!original.equals(await readFile(snapshot))) {
    throw new Error(
      "Demo renderer differs from the production widget. Run node scripts/sync-marketing-widget.mjs.",
    );
  }
  console.log("Demo renderer matches the production widget byte for byte.");
} else {
  await mkdir(new URL(".", snapshot), { recursive: true });
  await writeFile(snapshot, original);
  console.log("Copied the unchanged production widget renderer into the public demo.");
}
