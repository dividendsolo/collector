# Every machine is read by a script sent over ssh

Everything the page shows about another machine comes from one standard-library Python script that is sent over
ssh and run there: nothing is installed, nothing stays behind, and the script only reads. The machine needs no
agent to install or keep in step, and no version to match the page's; a machine that cannot answer reads as an
empty one rather than as an error.

The trade-off is time and reach. Every read pays for its own process, and the script can only ask the machine
questions its own tools already answer — which is why each read falls back to an empty row when a tool is missing,
and why nothing about a machine is ever written from here.
