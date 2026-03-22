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
        // Nitrogen Design System — soft cool-grey workbench palette
        // Shell & Surfaces
        shell: {
          DEFAULT: '#FCFBFB',
          bar: '#FEFEFD',
          subtle: '#F5F4F4',
        },
        background: {
          DEFAULT: '#FCFBFB',
          tinted: '#F5F4F4',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          subtle: '#F8F7F7',
          grey: '#F8F7F7',
          header: '#FEFEFD',
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
          anchor: '#2d3a4a',
          DEFAULT: '#3d5068',
          tint: '#7a90a8',
          wash: '#e4e8ed',
        },
        // Semantic Indicators (meaning only) — ~20% less saturated for consistency
        indicator: {
          orange: '#B97A5D',
          yellow: '#C6B875',
          green: '#6e7b6d',
          red: '#b03737',
        },
        // Green palette — ~20% less saturated than Tailwind default, shifted one step darker
        green: {
          50: '#e2f3e9',
          100: '#c4e8d2',
          200: '#94d4a8',
          300: '#5cb87a',
          400: '#3a9e52',
          500: '#2d8442',
          600: '#266b38',
          700: '#225432',
          800: '#1e472a',
          900: '#173d22',
        },
        // Red palette — ~20% less saturated than Tailwind default, shifted one step darker
        red: {
          50: '#fde8e8',
          100: '#fad4d4',
          200: '#f5b0b0',
          300: '#ec8484',
          400: '#e05858',
          500: '#c94a4a',
          600: '#b03737',
          700: '#8f3232',
          800: '#7a2a2a',
          900: '#641f1f',
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
          subtle: '#E3E2E0',
          accent: '#005e72',
        },
        divider: '#EDECEA',
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
