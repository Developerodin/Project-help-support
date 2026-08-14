/**
 * Tailwind v4 runs as a PostCSS plugin. Preflight is deliberately not imported
 * in app/globals.css — design-system.css already owns the global reset, and a
 * second one would restyle every existing page. See the compat layer there.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
