"""Data contracts for the web data bundle — the single source of truth.

pydantic models here  ->  contracts/*.schema.json (export_schemas)  ->  apps/web/src/data/schemas.gen.ts (codegen)

Every file the pipeline writes into apps/web/public/data/<version>/ is validated against one of these models
(see 08_bundle.py). Shapes follow docs/06_SYSTEM_DESIGN.md §3. Bump SCHEMA_VERSION on breaking changes.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = 1

Badge = Literal["MEASURED", "REPORTED", "MODELLED", "ILLUSTRATIVE"]
Confidence = Literal["high", "medium", "low"]
IsoDate = str  # "YYYY-MM-DD"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Provenance(Strict):
    """Honest metadata carried by every layer and number (docs/03 §1.4)."""
    badge: Badge
    source: str
    method: str = ""
    uncertainty: str = ""
    placeholder: bool = False


# ---------------------------------------------------------------- terrain/grid.json
class HeightEncoding(Strict):
    type: Literal["rg16"] = "rg16"
    scale: float = 0.1
    offset: float = -100.0


class ChipGrid(Strict):
    bounds_m: tuple[float, float, float, float]
    bounds_lonlat: tuple[float, float, float, float]
    res_m: float
    size_px: tuple[int, int]


class Grid(Strict):
    schema_version: int = SCHEMA_VERSION
    crs: str
    bounds_m: tuple[float, float, float, float]
    bounds_lonlat: tuple[float, float, float, float]
    res_m: float
    size_px: tuple[int, int]
    height_encoding: HeightEncoding
    z_min: float
    z_max: float
    lake_chip: ChipGrid
    placeholder: bool = False


# ---------------------------------------------------------------- manifest.json
LayerKind = Literal["terrain", "basemap", "hillshade", "radar", "mask", "change", "hand", "flood", "vector", "other"]


class Encoding(Strict):
    type: Literal["db8", "rg16", "r16", "r8", "rgb", "mask8", "logratio8"]
    min: Optional[float] = None
    max: Optional[float] = None
    scale: Optional[float] = None
    offset: Optional[float] = None


class Layer(Provenance):
    id: str
    kind: LayerKind
    grid: Literal["scene", "lake_chip", "none"]
    file: str
    label: str
    date: Optional[IsoDate] = None
    time_utc: Optional[str] = None
    sensor: Optional[Literal["NISAR", "S1", "S2", "SWOT", "NASADEM", "COPDEM", "WorldCover", "OSM", "model"]] = None
    band: Optional[Literal["L", "S", "C", "optical"]] = None
    pol: Optional[str] = None
    track: Optional[str] = None
    frame: Optional[int] = None
    product_id: Optional[str] = None
    encoding: Optional[Encoding] = None
    mask: Optional[str] = None


class Manifest(Strict):
    schema_version: int = SCHEMA_VERSION
    version: str
    generated_utc: str
    product: str
    dam_id: str
    placeholder: bool = False
    layers: list[Layer]
    files: dict[str, str] = Field(default_factory=dict, description="logical name -> path of each JSON in the bundle")


# ---------------------------------------------------------------- timeseries/reservoir_area.json
class AreaPoint(Strict):
    date: IsoDate
    time_utc: Optional[str] = None
    sensor: Literal["NISAR", "S1"]
    track: str
    area_km2: float
    area_norm_km2: Optional[float] = None
    sigma_km2: Optional[float] = None
    confidence: Confidence = "high"
    layer: Optional[str] = None
    note: str = ""


class Event(Strict):
    date: IsoDate
    label: str
    kind: Literal["failure", "arrival", "repair", "plan", "other"] = "other"
    badge: Badge = "REPORTED"
    source: str = ""


class ReservoirArea(Provenance):
    schema_version: int = SCHEMA_VERSION
    dam_id: str
    reservoir: str
    polygon: str
    unit: Literal["km2"] = "km2"
    threshold_db: float
    points: list[AreaPoint]
    events: list[Event]
    gaps: list[tuple[IsoDate, IsoDate]] = Field(default_factory=list)


# ---------------------------------------------------------------- anomaly/alerts.json
AlertLevel = Literal["ALERT", "WARNING", "NORMAL"]


class Rule(Strict):
    z_alert: float
    drop_alert: float
    z_warn: float
    drop_warn: float
    seasonal_rate_per_day: float
    sigma_per_sqrt_day: float


class Text(Strict):
    everyone: str
    experts: str


class Evaluation(Strict):
    date: IsoDate
    prev: IsoDate
    days: float
    delta: float
    expected: float
    z: float
    level: AlertLevel
    cross_sensor: bool
    text: Text


class Alerts(Provenance):
    schema_version: int = SCHEMA_VERSION
    dam_id: str
    rule: Rule
    evaluations: list[Evaluation]


# ---------------------------------------------------------------- flood/hand_lut.json
class HandRow(Strict):
    h: float
    V_m3: float
    area_km2: float
    cropland_ha: float
    builtup_ha: float
    villages: int
    road_km: float
    population: float = 0      # WorldPop sum in wet cells (MODELLED)
    buildings: int = 0         # OSM building centroids in wet cells


class HandLut(Provenance):
    schema_version: int = SCHEMA_VERSION
    dam_id: str
    corridor: str
    reach: str
    hand_file: str
    hand_encoding: Encoding
    rows: list[HandRow]


# ---------------------------------------------------------------- flood/anuga/index.json
class AnugaFiles(Strict):
    maxdepth: str
    arrival: str
    frames: str
    n_frames: int
    dt_s: float


class AnugaScenario(Provenance):
    id: str
    volume_m3: float
    duration_h: float
    label: str
    computed: bool
    files: Optional[AnugaFiles] = None
    depth_encoding: Optional[Encoding] = None
    stats: Optional[str] = None


class AnugaIndex(Strict):
    schema_version: int = SCHEMA_VERSION
    dam_id: str
    scenarios: list[AnugaScenario]


class AnugaStats(Strict):
    mass_balance_err: float
    peak_Q_m3s: float
    inundated_km2: float
    arrival_h: dict[str, float]
    max_depth_m: dict[str, float]


# ---------------------------------------------------------------- impacts/impacts.json
class VillageImpact(Strict):
    name: str
    arrival_h: Optional[float] = None
    max_depth_m: Optional[float] = None


class ScenarioImpact(Strict):
    cropland_ha: float
    builtup_ha: float
    buildings: int
    road_km: float
    villages: list[VillageImpact]


class Impacts(Provenance):
    schema_version: int = SCHEMA_VERSION
    dam_id: str
    scenarios: dict[str, ScenarioImpact]


# ---------------------------------------------------------------- level/level_volume.json
class SwotPoint(Strict):
    time: str
    wse_m: float
    wse_u: float
    area_km2: Optional[float] = None
    quality: int


class Swot(Strict):
    available: bool
    lake_id: Optional[str] = None
    reason: str = ""
    points: list[SwotPoint] = Field(default_factory=list)


class ShorelineLevel(Strict):
    date: IsoDate
    level_m: Optional[float] = None
    sigma_m: Optional[float] = None
    measurable: bool = True
    note: str = ""


class DeltaVolume(Strict):
    from_: IsoDate = Field(alias="from")
    to: IsoDate
    dV_m3: float
    low: float
    high: float
    method: str
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Reported(Strict):
    what: str
    value_m3: float
    alt: Optional[float] = None
    source: str


class LevelVolume(Provenance):
    schema_version: int = SCHEMA_VERSION
    dam_id: str
    swot: Swot
    dem_shoreline: list[ShorelineLevel]
    delta_volume: list[DeltaVolume]
    reported: list[Reported]


# ---------------------------------------------------------------- story/sources.json
class Source(Strict):
    id: str
    title: str
    url: str
    kind: Literal["data", "press", "method", "challenge", "official"]


class Sources(Strict):
    schema_version: int = SCHEMA_VERSION
    sources: list[Source]


class Events(Strict):
    schema_version: int = SCHEMA_VERSION
    events: list[Event]


# ---------------------------------------------------------------- registry & export
CONTRACTS: dict[str, type[BaseModel]] = {
    "grid": Grid,
    "manifest": Manifest,
    "reservoir_area": ReservoirArea,
    "alerts": Alerts,
    "hand_lut": HandLut,
    "anuga_index": AnugaIndex,
    "anuga_stats": AnugaStats,
    "impacts": Impacts,
    "level_volume": LevelVolume,
    "sources": Sources,
    "events": Events,
}

# where each contract lives inside a bundle
BUNDLE_PATHS: dict[str, str] = {
    "grid": "terrain/grid.json",
    "manifest": "manifest.json",
    "reservoir_area": "timeseries/reservoir_area.json",
    "alerts": "anomaly/alerts.json",
    "hand_lut": "flood/hand_lut.json",
    "anuga_index": "flood/anuga/index.json",
    "impacts": "impacts/impacts.json",
    "level_volume": "level/level_volume.json",
    "sources": "story/sources.json",
    "events": "story/events.json",
}


def export_schemas(out_dir: Path) -> list[Path]:
    """Write one JSON Schema per contract (by_alias, so DeltaVolume keeps its 'from' key)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for name, model in CONTRACTS.items():
        schema = model.model_json_schema(by_alias=True, mode="serialization")
        schema["$id"] = f"https://dancing-with-dams/contracts/{name}.schema.json"
        schema["x-schema-version"] = SCHEMA_VERSION
        p = out_dir / f"{name}.schema.json"
        p.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        written.append(p)
    return written


def validate_file(name: str, path: Path) -> BaseModel:
    return CONTRACTS[name].model_validate_json(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    for p in export_schemas(root / "contracts"):
        print("wrote", p.relative_to(root))
