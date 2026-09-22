import { expect, test } from "./harness.fixture.js";

test("renders furry-logo-pedestal", async ({ harnessPage }) => {
  const png = await harnessPage.evaluate(async () => {
    const h = window.harness;
    h.createSpark();
    h.createCamera({ fov: 60, position: [0, 0, 7] });
    h.addSplatMesh({
      url: "/test/browser/fixtures/furry-logo-pedestal.spz",
      quaternion: [1, 0, 0, 0],
    });
    await h.settle();
    return h.getPixels();
  });

  expect(Buffer.from(png.split(",")[1], "base64")).toMatchSnapshot("basic.png");
});

test("renders with object and camera transforms", async ({ harnessPage }) => {
  const png = await harnessPage.evaluate(async () => {
    const h = window.harness;
    h.createSpark();
    // View from behind, off-axis and slightly above, looking back at the origin.
    h.createCamera({
      fov: 60,
      position: [1.6, 0.9, -6.7],
      lookAt: [0, -0.2, 0],
    });
    h.addSplatMesh({
      url: "/test/browser/fixtures/furry-logo-pedestal.spz",
      position: [0.3, -0.2, 0.1],
      rotation: [180, -20, 8],
      scale: 1.15,
    });
    await h.settle();
    return h.getPixels();
  });

  expect(Buffer.from(png.split(",")[1], "base64")).toMatchSnapshot(
    "basic-transformed.png",
  );
});

test("renders three overlapping instances of shared splats", async ({
  harnessPage,
}) => {
  const png = await harnessPage.evaluate(async () => {
    const h = window.harness;
    h.createSpark();
    h.createCamera({ fov: 60, position: [0.5, 1.0, 8.5], lookAt: [0, 0.2, 0] });
    const packedSplats = h.createPackedSplats({
      url: "/test/browser/fixtures/furry-logo-pedestal.spz",
    });
    // Three sizes, tilted so pedestals cut through neighbouring logos.
    h.addSplatMesh({ packedSplats, quaternion: [1, 0, 0, 0] });
    h.addSplatMesh({
      packedSplats,
      position: [-1.0, 1.4, 0.6],
      rotation: [180, 30, 70],
      scale: 0.6,
    });
    h.addSplatMesh({
      packedSplats,
      position: [1.6, -1.0, -1.2],
      rotation: [180, -40, -20],
      scale: 1.3,
    });
    await h.settle();
    return h.getPixels();
  });

  expect(Buffer.from(png.split(",")[1], "base64")).toMatchSnapshot(
    "basic-instances.png",
  );
});
