import {
  getInput,
  startGroup,
  setOutput,
  endGroup,
  setFailed,
  info,
  saveState
} from '@actions/core'
import {getExecOutput, exec} from '@actions/exec'
import {mkdirP} from '@actions/io'
import {promises as fs} from 'fs'
import {xdgConfig} from 'xdg-basedir'
import fetch from 'node-fetch'

export const IsPost = !!process.env['STATE_isPost']

const dataDirectory = '/tmp/oranc-action'
const commonNixArgs = ['--experimental-features', 'nix-command flakes']
// check upstream substituters first cleaner log

const registry = getInput('registry')
const repositoryPart1 = getInput('repositoryPart1')
const repositoryPart2 = getInput('repositoryPart2')
const orancServerType = getInput('orancServerType')
const orancServerContainer = getInput('orancServerContainer')
const orancServerUrl = getInput('orancServerUrl')
const orancLog = getInput('orancLog')
const orancCli = getInput('orancCli')
const orancCliExtraArgs = getInput('orancCliExtraArgs')
const anonymous = getInput('anonymous')
const username = getInput('username')
const password = getInput('password')
const signingKey = getInput('signingKey')
const parallel = getInput('parallel')
const maxRetry = getInput('maxRetry')
const zstdLevel = getInput('zstdLevel')
const initialize = getInput('initialize')
const forceInitialize = getInput('forceInitialize')
const initializePriority = getInput('initializePriority')
const initializeMassQuery = getInput('initializeMassQuery')

async function setup(): Promise<void> {
  try {
    startGroup('oranc: get oranc instance url')
    let orancUrlFinal
    if (orancServerType === 'docker') {
      const dockerInspectOutput = await getExecOutput('docker', [
        'inspect',
        '--format',
        '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
        orancServerContainer
      ])
      if (dockerInspectOutput.exitCode !== 0) {
        throw Error('failed to run docker inspect')
      }
      const ip = dockerInspectOutput.stdout.trim()
      orancUrlFinal = `http://${ip}`
      setOutput('orancUrl', orancUrlFinal)
    } else if (orancServerType === 'url') {
      orancUrlFinal = orancServerUrl
    } else {
      throw Error(`invalid orancServerType: '${orancServerType}'`)
    }
    endGroup()

    startGroup('oranc: setting up data directory')
    await mkdirP(dataDirectory)
    endGroup()

    startGroup('oranc: setting up substituters and trusted-public-keys')
    // get public key
    const convertOutput = await getExecOutput(
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
    await mkdirP(`${xdgConfig}/nix`)
    await fs.appendFile(
      `${xdgConfig}/nix/nix.conf`,
      `\n# oranc\ninclude ${dataDirectory}/nix.conf\n`
    )
    endGroup()

    startGroup('oranc: check nix configurations')
    const showConfigOutput = await getExecOutput('nix', [
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
    endGroup()

    startGroup('oranc: install oranc')
    await exec('nix', [
      ...commonNixArgs,
      'build',
      orancCli,
      '--out-link',
      `${dataDirectory}/oranc`,
      '--extra-substituters',
      `https://linyinfeng.cachix.org`,
      '--extra-trusted-public-keys',
      'linyinfeng.cachix.org-1:sPYQXcNrnCf7Vr7T0YmjXz5dMZ7aOKG3EqLja0xr9MM='
    ])
    endGroup()

    startGroup('oranc: record store-paths-pre-build')
    const allStorePaths = await all_store_paths()
    await fs.writeFile(
      `${dataDirectory}/store-paths-pre-build`,
      JSON.stringify(allStorePaths)
    )
    endGroup()

    if (initialize === 'true') {
      startGroup('oranc: initialize nix-cache-info')
      let doInitialize = false
      if (forceInitialize === 'true') {
        doInitialize = true
      } else {
        const result = await fetch(`${substituter}/nix-cache-info`)
        if (result.status === 200) {
          doInitialize = false
        } else if (result.status === 404) {
          doInitialize = true
        } else {
          throw Error(
            `failed to fetch nix-cache-info: ${result.status} ${result.statusText} ${result.body}`
          )
        }
      }
      if (doInitialize) {
        const credentials = get_credentials()
        const extraArgs = get_oranc_extra_args()
        const initializeArgs = ['--priority', initializePriority]
        if (initializeMassQuery !== 'true') {
          initializeArgs.push('--no-mass-query')
        }
        await exec(
          'sudo', // to open nix db
          [
            '-E', // pass environment variables
            `${dataDirectory}/oranc/bin/oranc`,
            'push',
            '--registry',
            registry,
            '--repository',
            `${repositoryPart1}/${repositoryPart2}`,
            '--max-retry',
            maxRetry,
            ...extraArgs,
            'initialize',
            ...initializeArgs
          ],
          {
            env: {
              ...process.env,
              RUST_LOG: orancLog,
              ORANC_SIGNING_KEY: signingKey,
              ...credentials
            }
          }
        )
      }
    }
  } catch (error) {
    if (error instanceof Error) setFailed(error.message)
  }
}

async function upload(): Promise<void> {
  try {
    startGroup('oranc: get store-paths-pre-build')
    const storePathsPreBuildContent = await fs.readFile(
      `${dataDirectory}/store-paths-pre-build`
    )
    const storePathsPreBuild = JSON.parse(storePathsPreBuildContent.toString())
    if (!Array.isArray(storePathsPreBuild)) {
      throw Error('invalid store-paths-pre-build file')
    }
    const storePathsPreBuildSet = new Set(storePathsPreBuild)
    endGroup()

    startGroup('oranc: get store paths to push')
    info(`begin getting all store paths...`)
    let begin = performance.now()
    const AllStorePaths = await all_store_paths()
    let end = performance.now()
    info(`took ${end - begin} ms.`)

    info(`begin calculating paths for pushing...`)
    begin = performance.now()
    const storePaths = AllStorePaths.filter(p => !storePathsPreBuildSet.has(p))
    end = performance.now()
    info(`took ${end - begin} ms.`)
    endGroup()

    startGroup('oranc: push store paths')
    const credentials = get_credentials()
    const extraArgs = get_oranc_extra_args()
    info(`begin coping...`)
    begin = performance.now()
    await exec(
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
        zstdLevel,
        ...extraArgs
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
    info(`copying took ${end - begin} ms`)
    endGroup()
  } catch (error) {
    if (error instanceof Error) setFailed(error.message)
  }
}

async function all_store_paths(): Promise<string[]> {
  const pathInfoOutput = await getExecOutput('nix', [
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

function get_credentials(): {[key: string]: string} {
  let credentials = {}
  if (anonymous !== 'true') {
    credentials = {
      ORANC_USERNAME: username,
      ORANC_PASSWORD: password
    }
  }
  return credentials
}

function get_oranc_extra_args(): string[] {
  const extraArgsEncoded = orancCliExtraArgs.split(' ')
  const extraArgs = extraArgsEncoded.map(c => decodeURI(c))
  return extraArgs
}

if (!IsPost) {
  // Publish a variable so that when the POST action runs, it can determine it should run the cleanup logic.
  // This is necessary since we don't have a separate entry point.
  saveState('isPost', 'true')
  setup()
} else {
  // Post
  upload()
}
