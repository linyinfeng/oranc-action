import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import {promises as fs} from 'fs'
import * as xdg from 'xdg-basedir'

export const IsPost = !!process.env['STATE_isPost']

const dataDirectory = '/tmp/oranc-action'
const commonNixArgs = ['--experimental-features', 'nix-command flakes']
// check upstream substituters first cleaner log

const registry = core.getInput('registry')
const repositoryPart1 = core.getInput('repositoryPart1')
const repositoryPart2 = core.getInput('repositoryPart2')
const orancType = core.getInput('orancType')
const orancContainer = core.getInput('orancContainer')
const orancUrl = core.getInput('orancUrl')
const orancLog = core.getInput('orancLog')
const anonymous = core.getInput('anonymous')
const username = core.getInput('username')
const password = core.getInput('password')
const signingKey = core.getInput('signingKey')
const parallel = core.getInput('parallel')
const maxRetry = core.getInput('maxRetry')
const zstdLevel = core.getInput('zstdLevel')

async function setup(): Promise<void> {
  try {
    core.startGroup('oranc: get oranc instance url')
    let orancUrlFinal
    if (orancType === 'docker') {
      const dockerInspectOutput = await exec.getExecOutput('docker', [
        'inspect',
        '--format',
        '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
        orancContainer
      ])
      if (dockerInspectOutput.exitCode !== 0) {
        throw Error('failed to run docker inspect')
      }
      const ip = dockerInspectOutput.stdout.trim()
      orancUrlFinal = `http://${ip}`
      core.setOutput('orancUrl', orancUrlFinal)
    } else if (orancType === 'url') {
      orancUrlFinal = orancUrl
    } else {
      throw Error(`invalid orancType: '${orancType}'`)
    }
    core.endGroup()

    core.startGroup('oranc: setting up data directory')
    await io.mkdirP(dataDirectory)
    core.endGroup()

    core.startGroup('oranc: setting up substituters and trusted-public-keys')
    // get public key
    const convertOutput = await exec.getExecOutput(
      'nix',
      [...commonNixArgs, 'key', 'convert-secret-to-public'],
      {
        input: Buffer.from(signingKey)
      }
    )
    if (convertOutput.exitCode !== 0) {
      throw Error('failed to convert singing secret key to public key')
    }
    const publicKey = convertOutput.stdout
    const substituter = `${orancUrlFinal}/${registry}/${repositoryPart1}/${repositoryPart2}`
    const nixConf = `extra-substituters = ${substituter}
extra-trusted-public-keys = ${publicKey}
`
    await fs.writeFile(`${dataDirectory}/nix.conf`, nixConf)
    await io.mkdirP(`${xdg.xdgConfig}/nix`)
    await fs.appendFile(
      `${xdg.xdgConfig}/nix/nix.conf`,
      `\n# oranc\ninclude ${dataDirectory}/nix.conf\n`
    )
    core.endGroup()

    core.startGroup('oranc: check nix configurations')
    const showConfigOutput = await exec.getExecOutput('nix', [
      ...commonNixArgs,
      'show-config'
    ])
    if (showConfigOutput.exitCode !== 0) {
      throw Error('failed to run nix show-config')
    }
    const currentNixConfig = showConfigOutput.stdout
    if (
      !currentNixConfig.includes(substituter) ||
      !currentNixConfig.includes(publicKey)
    ) {
      throw Error('failed to setup substituters and trusted-public-keys')
    }
    core.endGroup()

    core.startGroup('oranc: install oranc')
    await exec.exec('nix', [
      ...commonNixArgs,
      'build',
      'github:linyinfeng/oranc',
      '--out-link',
      `${dataDirectory}/oranc`,
      '--extra-substituters',
      `https://linyinfeng.cachix.org`,
      '--extra-trusted-public-keys',
      'linyinfeng.cachix.org-1:sPYQXcNrnCf7Vr7T0YmjXz5dMZ7aOKG3EqLja0xr9MM='
    ])
    core.endGroup()

    core.startGroup('oranc: record store-paths-pre-build')
    const allStorePaths = await all_store_paths()
    await fs.writeFile(
      `${dataDirectory}/store-paths-pre-build`,
      JSON.stringify(allStorePaths)
    )
    core.endGroup()
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

async function upload(): Promise<void> {
  try {
    core.startGroup('oranc: get store-paths-pre-build')
    const storePathsPreBuildContent = await fs.readFile(
      `${dataDirectory}/store-paths-pre-build`
    )
    const storePathsPreBuild = JSON.parse(storePathsPreBuildContent.toString())
    if (!Array.isArray(storePathsPreBuild)) {
      throw Error('invalid store-paths-pre-build file')
    }
    const storePathsPreBuildSet = new Set(storePathsPreBuild)
    core.endGroup()

    core.startGroup('oranc: get store paths to push')
    core.info(`begin getting all store paths...`)
    let begin = performance.now()
    const AllStorePaths = await all_store_paths()
    let end = performance.now()
    core.info(`took ${end - begin} ms.`)

    core.info(`begin calculating paths for pushing...`)
    begin = performance.now()
    const storePaths = AllStorePaths.filter(p => !storePathsPreBuildSet.has(p))
    end = performance.now()
    core.info(`took ${end - begin} ms.`)
    core.endGroup()

    if (storePaths.length !== 0) {
      core.startGroup('oranc: push store paths')
      let credentials = {}
      if (anonymous !== 'true') {
        credentials = {
          ORANC_USERNAME: username,
          ORANC_PASSWORD: password
        }
      }
      core.info(`begin coping...`)
      begin = performance.now()
      await exec.exec(
        'sudo', // to open nix db
        [
          '-E', // pass environment variables
          `${dataDirectory}/oranc/bin/oranc`,
          'push',
          '--no-closure',
          '--registry',
          registry,
          '--repository',
          `${repositoryPart1}/${repositoryPart2}`,
          '--parallel',
          parallel,
          '--max-retry',
          maxRetry,
          '--zstd-level',
          zstdLevel
        ],
        {
          env: {
            ...process.env,
            RUST_LOG: orancLog,
            ORANC_SIGNING_KEY: signingKey,
            ...credentials
          },
          input: Buffer.from(storePaths.join('\n'))
        }
      )
      end = performance.now()
      core.info(`copying took ${end - begin} ms`)
      core.endGroup()
    } else {
      core.info(`skipped, no paths for copying`)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

async function all_store_paths(): Promise<string[]> {
  const pathInfoOutput = await exec.getExecOutput('nix', [
    ...commonNixArgs,
    'path-info',
    '--all'
  ])
  if (pathInfoOutput.exitCode !== 0) {
    throw Error('failed to run nix path-info --all')
  }
  const pathInfos = pathInfoOutput.stdout.trim().split('\n')
  // excludes all `.drv` store paths
  // it is safe to do so because derivation names are not allowed to end in '.drv'
  return pathInfos.filter(p => !p.endsWith('.drv'))
}

if (!IsPost) {
  // Publish a variable so that when the POST action runs, it can determine it should run the cleanup logic.
  // This is necessary since we don't have a separate entry point.
  core.saveState('isPost', 'true')
  setup()
} else {
  // Post
  upload()
}
