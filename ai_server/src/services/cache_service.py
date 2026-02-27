"""
In-memory cache service for horoscope responses
"""
import hashlib
import time
from datetime import date
from typing import Optional, Dict, Tuple
from ..config.settings import settings
from ..config.logger import logger


class CacheService:
    """Simple in-memory cache with TTL support"""
    
    def __init__(self):
        self.cache: Dict[str, Tuple[str, float]] = {}
        self.enabled = settings.cache_enabled
        self.ttl = settings.cache_ttl_seconds
        logger.info(f"Cache service initialized (enabled={self.enabled}, ttl={self.ttl}s)")
    
    def _generate_key(self, dob: str, birth_time: str, birth_place: str) -> str:
        """
        Generate cache key from birth details and today's date.

        The date component ensures that cached entries are naturally scoped
        to the day they were generated, so a 11:55 PM entry is never served
        as the next day's horoscope even if the TTL hasn't elapsed yet.

        Args:
            dob: Date of birth
            birth_time: Time of birth
            birth_place: Place of birth

        Returns:
            MD5 hash of the combined inputs including today's date
        """
        today = date.today().isoformat()  # YYYY-MM-DD
        combined = f"{dob}|{birth_time}|{birth_place}|{today}".lower()
        return hashlib.md5(combined.encode()).hexdigest()
    
    def get(self, dob: str, birth_time: str, birth_place: str) -> Optional[str]:
        """
        Get cached horoscope if available and not expired
        
        Args:
            dob: Date of birth
            birth_time: Time of birth
            birth_place: Place of birth
            
        Returns:
            Cached horoscope text or None
        """
        if not self.enabled:
            return None
        
        key = self._generate_key(dob, birth_time, birth_place)
        
        if key in self.cache:
            horoscope_text, timestamp = self.cache[key]
            
            # Check if cache entry is still valid
            if time.time() - timestamp < self.ttl:
                logger.info(f"Cache hit for key: {key[:8]}...")
                return horoscope_text
            else:
                # Remove expired entry
                logger.info(f"Cache expired for key: {key[:8]}...")
                del self.cache[key]
        
        logger.info(f"Cache miss for key: {key[:8]}...")
        return None
    
    def set(self, dob: str, birth_time: str, birth_place: str, horoscope_text: str) -> None:
        """
        Store horoscope in cache
        
        Args:
            dob: Date of birth
            birth_time: Time of birth
            birth_place: Place of birth
            horoscope_text: Generated horoscope text
        """
        if not self.enabled:
            return
        
        key = self._generate_key(dob, birth_time, birth_place)
        self.cache[key] = (horoscope_text, time.time())
        logger.info(f"Cached horoscope for key: {key[:8]}... (total entries: {len(self.cache)})")
    
    def clear(self) -> None:
        """Clear all cache entries"""
        self.cache.clear()
        logger.info("Cache cleared")
    
    def cleanup_expired(self) -> int:
        """
        Remove expired cache entries
        
        Returns:
            Number of entries removed
        """
        current_time = time.time()
        expired_keys = [
            key for key, (_, timestamp) in self.cache.items()
            if current_time - timestamp >= self.ttl
        ]
        
        for key in expired_keys:
            del self.cache[key]
        
        if expired_keys:
            logger.info(f"Cleaned up {len(expired_keys)} expired cache entries")
        
        return len(expired_keys)


# Global cache instance
cache_service = CacheService()
