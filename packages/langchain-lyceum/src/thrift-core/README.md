# Vendored from `packages/thrift`

These four files are a direct copy of thrift's compression engine
(`compress.ts`, `tokens.ts`, `classify.ts`, `prose.ts`), not a workspace
import. `thrift` is never published standalone to npm — the name is
already taken by Apache Thrift — so a real `"thrift": "^x"` dependency
here would silently install the wrong package for anyone outside this
monorepo. Vendoring keeps this package fully self-contained.

If you change the compression logic, change it in `packages/thrift/src`
first and re-copy — this directory has no build-time link back to it.
