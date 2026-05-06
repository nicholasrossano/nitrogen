"""SDG (Sustainable Development Goal) classifier service."""

# SDG definitions with sub-targets
SDGS = {
    "1": {
        "name": "No Poverty",
        "targets": {
            "1.1": "Eradicate extreme poverty",
            "1.2": "Reduce poverty by at least 50%",
            "1.3": "Implement social protection systems",
            "1.4": "Equal rights to economic resources",
            "1.5": "Build resilience of the poor",
        }
    },
    "2": {
        "name": "Zero Hunger",
        "targets": {
            "2.1": "End hunger and ensure food access",
            "2.2": "End all forms of malnutrition",
            "2.3": "Double agricultural productivity",
            "2.4": "Sustainable food production systems",
        }
    },
    "3": {
        "name": "Good Health and Well-being",
        "targets": {
            "3.1": "Reduce maternal mortality",
            "3.2": "End preventable deaths of children",
            "3.3": "End epidemics of major diseases",
            "3.4": "Reduce premature mortality from NCDs",
            "3.8": "Achieve universal health coverage",
            "3.9": "Reduce deaths from pollution",
        }
    },
    "4": {
        "name": "Quality Education",
        "targets": {
            "4.1": "Free primary and secondary education",
            "4.2": "Access to quality early childhood development",
            "4.3": "Equal access to technical/vocational education",
            "4.4": "Increase youth and adults with relevant skills",
        }
    },
    "5": {
        "name": "Gender Equality",
        "targets": {
            "5.1": "End discrimination against women and girls",
            "5.2": "Eliminate violence against women",
            "5.4": "Recognize unpaid care and domestic work",
            "5.5": "Ensure women's participation in leadership",
        }
    },
    "6": {
        "name": "Clean Water and Sanitation",
        "targets": {
            "6.1": "Universal access to safe drinking water",
            "6.2": "Access to adequate sanitation and hygiene",
            "6.3": "Improve water quality",
            "6.4": "Increase water-use efficiency",
        }
    },
    "7": {
        "name": "Affordable and Clean Energy",
        "targets": {
            "7.1": "Universal access to modern energy services",
            "7.2": "Increase share of renewable energy",
            "7.3": "Double rate of energy efficiency improvement",
            "7.a": "Enhance international cooperation on clean energy",
            "7.b": "Expand infrastructure for sustainable energy",
        }
    },
    "8": {
        "name": "Decent Work and Economic Growth",
        "targets": {
            "8.1": "Sustain per capita economic growth",
            "8.2": "Higher levels of economic productivity",
            "8.3": "Promote development-oriented policies",
            "8.5": "Full employment and decent work for all",
        }
    },
    "9": {
        "name": "Industry, Innovation and Infrastructure",
        "targets": {
            "9.1": "Develop quality, reliable infrastructure",
            "9.2": "Promote inclusive and sustainable industrialization",
            "9.3": "Increase access to financial services for small enterprises",
            "9.4": "Upgrade infrastructure for sustainability",
        }
    },
    "10": {
        "name": "Reduced Inequalities",
        "targets": {
            "10.1": "Achieve income growth for bottom 40%",
            "10.2": "Promote social, economic, political inclusion",
            "10.3": "Ensure equal opportunity",
        }
    },
    "11": {
        "name": "Sustainable Cities and Communities",
        "targets": {
            "11.1": "Access to adequate and affordable housing",
            "11.2": "Access to sustainable transport systems",
            "11.3": "Inclusive and sustainable urbanization",
            "11.6": "Reduce environmental impact of cities",
        }
    },
    "12": {
        "name": "Responsible Consumption and Production",
        "targets": {
            "12.2": "Sustainable management of natural resources",
            "12.3": "Halve per capita food waste",
            "12.4": "Environmentally sound management of chemicals",
            "12.5": "Substantially reduce waste generation",
        }
    },
    "13": {
        "name": "Climate Action",
        "targets": {
            "13.1": "Strengthen resilience to climate hazards",
            "13.2": "Integrate climate measures into policies",
            "13.3": "Improve climate change education and awareness",
        }
    },
    "14": {
        "name": "Life Below Water",
        "targets": {
            "14.1": "Prevent and reduce marine pollution",
            "14.2": "Sustainably manage marine ecosystems",
        }
    },
    "15": {
        "name": "Life on Land",
        "targets": {
            "15.1": "Conserve and restore terrestrial ecosystems",
            "15.2": "Sustainable management of forests",
            "15.3": "Combat desertification and restore degraded land",
        }
    },
    "17": {
        "name": "Partnerships for the Goals",
        "targets": {
            "17.1": "Strengthen domestic resource mobilization",
            "17.3": "Mobilize additional financial resources",
            "17.7": "Promote sustainable technologies",
        }
    },
}

