"""
API routes for horoscope generation - CDO Enhanced
"""
from fastapi import APIRouter, HTTPException, status
from ..models.request_models import HoroscopeRequest
from ..models.response_models import HoroscopeResponse, AstroCard
from ..services.horoscope_service import horoscope_service
from ..config.logger import logger
from ..middleware.correlation_id import request_id_var

router = APIRouter()


@router.post(
    "/generate_horoscope",
    response_model=HoroscopeResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate personalized astro cards with CDO",
    description="Generate high-fidelity horoscope cards using Swiss Ephemeris and Cosmic Data Object architecture"
)
async def generate_horoscope(request: HoroscopeRequest):
    """
    Generate personalized horoscope card based on birth details and geolocation.
    
    Uses Swiss Ephemeris for topocentric planetary calculations and builds
    a Cosmic Data Object (CDO) for AI-powered interpretation.
    
    Args:
        request: HoroscopeRequest containing dob, birth_time, birth_place,
                 latitude, longitude, and optional timezone_offset
        
    Returns:
        HoroscopeResponse with structured astro card and CDO data
        
    Raises:
        HTTPException: If horoscope generation fails
    """
    try:
        req_id = request_id_var.get()
        logger.info(f"CDO Horoscope request: DOB={request.dob}, Lat={request.latitude}, Lon={request.longitude}, X=@{request.x_handle}, requestId={req_id}")
        
        card_data, was_cached, generation_mode = await horoscope_service.generate_horoscope(
            dob=request.dob,
            birth_time=request.birth_time,
            birth_place=request.birth_place,
            latitude=request.latitude,
            longitude=request.longitude,
            timezone_offset=request.timezone_offset or 0.0,
            x_handle=request.x_handle,
            x_bio=request.x_bio,
            x_recent_tweets=request.x_recent_tweets,
            x_persona=request.x_persona
        )
        
        # Convert raw card data to AstroCard model
        card = AstroCard(**card_data)
        
        logger.info(f"Generated horoscope (mode={generation_mode}, cached={was_cached}, requestId={req_id})")
        
        return HoroscopeResponse(
            card=card,
            cached=was_cached,
            generation_mode=generation_mode
        )
        
    except ValueError as e:
        logger.error(f"Validation error: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid input: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Error in generate_horoscope endpoint: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate horoscope: {str(e)}"
        )
