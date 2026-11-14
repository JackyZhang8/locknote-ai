/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // Preserve the existing application's browser defaults and visual appearance.
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
}
