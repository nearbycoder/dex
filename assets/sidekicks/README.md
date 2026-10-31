# Sidekick looks

The ready-made sidekick looks as 256×256 PNGs, with `presets.json` (key, name, background color key, and the look's
parts). They're drawn from `apps/web/src/shared/sidekick-look.ts`; regenerate them when it changes. The iPhone and
Android apps bundle them: picking one saves its `look` and this PNG (as a data: URL) as the sidekick's `image`.
