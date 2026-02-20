import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontSize: {
        /* Scale text-ui-* with the central --ui-font-scale variable so components using
           these semantic tokens react to fontScale changes without changing markup. */
        "ui-xs": ["calc(12px * var(--ui-font-scale))", { lineHeight: "calc(16px * var(--ui-font-scale))" }],
        "ui-sm": ["calc(14px * var(--ui-font-scale))", { lineHeight: "calc(20px * var(--ui-font-scale))" }],
        "ui-md": ["calc(16px * var(--ui-font-scale))", { lineHeight: "calc(24px * var(--ui-font-scale))" }],
        "ui-lg": ["calc(18px * var(--ui-font-scale))", { lineHeight: "calc(26px * var(--ui-font-scale))" }],
        "ui-xl": ["calc(20px * var(--ui-font-scale))", { lineHeight: "calc(28px * var(--ui-font-scale))" }],
        "ui-2xl": ["calc(24px * var(--ui-font-scale))", { lineHeight: "calc(32px * var(--ui-font-scale))" }],
        "ui-3xl": ["calc(30px * var(--ui-font-scale))", { lineHeight: "calc(36px * var(--ui-font-scale))" }],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        colors: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",

        /* Semantic design tokens (mapped to CSS variables) */
        "brand-primary": "var(--color-brand-primary)",
        "ui-background": "var(--color-ui-background)",
        "ui-foreground": "var(--color-ui-foreground)",
        "ui-panel": "var(--color-ui-panel)",
        "ui-border": "var(--color-ui-border)",
        "status-success": "var(--color-status-success)",
        "status-error": "var(--color-status-error)",
        "status-warning": "var(--color-status-warning)",
        "accent-cyan": "var(--color-accent-cyan)",
        "accent-blue": "var(--color-accent-blue)",

        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },

        /* Serial plotter colors */
        plot: {
          "1": "var(--plot-1)",
          "2": "var(--plot-2)",
          "3": "var(--plot-3)",
          "4": "var(--plot-4)",
          "5": "var(--plot-5)",
          "6": "var(--plot-6)",
          "7": "var(--plot-7)",
          "8": "var(--plot-8)",
        },

        "status-success-dark": "var(--color-status-success-dark)",

        /* Preset palette tokens (available as Tailwind colors) */
        "brand-variant-1": "var(--color-brand-variant-1)",
        "brand-variant-2": "var(--color-brand-variant-2)",
        "brand-blue": "var(--color-brand-blue)",
        "brand-teal": "var(--color-brand-teal)",
        "green-dark": "var(--color-green-dark)",
        "success-variant": "var(--color-success-variant)",
        "danger-soft": "var(--color-danger-soft)",
        "accent-orange-soft": "var(--color-accent-orange-soft)",
        "accent-yellow-soft": "var(--color-accent-yellow-soft)",
        "accent-amber": "var(--color-accent-amber)",
        "purple-1": "var(--color-purple-1)",
        "purple-2": "var(--color-purple-2)",
        "surface-dark": "var(--color-surface-dark)",
        sidebar: {
          DEFAULT: "var(--sidebar)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
