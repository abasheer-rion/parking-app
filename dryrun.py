"""Walks the real form up to the Contact step and fills the email, but never clicks Next there.
Usage: python3 dryrun.py PLATE STATE MAKE MODEL COLOR EMAIL"""
import sys, worker
p, s, mk, md, c, em = sys.argv[1:7]
print(worker.register({"plate": p, "state": s, "make": mk, "model": md, "color": c}, em, dry_run=True))
