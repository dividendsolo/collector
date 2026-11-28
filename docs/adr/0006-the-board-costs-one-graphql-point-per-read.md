# The board is read at one GraphQL point per poll

The board is read through GitHub's GraphQL API, and one read costs one point. A page left open all day polls it, so
the point cost is a fixed budget rather than a detail: about 360 points an hour while a page is open, against an
account-wide hourly limit shared with every other tool the owner runs. That budget is why the queries are sized by
hand — every list is paged to a known count so the whole read stays under GitHub's own connection limit — and why
one card's journey walks its timeline one point at a time instead of asking for everything at once.

The trade-off is freshness and richness: a read that wanted more of the board at once would spend points the rest
of the machine does not have. This is the reason a query here is sized rather than written freely, and why the
point cost per read is a number to keep, not to improve.
