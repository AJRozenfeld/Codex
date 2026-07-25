import React from "react";
import { motion } from "framer-motion";

export function SectionHeading({ eyebrow, title }: { eyebrow?: string | null; title: string }) {
  return (
    <div className="mb-6">
      {eyebrow && (
        <div className="text-ember/80 uppercase text-xs tracking-wider2 mb-1">{eyebrow}</div>
      )}
      <h1 className="font-display text-3xl text-gold">{title}</h1>
      <div className="ornate-divider mt-3">
        <span className="glyph" />
      </div>
    </div>
  );
}

export function NewBadge() {
  return (
    <span className="glint inline-flex items-center rounded-full border border-gold/60 bg-gold/10 px-2 py-0.5 text-[10px] uppercase tracking-wider2 text-gold">
      New
    </span>
  );
}

export function MetaItem({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-ember/80 uppercase text-xs tracking-wider2">{label}</dt>
      <dd className="text-parchment mt-1 text-sm">{value}</dd>
    </div>
  );
}

export function Prose({ text }: { text?: string | null }) {
  if (!text) return null;
  return <div className="prose-erendyl text-[15px]">{text}</div>;
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="card-surface rounded-lg border border-gold/10 px-6 py-10 text-center text-parchment/50 text-sm">
      {message}
    </div>
  );
}

const cardVariants = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: Math.min(i * 0.045, 0.6), duration: 0.35, ease: "easeOut" as const },
  }),
};

export function EntityCard({
  index,
  title,
  subtitle,
  excerpt,
  imageUrl,
  isNew,
  onClick,
}: {
  index: number;
  title: string;
  subtitle?: string | null;
  excerpt?: string | null;
  imageUrl?: string | null;
  isNew?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="show"
      whileHover={{ y: -3, transition: { duration: 0.15 } }}
      onClick={onClick}
      className="card-surface group relative w-full rounded-lg border border-gold/15 p-4 text-left shadow-card hover:shadow-card-hover hover:border-gold/40 transition-colors"
    >
      <div className="flex gap-4 items-start">
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            className="w-14 h-14 rounded-full object-cover border border-gold/30 flex-none"
            draggable={false}
          />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg text-gold group-hover:text-parchment transition-colors truncate">
              {title}
            </h3>
            {isNew && <NewBadge />}
          </div>
          {subtitle && (
            <div className="text-[11px] uppercase tracking-wider2 text-ember/80 mt-0.5 truncate">{subtitle}</div>
          )}
          {excerpt && <p className="text-sm text-parchment/60 mt-2 line-clamp-2">{excerpt}</p>}
        </div>
      </div>
    </motion.button>
  );
}

export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-sm text-parchment/50 hover:text-gold transition-colors">
      &larr; {label}
    </button>
  );
}

export function truncate(text: string | null | undefined, n = 160): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n - 1) + "…" : clean;
}
