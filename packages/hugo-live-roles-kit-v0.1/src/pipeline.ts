import fs from "node:fs"
import path from "node:path"
import { Effect, Logger } from "effect"
import {
  defaultRuntimeProvidersPath,
  loadConfig,
  loadProfile,
  loadRegistry,
  loadRuntimeProviders,
  resolveRuntimeSources
} from "./config.js"
import { fetchJson, fetchText } from "./http.js"
import { fetchAllSources } from "./plugins.js"
import {
  BucketRule,
  DatedRoleJob,
  FrameworkConfig,
  RoleJob,
  RoleProfile,
  RolesOutputV1,
  SourceRegistry
} from "./types.js"
import {
  includesAllTerms,
  includesAnyTerm,
  matchAny,
  normalize,
  readDataFile,
  toRegexes,
  toSlug,
  unique,
  writeDataFile
} from "./util.js"

const addSimpleLogger = Logger.replace(
  Logger.defaultLogger,
  Logger.make(({ message }) => console.log(String(message)))
)

const matchesRegexOrTerms = (
  text: string | undefined | null,
  regexes: RegExp[],
  terms: string[] | undefined
) => matchAny(text, regexes) || includesAnyTerm(text, terms)

const anyFilterDefined = (regexes: RegExp[], terms: string[] | undefined) =>
  regexes.length > 0 || (terms?.length || 0) > 0

const scoreJob = (job: RoleJob, profile: RoleProfile) => {
  const title = job.title || ""
  const location = job.location || ""
  const company = job.company || ""
  const description = job.description || ""
  const text = normalize(`${title} ${location} ${company} ${description}`)

  const geoAllow = toRegexes(profile.geo_allow_patterns)
  const geoPriority = toRegexes(profile.geo_priority_patterns || [])
  const employerAllow = toRegexes(profile.employer_allowlist || [])
  const locationTerms = profile.locations?.countries || []
  const cityTerms = profile.locations?.cities || []
  const priorityLocationTerms = [
    ...(profile.locations?.priority_countries || []),
    ...(profile.locations?.priority_cities || [])
  ]
  const niceToHave = profile.keywords?.nice_to_have || []

  let score = 0
  let skillHits = 0

  if (matchesRegexOrTerms(location || description, geoAllow, [...locationTerms, ...cityTerms])) score += 30
  if (
    anyFilterDefined(geoPriority, priorityLocationTerms) &&
    matchesRegexOrTerms(location || description, geoPriority, priorityLocationTerms)
  ) {
    score += 40
  }
  if (employerAllow.length > 0 && matchAny(company || description, employerAllow)) score += 20

  for (const skill of profile.skills) {
    if (text.includes(skill.toLowerCase())) {
      score += 4
      skillHits += 1
    }
  }
  for (const kw of niceToHave) {
    if (text.includes(kw.toLowerCase())) score += 2
  }

  return { score, skillHits }
}

