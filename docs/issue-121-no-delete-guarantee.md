# No-delete guarantee

Issue 121 changes current publication lifecycle fields on `knowledge_articles` only. Existing rows in `knowledge_visibility_results` and audit history are not deleted, truncated or overwritten by the Wix lifecycle sync.
