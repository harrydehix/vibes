import { createRequire } from 'node:module'
import { Script } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)

/** Execute the real module with explicit boundary doubles, without loading Electron. */
export function loadTestModule(
  source: string,
  modules: Record<string, unknown>,
  globals: Record<string, unknown> = {}
): Record<string, unknown> {
  const exports: Record<string, unknown> = {}
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  new Script(outputText).runInNewContext({
    exports,
    process,
    ...globals,
    require: (name: string) => modules[name] ?? require(name)
  })
  return exports
}
