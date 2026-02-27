"""
Horoscope Service - CDO Architecture
High-fidelity horoscope generation using Swiss Ephemeris and Cosmic Data Object
"""
import json
import re
from datetime import datetime, date
from typing import Optional, Dict, Any, Tuple

from pydantic import BaseModel, Field

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.exceptions import OutputParserException

from ..config.settings import settings
from ..config.logger import logger
from .cache_service import cache_service
from ..prompts.senior_astrologer_prompt import SENIOR_ASTROLOGER_PROMPT
from pathlib import Path
import random

# Load asset mappings
KNOWLEDGE_DIR = Path(__file__).parent.parent / "knowledge"
ASSET_MAPPINGS = {}
try:
    with open(KNOWLEDGE_DIR / "asset_mappings.json", "r") as f:
        ASSET_MAPPINGS = json.load(f)
except Exception as e:
    logger.warning(f"Failed to load asset mappings: {e}")
    # Minimal fallback
    ASSET_MAPPINGS = {
        "colors_to_tickers": {"Gold": {"ticker": "SOL", "name": "Solana", "emoji": "☀️"}},
        "bullish_moods": [{"mood": "Good", "emoji": "👍"}],
        "bearish_moods": [{"mood": "Bad", "emoji": "👎"}]
    }


# Try to import ephemeris services (optional - falls back gracefully)
try:
    from .ephemeris_service import ephemeris_service, SWISSEPH_AVAILABLE
    from .astro_calculator import astro_calculator
    CDO_ENABLED = SWISSEPH_AVAILABLE and ephemeris_service is not None
except ImportError as e:
    logger.warning(f"Ephemeris services not available: {e}")
    CDO_ENABLED = False
    ephemeris_service = None
    astro_calculator = None


# --- Pydantic Models for Strict Schema Enforcement ---

class LuckyAssets(BaseModel):
    number: str = Field(..., description="Lucky number or special time like 11:11")
    color: str = Field(..., description="A descriptive color name")
    power_hour: str = Field(..., description="A specific time of day")


class HoroscopeFront(BaseModel):
    tagline: str = Field(..., description="Witty GenZ hook")
    hook_1: str = Field(..., description="Astrological reason, max 15 words")
    hook_2: str = Field(..., description="CT action with persona language, max 20 words")
    luck_score: int = Field(..., ge=0, le=100)
    vibe_status: str = Field(..., description="Stellar, Ascending, Shaky, or Eclipse")
    energy_emoji: str
    zodiac_sign: str = Field(..., description="Sun sign based on date of birth")
    time_lord: str = Field(default="Sun", description="Lord of the Year")
    profection_house: int = Field(default=1, ge=1, le=12)


class HoroscopeBack(BaseModel):
    detailed_reading: str
    hustle_alpha: str
    shadow_warning: str
    lucky_assets: LuckyAssets
    time_lord_insight: str = Field(default="", description="Time Lord transit insight")
    planetary_blame: str = Field(default="", description="Specific planetary attribution")
    remedy: Optional[str] = Field(default=None)
    cusp_alert: Optional[str] = Field(default=None)


class AstroCard(BaseModel):
    front: HoroscopeFront
    back: HoroscopeBack
    ruling_planet: str
    ruling_planet_theme: str
    sect: str = Field(default="Diurnal")
    cdo_summary: Optional[Dict[str, Any]] = Field(default=None)


# --- Horoscope Service Implementation ---

