import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface WheelPickerProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}

export function WheelPicker({ options, value, onChange }: WheelPickerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemHeight = 40;

  useEffect(() => {
    const index = options.indexOf(value);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = index * itemHeight;
    }
  }, [value, options]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    const index = Math.round(scrollTop / itemHeight);
    if (options[index] && options[index] !== value) {
      onChange(options[index]);
    }
  };

  return (
    <div className="relative h-[120px] w-full overflow-hidden wheel-picker-container">
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-scroll snap-y snap-mandatory hide-scrollbar py-[40px]"
      >
        {options.map((opt) => (
          <div 
            key={opt} 
            className={cn(
              "h-[40px] flex items-center justify-center snap-center transition-opacity duration-200",
              opt === value ? "opacity-100 font-medium text-lg" : "opacity-30"
            )}
          >
            {opt}
          </div>
        ))}
      </div>
      <div className="absolute top-1/2 left-0 right-0 h-[40px] -translate-y-1/2 border-y border-ink/10 pointer-events-none" />
    </div>
  );
}

export function Button({ 
  children, 
  className, 
  variant = 'primary',
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const variants = {
    primary: "bg-ink text-parchment hover:bg-ink/90",
    secondary: "bg-accent-orange/20 text-ink border border-accent-orange/30",
    ghost: "bg-transparent text-ink/60 hover:text-ink"
  };

  return (
    <button 
      className={cn(
        "px-6 py-3 rounded-full font-medium transition-all active:scale-95 disabled:opacity-50",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-white rounded-3xl shadow-sm border border-black/5 p-6", className)}>
      {children}
    </div>
  );
}
