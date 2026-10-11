import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0a0f14",
        surface: "#11181f",
        border: "#1f2a33",
        accent: "#22d3ee",
        muted: "#8b98a5",
      },
    },
  },
  plugins: [],
};

export default config;
