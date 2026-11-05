import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../jkt48Api", () => ({ jkt48ApiGet: mocks.get }));

import { fetchNewsData } from "../news";

afterEach(() => {
  mocks.get.mockReset();
  vi.restoreAllMocks();
});

describe("fetchNewsData", () => {
  it("returns null when jkt48.com is unreachable and nothing was cached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.get.mockRejectedValue(new Error("blocked"));
    expect(await fetchNewsData()).toBeNull();
  });

  it("serves the last good list when a later fetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const items = [{ title: "T", category: "c", link: "slug" }];
    mocks.get.mockResolvedValueOnce(items);
    expect(await fetchNewsData()).toEqual(items);
    mocks.get.mockRejectedValue(new Error("blocked"));
    expect(await fetchNewsData()).toEqual(items);
  });
});
