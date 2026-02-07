import { Effect } from "effect"
import { HttpRuntime, fetchJson, fetchText, sleep } from "./http.js"
import { RoleJob, RuntimeSources } from "./types.js"
import { decodeEntities, extractXmlTag, normalize, stripHtml, unique } from "./util.js"

export type PluginRuntime = HttpRuntime & {
  maxConcurrency: number
  requestDelayMs: number
  maxSerpapiQueriesPerRun: number
}

const safe = <A>(fx: Effect.Effect<A, unknown>) =>
  fx.pipe(Effect.catchAll(() => Effect.succeed([] as unknown as A)))

const env = (key: string) => (process.env[key] || "").trim()
const hasEnv = (key: string) => Boolean(env(key))

const dedupeJobs = (jobs: RoleJob[]) => {
  const seen = new Set<string>()
  const out: RoleJob[] = []
  for (const job of jobs) {
    const key = normalize(`${job.source}|${job.company}|${job.title}|${job.location}|${job.url}`)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(job)
  }
  return out
}

const parseJsonSafe = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const parseJsonLdJobs = (html: string, fallbackCompany: string, fallbackUrl: string): RoleJob[] => {
  const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || []
  const jobs: RoleJob[] = []
  for (const block of blocks) {
    const body = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim()
    const parsed = parseJsonSafe(body)
    const nodes = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue
      const type = String((node as any)["@type"] || "").toLowerCase()
      if (type !== "jobposting") continue
      const company =
        String((node as any)?.hiringOrganization?.name || "").trim() || fallbackCompany || "official-site"
      const title = String((node as any)?.title || "").trim()
      const locationNode = (node as any)?.jobLocation
      const locations = Array.isArray(locationNode) ? locationNode : locationNode ? [locationNode] : []
      const location = locations
        .map((l: any) => l?.address)
        .flat()
        .map((a: any) => [a?.addressLocality, a?.addressRegion, a?.addressCountry].filter(Boolean).join(", "))
        .filter(Boolean)
        .join(" | ")
      const url = String((node as any)?.url || fallbackUrl || "").trim()
      const updatedAt = String((node as any)?.datePosted || "").trim() || null
      const description = stripHtml(String((node as any)?.description || ""))
      if (!title || !url) continue
      jobs.push({
        source: "official-jsonld",
        source_note: `Source: ${fallbackUrl}`,
        company,
        title,
        location,
        url,
        updated_at: updatedAt,
        description
      })
    }
  }
  return jobs
}

const classifyBoard = (url: string) => {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase()
    } catch {
      return ""
    }
  })()
  if (!host) return "web"
  if (host.includes("linkedin.com")) return "linkedin"
  if (host.includes("indeed.")) return "indeed"
  if (host.includes("xing.com")) return "xing"
  if (host.includes("naukri.com")) return "naukri"
  if (host.includes("stepstone.")) return "stepstone"
  if (host.includes("smartrecruiters.com")) return "smartrecruiters"
  if (host.includes("greenhouse.io")) return "greenhouse"
  if (host.includes("lever.co")) return "lever"
  if (host.includes("teamtailor.com")) return "teamtailor"
  if (host.includes("recruitee.com")) return "recruitee"
  if (host.includes("ashbyhq.com")) return "ashby"
  return host
}

const withSource = (base: string, url: string) => `${base}:${classifyBoard(url)}`

const fetchGreenhouse = (company: string, runtime: PluginRuntime) =>
  safe(
    fetchJson<{ jobs: Array<Record<string, unknown>> }>(
      `https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=true`,
      runtime,
      { headers: { accept: "application/json" } }
    ).pipe(
      Effect.map((data) =>
        (data.jobs || []).map((j: any) => ({
          source: "greenhouse",
          company,
          title: j.title || "",
          location: j.location?.name || "",
          url: j.absolute_url || "",
          updated_at: j.updated_at || null,
          description: typeof j.content === "string" ? stripHtml(j.content) : ""
        }))
      )
    )
  )

