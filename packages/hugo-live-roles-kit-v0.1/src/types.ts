export type RoleJob = {
  source: string
  source_note?: string
  company: string
  title: string
  location: string
  url: string
  updated_at: string | null
  description?: string
  job_types?: string[]
  remote?: boolean
  score?: number
  skill_hits?: number
  bucket_id?: string
}

export type DatedRoleJob = RoleJob & {
  fetched_at: string
  pulled_at: string
  stale_days: number
  is_stale: boolean
}

export type BucketRule = {
  id: string
  label: string
  include_title_patterns?: string[]
  include_title_keywords?: string[]
  include_text_patterns?: string[]
  include_text_keywords?: string[]
  exclude_text_patterns?: string[]
  exclude_text_keywords?: string[]
  min_score?: number
  min_skill_hits?: number
  max_results?: number
  require_employer_allowlist?: boolean
}

export type LocationPreferences = {
  countries?: string[]
  cities?: string[]
  priority_countries?: string[]
  priority_cities?: string[]
  exclude_countries?: string[]
  exclude_cities?: string[]
}

export type KeywordPreferences = {
  must_have?: string[]
  nice_to_have?: string[]
  exclude?: string[]
}

export type RoleProfile = {
  id: string
  display_name: string
  active_bucket_ids?: string[]
  skills: string[]
  locations?: LocationPreferences
  keywords?: KeywordPreferences
  geo_allow_patterns: string[]
  geo_priority_patterns?: string[]
  geo_exclude_patterns?: string[]
  employer_allowlist?: string[]
  buckets: BucketRule[]
}

export type SourceRegistry = {
  generated_at: string
  explicit: {
    company_names: string[]
    personio_xml_feeds: string[]
    smartrecruiters_companies: string[]
    teamtailor_companies: string[]
    recruitee_companies: string[]
    ashby_organizations: string[]
    stepstone_feeds: string[]
    official_career_pages: string[]
    search_queries: string[]
  }
  discovered: {
    company_names: string[]
    personio_xml_feeds: string[]
    smartrecruiters_companies: string[]
    teamtailor_companies: string[]
    recruitee_companies: string[]
    ashby_organizations: string[]
    stepstone_feeds: string[]
    official_career_pages: string[]
    search_queries: string[]
  }
  meta: {
    discovery_enabled: boolean
    max_probe_candidates: number
  }
}

export type FrameworkConfig = {
  schema_version: string
  profile_id: string
  paths: {
    output_file?: string
    source_registry_file?: string
    // Legacy keys kept for backward compatibility.
    output_json?: string
    source_registry_json?: string
  }
  knobs: {
    stale_after_days: number
    inactive_after_days: number
    inactive_action: "archive" | "hard_delete"
    max_runtime_ms: number
    request_timeout_ms: number
    request_delay_ms: number
    max_concurrency: number
    max_discovery_adds_per_source: number
    max_probe_candidates: number
    max_serpapi_queries_per_run: number
  }
  discovery: {
    enabled: boolean
  }
  sources: {
    greenhouse_companies: string[]
    lever_companies: string[]
    personio_xml_feeds: string[]
    smartrecruiters_companies: string[]
    teamtailor_companies: string[]
    recruitee_companies: string[]
    ashby_organizations: string[]
    stepstone_feeds: string[]
    arbeitnow_enabled: boolean
    remotive_enabled: boolean
    jobicy_enabled: boolean
    adzuna_enabled: boolean
    jooble_enabled: boolean
    serpapi_google_jobs_enabled: boolean
    serpapi_job_board_search_enabled: boolean
    serpapi_official_sites_search_enabled: boolean
  }
}

export type RolesOutputV1 = {
  schema_version: "roles.v1"
  profile_id: string
  profile_name: string
  generated_at: string
  buckets: Record<string, DatedRoleJob[]>
  archive: Record<string, DatedRoleJob[]>
  meta: {
    stale_after_days: number
    inactive_after_days: number
    inactive_action: "archive" | "hard_delete"
    source_counts: Record<string, number>
    stale_counts: Record<string, number>
    inactive_counts: Record<string, number>
    timings_ms: Record<string, number>
  }
}

export type RuntimeSources = {
  greenhouse_companies: string[]
  lever_companies: string[]
  personio_xml_feeds: string[]
  smartrecruiters_companies: string[]
  teamtailor_companies: string[]
  recruitee_companies: string[]
  ashby_organizations: string[]
  stepstone_feeds: string[]
  arbeitnow_enabled: boolean
  remotive_enabled: boolean
  jobicy_enabled: boolean
  adzuna_enabled: boolean
  jooble_enabled: boolean
  serpapi_google_jobs_enabled: boolean
  serpapi_job_board_search_enabled: boolean
  serpapi_official_sites_search_enabled: boolean
  official_career_pages: string[]
  search_queries: string[]
  serpapi_gl: string
  serpapi_hl: string
  adzuna_countries: string[]
  jooble_countries: string[]
}

export type RuntimeProviderConfig = {
  schema_version: "hugo-live-roles-runtime.v0.1"
  providers: {
    serpapi_gl?: string
    serpapi_hl?: string
    adzuna_countries?: string[]
    jooble_countries?: string[]
  }
  extra_sources?: {
    personio_xml_feeds?: string[]
    smartrecruiters_companies?: string[]
    teamtailor_companies?: string[]
    recruitee_companies?: string[]
    ashby_organizations?: string[]
    stepstone_feeds?: string[]
    official_career_pages?: string[]
    search_queries?: string[]
  }
}
