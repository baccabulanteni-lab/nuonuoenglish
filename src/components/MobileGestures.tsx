import React, { useEffect, useRef } from 'react';

interface MobileGesturesProps {
  onSwipeRight: () => void;
  enabled: boolean;
}

export const MobileGestures: React.FC<MobileGesturesProps> = ({ onSwipeRight, enabled }) => {
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Start gesture only from the left edge (e.g., first 30px)
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      if (x < 30) {
        touchStart.current = { x, y };
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStart.current) return;

      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const diffX = endX - touchStart.current.x;
      const diffY = endY - touchStart.current.y;

      // Ensure it's a horizontal swipe to the right
      // Threshold: 50px horizontal, less than 50px vertical deviation
      if (diffX > 50 && Math.abs(diffY) < 50) {
        onSwipeRight();
      }

      touchStart.current = null;
    };

    const handleTouchMove = (e: TouchEvent) => {
        // If we started an edge swipe, prevent default (like browser back) 
        // if we want to handle it ourselves, or let browser handle it.
        // For standalone PWA, browser back might not exist, so we handle it.
        if (touchStart.current) {
            const x = e.touches[0].clientX;
            const diffX = x - touchStart.current.x;
            if (diffX > 10) {
                // e.preventDefault(); // Might interfere with scrolling if not careful
            }
        }
    }

    window.addEventListener('touchstart', handleTouchStart);
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, [enabled, onSwipeRight]);

  return null;
};
