import { Effect, Schedule } from "effect"

export type HttpRuntime = {
  requestTimeoutMs: number
  requestDelayMs: number
}

export const sleep = (ms: number) =>
  Effect.promise(() => new Promise((resolve) => setTimeout(resolve, ms)))

export const fetchJson = <T,>(url: string, runtime: HttpRuntime, options?: RequestInit) =>
  Effect.tryPromise({
    try: async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), runtime.requestTimeoutMs)
      try {
        const res = await fetch(url, { ...options, signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
        return (await res.json()) as T
      } finally {
        clearTimeout(timeout)
      }
    },
    catch: (e) => e
  }).pipe(Effect.retry(Schedule.recurs(2)))

export const fetchText = (url: string, runtime: HttpRuntime, options?: RequestInit) =>
  Effect.tryPromise({
    try: async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), runtime.requestTimeoutMs)
      try {
        const res = await fetch(url, { ...options, signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
        return await res.text()
      } finally {
        clearTimeout(timeout)
      }
    },
    catch: (e) => e
  }).pipe(Effect.retry(Schedule.recurs(2)))