const fetchLever = (company: string, runtime: PluginRuntime) =>
  safe(
    fetchJson<any[]>(`https://api.lever.co/v0/postings/${company}?mode=json`, runtime, {
      headers: { accept: "application/json" }
    }).pipe(
      Effect.map((data) =>
        (data || []).map((j) => ({
          source: "lever",
          company,
          title: j.text || "",
          location: j.categories?.location || "",
          url: j.hostedUrl || j.applyUrl || "",
          updated_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
          description: j.description ? stripHtml(j.description) : ""
        }))
      )
    )
  )

const fetchArbeitnow = (runtime: PluginRuntime) =>
  safe(
    fetchJson<any>("https://www.arbeitnow.com/api/job-board-api", runtime, {
      headers: { accept: "application/json" }
    }).pipe(
      Effect.map((data) =>
        (data.data || []).map((j: any) => ({
          source: "arbeitnow",
          company: j.company_name || "",
          title: j.title || "",
          location: j.location || "",
          url: j.url || "",
          updated_at: j.created_at || null,
          description: j.description ? stripHtml(j.description) : "",
          job_types: j.job_types || [],
          remote: j.remote || false
        }))
      )
    )
  )

const fetchRemotive = (runtime: PluginRuntime) =>
  safe(
    fetchJson<any>("https://remotive.com/api/remote-jobs", runtime, {
      headers: { accept: "application/json" }
    }).pipe(
      Effect.map((data) =>
        (data.jobs || []).map((j: any) => ({
          source: "remotive",
          company: j.company_name || "",
          title: j.title || "",
          location: j.candidate_required_location || "",
          url: j.url || "",
          updated_at: j.publication_date || null,
          description: j.description ? stripHtml(j.description) : "",
          job_types: j.job_type ? [String(j.job_type)] : [],
          remote: true
        }))
      )
    )
  )

const fetchJobicy = (runtime: PluginRuntime) =>
  safe(
    fetchJson<any>("https://jobicy.com/api/v2/remote-jobs", runtime, {
      headers: { accept: "application/json" }
    }).pipe(
      Effect.map((data) => {
        const jobs = Array.isArray(data?.jobs) ? data.jobs : Array.isArray(data) ? data : []
        return jobs.map((j: any) => ({
          source: "jobicy",
          company: j?.companyName || j?.company || "",
          title: j?.jobTitle || j?.title || "",
          location: j?.jobGeo || j?.location || "",
          url: j?.url || j?.jobUrl || "",
          updated_at: j?.pubDate || j?.publishedAt || null,
          description: stripHtml(j?.jobDescription || j?.description || ""),
          remote: true
        }))
      })
    )
  )

const fetchPersonioXml = (feedUrl: string, runtime: PluginRuntime) =>
  safe(
    fetchText(feedUrl, runtime, { headers: { accept: "application/xml,text/xml;q=0.9,*/*;q=0.8" } }).pipe(
      Effect.map((xml) => {
        const positions = xml.match(/<position\b[\s\S]*?<\/position>/gi) || []
        const host = (() => {
          try {
            return new URL(feedUrl).hostname
          } catch {
            return "personio"
          }
        })()
        return positions.map((p) => {
          const title = decodeEntities(extractXmlTag(p, "name") || extractXmlTag(p, "title"))
          const company = decodeEntities(extractXmlTag(p, "company") || host)
          const location = [extractXmlTag(p, "office"), extractXmlTag(p, "city"), extractXmlTag(p, "country")]
            .map(decodeEntities)
            .filter(Boolean)
            .join(", ")
          const url =
            decodeEntities(extractXmlTag(p, "url")) ||
            decodeEntities(extractXmlTag(p, "application-form-url"))
          const updated_at =
            extractXmlTag(p, "occupationDate") ||
            extractXmlTag(p, "createdAt") ||
            extractXmlTag(p, "updatedAt") ||
            null

          return {
            source: "personio-xml",
            source_note: `Source: ${host}`,
            company,
            title,
            location,
            url,
            updated_at,
            description: stripHtml(
              decodeEntities(extractXmlTag(p, "jobDescriptions") || extractXmlTag(p, "description"))
            )
          }
        })
      })
    )
  )

