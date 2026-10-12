#!/usr/bin/env python3
"""Aggregate Claude Code usage from local transcripts.

Reads the JSONL transcripts Claude Code writes under <config dir>/projects and
prints one JSON object: API-equivalent cost for the session, its last turn and
this month, tokens per day this month, and what a cache miss would cost.

Standard library only. No network access. Usage: usage.py <session-id>
"""

import calendar
import datetime
import json
import os
import re
import sys

# API-equivalent prices in USD per million tokens: (input, output, cache read).
# Cache writes are priced from input: 5-minute TTL = 1.25x, 1-hour TTL = 2x.
# A model matches its own ID, a dated snapshot of it (-YYYYMMDD) or a [suffix]; any other
# model is reported as unpriced ("?") rather than guessed. Update PRICES_AS_OF when editing:
# the parse cache stores computed costs and is keyed on it, so a new date re-reads everything.
PRICES_AS_OF = '2026-09-25'
PRICES = {
    'claude-fable-5-1': (10, 50, 0.25), 'claude-mythos-5-1': (10, 50, 0.25),
    'claude-fable-5': (10, 50, 1.0), 'claude-mythos-5': (10, 50, 1.0),
    'claude-opus-5-5': (4, 20, 0.20), 'claude-opus-5': (5, 25, 0.5),
    'claude-opus-4-8': (5, 25, 0.5), 'claude-opus-4-7': (5, 25, 0.5), 'claude-opus-4-6': (5, 25, 0.5),
    'claude-sonnet-5-5': (2, 10, 0.20), 'claude-sonnet-5': (2, 10, 0.20), 'claude-sonnet-4-6': (3, 15, 0.3),
    'claude-haiku-4-5': (1, 5, 0.1),
}
MODEL_ID = re.compile(r'(claude-[a-z]+-\d+(?:-\d)?)(?:-\d{8})?(?:\[.*\])?$')

# 5: each response also carries what went to re-reading the context (pixel-pet's copy only;
# its parse cache has a file name of its own, so the statusline's copy never reads it).
CACHE_VERSION = 5


def price(model):
    m = MODEL_ID.match(model or '')
    return PRICES.get(m.group(1)) if m else None


def cost(p, u):
    """API-equivalent cost of one response at prices p, or None when the model is unpriced."""
    if p is None:
        return None
    i, o, r = p
    cc = u.get('cache_creation') or {}
    w1h = cc.get('ephemeral_1h_input_tokens') or 0
    w5m = cc.get('ephemeral_5m_input_tokens')
    if w5m is None:
        w5m = (u.get('cache_creation_input_tokens') or 0) - w1h
    usd = ((u.get('input_tokens') or 0) * i + (u.get('output_tokens') or 0) * o
           + (u.get('cache_read_input_tokens') or 0) * r + w5m * i * 1.25 + w1h * i * 2) / 1e6
    return usd * 2 if u.get('speed') == 'fast' else usd


# A gap after which the cache may have expired: the 5-minute TTL's (the 1-hour one's gaps are
# caught too, and while a cache is still warm the write stays small, so nothing is counted).
REBUILD_GAP_S = 300


def overhead(p, u, prev):
    """What one response spent on the context it already had, at prices p: re-reading it from the
    cache, plus re-writing it after the cache expired. prev is the same transcript's previous
    response as (timestamp, context tokens, this response's timestamp), or None for its first.
    A rebuild is a write of at least half the previous context, with less than half of it read
    back, after a gap the cache may not have outlived; the system prompt's prefix usually
    survives, so a small read does not rule it out, and a large one (a long tool run's results
    added to a warm cache) rules it in no more."""
    if p is None:
        return None
    i, _o, r = p
    read = (u.get('cache_read_input_tokens') or 0)
    written = u.get('cache_creation_input_tokens') or 0
    w1h = (u.get('cache_creation') or {}).get('ephemeral_1h_input_tokens') or 0
    rebuild = 0.0
    if prev is not None:
        prev_ts, prev_ctx, ts = prev
        if ts - prev_ts > REBUILD_GAP_S and prev_ctx > 0 and written >= 0.5 * prev_ctx and read < 0.5 * prev_ctx:
            rebuild = (w1h * i * 2 + (written - w1h) * i * 1.25) / 1e6
    usd = read * r / 1e6 + rebuild
    return usd * 2 if u.get('speed') == 'fast' else usd


def is_prompt(o):
    """A message the person typed: not a tool result, not harness-injected, not a compaction summary."""
    if o.get('type') != 'user' or o.get('isMeta') or o.get('isCompactSummary'):
        return False
    c = (o.get('message') or {}).get('content')
    if isinstance(c, str):
        return True
    return isinstance(c, list) and not any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in c)


def stamp(o):
    try:
        return datetime.datetime.fromisoformat((o.get('timestamp') or '').replace('Z', '+00:00')).timestamp()
    except ValueError:
        return None


