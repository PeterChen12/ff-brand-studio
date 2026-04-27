"use client";

import { useCallback, useState } from "react";

interface ZoomTileProps {
  src: string;
  alt: string;
  className?: string;
  zoom?: number;
  onClick?: () => void;
}

export function ZoomTile({
  src,
  alt,
  className,
  zoom = 250,
  onClick,
}: ZoomTileProps) {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ x: 50, y: 50 });

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPos({ x, y });
  }, []);

  const isTouch =
    typeof window !== "undefined" &&
    window.matchMedia("(hover: none)").matches;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => !isTouch && setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseMove={!isTouch ? onMouseMove : undefined}
      className={[
        "relative w-full h-full block cursor-zoom-in overflow-hidden",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className ?? "",
      ].join(" ")}
      aria-label={`Zoom into ${alt}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={[
          "w-full h-full object-cover transition-transform duration-700",
          "ease-m3-emphasized",
          hover ? "scale-[1.02]" : "",
        ].join(" ")}
        loading="lazy"
      />
      {hover && !isTouch && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `url(${src})`,
            backgroundPosition: `${pos.x}% ${pos.y}%`,
            backgroundSize: `${zoom}%`,
            backgroundRepeat: "no-repeat",
          }}
        />
      )}
    </button>
  );
}
