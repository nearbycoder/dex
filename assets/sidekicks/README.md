# Sidekick looks

Pictures of sidekick faces (Open Bot Avatar, see `apps/web/src/shared/sidekick-look.ts`), drawn by the agent's own
renderer (`apps/web/src/agent/sidekick-face.ts`). Don't edit them: run `npm run sidekicks:assets -w @dex/web`, which
writes this folder and the iPhone and Android apps' copies of it, whenever the shapes, colors, or ready-made looks change.

- `presets.json` and `<key>.png`: the ready-made looks (key, name, accent color key, look) and their 256×256 pictures.
- `shapes.json` and `shapes/<shape>-body.png`, `shapes/<shape>-eyes.png`, `shapes/<shape>-fluffy-body.png`,
  `shapes/<shape>-fluffy-eyes.png`, `shapes/<shape>-glass-body.png`, `shapes/<shape>-glass-eyes.png`: each shape's flat
  body (in white) and eyes, fluffy coat (grayscale exposure + alpha, dyed with `shapes.json`'s Oklch dye ramps) and
  glossy eyes, and ray-marched glass body (`#ff8000` 3-point basis tinted per skin) and glossy eyes, at 256×256, for the
  apps to render any shape in any color and material and blink them (`eyes.top`..`eyes.bottom`). Saving a flat look lets
  the agent draw its picture; saving a fluffy or glass look sends its rendered picture so widgets, notifications, and
  older apps show it too.
