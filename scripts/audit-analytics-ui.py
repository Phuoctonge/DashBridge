import asyncio
import json
import os
from pathlib import Path

from playwright.async_api import async_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "test-results" / "analytics-ui-audit"
URL = os.environ.get("DASHBRIDGE_ANALYTICS_URL", "http://127.0.0.1:18080/admin/")
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
VIEWPORTS = ((1440, 900), (1024, 768), (768, 1024), (430, 932), (360, 800), (320, 568))


AUDIT_SCRIPT = """
() => {
  const visible = element => {
    if (!element.checkVisibility({ checkVisibilityCSS: true })) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const candidates = [...document.querySelectorAll('button,select,summary,a,[tabindex]:not([tabindex="-1"])')]
    .filter(visible).filter(element => !element.classList.contains('table-wrap')).map((element, index) => {
      const rect = element.getBoundingClientRect();
      let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
      }
      return { index, tag: element.tagName, id: element.id, text: (element.innerText || element.value || '').trim().slice(0, 80),
        left, top, right, bottom, width: rect.width, height: rect.height };
    }).filter(rect => rect.right > rect.left && rect.bottom > rect.top);
  const overlaps = [];
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const a = candidates[left]; const b = candidates[right];
      const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (width > 1 && height > 1) overlaps.push({ a, b, area: Math.round(width * height) });
    }
  }
  const escaped = [...document.querySelectorAll('body *')].filter(visible).filter(element => {
    if (element.closest('.table-wrap,.timeline')) return false;
    const rect = element.getBoundingClientRect();
    return rect.left < -1 || rect.right > innerWidth + 1;
  }).slice(0, 30).map(element => {
    const rect = element.getBoundingClientRect();
    return { tag: element.tagName, id: element.id, className: String(element.className).slice(0, 100),
      left: Math.round(rect.left), right: Math.round(rect.right), text: (element.textContent || '').trim().slice(0, 80) };
  });
  return {
    viewport: { width: innerWidth, height: innerHeight },
    document: { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
    overlaps,
    escaped,
    smallTargets: candidates.filter(item => item.height < 44 || item.width < 44),
    tableWidths: [...document.querySelectorAll('.table-wrap')].map(wrapper => ({
      id: wrapper.querySelector('table')?.id || '', clientWidth: wrapper.clientWidth,
      scrollWidth: wrapper.scrollWidth, clientHeight: wrapper.clientHeight, scrollHeight: wrapper.scrollHeight,
    })),
  };
}
"""


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    results = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, executable_path=str(CHROME))
        for width, height in VIEWPORTS:
            context = await browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1)
            page = await context.new_page()
            messages = []
            page.on("console", lambda message: messages.append(f"{message.type}: {message.text}"))
            page.on("pageerror", lambda error: messages.append(f"pageerror: {error}"))
            response = await page.goto(URL, wait_until="networkidle")
            await page.locator("#status").wait_for(state="visible")
            await page.screenshot(path=OUTPUT / f"top-{width}x{height}.png")
            await page.screenshot(path=OUTPUT / f"dashboard-{width}x{height}.png", full_page=True)
            bars = page.locator("#timeline .bar")
            if await bars.count():
                tooltip_checks = []
                for name, index in (("first", 0), ("middle", await bars.count() // 2), ("last", await bars.count() - 1)):
                    bar = bars.nth(index)
                    await bar.focus()
                    await bar.press("Enter")
                    await page.locator("#rowDetails[open]").wait_for()
                    metrics = {"name": await bar.get_attribute("aria-label"),
                               "detail": await page.locator("#rowDetailsBody").inner_text()}
                    await page.locator("#rowDetails").press("Escape")
                    assert await bar.evaluate("element => element === document.activeElement")
                    metrics["position"] = name
                    tooltip_checks.append(metrics)
                    await page.locator("#timeline").locator("xpath=ancestor::section").screenshot(
                        path=OUTPUT / f"timeline-{name}-{width}x{height}.png")
                audit_tooltips = tooltip_checks
            else:
                audit_tooltips = []
            await page.locator("#problems").locator("xpath=ancestor::section").screenshot(
                path=OUTPUT / f"problems-{width}x{height}.png")
            audit = await page.evaluate(AUDIT_SCRIPT)
            audit["timelineTooltips"] = audit_tooltips
            audit["httpStatus"] = response.status if response else None
            audit["console"] = messages
            if width == 430:
                await page.locator("details.legend > summary").click()
                audit["legendOpened"] = await page.locator("details.legend").get_attribute("open") is not None
                await page.locator('#filterPanel > summary').click()
                await page.locator("#version").select_option("2.4.3")
                await page.wait_for_load_state("networkidle")
                audit["versionFilterApplied"] = await page.locator("#version").input_value() == "2.4.3"
                await page.locator("#reset").click()
                await page.wait_for_load_state("networkidle")
                audit["resetWorked"] = await page.locator("#version").input_value() == "" and await page.locator("#days").input_value() == "30"
                problems = page.locator("#problems").locator("xpath=ancestor::div[contains(@class,'table-wrap')]")
                await problems.evaluate("element => { element.scrollLeft = element.scrollWidth; }")
                audit["horizontalScrollWorked"] = await problems.evaluate("element => element.scrollLeft > 0")
                await problems.screenshot(path=OUTPUT / "problems-right-430x932.png")
            results.append(audit)
            await context.close()
        await browser.close()
    report = OUTPUT / "report.json"
    report.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(report)
    for item in results:
        print(json.dumps({
            "viewport": item["viewport"], "document": item["document"],
            "overlaps": len(item["overlaps"]), "escaped": len(item["escaped"]),
            "smallTargets": len(item["smallTargets"]), "console": item["console"],
            "interactions": {key: item[key] for key in ("legendOpened", "versionFilterApplied", "resetWorked", "horizontalScrollWorked") if key in item},
        }, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