const fetchSmartRecruiters = (company: string, runtime: PluginRuntime) =>
  safe(
    fetchJson<any>(`https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=100`, runtime, {
      headers: { accept: "application/json" }
    }).pipe(
      Effect.map((data) =>
        (data.content || []).map((j: any) => ({
          source: "smartrecruiters",
          company: j?.company?.name || company,
          title: j?.name || "",
          location: j?.location?.fullLocation || [j?.location?.city, j?.location?.country].filter(Boolean).join(", "),
          url: j?.ref || `https://jobs.smartrecruiters.com/${company}/${j?.id || ""}`,
          updated_at: j?.releasedDate || j?.postingDate || null,
          description: stripHtml(j?.jobAd?.sections?.jobDescription?.text || "")
        }))
      )
    )
  )

const fetchTeamtailor = (company: string, runtime: PluginRuntime) =>
  safe(
    fetchJson<any>(`https://${company}.teamtailor.com/jobs.json`, runtime, {
      headers: { accept: "application/json" }
    }).pipe(
      Effect.map((data) => {
        const jobs = Array.isArray(data) ? data : Array.isArray(data?.jobs) ? data.jobs : []
        return jobs.map((j: any) => ({
          source: "teamtailor",
          company: j?.company_name || company,
          title: j?.title || "",
          location: j?.location || j?.city || "",
          url: j?.url || `https://${company}.teamtailor.com/jobs/${j?.id || ""}`,
          updated_at: j?.updated_at || j?.created_at || null,
          description: stripHtml(j?.body || j?.description || "")
        }))
      })
    )
  )

const fetchRecruitee = (company: string, runtime: PluginRuntime) =>
  safe(
    fetchJson<any>(`https://${company}.recruitee.com/api/offers/`, runtime, {
      headers: { accept: "application/json" }
    }).pipe(
      Effect.map((data) =>
        (data.offers || []).map((j: any) => ({
          source: "recruitee",
          company: j?.company_name || company,
          title: j?.title || "",
          location: [j?.location, j?.city, j?.country].filter(Boolean).join(", "),
          url: j?.careers_url || j?.careersApplyUrl || j?.url || "",
          updated_at: j?.updated_at || j?.created_at || null,
          description: stripHtml(j?.description || "")
        }))
      )
    )
  )

const fetchAshby = (organization: string, runtime: PluginRuntime) =>
  safe(
    fetchJson<any>(`https://api.ashbyhq.com/posting-api/job-board/${organization}`, runtime, {
      headers: { accept: "application/json" }
    }).pipe(
      Effect.map((data) => {
        const jobs = Array.isArray(data) ? data : Array.isArray(data?.jobs) ? data.jobs : []
        return jobs.map((j: any) => ({
          source: "ashby",
          company: j?.organizationName || organization,
          title: j?.title || "",
          location: j?.location || j?.locationName || "",
          url: j?.applyUrl || j?.url || "",
          updated_at: j?.updatedAt || j?.publishedAt || null,
          description: stripHtml(j?.description || "")
        }))
      })
    )
  )

const fetchStepstoneFeed = (feedUrl: string, runtime: PluginRuntime) =>
  safe(
    fetchText(feedUrl, runtime, {
      headers: { accept: "application/xml,text/xml;q=0.9,application/rss+xml;q=0.9,*/*;q=0.8" }
    }).pipe(
      Effect.map((xml) => {
        const host = (() => {
          try {
            return new URL(feedUrl).hostname
          } catch {
            return "stepstone"
          }
        })()
        const source = `stepstone-feed:${host}`
        const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || []
        return items.map((item) => ({
          source,
          company: decodeEntities(extractXmlTag(item, "company") || extractXmlTag(item, "author") || "stepstone"),
          title: decodeEntities(extractXmlTag(item, "title")),
          location: decodeEntities(extractXmlTag(item, "location") || extractXmlTag(item, "city")),
          url: decodeEntities(extractXmlTag(item, "link")),
          updated_at: extractXmlTag(item, "pubDate") || null,
          description: stripHtml(decodeEntities(extractXmlTag(item, "description")))
        }))
      })
    )
  )

