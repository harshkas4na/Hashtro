"""
Astrological Calculator Service
Implements Hellenistic/Vedic frameworks: Profections, Dignity, Aspects, Sect Logic
"""
import json
import os
from datetime import datetime, date
from typing import Dict, List, Optional, Tuple, Any
from pathlib import Path

from ..config.logger import logger
from ..models.cdo_models import (
    PlanetPosition, Aspect, TimeLordActivation, SectInfo, 
    CosmicDataObject, CDOSummary
)

# Load knowledge bases
KNOWLEDGE_DIR = Path(__file__).parent.parent / "knowledge"


def load_json_knowledge(filename: str) -> dict:
    """Load a JSON knowledge file"""
    filepath = KNOWLEDGE_DIR / filename
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning(f"Knowledge file not found: {filepath}")
        return {}
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in {filepath}: {e}")
        return {}


# Global knowledge bases
ASTRO_LOGIC = load_json_knowledge("astro_logic.json")
UPAYAS = load_json_knowledge("upayas.json")

ZODIAC_SIGNS = ASTRO_LOGIC.get("zodiac_signs", [
    "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
    "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"
])

PLANETARY_RULERS = ASTRO_LOGIC.get("planetary_rulers", {
    "Aries": "Mars", "Taurus": "Venus", "Gemini": "Mercury",
    "Cancer": "Moon", "Leo": "Sun", "Virgo": "Mercury",
    "Libra": "Venus", "Scorpio": "Mars", "Sagittarius": "Jupiter",
    "Capricorn": "Saturn", "Aquarius": "Saturn", "Pisces": "Jupiter"
})

DIGNITY_TABLE = ASTRO_LOGIC.get("dignity_table", {})
DIGNITY_SCORES = ASTRO_LOGIC.get("dignity_scores", {
    "domicile": 5, "exaltation": 4, "detriment": -4, "fall": -5
})

ASPECT_DEFINITIONS = ASTRO_LOGIC.get("aspect_definitions", {
    "conjunction": {"angle": 0, "orb": 8, "nature": "neutral"},
    "opposition": {"angle": 180, "orb": 8, "nature": "hard"},
    "trine": {"angle": 120, "orb": 6, "nature": "soft"},
    "square": {"angle": 90, "orb": 6, "nature": "hard"},
    "sextile": {"angle": 60, "orb": 4, "nature": "soft"}
})

SECT_INFO = ASTRO_LOGIC.get("sect_benefics_malefics", {
    "diurnal": {
        "benefic_of_sect": "Jupiter",
        "malefic_of_sect": "Saturn",
        "malefic_contrary_to_sect": "Mars"
    },
    "nocturnal": {
        "benefic_of_sect": "Venus",
        "malefic_of_sect": "Mars",
        "malefic_contrary_to_sect": "Saturn"
    }
})

# Profection house themes
HOUSE_THEMES = {
    1: "Self, Identity, and New Beginnings",
    2: "Finances, Resources, and Values",
    3: "Communication, Learning, and Siblings",
    4: "Home, Family, and Foundations",
    5: "Creativity, Romance, and Joy",
    6: "Health, Work, and Daily Routines",
    7: "Partnerships and Relationships",
    8: "Transformation, Shared Resources, and Intimacy",
    9: "Travel, Philosophy, and Higher Learning",
    10: "Career, Reputation, and Public Image",
    11: "Friends, Networks, and Future Goals",
    12: "Spirituality, Solitude, and Hidden Matters"
}


