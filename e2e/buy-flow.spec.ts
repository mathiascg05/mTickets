import { test, expect } from "@playwright/test";

test.describe("Buy flow", () => {
  test("complete purchase shows ticket page", async ({ page }) => {
    // This test requires a running app with a valid event
    // Set EVENT_SLUG env var to target a specific event
    const slug = process.env.EVENT_SLUG;
    if (!slug) {
      test.skip();
      return;
    }

    await page.goto(`/events/${slug}`);
    await expect(page.locator("h1")).toBeVisible();

    // Click first Buy button
    const buyButton = page.locator("a", { hasText: "Buy" }).first();
    await expect(buyButton).toBeVisible();
    await buyButton.click();

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

    // Accept terms
    await page.locator('input[type="checkbox"]').check();

    // Submit
    await page.locator('button[type="submit"]').click();

    // Should redirect to ticket page
    await expect(page).toHaveURL(/\/ticket\//, { timeout: 15000 });
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
    const slug = process.env.EVENT_SLUG;
    if (!slug) {
      test.skip();
      return;
    }

    await page.goto(`/events/${slug}`);

    // Change qty to 3 and click Buy
    const qtySelect = page.locator("select").first();
    if (await qtySelect.isVisible()) {
      await qtySelect.selectOption("3");
    }

    const buyButton = page.locator("a", { hasText: "Buy" }).first();
    await buyButton.click();

    // Should show 3 attendee sections
    const attendeeHeaders = page.locator("text=/Attendee \\d+/");
    await expect(attendeeHeaders).toHaveCount(3);
  });
});
