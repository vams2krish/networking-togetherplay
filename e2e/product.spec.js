import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
test("two-person listening, host controls, shared seeking, recovery and mobile showcase", async ({
  browser,
  baseURL,
}) => {
  mkdirSync("docs/showcase", { recursive: true });
  const contextA = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    }),
    contextB = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    });
  const host = await contextA.newPage(),
    guest = await contextB.newPage();
  const errors = [];
  host.on("pageerror", (e) => errors.push(e.message));
  guest.on("pageerror", (e) => errors.push(e.message));
  try {
    await host.goto(baseURL);
    await expect(host.locator("#role")).toHaveText("Host");
    await host.screenshot({
      path: "docs/showcase/01-desktop-room.png",
      fullPage: true,
    });
    await guest.goto(host.url());
    await expect(guest.locator("#role")).toHaveText("Partner");
    await expect(host.locator("#status")).toHaveText("2/2 connected");
    await host
      .getByRole("button", { name: "Try the original demo track" })
      .click();
    await expect
      .poll(() => guest.locator("video").evaluate((v) => v.readyState))
      .toBeGreaterThanOrEqual(3);
    await host
      .getByRole("button", { name: "Enable my audio", exact: true })
      .click();
    await host.getByRole("button", { name: "Play together" }).click();
    await expect(host.locator("#playback")).toHaveText("WAITING FOR EVERYONE");
    await host.screenshot({
      path: "docs/showcase/02-coordinated-readiness.png",
      fullPage: true,
    });
    await guest
      .getByRole("button", { name: "Enable my audio", exact: true })
      .click();
    await expect(host.locator("#playback")).toHaveText("PLAYING TOGETHER");
    await expect(guest.locator("#playback")).toHaveText("PLAYING TOGETHER");
    await expect
      .poll(() => guest.locator("video").evaluate((v) => v.currentTime))
      .toBeGreaterThan(0.3);
    await expect(guest.locator("#play")).toBeDisabled();
    await expect
      .poll(() => host.locator("#latency").textContent())
      .toMatch(/ms/);
    await host.screenshot({
      path: "docs/showcase/03-playing-together.png",
      fullPage: true,
    });
    await guest.screenshot({
      path: "docs/showcase/04-partner-view.png",
      fullPage: true,
    });
    await host.locator("#seek").fill("12");
    await expect
      .poll(() => guest.locator("video").evaluate((v) => v.currentTime))
      .toBeGreaterThanOrEqual(11.5);
    await host.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(guest.locator("#playback")).toHaveText("PAUSED TOGETHER");
    await host.locator("#hostOnly").uncheck();
    await expect(guest.locator("#play")).toBeEnabled();
    await guest.getByRole("button", { name: "Play together" }).click();
    await expect(host.locator("#playback")).toHaveText("PLAYING TOGETHER");
    await host.reload();
    await expect(host.locator("#role")).toHaveText("Host");
    await expect(host.locator("#source")).toHaveValue("/demo.wav");
    await host.setViewportSize({ width: 390, height: 844 });
    await host.screenshot({
      path: "docs/showcase/05-mobile-room.png",
      fullPage: true,
    });
    expect(
      await host.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (process.env.LIVE_VIDEO_URL) {
      await host.setViewportSize({ width: 1440, height: 1100 });
      await host.locator("#source").fill(process.env.LIVE_VIDEO_URL);
      await host
        .getByRole("button", { name: "Load media", exact: true })
        .click();
      await expect
        .poll(() => guest.locator("video").evaluate((v) => v.videoWidth))
        .toBeGreaterThan(0);
      await host
        .getByRole("button", { name: "Enable my audio", exact: true })
        .click();
      await host.getByRole("button", { name: "Play together" }).click();
      await expect(guest.locator("#playback")).toHaveText("PLAYING TOGETHER");
      await host.screenshot({
        path: "docs/showcase/06-video-playback.png",
        fullPage: true,
      });
    }
    expect(errors).toEqual([]);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