# Keyword mapping to SDGs and targets
KEYWORD_TO_SDG = {
    # SDG 7 - Energy
    "energy": ("7", "7.1"),
    "electricity": ("7", "7.1"),
    "power": ("7", "7.1"),
    "solar": ("7", "7.2"),
    "renewable": ("7", "7.2"),
    "wind": ("7", "7.2"),
    "hydro": ("7", "7.2"),
    "mini-grid": ("7", "7.1"),
    "minigrid": ("7", "7.1"),
    "micro-grid": ("7", "7.1"),
    "microgrid": ("7", "7.1"),
    "off-grid": ("7", "7.1"),
    "grid": ("7", "7.b"),
    "lpg": ("7", "7.1"),
    "clean cooking": ("7", "7.1"),
    "cookstove": ("7", "7.1"),
    "cooking": ("7", "7.1"),
    "biogas": ("7", "7.2"),
    "biomass": ("7", "7.2"),
    
    # SDG 6 - Water
    "water": ("6", "6.1"),
    "sanitation": ("6", "6.2"),
    "wash": ("6", "6.2"),
    "hygiene": ("6", "6.2"),
    "drinking water": ("6", "6.1"),
    
    # SDG 2 - Food
    "agriculture": ("2", "2.3"),
    "farming": ("2", "2.3"),
    "food": ("2", "2.1"),
    "crop": ("2", "2.4"),
    "irrigation": ("2", "2.4"),
    
    # SDG 3 - Health
    "health": ("3", "3.8"),
    "clinic": ("3", "3.8"),
    "hospital": ("3", "3.8"),
    "medical": ("3", "3.8"),
    "maternal": ("3", "3.1"),
    "child health": ("3", "3.2"),
    
    # SDG 4 - Education
    "education": ("4", "4.1"),
    "school": ("4", "4.1"),
    "training": ("4", "4.4"),
    "vocational": ("4", "4.3"),
    
    # SDG 13 - Climate
    "climate": ("13", "13.1"),
    "carbon": ("13", "13.2"),
    "emissions": ("13", "13.2"),
    "deforestation": ("15", "15.2"),
}


def classify_sdg(project_description: str, project_type: str | None = None) -> dict | None:
    """
    Classify a project to its most relevant SDG and target.
    
    Returns dict with:
        - sdg: The SDG number (e.g., "7")
        - sdg_name: The SDG name (e.g., "Affordable and Clean Energy")
        - target: The target number (e.g., "7.1")
        - target_name: The target description
    """
    if not project_description:
        return None
    
    description_lower = project_description.lower()
    
    # Score each SDG based on keyword matches
    sdg_scores: dict[str, int] = {}
    best_target: dict[str, str] = {}
    
    for keyword, (sdg, target) in KEYWORD_TO_SDG.items():
        if keyword in description_lower:
            sdg_scores[sdg] = sdg_scores.get(sdg, 0) + 1
            # Keep track of most specific target
            if sdg not in best_target or len(target) > len(best_target[sdg]):
                best_target[sdg] = target
    
    # Also consider project_type for classification
    if project_type:
        type_mapping = {
            "energy_access": ("7", "7.1"),
            "clean_cooking": ("7", "7.1"),
            "agriculture": ("2", "2.3"),
            "water_sanitation": ("6", "6.1"),
            "health": ("3", "3.8"),
        }
        if project_type in type_mapping:
            sdg, target = type_mapping[project_type]
            sdg_scores[sdg] = sdg_scores.get(sdg, 0) + 2  # Higher weight for explicit type
            if sdg not in best_target:
                best_target[sdg] = target
    
    if not sdg_scores:
        return None
    
    # Get the highest scoring SDG
    best_sdg = max(sdg_scores, key=sdg_scores.get)
    target = best_target.get(best_sdg, f"{best_sdg}.1")
    
    sdg_info = SDGS.get(best_sdg, {})
    target_name = sdg_info.get("targets", {}).get(target, "")
    
    return {
        "sdg": best_sdg,
        "sdg_name": sdg_info.get("name", ""),
        "target": target,
        "target_name": target_name,
        "display": f"SDG {target}: {target_name}" if target_name else f"SDG {best_sdg}: {sdg_info.get('name', '')}",
    }
