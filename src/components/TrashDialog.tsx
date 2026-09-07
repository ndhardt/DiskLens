import { bytes, unusedFor } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { TrashPreview } from "../lib/types";

interface Props {
  preview: TrashPreview;
  now: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation before anything moves. States the size and how long the item has
 * gone untouched, the two facts the decision turns on.
 */
export function TrashDialog({ preview, now, busy, onCancel, onConfirm }: Props) {
  const { t } = useI18n();
  const single = preview.items.length === 1 ? preview.items[0] : null;
  const movable = preview.count - preview.blocked;
  const protectedCount = preview.items.filter((i) => i.protected && !i.immutable).length;

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal__body">
          {single ? (
            <>
              <h2 className="modal__title">{t("trash.titleOne", { name: single.name })}</h2>
              <div className="modal__stat num">{bytes(single.size, 1)}</div>
              <div className="modal__text">
                {single.lastUsed
                  ? t("trash.lastUsed", { v: unusedFor(single.lastUsed, now, t) })
                  : t("trash.unknownUse")}
              </div>
            </>
          ) : (
            <>
              <h2 className="modal__title">
                {t("trash.titleMany", { n: movable.toLocaleString() })}
              </h2>
              <div className="modal__stat num">
                {t("trash.total", { size: bytes(preview.totalSize, 1) })}
              </div>
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
                      {t("trash.andMore", { n: (preview.items.length - 200).toLocaleString() })}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          {preview.blocked > 0 && (
            <div className="modal__note">{t("trash.blocked", { n: preview.blocked })}</div>
          )}
          {protectedCount > 0 && (
            <div className="modal__note">{t("trash.protected", { n: protectedCount })}</div>
          )}
          <div className="modal__text" style={{ marginTop: 10, color: "var(--text-muted)" }}>
            {t("trash.recoverable")}
          </div>
        </div>
        <div className="modal__actions">
          <button className="ctl" onClick={onCancel} disabled={busy}>
            {t("app.cancel")}
          </button>
          <button className="ctl ctl--danger" onClick={onConfirm} disabled={busy || movable === 0}>
            {busy ? t("trash.moving") : t("menu.trash")}
          </button>
        </div>
      </div>
    </div>
  );
}
