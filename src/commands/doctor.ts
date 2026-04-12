/**
 * `orca doctor` — Local runtime diagnostics.
 */

import { Command } from 'commander'
import { gatherDoctorReport } from '../doctor.js'

export function createDoctorCommand(): Command {
  return new Command('doctor')
    .description('Run local Orca diagnostics')
    .option('--json', 'Emit structured JSON')
    .option('--cwd <dir>', 'Working directory to inspect')
    .action((opts: { json?: boolean; cwd?: string }) => {
      const report = gatherDoctorReport(opts.cwd || process.cwd())

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2))
        return
      }

      const providerStatus = report.provider.hasApiKey && report.provider.hasBaseURL
        ? '\x1b[32mOK\x1b[0m'
        : '\x1b[31mWARN\x1b[0m'
      const gitStatus = report.git.available ? '\x1b[32mOK\x1b[0m' : '\x1b[31mMISSING\x1b[0m'

      console.log()
      console.log('  \x1b[1mOrca Doctor\x1b[0m')
      console.log()
      console.log(`  \x1b[90mproject:\x1b[0m   ${report.project.name} \x1b[90m(${report.project.type})\x1b[0m`)
      console.log(`  \x1b[90mcwd:\x1b[0m       ${report.cwd}`)
      console.log(`  \x1b[90mnode:\x1b[0m      ${report.nodeVersion}`)
      console.log(`  \x1b[90mgit:\x1b[0m       ${gitStatus}${report.git.branch ? ` \x1b[90m(${report.git.branch})\x1b[0m` : ''}`)
      console.log(`  \x1b[90mproxy:\x1b[0m     ${report.proxy || '(none)'}`)
      console.log()
      console.log(`  \x1b[90mprovider:\x1b[0m  ${providerStatus} \x1b[90m${report.provider.activeProvider || 'unresolved'} / ${report.provider.model || 'n/a'}\x1b[0m`)
      console.log(`  \x1b[90mproviders:\x1b[0m ${report.providersConfigured} configured`)
      if (report.provider.warning) {
        console.log(`  \x1b[33mwarning:\x1b[0m   ${report.provider.warning}`)
      }
      console.log(`  \x1b[90mhooks:\x1b[0m     ${report.hooksConfigured}`)
      console.log(`  \x1b[90mmcp:\x1b[0m       ${report.mcpConfigured} configured`)
      console.log(`  \x1b[90msessions:\x1b[0m  ${report.sessionsSaved} saved`)
      console.log(`  \x1b[90mjobs:\x1b[0m      ${report.backgroundJobs.total} tracked, ${report.backgroundJobs.running} running`)
      console.log()
      console.log(`  \x1b[90magent log:\x1b[0m ${report.logs.agentPath}${report.logs.agentExists ? '' : ' \x1b[90m(missing)\x1b[0m'}`)
      console.log(`  \x1b[90merror log:\x1b[0m ${report.logs.errorPath}${report.logs.errorExists ? '' : ' \x1b[90m(missing)\x1b[0m'}`)
      console.log(`  \x1b[90mglobal cfg:\x1b[0m ${report.configPaths.global}`)
      console.log(`  \x1b[90mproject cfg:\x1b[0m ${report.configPaths.project}${report.configPaths.projectExists ? '' : ' \x1b[90m(missing)\x1b[0m'}`)
      const invalidConfigs = report.configDiagnostics.filter((entry) => !entry.valid)
      if (invalidConfigs.length > 0) {
        console.log()
        console.log('  \x1b[33mconfig issues:\x1b[0m')
        for (const entry of invalidConfigs) {
          console.log(`  \x1b[33m  - ${entry.kind}: ${entry.path}\x1b[0m`)
          console.log(`  \x1b[90m    ${entry.error}\x1b[0m`)
        }
      }
      if (report.project.framework || report.project.testRunner || report.project.configFiles.length > 0) {
        console.log()
        console.log(`  \x1b[90mframework:\x1b[0m ${report.project.framework || '(none detected)'}`)
        console.log(`  \x1b[90mtests:\x1b[0m     ${report.project.testRunner || '(none detected)'}`)
        console.log(`  \x1b[90mconfigs:\x1b[0m   ${report.project.configFiles.length > 0 ? report.project.configFiles.join(', ') : '(none detected)'}`)
      }
      console.log()
    })
}