const fetchAdzuna = (queries: string[], countriesInput: string[], runtime: PluginRuntime) => {
  const appId = env("ADZUNA_APP_ID")
  const appKey = env("ADZUNA_APP_KEY")
  if (!appId || !appKey) return Effect.succeed([] as RoleJob[])
  const countries = unique(countriesInput.length > 0 ? countriesInput : ["de", "fr", "nl", "at", "be", "in"])
  const activeQueries = queries.length > 0 ? queries : ["software engineer germany"]
  const tasks = countries.flatMap((country) =>
    activeQueries.slice(0, 4).map((q) =>
      fetchJson<any>(
        `https://api.adzuna.com/v1/api/jobs/${country}/search/1?app_id=${encodeURIComponent(
          appId
        )}&app_key=${encodeURIComponent(appKey)}&results_per_page=50&what=${encodeURIComponent(q)}`,
        runtime,
        { headers: { accept: "application/json" } }
      ).pipe(
        Effect.map((data) =>
          (data.results || []).map((j: any) => ({
            source: "adzuna",
            company: j?.company?.display_name || "",
            title: j?.title || "",
            location: j?.location?.display_name || "",
            url: j?.redirect_url || "",
            updated_at: j?.created || null,
            description: stripHtml(j?.description || "")
          }))
        ),
        Effect.catchAll(() => Effect.succeed([] as RoleJob[]))
      )
    )
  )
  return Effect.forEach(tasks, (fx) => fx, { concurrency: Math.max(1, Math.floor(runtime.maxConcurrency / 2)) }).pipe(
    Effect.map((batches) => batches.flat())
  )
}

