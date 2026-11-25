# Collector is one local page for one person

Collector has no database, no auth and no hosted service: it runs from one checkout on one of the owner's own
machines and listens on loopback. What it shows is his own private state — host names, open ports, keys, client
proposals — so a hosted dashboard would mean handing that to a third party and paying for it, which the project's
own goal rules out: a solo developer owns their own stack, free or as cheap as it can be, with credentials staying
on machines they own.

The cost is access. The only way in besides the machine itself is the tailnet, which is what the phone uses, and
that in turn fixed the security model (see ADR 0003).
