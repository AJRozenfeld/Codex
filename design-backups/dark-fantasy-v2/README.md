# Design backup: "Dark Fantasy v2" (frozen 2026-07-21)

The complete visual identity as it stood before the WorldAnvil-inspired
redesign: Cinzel + Lora, gold-glow dark fantasy, violet-dark surfaces.

## To revert the redesign entirely

The whole design lives in three files. Restore them from this folder:

    cp design-backups/dark-fantasy-v2/globals.css      src/app/globals.css
    cp design-backups/dark-fantasy-v2/tailwind.config.ts tailwind.config.ts
    cp design-backups/dark-fantasy-v2/layout.tsx       src/app/layout.tsx

then commit and push. The git tag `design-dark-fantasy-v2` also marks the
last commit before the redesign, if a full-tree comparison is ever needed.
