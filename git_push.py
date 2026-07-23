import subprocess, sys
os.chdir("/Users/hunterhughes/.reasonix/global-workspace/Job-Board")
cmds = [
    ["git", "add", "-A"],
    ["git", "commit", "-m", "Initial commit: Bulk Jobs — remote job board aggregator\n\n- 8 ATS fetchers: Greenhouse, Lever, Ashby, Workable, Breezy, Recruitee, SmartRecruiters, Personio\n- ~240 curated companies across business, research, economics, writing, data, climate, finance\n- Keyword scoring engine personalized for Hunter Hughes\n- D1 database schema with deduplication\n- Clean utility frontend with filters\n- Cloudflare Worker with daily cron trigger\n- GitHub Actions CI/CD for auto-deploy"],
    ["git", "push", "-u", "origin", "main", "--force"],
]
for cmd in cmds:
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(f"> {' '.join(cmd)}")
    print(r.stdout)
    if r.stderr: print(r.stderr, file=sys.stderr)
    if r.returncode != 0:
        print(f"FAILED with code {r.returncode}")
