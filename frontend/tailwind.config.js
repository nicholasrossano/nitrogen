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
          header: '#FEFCF5',
        },
        // Text
        text: {
          primary: '#1C1C1E',
          secondary: '#5A5A60',
          tertiary: '#7A7A82',
        },
        // Primary Accent (use sparingly)
        accent: {
          anchor: '#1A0F00',
          DEFAULT: '#301900',
          tint: '#7A5839',
          wash: '#EBE3DA',
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
          accent: '#301900',
        },
        divider: '#DADADF',
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
