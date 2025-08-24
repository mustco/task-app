import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Poppins", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        status: {
          pending: "hsl(var(--status-pending))",
          progress: "hsl(var(--status-progress))",
          completed: "hsl(var(--status-completed))",
          overdue: "hsl(var(--status-overdue))",
        },
        glow: {
          start: "hsl(var(--glow-start))",
          end: "hsl(var(--glow-end))",
        },
      },
      borderRadius: {
        "2xl": "calc(var(--radius) + 4px)", // 20px
        xl: "var(--radius)", // 16px
        lg: "calc(var(--radius) - 4px)", // 12px
        md: "calc(var(--radius) - 8px)", // 8px
        sm: "calc(var(--radius) - 10px)", // 6px
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "soft-glow": {
          "0%": {
            boxShadow:
              "0 0 5px hsl(var(--glow-start) / 0.5), 0 0 10px hsl(var(--glow-end) / 0.5)",
          },
          "50%": {
            boxShadow:
              "0 0 20px hsl(var(--glow-start) / 0.7), 0 0 30px hsl(var(--glow-end) / 0.7)",
          },
          "100%": {
            boxShadow:
              "0 0 5px hsl(var(--glow-start) / 0.5), 0 0 10px hsl(var(--glow-end) / 0.5)",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "soft-glow": "soft-glow 4s ease-in-out infinite",
      },
      textShadow: {
        sm: "0 1px 2px var(--tw-shadow-color)",
        DEFAULT: "0 2px 4px var(--tw-shadow-color)",
        lg: "0 8px 16px var(--tw-shadow-color)",
        glow: "0 0 8px var(--tw-shadow-color), 0 0 12px var(--tw-shadow-color)",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    plugin(function ({ matchUtilities, theme }) {
      matchUtilities(
        {
          "text-shadow": (value) => ({
            textShadow: value,
          }),
        },
        { values: theme("textShadow") }
      );
    }),
  ],
};

export default config;