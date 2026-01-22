import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  getCurrentFontScale,
  setFontScale,
  increaseFontScale,
  decreaseFontScale,
  FONT_SCALES,
  DEFAULT_FONT_SCALE,
} from "@/lib/font-scale-utils";

describe("Font Scale Utils", () => {
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
    it("should increase from S to M", () => {
      setFontScale(0.875); // S
      const result = increaseFontScale();
      expect(result).toBe(true);
      expect(getCurrentFontScale()).toBe(1.0); // M
    });

    it("should increase from M to L", () => {
      setFontScale(1.0); // M
      const result = increaseFontScale();
      expect(result).toBe(true);
      expect(getCurrentFontScale()).toBe(1.125); // L
    });

    it("should increase from L to XL", () => {
      setFontScale(1.125); // L
      const result = increaseFontScale();
      expect(result).toBe(true);
      expect(getCurrentFontScale()).toBe(1.25); // XL
    });

    it("should increase from XL to XXL", () => {
      setFontScale(1.25); // XL
      const result = increaseFontScale();
      expect(result).toBe(true);
      expect(getCurrentFontScale()).toBe(1.5); // XXL
    });

    it("should not increase beyond XXL", () => {
      setFontScale(1.5); // XXL
      const result = increaseFontScale();
      expect(result).toBe(false);
      expect(getCurrentFontScale()).toBe(1.5); // Still XXL
    });

    it("should handle custom scale values", () => {
      setFontScale(0.9); // Between S and M
      const result = increaseFontScale();
      expect(result).toBe(true);
      expect(getCurrentFontScale()).toBe(1.0); // Jumps to M
    });
  });

  describe("decreaseFontScale", () => {
    it("should decrease from XXL to XL", () => {
      setFontScale(1.5); // XXL
      const result = decreaseFontScale();
      expect(result).toBe(true);
      expect(getCurrentFontScale()).toBe(1.25); // XL
    });

    it("should decrease from XL to L", () => {
      setFontScale(1.25); // XL
      const result = decreaseFontScale();
      expect(result).toBe(true);
      expect(getCurrentFontScale()).toBe(1.125); // L
    });

    it("should decrease from L to M", () => {
      setFontScale(1.125); // L
      const result = decreaseFontScale();
      expect(result).toBe(true);
      expect(getCurrentFontScale()).toBe(1.0); // M
    });

    it("should decrease from M to S", () => {
      setFontScale(1.0); // M
      const result = decreaseFontScale();
      expect(result).toBe(true);
      expect(getCurrentFontScale()).toBe(0.875); // S
    });

    it("should not decrease below S", () => {
      setFontScale(0.875); // S
      const result = decreaseFontScale();
      expect(result).toBe(false);
      expect(getCurrentFontScale()).toBe(0.875); // Still S
    });

    it("should handle custom scale values", () => {
      setFontScale(1.1); // Between M and L
      const result = decreaseFontScale();
      expect(result).toBe(true);
      expect(getCurrentFontScale()).toBe(1.0); // Jumps to M
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
