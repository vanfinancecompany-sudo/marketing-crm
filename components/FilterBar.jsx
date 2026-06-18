export default function FilterBar({
  filters,
  onChange,
  showStatus = false,
  showDestination = false,
  postingChannels = [],
}) {
  function update(field, value) {
    onChange({
      ...filters,
      [field]: value,
    });
  }

  return (
    <div className="filter-bar">
      <div className="segmented-control">
        {[
          ["all", "All"],
          ["vanFinance", "Van Finance"],
          ["rent2buy", "Rent2Buy"],
          ["cars", "Cars"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={filters.pipeline === value ? "segment is-active" : "segment"}
            onClick={() => update("pipeline", value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <input
        className="field__input"
        placeholder="Search reg, title, spec..."
        value={filters.search || ""}
        onChange={(event) => update("search", event.target.value)}
      />

      <input
        className="field__input"
        placeholder="Min price"
        inputMode="numeric"
        value={filters.minPrice || ""}
        onChange={(event) => update("minPrice", event.target.value)}
      />

      <input
        className="field__input"
        placeholder="Max price"
        inputMode="numeric"
        value={filters.maxPrice || ""}
        onChange={(event) => update("maxPrice", event.target.value)}
      />

      {showStatus ? (
        <select
          className="field__input"
          value={filters.status || "all"}
          onChange={(event) => update("status", event.target.value)}
        >
          <option value="all">All reel states</option>
          <option value="reel_asset">Reel assets</option>
          <option value="draft">Older reel assets</option>
        </select>
      ) : null}

      {showDestination ? (
        <select
          className="field__input"
          value={filters.destination || "all"}
          onChange={(event) => update("destination", event.target.value)}
        >
          <option value="all">All destinations</option>
          {postingChannels.map((channel) => (
            <option key={channel} value={channel}>
              {channel}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
