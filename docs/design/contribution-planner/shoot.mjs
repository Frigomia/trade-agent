// Screenshots every direction in dark and light, desktop and phone (390 px). Run: node shoot.mjs
import { chromium } from "file:///C:/Users/darks/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";
const dir = path.resolve(import.meta.dirname);
const files = { a: "a-one-column", b: "b-split-rail", c: "c-ledger" };
const browser = await chromium.launch();
for (const [d, name] of Object.entries(files)) {
  for (const theme of ["dark", "light"]) {
    for (const view of ["desktop", "phone"]) {
      const page = await browser.newPage({ viewport: { width: view === "phone" ? 390 : 1340, height: 900 } });
      const url = `${pathToFileURL(path.join(dir, name + ".html"))}?theme=${theme}${view === "phone" ? "&view=phone" : ""}`;
      page.on("pageerror", (e) => console.log("pageerror", name, e.message));
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      if (view === "phone" && sw > 390) console.log("horizontal scroll", d, theme, sw);
      await page.screenshot({ path: path.join(dir, "shots", `${d}-${theme}-${view}.png`), fullPage: true });
      await page.close();
    }
  }
}
await browser.close();
