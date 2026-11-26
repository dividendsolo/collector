# A change reaches the running page only through main

The running server serves a built release, never the source, so editing a checkout changes nothing that is being
served, and the one way a new release reaches it is a merge to main: a scheduled Job builds the merge, swaps the
build in and restarts onto it by itself. The by-hand pair this replaced — a build, then a kickstart — is what
restarted the page 46 times in one day, from whatever session was working in the checkout at the time.

So an agent works in its own worktree on its own port and leaves the served one alone, and the Job is bounded: at
most one restart per new commit on main, never two within five minutes, and a build that failed changes nothing at
all and restarts nothing.

**Considered options**: an Update button (removed) and a deploy step run by hand. Both put the restart in the hands
of whoever is working, which is what the 46 restarts were.

**Consequences**: the build goes to a second folder beside the served one and is swapped in only after a clean
exit, and each open page reloads itself when the server really comes back rather than when the build lands. A main
that will not build shows up as one failed line every five minutes, not as a silent old page.
