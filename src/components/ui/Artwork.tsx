"use client";

import { memo } from "react";
import Image from "next/image";

const TONES = [
  "from-violet-600/70 via-indigo-600/60 to-blue-500/50",
  "from-cyan-600/70 via-teal-600/60 to-emerald-500/50",
  "from-fuchsia-600/70 via-pink-600/60 to-rose-500/50",
  "from-blue-600/70 via-sky-600/60 to-cyan-500/50",
];

function toneFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return TONES[Math.abs(h) % TONES.length];
}

/**
 * Album artwork with a deterministic gradient + initial-letter fallback so a
 * missing or blocked CDN image still looks intentional.
 */
export const Artwork = memo(function Artwork({
  url,
  seed,
  alt,
  className = "",
}: {
  url: string | null;
  seed: string;
  alt: string;
  className?: string;
}) {
  const fallback = (
    <div
      className={`flex items-center justify-center bg-gradient-to-br ${toneFor(seed)} ${className}`}
      aria-hidden="true"
    >
      <span className="select-none text-2xl font-bold text-white/70 drop-shadow">
        {seed.trim().charAt(0).toUpperCase() || "?"}
      </span>
    </div>
  );
  if (!url) return fallback;
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <Image
        src={url}
        alt={alt}
        fill
        sizes="112px"
        className="object-cover"
        unoptimized
        onError={(event) => {
          const img = event.currentTarget;
          img.style.display = "none";
        }}
      />
      <div className="absolute inset-0 -z-10">{fallback}</div>
    </div>
  );
});