class AstroCalculator:
    """
    Implements Hellenistic/Vedic astrological calculation frameworks.
    Builds the Cosmic Data Object (CDO) from ephemeris data.
    """
    
    def __init__(self):
        """Initialize calculator with knowledge bases"""
        self.planetary_rulers = PLANETARY_RULERS
        self.dignity_table = DIGNITY_TABLE
        self.aspect_definitions = ASPECT_DEFINITIONS
        self.upayas = UPAYAS
        logger.info("AstroCalculator initialized")
    
    def calculate_age(self, birth_date: date, current_date: date) -> int:
        """Calculate age in years"""
        age = current_date.year - birth_date.year
        # Adjust if birthday hasn't occurred this year
        if (current_date.month, current_date.day) < (birth_date.month, birth_date.day):
            age -= 1
        return max(0, age)
    
    def calculate_profections(
        self, 
        birth_date: date, 
        current_date: date,
        ascendant_sign: str
    ) -> Tuple[int, str, str]:
        """
        Calculate Annual Profections to find Lord of the Year.
        
        Formula: (Ascendant Sign Index + Age) % 12 = Profected Sign Index
        
        Args:
            birth_date: User's date of birth
            current_date: Current date
            ascendant_sign: User's Ascendant (rising) sign
            
        Returns:
            Tuple of (profection_house, time_lord, house_theme)
        """
        age = self.calculate_age(birth_date, current_date)
        
        # Get ascendant sign index
        try:
            asc_index = ZODIAC_SIGNS.index(ascendant_sign)
        except ValueError:
            logger.warning(f"Unknown ascendant sign: {ascendant_sign}, defaulting to Aries")
            asc_index = 0
        
        # Calculate profected sign
        profected_index = (asc_index + age) % 12
        profected_sign = ZODIAC_SIGNS[profected_index]
        
        # Profection house (1-based)
        profection_house = (age % 12) + 1
        
        # Time Lord is the ruler of the profected sign
        time_lord = self.planetary_rulers.get(profected_sign, "Sun")
        
        # House theme
        house_theme = HOUSE_THEMES.get(profection_house, "General Life Themes")
        
        logger.debug(f"Profections: Age {age}, House {profection_house}, Time Lord: {time_lord}")
        
        return profection_house, time_lord, house_theme
    
    def score_dignity(self, planet: str, sign: str) -> int:
        """
        Calculate essential dignity score for a planet in a sign.
        
        Scores:
            +5: Domicile (planet rules the sign)
            +4: Exaltation (planet is exalted)
            -4: Detriment (opposite of domicile)
            -5: Fall (opposite of exaltation)
            0: Peregrine (no essential dignity)
            
        Args:
            planet: Planet name
            sign: Zodiac sign
            
        Returns:
            Dignity score from -5 to +5
        """
        if planet not in self.dignity_table:
            return 0
        
        planet_dignities = self.dignity_table[planet]
        
        # Check each dignity level
        if sign in planet_dignities.get("domicile", []):
            return DIGNITY_SCORES["domicile"]
        elif sign in planet_dignities.get("exaltation", []):
            return DIGNITY_SCORES["exaltation"]
        elif sign in planet_dignities.get("detriment", []):
            return DIGNITY_SCORES["detriment"]
        elif sign in planet_dignities.get("fall", []):
            return DIGNITY_SCORES["fall"]
        
        return 0  # Peregrine
    
    def determine_sect(self, is_day_chart: bool) -> SectInfo:
        """
        Determine chart sect and its implications.
        
        Day charts: Sun above horizon - Jupiter is benefic of sect, Saturn more manageable
        Night charts: Sun below horizon - Venus is benefic of sect, Saturn most difficult
        
        Args:
            is_day_chart: True if Sun is above horizon
            
        Returns:
            SectInfo with benefic/malefic assignments
        """
        sect_key = "diurnal" if is_day_chart else "nocturnal"
        sect_data = SECT_INFO.get(sect_key, SECT_INFO["diurnal"])
        
        # Determine Saturn's severity based on sect
        if is_day_chart:
            malefic_severity = "constructive"  # Saturn is in sect, more manageable
        else:
            malefic_severity = "difficult"  # Saturn is contrary to sect
        
        return SectInfo(
            is_day_chart=is_day_chart,
            sect="Diurnal" if is_day_chart else "Nocturnal",
            benefic_of_sect=sect_data.get("benefic_of_sect", "Jupiter"),
            malefic_of_sect=sect_data.get("malefic_of_sect", "Saturn"),
            malefic_contrary_to_sect=sect_data.get("malefic_contrary_to_sect", "Mars"),
            malefic_severity=malefic_severity
        )
    
    def check_cusp(self, degree: float, threshold: float = 1.0) -> bool:
        """
        Check if degree is within threshold of a sign boundary (0° or 30°).
        
        Args:
            degree: Degree within sign (0-30)
            threshold: Degrees from boundary to consider "cusp"
            
        Returns:
            True if on a cosmic cusp
        """
        return degree < threshold or degree > (30 - threshold)
    
    def calculate_aspects(
        self, 
        planets: Dict[str, Any],
        orb_multiplier: float = 1.0
    ) -> List[Aspect]:
        """
        Calculate aspects between planets.
        
        Args:
            planets: Dictionary of planet positions (with longitude attribute)
            orb_multiplier: Multiply default orbs by this factor
            
        Returns:
            List of Aspect objects
        """
        aspects = []
        planet_names = list(planets.keys())
        
        for i, planet1 in enumerate(planet_names):
            for planet2 in planet_names[i+1:]:
                # Skip nodes for aspect calculations
                if "Node" in planet1 or "Node" in planet2:
                    continue
                
                pos1 = planets[planet1]
                pos2 = planets[planet2]
                
                # Get longitudes (handle both dict and object)
                lon1 = pos1.longitude if hasattr(pos1, 'longitude') else pos1.get('longitude', 0)
                lon2 = pos2.longitude if hasattr(pos2, 'longitude') else pos2.get('longitude', 0)
                speed1 = pos1.speed if hasattr(pos1, 'speed') else pos1.get('speed', 0)
                speed2 = pos2.speed if hasattr(pos2, 'speed') else pos2.get('speed', 0)
                
                # Calculate angular separation
                diff = abs(lon1 - lon2)
                if diff > 180:
                    diff = 360 - diff
                
                # Check against each aspect type
                for aspect_name, aspect_def in self.aspect_definitions.items():
                    angle = aspect_def["angle"]
                    orb = aspect_def["orb"] * orb_multiplier
                    
                    if abs(diff - angle) <= orb:
                        # Determine if applying or separating
                        # Applying: faster planet approaching slower one
                        is_applying = self._is_aspect_applying(
                            lon1, lon2, speed1, speed2, angle
                        )
                        
                        aspects.append(Aspect(
                            planet1=planet1,
                            planet2=planet2,
                            aspect_type=aspect_name,
                            orb=round(abs(diff - angle), 2),
                            is_applying=is_applying,
                            nature=aspect_def["nature"]
                        ))
                        break  # Only one aspect per planet pair
        
        return aspects
    
    def _is_aspect_applying(
        self, 
        lon1: float, 
        lon2: float, 
        speed1: float, 
        speed2: float,
        aspect_angle: float
    ) -> bool:
        """
        Determine if an aspect is applying (getting tighter) or separating.
        """
        # Current difference
        current_diff = abs(lon1 - lon2)
        if current_diff > 180:
            current_diff = 360 - current_diff
        
        # Projected difference in 1 day
        future_lon1 = (lon1 + speed1) % 360
        future_lon2 = (lon2 + speed2) % 360
        future_diff = abs(future_lon1 - future_lon2)
        if future_diff > 180:
            future_diff = 360 - future_diff
        
        # If moving closer to exact aspect, it's applying
        current_orb = abs(current_diff - aspect_angle)
        future_orb = abs(future_diff - aspect_angle)
        
        return future_orb < current_orb
    
    def detect_time_lord_activations(
        self,
        time_lord: str,
        natal_planets: Dict[str, Any],
        transit_planets: Dict[str, Any]
    ) -> List[TimeLordActivation]:
        """
        The Activation Rule: Detect transits aspecting the user's Time Lord.
        
        This is the key "blame factor" - identifying which transiting planets
        are currently making aspects to the natal Time Lord.
        
        Args:
            time_lord: The Lord of the Year planet
            natal_planets: Natal planet positions
            transit_planets: Current transit positions
            
        Returns:
            List of TimeLordActivation objects
        """
        activations = []
        
        if time_lord not in natal_planets:
            return activations
        
        natal_tl = natal_planets[time_lord]
        natal_lon = natal_tl.longitude if hasattr(natal_tl, 'longitude') else natal_tl.get('longitude', 0)
        
        for transit_planet, transit_data in transit_planets.items():
            # Skip if same planet
            if transit_planet == time_lord:
                continue
            
            transit_lon = transit_data.longitude if hasattr(transit_data, 'longitude') else transit_data.get('longitude', 0)
            transit_speed = transit_data.speed if hasattr(transit_data, 'speed') else transit_data.get('speed', 0)
            
            # Calculate aspect
            diff = abs(natal_lon - transit_lon)
            if diff > 180:
                diff = 360 - diff
            
            for aspect_name, aspect_def in self.aspect_definitions.items():
                angle = aspect_def["angle"]
                orb = aspect_def["orb"]
                
                if abs(diff - angle) <= orb:
                    # Determine intensity based on aspect type
                    if aspect_name == "conjunction":
                        intensity = "high"
                    elif aspect_name in ["square", "opposition"]:
                        intensity = "challenging"
                    else:
                        intensity = "supportive"
                    
                    # Check if applying using orb-comparison method.
                    # Natal positions are fixed (speed=0); the transit planet
                    # moves, so only transit_speed matters.
                    is_applying = self._is_aspect_applying(
                        natal_lon, transit_lon, 0, transit_speed, angle
                    )
                    
                    activations.append(TimeLordActivation(
                        transiting_planet=transit_planet,
                        aspect_to_time_lord=aspect_name,
                        orb=round(abs(diff - angle), 2),
                        is_applying=is_applying,
                        intensity=intensity
                    ))
                    break
        
        return activations
    
    def check_combust_cazimi(
        self, 
        planet_longitude: float, 
        sun_longitude: float
    ) -> Tuple[bool, bool]:
        """
        Check if planet is combust or cazimi relative to Sun.
        
        Combust: Within 8.5° of Sun - weakened
        Cazimi: Within 17' (0.283°) of Sun - highly empowered
        
        Returns:
            Tuple of (is_combust, is_cazimi)
        """
        diff = abs(planet_longitude - sun_longitude)
        if diff > 180:
            diff = 360 - diff
        
        is_cazimi = diff <= 0.283  # 17 arcminutes
        is_combust = diff <= 8.5 and not is_cazimi
        
        return is_combust, is_cazimi
    
    def build_cdo(
        self,
        chart_data: Any,
        birth_date: date,
        current_date: datetime,
        transit_planets: Optional[Dict] = None
    ) -> CosmicDataObject:
        """
        Assemble the complete Cosmic Data Object from chart data.
        
        Args:
            chart_data: ChartData from ephemeris service
            birth_date: User's birth date
            current_date: Current date for transits
            transit_planets: Optional transit positions
            
        Returns:
            Complete CosmicDataObject
        """
        # Calculate profections
        profection_house, time_lord, house_theme = self.calculate_profections(
            birth_date, current_date.date(), chart_data.ascendant_sign
        )
        
        # Build sect info
        sect_info = self.determine_sect(chart_data.is_day_chart)
        
        # Check for cosmic cusp
        is_cusp = self.check_cusp(chart_data.ascendant_degree)
        
        # Get Sun longitude for combust/cazimi checks
        sun_data = chart_data.planets.get("Sun")
        sun_longitude = sun_data.longitude if sun_data else 0
        
        # Build planet positions with dignity scores
        planet_positions = []
        afflicted_planets = []
        
        for planet_name, planet_data in chart_data.planets.items():
            if "Node" in planet_name:
                continue  # Skip nodes for main list
            
            dignity_score = self.score_dignity(planet_name, planet_data.sign)
            
            # Check combust/cazimi (skip Sun itself)
            is_combust, is_cazimi = False, False
            if planet_name != "Sun":
                is_combust, is_cazimi = self.check_combust_cazimi(
                    planet_data.longitude, sun_longitude
                )
            
            position = PlanetPosition(
                planet=planet_name,
                sign=planet_data.sign,
                house=planet_data.house,
                degree=planet_data.longitude,
                sign_degree=planet_data.sign_degree,
                speed=planet_data.speed,
                is_retrograde=planet_data.speed < 0,
                dignity_score=dignity_score,
                is_combust=is_combust,
                is_cazimi=is_cazimi
            )
            planet_positions.append(position)
            
            # Track afflicted planets (dignity < -2)
            if dignity_score <= -2:
                afflicted_planets.append(planet_name)
        
        # Calculate aspects
        aspects = self.calculate_aspects(chart_data.planets)
        
        # Detect Time Lord activations (if transits provided)
        time_lord_activations = []
        if transit_planets:
            time_lord_activations = self.detect_time_lord_activations(
                time_lord, chart_data.planets, transit_planets
            )
        
        # Identify primary affliction (most negative dignity)
        primary_affliction = None
        if afflicted_planets:
            # Sort by dignity score to find most afflicted
            afflicted_scores = [
                (p, self.score_dignity(p, chart_data.planets[p].sign))
                for p in afflicted_planets
            ]
            afflicted_scores.sort(key=lambda x: x[1])
            primary_affliction = afflicted_scores[0][0]
        
        return CosmicDataObject(
            sect=sect_info,
            ascendant_sign=chart_data.ascendant_sign,
            ascendant_degree=chart_data.ascendant_degree,
            is_cusp_ascendant=is_cusp,
            profection_house=profection_house,
            time_lord=time_lord,
            profection_theme=house_theme,
            planets=planet_positions,
            aspects=aspects,
            time_lord_activations=time_lord_activations,
            afflicted_planets=afflicted_planets,
            primary_affliction=primary_affliction
        )
    
    def build_cdo_summary(self, cdo: CosmicDataObject) -> CDOSummary:
        """
        Create a simplified CDO summary for AI prompt injection.
        """
        # Get major aspect (first hard aspect or most significant)
        major_aspect = None
        for aspect in cdo.aspects:
            if aspect.nature == "hard":
                aspect_str = f"{aspect.planet1} {aspect.aspect_type.capitalize()} {aspect.planet2}"
                if aspect.is_applying:
                    aspect_str += " (Applying)"
                else:
                    aspect_str += " (Separating)"
                major_aspect = aspect_str
                break
        
        # Get Time Lord activation string
        tl_activation = None
        if cdo.time_lord_activations:
            activation = cdo.time_lord_activations[0]
            tl_activation = f"{activation.transiting_planet} transiting {activation.aspect_to_time_lord} your Time Lord {cdo.time_lord}"
        
        # Dignity warning
        dignity_warning = None
        if cdo.primary_affliction:
            upaya = self.upayas.get(cdo.primary_affliction, {})
            dignity_warning = f"{cdo.primary_affliction} afflicted: {upaya.get('shadow_warning', 'Challenging energy')}"
        
        return CDOSummary(
            sect=cdo.sect.sect,
            ascendant=f"{cdo.ascendant_sign} at {cdo.ascendant_degree:.0f}°",
            is_cusp=cdo.is_cusp_ascendant,
            time_lord=cdo.time_lord,
            profection_house=cdo.profection_house,
            profection_theme=cdo.profection_theme,
            major_aspect=major_aspect,
            time_lord_activation=tl_activation,
            dignity_warning=dignity_warning,
            malefic_severity=cdo.sect.malefic_severity
        )
    
    def get_remedy(self, planet: str) -> Optional[Dict[str, str]]:
        """
        Get remedy information for an afflicted planet.
        
        Args:
            planet: Planet name
            
        Returns:
            Dictionary with shadow_warning, traditional_remedy, modern_action
        """
        return self.upayas.get(planet)


# Global instance
astro_calculator = AstroCalculator()
