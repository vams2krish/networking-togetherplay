import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
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
  const verification = {
    target: baseURL,
    verifiedAt: new Date().toISOString(),
    browser: "Chromium",
    checks: [],
  };
  host.on("pageerror", (e) => errors.push(e.message));
  guest.on("pageerror", (e) => errors.push(e.message));
  try {
    const health = await host.request.get(`${baseURL}/healthz`);
    expect(health.ok()).toBe(true);
    const storage = await health.json();
    expect(storage.status).toBe("ok");
    if (process.env.PRODUCTION_VERIFY) expect(storage.storage).toBe("postgres");
    verification.storage = storage.storage;
    verification.checks.push("HTTP health and durable production storage");
    await host.goto(baseURL);
    await expect(host.locator("#role")).toHaveText("Host");
    await host.screenshot({
      path: "docs/showcase/01-desktop-room.png",
      fullPage: true,
    });
    await guest.goto(host.url());
    await expect(guest.locator("#role")).toHaveText("Partner");
    await expect(host.locator("#status")).toHaveText("2/2 connected");
    verification.checks.push("Host creation and isolated partner join");
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
    await expect
      .poll(() => host.locator("video").evaluate((v) => v.paused))
      .toBe(true);
    verification.checks.push(
      "Playback waits for both participants to enable audio",
    );
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
    await expect
      .poll(() => host.locator("video").evaluate((v) => v.paused))
      .toBe(false);
    const [hostTime, guestTime] = await Promise.all([
      host.locator("video").evaluate((v) => v.currentTime),
      guest.locator("video").evaluate((v) => v.currentTime),
    ]);
    verification.observedPlaybackDifferenceMs = Math.round(
      Math.abs(hostTime - guestTime) * 1000,
    );
    verification.measurementNote =
      "One pair of asynchronous browser readings on the same test machine; not an internet synchronization benchmark.";
    verification.checks.push(
      "Audio media advances in both browsers; host-only guest controls disabled",
    );
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
    await expect
      .poll(() => guest.locator("video").evaluate((v) => v.paused))
      .toBe(true);
    verification.checks.push("Shared seeking and actual paused media state");
    await host.locator("#hostOnly").uncheck();
    await expect(guest.locator("#play")).toBeEnabled();
    await guest.getByRole("button", { name: "Play together" }).click();
    await expect(host.locator("#playback")).toHaveText("PLAYING TOGETHER");
    verification.checks.push(
      "Host unlocks playback; partner successfully starts playback",
    );
    await host.reload();
    await expect(host.locator("#role")).toHaveText("Host");
    await expect(host.locator("#source")).toHaveValue("/demo.wav");
    await guest.reload();
    await expect(guest.locator("#role")).toHaveText("Partner");
    await expect(guest.locator("#source")).toHaveValue("/demo.wav");
    await expect(host.locator("#status")).toHaveText("2/2 connected");
    verification.checks.push(
      "Host and partner reload preserve roles, media, and room membership",
    );
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
    verification.checks.push("390px mobile layout has no horizontal overflow");
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
      await guest
        .getByRole("button", { name: "Enable my audio", exact: true })
        .click();
      await host.getByRole("button", { name: "Play together" }).click();
      await expect(guest.locator("#playback")).toHaveText("PLAYING TOGETHER");
      await expect
        .poll(() => guest.locator("video").evaluate((v) => v.currentTime))
        .toBeGreaterThan(0.1);
      verification.checks.push(
        "External HTTPS video decodes and advances in both-member room",
      );
      await host.screenshot({
        path: "docs/showcase/06-video-playback.png",
        fullPage: true,
      });
    }
    const thirdContext = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    });
    try {
      const third = await thirdContext.newPage();
      await third.goto(host.url());
      await expect(third.locator("#message")).toHaveText(
        "This room already has two people.",
      );
      await expect(third.locator("#status")).toHaveText("Room unavailable");
      await third.screenshot({
        path: "docs/showcase/07-room-capacity.png",
        fullPage: true,
      });
      verification.checks.push(
        "A third browser is denied entry to the two-person room",
      );
    } finally {
      await thirdContext.close();
    }
    expect(errors).toEqual([]);
    verification.checks.push("No uncaught browser JavaScript errors");
    verification.status = "passed";
    if (process.env.PRODUCTION_VERIFY) {
      writeFileSync(
        "docs/production-verification.json",
        JSON.stringify(verification, null, 2) + "\n",
      );
    }
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
