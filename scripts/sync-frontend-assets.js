import { sharedFrontendAssets, syncFrontendAssets } from "./frontend-assets.js";

await syncFrontendAssets();
console.log(`Synced ${sharedFrontendAssets.length} shared frontend assets to pages-frontend.`);
