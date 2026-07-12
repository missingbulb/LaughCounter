"""End-to-end tests driving the CLI with the dependency-free path."""

import json

from laughcounter import stats
from laughcounter.cli import main
from laughcounter.config import Config
from laughcounter.storage import Storage


def test_simulate_creates_events(tmp_path, capsys):
    rc = main(["--home", str(tmp_path), "simulate", "-n", "8", "--seed", "7"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "Simulated 8 laugh" in out

    cfg = Config.load(home=tmp_path)
    store = Storage(cfg.db_path)
    assert store.count() == 8
    store.close()


def test_stats_json(tmp_path):
    main(["--home", str(tmp_path), "simulate", "-n", "4", "--seed", "1"])
    rc = main(["--home", str(tmp_path), "stats", "--json"])
    assert rc == 0


def test_export_json_and_csv(tmp_path, capsys):
    main(["--home", str(tmp_path), "simulate", "-n", "3", "--seed", "2"])
    capsys.readouterr()  # clear

    main(["--home", str(tmp_path), "export", "--format", "json"])
    data = json.loads(capsys.readouterr().out)
    assert len(data) == 3
    assert {"start_ts", "duration", "source"} <= set(data[0])

    main(["--home", str(tmp_path), "export", "--format", "csv"])
    csv_out = capsys.readouterr().out
    assert csv_out.splitlines()[0].startswith("id,start_ts")
    assert len(csv_out.strip().splitlines()) == 4  # header + 3 rows


def test_log(tmp_path, capsys):
    main(["--home", str(tmp_path), "simulate", "-n", "2", "--seed", "3"])
    capsys.readouterr()
    main(["--home", str(tmp_path), "log", "-n", "5"])
    out = capsys.readouterr().out
    assert "peak" in out


def test_service_prints_launchd_plist(tmp_path, capsys):
    rc = main(["--home", str(tmp_path), "service"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "com.laughcounter.listen" in out
    assert "<key>RunAtLoad</key>" in out
    assert "listen" in out


def test_config_init(tmp_path, capsys):
    rc = main(["--home", str(tmp_path), "config", "--init"])
    assert rc == 0
    assert (tmp_path / "config.json").exists()
    out = capsys.readouterr().out
    assert "enter_threshold" in out


def test_mark_reject_who_flow(tmp_path, capsys):
    home = str(tmp_path)
    main(["--home", home, "simulate", "-n", "3", "--seed", "1"])
    capsys.readouterr()

    # "I just laughed" with no live detection → logs a missed laugh.
    rc = main(["--home", home, "mark"])
    assert rc == 0
    assert "missed" in capsys.readouterr().out.lower()

    store = Storage(Config.load(home=tmp_path).db_path)
    rows = store.recent(10)
    first_id = rows[-1]["id"]
    store.close()

    # Reject a laugh, then correct another's speaker.
    rc = main(["--home", home, "reject", str(first_id)])
    assert rc == 0
    capsys.readouterr()
    rc = main(["--home", home, "who", str(first_id), "guest"])
    assert rc == 0

    store = Storage(Config.load(home=tmp_path).db_path)
    row = store.get(first_id)
    store.close()
    assert row["label"] == "rejected"
    assert row["speaker"] == "guest"


def test_reject_missing_id_fails(tmp_path, capsys):
    rc = main(["--home", str(tmp_path), "reject", "999"])
    assert rc == 1


def test_simulate_zero_count_errors(tmp_path):
    assert main(["--home", str(tmp_path), "simulate", "-n", "0"]) == 2


def test_simulate_too_dense_errors(tmp_path):
    # Far too many laughs to fit one day cleanly → friendly error, no crash/leak.
    assert main(["--home", str(tmp_path), "simulate", "-n", "100000", "--days", "1"]) == 2


def test_simulate_is_deterministic(tmp_path):
    # Two runs with the same seed produce the same laughter *pattern*. Absolute
    # timestamps are anchored to wall-clock "now" (which differs between runs),
    # so we compare the seeded structure: inter-laugh gaps and durations.
    main(["--home", str(tmp_path / "a"), "simulate", "-n", "6", "--seed", "42"])
    main(["--home", str(tmp_path / "b"), "simulate", "-n", "6", "--seed", "42"])
    a = Storage(Config.load(home=tmp_path / "a").db_path)
    b = Storage(Config.load(home=tmp_path / "b").db_path)
    rows_a, rows_b = a.all(), b.all()
    a.close()
    b.close()

    def gaps(rows):
        starts = [r["start_ts"] for r in rows]
        return [round(y - x, 6) for x, y in zip(starts, starts[1:])]

    def durs(rows):
        return [round(r["duration"], 6) for r in rows]

    assert len(rows_a) == len(rows_b) == 6
    assert gaps(rows_a) == gaps(rows_b)
    assert durs(rows_a) == durs(rows_b)
