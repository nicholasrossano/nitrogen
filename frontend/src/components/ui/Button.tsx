import { forwardRef, ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, children, disabled, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center font-medium rounded-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:ring-offset-2';
    
    const variants = {
      primary: 'bg-accent text-white hover:bg-accent-anchor disabled:bg-stroke-subtle disabled:text-text-tertiary',
      secondary: 'bg-white text-text-primary border border-stroke-subtle hover:bg-surface-subtle disabled:bg-surface-subtle disabled:text-text-tertiary',
      ghost: 'text-text-secondary hover:bg-surface-subtle disabled:text-text-tertiary',
    };
    
    const sizes = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2 text-sm',
      lg: 'px-5 py-2.5 text-base',
    };

    return (
      <button
        ref={ref}
        className={clsx(
          baseStyles,
          variants[variant],
          sizes[size],
          disabled && 'cursor-not-allowed',
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
