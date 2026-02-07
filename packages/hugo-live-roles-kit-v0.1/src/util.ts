import YAML from "yaml"

export const normalize = (text: string | undefined | null) =>
  (text || "")
    .toString()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()

export const stripHtml = (html: string | undefined | null) =>
  (html || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()

export const unique = <T,>(list: T[]) => Array.from(new Set(list.filter(Boolean)))

export const toRegexes = (patterns: string[]) => patterns.map((p) => new RegExp(p, "i"))

export const matchAny = (text: string | undefined | null, regexes: RegExp[]) =>
  Boolean(text && regexes.some((r) => r.test(text)))

export const toSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")

export const parseEnvList = (raw: string | undefined) =>
  (raw || "")
    .split(/[\n,|]/)
    .map((v) => v.trim())
    .filter(Boolean)

export const includesAnyTerm = (text: string | undefined | null, terms: string[] | undefined) => {
  if (!terms || terms.length === 0) return false
  const base = normalize(text)
  if (!base) return false
  return terms.some((term) => {
    const needle = normalize(term)
    return needle.length > 0 && base.includes(needle)
  })
}

export const includesAllTerms = (text: string | undefined | null, terms: string[] | undefined) => {
  if (!terms || terms.length === 0) return true
  const base = normalize(text)
  if (!base) return false
  return terms.every((term) => {
    const needle = normalize(term)
    return needle.length > 0 && base.includes(needle)
  })
}

const extensionOf = (filePath: string) => filePath.toLowerCase().split(".").pop() || ""

export const readDataFile = <T,>(fs: typeof import("node:fs"), filePath: string, fallback: T): T => {
  try {
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, "utf8")
    const ext = extensionOf(filePath)
    if (ext === "yml" || ext === "yaml") return YAML.parse(raw) as T
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export const writeDataFile = (
  fs: typeof import("node:fs"),
  path: typeof import("node:path"),
  filePath: string,
  value: unknown
) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const ext = extensionOf(filePath)
  if (ext === "yml" || ext === "yaml") {
    fs.writeFileSync(filePath, YAML.stringify(value), "utf8")
    return
  }
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8")
}

export const decodeEntities = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

export const extractXmlTag = (xml: string, tag: string): string => {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")
  const m = xml.match(re)
  return m?.[1]?.trim() || ""
}
