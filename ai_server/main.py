"""
FastAPI + LangChain Horoscope Generator (Modular Architecture)
Main application entry point
"""
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded

from src.config.settings import settings
from src.config.logger import logger
from src.models.response_models import HealthResponse
from src.routes.horoscope_routes import router as horoscope_router
from src.middleware.error_handler import (
    validation_exception_handler,
    general_exception_handler
)
from src.middleware.rate_limiter import limiter, _rate_limit_exceeded_handler
from src.services.cache_service import cache_service

# How often (in seconds) the background task sweeps for expired cache entries
CACHE_CLEANUP_INTERVAL = 3600  # 1 hour


async def _cache_cleanup_loop():
    """Background task: periodically evict expired in-memory cache entries."""
    while True:
        await asyncio.sleep(CACHE_CLEANUP_INTERVAL)
        removed = cache_service.cleanup_expired()
        if removed:
            logger.info(f"Cache cleanup: removed {removed} expired entries")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan events for startup and shutdown
    """
    # Startup
    logger.info("Starting Hastrology AI Server")
    logger.info(f"Environment: {settings.environment}")
    logger.info(f"Cache enabled: {settings.cache_enabled}")
    logger.info(f"Rate limiting enabled: {settings.rate_limit_enabled}")

    # Start background cache cleanup task
    cleanup_task = asyncio.create_task(_cache_cleanup_loop())
    logger.info(f"Cache cleanup scheduled every {CACHE_CLEANUP_INTERVAL}s")

    yield

    # Shutdown
    cleanup_task.cancel()
    logger.info("Shutting down gracefully...")
    cache_service.clear()
    logger.info("Cache cleared")


# Initialize FastAPI application
app = FastAPI(
    title="Hastrology AI Server",
    description="AI-powered horoscope generation using Google Gemini",
    version="2.0.0",
    lifespan=lifespan
)

# Add rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add custom exception handlers
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(Exception, general_exception_handler)

# Include routers
app.include_router(horoscope_router, tags=["Horoscope"])


@app.get(
    "/",
    response_model=HealthResponse,
    summary="Health check",
    description="Check if the API is running"
)
async def root():
    """Health check endpoint"""
    return HealthResponse(
        status="ok",
        message="Hastrology AI Server is running"
    )


@app.get(
    "/cache/stats",
    summary="Cache statistics",
    description="Get current cache statistics"
)
async def cache_stats():
    """Get cache statistics"""
    return {
        "enabled": cache_service.enabled,
        "entries": len(cache_service.cache),
        "ttl_seconds": cache_service.ttl
    }


@app.post(
    "/cache/clear",
    summary="Clear cache",
    description="Clear all cache entries"
)
async def clear_cache():
    """Clear cache endpoint"""
    cache_service.clear()
    logger.info("Cache cleared via API endpoint")
    return {"message": "Cache cleared successfully"}


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.environment == "development",
        log_level=settings.log_level.lower()
    )