import { type SidekickLook, sidekickSvg } from "~/shared/sidekick-look"

const urls = new Map<string, string>()

/** A look as an SVG data: URL, for <img> (each picture stays self-contained, so many on a page never clash). */
export const lookUrl = (look: SidekickLook, background: string) => {
  const key = `${JSON.stringify(look)}${background}`
  let url = urls.get(key)
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sidekickSvg(look, background))}`
    urls.set(key, url)
  }
  return url
}

/** The PNG snapshot saved with a look, for the iPhone and Android apps, which show pictures rather than draw looks. */
export async function lookPng(look: SidekickLook, background: string, size = 256): Promise<string> {
  const image = new Image()
  image.src = lookUrl(look, background)
  await image.decode()
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = size
  canvas.getContext("2d")!.drawImage(image, 0, 0, size, size)
  return canvas.toDataURL("image/png")
}

/** A picture as a small square data: URL (center-cropped), under the 48 KB a sidekick's picture may be. */
export async function shrinkPicture(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  for (const [size, quality] of [[256, 0.85], [192, 0.8], [160, 0.7], [128, 0.6]] as const) {
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = size
    canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size)
    const url = canvas.toDataURL("image/webp", quality)
    const data = url.startsWith("data:image/webp") ? url : canvas.toDataURL("image/jpeg", quality)
    if (data.length < 63_000) return data
  }
  throw new Error("That picture is too detailed to keep small. Try another.")
}

/** A data: URL's bytes (decoded here: the Content Security Policy doesn't let fetch() read data: URLs). */
export function dataUrlBlob(dataUrl: string): Blob {
  const [head, data = ""] = dataUrl.split(",", 2)
  const type = /^data:([^;,]+)/.exec(head ?? "")?.[1] ?? "application/octet-stream"
  return new Blob([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], { type })
}
