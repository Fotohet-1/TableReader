import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadHiddenSeries,
  saveHiddenSeries,
  loadReaderFontSize,
  saveReaderFontSize,
  READER_FONT_MIN,
  READER_FONT_MAX
} from "./settings";

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: () => null,
    length: 0
  };
}

describe("隐藏项目持久化", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("按存档目录分别保存和读取", () => {
    saveHiddenSeries("~/dir-a", ["甲", "乙"]);
    saveHiddenSeries("~/dir-b", ["丙"]);

    expect(loadHiddenSeries("~/dir-a")).toEqual(["甲", "乙"]);
    expect(loadHiddenSeries("~/dir-b")).toEqual(["丙"]);
    expect(loadHiddenSeries("~/dir-c")).toEqual([]);
  });

  it("损坏的本地数据不会抛错", () => {
    globalThis.localStorage.setItem("sr_hidden_series", "{bad-json");
    expect(loadHiddenSeries("~/dir-a")).toEqual([]);
  });
});

describe("阅读字号记忆", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("越界值会收敛到允许范围", () => {
    saveReaderFontSize(5);
    expect(loadReaderFontSize()).toBe(READER_FONT_MIN);

    saveReaderFontSize(99);
    expect(loadReaderFontSize()).toBe(READER_FONT_MAX);
  });

  it("正常值原样保存", () => {
    saveReaderFontSize(19);
    expect(loadReaderFontSize()).toBe(19);
  });
});
