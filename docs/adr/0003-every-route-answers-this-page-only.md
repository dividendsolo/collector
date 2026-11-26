# Every route answers this page only

Collector listens on loopback, which keeps other machines out but not the browser the owner already has open, so
every route refuses any request whose `Host` is not a loopback name, and every write must come from this page
itself rather than from a page on another site.

The phone reads the same pages over Tailscale Serve, and a name under Tailscale's own domain with Tailscale's own
user header is the one other caller allowed. That name is deliberate: a page that rebinds its own domain to
127.0.0.1 can set a header, but it cannot set its `Host` to a name under Tailscale's domain.

**Consequences**: hiding a button is not a boundary, so the routes that act on a machine refuse the phone as well
as leaving the button off the page. Every write route calls the shared guard first, and a test lists the
state-changing routes by hand, so a new one has to be guarded on purpose.