def parse(path):
    """One transcript -> responses [[key, ts, tokens, usd|None, context tokens, input price|None,
    overhead usd|None]],
    prompt timestamps and compaction timestamps."""
    recs, prompts, compacts = [], [], []
    prev = None  # the previous response's (timestamp, context tokens)
    with open(path, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            if '"usage"' not in line and '"user"' not in line and 'compact_boundary' not in line:
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            t = stamp(o)
            if t is None:
                continue
            if o.get('type') == 'system' and o.get('subtype') == 'compact_boundary':
                compacts.append(t)
                continue
            if is_prompt(o):
                prompts.append(t)
                continue
            m = o.get('message')
            if o.get('type') != 'assistant' or not isinstance(m, dict) or not isinstance(m.get('usage'), dict):
                continue
            u = m['usage']
            n = sum(u.get(k) or 0 for k in ('input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'))
            if n == 0:
                continue  # synthetic messages
            ctx = (u.get('input_tokens') or 0) + (u.get('cache_creation_input_tokens') or 0) + (u.get('cache_read_input_tokens') or 0)
            p = price(m.get('model'))
            usd = cost(p, u)
            recs.append([f"{m.get('id')}|{o.get('requestId')}", t, n,
                         None if usd is None else round(usd, 6), ctx, p[0] if p else None,
                         None if usd is None else round(overhead(p, u, None if prev is None else (prev[0], prev[1], t)), 6)])
            prev = (t, ctx)
    return {'recs': recs, 'prompts': prompts, 'compacts': compacts}


def main():
    sid = sys.argv[1] if len(sys.argv) > 1 else ''
    config_dir = os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude')
    root = os.path.join(config_dir, 'projects')
    cache_dir = os.path.join(os.environ.get('XDG_CACHE_HOME') or os.path.expanduser('~/.cache'), 'cc-desktop-statusline')
    cache_path = os.path.join(cache_dir, f'pixel-pet-usage-v{CACHE_VERSION}-{PRICES_AS_OF}.json')

    # The 1st of the month at local midnight, with the UTC offset in force on that date (DST-safe).
    today = datetime.date.today()
    month_start = datetime.datetime(today.year, today.month, 1).astimezone().timestamp()
    now = datetime.datetime.now().astimezone()
    week_start = now.timestamp() - 7 * 86400

    try:
        with open(cache_path) as fh:
            cache = json.load(fh)
    except (OSError, ValueError):
        cache = {}

    files = {}
    for dp, _, fs in os.walk(root):
        for f in fs:
            if f.endswith('.jsonl'):
                p = os.path.join(dp, f)
                try:
                    st = os.stat(p)
                except OSError:
                    continue
                if st.st_mtime >= min(month_start, week_start) or (sid and sid in p):
                    files[p] = st

    # Re-read only files whose size or mtime changed since the last run.
    fresh = {}
    for p, st in files.items():
        sig = f'{st.st_mtime_ns}:{st.st_size}'
        hit = cache.get(p)
        if hit is not None and hit[0] == sig:
            fresh[p] = hit
        else:
            try:
                fresh[p] = [sig, parse(p)]
            except OSError:
                pass

    try:
        os.makedirs(cache_dir, exist_ok=True)
        tmp = f'{cache_path}.{os.getpid()}.tmp'
        with open(tmp, 'w') as fh:
            json.dump(fresh, fh)
        os.replace(tmp, cache_path)
    except OSError:
        pass

    usd = {'session': 0.0, 'last': 0.0, 'month': 0.0}
    unpriced = {k: False for k in usd}
    daily = [0] * calendar.monthrange(today.year, today.month)[1]

    # The session's own transcript (not its subagents') marks where the last turn began: the latest
    # prompt that got an answer. An interrupt or a local command after it does not start a new turn.
    main_files = [p for p in fresh if sid and os.path.basename(p) == sid + '.jsonl']
    latest = max((r for p in main_files for r in fresh[p][1]['recs']), key=lambda r: r[1], default=None)
    last_prompt = None
    if latest is not None:
        last_prompt = max((t for p in main_files for t in fresh[p][1]['prompts'] if t <= latest[1]), default=None)
    last_compact = max((t for p in main_files for t in fresh[p][1]['compacts']), default=None)

    def add(period, value):
        if value is None:
            unpriced[period] = True
        else:
            usd[period] += value

    week = [0.0, 0.0]  # the last 7 days: cost, overhead
    seen = set()
    # Count this session's files first, so history copied into a resumed session is not counted twice.
    for p in sorted(fresh, key=lambda p: not (sid and sid in p)):
        mine = bool(sid) and sid in p
        for key, t, n, cst, _ctx, _inp, over in fresh[p][1]['recs']:
            if key in seen:
                continue
            seen.add(key)
            if mine:
                add('session', cst)
                if last_prompt is not None and t >= last_prompt:
                    add('last', cst)
            if t >= week_start and cst is not None and over is not None:
                week[0] += cst
                week[1] += over
            if t >= month_start:
                add('month', cst)
                daily[datetime.datetime.fromtimestamp(t).day - 1] += n

    # Cache miss: writing the latest request's whole context back as a 1-hour cache entry (2x input).
    # Unknown (None) when the model is unpriced, or after a compaction until the next response.
    miss = None
    if latest is not None and latest[5] is not None and not (last_compact and last_compact > latest[1]):
        miss = latest[4] * latest[5] * 2 / 1e6

    print(json.dumps({
        'usd': usd, 'unpriced': unpriced,
        'daily': daily, 'day': today.day, 'month': today.month,
        'tzOffsetSec': int(now.utcoffset().total_seconds()),
        'cache': {'lastTs': latest[1] if latest else None, 'miss': miss},
        # The share of the last 7 days' cost that went to new work (input and output), not to
        # re-reading the context; None with nothing spent.
        'efficiency': (week[0] - week[1]) / week[0] if week[0] > 0 else None,
    }))


if __name__ == '__main__':
    main()
