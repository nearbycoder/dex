import { FileArchive, FileMusic, FileText, FileVideo, type LucideProps } from "lucide-react"

const ARCHIVE = /(zip|x-tar|gzip|x-7z|x-rar|x-bzip|x-xz)/

/** An attached file's icon, by its type (or name): audio, video, an archive, or a document. */
export function FileIcon({ mimeType, name, ...props }: { mimeType: string; name?: string } & LucideProps) {
  const type = mimeType.toLowerCase()
  if (type.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|flac|aac|opus)$/i.test(name ?? "")) return <FileMusic {...props} />
  if (type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(name ?? "")) return <FileVideo {...props} />
  if (ARCHIVE.test(type) || /\.(zip|tar|tgz|gz|7z|rar|bz2|xz)$/i.test(name ?? "")) return <FileArchive {...props} />
  return <FileText {...props} />
}