const filterBucket = (jobs: RoleJob[], profile: RoleProfile, bucket: BucketRule): RoleJob[] => {
  const includeTitle = toRegexes(bucket.include_title_patterns || [])
  const includeTitleKeywords = bucket.include_title_keywords || []
  const includeText = toRegexes(bucket.include_text_patterns || [])
  const includeTextKeywords = bucket.include_text_keywords || []
  const excludeText = toRegexes(bucket.exclude_text_patterns || [])
  const excludeTextKeywords = bucket.exclude_text_keywords || []
  const geoAllow = toRegexes(profile.geo_allow_patterns)
  const geoExclude = toRegexes(profile.geo_exclude_patterns || [])
  const employerAllow = toRegexes(profile.employer_allowlist || [])
  const mustHaveKeywords = profile.keywords?.must_have || []
  const excludeKeywords = profile.keywords?.exclude || []
  const allowLocationTerms = [...(profile.locations?.countries || []), ...(profile.locations?.cities || [])]
  const excludeLocationTerms = [
    ...(profile.locations?.exclude_countries || []),
    ...(profile.locations?.exclude_cities || [])
  ]
  const hasTitleGate = anyFilterDefined(includeTitle, includeTitleKeywords)
  const hasTextGate = anyFilterDefined(includeText, includeTextKeywords)
  const hasGeoAllowGate = anyFilterDefined(geoAllow, allowLocationTerms)
  const hasGeoExcludeGate = anyFilterDefined(geoExclude, excludeLocationTerms)

  const filtered = jobs
    .filter((j) => Boolean(j.title && j.url))
    .filter((j) =>
      hasTitleGate ? matchesRegexOrTerms(j.title, includeTitle, includeTitleKeywords) : true
    )
    .filter((j) =>
      hasTextGate
        ? matchesRegexOrTerms(`${j.title} ${j.description || ""}`, includeText, includeTextKeywords)
        : true
    )
    .filter((j) =>
      hasGeoAllowGate
        ? matchesRegexOrTerms(j.location || j.description || "", geoAllow, allowLocationTerms)
        : true
    )
    .filter((j) =>
      hasGeoExcludeGate
        ? !matchesRegexOrTerms(j.location || j.description || "", geoExclude, excludeLocationTerms)
        : true
    )
    .filter((j) => !matchesRegexOrTerms(`${j.title} ${j.description || ""}`, excludeText, excludeTextKeywords))
    .filter((j) => includesAllTerms(`${j.title} ${j.company} ${j.description || ""}`, mustHaveKeywords))
    .filter((j) => !includesAnyTerm(`${j.title} ${j.company} ${j.description || ""}`, excludeKeywords))
    .map((j) => {
      const base = scoreJob(j, profile)
      return {
        ...j,
        score: base.score,
        skill_hits: base.skillHits,
        bucket_id: bucket.id
      }
    })
    .filter((j) => (j.score || 0) >= (bucket.min_score ?? 70))
    .filter((j) => (j.skill_hits || 0) >= (bucket.min_skill_hits ?? 0))
    .filter((j) =>
      bucket.require_employer_allowlist ? matchAny(j.company || j.description || "", employerAllow) : true
    )
    .sort((a, b) => (b.score || 0) - (a.score || 0))

  const deduped: RoleJob[] = []
  const seen = new Set<string>()
  for (const job of filtered) {
    const key = normalize(`${job.company}|${job.title}|${job.location}|${job.url}`)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(job)
  }

  return deduped.slice(0, bucket.max_results ?? 200)
}

const toDated = (job: RoleJob, fetchedAt: string): DatedRoleJob => ({
  source: job.source,
  source_note: job.source_note || "",
  company: job.company || "",
  title: job.title || "",
  location: job.location || "",
  url: job.url || "",
  updated_at: job.updated_at || null,
  description: job.description,
  job_types: job.job_types,
  remote: job.remote,
  score: job.score || 0,
  skill_hits: job.skill_hits || 0,
  bucket_id: job.bucket_id,
  fetched_at: fetchedAt,
  pulled_at: fetchedAt,
  stale_days: 0,
  is_stale: false
})

