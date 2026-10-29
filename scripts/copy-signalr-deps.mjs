import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Nitro externalizes @microsoft/signalr, but its CJS build loads ws/eventsource
// dynamically and pulls in node-fetch/tough-cookie. Copy that dependency closure
// into the standalone output so the production server can resolve it at runtime.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputModules = join(root, '.output/server/node_modules')
const requireFromRuntime = createRequire(join(root, 'packages/runtime/package.json'))
const signalrDir = packageDir('@microsoft/signalr', join(root, 'packages/runtime'))

function packageDir(name, fromDir) {
  let entry = requireFromRuntime.resolve(name, { paths: [fromDir] })
  if (!isAbsolute(entry)) entry = requireFromRuntime.resolve(`${name}/`, { paths: [fromDir] })
  let dir = dirname(entry)
  while (dir !== dirname(dir)) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) {
      return dir
    }
    dir = dirname(dir)
  }
  throw new Error(`Cannot locate package directory for ${name}`)
}

function copyPackage(name, fromDir) {
  const source = packageDir(name, fromDir)
  const destination = join(outputModules, name)
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true, dereference: true })
  return source
}

const copied = new Set()

function copyDependencies(packageName, fromDir) {
  // tough-cookie requires `punycode/` explicitly, so copy the npm package even
  // though Node also exposes a deprecated builtin with the same name.
  if ((isBuiltin(packageName) && packageName !== 'punycode') || copied.has(packageName)) return
  copied.add(packageName)

  const source = copyPackage(packageName, fromDir)
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    copyDependencies(dependency, source)
  }
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
    try {
      copyDependencies(dependency, source)
    } catch {
      // Optional native accelerators such as bufferutil are not installed.
    }
  }
}

const signalrManifest = JSON.parse(readFileSync(join(signalrDir, 'package.json'), 'utf8'))
for (const dependency of Object.keys(signalrManifest.dependencies ?? {})) {
  copyDependencies(dependency, signalrDir)
}
