/// <reference path="../../node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts" />
/**
 * Regression: a Think `write` of the relative path `wrangler.json` ran
 * `mkdir("wrangler.json")` first (the tool took the path itself as its parent),
 * and the SQL workspace then accepted `writeFile` on that directory. The tool
 * reported success, `wrangler.json` stayed an empty directory, and the deploy
 * shipped no assets (vibesdk-eval agent 2ded6c9f, 2026-10-01).
 */
import { describe, expect, it } from "vitest"
import { env, runInDurableObject } from "cloudflare:test"
import { SqlBackend } from "../src/space/fs-backend"
import { globInfos, writeTextFile } from "../src/space/fileinfo"
import type {} from "./test-env"

function uniqueStub(name: string) {
  const id = env.FsHarnessDO.idFromName(`write-${name}-${Date.now()}-${Math.random()}`)
  return env.FsHarnessDO.get(id)
}

describe("writeTextFile", () => {
  it("documents the underlying FS behavior: writeFile over a directory leaves a directory", async () => {
    await runInDurableObject(uniqueStub("raw"), async (_instance, state) => {
      const fs = new SqlBackend(state, "test").fs
      await fs.mkdir("wrangler.json", { recursive: true })
      await fs.writeFile("wrangler.json", "{}")
      expect((await fs.stat("/wrangler.json"))?.type).toBe("directory")
      await expect(fs.readFile("/wrangler.json")).rejects.toThrow(/EISDIR/)
    })
  })

  it("refuses to write over a directory instead of silently losing the file", async () => {
    await runInDurableObject(uniqueStub("guard"), async (_instance, state) => {
      const fs = new SqlBackend(state, "test").fs
      await fs.mkdir("/wrangler.json", { recursive: true })
      await expect(writeTextFile(fs, "/wrangler.json", "{}")).rejects.toThrow(
        /EISDIR: \/wrangler\.json is a directory/,
      )
    })
  })

  it("writes and overwrites regular files", async () => {
    await runInDurableObject(uniqueStub("ok"), async (_instance, state) => {
      const fs = new SqlBackend(state, "test").fs
      await writeTextFile(fs, "/wrangler.json", '{"a":1}')
      await writeTextFile(fs, "/wrangler.json", '{"a":2}')
      await fs.mkdir("/public", { recursive: true })
      await writeTextFile(fs, "/public/index.html", "<h1>hi</h1>")
      expect(await fs.readFile("/wrangler.json")).toBe('{"a":2}')
      const files = (await globInfos(fs, "**/*")).filter((f) => f.type === "file").map((f) => f.path)
      expect(files.sort()).toEqual(["/public/index.html", "/wrangler.json"])
    })
  })
})