const dedupeDated = (jobs: DatedRoleJob[]) => {
  const seen = new Set<string>()
  return jobs.filter((job) => {
    const key = normalize(`${job.company}|${job.title}|${job.location}|${job.url}|${job.fetched_at}`)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const sortDated = (jobs: DatedRoleJob[]) =>
  [...jobs].sort((a, b) => {
    const ta = Date.parse(a.fetched_at || "")
    const tb = Date.parse(b.fetched_at || "")
    if (!Number.isNaN(tb) && !Number.isNaN(ta) && tb !== ta) return tb - ta
    return (b.score || 0) - (a.score || 0)
  })

const applyStale = (jobs: DatedRoleJob[], nowIso: string, staleAfterDays: number) => {
  const now = Date.parse(nowIso)
  const dayMs = 24 * 60 * 60 * 1000
  return jobs.map((j) => {
    const ts = Date.parse(j.fetched_at || "")
    const staleDays = Number.isNaN(ts) ? staleAfterDays + 1 : Math.floor((now - ts) / dayMs)
    return {
      ...j,
      stale_days: Math.max(0, staleDays),
      is_stale: staleDays >= staleAfterDays
    }
  })
}

const splitInactive = (jobs: DatedRoleJob[], inactiveAfterDays: number) => {
  const active: DatedRoleJob[] = []
  const inactive: DatedRoleJob[] = []
  for (const j of jobs) {
    if ((j.stale_days || 0) >= inactiveAfterDays) inactive.push(j)
    else active.push(j)
  }
  return { active, inactive }
}

const readExistingOutput = (outputPath: string): RolesOutputV1 | null =>
  readDataFile<RolesOutputV1 | null>(fs, outputPath, null)

const buildRoleTerms = (profile: RoleProfile) =>
  unique(
    profile.buckets.flatMap((b) => [...(b.include_title_keywords || []), ...(b.include_text_keywords || [])])
  ).slice(0, 18)

const buildSearchQueries = (profile: RoleProfile, companies: string[], maxQueries: number) => {
  const countries = unique(profile.locations?.countries || ["Germany", "India"])
  const cities = unique(profile.locations?.priority_cities || profile.locations?.cities || [])
  const roleTerms = buildRoleTerms(profile)
  const companyTerms = unique(companies).slice(0, 24)
  const baseQueries = roleTerms.flatMap((role) =>
    countries.map((country) => `${role} ${country} jobs`).concat(cities.map((city) => `${role} ${city} jobs`))
  )
  const companyQueries = companyTerms.flatMap((company) =>
    roleTerms.slice(0, 10).map((role) => `${company} ${role} jobs`)
  )
  return unique([...baseQueries, ...companyQueries]).slice(0, Math.max(1, maxQueries))
}

const buildOfficialCareerPages = (companies: string[], maxPages: number) =>
  unique(
    companies.flatMap((company) => {
      const slug = toSlug(company)
      if (!slug) return []
      return [
        `https://${slug}.com/careers`,
        `https://careers.${slug}.com`,
        `https://jobs.${slug}.com`,
        `https://${slug}.io/careers`,
        `https://careers.${slug}.io`
      ]
    })
  ).slice(0, Math.max(1, maxPages))

const isEnvEnabled = (key: string) => Boolean((process.env[key] || "").trim())

const discoverSources = (
  config: FrameworkConfig,
  registry: SourceRegistry,
  observedCompanies: string[],
  generatedQueries: string[],
  generatedCareerPages: string[]
) =>
  Effect.gen(function* () {
    if (!config.discovery.enabled || !registry.meta.discovery_enabled) {
      return {
        company_names: [] as string[],
        smartrecruiters_companies: [] as string[],
        teamtailor_companies: [] as string[],
        recruitee_companies: [] as string[],
        ashby_organizations: [] as string[],
        personio_xml_feeds: [] as string[],
        official_career_pages: [] as string[],
        search_queries: [] as string[]
      }
    }

    const known = new Set(
      unique([
        ...registry.explicit.company_names,
        ...registry.discovered.company_names,
        ...registry.explicit.smartrecruiters_companies,
        ...registry.discovered.smartrecruiters_companies,
        ...registry.explicit.teamtailor_companies,
        ...registry.discovered.teamtailor_companies,
        ...registry.explicit.recruitee_companies,
        ...registry.discovered.recruitee_companies,
        ...registry.explicit.ashby_organizations,
        ...registry.discovered.ashby_organizations
      ]).map(toSlug)
    )

    const candidates = unique(observedCompanies.map(toSlug).filter(Boolean).filter((s) => !known.has(s))).slice(
      0,
      Math.max(1, Math.min(registry.meta.max_probe_candidates, config.knobs.max_probe_candidates))
    )

    const probe = (slug: string) =>
      Effect.all(
        {
          smart: fetchJson<any>(
            `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`,
            {
              requestTimeoutMs: config.knobs.request_timeout_ms,
              requestDelayMs: config.knobs.request_delay_ms
            },
            { headers: { accept: "application/json" } }
          ).pipe(
            Effect.map((d) => Array.isArray(d?.content) && d.content.length > 0),
            Effect.catchAll(() => Effect.succeed(false))
          ),
          team: fetchJson<any>(`https://${slug}.teamtailor.com/jobs.json`, {
            requestTimeoutMs: config.knobs.request_timeout_ms,
            requestDelayMs: config.knobs.request_delay_ms
          }).pipe(
            Effect.map((d) => (Array.isArray(d) && d.length > 0) || (Array.isArray(d?.jobs) && d.jobs.length > 0)),
            Effect.catchAll(() => Effect.succeed(false))
          ),
          rec: fetchJson<any>(`https://${slug}.recruitee.com/api/offers/`, {
            requestTimeoutMs: config.knobs.request_timeout_ms,
            requestDelayMs: config.knobs.request_delay_ms
          }).pipe(
            Effect.map((d) => Array.isArray(d?.offers) && d.offers.length > 0),
            Effect.catchAll(() => Effect.succeed(false))
          ),
          ash: fetchJson<any>(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, {
            requestTimeoutMs: config.knobs.request_timeout_ms,
            requestDelayMs: config.knobs.request_delay_ms
          }).pipe(
            Effect.map((d) => (Array.isArray(d) && d.length > 0) || (Array.isArray(d?.jobs) && d.jobs.length > 0)),
            Effect.catchAll(() => Effect.succeed(false))
          ),
          pde: fetchText(`https://${slug}.jobs.personio.de/xml`, {
            requestTimeoutMs: config.knobs.request_timeout_ms,
            requestDelayMs: config.knobs.request_delay_ms
          }).pipe(
            Effect.map((t) => /<position\b/i.test(t)),
            Effect.catchAll(() => Effect.succeed(false))
          ),
          pcom: fetchText(`https://${slug}.jobs.personio.com/xml`, {
            requestTimeoutMs: config.knobs.request_timeout_ms,
            requestDelayMs: config.knobs.request_delay_ms
          }).pipe(
            Effect.map((t) => /<position\b/i.test(t)),
            Effect.catchAll(() => Effect.succeed(false))
          )
        },
        { concurrency: 6 }
      ).pipe(Effect.map((r) => ({ slug, ...r })))

    const results = yield* Effect.forEach(candidates, probe, {
      concurrency: Math.max(1, Math.floor(config.knobs.max_concurrency / 2))
    }).pipe(Effect.catchAll(() => Effect.succeed([] as Array<any>)))

    return {
      company_names: results.filter((r) => r.smart || r.team || r.rec || r.ash || r.pde || r.pcom).map((r) => r.slug),
      smartrecruiters_companies: results.filter((r) => r.smart).map((r) => r.slug),
      teamtailor_companies: results.filter((r) => r.team).map((r) => r.slug),
      recruitee_companies: results.filter((r) => r.rec).map((r) => r.slug),
      ashby_organizations: results.filter((r) => r.ash).map((r) => r.slug),
      personio_xml_feeds: results
        .flatMap((r) => [
          r.pde ? `https://${r.slug}.jobs.personio.de/xml` : "",
          r.pcom ? `https://${r.slug}.jobs.personio.com/xml` : ""
        ])
        .filter(Boolean),
      official_career_pages: generatedCareerPages,
      search_queries: generatedQueries
    }
  })

const addDiscovered = (existing: string[], incoming: string[], maxAdds: number): string[] => {
  const set = new Set(existing)
  let adds = 0
  for (const item of incoming) {
    if (adds >= maxAdds) break
    if (!set.has(item)) {
      set.add(item)
      adds += 1
    }
  }
  return Array.from(set)
}

export const runPipeline = (
  configPath: string,
  profilesDir: string,
  logger = true
): Promise<{ outputPath: string; registryPath: string }> => {
  const program = Effect.gen(function* () {
    const start = Date.now()

    const config = loadConfig(configPath)
    const profile = loadProfile(profilesDir, config.profile_id)
    const registry = loadRegistry(config.paths.source_registry_file!)
    const runtimeProviders = loadRuntimeProviders(defaultRuntimeProvidersPath)
    const runtimeSources = resolveRuntimeSources(config, registry, runtimeProviders)
    const hasSerpApi = isEnvEnabled("SERPAPI_API_KEY")
    const useSerpApiQueries =
      hasSerpApi &&
      (runtimeSources.serpapi_google_jobs_enabled ||
        runtimeSources.serpapi_job_board_search_enabled ||
        runtimeSources.serpapi_official_sites_search_enabled)
    const useOfficialPageDiscovery = hasSerpApi && runtimeSources.serpapi_official_sites_search_enabled
    const seedCompanies = unique([
      ...registry.explicit.company_names,
      ...registry.discovered.company_names,
      ...runtimeSources.greenhouse_companies,
      ...runtimeSources.lever_companies,
      ...runtimeSources.smartrecruiters_companies,
      ...runtimeSources.teamtailor_companies,
      ...runtimeSources.recruitee_companies,
      ...runtimeSources.ashby_organizations
    ])
    const generatedQueries = useSerpApiQueries
      ? buildSearchQueries(profile, seedCompanies, config.knobs.max_serpapi_queries_per_run)
      : []
    const generatedCareerPages = useOfficialPageDiscovery
      ? buildOfficialCareerPages(seedCompanies, config.knobs.max_probe_candidates)
      : []
    const runtimeSourcesWithQueries = {
      ...runtimeSources,
      search_queries: unique([...runtimeSources.search_queries, ...generatedQueries]).slice(
        0,
        config.knobs.max_serpapi_queries_per_run
      ),
      official_career_pages: unique([...runtimeSources.official_career_pages, ...generatedCareerPages]).slice(
        0,
        config.knobs.max_probe_candidates
      )
    }

    if (logger) {
      yield* Effect.log(
        `profile=${profile.id} sources: greenhouse=${runtimeSources.greenhouse_companies.length} lever=${runtimeSources.lever_companies.length} personio=${runtimeSources.personio_xml_feeds.length} smartrecruiters=${runtimeSources.smartrecruiters_companies.length} teamtailor=${runtimeSources.teamtailor_companies.length} recruitee=${runtimeSources.recruitee_companies.length} ashby=${runtimeSources.ashby_organizations.length} stepstone=${runtimeSources.stepstone_feeds.length} queries=${runtimeSourcesWithQueries.search_queries.length} officialPages=${runtimeSourcesWithQueries.official_career_pages.length} serpapiKey=${hasSerpApi ? "yes" : "no"}`
      )
    }

    const fetchedStart = Date.now()
    const jobs = yield* fetchAllSources(runtimeSourcesWithQueries, {
      requestTimeoutMs: config.knobs.request_timeout_ms,
      requestDelayMs: config.knobs.request_delay_ms,
      maxConcurrency: config.knobs.max_concurrency,
      maxSerpapiQueriesPerRun: config.knobs.max_serpapi_queries_per_run
    }).pipe(Effect.timeout(config.knobs.max_runtime_ms), Effect.catchAll(() => Effect.succeed([] as RoleJob[])))
    const fetchMs = Date.now() - fetchedStart

    const now = new Date().toISOString()
    const bucketsOut: Record<string, DatedRoleJob[]> = {}
    const archiveOut: Record<string, DatedRoleJob[]> = {}

    const existing = readExistingOutput(config.paths.output_file!)
    const activeBucketSet =
      profile.active_bucket_ids && profile.active_bucket_ids.length > 0
        ? new Set(profile.active_bucket_ids)
        : null

    for (const bucket of profile.buckets) {
      if (activeBucketSet && !activeBucketSet.has(bucket.id)) continue
      const filtered = filterBucket(jobs, profile, bucket)
      const newDated = filtered.map((j) => toDated(j, now))
      const prior = existing?.buckets?.[bucket.id] || []
      const merged = sortDated(dedupeDated([...prior, ...newDated]))
      const stale = applyStale(merged, now, config.knobs.stale_after_days)
      const split = splitInactive(stale, config.knobs.inactive_after_days)
      bucketsOut[bucket.id] = split.active
      archiveOut[bucket.id] = config.knobs.inactive_action === "archive" ? split.inactive : []
    }

    const observedCompanies = unique(jobs.map((j) => j.company).filter(Boolean))
    const discovered = yield* discoverSources(
      config,
      registry,
      observedCompanies,
      runtimeSourcesWithQueries.search_queries,
      runtimeSourcesWithQueries.official_career_pages
    )

    const updatedRegistry: SourceRegistry = {
      ...registry,
      generated_at: now,
      discovered: {
        company_names: addDiscovered(
          registry.discovered.company_names,
          discovered.company_names,
          config.knobs.max_discovery_adds_per_source
        ),
        personio_xml_feeds: addDiscovered(
          registry.discovered.personio_xml_feeds,
          discovered.personio_xml_feeds,
          config.knobs.max_discovery_adds_per_source
        ),
        smartrecruiters_companies: addDiscovered(
          registry.discovered.smartrecruiters_companies,
          discovered.smartrecruiters_companies,
          config.knobs.max_discovery_adds_per_source
        ),
        teamtailor_companies: addDiscovered(
          registry.discovered.teamtailor_companies,
          discovered.teamtailor_companies,
          config.knobs.max_discovery_adds_per_source
        ),
        recruitee_companies: addDiscovered(
          registry.discovered.recruitee_companies,
          discovered.recruitee_companies,
          config.knobs.max_discovery_adds_per_source
        ),
        ashby_organizations: addDiscovered(
          registry.discovered.ashby_organizations,
          discovered.ashby_organizations,
          config.knobs.max_discovery_adds_per_source
        ),
        stepstone_feeds: registry.discovered.stepstone_feeds,
        official_career_pages: addDiscovered(
          registry.discovered.official_career_pages,
          discovered.official_career_pages || [],
          config.knobs.max_discovery_adds_per_source
        ),
        search_queries: addDiscovered(
          registry.discovered.search_queries,
          discovered.search_queries || [],
          config.knobs.max_discovery_adds_per_source
        )
      },
      meta: {
        discovery_enabled: config.discovery.enabled && registry.meta.discovery_enabled,
        max_probe_candidates: Math.max(
          1,
          Math.min(registry.meta.max_probe_candidates, config.knobs.max_probe_candidates)
        )
      }
    }

    const staleCounts: Record<string, number> = {}
    const inactiveCounts: Record<string, number> = {}
    for (const bucketId of Object.keys(bucketsOut)) {
      staleCounts[bucketId] = (bucketsOut[bucketId] || []).filter((j) => j.is_stale).length
      inactiveCounts[bucketId] = (archiveOut[bucketId] || []).length
    }

    const output: RolesOutputV1 = {
      schema_version: "roles.v1",
      profile_id: profile.id,
      profile_name: profile.display_name,
      generated_at: now,
      buckets: bucketsOut,
      archive: archiveOut,
      meta: {
        stale_after_days: config.knobs.stale_after_days,
        inactive_after_days: config.knobs.inactive_after_days,
        inactive_action: config.knobs.inactive_action,
        source_counts: {
          greenhouse: runtimeSources.greenhouse_companies.length,
          lever: runtimeSources.lever_companies.length,
          personio_xml_feeds: runtimeSources.personio_xml_feeds.length,
          smartrecruiters_companies: runtimeSources.smartrecruiters_companies.length,
          teamtailor_companies: runtimeSources.teamtailor_companies.length,
          recruitee_companies: runtimeSources.recruitee_companies.length,
          ashby_organizations: runtimeSources.ashby_organizations.length,
          stepstone_feeds: runtimeSources.stepstone_feeds.length,
          arbeitnow: runtimeSources.arbeitnow_enabled ? 1 : 0,
          remotive: runtimeSources.remotive_enabled ? 1 : 0,
          jobicy: runtimeSources.jobicy_enabled ? 1 : 0,
          adzuna: runtimeSources.adzuna_enabled ? 1 : 0,
          jooble: runtimeSources.jooble_enabled ? 1 : 0,
          serpapi_google_jobs: runtimeSources.serpapi_google_jobs_enabled && hasSerpApi ? 1 : 0,
          serpapi_job_boards: runtimeSources.serpapi_job_board_search_enabled && hasSerpApi ? 1 : 0,
          serpapi_official_sites: runtimeSources.serpapi_official_sites_search_enabled && hasSerpApi ? 1 : 0,
          official_career_pages: runtimeSourcesWithQueries.official_career_pages.length,
          search_queries: runtimeSourcesWithQueries.search_queries.length
        },
        stale_counts: staleCounts,
        inactive_counts: inactiveCounts,
        timings_ms: {
          fetch: fetchMs,
          total: Date.now() - start
        }
      }
    }

    writeDataFile(fs, path, config.paths.output_file!, output)
    writeDataFile(fs, path, config.paths.source_registry_file!, updatedRegistry)

    if (logger) {
      yield* Effect.log(
        `wrote ${config.paths.output_file} and ${config.paths.source_registry_file} in ${Date.now() - start}ms`
      )
    }

    return {
      outputPath: config.paths.output_file!,
      registryPath: config.paths.source_registry_file!
    }
  }).pipe(Effect.provide(addSimpleLogger))

  return Effect.runPromise(program)
}
