# A hand-kept list is a plain file beside the config, and a write never starts from a guess

The lists the owner keeps by hand — client proposals, the read and archived flags on Briefs, the projects list —
live in plain files beside the config on the machine the page runs on. There is no database, so one of those files
is the only copy, which is why a write goes through a temp file and a rename, and why a file that does not parse or
holds a row the schema refuses makes every write fail with the reason naming the file rather than starting from an
empty list. A file the reader cannot read leaves the page showing what it has.

The trade-off is the usual one against a database: no transactions, no query language and no backup of its own, in
exchange for files the owner can read and edit by hand, that stay out of a public repository, and that cost nothing
to keep.
