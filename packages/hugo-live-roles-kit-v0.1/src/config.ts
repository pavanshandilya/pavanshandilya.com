import fs from "node:fs"
import path from "node:path"
import {
  FrameworkConfig,
  RoleProfile,
  RuntimeProviderConfig,
  RuntimeSources,
  SourceRegistry
} from "./types.js"
import { parseEnvList, readDataFile, unique } from "./util.js"

const emptyRegistry = (): SourceRegistry => ({
  generated_at: new Date().toISOString(),
  explicit: {
    company_names: [],
    personio_xml_feeds: [],
    smartrecruiters_companies: [],
    teamtailor_companies: [],
    recruitee_companies: [],
    ashby_organizations: [],
    stepstone_feeds: [],
    official_career_pages: [],
    search_queries: []
  },
  discovered: {
    company_names: [],
    personio_xml_feeds: [],
    smartrecruiters_companies: [],
    teamtailor_companies: [],
    recruitee_companies: [],
    ashby_organizations: [],
    stepstone_feeds: [],
    official_career_pages: [],
    search_queries: []
  },
  meta: {
    discovery_enabled: true,
    max_probe_candidates: 80
  }
})

export const loadConfig = (configPath: string): FrameworkConfig => {
  const raw = readDataFile<FrameworkConfig | null>(fs, configPath, null)
  if (!raw) throw new Error(`Config not found or invalid YAML/JSON: ${configPath}`)
  if (raw.schema_version !== "hugo-live-roles-kit.v0.1") {
    throw new Error(`Unsupported config schema_version: ${raw.schema_version}`)
  }
  const baseDir = path.dirname(path.resolve(configPath))
  const outputFile = raw.paths.output_file || raw.paths.output_json
  const sourceRegistryFile = raw.paths.source_registry_file || raw.paths.source_registry_json
  if (!outputFile || !sourceRegistryFile) {
    throw new Error(
      `Config paths must include paths.output_file and paths.source_registry_file (or legacy *_json keys): ${configPath}`
    )
  }
  return {
    ...raw,
    paths: {
      output_file: path.resolve(baseDir, outputFile),
      source_registry_file: path.resolve(baseDir, sourceRegistryFile)
    },
    knobs: {
      ...raw.knobs,
      max_serpapi_queries_per_run: raw.knobs?.max_serpapi_queries_per_run ?? 24
    },
    sources: {
      ...raw.sources,
      remotive_enabled: raw.sources?.remotive_enabled ?? true,
      jobicy_enabled: raw.sources?.jobicy_enabled ?? true,
      adzuna_enabled: raw.sources?.adzuna_enabled ?? true,
      jooble_enabled: raw.sources?.jooble_enabled ?? true,
      serpapi_google_jobs_enabled: raw.sources?.serpapi_google_jobs_enabled ?? true,
      serpapi_job_board_search_enabled: raw.sources?.serpapi_job_board_search_enabled ?? true,
      serpapi_official_sites_search_enabled: raw.sources?.serpapi_official_sites_search_enabled ?? true
    }
  }
}

export const loadProfile = (profilesDir: string, profileId: string): RoleProfile => {
  const profilePathYml = path.join(profilesDir, `${profileId}.yml`)
  const profilePathYaml = path.join(profilesDir, `${profileId}.yaml`)
  const profilePathJson = path.join(profilesDir, `${profileId}.json`)
  const profilePath = fs.existsSync(profilePathYml)
    ? profilePathYml
    : fs.existsSync(profilePathYaml)
      ? profilePathYaml
      : profilePathJson
  const raw = readDataFile<RoleProfile | null>(fs, profilePath, null)
  if (!raw) throw new Error(`Profile not found or invalid YAML/JSON: ${profilePath}`)
  return raw
}

