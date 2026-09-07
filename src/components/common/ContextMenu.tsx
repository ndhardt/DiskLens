import { useDismiss } from "../../lib/hooks";

export interface MenuAction {
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  onPick: () => void;
}

export interface MenuState {
  x: number;
  y: number;
  actions: (MenuAction | "sep")[];
}

export function ContextMenu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useDismiss(true, onClose);
  const width = 224;
  const height = state.actions.length * 26 + 20;
  const left = Math.min(state.x, window.innerWidth - width - 8);
  const top = Math.min(state.y, window.innerHeight - height - 8);

  return (
    <div className="popover" style={{ left, top, width }} ref={ref} role="menu">
      {state.actions.map((a, i) =>
        a === "sep" ? (
          <div className="menu-sep" key={`s${i}`} />
        ) : (
          <button
            key={a.label}
            className={a.danger ? "menu-item menu-item--danger" : "menu-item"}
            disabled={a.disabled}
            title={a.title}
            onClick={() => {
              onClose();
              a.onPick();
            }}
          >
            {a.label}
            {a.shortcut && <span className="menu-item__key">{a.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
