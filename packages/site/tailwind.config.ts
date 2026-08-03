import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101110",
        gate: {
          brake: "#c62a20",
          redteam: "#5b3fd6",
          thrift: "#8a5a00",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
