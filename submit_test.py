"""Real registration for one saved car. Usage: python3 submit_test.py PLATE STATE MAKE MODEL COLOR EMAIL"""
import json, sys, worker
p, s, mk, md, c, em = sys.argv[1:7]
r = worker.register({"plate": p, "state": s, "make": mk, "model": md, "color": c}, em)
print(json.dumps(r, indent=1))
