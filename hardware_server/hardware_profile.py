def hardware_profile(property_id, building, env):
    profile = env.get("KIOSK_HARDWARE") or (
        "camp" if property_id == "property4" else
        "beach-b" if (property_id, building) in (("property3", "B"), ("property1", "D")) else "oneplus")
    if profile not in ("oneplus", "camp", "beach-b") or profile == "camp" and property_id not in ("property3", "property4"):
        return None
    return profile
