// Screenshots the three views in dark and light, desktop and phone (390 px). Run: node shoot.mjs
import { chromium } from "file:///C:/Users/darks/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";
const dir = path.resolve(import.meta.dirname);
const browser = await chromium.launch();
for (const v of ["holdings", "month", "saved"]) {
  for (const theme of ["dark", "light"]) {
    for (const view of ["desktop", "phone"]) {
      const page = await browser.newPage({ viewport: { width: view === "phone" ? 390 : 1330, height: 900 } });
      page.on("pageerror", (e) => console.log("pageerror", v, e.message));
      await page.goto(`${pathToFileURL(path.join(dir, "index.html"))}?v=${v}&theme=${theme}${view === "phone" ? "&view=phone" : ""}`);
      await page.evaluate(() => document.fonts.ready);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      if (view === "phone" && sw > 390) console.log("horizontal scroll", v, theme, sw);
      await page.screenshot({ path: path.join(dir, "shots", `${view}-${theme}-${v}.png`), fullPage: true });
      await page.close();
    }
  }
}
await browser.close();