const fetchJooble = (queries: string[], countriesInput: string[], runtime: PluginRuntime) => {
  const apiKey = env("JOOBLE_API_KEY")
  if (!apiKey) return Effect.succeed([] as RoleJob[])
  const countries = unique(countriesInput.length > 0 ? countriesInput : ["de", "fr", "nl", "at", "be", "in"])
  const activeQueries = queries.length > 0 ? queries : ["software engineer"]
  const tasks = countries.flatMap((country) =>
    activeQueries.slice(0, 4).map((q) =>
      Effect.tryPromise({
        try: async () => {
          const res = await fetch(`https://${country}.jooble.org/api/${apiKey}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ keywords: q, location: country.toUpperCase() })
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json()
          return (data?.jobs || []).map((j: any) => ({
            source: "jooble",
            company: j?.company || "",
            title: j?.title || "",
            location: j?.location || country.toUpperCase(),
            url: j?.link || "",
            updated_at: j?.updated || null,
            description: stripHtml(j?.snippet || "")
          })) as RoleJob[]
        },
        catch: () => []
      })
    )
  )
  return Effect.forEach(tasks, (fx) => fx, { concurrency: Math.max(1, Math.floor(runtime.maxConcurrency / 2)) }).pipe(
    Effect.map((batches) => batches.flat())
  )
}

const fetchSerpApiGoogleJobs = (
  queries: string[],
  serpapiGl: string,
  serpapiHl: string,
  runtime: PluginRuntime
) => {
  const apiKey = env("SERPAPI_API_KEY")
  if (!apiKey) return Effect.succeed([] as RoleJob[])
  const gl = (serpapiGl || "de").toLowerCase()
  const hl = (serpapiHl || "en").toLowerCase()
  const activeQueries = queries.length > 0 ? queries : ["software engineer germany"]
  const tasks = activeQueries.slice(0, runtime.maxSerpapiQueriesPerRun).map((q) =>
    fetchJson<any>(
      `https://serpapi.com/search.json?engine=google_jobs&api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(
        q
      )}&gl=${encodeURIComponent(gl)}&hl=${encodeURIComponent(hl)}`,
      runtime,
      { headers: { accept: "application/json" } }
    ).pipe(
      Effect.map((data) =>
        (data.jobs_results || []).map((j: any) => {
          const apply = Array.isArray(j?.apply_options) ? j.apply_options[0] : null
          const applyUrl = apply?.link || j?.related_links?.[0]?.link || ""
          return {
            source: withSource("serpapi-google-jobs", applyUrl || ""),
            source_note: `Query: ${q}`,
            company: j?.company_name || "",
            title: j?.title || "",
            location: j?.location || "",
            url: applyUrl || "",
            updated_at: j?.detected_extensions?.posted_at || null,
            description: stripHtml(j?.description || "")
          } as RoleJob
        })
      ),
      Effect.catchAll(() => Effect.succeed([] as RoleJob[]))
    )
  )
  return Effect.forEach(tasks, (fx) => fx, { concurrency: Math.max(1, Math.floor(runtime.maxConcurrency / 2)) }).pipe(
    Effect.map((batches) => batches.flat())
  )
}

const fetchSerpApiOrganic = (
  queries: string[],
  serpapiGl: string,
  serpapiHl: string,
  runtime: PluginRuntime,
  sourceLabel: string,
  linkFilter: (url: string) => boolean
) => {
  const apiKey = env("SERPAPI_API_KEY")
  if (!apiKey) return Effect.succeed([] as RoleJob[])
  const gl = (serpapiGl || "de").toLowerCase()
  const hl = (serpapiHl || "en").toLowerCase()
  const tasks = queries.slice(0, runtime.maxSerpapiQueriesPerRun).map((q) =>
    fetchJson<any>(
      `https://serpapi.com/search.json?engine=google&api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(
        q
      )}&gl=${encodeURIComponent(gl)}&hl=${encodeURIComponent(hl)}&num=20`,
      runtime,
      { headers: { accept: "application/json" } }
    ).pipe(
      Effect.map((data) =>
        (data.organic_results || [])
          .filter((r: any) => linkFilter(String(r?.link || "")))
          .map((r: any) => ({
            source: withSource(sourceLabel, String(r?.link || "")),
            source_note: `Query: ${q}`,
            company: "",
            title: String(r?.title || ""),
            location: "",
            url: String(r?.link || ""),
            updated_at: null,
            description: stripHtml(String(r?.snippet || ""))
          }))
      ),
      Effect.catchAll(() => Effect.succeed([] as RoleJob[]))
    )
  )
  return Effect.forEach(tasks, (fx) => fx, { concurrency: Math.max(1, Math.floor(runtime.maxConcurrency / 2)) }).pipe(
    Effect.map((batches) => batches.flat())
  )
}

const fetchOfficialCareerPages = (pages: string[], runtime: PluginRuntime) =>
  Effect.forEach(
    pages,
    (url) =>
      fetchText(url, runtime, { headers: { accept: "text/html,application/xhtml+xml" } }).pipe(
        Effect.map((html) => parseJsonLdJobs(html, "", url)),
        Effect.catchAll(() => Effect.succeed([] as RoleJob[]))
      ),
    { concurrency: Math.max(1, Math.floor(runtime.maxConcurrency / 2)) }
  ).pipe(Effect.map((batches) => batches.flat()))

export const fetchAllSources = (runtimeSources: RuntimeSources, runtime: PluginRuntime) =>
  Effect.gen(function* () {
    const hasSerpApi = hasEnv("SERPAPI_API_KEY")
    const hasAdzuna = hasEnv("ADZUNA_APP_ID") && hasEnv("ADZUNA_APP_KEY")
    const hasJooble = hasEnv("JOOBLE_API_KEY")
    const baseQueries = runtimeSources.search_queries.map(normalize).filter(Boolean)
    const boardQueries = baseQueries.map(
      (q) => `${q} site:linkedin.com/jobs OR site:indeed.com OR site:xing.com OR site:naukri.com OR site:stepstone.`
    )
    const officialQueries = baseQueries.map((q) => `${q} careers jobs official site`)

    const batches = yield* Effect.all(
      {
        greenhouse: Effect.forEach(runtimeSources.greenhouse_companies, (c) => fetchGreenhouse(c, runtime), {
          concurrency: runtime.maxConcurrency
        }),
        lever: Effect.forEach(runtimeSources.lever_companies, (c) => fetchLever(c, runtime), {
          concurrency: runtime.maxConcurrency
        }),
        personio: Effect.forEach(runtimeSources.personio_xml_feeds, (f) => fetchPersonioXml(f, runtime), {
          concurrency: Math.max(1, Math.floor(runtime.maxConcurrency / 2))
        }),
        smartrecruiters: Effect.forEach(
          runtimeSources.smartrecruiters_companies,
          (c) => fetchSmartRecruiters(c, runtime),
          { concurrency: runtime.maxConcurrency }
        ),
        teamtailor: Effect.forEach(runtimeSources.teamtailor_companies, (c) => fetchTeamtailor(c, runtime), {
          concurrency: runtime.maxConcurrency
        }),
        recruitee: Effect.forEach(runtimeSources.recruitee_companies, (c) => fetchRecruitee(c, runtime), {
          concurrency: runtime.maxConcurrency
        }),
        ashby: Effect.forEach(runtimeSources.ashby_organizations, (o) => fetchAshby(o, runtime), {
          concurrency: runtime.maxConcurrency
        }),
        stepstone: Effect.forEach(runtimeSources.stepstone_feeds, (f) => fetchStepstoneFeed(f, runtime), {
          concurrency: Math.max(1, Math.floor(runtime.maxConcurrency / 2))
        }),
        arbeitnow: runtimeSources.arbeitnow_enabled ? fetchArbeitnow(runtime) : Effect.succeed([] as RoleJob[]),
        remotive: runtimeSources.remotive_enabled ? fetchRemotive(runtime) : Effect.succeed([] as RoleJob[]),
        jobicy: runtimeSources.jobicy_enabled ? fetchJobicy(runtime) : Effect.succeed([] as RoleJob[]),
        adzuna:
          runtimeSources.adzuna_enabled && hasAdzuna
            ? fetchAdzuna(baseQueries, runtimeSources.adzuna_countries, runtime)
            : Effect.succeed([] as RoleJob[]),
        jooble:
          runtimeSources.jooble_enabled && hasJooble
            ? fetchJooble(baseQueries, runtimeSources.jooble_countries, runtime)
            : Effect.succeed([] as RoleJob[]),
        serpapiGoogleJobs: runtimeSources.serpapi_google_jobs_enabled && hasSerpApi
          ? fetchSerpApiGoogleJobs(baseQueries, runtimeSources.serpapi_gl, runtimeSources.serpapi_hl, runtime)
          : Effect.succeed([] as RoleJob[]),
        serpapiBoards: runtimeSources.serpapi_job_board_search_enabled && hasSerpApi
          ? fetchSerpApiOrganic(
              boardQueries,
              runtimeSources.serpapi_gl,
              runtimeSources.serpapi_hl,
              runtime,
              "serpapi-job-boards",
              (url) => /linkedin\.com|indeed\.|xing\.com|naukri\.com|stepstone\./i.test(url)
            )
          : Effect.succeed([] as RoleJob[]),
        serpapiOfficial: runtimeSources.serpapi_official_sites_search_enabled && hasSerpApi
          ? fetchSerpApiOrganic(
              officialQueries,
              runtimeSources.serpapi_gl,
              runtimeSources.serpapi_hl,
              runtime,
              "serpapi-official-sites",
              (url) => /\/careers|\/jobs|job-?board|workdayjobs|greenhouse|lever|smartrecruiters|teamtailor|recruitee|ashby/i.test(
                url
              )
            )
          : Effect.succeed([] as RoleJob[]),
        officialPages:
          runtimeSources.serpapi_official_sites_search_enabled &&
          hasSerpApi &&
          runtimeSources.official_career_pages.length > 0
            ? fetchOfficialCareerPages(runtimeSources.official_career_pages, runtime)
            : Effect.succeed([] as RoleJob[])
      },
      { concurrency: 4 }
    )

    const jobs = [
      ...batches.greenhouse.flat(),
      ...batches.lever.flat(),
      ...batches.personio.flat(),
      ...batches.smartrecruiters.flat(),
      ...batches.teamtailor.flat(),
      ...batches.recruitee.flat(),
      ...batches.ashby.flat(),
      ...batches.stepstone.flat(),
      ...batches.arbeitnow,
      ...batches.remotive,
      ...batches.jobicy,
      ...batches.adzuna,
      ...batches.jooble,
      ...batches.serpapiGoogleJobs,
      ...batches.serpapiBoards,
      ...batches.serpapiOfficial,
      ...batches.officialPages
    ] as RoleJob[]

    yield* sleep(runtime.requestDelayMs)
    return dedupeJobs(jobs.filter((j) => j.title && j.url))
  })
