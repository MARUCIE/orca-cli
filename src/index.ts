/**
 * @armature/cli — Forge CLI entry point.
 *
 * Assembles the CLI program from individual commands and exports
 * both the program instance (for testing) and a run() function.
 */

export { createProgram, run } from './program.js'
export type { ForgeConfig, Provider } from './config.js'
export { resolveConfig, resolveProvider, listProviders, initGlobalConfig, initProjectConfig } from './config.js'
export type { ProviderConfig, ProviderInfo } from './config.js'
