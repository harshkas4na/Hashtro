"""
Swiss Ephemeris Service - NASA-grade astronomical calculations
Uses pyswisseph for high-precision planetary positions with topocentric coordinates
"""
import os
from datetime import datetime, date
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
import json

try:
    import swisseph as swe
    SWISSEPH_AVAILABLE = True
except ImportError:
    SWISSEPH_AVAILABLE = False

from ..config.settings import settings
from ..config.logger import logger


# Ayanamsa constants for Sidereal calculations
AYANAMSA_MAP = {
    "LAHIRI": swe.SIDM_LAHIRI if SWISSEPH_AVAILABLE else 1,
    "RAMAN": swe.SIDM_RAMAN if SWISSEPH_AVAILABLE else 3,
    "KRISHNAMURTI": swe.SIDM_KRISHNAMURTI if SWISSEPH_AVAILABLE else 5,
    "FAGAN_BRADLEY": swe.SIDM_FAGAN_BRADLEY if SWISSEPH_AVAILABLE else 0,
}

# Planet IDs in Swiss Ephemeris
PLANET_IDS = {
    "Sun": 0,
    "Moon": 1,
    "Mercury": 2,
    "Venus": 3,
    "Mars": 4,
    "Jupiter": 5,
    "Saturn": 6,
    "Uranus": 7,
    "Neptune": 8,
    "Pluto": 9,
    "TrueNode": 11,  # Rahu (North Node)
}

ZODIAC_SIGNS = [
    "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
    "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"
]


@dataclass
class PlanetData:
    """Raw planetary position data from ephemeris"""
    planet: str
    longitude: float  # Absolute ecliptic longitude (0-360)
    latitude: float
    distance: float
    speed: float  # Daily motion (negative = retrograde)
    sign: str
    sign_degree: float  # Degree within sign (0-30)
    house: int = 1


@dataclass
class ChartData:
    """Complete chart data from ephemeris calculation"""
    julian_day: float
    ascendant: float  # Absolute longitude
    ascendant_sign: str
    ascendant_degree: float  # Degree within sign
    mc: float  # Midheaven longitude
    planets: Dict[str, PlanetData]
    sun_altitude: float  # For sect determination
    is_day_chart: bool
    ayanamsa_value: float


