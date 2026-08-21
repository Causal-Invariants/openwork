import { readFile, rm, writeFile } from "node:fs/promises"

const htmlPath = new URL("../dist/skill-created.html", import.meta.url)
const html = await readFile(htmlPath, "utf8")

await writeFile(new URL("../dist/skill-created.js", import.meta.url), [
  `export const skillCreatedAppHtml = ${JSON.stringify(html)}`,
  "export default skillCreatedAppHtml",
  "",
].join("\n"))
await writeFile(new URL("../dist/skill-created.d.ts", import.meta.url), [
  "export declare const skillCreatedAppHtml: string",
  "export default skillCreatedAppHtml",
  "",
].join("\n"))
await rm(htmlPath)
