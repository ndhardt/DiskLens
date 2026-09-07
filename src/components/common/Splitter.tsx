import { useCallback, useRef, useState } from "react";

interface Props {
  orientation: "vertical" | "horizontal";
  onDelta: (deltaPx: number) => void;
  onDoubleClick?: () => void;
}

/** A 4px drag handle. Vertical splits columns; horizontal splits rows. */
export function Splitter({ orientation, onDelta, onDoubleClick }: Props) {
  const [active, setActive] = useState(false);
  const last = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      last.current = orientation === "vertical" ? e.clientX : e.clientY;
      setActive(true);

      const move = (ev: PointerEvent) => {
        const pos = orientation === "vertical" ? ev.clientX : ev.clientY;
        const d = pos - last.current;
        if (d !== 0) {
          last.current = pos;
          onDelta(d);
        }
      };
      const up = (ev: PointerEvent) => {
        setActive(false);
        el.releasePointerCapture(ev.pointerId);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    },
    [orientation, onDelta],
  );

  return (
    <div
      className={`splitter${orientation === "horizontal" ? " splitter--h" : ""}${
        active ? " splitter--active" : ""
      }`}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      role="separator"
      aria-orientation={orientation}
    />
  );
}
