# Sidekick looks

Pictures of sidekick faces (Open Bot Avatar, see `apps/web/src/shared/sidekick-look.ts`), drawn by the agent's own
renderer (`apps/web/src/agent/sidekick-face.ts`). Don't edit them: run `npm run sidekicks:assets -w @dex/web`, which
writes this folder and the iPhone and Android apps' copies of it, whenever the shapes, colors, or ready-made looks change.

- `presets.json` and `<key>.png`: the ready-made looks (key, name, accent color key, look) and their 256×256 pictures.
- `shapes.json` and `shapes/<shape>-body.png`, `shapes/<shape>-eyes.png`: each shape's body in white and its eyes, at
  256×256, for the apps' editors: they tint the body any of the colors in `shapes.json` and lay the eyes over it (closing
  them between `eyes.top` and `eyes.bottom` to blink). Saving sends the look; the agent draws its picture.
