/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./apps/**/*.{html,js,ts,tsx}", "./packages/**/*.{js,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: { DEFAULT: "hsl(var(--primary) / <alpha-value>)", foreground: "hsl(var(--primary-foreground) / <alpha-value>)" },
        secondary: { DEFAULT: "hsl(var(--secondary) / <alpha-value>)", foreground: "hsl(var(--secondary-foreground) / <alpha-value>)" },
        destructive: { DEFAULT: "hsl(var(--destructive) / <alpha-value>)", foreground: "hsl(var(--destructive-foreground) / <alpha-value>)" },
        muted: { DEFAULT: "hsl(var(--muted) / <alpha-value>)", foreground: "hsl(var(--muted-foreground) / <alpha-value>)" },
        accent: { DEFAULT: "hsl(var(--accent) / <alpha-value>)", foreground: "hsl(var(--accent-foreground) / <alpha-value>)" },
        card: { DEFAULT: "hsl(var(--card) / <alpha-value>)", foreground: "hsl(var(--card-foreground) / <alpha-value>)" },
        popover: { DEFAULT: "hsl(var(--popover) / <alpha-value>)", foreground: "hsl(var(--popover-foreground) / <alpha-value>)" },
        success: "hsl(var(--success) / <alpha-value>)",
        warning: "hsl(var(--warning) / <alpha-value>)",
        buy: "hsl(var(--buy) / <alpha-value>)",
        sell: "hsl(var(--sell) / <alpha-value>)"
      },
      fontFamily: { sans: ["var(--font-sans)"], mono: ["var(--font-mono)"] },
      fontSize: {
        caption: ["var(--font-size-caption)", "var(--line-height-normal)"],
        "body-sm": ["var(--font-size-body-sm)", "var(--line-height-normal)"],
        body: ["var(--font-size-body)", "var(--line-height-normal)"],
        title: ["var(--font-size-title)", "var(--line-height-tight)"],
        heading: ["var(--font-size-heading)", "var(--line-height-tight)"],
        display: ["var(--font-size-display)", "var(--line-height-tight)"]
      },
      spacing: { 0: "var(--space-0)", 1: "var(--space-4)", 2: "var(--space-8)", 3: "var(--space-12)", 4: "var(--space-16)", 6: "var(--space-24)", 8: "var(--space-32)", 12: "var(--space-48)", 16: "var(--space-64)", 20: "var(--space-80)", 24: "var(--space-96)" },
      borderRadius: { sm: "var(--radius-sm)", md: "var(--radius-md)", lg: "var(--radius-lg)", xl: "var(--radius-xl)", full: "var(--radius-full)" },
      boxShadow: { xs: "var(--shadow-xs)", sm: "var(--shadow-sm)", md: "var(--shadow-md)", lg: "var(--shadow-lg)", focus: "var(--shadow-focus)" },
      zIndex: { base: "var(--z-base)", raised: "var(--z-raised)", dropdown: "var(--z-dropdown)", sticky: "var(--z-sticky)", modal: "var(--z-modal)", toast: "var(--z-toast)" },
      opacity: { disabled: "var(--opacity-disabled)", subtle: "var(--opacity-subtle)", overlay: "var(--opacity-overlay)" },
      transitionDuration: { fast: "var(--motion-fast)", normal: "var(--motion-normal)", slow: "var(--motion-slow)" },
      transitionTimingFunction: { standard: "var(--ease-standard)", emphasized: "var(--ease-emphasized)" }
    },
    screens: { sm: "40rem", md: "48rem", lg: "64rem", xl: "80rem" }
  },
  plugins: []
};
