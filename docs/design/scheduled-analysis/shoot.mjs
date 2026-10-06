// Screenshots every direction in dark and light, desktop and phone. Run: node shoot.mjs
import { chromium } from "file:///C:/Users/darks/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";
const dir = path.resolve(import.meta.dirname);
const files = { a: "a-row-in-preferences", b: "b-own-card", c: "c-weekday-strip" };
const browser = await chromium.launch();
for (const [d, name] of Object.entries(files)) {
  for (const theme of ["dark", "light"]) {
    for (const view of ["desktop", "phone"]) {
      const page = await browser.newPage({ viewport: { width: view === "phone" ? 430 : 1340, height: 900 } });
      const url = `${pathToFileURL(path.join(dir, name + ".html"))}?theme=${theme}${view === "phone" ? "&view=phone" : ""}`;
      page.on("pageerror", (e) => console.log("pageerror", name, e.message));
      await page.goto(url);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(dir, "shots", `${d}-${theme}-${view}.png`), fullPage: true });
      await page.close();
    }
  }
}
await browser.close();
