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
        // Nitrogen Enterprise Design System
        // Core Surfaces
        background: {
          DEFAULT: '#F5F5F7',
          tinted: '#E8E3DB',
        },
        surface: {
          DEFAULT: '#FAFAFA',
          subtle: '#EEEEEF',
          grey: '#EEEEEF',
          header: '#f6f6f6',
        },
        // Text
        text: {
          primary: '#1C1C1E',
          secondary: '#5A5A60',
          tertiary: '#7A7A82',
        },
        // Primary Accent (use sparingly)
        accent: {
          anchor: '#005bb5',
          DEFAULT: '#004d91',
          tint: '#4d9de8',
          wash: '#edf7ff',
        },
        // Secondary Accent
        'accent-secondary': {
          anchor: '#4a3812',
          DEFAULT: '#6e5a1a',
          tint: '#9a8a5a',
          wash: '#e8e4cf',
        },
        // Semantic Indicators (meaning only)
        indicator: {
          orange: '#B97A5D',
          yellow: '#C6B875',
          green: '#9DAA9B',
        },
        // Strokes & Dividers
        stroke: {
          subtle: '#D5D5DB',
          accent: '#004d91',
        },
        divider: '#DADADF',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Urbanist', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'none': '0',
        'sm': '4px',
        'DEFAULT': '4px',
        'md': '6px',
        'lg': '8px',
        'xl': '10px',
      },
      borderWidth: {
        'DEFAULT': '0.5px',
        '0': '0px',
        '0.5': '0.5px',
        '1': '1px',
        '2': '2px',
        '4': '4px',
      },
      boxShadow: {
        'subtle': '0 1px 2px rgba(0, 0, 0, 0.05)',
        'DEFAULT': '0 1px 3px rgba(0, 0, 0, 0.08)',
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
    },
  },
  plugins: [require('@tailwindcss/container-queries')],
};
