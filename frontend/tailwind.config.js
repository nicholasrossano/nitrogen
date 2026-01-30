/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Nitrogen Design System
        background: {
          DEFAULT: '#FEFCF5',
          dark: '#1C1C1E',
        },
        cream: '#FFFEF9',
        beige: {
          DEFAULT: '#DAD7C5',
          dark: '#E4DEC7',
        },
        blush: '#ECE4DB',
        brown: '#301900',
        // Primary - Periwinkle accent
        primary: {
          DEFAULT: '#7677B8',
          50: '#F5F5FB',
          100: '#EBEBF7',
          200: '#D4D4EE',
          300: '#B5B6D9',
          400: '#9596C8',
          500: '#7677B8',
          600: '#7677B8',
          700: '#5C5D9A',
          800: '#47487A',
          900: '#35365C',
        },
        // Secondary accents
        accent: {
          DEFAULT: '#8285B6',
          secondary: '#301900',
          tertiary: '#ECE4DB',
        },
        merlot: '#711248',
        rust: '#BD6217',
        forest: '#127112',
        teal: '#0E7171',
      },
      fontFamily: {
        sans: ['Avenir', 'Nunito Sans', 'system-ui', 'sans-serif'],
        display: ['Didot', 'Georgia', 'serif'],
      },
      borderRadius: {
        'card': '12px',
        'pill': '18px',
        'input': '10px',
        'capsule': '50px',
        'widget': '12px',
      },
      boxShadow: {
        'subtle': '0 1px 3px rgba(48, 25, 0, 0.1)',
        'lifted': '0 4px 6px rgba(48, 25, 0, 0.15)',
        'heavy': '0 4px 10px rgba(48, 25, 0, 0.25)',
        'glow': '0 0 20px rgba(218, 215, 197, 0.5)',
      },
      animation: {
        'slide-in': 'slideIn 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        slideIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
