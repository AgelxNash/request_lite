// Релиз одной командой: guard версии против тегов → npm version (бамп package.json
// + release-коммит + аннотированный тег vX.Y.Z). package.json — единый источник
// правды: electron-builder берёт версию из него, тег создаётся из той же версии.
// Использование: npm run release -- patch|minor|major|X.Y.Z
// Требует чистое рабочее дерево (npm version откажется иначе — это намеренная защита).
import { execSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Укажите bump: npm run release -- patch|minor|major (или конкретную версию X.Y.Z)')
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// 1. Guard: сверяем ЦЕЛЕВУЮ версию (после бампа) с последним тегом — иначе
// recovery с рассинхрона (версия отстаёт от тегов) блокировался бы guard'ом.
const BUMPS = { patch: [0, 0, 1], minor: [0, 1, 0], major: [1, 0, 0] }
const literal = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(args[0])
let target = null
if (literal) {
  target = args[0].replace(/^v/, '')
} else if (BUMPS[args[0]]) {
  const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  // Ограничение: для prerelease-текущей версии арифметика бампа не совпадает с npm
  // (patch у semver «выпускает» prerelease) — такие версии считаем по факту без цели.
  if (!current.includes('-')) {
    const [major, minor, patch] = current.split('.').map(Number)
    const [dm, dn, dp] = BUMPS[args[0]]
    target = `${major + dm}.${minor + dn}.${patch + dp}`
  }
}
const checkArgs = target ? [join(root, 'scripts', 'check-version.mjs'), target] : [join(root, 'scripts', 'check-version.mjs')]
const check = spawnSync('node', checkArgs, { stdio: 'inherit' })
if (check.status !== 0) process.exit(check.status ?? 1)

// 2. npm version: бамп + коммит + аннотированный тег (проверено: тег аннотированный,
// поэтому git push --follow-tags его отправляет).
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = spawnSync(npm, ['version', ...args, '-m', 'release: v%s'], { cwd: root, stdio: 'inherit' })
if (run.status !== 0) process.exit(run.status ?? 1)

const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf8' }).trim()
console.log('\nДалее:')
console.log('  npm run dist                        # сборка с новой версией')
console.log(`  git push --follow-tags origin ${branch}   # коммит и тег вместе`)
