"""Contract tests: the fixture bundle validates, schemas are current, placeholders are honest."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
from common import contracts as C  # noqa: E402


def test_schemas_are_current(tmp_path):
    C.export_schemas(tmp_path)
    for f in tmp_path.glob("*.schema.json"):
        committed = ROOT / "contracts" / f.name
        assert committed.exists(), f"missing {committed}"
        assert json.loads(committed.read_text("utf-8")) == json.loads(f.read_text("utf-8")), \
            f"{f.name} is stale: run python pipeline/08_bundle.py --schemas"


def test_fixture_bundle_validates(tmp_path):
    # run the fixture into a temp bundle by pointing config at tmp
    import yaml
    cfg = yaml.safe_load((ROOT / "config.yaml").read_text("utf-8"))
    cfg["bundle"]["out"] = str(tmp_path / "bundle")
    cfgp = tmp_path / "config.yaml"
    cfgp.write_text(yaml.safe_dump(cfg), "utf-8")
    r = subprocess.run([sys.executable, str(ROOT / "pipeline/08_bundle.py"), "--fixture", "--config", str(cfgp)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_placeholders_are_illustrative():
    out = ROOT / "apps/web/public/data/2026-11-15"
    for name, rel in C.BUNDLE_PATHS.items():
        p = out / rel
        if not p.exists():
            continue
        d = json.loads(p.read_text("utf-8"))
        if d.get("placeholder"):
            assert d.get("badge", "ILLUSTRATIVE") == "ILLUSTRATIVE", f"{rel}: placeholder must be ILLUSTRATIVE"
    m = json.loads((out / "manifest.json").read_text("utf-8"))
    for layer in m["layers"]:
        if layer.get("placeholder"):
            assert layer["badge"] == "ILLUSTRATIVE", layer["id"]


def test_delta_volume_alias_roundtrip():
    dv = C.DeltaVolume.model_validate({"from": "2026-06-17", "to": "2026-07-01", "dV_m3": 1, "low": 0, "high": 2, "method": "A×Δh"})
    assert dv.model_dump(by_alias=True)["from"] == "2026-06-17"