export const loadRegistry = (registryPath: string): SourceRegistry => {
  const raw = readDataFile<SourceRegistry | null>(fs, registryPath, null)
  if (!raw) return emptyRegistry()
  return {
    generated_at: raw.generated_at || new Date().toISOString(),
    explicit: {
      company_names: raw.explicit?.company_names || [],
      personio_xml_feeds: raw.explicit?.personio_xml_feeds || [],
      smartrecruiters_companies: raw.explicit?.smartrecruiters_companies || [],
      teamtailor_companies: raw.explicit?.teamtailor_companies || [],
      recruitee_companies: raw.explicit?.recruitee_companies || [],
      ashby_organizations: raw.explicit?.ashby_organizations || [],
      stepstone_feeds: raw.explicit?.stepstone_feeds || [],
      official_career_pages: raw.explicit?.official_career_pages || [],
      search_queries: raw.explicit?.search_queries || []
    },
    discovered: {
      company_names: raw.discovered?.company_names || [],
      personio_xml_feeds: raw.discovered?.personio_xml_feeds || [],
      smartrecruiters_companies: raw.discovered?.smartrecruiters_companies || [],
      teamtailor_companies: raw.discovered?.teamtailor_companies || [],
      recruitee_companies: raw.discovered?.recruitee_companies || [],
      ashby_organizations: raw.discovered?.ashby_organizations || [],
      stepstone_feeds: raw.discovered?.stepstone_feeds || [],
      official_career_pages: raw.discovered?.official_career_pages || [],
      search_queries: raw.discovered?.search_queries || []
    },
    meta: {
      discovery_enabled:
        typeof raw.meta?.discovery_enabled === "boolean" ? raw.meta.discovery_enabled : true,
      max_probe_candidates:
        typeof raw.meta?.max_probe_candidates === "number" ? raw.meta.max_probe_candidates : 80
    }
  }
}

