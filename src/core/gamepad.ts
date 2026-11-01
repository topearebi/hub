/**
 * Hub Gamepad Navigation
 * ----------------------
 * Maps a standard-mapping gamepad to abstract navigation actions. The mapping
 * (`detectGamepadActions`) is a pure function so it is unit-testable; the
 * `GamepadNavigator` class only wires `requestAnimationFrame` polling to it.
 *
 * Disabled gameplay-safe: the navigator only consumes gamepads from
 * `navigator.getGamepads()` and no-ops when the API is unavailable.
 */

/** Abstract actions the app understands. */
export type GamepadAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'activate'
  | 'back'
  | 'omnibar'
  | 'toggle-tasks'
  | 'toggle-notes';

/** Standard-mapping button indices (W3C Gamepad spec). */
export const GAMEPAD_BUTTON = {
  A: 0,
  B: 1,
  Y: 3,
  LB: 4,
  RB: 5,
  BACK: 8,
  START: 9,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

/** Analogue stick threshold for treating an axis as a directional press. */
export const AXIS_THRESHOLD = 0.5;

/** Normalised, DOM-free snapshot of a gamepad's digital input. */
export interface GamepadSnapshot {
  buttons: boolean[];
  axes: number[];
}

/** An empty snapshot (no buttons pressed, axes centred). */
export function blankSnapshot(): GamepadSnapshot {
  return { buttons: new Array<boolean>(17).fill(false), axes: [0, 0] };
}

/** Convert a live `Gamepad` into a DOM-free snapshot. */
export function snapshotFrom(gamepad: Gamepad): GamepadSnapshot {
  return {
    buttons: gamepad.buttons.map((button) => button.pressed || button.value > 0.5),
    axes: Array.from(gamepad.axes),
  };
}

function axisDirection(snapshot: GamepadSnapshot, axis: number, sign: 1 | -1): boolean {
  const value = snapshot.axes[axis] ?? 0;
  return sign > 0 ? value > AXIS_THRESHOLD : value < -AXIS_THRESHOLD;
}

/** Rising-edge detection for a digital button. */
function pressedEdge(current: GamepadSnapshot, previous: GamepadSnapshot, index: number): boolean {
  return Boolean(current.buttons[index]) && !previous.buttons[index];
}

/** Rising-edge detection for an analogue direction. */
function axisEdge(
  current: GamepadSnapshot,
  previous: GamepadSnapshot,
  axis: number,
  sign: 1 | -1,
): boolean {
  return axisDirection(current, axis, sign) && !axisDirection(previous, axis, sign);
}

/**
 * Diff two gamepad snapshots and return the actions triggered by rising edges.
 * Rising-edge (rather than level) detection prevents a held stick/button from
 * firing the same action every frame.
 */
export function detectGamepadActions(
  current: GamepadSnapshot,
  previous: GamepadSnapshot,
): GamepadAction[] {
  const actions: GamepadAction[] = [];

  if (
    pressedEdge(current, previous, GAMEPAD_BUTTON.DPAD_UP) ||
    axisEdge(current, previous, 1, -1)
  ) {
    actions.push('up');
  }
  if (
    pressedEdge(current, previous, GAMEPAD_BUTTON.DPAD_DOWN) ||
    axisEdge(current, previous, 1, 1)
  ) {
    actions.push('down');
  }
  if (
    pressedEdge(current, previous, GAMEPAD_BUTTON.DPAD_LEFT) ||
    axisEdge(current, previous, 0, -1)
  ) {
    actions.push('left');
  }
  if (
    pressedEdge(current, previous, GAMEPAD_BUTTON.DPAD_RIGHT) ||
    axisEdge(current, previous, 0, 1)
  ) {
    actions.push('right');
  }
  if (pressedEdge(current, previous, GAMEPAD_BUTTON.A)) {
    actions.push('activate');
  }
  if (
    pressedEdge(current, previous, GAMEPAD_BUTTON.B) ||
    pressedEdge(current, previous, GAMEPAD_BUTTON.BACK)
  ) {
    actions.push('back');
  }
  if (
    pressedEdge(current, previous, GAMEPAD_BUTTON.Y) ||
    pressedEdge(current, previous, GAMEPAD_BUTTON.START)
  ) {
    actions.push('omnibar');
  }
  if (pressedEdge(current, previous, GAMEPAD_BUTTON.LB)) {
    actions.push('toggle-tasks');
  }
  if (pressedEdge(current, previous, GAMEPAD_BUTTON.RB)) {
    actions.push('toggle-notes');
  }

  return actions;
}

/** Whether the Gamepad API is available in this environment. */
export function isGamepadSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
}

export interface GamepadNavigatorOptions {
  /** Called for each action detected. */
  onAction: (action: GamepadAction) => void;
  /** Override the requestAnimationFrame hook (tests). */
  requestFrame?: (callback: () => void) => number;
  /** Override the cancellation hook (tests). */
  cancelFrame?: (handle: number) => void;
}

/** Polls connected gamepads and dispatches rising-edge actions. */
export class GamepadNavigator {
  private frameHandle: number | null = null;
  private previous: GamepadSnapshot = blankSnapshot();
  private readonly requestFrame: (callback: () => void) => number;
  private readonly cancelFrame: (handle: number) => void;

  constructor(private readonly options: GamepadNavigatorOptions) {
    this.requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  }

  start(): void {
    if (this.frameHandle !== null || !isGamepadSupported()) {
      return;
    }
    this.loop();
  }

  stop(): void {
    if (this.frameHandle !== null) {
      this.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.previous = blankSnapshot();
  }

  /** Exposed for tests: process a single live gamepad. */
  process(gamepad: Gamepad | null | undefined): GamepadAction[] {
    if (!gamepad || !gamepad.connected) {
      this.previous = blankSnapshot();
      return [];
    }
    const current = snapshotFrom(gamepad);
    const actions = detectGamepadActions(current, this.previous);
    this.previous = current;
    for (const action of actions) {
      this.options.onAction(action);
    }
    return actions;
  }

  private loop = (): void => {
    const gamepads = navigator.getGamepads();
    const gamepad = gamepads.find((pad): pad is Gamepad => Boolean(pad?.connected));
    this.process(gamepad);
    this.frameHandle = this.requestFrame(this.loop);
  };
}
