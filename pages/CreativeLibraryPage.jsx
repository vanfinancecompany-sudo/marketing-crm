import CreativeCard from "../components/CreativeCard.jsx";
import FilterBar from "../components/FilterBar.jsx";

export default function CreativeLibraryPage({
  creatives,
  filters,
  onFiltersChange,
  creativeError,
  onDownload,
  onRegenerateFacebookMp4,
  regeneratingCreativeId = "",
  regenerationStatuses = {},
  onDelete,
}) {
  const isRegenerating = Boolean(regeneratingCreativeId);

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Creative Library</h3>
            <p>Saved reel video library. These assets stay separate from stock posting queues.</p>
          </div>
          <span className="status-pill">{creatives.length} visible</span>
        </div>

        <FilterBar
          filters={filters}
          onChange={onFiltersChange}
        />

        {creativeError ? <div className="notice notice--error">{creativeError}</div> : null}

        {creatives.length === 0 ? (
          <div className="empty-state">No creatives have been generated yet.</div>
        ) : (
          <div className="creative-grid">
            {creatives.map((creative) => {
              const status = regenerationStatuses[creative.id];
              const isCurrent = regeneratingCreativeId === creative.id;

              return (
                <div className="creative-library-card-shell" key={creative.id}>
                  {isCurrent ? (
                    <div className="reel-conversion-overlay creative-regeneration-overlay">
                      <span className="loading-spinner" aria-hidden="true" />
                      <strong>Converting MP4...</strong>
                      <span>{status?.state || "Preparing"}</span>
                    </div>
                  ) : null}
                  <CreativeCard
                    creative={creative}
                    actions={
                      <>
                        <button className="button button--ghost" onClick={() => onDownload(creative)} disabled={isRegenerating}>
                          Download Reel
                        </button>
                        <button
                          className="button button--ghost"
                          onClick={() => onRegenerateFacebookMp4(creative)}
                          disabled={isRegenerating}
                        >
                          {isCurrent ? "Converting MP4... please wait" : "Regenerate Premium MP4"}
                        </button>
                        <button className="button button--danger" onClick={() => onDelete(creative.id)} disabled={isRegenerating}>
                          Delete
                        </button>
                        {status ? (
                          <div className="creative-regeneration-status">
                            <span className={`mp4-batch-status__state mp4-batch-status__state--${mp4StateClassName(status.state)}`}>
                              {status.state}
                            </span>
                            {status.error ? <span className="mp4-batch-status__error">{status.error}</span> : null}
                          </div>
                        ) : null}
                      </>
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function mp4StateClassName(state) {
  return String(state || "queued")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
