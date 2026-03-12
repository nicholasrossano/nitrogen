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
        // Nitrogen Design System — warm workbench palette
        // Shell & Surfaces
        shell: {
          DEFAULT: '#FAF8F5',
          bar: '#FDFCFA',
          subtle: '#F0EDE8',
        },
        background: {
          DEFAULT: '#FAF8F5',
          tinted: '#F0EDE8',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          subtle: '#F7F5F2',
          grey: '#F7F5F2',
          header: '#FDFCFA',
        },
        // Text
        text: {
          primary: '#1C1C1E',
          secondary: '#5A5A60',
          tertiary: '#8A8A90',
        },
        // Primary Accent (use sparingly — interactive elements only)
        accent: {
          anchor: '#00758c',
          DEFAULT: '#005e72',
          tint: '#40bcd4',
          wash: '#e6f9fc',
        },
        // Secondary Accent
        'accent-secondary': {
          anchor: '#4a3812',
          DEFAULT: '#6e5a1a',
          tint: '#9a8a5a',
          wash: '#e8e4cf',
        },
        // Semantic Indicators (meaning only) — ~20% less saturated for consistency
        indicator: {
          orange: '#B97A5D',
          yellow: '#C6B875',
          green: '#8a9a88',
          red: '#c94a4a',
        },
        // Green palette — ~20% less saturated than Tailwind default
        green: {
          50: '#f2faf5',
          100: '#e2f3e9',
          200: '#c4e8d2',
          300: '#94d4a8',
          400: '#5cb87a',
          500: '#3a9e52',
          600: '#2d8442',
          700: '#266b38',
          800: '#225432',
          900: '#1e472a',
        },
        // Red palette — ~20% less saturated than Tailwind default
        red: {
          50: '#fef5f5',
          100: '#fde8e8',
          200: '#fad4d4',
          300: '#f5b0b0',
          400: '#ec8484',
          500: '#e05858',
          600: '#c94a4a',
          700: '#b03737',
          800: '#8f3232',
          900: '#7a2a2a',
        },
        // Emerald palette — ~20% less saturated (charts, carbon outputs)
        emerald: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#1a9e6a',
          600: '#0d7d5a',
          700: '#0c6649',
          800: '#065f46',
          900: '#064e3b',
        },
        // Strokes & Dividers
        stroke: {
          subtle: '#DDD9D3',
          accent: '#005e72',
        },
        divider: '#E0DCD6',
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
        'subtle': '0 1px 2px rgba(0, 0, 0, 0.04)',
        'DEFAULT': '0 1px 3px rgba(0, 0, 0, 0.06)',
        'workspace': '0 1px 4px rgba(0, 0, 0, 0.07), 0 0 0 1px rgba(0, 0, 0, 0.03)',
        'card': '0 1px 2px rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.03)',
        'card-hover': '0 8px 24px -6px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.04)',
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
