import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { loadAuthConfig, Onboarding, PROVIDERS } from "../src/index";

const ENTER = String.fromCharCode(13); // \r
const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "zc-onb-tui-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("TUI Onboarding", () => {
  it("lands on the key step (one provider/model), masks input, and saves on Enter", async () => {
    let saved: boolean | undefined;
    const { lastFrame, stdin, unmount } = render(
      <Onboarding providers={PROVIDERS} home={home} onDone={(s) => (saved = s)} />,
    );
    await wait();
    expect(lastFrame() ?? "").toContain("Connect DeepSeek");

    const key = `sk-${"a".repeat(40)}`;
    stdin.write(key);
    await wait();
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain(key); // never echoed
    expect(frame).toContain("•"); // masked

    stdin.write(ENTER);
    await wait(90);
    expect(saved).toBe(true);
    const cfg = loadAuthConfig(home);
    expect(cfg.providers.deepseek!.apiKey).toBe(key);
    expect(cfg.provider).toBe("deepseek");
    unmount();
  });

  it("rejects a malformed key inline and saves nothing", async () => {
    let saved: boolean | undefined;
    const { lastFrame, stdin, unmount } = render(
      <Onboarding providers={PROVIDERS} home={home} onDone={(s) => (saved = s)} />,
    );
    await wait();
    stdin.write("not-a-key");
    await wait();
    stdin.write(ENTER);
    await wait(70);
    expect(saved).toBeUndefined(); // onDone never fired
    expect(lastFrame() ?? "").toContain("⚠");
    expect(existsSync(join(home, "config.json"))).toBe(false);
    unmount();
  });

  it("skips on a blank Enter (onDone false, nothing written)", async () => {
    let saved: boolean | undefined;
    const { stdin, unmount } = render(<Onboarding providers={PROVIDERS} home={home} onDone={(s) => (saved = s)} />);
    await wait();
    stdin.write(ENTER); // empty key → skip
    await wait(70);
    expect(saved).toBe(false);
    expect(existsSync(join(home, "config.json"))).toBe(false);
    unmount();
  });
});
