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
        // Wisterion Enterprise Design System
        // Core Surfaces
        background: {
          DEFAULT: '#FFFFFF',
          tinted: '#EFEAE2',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          subtle: '#F7F7F8',
        },
        // Text
        text: {
          primary: '#1C1C1E',
          secondary: '#5A5A60',
          tertiary: '#7A7A82',
        },
        // Primary Accent (use sparingly)
        accent: {
          anchor: '#5F628F',
          DEFAULT: '#8285B6',
          tint: '#B2B4D6',
          wash: '#E6E7F2',
        },
        // Semantic Indicators (meaning only)
        indicator: {
          orange: '#B97A5D',
          yellow: '#C6B875',
          green: '#9DAA9B',
        },
        // Strokes & Dividers
        stroke: {
          subtle: '#E1E1E6',
          accent: '#8285B6',
        },
        divider: '#E6E6EA',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Urbanist', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'none': '0',
        'sm': '6px',
        'DEFAULT': '8px',
        'md': '8px',
        'lg': '10px',
        'xl': '12px',
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
  plugins: [],
};
