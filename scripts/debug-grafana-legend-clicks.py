import asyncio
from playwright.async_api import async_playwright

URL = "https://grafanakns.mos.ru/d/d78c98f6dd89/monitoring-jmeter-mirsky?orgId=1&refresh=10s&var-station=$__all&from=2026-09-11T00:50:10.979Z&to=2026-09-11T00:55:04.078Z&timezone=Europe%2FMoscow&var-dataSource=000000039&var-project=RussPass&viewPanel=panel-138"
PROFILE = r"C:\Users\Vanya\AppData\Local\DashBridge\E2E\browser-profile"
CHROME = r"C:\Users\Vanya\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe"
EXTENSION = r"D:\Work\Automation\DashBridge"


async def snapshot(table, step):
    state = await table.evaluate("""(table, step) => {
      const headers = [...table.querySelectorAll('thead th')];
      const rows = [...table.querySelectorAll('tbody tr')];
      return {
        step,
        headers: headers.map(h => ({
          text: h.textContent.trim(),
          html: h.innerHTML,
          ariaSort: h.getAttribute('aria-sort'),
          backgroundImage: h.style.backgroundImage,
          visibility: [...h.querySelectorAll('svg')].map(svg => getComputedStyle(svg).visibility),
        })),
        rowCount: rows.length,
        childCounts: [...new Set(rows.map(r => r.children.length))],
        firstRows: rows.slice(0, 3).map(r => [...r.children].map(c => c.textContent.trim())),
        lastCells: rows.map(r => r.querySelectorAll('[data-dashbridge-summary-column="last"]').length),
      };
    }""", step)
    print(state, flush=True)


async def main():
    async with async_playwright() as playwright:
        context = await playwright.chromium.launch_persistent_context(
            PROFILE,
            headless=True,
            executable_path=CHROME,
            args=[f"--disable-extensions-except={EXTENSION}", f"--load-extension={EXTENSION}"],
        )
        page = context.pages[0] if context.pages else await context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        await page.goto(URL, wait_until="domcontentloaded")
        table = page.locator("table").filter(has=page.locator('button[class*="LegendLabel"]')).first
        await table.wait_for(state="visible", timeout=30000)
        await page.wait_for_timeout(3000)
        await snapshot(table, "initial")
        for step, name in enumerate(["Max", "Last", "Max", "Last", "Max", "Last"], start=1):
            header = table.locator("thead th", has_text=name).last
            if await header.count() == 0:
                print({"step": step, "missing": name}, flush=True)
                break
            await header.click()
            await page.wait_for_timeout(700)
            await snapshot(table, f"{step}:{name}")
        print({"pageErrors": errors}, flush=True)
        await context.close()


if __name__ == "__main__":
    asyncio.run(main())
