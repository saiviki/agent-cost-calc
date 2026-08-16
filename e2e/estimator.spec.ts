import { expect, test, type Page } from "@playwright/test";

const JSON_EXAMPLE = `{
  "model_id": "claude-sonnet-4-6",
  "spans": [
    { "input_tokens": 4200, "output_tokens": 890, "cached_tokens": 1800, "tool_name": "retriever" },
    { "input_tokens": 800, "output_tokens": 110 }
  ]
}`;

const CSV_EXAMPLE = `input_tokens,output_tokens,cached_tokens,tool_name,model_id
2000,400,200,search,claude-haiku-4-5`;

async function displayedCosts(page: Page): Promise<string[]> {
  return page.locator("tbody tr td:last-child .font-mono").allTextContents();
}

async function openPaste(page: Page) {
  const summary = page.getByText("Paste usage", { exact: true });
  await summary.click();
  await expect(page.getByLabel("Usage paste")).toBeVisible();
}

test.describe("estimator", () => {
  test("home loads without a Trace Analyzer tab", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Agent Cost Calculator" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /trace analyzer/i })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /trace/i })).toHaveCount(0);
    await expect(page.getByText("Trace Analyzer")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test("/trace is a documented retirement page", async ({ page }) => {
    const response = await page.goto("/trace");
    expect(response?.ok()).toBeTruthy();
    await expect(
      page.getByRole("heading", { name: /Trace Analyzer has been removed/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /cost estimator/i })).toBeVisible();
  });

  test("adjusting a slider changes displayed costs", async ({ page }) => {
    await page.goto("/");
    const before = await displayedCosts(page);
    expect(before.length).toBeGreaterThan(0);
    await page.getByLabel("Input / run").evaluate((el, value) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, 8000);
    await expect.poll(async () => displayedCosts(page)).not.toEqual(before);
  });

  test("task/day/month views sort by the displayed cost", async ({ page }) => {
    await page.goto("/");

    for (const label of ["Per Task", /Per Day/, /Per Month/] as const) {
      await page.getByRole("button", { name: label }).click();
      const costs = await displayedCosts(page);
      expect(costs.length).toBeGreaterThan(1);
      const numeric = costs.map((text) => {
        const n = Number(text.replace(/[$,]/g, "").replace(/m$/, "e-3"));
        expect(Number.isFinite(n)).toBe(true);
        return n;
      });
      const sorted = [...numeric].sort((a, b) => a - b);
      expect(numeric).toEqual(sorted);
    }
  });

  test("loading and applying the JSON example updates sliders", async ({ page }) => {
    await page.goto("/");
    await openPaste(page);
    await page.getByRole("button", { name: "Load example" }).click();
    await expect(page.getByLabel("Usage paste")).toHaveValue(/claude-sonnet-4-6/);
    await page.getByRole("button", { name: "Apply to sliders" }).click();
    await expect(page.getByText("Sliders updated.")).toBeVisible();
    await expect(page.getByLabel("Input / run").locator("xpath=..")).toContainText("5,000");
    await expect(page.getByLabel("Output / run").locator("xpath=..")).toContainText("1,000");
  });

  test("applying valid CSV updates the sliders", async ({ page }) => {
    await page.goto("/");
    await openPaste(page);
    await page.getByLabel("Usage paste").fill(CSV_EXAMPLE);
    await page.getByRole("button", { name: "Apply to sliders" }).click();
    await expect(page.getByText("Sliders updated.")).toBeVisible();
    await expect(page.getByLabel("Input / run").locator("xpath=..")).toContainText("2,000");
    await expect(page.getByLabel("Output / run").locator("xpath=..")).toContainText("400");
  });

  test("invalid input shows an error and the page stays usable", async ({ page }) => {
    await page.goto("/");
    await openPaste(page);
    await page.getByLabel("Usage paste").fill("{nope");
    await page.getByRole("button", { name: "Apply to sliders" }).click();
    await expect(page.getByText("Invalid JSON.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Agent Cost Calculator" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Per Task" }).click();
  });

  test("unknown model id is explicit", async ({ page }) => {
    await page.goto("/");
    await openPaste(page);
    await page.getByLabel("Usage paste").fill(
      JSON.stringify({
        model_id: "mystery-model",
        spans: [{ input_tokens: 10, output_tokens: 5 }],
      }),
    );
    await page.getByRole("button", { name: "Apply to sliders" }).click();
    await expect(page.getByText(/Unknown model_id "mystery-model"/)).toBeVisible();
  });

  test("oversized input is rejected", async ({ page }) => {
    await page.goto("/");
    await openPaste(page);
    const oversized = `{${"x".repeat(64 * 1024)}}`;
    await page.getByLabel("Usage paste").fill(oversized);
    await page.getByRole("button", { name: "Apply to sliders" }).click();
    await expect(page.getByText(/too large/)).toBeVisible();
  });

  test("mobile viewport has no obvious horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Agent Cost Calculator" }),
    ).toBeVisible();
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
      };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
});

// Keep a named reference so the JSON example stays aligned with the UI helper.
void JSON_EXAMPLE;
