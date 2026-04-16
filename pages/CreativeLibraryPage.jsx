import CreativeCard from "../components/CreativeCard.jsx";
import FilterBar from "../components/FilterBar.jsx";

export default function CreativeLibraryPage({
  creatives,
  filters,
  onFiltersChange,
  creativeError,
  onDownload,
  onDelete,
}) {
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
            {creatives.map((creative) => (
              <CreativeCard
                key={creative.id}
                creative={creative}
                actions={
                  <>
                    <button className="button button--ghost" onClick={() => onDownload(creative)}>
                      Download Reel
                    </button>
                    <button className="button button--danger" onClick={() => onDelete(creative.id)}>
                      Delete
                    </button>
                  </>
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
