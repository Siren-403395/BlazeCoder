import { describe, expect, it } from "vitest";
import { classifyCommand } from "../src/index";

describe("classifyCommand — catastrophic tripwire (must force confirmation)", () => {
  const catastrophic = [
    "rm -rf /",
    "rm -rf /*",
    "rm -rf ~",
    "rm -rf ~/",
    "rm -rf $HOME",
    'rm -rf "$HOME"',
    "rm -rf '$HOME'",
    "rm -rf ${HOME}",
    "rm -rf -- /",
    "rm -rf / --no-preserve-root",
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
    "echo x>/dev/sda", // attached redirect (no space) still caught
    ":(){ :|:& };:",
    "rm -rf /opt", // FHS system dir
    "find / -delete", // filesystem wipe via find
    "find / -exec rm {} ;",
    // Evasions the classifier must see through:
    "\\rm -rf /", // alias-bypass backslash
    "/bin/rm -rf /", // absolute path
    "./rm -rf /", // relative path
    "busybox rm -rf /", // wrapper binary
    "xargs rm -rf /", // wrapper binary
    "bash -c 'rm -rf /'", // shell -c
    'sh -c "rm -rf ~"',
    "eval rm -rf /", // eval
    "sudo bash -c 'rm -rf /'", // sudo + shell -c
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

describe("classifyCommand — NOT catastrophic (false-positive guards)", () => {
  // Scratch/relative/scoped deletes that must NOT force a confirmation under an allow rule.
  const notCatastrophic = [
    "rm -rf /tmp/*", // scratch root, not a system dir
    "rm -rf /tmp",
    "rm -rf /var/tmp/*", // (the old single-level regex created a /tmp-vs-/var/tmp asymmetry)
    "rm -rf /data", // a custom mount, not FHS
    "rm -rf node_modules",
    "rm -rf ./dist",
    "rm -rf ~/Documents", // a home SUBTREE is scoped, not the whole home
    "find . -delete", // common scoped cleanup
    "chmod -R 755 ./public",
  ];
  for (const cmd of notCatastrophic) {
    it(`does NOT flag catastrophic: ${cmd}`, () => {
      expect(classifyCommand(cmd).catastrophic).toBe(false);
    });
  }
});

describe("classifyCommand — destructive but NOT catastrophic (advisory only)", () => {
  const cases: [string, string][] = [
    ["rm -rf node_modules", "filesystem"],
    ["rm -rf dist", "filesystem"],
    ["git push --force", "git"],
    ["git push -f origin main", "git"],
    ["git reset --hard HEAD~1", "git"],
    ["git clean -fd", "git"],
    ["rm -rf /tmp/*", "filesystem"], // destructive scratch cleanup, not catastrophic
    ["find . -delete", "filesystem"],
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
    ["chmod -R 755 ./public", "write", "filesystem"], // recognized now (was 'unknown')
    ["chown user file.txt", "write", "filesystem"],
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

describe("classifyCommand — Windows catastrophic tripwire (cmd.exe + PowerShell)", () => {
  const catastrophic = [
    "del /s /q C:\\",
    "del /f /s /q C:\\*",
    "DEL /S /Q C:\\", // case-insensitive
    "rd /s /q C:\\",
    "rd /s /q C:\\Windows",
    "rmdir /s /q C:\\Windows\\System32",
    "del /s C:/Windows", // forward slashes normalized
    "format C:",
    "format /q D:",
    "Remove-Item -Recurse -Force C:\\",
    "remove-item -recurse C:\\Windows",
    "ri -r C:\\Users",
    "del /s /q %SystemRoot%",
    "rd /s /q %windir%",
    "Remove-Item -Recurse $env:SystemDrive\\",
    "cd tmp && del /s /q C:\\", // catastrophic tail of a compound command
  ];
  for (const cmd of catastrophic) {
    it(`flags catastrophic: ${cmd}`, () => {
      const c = classifyCommand(cmd);
      expect(c.catastrophic).toBe(true);
      expect(c.risk).toBe("destructive");
    });
  }

  const notCatastrophic = [
    "del /q foo.txt", // a scoped file delete
    "del /s /q .\\dist", // a scoped recursive delete
    "rd /s /q node_modules",
    "Remove-Item -Recurse -Force .\\build",
    "rmdir /s /q C:\\Users\\Alice\\project", // a deep user subpath is scoped, not the whole drive
    "del /s /q C:\\project\\tmp",
    "copy a.txt b.txt",
    "dir C:\\", // listing a drive root is read-only, not a wipe
  ];
  for (const cmd of notCatastrophic) {
    it(`does NOT flag catastrophic: ${cmd}`, () => {
      expect(classifyCommand(cmd).catastrophic).toBe(false);
    });
  }
});

describe("classifyCommand — Windows advisory risk", () => {
  const cases: [string, string, string][] = [
    // command, expected risk, expected category
    ["dir", "read", "process"],
    ["type package.json", "read", "process"],
    ["findstr foo src", "read", "process"],
    ["Get-Content file.txt", "read", "process"],
    ["gci -Recurse", "read", "process"],
    ["copy a.txt b.txt", "write", "filesystem"],
    ["xcopy /s src dst", "write", "filesystem"],
    ["ren old.txt new.txt", "write", "filesystem"],
    ["New-Item -ItemType File x.txt", "write", "filesystem"],
    ["del foo.txt", "destructive", "filesystem"],
    ["rd /s /q node_modules", "destructive", "filesystem"],
    ["Remove-Item -Recurse build", "destructive", "filesystem"],
  ];
  for (const [cmd, risk, category] of cases) {
    it(`${cmd} → ${risk}/${category}`, () => {
      const c = classifyCommand(cmd);
      expect(c.risk).toBe(risk);
      expect(c.category).toBe(category);
      expect(c.catastrophic).toBe(false);
    });
  }
});
