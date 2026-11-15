from app.modules.missions.terrain.hazards import load_static_hazards

REGION_ID = "mc23-gale-mount-sharp"


def test_region_publishes_exclusion_and_caution_zones():
    zones = {zone.hazard_id: zone for zone in load_static_hazards(REGION_ID)}
    dunes, boxwork = zones["hz-dunes"], zones["hz-boxwork"]
    assert dunes.kind == "exclusion" and boxwork.kind == "caution"
    assert boxwork.cost_multiplier > 1
    # centro de las dunas dentro; un punto 1 km al norte, fuera
    assert dunes.contains(5400, 5350)
    assert not dunes.contains(5400, 6600)


def test_region_without_file_has_no_static_zones():
    assert load_static_hazards("region-sin-zonas") == ()