export const resolveRuntimeSources = (
  config: FrameworkConfig,
  registry: SourceRegistry,
  runtimeConfig: RuntimeProviderConfig | null
): RuntimeSources => {
  const fromEnv = {
    personio_xml_feeds: parseEnvList(process.env.PERSONIO_XML_FEEDS),
    smartrecruiters_companies: parseEnvList(process.env.SMARTRECRUITERS_COMPANIES),
    teamtailor_companies: parseEnvList(process.env.TEAMTAILOR_COMPANIES),
    recruitee_companies: parseEnvList(process.env.RECRUITEE_COMPANIES),
    ashby_organizations: parseEnvList(process.env.ASHBY_ORGANIZATIONS),
    stepstone_feeds: parseEnvList(process.env.STEPSTONE_FEEDS),
    official_career_pages: parseEnvList(process.env.OFFICIAL_CAREER_PAGES),
    search_queries: parseEnvList(process.env.SEARCH_QUERIES)
  }
  const fromRuntime = {
    personio_xml_feeds: runtimeConfig?.extra_sources?.personio_xml_feeds || [],
    smartrecruiters_companies: runtimeConfig?.extra_sources?.smartrecruiters_companies || [],
    teamtailor_companies: runtimeConfig?.extra_sources?.teamtailor_companies || [],
    recruitee_companies: runtimeConfig?.extra_sources?.recruitee_companies || [],
    ashby_organizations: runtimeConfig?.extra_sources?.ashby_organizations || [],
    stepstone_feeds: runtimeConfig?.extra_sources?.stepstone_feeds || [],
    official_career_pages: runtimeConfig?.extra_sources?.official_career_pages || [],
    search_queries: runtimeConfig?.extra_sources?.search_queries || []
  }
  const providerDefaults = {
    serpapi_gl: runtimeConfig?.providers?.serpapi_gl || "de",
    serpapi_hl: runtimeConfig?.providers?.serpapi_hl || "en",
    adzuna_countries: runtimeConfig?.providers?.adzuna_countries || ["de", "fr", "nl", "at", "be", "in"],
    jooble_countries: runtimeConfig?.providers?.jooble_countries || ["de", "fr", "nl", "at", "be", "in"]
  }

  return {
    greenhouse_companies: unique(config.sources.greenhouse_companies),
    lever_companies: unique(config.sources.lever_companies),
    personio_xml_feeds: unique([
      ...config.sources.personio_xml_feeds,
      ...fromRuntime.personio_xml_feeds,
      ...fromEnv.personio_xml_feeds,
      ...registry.explicit.personio_xml_feeds,
      ...registry.discovered.personio_xml_feeds
    ]),
    smartrecruiters_companies: unique([
      ...config.sources.smartrecruiters_companies,
      ...fromRuntime.smartrecruiters_companies,
      ...fromEnv.smartrecruiters_companies,
      ...registry.explicit.smartrecruiters_companies,
      ...registry.discovered.smartrecruiters_companies
    ]),
    teamtailor_companies: unique([
      ...config.sources.teamtailor_companies,
      ...fromRuntime.teamtailor_companies,
      ...fromEnv.teamtailor_companies,
      ...registry.explicit.teamtailor_companies,
      ...registry.discovered.teamtailor_companies
    ]),
    recruitee_companies: unique([
      ...config.sources.recruitee_companies,
      ...fromRuntime.recruitee_companies,
      ...fromEnv.recruitee_companies,
      ...registry.explicit.recruitee_companies,
      ...registry.discovered.recruitee_companies
    ]),
    ashby_organizations: unique([
      ...config.sources.ashby_organizations,
      ...fromRuntime.ashby_organizations,
      ...fromEnv.ashby_organizations,
      ...registry.explicit.ashby_organizations,
      ...registry.discovered.ashby_organizations
    ]),
    stepstone_feeds: unique([
      ...config.sources.stepstone_feeds,
      ...fromRuntime.stepstone_feeds,
      ...fromEnv.stepstone_feeds,
      ...registry.explicit.stepstone_feeds,
      ...registry.discovered.stepstone_feeds
    ]),
    arbeitnow_enabled: config.sources.arbeitnow_enabled,
    remotive_enabled: config.sources.remotive_enabled,
    jobicy_enabled: config.sources.jobicy_enabled,
    adzuna_enabled: config.sources.adzuna_enabled,
    jooble_enabled: config.sources.jooble_enabled,
    serpapi_google_jobs_enabled: config.sources.serpapi_google_jobs_enabled,
    serpapi_job_board_search_enabled: config.sources.serpapi_job_board_search_enabled,
    serpapi_official_sites_search_enabled: config.sources.serpapi_official_sites_search_enabled,
    official_career_pages: unique([
      ...fromRuntime.official_career_pages,
      ...fromEnv.official_career_pages,
      ...registry.explicit.official_career_pages,
      ...registry.discovered.official_career_pages
    ]),
    search_queries: unique([
      ...fromRuntime.search_queries,
      ...fromEnv.search_queries,
      ...registry.explicit.search_queries,
      ...registry.discovered.search_queries
    ]),
    serpapi_gl: providerDefaults.serpapi_gl.toLowerCase(),
    serpapi_hl: providerDefaults.serpapi_hl.toLowerCase(),
    adzuna_countries: unique(providerDefaults.adzuna_countries.map((v) => v.trim().toLowerCase()).filter(Boolean)),
    jooble_countries: unique(providerDefaults.jooble_countries.map((v) => v.trim().toLowerCase()).filter(Boolean))
  }
}

export const defaultConfigPath = path.join(process.cwd(), "roles-kit", "roles.config.yml")
export const legacyDefaultConfigPath = path.join(process.cwd(), "roles-kit", "roles.config.json")
export const defaultProfilesDir = path.join(process.cwd(), "roles-kit", "profiles")
export const defaultRuntimeProvidersPath = path.join(process.cwd(), "roles-kit", "providers.runtime.yml")

export const loadRuntimeProviders = (runtimePath: string): RuntimeProviderConfig | null => {
  const raw = readDataFile<RuntimeProviderConfig | null>(fs, runtimePath, null)
  if (!raw) return null
  if (raw.schema_version !== "hugo-live-roles-runtime.v0.1") return null
  return raw
}
