import { test, expect } from "@playwright/test";

/**
 * Helper: after clicking Buy on the events page, the flow may go through
 * the queue (/queue/) before landing on the final buy page (/buy/?queueToken=...).
 * This helper waits until the page is stable on /buy/ with the form visible.
 */
async function waitForBuyForm(page: import("@playwright/test").Page) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const url = page.url();

    if (url.includes("/queue/")) {
      // On queue page — wait for admission redirect to /buy/
      try {
        await page.waitForURL(/\/buy\//, { timeout: Math.min(60_000, deadline - Date.now()) });
      } catch {
        // Timeout — keep trying
      }
      continue;
    }

    if (url.includes("/buy/")) {
      // Check if form is visible — use "Attendee" text which is always present
      const formVisible = await page
        .locator("text=Attendee 1")
        .isVisible()
        .catch(() => false);
      if (formVisible) {
        return;
      }

      // Check if "Not Enough Tickets" is shown
      const notEnough = await page
        .locator("text=Not Enough Tickets")
        .isVisible()
        .catch(() => false);
      if (notEnough) {
        throw new Error("Not enough tickets available for this test");
      }

      // Still loading or about to redirect — wait a bit
      await page.waitForTimeout(1000);
      continue;
    }

    await page.waitForTimeout(500);
  }
  throw new Error("Timed out waiting for buy form");
}

test.describe("Buy flow", () => {
  test("complete purchase shows ticket page", async ({ page }) => {
    test.setTimeout(120_000);

    // This test requires a running app with a valid event
    // Set EVENT_SLUG env var to target a specific event
    const slug = process.env.EVENT_SLUG;
    if (!slug) {
      test.skip();
      return;
    }

    await page.goto(`/events/${slug}`);
    await expect(page.locator("h1")).toBeVisible();

    // Click first Buy button (may navigate to /buy/ or /queue/)
    const buyButton = page.locator("a", { hasText: "Buy" }).first();
    await expect(buyButton).toBeVisible();
    await buyButton.click();

    // Wait for the buy form to be ready (handles queue flow)
    await waitForBuyForm(page);

    // Fill attendee form
    await page.fill('input[placeholder="First name"]', "Test");
    await page.fill('input[placeholder="Last name"]', "User");
    await page.fill('input[placeholder="email@example.com"]', "test@example.com");
    await page.fill('input[placeholder="ID number"]', "12345678");

    // Select first payment method
    const paymentRadio = page.locator('input[name="paymentMethod"]').first();
    if (await paymentRadio.isVisible()) {
      await paymentRadio.check();
    }

    // Upload payment proof screenshot if required
    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    if (await fileInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      const buffer = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      );
      await fileInput.setInputFiles({
        name: "proof.png",
        mimeType: "image/png",
        buffer,
      });
    }

    // Fill payment reference number if required
    const refInput = page.locator(
      'input[placeholder="Enter your payment reference number"]',
    );
    if (await refInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await refInput.fill("REF-TEST-12345");
    }

    // Accept terms
    await page.locator('input[type="checkbox"]').check();

    // Submit
    await page.locator('button[type="submit"]').click();

    // Should redirect to ticket page
    await expect(page).toHaveURL(/\/ticket\//, { timeout: 30000 });
  });

  test("sold out ticket shows Sold Out label", async ({ page }) => {
    const slug = process.env.EVENT_SLUG_SOLD_OUT;
    if (!slug) {
      test.skip();
      return;
    }

    await page.goto(`/events/${slug}`);
    await expect(page.locator("text=Sold Out")).toBeVisible();
  });

  test("invalid coupon shows error", async ({ page }) => {
    const slug = process.env.EVENT_SLUG_WITH_COUPONS;
    if (!slug) {
      test.skip();
      return;
    }

    await page.goto(`/events/${slug}`);
    const buyButton = page.locator("a", { hasText: "Buy" }).first();
    await buyButton.click();

    // Enter invalid coupon
    const couponInput = page.locator('input[placeholder="Enter coupon code"]');
    if (await couponInput.isVisible()) {
      await couponInput.fill("INVALIDCODE");
      await page.locator("button", { hasText: "Apply" }).click();
      await expect(page.locator("text=Invalid coupon code")).toBeVisible();
    }
  });

  test("multi-attendee shows correct number of forms", async ({ page }) => {
    test.setTimeout(120_000);

    const slug = process.env.EVENT_SLUG;
    if (!slug) {
      test.skip();
      return;
    }

    // Get the last available ticket type ID from the events page
    // (use last to avoid collision with the complete-purchase test that uses first)
    await page.goto(`/events/${slug}`);
    await expect(page.locator("h1")).toBeVisible();

    // Extract the href of the last Buy link to avoid ticket type collision
    const buyLink = page.locator("a", { hasText: "Buy" }).last();
    await expect(buyLink).toBeVisible();
    const href = await buyLink.getAttribute("href");
    if (!href) {
      test.skip();
      return;
    }

    // Navigate directly to the buy page with qty=3
    const url = new URL(href, "http://localhost:3000");
    // Force /buy/ path (skip queue) and set qty=3
    const ticketTypeId = url.pathname.split("/").pop();
    const phaseId = url.searchParams.get("phaseId");
    const buyUrl = phaseId
      ? `/buy/${ticketTypeId}?qty=3&phaseId=${phaseId}`
      : `/buy/${ticketTypeId}?qty=3`;
    await page.goto(buyUrl);

    // Handle potential queue redirect
    await waitForBuyForm(page);

    // Should show 3 attendee sections
    const attendeeHeaders = page.locator("text=/Attendee \\d+/");
    await expect(attendeeHeaders).toHaveCount(3);
  });
});
