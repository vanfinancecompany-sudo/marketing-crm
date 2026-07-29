# Wix sync safety boundary

The deactivation pass runs only after the complete Wix LIVE collection request succeeds and returns a valid `dataItems` array for every page. A provider error, permission error, network error or malformed response exits before any record can be marked inactive.
