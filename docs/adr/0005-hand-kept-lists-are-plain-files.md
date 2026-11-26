# A hand-kept list is a plain file beside the config, and a write never starts from a guess

Two lists the owner keeps by hand, the client proposals and the read and archived flags on Briefs, live in plain
files beside the config on the machine the page runs on. There is no database, so one of those files is the only
copy, which is why a write goes through a temp file and a rename, and why a file that does not parse makes every
write fail with the reason naming the file rather than starting from an empty list. The proposals file also refuses
every write while it holds a row the schema refuses. A file the reader cannot read leaves the page showing what it
has.

The projects list does not keep this rule yet. It is the `projects` key inside `config.json` itself, not a file
beside it, and a save of the projects list writes `config.json` in place. When `config.json` does not parse and the
page holds no copy of it, that save starts from an empty config and writes only the projects list over the file.
The fix is collector#291.

The trade-off is the usual one against a database: no transactions, no query language and no backup of its own, in
exchange for files the owner can read and edit by hand, that stay out of a public repository, and that cost nothing
to keep.
