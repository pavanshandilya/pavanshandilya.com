#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import {
  defaultConfigPath,
  legacyDefaultConfigPath,
  defaultProfilesDir,
  loadConfig,
  loadProfile,
  loadRegistry
} from "./config.js"
import { runPipeline } from "./pipeline.js"

const args = process.argv.slice(2)
const command = args[0] || "run"

const argValue = (name: string, fallback: string) => {
  const idx = args.indexOf(name)
  if (idx === -1) return fallback
  return args[idx + 1] || fallback
}

const defaultConfig = fs.existsSync(defaultConfigPath) ? defaultConfigPath : legacyDefaultConfigPath
const configPath = path.resolve(argValue("--config", defaultConfig))
const profilesDir = path.resolve(argValue("--profiles", defaultProfilesDir))

const check = () => {
  const config = loadConfig(configPath)
  const profile = loadProfile(profilesDir, config.profile_id)
  const registry = loadRegistry(config.paths.source_registry_file || config.paths.source_registry_json || "")

  console.log(`OK config: ${configPath}`)
  console.log(`OK profile: ${profile.id} (${profile.display_name})`)
  console.log(`OK registry: ${config.paths.source_registry_file || config.paths.source_registry_json}`)
  const active = profile.active_bucket_ids?.length
    ? profile.active_bucket_ids.join(", ")
    : profile.buckets.map((b) => b.id).join(", ")
  console.log(`Active buckets: ${active}`)
  console.log(`Discovery enabled: ${config.discovery.enabled && registry.meta.discovery_enabled}`)
}

const init = () => {
  const target = path.dirname(defaultConfigPath)
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true })

  const copy = (from: string, to: string) => {
    if (!fs.existsSync(to)) fs.copyFileSync(from, to)
  }

  copy(
    path.join(process.cwd(), "packages", "hugo-live-roles-kit-v0.1", "examples", "roles.config.yml"),
    defaultConfigPath
  )
  copy(
    path.join(process.cwd(), "packages", "hugo-live-roles-kit-v0.1", "examples", "roles-sources.yml"),
    path.join(target, "roles-sources.yml")
  )
  copy(
    path.join(process.cwd(), "packages", "hugo-live-roles-kit-v0.1", "examples", "providers.runtime.yml"),
    path.join(target, "providers.runtime.yml")
  )
  const profileDir = path.join(target, "profiles")
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true })
  copy(
    path.join(process.cwd(), "packages", "hugo-live-roles-kit-v0.1", "examples", "profiles", "data-engineer-de-eu.yml"),
    path.join(profileDir, "data-engineer-de-eu.yml")
  )

  console.log(`Initialized roles-kit at ${target}`)
}

const main = async () => {
  if (command === "check") return check()
  if (command === "init") return init()

  await runPipeline(configPath, profilesDir, true)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
