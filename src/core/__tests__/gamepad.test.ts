import { describe, expect, it } from 'vitest';

import { GAMEPAD_BUTTON, blankSnapshot, detectGamepadActions } from '../gamepad';
import type { GamepadSnapshot } from '../gamepad';

/** Snapshot with the given button indices pressed. */
function pressed(...indices: number[]): GamepadSnapshot {
  const snapshot = blankSnapshot();
  for (const index of indices) {
    snapshot.buttons[index] = true;
  }
  return snapshot;
}

/** Snapshot with the given axes. */
function withAxes(axes: number[]): GamepadSnapshot {
  return { ...blankSnapshot(), axes };
}

const blank = blankSnapshot();

describe('detectGamepadActions', () => {
  it('maps the A button to activate on a rising edge', () => {
    expect(detectGamepadActions(pressed(GAMEPAD_BUTTON.A), blank)).toContain('activate');
  });

  it('does not repeat an action while the button is held', () => {
    const held = pressed(GAMEPAD_BUTTON.A);
    expect(detectGamepadActions(held, held)).toEqual([]);
  });

  it('maps the D-pad to directional actions', () => {
    expect(detectGamepadActions(pressed(GAMEPAD_BUTTON.DPAD_UP), blank)).toContain('up');
    expect(detectGamepadActions(pressed(GAMEPAD_BUTTON.DPAD_DOWN), blank)).toContain('down');
    expect(detectGamepadActions(pressed(GAMEPAD_BUTTON.DPAD_LEFT), blank)).toContain('left');
    expect(detectGamepadActions(pressed(GAMEPAD_BUTTON.DPAD_RIGHT), blank)).toContain('right');
  });

  it('maps the left stick past the deadzone to a direction, once', () => {
    const right = withAxes([0.9, 0]);
    expect(detectGamepadActions(right, blank)).toContain('right');
    expect(detectGamepadActions(right, right)).toEqual([]);
  });

  it('maps shoulder buttons and Start to navigation actions', () => {
    expect(detectGamepadActions(pressed(GAMEPAD_BUTTON.LB), blank)).toContain('toggle-tasks');
    expect(detectGamepadActions(pressed(GAMEPAD_BUTTON.RB), blank)).toContain('toggle-notes');
    expect(detectGamepadActions(pressed(GAMEPAD_BUTTON.START), blank)).toContain('omnibar');
    expect(detectGamepadActions(pressed(GAMEPAD_BUTTON.B), blank)).toContain('back');
  });

  it('returns no actions when nothing changed', () => {
    expect(detectGamepadActions(blank, blank)).toEqual([]);
  });
});
