// hardware.mjs — thin wrapper over R1 hardware events with browser fallbacks.
// Ported from pitch-tracker-r1. R1 SDK fires: scrollUp / scrollDown (wheel),
// sideClick + longPressStart/longPressEnd (side button). In a normal browser
// arrow keys / Enter / 'm' map to the same actions for dev.

export function bindHardware({ onScrollUp, onScrollDown, onSideClick, onLongPress }) {
  const w = window;

  // R1 native events
  w.addEventListener('scrollUp', () => onScrollUp && onScrollUp());
  w.addEventListener('scrollDown', () => onScrollDown && onScrollDown());
  w.addEventListener('sideClick', () => onSideClick && onSideClick());

  // long-press: SDK emits longPressStart/longPressEnd; treat a held side button as menu
  let lpTimer = null;
  w.addEventListener('longPressStart', () => {
    lpTimer = setTimeout(() => { onLongPress && onLongPress(); lpTimer = null; }, 400);
  });
  w.addEventListener('longPressEnd', () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } });

  // --- browser dev fallbacks ---
  w.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowUp':   onScrollUp && onScrollUp(); break;
      case 'ArrowDown': onScrollDown && onScrollDown(); break;
      case 'Enter':     onSideClick && onSideClick(); break;   // undo
      case 'm': case 'M': onLongPress && onLongPress(); break; // menu
    }
  });
}
