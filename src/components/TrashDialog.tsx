import { bytes, unusedFor } from "../lib/format";
import type { TrashPreview } from "../lib/types";

interface Props {
  preview: TrashPreview;
  now: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation before anything moves.
 *
 * Deleting is always "move to Trash", never unlink, and the dialog states the
 * size and how long the item has gone untouched — the two facts that decide it.
 */
export function TrashDialog({ preview, now, busy, onCancel, onConfirm }: Props) {
  const single = preview.items.length === 1 ? preview.items[0] : null;
  const movable = preview.count - preview.blocked;
  const protectedCount = preview.items.filter((i) => i.protected && !i.immutable).length;

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal__body">
          {single ? (
            <>
              <h2 className="modal__title">Move “{single.name}” to Trash?</h2>
              <div className="modal__stat num">{bytes(single.size, 1)}</div>
              <div className="modal__text">
                {single.lastUsed
                  ? `Last used ${unusedFor(single.lastUsed, now)} ago`
                  : "Usage date unknown"}
              </div>
            </>
          ) : (
            <>
              <h2 className="modal__title">
                Move {movable.toLocaleString()} item{movable === 1 ? "" : "s"} to Trash?
              </h2>
              <div className="modal__stat num">{bytes(preview.totalSize, 1)} total</div>
              <div className="modal__list">
                {preview.items.slice(0, 200).map((it) => (
                  <div className="modal__list-row" key={it.path}>
                    <span className="modal__list-name" title={it.path}>
                      {it.name}
                    </span>
                    <span className="modal__list-size num">{bytes(it.size)}</span>
                  </div>
                ))}
                {preview.items.length > 200 && (
                  <div className="modal__list-row">
                    <span className="modal__list-name">
                      …and {(preview.items.length - 200).toLocaleString()} more
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          {preview.blocked > 0 && (
            <div className="modal__note">
              {preview.blocked} item{preview.blocked === 1 ? "" : "s"} belong to macOS and will be
              skipped.
            </div>
          )}
          {protectedCount > 0 && (
            <div className="modal__note">
              {protectedCount} item{protectedCount === 1 ? " is" : "s are"} inside a system or
              shared library folder. Applications may stop working without them.
            </div>
          )}
          <div className="modal__text" style={{ marginTop: 10, color: "var(--text-muted)" }}>
            Items go to the Trash and can be put back from the Finder.
          </div>
        </div>
        <div className="modal__actions">
          <button className="ctl" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="ctl ctl--danger" onClick={onConfirm} disabled={busy || movable === 0}>
            {busy ? "Moving…" : "Move to Trash"}
          </button>
        </div>
      </div>
    </div>
  );
}
