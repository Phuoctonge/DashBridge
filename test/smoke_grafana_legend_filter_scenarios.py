"""Behavioural model for shared legend desired-state calculation."""
from support.smoke import run_checks

def desired_state(names, visibility=None, needles=None):
    occurrences = {}
    result = []
    for name in names:
        occurrence = occurrences.get(name, 0)
        occurrences[name] = occurrence + 1
        key = f"{name}\0{occurrence}"
        visible = visibility.get(key, True) if visibility is not None else not any(
            needle.lower() in name.lower() for needle in (needles or [])
        )
        result.append((key, visible))
    return result

key = lambda name, occurrence: f"{name}\0{occurrence}"
checks = {
    "Dashboard filter hides matching names": desired_state(["idle", "load"], needles=["idle"]) == [(key("idle", 0), False), (key("load", 0), True)],
    "Popup config preserves absent series": desired_state(["A", "B"], {key("A", 0): False}) == [(key("A", 0), False), (key("B", 0), True)],
    "Duplicate names have independent keys": desired_state(["A", "A"], {key("A", 0): False, key("A", 1): True}) == [(key("A", 0), False), (key("A", 1), True)],
}

run_checks(checks)
