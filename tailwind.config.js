/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#020617",
        card: "#0f172a",
        border: "#1e293b",
        text: "#e2e8f0",
        muted: "#94a3b8",
        dim: "#64748b",
        accent: {
          kpi: "#3b82f6",
          funnel: "#8b5cf6",
          fb: "#1877f2",
          pipeline: "#f97316",
          coaching: "#22c55e",
          spf: "#a855f7",
          nca: "#eab308",
          upcoming: "#06b6d4",
        },
        status: {
          nurturing: "#eab308",
          advancing: "#f97316",
          closing: "#ef4444",
          won: "#22c55e",
          lost: "#64748b",
          noshow: "#a855f7",
        },
      },
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
