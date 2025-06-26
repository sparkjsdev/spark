import { SparkViewpoint } from "@sparkjsdev/spark";
import * as THREE from "three";

class ViewpointWidget {
  static cameraHUD = (() => {
    const cameraHUD = new THREE.OrthographicCamera(
      0,
      window.innerWidth,
      window.innerHeight,
      0,
      -1000,
      1000,
    );
    cameraHUD.position.set(0, 0, 10);
    return cameraHUD;
  })();

  constructor(spark, scene, renderer, cameraPos, targetPos, widgetXYWH) {
    this.scene = scene;
    this.renderer = renderer;
    this.sceneHUD = new THREE.Scene();

    this.x = widgetXYWH.x;
    this.y = widgetXYWH.y;
    this.w = widgetXYWH.w;
    this.h = widgetXYWH.h;
    this.lastWindowWidth = window.innerWidth;
    this.lastWindowHeight = window.innerHeight;

    // Create a textured rectangle at the near plane to show the viewpoint
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(this.w, this.h),
      new THREE.MeshBasicMaterial({ map: SparkViewpoint.EMPTY_TEXTURE }),
    );
    screen.position.set(this.w / 2, this.h / 2, -1);
    this.sceneHUD.add(screen);

    const viewCamera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    viewCamera.position.copy(cameraPos);
    viewCamera.lookAt(targetPos);
    this.camera = viewCamera;

    this.viewpoint = spark.newViewpoint({
      autoUpdate: true,
      camera: viewCamera,
      target: { width: this.w, height: this.h, doubleBuffer: true },
      onTextureUpdated: (texture) => {
        // Update the view screen with the rendered viewpoint
        screen.material.map = texture;
      },
    });
  }

  render() {
    this.renderer.setScissorTest(true);
    this.renderer.setViewport(
      this.x,
      this.y,
      window.innerWidth,
      window.innerHeight,
    );
    this.renderer.setScissor(this.x, this.y, this.w, this.h);
    // Render the viewpoint
    this.viewpoint.renderTarget({
      scene: this.scene,
      camera: this.viewpoint.camera,
    });
    // // Render the HUD scene
    this.renderer.render(this.sceneHUD, ViewpointWidget.cameraHUD);
    this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    this.renderer.setScissorTest(false);
  }

  resize() {
    // Check if the window size has changed
    if (
      window.innerWidth !== this.lastWindowWidth ||
      window.innerHeight !== this.lastWindowHeight
    ) {
      // Update the widget size
      const widthScale = window.innerWidth / this.lastWindowWidth;
      const heightScale = window.innerHeight / this.lastWindowHeight;
      this.w = widthScale * this.w;
      this.h = heightScale * this.h;
      this.x = widthScale * this.x;
      this.y = heightScale * this.y;
      this.lastWindowWidth = window.innerWidth;
      this.lastWindowHeight = window.innerHeight;

      // Update the viewport camera
      this.viewpoint.camera.aspect = window.innerWidth / window.innerHeight;
      this.viewpoint.camera.updateProjectionMatrix();
    }
  }
}

export default ViewpointWidget;
