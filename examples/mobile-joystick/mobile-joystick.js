/**
 * Mobile Controls - Virtual Joystick
 *
 * Provides touch-based movement controls for mobile devices.
 *
 * Usage:
 *   import { initMobileControls, getMobileInput, isMobileDevice } from './mobile-joystick.js';
 *
 *   if (isMobileDevice()) {
 *       initMobileControls();
 *   }
 *
 *   // In your update loop:
 *   const input = getMobileInput();
 *   // input.x: -1 to 1 (left/right)
 *   // input.y: -1 to 1 (forward/back, positive = backward)
 *   // input.active: boolean (is joystick being touched)
 */

// Configuration
const CONFIG = {
  joystickSize: 120,
  knobSize: 50,
  deadzone: 0.15,
  marginLeft: 30,
  marginBottom: 30,
  outerColor: "rgba(255, 255, 255, 0.2)",
  outerBorder: "rgba(255, 255, 255, 0.4)",
  knobColor: "rgba(255, 255, 255, 0.5)",
  knobActiveColor: "rgba(100, 150, 255, 0.7)",
};

// State
let initialized = false;
let enabled = true;
let joystickContainer = null;
let joystickKnob = null;
let activeTouch = null;
let joystickCenter = { x: 0, y: 0 };
let currentInput = { x: 0, y: 0, active: false };

/**
 * Check if the current device is a mobile/touch device (but NOT a VR headset)
 */
export function isMobileDevice() {
  if (/OculusBrowser|Quest|Oculus/i.test(navigator.userAgent)) {
    return false;
  }
  return (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    )
  );
}

/**
 * Initialize mobile controls
 */
export function initMobileControls(options = {}) {
  if (initialized) return;
  Object.assign(CONFIG, options);
  createJoystickUI();
  attachEventListeners();
  initialized = true;
  console.log("[MobileControls] Initialized");
}

/**
 * Get current mobile input state
 */
export function getMobileInput() {
  if (!enabled || !initialized) {
    return { x: 0, y: 0, active: false };
  }
  return { ...currentInput };
}

/**
 * Enable or disable mobile controls
 */
export function setMobileControlsEnabled(value) {
  enabled = value;
  if (joystickContainer) {
    joystickContainer.style.display = enabled ? "block" : "none";
  }
  if (!enabled) {
    currentInput = { x: 0, y: 0, active: false };
  }
}

function createJoystickUI() {
  joystickContainer = document.createElement("div");
  joystickContainer.id = "mobile-joystick";
  joystickContainer.style.cssText = `
        position: fixed;
        left: ${CONFIG.marginLeft}px;
        bottom: ${CONFIG.marginBottom}px;
        width: ${CONFIG.joystickSize}px;
        height: ${CONFIG.joystickSize}px;
        z-index: 1000;
        touch-action: none;
        pointer-events: auto;
    `;

  const joystickOuter = document.createElement("div");
  joystickOuter.style.cssText = `
        position: absolute;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        background: ${CONFIG.outerColor};
        border: 2px solid ${CONFIG.outerBorder};
        box-sizing: border-box;
    `;

  joystickKnob = document.createElement("div");
  joystickKnob.style.cssText = `
        position: absolute;
        width: ${CONFIG.knobSize}px;
        height: ${CONFIG.knobSize}px;
        border-radius: 50%;
        background: ${CONFIG.knobColor};
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        transition: background 0.1s;
    `;

  joystickOuter.appendChild(joystickKnob);
  joystickContainer.appendChild(joystickOuter);
  document.body.appendChild(joystickContainer);

  updateJoystickCenter();
}

function updateJoystickCenter() {
  if (!joystickContainer) return;
  const rect = joystickContainer.getBoundingClientRect();
  joystickCenter = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function attachEventListeners() {
  window.addEventListener("resize", updateJoystickCenter);
  window.addEventListener("orientationchange", () => {
    setTimeout(updateJoystickCenter, 100);
  });

  joystickContainer.addEventListener("touchstart", handleTouchStart, {
    passive: false,
  });
  document.addEventListener("touchmove", handleTouchMove, { passive: false });
  document.addEventListener("touchend", handleTouchEnd, { passive: false });
  document.addEventListener("touchcancel", handleTouchEnd, { passive: false });
}

function handleTouchStart(e) {
  if (!enabled || activeTouch !== null) return;

  const touch = e.changedTouches[0];
  activeTouch = touch.identifier;

  updateJoystickCenter();
  updateJoystickPosition(touch.clientX, touch.clientY);

  joystickKnob.style.background = CONFIG.knobActiveColor;
  currentInput.active = true;

  e.preventDefault();
}

function handleTouchMove(e) {
  if (!enabled || activeTouch === null) return;

  for (const touch of e.changedTouches) {
    if (touch.identifier === activeTouch) {
      updateJoystickPosition(touch.clientX, touch.clientY);
      e.preventDefault();
      break;
    }
  }
}

function handleTouchEnd(e) {
  if (activeTouch === null) return;

  for (const touch of e.changedTouches) {
    if (touch.identifier === activeTouch) {
      resetJoystick();
      break;
    }
  }
}

function updateJoystickPosition(touchX, touchY) {
  const maxRadius = (CONFIG.joystickSize - CONFIG.knobSize) / 2;

  let dx = touchX - joystickCenter.x;
  let dy = touchY - joystickCenter.y;

  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance > maxRadius) {
    dx = (dx / distance) * maxRadius;
    dy = (dy / distance) * maxRadius;
  }

  const knobX = 50 + (dx / maxRadius) * 50;
  const knobY = 50 + (dy / maxRadius) * 50;
  joystickKnob.style.left = `${knobX}%`;
  joystickKnob.style.top = `${knobY}%`;

  let inputX = dx / maxRadius;
  let inputY = dy / maxRadius;

  if (Math.abs(inputX) < CONFIG.deadzone) inputX = 0;
  if (Math.abs(inputY) < CONFIG.deadzone) inputY = 0;

  currentInput.x = inputX;
  currentInput.y = inputY;
}

function resetJoystick() {
  activeTouch = null;
  currentInput = { x: 0, y: 0, active: false };

  if (joystickKnob) {
    joystickKnob.style.left = "50%";
    joystickKnob.style.top = "50%";
    joystickKnob.style.background = CONFIG.knobColor;
  }
}
