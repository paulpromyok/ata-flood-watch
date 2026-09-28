#!/usr/bin/env python3
"""Refuse to publish a fetch where every measured source failed (keeps the last good data)."""
import json, sys
d = json.load(open("data/latest.json", encoding="utf-8"))
ok = [s["id"] for s in d.get("sources", []) if s.get("ok") and s.get("kind") == "measured"]
if not ok:
    print("::warning::no measured source succeeded; keeping previous data")
    sys.exit(1)
print("measured sources ok:", ", ".join(ok))
