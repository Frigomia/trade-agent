// Screenshots every direction in dark and light, desktop and phone (390 px), plus per-state phone crops
// for pages that mark their states (D: shots/d-phone-{dark,light}-{a..e}.png). Run: node shoot.mjs [a b c d]
import { chromium } from "file:///C:/Users/darks/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";
const dir = path.resolve(import.meta.dirname);
const all = { a: "a-ticket-strip", b: "b-orders-checklist", c: "c-expand-rows", d: "d-hybrid" };
const only = process.argv.slice(2);
const files = only.length ? Object.fromEntries(only.map((d) => [d, all[d]])) : all;
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
      // per-state crops on the phone (only pages that mark their state tags with data-st, so far D):
      // the tag through the end of the frame's content, starting at the Orders bar (or the first state label) instead when that is over 1000 px
      const states = view === "phone" ? await page.evaluate(() => [...document.querySelectorAll(".tag[data-st]")].map((t) => {
        const f = t.nextElementSibling, last = f.querySelector(".main").lastElementChild, bar = f.querySelector(".cabar, .ilab");
        const y = (e) => e.getBoundingClientRect().top + scrollY;
        const bottom = last.getBoundingClientRect().bottom + scrollY + 16;
        let top = y(t) - 8;
        if (bottom - top > 1000 && bar) top = y(bar) - 12;
        return { s: t.dataset.st, top, h: bottom - top };
      })) : [];
      for (const { s, top, h } of states) {
        if (h > 1000) console.log("crop over 1000 px", d, theme, s, Math.round(h));
        await page.screenshot({ path: path.join(dir, "shots", `${d}-phone-${theme}-${s}.png`), fullPage: true, clip: { x: 0, y: top, width: 390, height: Math.min(h, 1000) } });
      }
      await page.close();
    }
  }
}
await browser.close();