class EphemerisService:
    """
    Swiss Ephemeris wrapper for NASA-grade astronomical calculations.
    Uses topocentric coordinates for maximum precision.
    """
    
    def __init__(self, ephe_path: Optional[str] = None, ayanamsa: str = "LAHIRI"):
        """
        Initialize the ephemeris service.
        
        Args:
            ephe_path: Path to Swiss Ephemeris data files. Defaults to settings.
            ayanamsa: Ayanamsa system for sidereal calculations.
        """
        self.initialized = False
        self.using_moshier = False
        self.ayanamsa_name = ayanamsa
        
        if not SWISSEPH_AVAILABLE:
            logger.error("pyswisseph not installed. Ephemeris calculations unavailable.")
            return
        
        # Set ephemeris path
        self.ephe_path = ephe_path or settings.ephemeris_path
        if os.path.exists(self.ephe_path):
            swe.set_ephe_path(self.ephe_path)
            # Check if actual .se1 files exist
            se1_files = [f for f in os.listdir(self.ephe_path) if f.endswith('.se1')]
            if se1_files:
                logger.info(f"Using JPL ephemeris from {self.ephe_path} ({len(se1_files)} files)")
            else:
                logger.warning(f"No .se1 files in {self.ephe_path}, using Moshier method")
                self.using_moshier = True
        else:
            logger.warning(f"Ephemeris path {self.ephe_path} not found, using Moshier method")
            self.using_moshier = True
        
        # Set ayanamsa for sidereal calculations
        ayanamsa_id = AYANAMSA_MAP.get(ayanamsa.upper(), swe.SIDM_LAHIRI)
        swe.set_sid_mode(ayanamsa_id)
        
        self.initialized = True
        logger.info(f"EphemerisService initialized (Sidereal: {ayanamsa})")
    
    def datetime_to_julian(
        self, 
        dt: datetime, 
        timezone_offset: float = 0.0
    ) -> float:
        """
        Convert datetime to Julian Day number.
        
        Args:
            dt: Datetime object
            timezone_offset: UTC offset in hours (e.g., 5.5 for IST)
            
        Returns:
            Julian Day number
        """
        if not SWISSEPH_AVAILABLE:
            raise RuntimeError("Swiss Ephemeris not available")
        
        # Adjust for timezone to get UTC
        utc_hour = dt.hour + dt.minute / 60.0 + dt.second / 3600.0 - timezone_offset
        
        jd = swe.julday(
            dt.year, 
            dt.month, 
            dt.day, 
            utc_hour
        )
        return jd
    
    def calculate_chart(
        self,
        birth_datetime: datetime,
        latitude: float,
        longitude: float,
        timezone_offset: float = 0.0,
        use_sidereal: bool = False
    ) -> ChartData:
        """
        Calculate complete natal chart with topocentric positions.
        
        Args:
            birth_datetime: Birth date and time
            latitude: Birth place latitude
            longitude: Birth place longitude
            timezone_offset: UTC offset in hours
            use_sidereal: Use sidereal zodiac (True for Vedic)
            
        Returns:
            ChartData with all planetary positions and chart points
        """
        if not self.initialized:
            raise RuntimeError("EphemerisService not initialized")
        
        # Convert to Julian Day
        jd = self.datetime_to_julian(birth_datetime, timezone_offset)
        
        # Set topocentric mode for maximum precision
        swe.set_topo(longitude, latitude, 0)  # 0 = altitude above sea level
        
        # Calculate flags
        calc_flags = swe.FLG_SWIEPH | swe.FLG_TOPOCTR
        if use_sidereal:
            calc_flags |= swe.FLG_SIDEREAL
        
        # Get ayanamsa value
        ayanamsa_value = swe.get_ayanamsa(jd) if use_sidereal else 0.0
        
        # Calculate houses (using Whole Sign later, but need Ascendant)
        houses, ascmc = swe.houses(jd, latitude, longitude, b'P')  # Placidus for ASC/MC
        ascendant = ascmc[0]
        mc = ascmc[1]
        
        # Apply ayanamsa to Ascendant for sidereal
        if use_sidereal:
            ascendant = (ascendant - ayanamsa_value) % 360
            mc = (mc - ayanamsa_value) % 360
        
        # Determine Ascendant sign and degree
        asc_sign_index = int(ascendant / 30)
        ascendant_sign = ZODIAC_SIGNS[asc_sign_index]
        ascendant_degree = ascendant % 30
        
        # Calculate Sun altitude for sect determination
        sun_pos = swe.calc_ut(jd, 0, calc_flags)
        sun_longitude = sun_pos[0][0]
        
        # Simple day/night calculation based on Sun position relative to ASC
        # More accurate: check if Sun is above horizon
        sun_altitude = self._calculate_altitude(jd, latitude, longitude, sun_longitude)
        is_day_chart = sun_altitude > 0
        
        # Calculate all planets
        planets = {}
        for planet_name, planet_id in PLANET_IDS.items():
            try:
                result = swe.calc_ut(jd, planet_id, calc_flags)
                
                planet_longitude = result[0][0]
                sign_index = int(planet_longitude / 30)
                
                planets[planet_name] = PlanetData(
                    planet=planet_name,
                    longitude=planet_longitude,
                    latitude=result[0][1],
                    distance=result[0][2],
                    speed=result[0][3],
                    sign=ZODIAC_SIGNS[sign_index],
                    sign_degree=planet_longitude % 30
                )
            except Exception as e:
                logger.warning(f"Failed to calculate {planet_name}: {e}")
        
        # Assign Whole Sign Houses
        self._assign_whole_sign_houses(planets, asc_sign_index)
        
        return ChartData(
            julian_day=jd,
            ascendant=ascendant,
            ascendant_sign=ascendant_sign,
            ascendant_degree=ascendant_degree,
            mc=mc,
            planets=planets,
            sun_altitude=sun_altitude,
            is_day_chart=is_day_chart,
            ayanamsa_value=ayanamsa_value
        )
    
    def _calculate_altitude(
        self, 
        jd: float, 
        lat: float, 
        lon: float, 
        sun_longitude: float
    ) -> float:
        """
        Calculate the altitude of the Sun above the horizon.
        Simplified calculation for sect determination.
        """
        try:
            # Use Swiss Ephemeris azalt function for accurate altitude.
            # Second argument must be SE_TRUE_ALTITUDE (0) or SE_APP_ALTITUDE (1).
            # swe.CALC_SET (value=2) is a rise_trans flag and causes wrong results.
            SE_TRUE_ALTITUDE = 0
            result = swe.azalt(
                jd,
                SE_TRUE_ALTITUDE,
                [lon, lat, 0],  # geopos
                0,  # atpress (atmospheric pressure, mbar)
                0,  # attemp (temperature, °C)
                [sun_longitude, 0, 1]  # xin (ecliptic longitude, lat, dist)
            )
            return result[1]  # Altitude in degrees
        except Exception as e:
            logger.debug(f"Sun altitude calculation failed: {e}, defaulting to 0")
            return 0.0
    
    def _assign_whole_sign_houses(
        self, 
        planets: Dict[str, PlanetData], 
        asc_sign_index: int
    ) -> None:
        """
        Assign Whole Sign House numbers to planets.
        House 1 = Ascendant sign, houses follow in zodiacal order.
        """
        for planet_name, planet_data in planets.items():
            planet_sign_index = ZODIAC_SIGNS.index(planet_data.sign)
            # Calculate house as offset from Ascendant sign
            house = ((planet_sign_index - asc_sign_index) % 12) + 1
            planet_data.house = house
    
    def get_current_transits(
        self,
        current_datetime: datetime,
        latitude: float = 0.0,
        longitude: float = 0.0,
        timezone_offset: float = 0.0,
        use_sidereal: bool = False
    ) -> Dict[str, PlanetData]:
        """
        Get current planetary positions for transit calculations.
        
        Args:
            current_datetime: Current date/time for transits
            latitude: Observer latitude (optional)
            longitude: Observer longitude (optional)
            timezone_offset: UTC offset in hours
            
        Returns:
            Dictionary of current planetary positions
        """
        if not self.initialized:
            raise RuntimeError("EphemerisService not initialized")
        
        jd = self.datetime_to_julian(current_datetime, timezone_offset)
        
        calc_flags = swe.FLG_SWIEPH
        # Add sidereal flag ONLY if requested
        # For now, let's make transits match the system default (Tropical)
        # by removing the hardcoded FLG_SIDEREAL if use_sidereal is False
        # But wait, this method doesn't take use_sidereal. 
        # I'll add the parameter or just remove the flag if it should be global.
        
        # Let's add a parameter for consistency
        
        if use_sidereal:
            calc_flags |= swe.FLG_SIDEREAL

        transits = {}
        for planet_name, planet_id in PLANET_IDS.items():
            if planet_name == "TrueNode":
                continue  # Skip nodes for transits
            try:
                result = swe.calc_ut(jd, planet_id, calc_flags)
                planet_longitude = result[0][0]
                sign_index = int(planet_longitude / 30)
                
                transits[planet_name] = PlanetData(
                    planet=planet_name,
                    longitude=planet_longitude,
                    latitude=result[0][1],
                    distance=result[0][2],
                    speed=result[0][3],
                    sign=ZODIAC_SIGNS[sign_index],
                    sign_degree=planet_longitude % 30
                )
            except Exception as e:
                logger.warning(f"Failed to calculate transit for {planet_name}: {e}")
        
        return transits
    
    def close(self):
        """Clean up Swiss Ephemeris resources"""
        if SWISSEPH_AVAILABLE:
            swe.close()
            logger.info("EphemerisService closed")


# Global instance
ephemeris_service = EphemerisService(
    ephe_path=settings.ephemeris_path if SWISSEPH_AVAILABLE else None,
    ayanamsa=settings.ayanamsa if SWISSEPH_AVAILABLE else "LAHIRI"
) if SWISSEPH_AVAILABLE else None
