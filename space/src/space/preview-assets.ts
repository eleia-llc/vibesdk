import { handleAssetRequest, type AssetConfig } from "@cloudflare/worker-bundler"
import { ASSETS_ONLY_MAIN_MODULE } from "./deploy-engine"

type AssetManifest = Parameters<typeof handleAssetRequest>[1]
type AssetStorage = Parameters<typeof handleAssetRequest>[2]

export interface PreviewAssetsDeployment {
  mainModule: string
  assets: Record<string, string>
  assetConfig?: AssetConfig
}

/**
 * Asset half of `SpaceDO.servePreview`, matching the published Worker
 * (`buildEntryModule` in `worker/services/deployer/think-user-deploy.ts`):
 *
 * - A request that matches an asset, or that `not_found_handling` resolves
 *   (`404-page` → nearest `404.html` with status 404, `single-page-application`
 *   → `index.html` for HTML navigations), is answered here.
 * - An assets-only deployment (static site) has no App, so anything else is a
 *   plain 404.
 * - Otherwise `null`: the caller forwards the request to the App facet.
 */
export async function servePreviewAssets(
  request: Request,
  dep: PreviewAssetsDeployment,
  loadAssets: () => Promise<{ manifest: AssetManifest; storage: AssetStorage }>,
): Promise<Response | null> {
  if (Object.keys(dep.assets).length > 0) {
    const { manifest, storage } = await loadAssets()
    const assetResponse = await handleAssetRequest(request, manifest, storage, dep.assetConfig)
    if (assetResponse) return assetResponse
  }
  if (dep.mainModule === ASSETS_ONLY_MAIN_MODULE) {
    return new Response("Not Found", { status: 404 })
  }
  return null
}
