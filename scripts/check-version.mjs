// Guard рассинхрона «git-тег ↔ версия приложения»: package.json должен быть
// СТРОГО больше последнего тега vX.Y.Z — именно эту версию получат сборка
// (electron-builder) и serverInfo MCP-сервера. npm version сам откажется только
// на дубликате имени тега; тег «назад» (v0.5.0 при версии 0.1.0) git не ловит —
// это ловим здесь.
// Запуск: node scripts/check-version.mjs (перед сборкой релиза)
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

// Целевая версия: первый аргумент CLI (release.mjs передаёт версию ПОСЛЕ бампа) —
// иначе recovery с существующего рассинхрона (версия отстаёт от тегов) блокировался бы.
const targetVersion = process.argv[2] ?? pkgVersion

let tags
try {
  tags = execSync('git tag --list', { cwd: root, encoding: 'utf8' })
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => /^v\d/.test(tag))
} catch {
  console.error('Не удалось прочитать git-теги — репозиторий недоступен?')
  process.exit(1)
}

// semver-сравнение без зависимостей: ядро по числам, prerelease лексикографически;
// версия без prerelease «старше» версии с ним (1.0.0 > 1.0.0-beta.1).
function parse(version) {
  const [core, pre] = version.replace(/^v/, '').split('-')
  const [major, minor, patch] = core.split('.').map(Number)
  return { major, minor, patch, pre }
}

function compare(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key]
  }
  if (!a.pre && !b.pre) return 0
  if (!a.pre) return 1
  if (!b.pre) return -1
  return a.pre < b.pre ? -1 : a.pre > b.pre ? 1 : 0
}

const maxTag = tags.reduce(
  (acc, tag) => (acc === null || compare(parse(tag), parse(acc)) > 0 ? tag : acc),
  null
)

if (maxTag !== null && compare(parse(targetVersion), parse(maxTag)) <= 0) {
  console.error(`Рассинхрон: целевая версия ${targetVersion} <= последнего тега ${maxTag}.`)
  console.error('Поднимите версию перед релизом: npm run release -- patch|minor|major (или npm version X.Y.Z).')
  process.exit(1)
}

console.log(maxTag ? `OK: версия ${targetVersion} > последнего тега ${maxTag}` : `OK: git-тегов нет, версия ${targetVersion} свободна`)
