/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./app.js", "./main.js", "./preload.js"],
  theme: {
    extend: {
      colors: {
        surface: {
          950: "#07111b",
          900: "#09141f",
          800: "#0d1925",
          700: "#142737",
        },
        brand: {
          500: "#2474ff",
          400: "#3988ff",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: ["SFMono-Regular", "Consolas", "Liberation Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
