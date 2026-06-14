import { describe, expect, it } from "vitest";
import { classifyCommand } from "../src/index";

describe("classifyCommand — catastrophic tripwire (must force confirmation)", () => {
  const catastrophic = [
    "rm -rf /",
    "rm -rf /*",
    "rm -rf ~",
    "rm -rf ~/",
    "rm -rf $HOME",
    "rm -rf *",
    "rm -fr /usr",
    "sudo rm -rf /",
    "rm --recursive --force /",
    "dd if=/dev/zero of=/dev/sda",
    "mkfs.ext4 /dev/sdb",
    "mkfs /dev/sdb",
    "chmod -R 777 /",
    "chown -R root ~",
    "echo boom > /dev/sda",
    ":(){ :|:& };:",
  ];
  for (const cmd of catastrophic) {
    it(`flags catastrophic: ${cmd}`, () => {
      const c = classifyCommand(cmd);
      expect(c.catastrophic).toBe(true);
      expect(c.risk).toBe("destructive");
    });
  }

  it("strips a leading env assignment before judging (FOO=bar rm -rf /)", () => {
    expect(classifyCommand("FOO=bar rm -rf /").catastrophic).toBe(true);
  });

  it("catches a catastrophic tail of a compound command (cd x && rm -rf ~)", () => {
    expect(classifyCommand("cd x && rm -rf ~").catastrophic).toBe(true);
  });
});

describe("classifyCommand — destructive but NOT catastrophic (advisory only)", () => {
  const cases: [string, string][] = [
    ["rm -rf node_modules", "filesystem"],
    ["rm -rf dist", "filesystem"],
    ["git push --force", "git"],
    ["git push -f origin main", "git"],
    ["git reset --hard HEAD~1", "git"],
    ["git clean -fd", "git"],
  ];
  for (const [cmd, category] of cases) {
    it(`${cmd} → destructive, not catastrophic`, () => {
      const c = classifyCommand(cmd);
      expect(c.risk).toBe("destructive");
      expect(c.catastrophic).toBe(false);
      expect(c.category).toBe(category);
    });
  }
});

describe("classifyCommand — graded advisory risk", () => {
  const cases: [string, string, string][] = [
    // command, expected risk, expected category
    ["ls -la", "read", "process"],
    ["git status", "read", "git"],
    ["cat package.json", "read", "process"],
    ["grep -r foo src", "read", "process"],
    ["pnpm test", "read", "test"],
    ["vitest run", "read", "test"],
    ["go test ./...", "read", "test"],
    ["git commit -m wip", "write", "git"],
    ["mkdir build", "write", "filesystem"],
    ["npm run build", "write", "process"],
    ["sed -i s/a/b/ f.txt", "write", "filesystem"],
    ["git push origin main", "network", "git"],
    ["npm install", "network", "install"],
    ["pnpm add zod", "network", "install"],
    ["curl https://example.com", "network", "network"],
    ["npm publish", "network", "publish"],
  ];
  for (const [cmd, risk, category] of cases) {
    it(`${cmd} → ${risk}/${category}`, () => {
      const c = classifyCommand(cmd);
      expect(c.risk).toBe(risk);
      expect(c.category).toBe(category);
      expect(c.catastrophic).toBe(false);
    });
  }

  it("a compound command takes the riskiest segment (install && test → network)", () => {
    expect(classifyCommand("npm install && npm test").risk).toBe("network");
  });

  it("an unrecognized command is conservatively treated as a write", () => {
    const c = classifyCommand("frobnicate --all");
    expect(c.risk).toBe("write");
    expect(c.category).toBe("unknown");
    expect(c.catastrophic).toBe(false);
  });

  it("an empty command is harmless", () => {
    expect(classifyCommand("   ").risk).toBe("read");
  });
});
