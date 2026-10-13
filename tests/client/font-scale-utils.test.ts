// ...existing code...
import {
  getCurrentFontScale,
  setFontScale,
  increaseFontScale,
  decreaseFontScale,
  FONT_SCALES,
  DEFAULT_FONT_SCALE,
} from "@/lib/font-scale-utils";

const createLocalStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  } as Storage;
};

describe("Font Scale Utils", () => {
  beforeAll(() => {
    if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== "function") {
      vi.stubGlobal("localStorage", createLocalStorageMock());
    }
  });

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Reset CSS variable
    document.documentElement.style.removeProperty("--ui-font-scale");
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("getCurrentFontScale", () => {
    it("should return default scale when no value is stored", () => {
      expect(getCurrentFontScale()).toBe(DEFAULT_FONT_SCALE);
    });

    it("should return stored scale value", () => {
      localStorage.setItem("unoFontScale", "1.125");
      expect(getCurrentFontScale()).toBe(1.125);
    });

    it("should return default for invalid stored value", () => {
      localStorage.setItem("unoFontScale", "invalid");
      expect(getCurrentFontScale()).toBe(DEFAULT_FONT_SCALE);
    });

    it("should handle localStorage errors gracefully", () => {
      // Mock localStorage to throw error
      const originalGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = () => {
        throw new Error("Storage error");
      };

      expect(getCurrentFontScale()).toBe(DEFAULT_FONT_SCALE);

      // Restore
      Storage.prototype.getItem = originalGetItem;
    });
  });

  describe("setFontScale", () => {
    it("should store scale in localStorage", () => {
      setFontScale(1.25);
      expect(localStorage.getItem("unoFontScale")).toBe("1.25");
    });

    it("should update CSS variable", () => {
      setFontScale(1.5);
      const cssValue = document.documentElement.style.getPropertyValue(
        "--ui-font-scale"
      );
      expect(cssValue).toBe("1.5");
    });

    it("should dispatch custom event", () => {
      let eventFired = false;
      let eventDetail: any = null;

      const handler = ((e: CustomEvent) => {
        eventFired = true;
        eventDetail = e.detail;
      }) as EventListener;

      document.addEventListener("uiFontScaleChange", handler);

      setFontScale(1.125);

      expect(eventFired).toBe(true);
      expect(eventDetail).toEqual({ value: 1.125 });

      document.removeEventListener("uiFontScaleChange", handler);
    });
  });

  describe("increaseFontScale", () => {
    it.each([
      { title: "should increase from S to M", from: 0.875, changed: true, to: 1.0 },
      { title: "should increase from M to L", from: 1.0, changed: true, to: 1.125 },
      { title: "should increase from L to XL", from: 1.125, changed: true, to: 1.25 },
      { title: "should increase from XL to XXL", from: 1.25, changed: true, to: 1.5 },
      { title: "should not increase beyond XXL", from: 1.5, changed: false, to: 1.5 },
      { title: "should handle custom scale values (0.9 jumps to M)", from: 0.9, changed: true, to: 1.0 },
    ])("$title", ({ from, changed, to }) => {
      setFontScale(from);
      const result = increaseFontScale();
      expect(result).toBe(changed);
      expect(getCurrentFontScale()).toBe(to);
    });
  });

  describe("decreaseFontScale", () => {
    it.each([
      { title: "should decrease from XXL to XL", from: 1.5, changed: true, to: 1.25 },
      { title: "should decrease from XL to L", from: 1.25, changed: true, to: 1.125 },
      { title: "should decrease from L to M", from: 1.125, changed: true, to: 1.0 },
      { title: "should decrease from M to S", from: 1.0, changed: true, to: 0.875 },
      { title: "should not decrease below S", from: 0.875, changed: false, to: 0.875 },
      { title: "should handle custom scale values (1.1 jumps to M)", from: 1.1, changed: true, to: 1.0 },
    ])("$title", ({ from, changed, to }) => {
      setFontScale(from);
      const result = decreaseFontScale();
      expect(result).toBe(changed);
      expect(getCurrentFontScale()).toBe(to);
    });
  });

  describe("FONT_SCALES constant", () => {
    it("should have all 5 scales defined", () => {
      expect(FONT_SCALES).toHaveLength(5);
    });

    it("should have correct scale values", () => {
      expect(FONT_SCALES[0]).toEqual({ label: "S", value: 0.875, px: 12 });
      expect(FONT_SCALES[1]).toEqual({ label: "M", value: 1.0, px: 14 });
      expect(FONT_SCALES[2]).toEqual({ label: "L", value: 1.125, px: 16 });
      expect(FONT_SCALES[3]).toEqual({ label: "XL", value: 1.25, px: 18 });
      expect(FONT_SCALES[4]).toEqual({ label: "XXL", value: 1.5, px: 20 });
    });

    it("should be in ascending order", () => {
      for (let i = 1; i < FONT_SCALES.length; i++) {
        expect(FONT_SCALES[i].value).toBeGreaterThan(
          FONT_SCALES[i - 1].value
        );
      }
    });
  });

  describe("Edge cases", () => {
    it("should handle rapid increase calls", () => {
      setFontScale(1.0); // M
      increaseFontScale(); // → L
      increaseFontScale(); // → XL
      increaseFontScale(); // → XXL
      increaseFontScale(); // → stays XXL
      expect(getCurrentFontScale()).toBe(1.5);
    });

    it("should handle rapid decrease calls", () => {
      setFontScale(1.0); // M
      decreaseFontScale(); // → S
      decreaseFontScale(); // → stays S
      expect(getCurrentFontScale()).toBe(0.875);
    });

    it("should handle alternating increase/decrease", () => {
      setFontScale(1.0); // M
      increaseFontScale(); // → L
      expect(getCurrentFontScale()).toBe(1.125);
      decreaseFontScale(); // → M
      expect(getCurrentFontScale()).toBe(1.0);
      increaseFontScale(); // → L
      expect(getCurrentFontScale()).toBe(1.125);
    });
  });
});
