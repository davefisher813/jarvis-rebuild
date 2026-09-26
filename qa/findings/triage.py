"""Fold a fix-sweep workflow result into the saved sweep.

  python3 qa/findings/triage.py <workflow-output-file> [--apply]

Prints what the run applied, rejected, reworded, deferred to Dave, pushed to
another file, or found blocked by a law, plus every reviewer issue. With
--apply, writes the statuses back into 2026-09-22-colour-key-sweep.json and
appends rewordings to rewordings.json (the list Dave is shown at the end).
"""
import json, sys, re, collections
path = sys.argv[1]; apply = "--apply" in sys.argv
doc = json.load(open(path)); res = doc.get("result", doc)
F = json.load(open("qa/findings/2026-09-22-colour-key-sweep.json")); byid = {f["id"]: f for f in F}
c = collections.Counter(); out = collections.defaultdict(list)
for r in res.get("reports", []):
    for k in ("applied","rejected","reworded","needs_dave","needs_other_file","blocked_by_law"):
        for x in r.get(k, []): c[k]+=1; out[k].append({**x, "group": r.get("label")})
print("phase:", res.get("phase"), "| dead groups:", res.get("deadGroups"))
print(dict(c))
for k in ("needs_dave","needs_other_file","blocked_by_law"):
    for x in out[k]: print(f"  [{k}] #{x.get('id')} {x.get('file','')} :: {(x.get('question') or x.get('change') or x.get('why') or '')[:260]}")
iss = res.get("issues", [])
print("reviewer issues:", len(iss), dict(collections.Counter(x.get("severity") for x in iss)))
for x in iss:
    if x.get("severity") in ("breaks","wrong"):
        print(f"  [{x['severity']}] {x.get('file')}:{x.get('line','')} {x.get('problem','')[:280]}")
        if x.get("fix"): print(f"      fix: {x['fix'][:240]}")
if apply:
    for x in out["applied"]:
        if x.get("id") in byid: byid[x["id"]]["status"]="done"
    for x in out["rejected"]:
        if x.get("id") in byid and byid[x["id"]]["status"]!="done":
            byid[x["id"]]["status"]="rejected"; byid[x["id"]]["status_note"]=x.get("reason","")[:400]
    for x in out["needs_dave"]:
        if x.get("id") in byid and byid[x["id"]]["status"]=="pending":
            byid[x["id"]]["status"]="needs_dave"; byid[x["id"]]["status_note"]=x.get("question","")[:600]
    json.dump(F, open("qa/findings/2026-09-22-colour-key-sweep.json","w"), indent=1)
    # Every question for Dave, even on a finding that was partly applied.
    try: Q = json.load(open("qa/findings/dave-queue.json"))
    except FileNotFoundError: Q = []
    have = {(q.get("id"), q.get("question")) for q in Q}
    Q += [{**x, "phase": res.get("phase")} for x in out["needs_dave"] if (x.get("id"), x.get("question")) not in have]
    json.dump(Q, open("qa/findings/dave-queue.json","w"), indent=1)
    try: R = json.load(open("qa/findings/rewordings.json"))
    except FileNotFoundError: R = []
    R += [{**x, "phase": res.get("phase")} for x in out["reworded"]]
    json.dump(R, open("qa/findings/rewordings.json","w"), indent=1)
    print("applied to sweep:", collections.Counter(f["status"] for f in F))
