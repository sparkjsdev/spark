import type * as THREE from "three";

export interface SparkXrOptions {
  renderer: THREE.WebGLRenderer;
  // Element to attach enter/exit click handler to
  element?: HTMLElement;
  // ID of element to attach enter/exit click handler to
  elementId?: string;
  // Create a button to enter/exit XR
  // Optionally provide button text or HTML
  // Default is true - create a button
  button?: boolean | SparkXrButton;
  // Blur out element when mouse leaves it
  // Default is 0.5 - 50% opacity
  onMouseLeaveOpacity?: number;
  // Default is "vrar" - Try VR then AR
  mode?: "vr" | "ar" | "arvr" | "vrar";
  // fixedFoveation: XrManager.setFoveation(...)
  fixedFoveation?: number;
  // https://developer.mozilla.org/en-US/docs/Web/API/XRWebGLLayer/XRWebGLLayer#framebufferscalefactor
  // Default is 0.5 - 50% resolution for better frame rate
  frameBufferScaleFactor?: number;
  // https://developer.mozilla.org/en-US/docs/Web/API/XRReferenceSpace#reference_space_types
  // Defaults is "local" - origin is the user's position when starting XR session
  referenceSpaceType?: "local" | "local-floor" | "unbounded" | "viewer";
  // Enable hand tracking
  // Default is false
  hands?: boolean;
  // Session init options
  // Default is empty - no additional options
  sessionInit?: XRSessionInit;
  // Callback function called when SparkXr is ready
  // Default is undefined - no callback
  onReady?: (supported: boolean) => void | Promise<void>;
  // Callback function called when entering XR
  // Default is undefined - no callback
  onEnterXr?: () => void | Promise<void>;
  // Callback function called when exiting XR
  // Default is undefined - no callback
  onExitXr?: () => void | Promise<void>;
}

export interface SparkXrButton {
  enterXrHtml?: string;
  exitXrHtml?: string;
  enterVrHtml?: string;
  exitVrHtml?: string;
  enterArHtml?: string;
  exitArHtml?: string;
  enterXrText?: string;
  exitXrText?: string;
  enterVrText?: string;
  exitVrText?: string;
  enterArText?: string;
  exitArText?: string;
  style?: CSSStyleDeclaration;
  enterStyle?: CSSStyleDeclaration;
  exitStyle?: CSSStyleDeclaration;
  zIndex?: number;
}

export class SparkXr {
  renderer: THREE.WebGLRenderer;
  xr?: XRSystem;
  element?: HTMLElement;
  button?: SparkXrButton;
  mode: XRSessionMode | "initializing" | "not_supported";
  sessionInit?: XRSessionInit;
  session?: XRSession;
  onEnterXr?: () => void;
  onExitXr?: () => void;

  constructor(options: SparkXrOptions) {
    this.renderer = options.renderer;
    this.xr = navigator.xr;
    this.mode = "initializing";
    this.onEnterXr = options.onEnterXr;
    this.onExitXr = options.onExitXr;
    // console.log("* this.mode", this.mode);

    if (!this.xr) {
      this.mode = "not_supported";
      // console.log("* this.mode", this.mode);
      return;
    }

    let element: HTMLElement | undefined = undefined;
    let button: SparkXrButton | undefined = undefined;
    if (options.element) {
      element = options.element;
    } else if (options.elementId) {
      element = document.getElementById(options.elementId) ?? undefined;
    } else {
      element = SparkXr.createButton();
      button =
        options.button == null || typeof options.button === "boolean"
          ? {}
          : options.button;
    }

    if (!element) {
      throw new Error("No element or button provided");
    }
    // console.log("* element", element);

    element.style.display = "none";
    element.classList.add("hidden");
    this.button = button;
    this.element = element;

    const opacity = options.onMouseLeaveOpacity?.toString();
    if (opacity !== undefined) {
      element.addEventListener("mouseleave", () => {
        element.style.opacity = opacity;
      });
      element.addEventListener("mouseenter", () => {
        element.style.opacity = "";
      });
    }

    this.initializeXr(options)
      .then(() => {
        return options.onReady?.(this.mode !== "not_supported");
      })
      .catch((error) => {
        alert(`Error initializing SparkXr: ${error}`);
      });
  }

