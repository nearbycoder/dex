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
