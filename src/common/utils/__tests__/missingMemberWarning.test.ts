import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
let testDir: string | undefined;
let closeDatabase: (() => Promise<void>) | undefined;

async function loadTracker(databasePath: string) {
  process.env.NODE_ENV = "test";
  process.env.DB_PATH = databasePath;
  process.env.BOT_TOKEN = "x";
  process.env.DISCORD_WEBHOOK_URL = "http://localhost";
  process.env.FLARE_SOLVER_BASE = "http://localhost";
  process.env.OWNER_ID = "1";
  process.env.WEBHOOK_APPROVAL_ID = "1";
  process.env.X_API_KEY = "x";
  vi.resetModules();
  const db = (await import("@/common/utils/db")).default;
  closeDatabase = () => new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
  return { tracker: await import("@/common/utils/giftTracker"), db };
}

afterEach(async () => {
  if (closeDatabase) await closeDatabase();
  closeDatabase = undefined;
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
  process.env = { ...originalEnv };
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("missing member warning persistence", () => {
  it("warns once per UUID per WIB day across polls and database reopen", async () => {
    testDir = mkdtempSync(path.join(tmpdir(), "supporter-warning-"));
    const databasePath = path.join(testDir, "whitelist.db");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T16:59:59Z")); // 23:59:59 WIB

    const first = await loadTracker(databasePath);
    await first.tracker.rememberStreamer("unknown-uuid", "jkt48_unknown", "Unknown");
    await first.tracker.warnMissingMember("unknown-uuid", "jkt48_unknown", "Unknown");
    await first.tracker.warnMissingMember("unknown-uuid", "jkt48_unknown", "Unknown");
    expect(warning).toHaveBeenCalledTimes(1);

    await closeDatabase?.();
    closeDatabase = undefined;
    const reopened = await loadTracker(databasePath);
    const stored = await new Promise<{ username: string; name: string } | undefined>((resolve, reject) =>
      reopened.db.get("SELECT username, name FROM idn_streamers WHERE uuid = ?", ["unknown-uuid"], (err, row) =>
        err ? reject(err) : resolve(row as { username: string; name: string } | undefined),
      ),
    );
    expect(stored).toEqual({ username: "jkt48_unknown", name: "Unknown" });
    await reopened.tracker.warnMissingMember("unknown-uuid", "jkt48_unknown", "Unknown");
    expect(warning).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-04T17:00:00Z")); // 00:00:00 WIB next day
    await reopened.tracker.warnMissingMember("unknown-uuid", "jkt48_unknown", "Unknown");
    expect(warning).toHaveBeenCalledTimes(2);

    const members = JSON.parse(readFileSync("member.json", "utf8")) as {
      is_graduate?: boolean;
      socials?: { title: string; url: string }[];
    }[];
    const knownMembers = members
      .map((member) => ({
        graduate: member.is_graduate,
        uuid: /profile\/([0-9a-f-]{36})/.exec(member.socials?.find((social) => social.title === "IDN")?.url ?? "")?.[1],
      }))
      .filter((member) => member.uuid);
    const activeUuid = knownMembers.find((member) => !member.graduate)?.uuid;
    const graduateUuid = knownMembers.find((member) => member.graduate)?.uuid;
    expect(activeUuid).toBeTruthy();
    expect(graduateUuid).toBeTruthy();
    await reopened.tracker.warnMissingMember(activeUuid!, "jkt48_known", "Known");
    await reopened.tracker.warnMissingMember(graduateUuid!, "jkt48_graduate", "Graduate");
    await reopened.tracker.warnMissingMember("other-uuid", "other_account", "Other");
    expect(warning).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
