import { SplatLoader } from "@sparkjsdev/spark";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";

// Add loading icon in the center of the screen
function addLoader(loading_icon_color) {
  const loaderIcon = new Image();
  loaderIcon.src = `/examples/js/spark_loading_${loading_icon_color}.gif`;
  loaderIcon.id = "_spark_loader";
  loaderIcon.style.position = "absolute";
  loaderIcon.style.zIndex = 99999;
  loaderIcon.style.left = "50%";
  loaderIcon.style.top = "50%";
  loaderIcon.style.transform = "translate(-50%, -50%)";
  loaderIcon.style.pointerEvents = "none";
  document.body.appendChild(loaderIcon);
}

function removeLoader() {
  const el = document.getElementById("_spark_loader");
  el.parentNode.removeChild(el);
}

const splatLoader = new SplatLoader();

// preload splats, returning a map [filename -> SplatMesh]
export async function preloadSplats(assets, loading_icon_color = "white") {
  addLoader(loading_icon_color);
  const map = {};
  await Promise.all(
    assets.map(async (asset) => {
      const splatURL = await getAssetFileURL(asset);
      map[asset] = await splatLoader.loadAsync(splatURL);
    }),
  );

  removeLoader();
  return map;
}
