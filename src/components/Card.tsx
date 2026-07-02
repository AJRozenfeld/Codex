import Link from "next/link";
import type { ReactNode } from "react";

export function EntityCard({
  href,
  eyebrow,
  title,
  subtitle,
  description,
  imageUrl,
}: {
  href: string;
  eyebrow?: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  imageUrl?: string | null;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-lg border border-gold/15 bg-void/60 p-5 transition-colors hover:border-gold/50 hover:bg-void animate-fade-in"
    >
      <div className="flex items-start gap-4">
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={title}
            className="h-14 w-14 rounded-full object-cover border border-gold/20 flex-shrink-0"
          />
        )}
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-xs uppercase tracking-widest text-ember/80 mb-1">{eyebrow}</div>
          )}
          <h3 className="font-display text-lg text-parchment group-hover:text-gold transition-colors">
            {title}
          </h3>
          {subtitle && <div className="text-sm text-parchment/50 mt-0.5">{subtitle}</div>}
        </div>
      </div>
      {description && (
        <p className="text-sm text-parchment/70 mt-3 line-clamp-3">{description}</p>
      )}
    </Link>
  );
}

export function SectionHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8">
      {eyebrow && <div className="text-xs uppercase tracking-[0.2em] text-ember mb-2">{eyebrow}</div>}
      <h1 className="font-display text-3xl sm:text-4xl text-gold">{title}</h1>
      <div className="divider-rule mt-4" />
      {children}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gold/20 p-10 text-center text-parchment/50">
      {message}
    </div>
  );
}
