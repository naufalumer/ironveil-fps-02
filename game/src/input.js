// Keyboard and mouse, and the pointer lock that turns the mouse into
// look. Browser APIs only, no libraries. Firing is edge-triggered for
// semi-auto guns and held for automatics; main.js asks which it needs.
// Number keys, E, G, B, R and friends are read as a Set of codes by the
// simulation, never as events.
export function createControls(canvas, onCaptureChange) {
  const held = new Set();
  const tapped = new Set(); // edge-triggered keys, drained by main.js
  const state = {
    held,
    captured: false,
    trigger: false,
    yawDelta: 0,
    pitchDelta: 0,
    scoping: false,
  };

  function track(event, down) {
    if (down) {
      if (!held.has(event.code)) tapped.add(event.code);
      held.add(event.code);
    } else {
      held.delete(event.code);
    }
    if (event.code === 'Space') event.preventDefault();
  }

  function releaseAll() {
    held.clear();
    state.trigger = false;
    state.scoping = false;
  }

  window.addEventListener('keydown', (event) => track(event, true));
  window.addEventListener('keyup', (event) => track(event, false));
  window.addEventListener('blur', () => {
    held.clear();
    state.trigger = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.captured) return;
    state.yawDelta += event.movementX;
    state.pitchDelta += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.captured) return;
    if (event.button === 0) state.trigger = true;
    if (event.button === 2) state.scoping = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.trigger = false;
    if (event.button === 2) state.scoping = false;
  });
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.captured = document.pointerLockElement === canvas;
    if (!state.captured) releaseAll();
    onCaptureChange(state.captured);
  });

  return {
    state,
    capturePointer() {
      canvas.requestPointerLock();
    },
    drainLook() {
      const x = state.yawDelta;
      const y = state.pitchDelta;
      state.yawDelta = 0;
      state.pitchDelta = 0;
      return { x, y };
    },
    // True once per physical press; main.js drains these every fixed step.
    wasTapped(code) {
      if (!tapped.has(code)) return false;
      tapped.delete(code);
      return true;
    },
  };
}