class HoroscopeService:
    """
    CDO-Enhanced Horoscope Service
    Uses Swiss Ephemeris for astronomical calculations and builds
    Cosmic Data Objects for AI-powered interpretation.
    """
    
    def __init__(self):
        try:
            # Using Gemini 1.5-flash for speed and better JSON adherence
            self.llm = ChatGoogleGenerativeAI(
                model=settings.llm_model,
                google_api_key=settings.google_api_key,
                temperature=0.75,  # Slightly lower for more consistent output
                max_retries=3
            )
            self.output_parser = JsonOutputParser(pydantic_object=AstroCard)
            self.prompt = ChatPromptTemplate.from_template(
                template=SENIOR_ASTROLOGER_PROMPT,
                partial_variables={"format_instructions": self.output_parser.get_format_instructions()}
            )
            self.chain = self.prompt | self.llm
            
            self.cdo_enabled = CDO_ENABLED
            logger.info(f"HoroscopeService initialized (CDO: {self.cdo_enabled})")
            
        except Exception as e:
            logger.error(f"Initialization failed: {e}")
            raise
    
    def _parse_date(self, dob: str) -> datetime:
        """Parse date of birth string into datetime object"""
        formats = [
            "%B %d, %Y",      # April 20, 1995
            "%b %d, %Y",      # Apr 20, 1995
            "%Y-%m-%d",       # 1995-04-20
            "%d/%m/%Y",       # 20/04/1995
            "%m/%d/%Y",       # 04/20/1995
            "%d-%m-%Y",       # 20-04-1995
        ]
        for fmt in formats:
            try:
                return datetime.strptime(dob.strip(), fmt)
            except ValueError:
                continue
        
        # Fallback: try to extract year/month/day with regex
        match = re.search(r'(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})', dob)
        if match:
            day, month, year = match.groups()
            return datetime(int(year), int(month), int(day))
        
        raise ValueError(f"Could not parse date: {dob}")
    
    def _parse_time(self, birth_time: str) -> Tuple[int, int]:
        """Parse birth time string into (hour, minute) tuple"""
        # Try 12-hour format (4:30 PM)
        match = re.match(r'(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?', birth_time.strip())
        if match:
            hour = int(match.group(1))
            minute = int(match.group(2))
            period = match.group(3)
            
            if period:
                if period.upper() == 'PM' and hour != 12:
                    hour += 12
                elif period.upper() == 'AM' and hour == 12:
                    hour = 0
            
            return hour, minute
        
        # Try 24-hour format (16:30)
        match = re.match(r'(\d{1,2}):(\d{2})', birth_time.strip())
        if match:
            return int(match.group(1)), int(match.group(2))
        
        # Default to noon
        return 12, 0
    
    def _calculate_age(self, birth_date: date, current_date: date = None) -> int:
        """Calculate age in years"""
        if current_date is None:
            current_date = date.today()
        
        age = current_date.year - birth_date.year
        if (current_date.month, current_date.day) < (birth_date.month, birth_date.day):
            age -= 1
        return max(0, age)
    
    def _get_age_segment(self, age: int) -> str:
        """Get life stage segment for appropriate advice tone"""
        if age < 25:
            return "EARLY_HUSTLE (Growth & Exploration)"
        elif age < 35:
            return "PIVOT_ERA (Career Building & Relationships)"
        elif age < 50:
            return "LEGACY_MODE (Stability & Leadership)"
        else:
            return "WISDOM_ERA (Reflection & Mentorship)"
    
    def _build_cdo_context(
        self,
        dob: str,
        birth_time: str,
        latitude: float,
        longitude: float,
        timezone_offset: float = 0.0
    ) -> Tuple[Dict[str, Any], str]:
        """
        Build Cosmic Data Object from birth data using ephemeris.
        
        Returns:
            Tuple of (cdo_dict, cdo_json_string)
        """
        if not self.cdo_enabled or ephemeris_service is None:
            raise RuntimeError("CDO not available - ephemeris service not initialized")
        
        # Parse birth datetime
        birth_date = self._parse_date(dob)
        hour, minute = self._parse_time(birth_time)
        birth_datetime = birth_date.replace(hour=hour, minute=minute)
        
        # Calculate natal chart
        chart_data = ephemeris_service.calculate_chart(
            birth_datetime=birth_datetime,
            latitude=latitude,
            longitude=longitude,
            timezone_offset=timezone_offset,
            use_sidereal=False
        )
        
        # Get current transits
        current_datetime = datetime.now()
        transit_planets = ephemeris_service.get_current_transits(
            current_datetime=current_datetime,
            latitude=latitude,
            longitude=longitude
        )
        
        # Build full CDO
        cdo = astro_calculator.build_cdo(
            chart_data=chart_data,
            birth_date=birth_date.date(),
            current_date=current_datetime,
            transit_planets=transit_planets
        )
        
        # Build summary for prompt
        cdo_summary = astro_calculator.build_cdo_summary(cdo)
        
        return cdo.model_dump(), cdo_summary.model_dump()
    
    def _get_fallback_zodiac(self, day: int, month: int) -> str:
        """Get zodiac sign for fallback mode (tropical) - Corrected Date Ranges"""
        # (End Day of Month, Sign)
        zodiac_map = [
            (19, "Capricorn"), (18, "Aquarius"), (20, "Pisces"), (19, "Aries"),
            (20, "Taurus"), (20, "Gemini"), (22, "Cancer"), (22, "Leo"),
            (22, "Virgo"), (23, "Libra"), (21, "Scorpio"), (21, "Sagittarius"),
            (31, "Capricorn")
        ]
        # Adjust for array index (month - 1)
        # If day is greater than cutoff, it's the next sign (which is stored in current month index in this map structure logic)
        # Wait, let's fix the logic to be clearer.
        
        # Ranges based on user request:
        # Aries: March 21 – April 19
        # Taurus: April 20 – May 20
        # Gemini: May 21 – June 21
        # Cancer: June 22 – July 22
        # Leo: July 23 – August 22
        # Virgo: August 23 – September 22
        # Libra: September 23 – October 23
        # Scorpio: October 24 – November 22
        # Sagittarius: November 23 – December 21
        # Capricorn: December 22 – January 19
        # Aquarius: January 20 – February 18
        # Pisces: February 19 – March 20
        
        if (month == 3 and day >= 21) or (month == 4 and day <= 19): return "Aries"
        if (month == 4 and day >= 20) or (month == 5 and day <= 20): return "Taurus"
        if (month == 5 and day >= 21) or (month == 6 and day <= 20): return "Gemini"
        if (month == 6 and day >= 21) or (month == 7 and day <= 22): return "Cancer"
        if (month == 7 and day >= 23) or (month == 8 and day <= 22): return "Leo"
        if (month == 8 and day >= 23) or (month == 9 and day <= 22): return "Virgo"
        if (month == 9 and day >= 23) or (month == 10 and day <= 22): return "Libra"
        if (month == 10 and day >= 23) or (month == 11 and day <= 21): return "Scorpio"
        if (month == 11 and day >= 22) or (month == 12 and day <= 21): return "Sagittarius"
        if (month == 12 and day >= 22) or (month == 1 and day <= 19): return "Capricorn"
        if (month == 1 and day >= 20) or (month == 2 and day <= 18): return "Aquarius"
        if (month == 2 and day >= 19) or (month == 3 and day <= 20): return "Pisces"
        
        return "Aries" # Default should not happen with valid dates
    
    def _get_fallback_ruler(self, sign: str) -> str:
        """Get planetary ruler for fallback mode"""
        rulers = {
            "Aries": "Mars", "Taurus": "Venus", "Gemini": "Mercury",
            "Cancer": "Moon", "Leo": "Sun", "Virgo": "Mercury",
            "Libra": "Venus", "Scorpio": "Mars", "Sagittarius": "Jupiter",
            "Capricorn": "Saturn", "Aquarius": "Saturn", "Pisces": "Jupiter"
        }
        return rulers.get(sign, "Sun")
    
    async def generate_horoscope(
        self,
        dob: str,
        birth_time: str,
        birth_place: str,
        latitude: float = 0.0,
        longitude: float = 0.0,
        timezone_offset: float = 0.0,
        use_cache: bool = True,
        x_handle: Optional[str] = None,
        x_bio: Optional[str] = None,
        x_recent_tweets: Optional[list] = None,
        x_persona: Optional[str] = None
    ) -> Tuple[Dict[str, Any], bool, str]:
        """
        Generate personalized horoscope using CDO architecture.
        
        Args:
            dob: Date of birth string
            birth_time: Time of birth string
            birth_place: Place of birth (for display)
            latitude: Birth place latitude
            longitude: Birth place longitude
            timezone_offset: UTC offset in hours
            use_cache: Whether to use caching
            
        Returns:
            Tuple of (card_data_dict, was_cached, generation_mode)
        """
        # Check cache first
        if use_cache:
            cached = cache_service.get(dob, birth_time, birth_place)
            if cached:
                return json.loads(cached), True, "cdo"
        
        # Parse birth date for age calculation
        try:
            birth_date = self._parse_date(dob)
            age = self._calculate_age(birth_date.date())
            age_segment = self._get_age_segment(age)
        except Exception as e:
            logger.warning(f"Date parsing failed: {e}, using defaults")
            age = 30
            age_segment = "PIVOT_ERA (Career Building & Relationships)"
        
        # Try CDO generation
        generation_mode = "cdo"
        cdo_json = "{}"
        cdo_summary = {}
        
        if self.cdo_enabled and latitude != 0.0 and longitude != 0.0:
            try:
                cdo_full, cdo_summary = self._build_cdo_context(
                    dob=dob,
                    birth_time=birth_time,
                    latitude=latitude,
                    longitude=longitude,
                    timezone_offset=timezone_offset
                )
                cdo_json = json.dumps(cdo_full, indent=2, default=str)
                logger.info("CDO generated successfully")
            except Exception as e:
                logger.warning(f"CDO generation failed, using fallback: {e}")
                generation_mode = "fallback"
                cdo_summary = self._build_fallback_summary(dob, birth_time, age)
        else:
            generation_mode = "fallback"
            cdo_summary = self._build_fallback_summary(dob, birth_time, age)
        
        # Build enriched X context for personalization
        x_context_parts = []
        if x_handle:
            x_context_parts.append(f"**Handle**: @{x_handle}")
            if x_bio:
                x_context_parts.append(f"**Bio**: {x_bio}")
            if x_recent_tweets and len(x_recent_tweets) > 0:
                tweets_formatted = "\n".join([f"  - {t[:100]}..." if len(t) > 100 else f"  - {t}" for t in x_recent_tweets[:5]])
                x_context_parts.append(f"**Recent Tweets**:\n{tweets_formatted}")
            if x_persona:
                x_context_parts.append(f"**Inferred Persona**: {x_persona.upper()}")
        
        x_context = "\n".join(x_context_parts) if x_context_parts else "No X context provided"
        

        # Prepare asset lists for prompt
        available_colors_list = list(ASSET_MAPPINGS.get("colors_to_tickers", {}).keys())
        available_colors_str = ", ".join(available_colors_list)
        
        bullish_moods_str = ", ".join([f"{m['mood']} {m['emoji']}" for m in ASSET_MAPPINGS.get("bullish_moods", [])])
        bearish_moods_str = ", ".join([f"{m['mood']} {m['emoji']}" for m in ASSET_MAPPINGS.get("bearish_moods", [])])

        # Compute Sun sign from DOB (independent of birth time)
        try:
            sun_date = self._parse_date(dob)
            sun_sign = self._get_fallback_zodiac(sun_date.day, sun_date.month)
        except Exception:
            sun_sign = "Unknown"

        # Build prompt variables
        prompt_vars = {
            "cdo_json": cdo_json,
            "sun_sign": sun_sign,
            "sect": cdo_summary.get("sect", "Diurnal"),
            "malefic_severity": cdo_summary.get("malefic_severity", "constructive"),
            "ascendant": cdo_summary.get("ascendant", "Unknown"),
            "time_lord": cdo_summary.get("time_lord", "Sun"),
            "profection_house": cdo_summary.get("profection_house", 1),
            "profection_theme": cdo_summary.get("profection_theme", "Self and Identity"),
            "major_aspect": cdo_summary.get("major_aspect", "No major aspects"),
            "time_lord_activation": cdo_summary.get("time_lord_activation", "No direct activations"),
            "cusp_alert": f"**Cosmic Cusp Alert**: Ascendant on sign boundary" if cdo_summary.get("is_cusp") else "",
            "dignity_warning": cdo_summary.get("dignity_warning", ""),
            "x_context": x_context,
            "available_colors": available_colors_str,
            "bullish_moods": bullish_moods_str,
            "bearish_moods": bearish_moods_str
        }
        
        try:
            # Invoke AI
            raw_output = await self.chain.ainvoke(prompt_vars)
            
            # Parse response
            try:
                card_data = self.output_parser.parse(raw_output.content)
            except Exception as parse_err:
                logger.warning(f"Output parser failed, attempting JSON extraction: {parse_err}")
                # Fallback: extract JSON from markdown blocks
                match = re.search(r'\{.*\}', raw_output.content, re.DOTALL)
                if match:
                    card_data = json.loads(match.group())
                else:
                    raise OutputParserException("No JSON found in LLM response")
            
            # Fallback for missing hooks (common issue with some models)
            front_data = card_data.get("front", {})
            if not front_data.get("hook_1"):
                time_lord = front_data.get("time_lord", "The Stars")
                front_data["hook_1"] = f"{time_lord} is highlighting your chart today."
            
            if not front_data.get("hook_2"):
                front_data["hook_2"] = "Trust the process and keep building. WAGMI."
            
            # Ensure ruling_planet_theme is populated
            if not card_data.get("ruling_planet_theme"):
                card_data["ruling_planet_theme"] = card_data.get("ruling_planet", front_data.get("time_lord", "Sun"))
                
            # Enrich Lucky Assets
            if "back" in card_data and "lucky_assets" in card_data["back"]:
                assets = card_data["back"]["lucky_assets"]
                color = assets.get("color")
                # Fuzzy match or direct match color
                mapping = ASSET_MAPPINGS.get("colors_to_tickers", {})
                
                # Try direct match
                asset_info = mapping.get(color)
                
                # Try simple case-insensitive match if direct fails
                if not asset_info and color:
                    for k, v in mapping.items():
                        if k.lower() == color.lower():
                            asset_info = v
                            # Update color name to official one
                            card_data["back"]["lucky_assets"]["color"] = k
                            break
                            
                if asset_info:
                    card_data["back"]["lucky_assets"]["ticker"] = asset_info.get("ticker")
                    card_data["back"]["lucky_assets"]["name"] = asset_info.get("name")
                    card_data["back"]["lucky_assets"]["max_leverage"] = asset_info.get("max_leverage")
                    card_data["back"]["lucky_assets"]["emoji"] = asset_info.get("emoji")
                    card_data["back"]["lucky_assets"]["category"] = asset_info.get("category")
                else:
                    # Fallback if AI picked a hallucinated color
                    # Pick a random one deterministic based on color string
                    idx = len(color or "") % len(mapping) if mapping else 0
                    fallback_key = list(mapping.keys())[idx] if mapping else "Gold"
                    asset_info = mapping.get(fallback_key)
                    if asset_info:
                        card_data["back"]["lucky_assets"]["color"] = fallback_key
                        card_data["back"]["lucky_assets"]["ticker"] = asset_info.get("ticker")
                        card_data["back"]["lucky_assets"]["name"] = asset_info.get("name")
                        card_data["back"]["lucky_assets"]["max_leverage"] = asset_info.get("max_leverage")
                        card_data["back"]["lucky_assets"]["emoji"] = asset_info.get("emoji")
                        card_data["back"]["lucky_assets"]["category"] = asset_info.get("category")

            # Enforce luck_score / vibe_status consistency.
            # The AI prompt instructs this but it can still hallucinate
            # mismatched pairs (e.g. luck_score=78 with vibe_status="Eclipse").
            front = card_data.get("front", {})
            luck_score = front.get("luck_score", 50)
            correct_vibe = (
                "Stellar" if luck_score >= 80 else
                "Ascending" if luck_score >= 51 else
                "Shaky" if luck_score >= 40 else
                "Eclipse"
            )
            if front.get("vibe_status") != correct_vibe:
                logger.warning(
                    f"Correcting vibe_status mismatch: luck_score={luck_score} "
                    f"had vibe_status={front.get('vibe_status')!r}, "
                    f"correcting to {correct_vibe!r}"
                )
                card_data["front"]["vibe_status"] = correct_vibe

            # Validate and enhance
            validated_card = AstroCard(**card_data)

            # Add CDO summary to response
            card_dict = validated_card.model_dump()
            if cdo_summary:
                card_dict["cdo_summary"] = cdo_summary
            
            # Cache result
            if use_cache:
                cache_service.set(dob, birth_time, birth_place, json.dumps(card_dict))
            
            return card_dict, False, generation_mode
            
        except Exception as e:
            logger.error(f"Generation failure: {e}")
            return self._get_fallback_card(
                cdo_summary.get("time_lord", "Sun"),
                cdo_summary.get("sect", "Diurnal")
            ), False, "fallback"
    
    def _build_fallback_summary(self, dob: str, birth_time: str, age: int) -> Dict[str, Any]:
        """Build a basic summary when CDO is not available"""
        try:
            birth_date = self._parse_date(dob)
            zodiac = self._get_fallback_zodiac(birth_date.day, birth_date.month)
            ruler = self._get_fallback_ruler(zodiac)
        except Exception as e:
            logger.warning(f"Fallback summary date parse failed: {e}, defaulting to Aries/Mars")
            zodiac = "Aries"
            ruler = "Mars"
        
        profection_house = (age % 12) + 1
        
        return {
            "sect": "Diurnal",
            "ascendant": f"{zodiac} (estimated)",
            "is_cusp": False,
            "time_lord": ruler,
            "profection_house": profection_house,
            "profection_theme": "General Life Themes",
            "major_aspect": "Transits active",
            "time_lord_activation": None,
            "dignity_warning": "",
            "malefic_severity": "constructive"
        }
    
    # Per-planet fallback flavour text so the error card reflects the user's
    # actual Time Lord rather than always blaming Mercury.
    _FALLBACK_FLAVOUR = {
        "Sun":     ("Solar flare disrupting cosmic servers",
                    "The Sun is overexposing the signal. Shield your chart."),
        "Moon":    ("Luna is deep in reflection — your reading is on hold",
                    "Lunar tides are pulling the data back. Breathe and wait."),
        "Mercury": ("Mercury retrograde in the cosmic servers",
                    "HODL tight. Mercury will station direct shortly."),
        "Venus":   ("Venus is counting cosmic coins — servers are busy",
                    "The love planet diverted bandwidth. Beauty takes time."),
        "Mars":    ("Mars combat mode triggered server interference",
                    "Red planet energy is strong. Channel it into patience."),
        "Jupiter": ("Jupiter expanding beyond available bandwidth",
                    "Too much cosmic abundance to process at once. Try again."),
        "Saturn":  ("Saturn imposed a time limit on the cosmic pipeline",
                    "Saturnian delays are temporary. Discipline pays off."),
    }
    _FALLBACK_DEFAULT = ("The stars are recalibrating…",
                         "HODL tight. The cosmos will align shortly.")

    def _get_fallback_card(self, time_lord: str, sect: str) -> Dict[str, Any]:
        """Generate fallback card when everything fails, varied by time lord."""
        hook_1, hook_2 = self._FALLBACK_FLAVOUR.get(time_lord, self._FALLBACK_DEFAULT)
        return AstroCard(
            front=HoroscopeFront(
                tagline="The stars are recalibrating... ✨",
                hook_1=hook_1,
                hook_2=hook_2,
                luck_score=50,
                vibe_status="Shaky",
                energy_emoji="🔮",
                zodiac_sign="Unknown",
                time_lord=time_lord,
                profection_house=1
            ),
            back=HoroscopeBack(
                detailed_reading=f"{hook_1}. Your chart is being processed through the ethers. Check back soon for your personalized reading.",
                hustle_alpha="Focus on grounding activities today. The stars will align shortly.",
                shadow_warning="Avoid making major decisions until the cosmic connection stabilizes.",
                lucky_assets=self._generate_random_lucky_assets(),
                time_lord_insight=f"Your Time Lord {time_lord} is gathering cosmic data.",
                planetary_blame=f"{time_lord} square Digital Saturn (Temporary)",
                remedy="Take 5 deep breaths and try again.",
                cusp_alert=None
            ),
            ruling_planet=time_lord,
            ruling_planet_theme=time_lord,
            sect=sect,
            cdo_summary=None
        ).model_dump()


    def _generate_random_lucky_assets(self) -> Dict[str, Any]:
        """Generate random lucky assets from mapping"""
        mapping = ASSET_MAPPINGS.get("colors_to_tickers", {})
        if mapping:
            color = random.choice(list(mapping.keys()))
            info = mapping[color]
            return {
                "number": str(random.randint(1, 99)),
                "color": color,
                "power_hour": f"{random.randint(1,12)}:00 PM",
                "ticker": info.get("ticker"),
                "name": info.get("name"),
                "max_leverage": info.get("max_leverage"),
                "emoji": info.get("emoji"),
                "category": info.get("category")
            }
        
        return {
            "number": "7", 
            "color": "Gold", 
            "power_hour": "11:11",
            "ticker": "SOL",
            "name": "Solana",
            "max_leverage": 100,
            "emoji": "☀️",
            "category": "crypto"
        }

# Global service instance
horoscope_service = HoroscopeService()