  private async initializeXr(options: SparkXrOptions) {
    if (!this.xr || !this.element) {
      return;
    }
    const element = this.element;

    const modes = {
      vr: ["immersive-vr"],
      ar: ["immersive-ar"],
      arvr: ["immersive-ar", "immersive-vr"],
      vrar: ["immersive-vr", "immersive-ar"],
    }[options.mode ?? "vrar"] as XRSessionMode[] | undefined;
    if (!modes) {
      throw new Error(`Invalid mode: ${options.mode}`);
    }
    // console.log("* modes", modes);

    let supported = null;
    for (const mode of modes) {
      // console.log("* testing mode", mode);
      if (await this.xr.isSessionSupported(mode)) {
        // console.log("* supported", mode);
        supported = mode;
        break;
      }
    }
    // console.log("* final supported", supported);

    if (!supported) {
      this.mode = "not_supported";
      // console.log("* this.mode", this.mode);
      return;
    }
    this.mode = supported;
    // console.log("* this.mode", this.mode);

    const referenceSpaceType = options.referenceSpaceType ?? "local";
    // console.log("* referenceSpaceType", referenceSpaceType);

    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType(referenceSpaceType);

    if (options.fixedFoveation !== undefined) {
      this.renderer.xr.setFoveation(options.fixedFoveation);
      // console.log("* fixedFoveation", options.fixedFoveation);
    }
    const frameBufferScaleFactor = options.frameBufferScaleFactor ?? 0.5;
    this.renderer.xr.setFramebufferScaleFactor(frameBufferScaleFactor);
    // console.log("* frameBufferScaleFactor", frameBufferScaleFactor);

    const optionalFeatures = options.sessionInit?.optionalFeatures ?? [];
    if (options.hands) {
      optionalFeatures.push("hand-tracking");
    }

    const requiredFeatures = options.sessionInit?.requiredFeatures ?? [];
    requiredFeatures.push(referenceSpaceType);

    this.sessionInit = {
      ...options.sessionInit,
      optionalFeatures,
      requiredFeatures,
    };
    // console.log("* this.sessionInit", this.sessionInit);

    element.addEventListener("click", () => {
      this.toggleXr();
    });

    this.updateElement();
  }

  async toggleXr() {
    if (!this.xr || !this.sessionInit) {
      // console.log("* !this.xr || !this.sessionInit");
      return;
    }

    if (!this.session) {
      try {
        const mode = this.mode as XRSessionMode;
        const session = await this.xr.requestSession(mode, this.sessionInit);
        this.session = session;
        // console.log("* this.session", this.session);

        const onSessionEnded = () => {
          session?.removeEventListener("end", onSessionEnded);
          session?.removeEventListener("visibilitychange", visibilityChanged);
          this.session = undefined;

          this.updateElement();
          this.onExitXr?.();
        };

        let lastVisibilityState = session.visibilityState;
        const visibilityChanged = () => {
          if (
            session?.visibilityState === "visible-blurred" &&
            lastVisibilityState === "visible"
          ) {
            session?.end();
          }
          lastVisibilityState = session?.visibilityState;
        };

        this.session?.addEventListener("end", onSessionEnded);
        this.session?.addEventListener("visibilitychange", visibilityChanged);

        await this.renderer.xr.setSession(this.session);
        // console.log("* setSession");

        return this.onEnterXr?.();
      } catch (error) {
        console.error("Error requesting XR session", error);
        return;
      }
    } else {
      this.session.end();
      // console.log("* end session");
    }
  }

  private updateElement() {
    const mode = this.mode as XRSessionMode;
    const element = this.element;
    if (element) {
      element.style.display = "";
      element.classList.remove("hidden");

      const button = typeof this.button === "boolean" ? {} : this.button;
      if (button) {
        if (!this.session) {
          const enterHtml =
            (mode === "immersive-vr"
              ? button.enterVrHtml
              : button.enterArHtml) ?? button.enterXrHtml;
          const enterText =
            (mode === "immersive-vr"
              ? button.enterVrText
              : button.enterArText) ?? button.enterXrText;
          // console.log("* enterHtml", enterHtml);
          // console.log("* enterText", enterText);
          if (enterHtml) {
            element.innerHTML = enterHtml;
          } else if (enterText) {
            element.textContent = enterText;
          } else {
            element.textContent =
              mode === "immersive-vr" ? "ENTER VR" : "ENTER AR";
          }
        } else {
          const exitHtml =
            (mode === "immersive-vr" ? button.exitVrHtml : button.exitArHtml) ??
            button.exitXrHtml;
          const exitText =
            (mode === "immersive-vr" ? button.exitVrText : button.exitArText) ??
            button.exitXrText;
          // console.log("* exitHtml", exitHtml);
          // console.log("* exitText", exitText);
          if (exitHtml) {
            element.innerHTML = exitHtml;
          } else if (exitText) {
            element.textContent = exitText;
          } else {
            element.textContent =
              mode === "immersive-vr" ? "EXIT VR" : "EXIT AR";
          }
        }

        element.style.display = "";
      }
    }
    // console.log("* updateElement", element);
  }

  private static createButton() {
    const button = document.createElement("button");
    Object.assign(button.style, {
      position: "absolute",
      bottom: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "30px 40px",
      border: "2px solid #fff",
      borderRadius: "16px",
      background: "rgba(0,0,0,0.1)",
      color: "#fff",
      font: "bold 28px sans-serif",
      textAlign: "center",
      userSelect: "none",
      zIndex: "999",
    });
    // console.log("* button", button);
    document.body.appendChild(button);
    return button;
  }

  xrSupported() {
    return !!this.xr;
  }
}
