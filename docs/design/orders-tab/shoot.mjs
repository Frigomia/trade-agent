// Screenshots every direction in dark and light, desktop and phone (390 px), plus per-state dark phone crops
// (shots/{a,b,c}-phone-dark-{strip,view,old,placed,gone,sheet,empty}.png, each at most 1000 px tall).
// Reports horizontal scroll at 390 px and the lowest text contrast of the new pieces. Run: node shoot.mjs [a b c]
import { chromium } from "file:///C:/Users/darks/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { pathToFileURL } from "node:url";
import path from "node:path";
const dir = path.resolve(import.meta.dirname);
const all = { a: "a-stacked", b: "b-plan-chips", c: "c-groups" };
const only = process.argv.slice(2);
const files = only.length ? Object.fromEntries(only.map((d) => [d, all[d]])) : all;
const browser = await chromium.launch();
for (const [d, name] of Object.entries(files)) {
  for (const theme of ["dark", "light"]) {
    for (const view of ["desktop", "phone"]) {
      const page = await browser.newPage({ viewport: { width: view === "phone" ? 390 : 1340, height: 900 } });
      page.on("pageerror", (e) => console.log("pageerror", name, e.message));
      await page.goto(`${pathToFileURL(path.join(dir, name + ".html"))}?theme=${theme}${view === "phone" ? "&view=phone" : ""}`);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.obScroll && window.obScroll());
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      if (view === "phone" && sw > 390) console.log("horizontal scroll", d, theme, sw);
      // lowest contrast of the new text: composite each ancestor's background over the page colour
      const low = await page.evaluate(() => {
        const rgba = (s) => { const m = s.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0]; return [m[0], m[1], m[2], m[3] ?? 1]; };
        const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const over = (top, bot) => [0, 1, 2].map((i) => top[i] * top[3] + bot[i] * (1 - top[3]));
        const pageBg = rgba(getComputedStyle(document.body).backgroundColor);
        let worst = { r: 99 };
        for (const el of document.querySelectorAll(".obadge,.cnt,.onote span,.gt .hint,.cgtx .hint,.cgold,.pc,.oseg span,.dnext span,.more,.oempty .t2,.golink")) {
          const layers = []; for (let e = el; e && e !== document.body; e = e.parentElement) { const b = rgba(getComputedStyle(e).backgroundColor); if (b[3] > 0) layers.push(b); }
          let bg = pageBg; for (const l of layers.reverse()) bg = over(l, bg);
          const c = rgba(getComputedStyle(el).color), fg = over(c, bg);
          const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x), r = (a + 0.05) / (b + 0.05);
          if (r < worst.r) worst = { r: +r.toFixed(2), what: el.className + " " + el.textContent.slice(0, 30) };
        }
        return worst;
      });
      console.log("lowest contrast", d, theme, view, low.r, low.what);
      await page.screenshot({ path: path.join(dir, "shots", `${d}-${theme}-${view}.png`), fullPage: true });
      if (view === "phone" && theme === "dark") {
        const states = await page.evaluate(() => [...document.querySelectorAll(".tag[data-st]")].map((t) => {
          const f = t.nextElementSibling, y = (e) => e.getBoundingClientRect().top + scrollY;
          const top = y(t) - 8, bottom = f.getBoundingClientRect().bottom + scrollY + 4;
          return { s: t.dataset.st, top, h: bottom - top };
        }));
        for (const { s, top, h } of states)
          await page.screenshot({ path: path.join(dir, "shots", `${d}-phone-dark-${s}.png`), fullPage: true, clip: { x: 0, y: top, width: 390, height: Math.min(h, 1000) } });
      }
      await page.close();
    }
  }
}
await browser.close();
